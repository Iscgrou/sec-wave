/**
 * Payam Sovereign (پایام ساورین) — Single-Screen Institutional Trading Cockpit
 * 8-Column 4px Grid BorderLayout:
 *   - Fixed Top Perception Bar (5 assets + 7-state health + FMA + Council Pulse + CVD Toggle)
 *   - 6-Column Dual-Lens Center (Tab <16ms switch between PayamLens & PayamArena, or Split >=1920px)
 *   - 2-Column Action Dock (Fail-Loudly lockout, I4 Freeze, I6 B13 Cert, I7 Broker Gate, I2 SL Ratchet)
 *   - Overlay Layer-3 Glass-Box Drawer (Hotkey D)
 * React stays OUT of the 60FPS tick hot path: Worker decodes ticks via Transferable Float32Array
 * ping-pong, updates Lightweight Charts imperatively, and throttles DOM numeric updates to ~350ms.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { payamBus } from './core/bus/eventBus';
import { deliberateCouncil, extractQuantitativeStructure } from './core/council/engine';
import { requestOnlineLlmHeads } from './core/council/llmClient';
import { generateHistoricalCandles } from './core/feed/syntheticCandles';
import {
  detectTransportCapabilities,
  unpackFloat32Ticks,
  type BinaryTransportCapabilities,
} from './core/feed/transport';
import { payamLedger } from './core/ledger/payamLedger';
import {
  countActivePositions,
  deriveAssetState,
  transitionEnterManualPosition,
  transitionRatchetStopLoss,
  transitionReconcilePosition,
  transitionTriggerUnknownFreeze,
} from './core/statechart/machine';
import {
  ASSET_LIST,
  ASSET_SPECS,
  type AssetRuntimeSnapshot,
  type AssetSymbol,
  type BudgetState,
  type CandleBar,
  type FeedHealthState,
  type KernelRiskConfig,
  type LedgerEntry,
  type LensViewMode,
  type OpenPosition,
  type PayamSignal,
} from './core/types';
import { sanitizeForClipboard } from './core/utils/sanitize';
import { PayamArena } from './ui/arena/PayamArena';
import { ActionDock } from './ui/components/ActionDock';
import { GlassBoxDrawer } from './ui/components/GlassBoxDrawer';
import { TopPerceptionBar } from './ui/components/TopPerceptionBar';
import { PayamLens, type PayamLensHandle } from './ui/lens/PayamLens';
import {
  applyPayamTheme,
  PAYAM_THEMES,
  type PayamThemeMode,
} from './ui/theme/tokens';

const INITIAL_KERNEL_CONFIG: KernelRiskConfig = Object.freeze({
  maxRiskPerTradePct: 0.75,
  maxDailyDrawdownR: -3.0,
  minRewardToRisk: 2.0,
  maxConcurrentPositions: 2,
  unknownConfidenceThreshold: 0.72,
  circuitBreakerTripped: false,
  dailyRealizedR: 0,
});

const INITIAL_BUDGET: BudgetState = Object.freeze({
  tokensUsedSession: 0,
  tokenCapSession: 24_000,
  callsThisHour: 0,
  hourlyCallCap: 30,
  exhausted: false,
});

function buildInitialState(): {
  barsByAsset: Record<AssetSymbol, CandleBar[]>;
  snapshots: Record<AssetSymbol, AssetRuntimeSnapshot>;
} {
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const barsByAsset = {} as Record<AssetSymbol, CandleBar[]>;
  const snapshots = {} as Record<AssetSymbol, AssetRuntimeSnapshot>;

  for (const symbol of ASSET_LIST) {
    const spec = ASSET_SPECS[symbol];
    const bars = generateHistoricalCandles(symbol, 120, nowSec);
    barsByAsset[symbol] = bars;
    const latest = bars[bars.length - 1];
    const base = bars[Math.max(0, bars.length - 32)]?.close ?? spec.defaultPrice;
    const spread = Number((spec.atrBaseline * 0.024).toFixed(spec.decimals));

    const delib = deliberateCouncil({
      asset: symbol,
      bars,
      currentSpread: spread,
      kernelConfig: INITIAL_KERNEL_CONFIG,
      budget: INITIAL_BUDGET,
      openPositionCount: 0,
      nowMs,
      emitEvents: false,
    });

    const derived = deriveAssetState('HEALTHY', delib.signal, null, false, nowMs);

    snapshots[symbol] = {
      symbol,
      lastPrice: latest.close,
      bid: Number((latest.close - spread / 2).toFixed(spec.decimals)),
      ask: Number((latest.close + spread / 2).toFixed(spec.decimals)),
      spread,
      changePct: base > 0 ? Number((((latest.close - base) / base) * 100).toFixed(2)) : 0,
      atr: extractQuantitativeStructure(symbol, bars, spread).atr,
      regime: delib.regime,
      fmaMode: derived.fmaMode,
      stateNode: derived.stateNode,
      signal: delib.signal,
      position: null,
      lastDeliberation: delib,
      lastTickAt: nowMs,
    };
  }

  return { barsByAsset, snapshots };
}

export default function App() {
  const initialRef = useRef<ReturnType<typeof buildInitialState> | null>(null);
  if (!initialRef.current) {
    initialRef.current = buildInitialState();
  }

  const barsMapRef = useRef<Record<AssetSymbol, CandleBar[]>>(initialRef.current.barsByAsset);
  const lensRef = useRef<PayamLensHandle | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const lastDomFlushRef = useRef<number>(0);

  const [activeAsset, setActiveAsset] = useState<AssetSymbol>('XAUUSD');
  const activeAssetRef = useRef<AssetSymbol>('XAUUSD');
  activeAssetRef.current = activeAsset;

  const [snapshots, setSnapshots] = useState<Record<AssetSymbol, AssetRuntimeSnapshot>>(
    initialRef.current.snapshots
  );
  const snapshotsRef = useRef(snapshots);
  snapshotsRef.current = snapshots;

  const [feedHealth, setFeedHealth] = useState<FeedHealthState>('HEALTHY');
  const feedHealthRef = useRef<FeedHealthState>('HEALTHY');
  feedHealthRef.current = feedHealth;

  const [feedLatencyMs, setFeedLatencyMs] = useState<number>(28);
  const [lensMode, setLensMode] = useState<LensViewMode>('CHART');
  const [canSplit, setCanSplit] = useState<boolean>(
    () => typeof window !== 'undefined' && window.innerWidth >= 1920
  );
  const [htfMode, setHtfMode] = useState<boolean>(false);
  const htfModeRef = useRef<boolean>(false);
  htfModeRef.current = htfMode;

  const [themeMode, setThemeMode] = useState<PayamThemeMode>('institutional');
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [councilBusy, setCouncilBusy] = useState<boolean>(false);
  const [onlineLlmEnabled, setOnlineLlmEnabled] = useState<boolean>(false);
  const [geminiServerReady, setGeminiServerReady] = useState<boolean>(false);
  const [budget, setBudget] = useState<BudgetState>(INITIAL_BUDGET);
  const [ledgerEntries, setLedgerEntries] = useState<readonly LedgerEntry[]>([]);
  const [bridgeUrl, setBridgeUrl] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<{
    tone: 'info' | 'warn' | 'block';
    textFa: string;
  } | null>(null);
  const [transportCaps, setTransportCaps] = useState<BinaryTransportCapabilities>(() =>
    detectTransportCapabilities()
  );

  const theme = PAYAM_THEMES[themeMode];

  // Apply theme token attribute to <html>
  useEffect(() => {
    applyPayamTheme(themeMode);
  }, [themeMode]);

  // Monitor >=1920px viewport for Dual-Lens Split eligibility
  useEffect(() => {
    const onResize = () => {
      const wide = window.innerWidth >= 1920;
      setCanSplit(wide);
      if (!wide && lensMode === 'SPLIT') {
        setLensMode('CHART');
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [lensMode]);

  // Hydrate PayamLedger from IndexedDB and probe /api/health
  useEffect(() => {
    void payamLedger.hydrate().then((entries) => {
      setLedgerEntries(entries);
      if (entries.length === 0) {
        void payamLedger
          .append({
            timestamp: Date.now(),
            asset: 'XAUUSD',
            category: 'COUNCIL_DECISION',
            invariantRef: 'I6',
            severity: 'INFO',
            summaryFa: 'بوت کامل پایام ساورین با شورای ۳۸ ایجنت و ۷ ناوردای سخت I1..I7 انجام شد.',
          })
          .then(() => setLedgerEntries(payamLedger.getSnapshot()));
      }
    });

    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { geminiConfigured?: boolean } | null) => {
        if (data?.geminiConfigured) {
          setGeminiServerReady(true);
        }
      })
      .catch(() => {
        setGeminiServerReady(false);
      });
  }, []);

  // Boot Off-Main-Thread PayamFeed Web Worker with Transferable Float32Array Ping-Pong
  useEffect(() => {
    if (typeof Worker === 'undefined') return;

    const worker = new Worker(new URL('./workers/market.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as {
        type: string;
        capabilities?: BinaryTransportCapabilities;
        health?: FeedHealthState;
        latencyMs?: number;
        timestamp?: number;
        buffer?: ArrayBuffer;
        history?: Record<AssetSymbol, CandleBar[]>;
        updatedBars?: Partial<Record<AssetSymbol, CandleBar>>;
      };

      if (msg.type === 'INIT_READY') {
        if (msg.capabilities) setTransportCaps(msg.capabilities);
        if (msg.history) {
          barsMapRef.current = msg.history;
          const activeBars = msg.history[activeAssetRef.current];
          if (activeBars) {
            lensRef.current?.setBars(activeBars, htfModeRef.current);
          }
        }
        return;
      }

      if (msg.type === 'HEALTH_STATUS' && msg.health) {
        const nextHealth = msg.health;
        setFeedHealth(nextHealth);
        if (typeof msg.latencyMs === 'number') setFeedLatencyMs(msg.latencyMs);
        payamBus.emit({
          type: 'FEED_HEALTH_CHANGED',
          health: nextHealth,
          latencyMs: msg.latencyMs ?? 0,
          timestamp: Date.now(),
        });
        setSnapshots((prev) => {
          const next = { ...prev };
          const now = Date.now();
          for (const sym of ASSET_LIST) {
            const s = prev[sym];
            const d = deriveAssetState(nextHealth, s.signal, s.position, false, now);
            next[sym] = { ...s, fmaMode: d.fmaMode, stateNode: d.stateNode };
          }
          return next;
        });
        return;
      }

      if (msg.type === 'TICK_BATCH' && msg.buffer) {
        const tickView = new Float32Array(msg.buffer);
        const unpacked = unpackFloat32Ticks(tickView, ASSET_LIST.length);
        const now = msg.timestamp ?? Date.now();

        // 1. Update in-memory bar map & push active asset candle IMPERATIVELY to Lightweight Charts
        if (msg.updatedBars) {
          for (const sym of ASSET_LIST) {
            const bar = msg.updatedBars[sym];
            if (!bar) continue;
            const list = barsMapRef.current[sym];
            if (list && list.length > 0) {
              if (list[list.length - 1].time === bar.time) {
                list[list.length - 1] = bar;
              } else {
                list.push(bar);
                if (list.length > 160) list.shift();
              }
            }
            if (sym === activeAssetRef.current) {
              lensRef.current?.updateLatestBar(bar, htfModeRef.current);
            }
          }
        }

        // 2. Throttle React numeric DOM updates to ~350ms (keeps React off the 60FPS hot path)
        if (now - lastDomFlushRef.current >= 350) {
          lastDomFlushRef.current = now;
          if (typeof msg.latencyMs === 'number') setFeedLatencyMs(msg.latencyMs);
          if (msg.health && msg.health !== feedHealthRef.current) {
            setFeedHealth(msg.health);
          }

          setSnapshots((prev) => {
            const next = { ...prev };
            for (let i = 0; i < ASSET_LIST.length; i += 1) {
              const sym = ASSET_LIST[i];
              const tick = unpacked[i];
              if (!tick || tick.price <= 0) continue;
              const s = prev[sym];
              next[sym] = {
                ...s,
                lastPrice: tick.price,
                bid: tick.bid,
                ask: tick.ask,
                spread: tick.spread,
                lastTickAt: now,
              };
            }
            return next;
          });
        }

        // 3. Recycle ping-pong ArrayBuffer back to Worker (zero-copy)
        worker.postMessage({ type: 'RECYCLE_BUFFER', buffer: msg.buffer }, [msg.buffer]);
      }
    };

    worker.postMessage({ type: 'INIT' });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const commitLedger = useCallback(async (entry: Omit<LedgerEntry, 'id'>) => {
    await payamLedger.append(entry);
    setLedgerEntries(payamLedger.getSnapshot());
  }, []);

  // Sanitized 1-click clipboard copy (Zero commas, $, %, or invisible BiDi chars)
  const handleCopyPrice = useCallback(
    (slotKey: '1' | '2' | '3' | '4', rawPrice: number) => {
      const spec = ASSET_SPECS[activeAssetRef.current];
      const clean = sanitizeForClipboard(rawPrice, spec.decimals);
      if (!clean) return;

      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        void navigator.clipboard.writeText(clean).catch(() => {
          // Clipboard permission fallback silently handled
        });
      }

      setCopiedKey(slotKey);
      setFeedbackNotice({
        tone: 'info',
        textFa: `عدد خام پالایش‌شده (${clean}) بدون کاراکتر BiDi کپی شد.`,
      });
      setTimeout(() => {
        setCopiedKey((curr) => (curr === slotKey ? null : curr));
      }, 1600);
    },
    []
  );

  // Run 38-Agent Council Deliberation (Deterministic + Optional Server-Side Gemini A7/A8/A11)
  const handleRunDeliberation = useCallback(async () => {
    const symbol = activeAssetRef.current;
    const bars = barsMapRef.current[symbol] ?? [];
    const snap = snapshotsRef.current[symbol];
    if (bars.length < 12) return;

    setCouncilBusy(true);
    setFeedbackNotice(null);

    try {
      const q = extractQuantitativeStructure(symbol, bars, snap.spread);
      let rawLlmHeads: readonly unknown[] = [];
      let degradeReason: string | undefined;

      if (onlineLlmEnabled) {
        const llmRes = await requestOnlineLlmHeads(
          {
            asset: symbol,
            regime: q.regime,
            side: q.sweepSide,
            entry: q.proposedEntry,
            stopLoss: q.proposedStopLoss,
            tp1: q.proposedTp1,
            tp2: q.proposedTp2,
            rrRatio: q.rrRatio,
            atr: q.atr,
            displacementRatio: q.displacementRatio,
          },
          budget
        );

        rawLlmHeads = llmRes.heads;
        if (llmRes.status === 'DEGRADED') {
          degradeReason = llmRes.reason;
          await commitLedger({
            timestamp: Date.now(),
            asset: symbol,
            category: 'LLM_DEGRADATION',
            invariantRef: 'I3',
            severity: 'WARN',
            summaryFa: llmRes.reason ?? 'افت عمق شناختی مدل؛ اجرای ۱۰۰٪ قطعی فعال ماند.',
          });
        }

        if (llmRes.tokensEstimated > 0) {
          setBudget((prev) => {
            const used = prev.tokensUsedSession + llmRes.tokensEstimated;
            const calls = prev.callsThisHour + 1;
            return {
              ...prev,
              tokensUsedSession: used,
              callsThisHour: calls,
              exhausted: used >= prev.tokenCapSession || calls >= prev.hourlyCallCap,
            };
          });
        }
      }

      const positionsMap = Object.fromEntries(
        ASSET_LIST.map((sym) => [sym, snapshotsRef.current[sym].position])
      ) as Record<AssetSymbol, OpenPosition | null>;

      const nowMs = Date.now();
      const delib = deliberateCouncil({
        asset: symbol,
        bars,
        currentSpread: snap.spread,
        kernelConfig: INITIAL_KERNEL_CONFIG,
        budget,
        openPositionCount: countActivePositions(positionsMap),
        rawLlmHeads,
        llmDegradeReason: degradeReason,
        nowMs,
        emitEvents: true,
      });

      const derived = deriveAssetState(
        feedHealthRef.current,
        delib.signal,
        snap.position,
        INITIAL_KERNEL_CONFIG.circuitBreakerTripped,
        nowMs
      );

      setSnapshots((prev) => ({
        ...prev,
        [symbol]: {
          ...prev[symbol],
          atr: q.atr,
          regime: delib.regime,
          fmaMode: derived.fmaMode,
          stateNode: derived.stateNode,
          signal: delib.signal,
          lastDeliberation: delib,
        },
      }));

      if (delib.signal) {
        await commitLedger({
          timestamp: nowMs,
          asset: symbol,
          category: 'CERT_ISSUED',
          invariantRef: 'I6',
          severity: 'INFO',
          summaryFa: `گواهی ${delib.signal.certId} توسط B13 برای ستاپ ${delib.signal.side} صادر شد.`,
          numericPayload: {
            entry: delib.signal.entry,
            sl: delib.signal.stopLoss,
            rr: delib.signal.rrRatio,
          },
        });
        setFeedbackNotice({
          tone: 'info',
          textFa: `شورای ۳۸ ایجنت تکمیل شد؛ گواهی ${delib.signal.certId} با نسبت 1:${delib.signal.rrRatio.toFixed(2)} صادر گردید.`,
        });
      } else {
        await commitLedger({
          timestamp: nowMs,
          asset: symbol,
          category: 'COUNCIL_DECISION',
          invariantRef: 'I6',
          severity: 'WARN',
          summaryFa: delib.noTradeReasonFa ?? 'نتیجه شورا: NO_TRADE.',
        });
        setFeedbackNotice({
          tone: 'warn',
          textFa: delib.noTradeReasonFa ?? 'ستاپ واجد شرایط یافت نشد؛ وضعیت در پیش‌فرض NO_TRADE ماند.',
        });
      }
    } finally {
      setCouncilBusy(false);
    }
  }, [budget, commitLedger, onlineLlmEnabled]);

  // Manual Entry Flow gated by I7 + I6
  const handleEnterManualPosition = useCallback(
    (brokerSlPlaced: boolean, brokerTpPlaced: boolean) => {
      const symbol = activeAssetRef.current;
      const snap = snapshotsRef.current[symbol];
      const nowMs = Date.now();

      const res = transitionEnterManualPosition({
        feedHealth: feedHealthRef.current,
        signal: snap.signal,
        activeRegime: snap.regime,
        confirmation: {
          brokerSlPlaced,
          brokerTpPlaced,
          confirmedAt: nowMs,
        },
        nowMs,
      });

      if (!res.ok) {
        setFeedbackNotice({ tone: 'block', textFa: res.reasonFa });
        void commitLedger({
          timestamp: nowMs,
          asset: symbol,
          category: 'INVARIANT_GUARD',
          invariantRef: res.invariant ?? 'I7',
          severity: 'BLOCK',
          summaryFa: res.reasonFa,
        });
        return;
      }

      const derived = deriveAssetState(feedHealthRef.current, snap.signal, res.position, false, nowMs);
      setSnapshots((prev) => ({
        ...prev,
        [symbol]: {
          ...prev[symbol],
          position: res.position,
          fmaMode: derived.fmaMode,
          stateNode: derived.stateNode,
        },
      }));

      payamBus.emit({
        type: 'POSITION_UPDATED',
        asset: symbol,
        position: res.position,
        timestamp: nowMs,
      });

      setFeedbackNotice({
        tone: 'info',
        textFa: `ورود دستی روی ${symbol} با تأیید I7 ثبت شد؛ حالت به TWS تغییر کرد.`,
      });

      void commitLedger({
        timestamp: nowMs,
        asset: symbol,
        category: 'POSITION_OPEN',
        invariantRef: 'I7',
        severity: 'INFO',
        summaryFa: `پوزیشن دستی ${res.position.side} روی ${symbol} با تأیید استقرار SL/TP در بروکر باز شد.`,
        numericPayload: {
          entry: res.position.entryPrice,
          sl: res.position.currentStopLoss,
        },
      });
    },
    [commitLedger]
  );

  // I2 One-Way SL Ratchet
  const handleRatchetSl = useCallback(
    (proposedSl: number) => {
      const symbol = activeAssetRef.current;
      const snap = snapshotsRef.current[symbol];
      if (!snap.position) return;
      const nowMs = Date.now();

      const res = transitionRatchetStopLoss(snap.position, proposedSl, feedHealthRef.current);
      if (!res.ok) {
        setFeedbackNotice({ tone: 'block', textFa: res.reasonFa });
        payamBus.emit({
          type: 'INVARIANT_TRIGGERED',
          asset: symbol,
          invariant: res.invariant,
          passed: false,
          reasonFa: res.reasonFa,
          timestamp: nowMs,
        });
        void commitLedger({
          timestamp: nowMs,
          asset: symbol,
          category: 'INVARIANT_GUARD',
          invariantRef: res.invariant,
          severity: 'BLOCK',
          summaryFa: res.reasonFa,
          numericPayload: { currentSl: snap.position.currentStopLoss, proposedSl },
        });
        return;
      }

      setSnapshots((prev) => ({
        ...prev,
        [symbol]: {
          ...prev[symbol],
          position: res.position,
        },
      }));
      setFeedbackNotice({ tone: 'info', textFa: res.reasonFa });
      void commitLedger({
        timestamp: nowMs,
        asset: symbol,
        category: 'SL_RATCHET',
        invariantRef: 'I2',
        severity: 'INFO',
        summaryFa: `حد ضرر ${symbol} به ${res.position.currentStopLoss} تنگ شد (ضامن یک‌طرفه I2).`,
      });
    },
    [commitLedger]
  );

  // Partial Close 50% at TP1
  const handlePartialCloseTp1 = useCallback(() => {
    const symbol = activeAssetRef.current;
    const snap = snapshotsRef.current[symbol];
    if (!snap.position) return;
    const nowMs = Date.now();

    const updated: OpenPosition = {
      ...snap.position,
      remainingSizePct: 50,
      status: 'PARTIAL_TP1',
      directiveFa: '۵۰٪ سیو سود پله‌ای ثبت شد؛ ریسک‌فری ساختاری را روی باقی‌مانده حفظ کنید.',
    };

    setSnapshots((prev) => ({
      ...prev,
      [symbol]: { ...prev[symbol], position: updated },
    }));
    setFeedbackNotice({
      tone: 'info',
      textFa: 'سیو سود پله‌ای ۵۰٪ در دفترچه ثبت شد.',
    });
    void commitLedger({
      timestamp: nowMs,
      asset: symbol,
      category: 'PARTIAL_CLOSE',
      severity: 'INFO',
      summaryFa: `۵۰٪ از پوزیشن ${symbol} سیو سود پله‌ای شد.`,
    });
  }, [commitLedger]);

  // Full Close Position -> Return to SEARCH / LOCKED
  const handleClosePosition = useCallback(() => {
    const symbol = activeAssetRef.current;
    const snap = snapshotsRef.current[symbol];
    if (!snap.position) return;
    const nowMs = Date.now();
    const derived = deriveAssetState(feedHealthRef.current, null, null, false, nowMs);

    setSnapshots((prev) => ({
      ...prev,
      [symbol]: {
        ...prev[symbol],
        position: null,
        signal: null,
        fmaMode: derived.fmaMode,
        stateNode: derived.stateNode,
      },
    }));
    setFeedbackNotice({
      tone: 'info',
      textFa: `پوزیشن ${symbol} بسته شد و سیستم به حالت جستجو (SEARCH) بازگشت.`,
    });
    void commitLedger({
      timestamp: nowMs,
      asset: symbol,
      category: 'POSITION_CLOSE',
      severity: 'INFO',
      summaryFa: `خروج کامل دستی از پوزیشن ${symbol} ثبت گردید.`,
    });
  }, [commitLedger]);

  // Trigger I4 Unknown State Freeze
  const handleTriggerUnknownFreeze = useCallback(() => {
    const symbol = activeAssetRef.current;
    const snap = snapshotsRef.current[symbol];
    if (!snap.position) return;
    const nowMs = Date.now();
    const frozenPos = transitionTriggerUnknownFreeze(snap.position, 0.38);

    setSnapshots((prev) => ({
      ...prev,
      [symbol]: {
        ...prev[symbol],
        position: frozenPos,
        stateNode: 'POSITION_UNKNOWN_FREEZE',
      },
    }));
    setFeedbackNotice({
      tone: 'block',
      textFa: 'انجماد I4 فعال شد: تمام توصیه‌ها متوقف گردید. فقط «تطبیق وضعیت پوزیشن» مجاز است.',
    });
    void commitLedger({
      timestamp: nowMs,
      asset: symbol,
      category: 'INVARIANT_GUARD',
      invariantRef: 'I4',
      severity: 'BLOCK',
      summaryFa: `افت اطمینان وضعیت پوزیشن ${symbol}؛ انجماد I4 اعمال شد.`,
    });
  }, [commitLedger]);

  // Reconcile I4 Unknown State
  const handleReconcilePosition = useCallback(
    (payload: {
      brokerPrice: number;
      brokerStopLoss: number;
      remainingSizePct: number;
      isStillOpen: boolean;
    }) => {
      const symbol = activeAssetRef.current;
      const snap = snapshotsRef.current[symbol];
      if (!snap.position) return;
      const nowMs = Date.now();

      const res = transitionReconcilePosition(snap.position, payload, nowMs);
      if (!res.ok) {
        setFeedbackNotice({ tone: 'block', textFa: res.reasonFa });
        return;
      }

      const nextSignal: PayamSignal | null = res.position ? snap.signal : null;
      const derived = deriveAssetState(feedHealthRef.current, nextSignal, res.position, false, nowMs);

      setSnapshots((prev) => ({
        ...prev,
        [symbol]: {
          ...prev[symbol],
          position: res.position,
          signal: nextSignal,
          fmaMode: derived.fmaMode,
          stateNode: derived.stateNode,
        },
      }));
      setFeedbackNotice({ tone: 'info', textFa: res.reasonFa });
      void commitLedger({
        timestamp: nowMs,
        asset: symbol,
        category: 'RECONCILE_I4',
        invariantRef: 'I4',
        severity: 'INFO',
        summaryFa: res.reasonFa,
      });
    },
    [commitLedger]
  );

  // Feed Health Simulator / Companion Bridge Controls
  const handleSetFeedHealthOverride = useCallback(
    (nextHealth: FeedHealthState | null) => {
      const effective: FeedHealthState = nextHealth ?? 'HEALTHY';
      setFeedHealth(effective);
      workerRef.current?.postMessage({ type: 'SET_HEALTH_OVERRIDE', health: nextHealth });

      const nowMs = Date.now();
      setSnapshots((prev) => {
        const next = { ...prev };
        for (const sym of ASSET_LIST) {
          const s = prev[sym];
          const d = deriveAssetState(effective, s.signal, s.position, false, nowMs);
          next[sym] = { ...s, fmaMode: d.fmaMode, stateNode: d.stateNode };
        }
        return next;
      });

      void commitLedger({
        timestamp: nowMs,
        asset: activeAssetRef.current,
        category: 'FEED_STATE',
        severity: effective === 'STALE' || effective === 'DEAD' ? 'BLOCK' : 'INFO',
        summaryFa: `وضعیت فید بازار به ${effective} تغییر یافت.`,
      });
    },
    [commitLedger]
  );

  const handleConnectBridge = useCallback((url: string | null) => {
    setBridgeUrl(url);
    workerRef.current?.postMessage({ type: 'CONNECT_BRIDGE', url });
  }, []);

  const handleExportLedger = useCallback(() => {
    const json = payamLedger.exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payam-sovereign-ledger-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // Institutional Hotkeys: Tab (Lens switch <16ms), D (Drawer), Space (HTF/reset), 1-4 (Sanitized Copy)
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (inInput) return;

      if (ev.key === 'Tab') {
        ev.preventDefault();
        setLensMode((prev) => (prev === 'CHART' ? 'ARENA' : 'CHART'));
      } else if (ev.key === 'd' || ev.key === 'D') {
        ev.preventDefault();
        setDrawerOpen((prev) => !prev);
      } else if (ev.key === ' ') {
        ev.preventDefault();
        setHtfMode((prev) => !prev);
      } else if (ev.key === 'Escape' && drawerOpen) {
        setDrawerOpen(false);
      } else if (['1', '2', '3', '4'].includes(ev.key)) {
        const sig = snapshotsRef.current[activeAssetRef.current].signal;
        if (!sig) return;
        const key = ev.key as '1' | '2' | '3' | '4';
        const priceMap = {
          '1': sig.entry,
          '2': sig.stopLoss,
          '3': sig.tp1,
          '4': sig.tp2,
        };
        handleCopyPrice(key, priceMap[key]);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, handleCopyPrice]);

  const activeSnapshot = snapshots[activeAsset];
  const activeBars = useMemo(
    () => barsMapRef.current[activeAsset] ?? [],
    // Re-read bars cleanly when activeAsset changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeAsset]
  );

  return (
    <div
      dir="rtl"
      className="h-screen w-screen overflow-hidden flex flex-col"
      style={{
        backgroundColor: theme.bgCanvas,
        color: theme.textPrimary,
      }}
      data-testid="payam-sovereign-shell"
      data-theme-active={themeMode}
    >
      {/* Fixed Top Perception Bar */}
      <TopPerceptionBar
        activeAsset={activeAsset}
        snapshots={snapshots}
        feedHealth={feedHealth}
        feedLatencyMs={feedLatencyMs}
        lensMode={lensMode}
        canSplit={canSplit}
        themeMode={themeMode}
        theme={theme}
        drawerOpen={drawerOpen}
        councilBusy={councilBusy}
        onSelectAsset={(sym) => {
          setActiveAsset(sym);
          setFeedbackNotice(null);
        }}
        onChangeLens={setLensMode}
        onToggleDrawer={() => setDrawerOpen((prev) => !prev)}
        onToggleTheme={() =>
          setThemeMode((prev) => (prev === 'institutional' ? 'okabe-ito' : 'institutional'))
        }
      />

      {/* 8-Column Single-Screen Zero-Scroll BorderLayout */}
      <main className="flex-1 min-h-0 grid grid-cols-8 overflow-hidden">
        {/* 6-Column Dual-Lens Center */}
        <section
          className="col-span-8 lg:col-span-6 h-full min-h-0 flex overflow-hidden"
          aria-label="مرکز دو لنزه اعتبارسنجی و شورای ایجنت‌ها"
        >
          {lensMode === 'SPLIT' && canSplit ? (
            <div className="grid grid-cols-2 w-full h-full min-h-0">
              <div className="h-full min-h-0 border-e" style={{ borderColor: theme.borderHairline }}>
                <PayamLens
                  ref={lensRef}
                  asset={activeAsset}
                  theme={theme}
                  feedHealth={feedHealth}
                  signal={activeSnapshot.signal}
                  position={activeSnapshot.position}
                  htfMode={htfMode}
                  onToggleHtf={() => setHtfMode((p) => !p)}
                  initialBars={activeBars}
                />
              </div>
              <div className="h-full min-h-0">
                <PayamArena
                  asset={activeAsset}
                  deliberation={activeSnapshot.lastDeliberation}
                  theme={theme}
                />
              </div>
            </div>
          ) : lensMode === 'ARENA' ? (
            <PayamArena
              asset={activeAsset}
              deliberation={activeSnapshot.lastDeliberation}
              theme={theme}
            />
          ) : (
            <PayamLens
              ref={lensRef}
              asset={activeAsset}
              theme={theme}
              feedHealth={feedHealth}
              signal={activeSnapshot.signal}
              position={activeSnapshot.position}
              htfMode={htfMode}
              onToggleHtf={() => setHtfMode((p) => !p)}
              initialBars={activeBars}
            />
          )}
        </section>

        {/* 2-Column Action Dock */}
        <div className="hidden lg:block lg:col-span-2 h-full min-h-0 overflow-hidden">
          <ActionDock
            snapshot={activeSnapshot}
            feedHealth={feedHealth}
            theme={theme}
            councilBusy={councilBusy}
            onlineLlmEnabled={onlineLlmEnabled}
            copiedKey={copiedKey}
            feedbackNotice={feedbackNotice}
            onCopyPrice={handleCopyPrice}
            onRunDeliberation={() => {
              void handleRunDeliberation();
            }}
            onEnterManualPosition={handleEnterManualPosition}
            onRatchetSl={handleRatchetSl}
            onPartialCloseTp1={handlePartialCloseTp1}
            onClosePosition={handleClosePosition}
            onTriggerUnknownFreeze={handleTriggerUnknownFreeze}
            onReconcilePosition={handleReconcilePosition}
            onRestoreFeed={() => handleSetFeedHealthOverride(null)}
          />
        </div>
      </main>

      {/* Overlay Layer-3 Glass-Box Drawer (Hotkey D) */}
      <GlassBoxDrawer
        open={drawerOpen}
        snapshot={activeSnapshot}
        theme={theme}
        budget={budget}
        onlineLlmEnabled={onlineLlmEnabled}
        geminiServerReady={geminiServerReady}
        feedHealth={feedHealth}
        transportCaps={transportCaps}
        ledgerEntries={ledgerEntries}
        bridgeUrl={bridgeUrl}
        onClose={() => setDrawerOpen(false)}
        onToggleOnlineLlm={() => setOnlineLlmEnabled((p) => !p)}
        onSetFeedHealthOverride={handleSetFeedHealthOverride}
        onConnectBridge={handleConnectBridge}
        onExportLedger={handleExportLedger}
      />
    </div>
  );
}
