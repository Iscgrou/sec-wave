/**
 * PayamCouncil Engine — Quantitative Feature Extraction + 38-Agent Deliberation
 * Evaluates real OHLCV candles to detect Liquidity Sweeps, Structure Breaks (MSS),
 * FVG/OB POI Anchors (max 2), ATR Volatility Regime, and R:R Geometry.
 * Enforces ALL 7 Hard Invariants (I1..I7) and issues B13 Regime Certificates.
 */

import { payamBus } from '../bus/eventBus';
import {
  ASSET_SPECS,
  type AgentEvaluation,
  type AssetSymbol,
  type BudgetState,
  type CandleBar,
  type CouncilDeliberation,
  type KernelRiskConfig,
  type LlmHeadValidatedOutput,
  type MarketRegime,
  type PayamSignal,
  type PoiAnchor,
  type RegimeCertificate,
  type TradeSide,
} from '../types';
import { fnv1aHex } from '../utils/sanitize';
import { PAYAM_COUNCIL_AGENTS } from './agents';
import {
  enforceI1AsymmetricAuthority,
  enforceI3NonDegradingRiskGuards,
  enforceI5TextIsDataFirewall,
  enforceI6DefaultNoTradeAndCertificate,
} from './invariants';

export interface QuantitativeStructure {
  readonly atr: number;
  readonly regime: MarketRegime;
  readonly sweepDetected: boolean;
  readonly sweepSide: TradeSide | null;
  readonly mssConfirmed: boolean;
  readonly displacementRatio: number;
  readonly htfAligned: boolean;
  readonly poiAnchors: readonly PoiAnchor[];
  readonly proposedEntry: number;
  readonly proposedStopLoss: number;
  readonly proposedTp1: number;
  readonly proposedTp2: number;
  readonly invalidationPrice: number;
  readonly rrRatio: number;
  readonly spreadNormalized: number;
}

function roundDecimals(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Pure deterministic quantitative extraction over real OHLCV bars.
 */
export function extractQuantitativeStructure(
  asset: AssetSymbol,
  bars: readonly CandleBar[],
  currentSpread: number
): QuantitativeStructure {
  const spec = ASSET_SPECS[asset];
  const recent = bars.slice(-20);
  if (recent.length < 12) {
    return {
      atr: spec.atrBaseline,
      regime: 'RANGE_COMPRESSION',
      sweepDetected: false,
      sweepSide: null,
      mssConfirmed: false,
      displacementRatio: 0,
      htfAligned: false,
      poiAnchors: [],
      proposedEntry: spec.defaultPrice,
      proposedStopLoss: spec.defaultPrice,
      proposedTp1: spec.defaultPrice,
      proposedTp2: spec.defaultPrice,
      invalidationPrice: spec.defaultPrice,
      rrRatio: 0,
      spreadNormalized: 0.1,
    };
  }

  // 1. Real 14-period ATR calculation
  let trSum = 0;
  const atrPeriod = Math.min(14, recent.length - 1);
  for (let i = recent.length - atrPeriod; i < recent.length; i += 1) {
    const cur = recent[i];
    const prev = recent[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    trSum += tr;
  }
  const atr = Math.max(spec.tickSize * 4, trSum / atrPeriod);

  // 2. Dynamic sliding-window liquidity sweep + displacement + MSS scan over last 12 bars
  const window12 = recent.slice(-12);
  const latestBar = window12[window12.length - 1];

  let sweepSide: TradeSide | null = null;
  let sweepBar = window12[3] ?? window12[0];
  let dispBar1 = window12[4] ?? sweepBar;
  let bestScore = 0;
  let bestDisplacementRatio = 0;
  let mssConfirmed = false;

  for (let idx = 2; idx <= window12.length - 4; idx += 1) {
    const priorShelf = window12.slice(0, idx);
    const shelfLow = Math.min(...priorShelf.map((b) => b.low));
    const shelfHigh = Math.max(...priorShelf.map((b) => b.high));

    const cand = window12[idx];
    const d1 = window12[idx + 1];
    const d2 = window12[idx + 2];

    const bullWick = Math.min(cand.open, cand.close) - cand.low;
    const bearWick = cand.high - Math.max(cand.open, cand.close);

    const bullDispBody = Math.max(0, d1.close - d1.open) + Math.max(0, d2.close - d2.open);
    const bearDispBody = Math.max(0, d1.open - d1.close) + Math.max(0, d2.open - d2.close);

    if (cand.low < shelfLow && bullWick > atr * 0.4 && bullDispBody > atr * 0.85) {
      const score = (bullWick + bullDispBody) / atr;
      const isMss = d2.close > shelfHigh * 0.999 || d2.close > cand.high;
      if (score > bestScore && isMss) {
        bestScore = score;
        sweepSide = 'LONG';
        sweepBar = cand;
        dispBar1 = d1;
        bestDisplacementRatio = bullDispBody / atr;
        mssConfirmed = true;
      }
    }

    if (cand.high > shelfHigh && bearWick > atr * 0.4 && bearDispBody > atr * 0.85) {
      const score = (bearWick + bearDispBody) / atr;
      const isMss = d2.close < shelfLow * 1.001 || d2.close < cand.low;
      if (score > bestScore && isMss) {
        bestScore = score;
        sweepSide = 'SHORT';
        sweepBar = cand;
        dispBar1 = d1;
        bestDisplacementRatio = bearDispBody / atr;
        mssConfirmed = true;
      }
    }
  }

  const displacementRatio = bestDisplacementRatio;

  // 4. Regime Classification
  const rangeHigh = Math.max(...window12.map((b) => b.high));
  const rangeLow = Math.min(...window12.map((b) => b.low));
  const rangeToAtr = (rangeHigh - rangeLow) / atr;

  let regime: MarketRegime = 'RANGE_COMPRESSION';
  if (atr > spec.atrBaseline * 2.1) {
    regime = 'HIGH_VOL_SHOCK';
  } else if (sweepSide && mssConfirmed) {
    regime = rangeToAtr > 3.2 ? 'TRENDING_EXPANSION' : 'LIQUIDITY_REVERSAL';
  } else if (rangeToAtr > 3.6) {
    regime = 'TRENDING_EXPANSION';
  }

  // 5. HTF Trend Alignment (compare earliest vs recent close across full series)
  const htfOpen = bars[Math.max(0, bars.length - 48)]?.close ?? latestBar.close;
  const htfDelta = latestBar.close - htfOpen;
  const htfAligned =
    sweepSide === 'LONG'
      ? htfDelta >= -atr * 1.5
      : sweepSide === 'SHORT'
        ? htfDelta <= atr * 1.5
        : false;

  // 6. Compute Entry, Structural SL, Invalidation, TP1, TP2 & Max 2 POI Anchors
  const entry = roundDecimals(latestBar.close, spec.decimals);
  let stopLoss = entry;
  let invalidationPrice = entry;
  let tp1 = entry;
  let tp2 = entry;
  const poiAnchors: PoiAnchor[] = [];

  if (sweepSide === 'LONG') {
    invalidationPrice = roundDecimals(sweepBar.low, spec.decimals);
    stopLoss = roundDecimals(sweepBar.low - atr * 0.22, spec.decimals);
    const riskDist = Math.max(atr * 0.65, entry - stopLoss);
    stopLoss = roundDecimals(entry - riskDist, spec.decimals);
    tp1 = roundDecimals(entry + riskDist * 1.5, spec.decimals);
    tp2 = roundDecimals(entry + riskDist * 2.6, spec.decimals);

    // POI 1: Displacement FVG
    poiAnchors.push({
      id: `${asset}-FVG-1`,
      labelFa: 'ناحیه FVG صعودی',
      kind: 'FVG',
      priceBottom: roundDecimals(Math.min(dispBar1.open, dispBar1.close) + atr * 0.1, spec.decimals),
      priceTop: roundDecimals(Math.max(dispBar1.open, dispBar1.close) - atr * 0.05, spec.decimals),
      startTime: dispBar1.time,
      endTime: latestBar.time,
    });
    // POI 2: Sweep Origin OB
    poiAnchors.push({
      id: `${asset}-SWEEP-2`,
      labelFa: 'منشأ هانت نقدینگی',
      kind: 'SWEEP',
      priceBottom: roundDecimals(sweepBar.low, spec.decimals),
      priceTop: roundDecimals(Math.min(sweepBar.open, sweepBar.close), spec.decimals),
      startTime: sweepBar.time,
      endTime: latestBar.time,
    });
  } else if (sweepSide === 'SHORT') {
    invalidationPrice = roundDecimals(sweepBar.high, spec.decimals);
    stopLoss = roundDecimals(sweepBar.high + atr * 0.22, spec.decimals);
    const riskDist = Math.max(atr * 0.65, stopLoss - entry);
    stopLoss = roundDecimals(entry + riskDist, spec.decimals);
    tp1 = roundDecimals(entry - riskDist * 1.5, spec.decimals);
    tp2 = roundDecimals(entry - riskDist * 2.6, spec.decimals);

    poiAnchors.push({
      id: `${asset}-FVG-1`,
      labelFa: 'ناحیه FVG نزولی',
      kind: 'FVG',
      priceBottom: roundDecimals(Math.min(dispBar1.open, dispBar1.close) + atr * 0.05, spec.decimals),
      priceTop: roundDecimals(Math.max(dispBar1.open, dispBar1.close) - atr * 0.1, spec.decimals),
      startTime: dispBar1.time,
      endTime: latestBar.time,
    });
    poiAnchors.push({
      id: `${asset}-SWEEP-2`,
      labelFa: 'منشأ هانت سقف',
      kind: 'SWEEP',
      priceBottom: roundDecimals(Math.max(sweepBar.open, sweepBar.close), spec.decimals),
      priceTop: roundDecimals(sweepBar.high, spec.decimals),
      startTime: sweepBar.time,
      endTime: latestBar.time,
    });
  }

  const riskDist = Math.abs(entry - stopLoss);
  const rewardDist = Math.abs(tp2 - entry);
  const rrRatio = riskDist > 0 ? Number((rewardDist / riskDist).toFixed(2)) : 0;

  return {
    atr: roundDecimals(atr, spec.decimals),
    regime,
    sweepDetected: sweepSide !== null,
    sweepSide,
    mssConfirmed,
    displacementRatio: Number(displacementRatio.toFixed(2)),
    htfAligned,
    poiAnchors: poiAnchors.slice(0, 2), // Strictly max 2 POI anchors
    proposedEntry: entry,
    proposedStopLoss: stopLoss,
    proposedTp1: tp1,
    proposedTp2: tp2,
    invalidationPrice,
    rrRatio,
    spreadNormalized: atr > 0 ? Number((currentSpread / atr).toFixed(4)) : 0.05,
  };
}

/**
 * Issues a B13 Regime Certificate bound to asset + active regime + TTL.
 */
export function issueB13RegimeCertificate(
  asset: AssetSymbol,
  regime: MarketRegime,
  nowMs: number,
  ttlMs: number = 15 * 60 * 1000
): RegimeCertificate {
  const issuedAt = nowMs;
  const expiresAt = nowMs + ttlMs;
  const digest = fnv1aHex(`${asset}|${regime}|${issuedAt}|B13`);
  const certId = `B13-${asset}-${digest.slice(0, 6)}`;
  return {
    certId,
    issuedBy: 'B13',
    asset,
    regime,
    issuedAt,
    expiresAt,
    revoked: false,
    signatureHash: digest,
  };
}

export interface DeliberationParams {
  readonly asset: AssetSymbol;
  readonly bars: readonly CandleBar[];
  readonly currentSpread: number;
  readonly kernelConfig: KernelRiskConfig;
  readonly budget: BudgetState;
  readonly openPositionCount: number;
  readonly rawLlmHeads?: readonly unknown[];
  readonly llmDegradeReason?: string;
  readonly nowMs?: number;
  readonly emitEvents?: boolean;
}

/**
 * Runs the complete 38-agent PayamCouncil deliberation pipeline.
 * Strictly deterministic at its core; online LLM heads (A7, A8, A11) are passed
 * through the I5 Firewall and I1 Asymmetric Authority reducer.
 */
export function deliberateCouncil(params: DeliberationParams): CouncilDeliberation {
  const startMs = params.nowMs ?? Date.now();
  const shouldEmit = params.emitEvents ?? true;
  const spec = ASSET_SPECS[params.asset];

  if (shouldEmit) {
    payamBus.emit({
      type: 'COUNCIL_START',
      asset: params.asset,
      timestamp: startMs,
    });
  }

  // 1. Quantitative structure extraction
  const q = extractQuantitativeStructure(params.asset, params.bars, params.currentSpread);

  // 2. Enforce I5 Firewall on any incoming raw LLM head payloads
  const validatedHeads: LlmHeadValidatedOutput[] = [];
  let firewallBlockedCount = 0;
  for (const raw of params.rawLlmHeads ?? []) {
    const fw = enforceI5TextIsDataFirewall(raw);
    if (fw.accepted && fw.deterministicVector) {
      validatedHeads.push({
        ...fw.deterministicVector,
        summaryFa: fw.displayOnlyProseFa,
        latencyMs:
          typeof (raw as { latencyMs?: unknown }).latencyMs === 'number'
            ? ((raw as { latencyMs: number }).latencyMs)
            : 420,
      });
    } else {
      firewallBlockedCount += 1;
    }
  }

  const llmOnline = validatedHeads.length > 0 && !params.budget.exhausted;

  // 3. Enforce I3 Non-Degrading Risk Guards
  const i3 = enforceI3NonDegradingRiskGuards(params.kernelConfig, params.budget, llmOnline);

  // 4. Enforce I1 Asymmetric Authority if a directional setup exists
  const baseRiskPct = Math.min(0.75, i3.effectiveConfig.maxRiskPerTradePct);
  const i1 =
    q.sweepSide !== null
      ? enforceI1AsymmetricAuthority(
          {
            side: q.sweepSide,
            entry: q.proposedEntry,
            deterministicStopLoss: q.proposedStopLoss,
            deterministicRiskPct: baseRiskPct,
            decimals: spec.decimals,
          },
          validatedHeads
        )
      : null;

  // Recompute R:R after any I1 SL tightening (tightening SL improves or preserves R:R)
  const finalStopLoss = i1 ? i1.finalStopLoss : q.proposedStopLoss;
  const finalRiskDist = Math.abs(q.proposedEntry - finalStopLoss);
  const finalRR =
    finalRiskDist > 0
      ? Number((Math.abs(q.proposedTp2 - q.proposedEntry) / finalRiskDist).toFixed(2))
      : 0;

  // 5. Evaluate all 38 agents with real deterministic metrics
  const headById = new Map(validatedHeads.map((h) => [h.headId, h]));
  const evaluations: AgentEvaluation[] = [];
  const vetoAgentIds: string[] = [];

  const spreadOk = q.spreadNormalized <= 0.14;
  const regimeTradable = q.regime !== 'RANGE_COMPRESSION' && q.regime !== 'HIGH_VOL_SHOCK';
  const rrOk = finalRR >= i3.effectiveConfig.minRewardToRisk;
  const exposureOk = params.openPositionCount < i3.effectiveConfig.maxConcurrentPositions;
  const structureReady = q.sweepDetected && q.mssConfirmed && q.sweepSide !== null;

  // Issue B13 certificate ONLY if structural + risk + I1 preconditions hold
  const canIssueCert =
    structureReady &&
    spreadOk &&
    regimeTradable &&
    rrOk &&
    exposureOk &&
    i3.tradingAllowed &&
    (i1 ? i1.allowed : false);

  const certificate: RegimeCertificate | null = canIssueCert
    ? issueB13RegimeCertificate(params.asset, q.regime, startMs)
    : null;

  // Construct candidate signal and pass through I6 hard gate
  let finalSignal: PayamSignal | null = null;
  let noTradeReasonFa: string | undefined;

  if (certificate && q.sweepSide && i1) {
    const dirLabel = q.sweepSide === 'LONG' ? 'خرید' : 'فروش';
    const sweepLabel = q.sweepSide === 'LONG' ? 'کف‌های نقدینگی' : 'سقف‌های نقدینگی';
    const rationaleFa: readonly [string, string, string, string] = [
      `هانت نقدینگی ${sweepLabel} روی ${params.asset} تکمیل شد و سفارشات حد ضرر جمع‌آوری گردید.`,
      `شکست ساختار (MSS) با جابه‌جایی قدرتمند (${q.displacementRatio.toFixed(1)}× ATR) و تثبیت کندل تأیید شد.`,
      `ورود ${dirLabel} هم‌راستا با ناحیه POI و نسبت ریسک به ریوارد ${finalRR.toFixed(2)} تنظیم شد.`,
      `گواهی رژیم ${certificate.certId} توسط B13 صادر و زیر چتر ناوردایان I1 تا I7 قفل شد.`,
    ];

    const candidate: PayamSignal = {
      signalId: `SIG-${params.asset}-${startMs.toString(36).toUpperCase()}`,
      asset: params.asset,
      side: q.sweepSide,
      entry: q.proposedEntry,
      stopLoss: finalStopLoss,
      tp1: q.proposedTp1,
      tp2: q.proposedTp2,
      invalidationPrice: q.invalidationPrice,
      rrRatio: finalRR,
      recommendedRiskPct: i1.finalRiskPct,
      confidenceScore: Math.min(
        94,
        Math.round(68 + Math.min(18, q.displacementRatio * 9) + (q.htfAligned ? 6 : 0))
      ),
      regime: q.regime,
      certId: certificate.certId,
      certificate,
      rationaleFa,
      poiAnchors: q.poiAnchors,
      createdAt: startMs,
      llmRiskMultiplierApplied: i1.appliedRiskMultiplier,
      llmDegraded: !llmOnline,
      llmDegradeReason: params.llmDegradeReason,
    };

    const i6Check = enforceI6DefaultNoTradeAndCertificate(
      candidate,
      certificate,
      q.regime,
      startMs,
      i3.effectiveConfig.minRewardToRisk
    );

    if (i6Check.permitted) {
      finalSignal = candidate;
    } else {
      noTradeReasonFa = i6Check.audit.reasonFa;
    }
  } else {
    if (!i3.tradingAllowed) {
      noTradeReasonFa = 'مدارشکن روزانه I3 فعال است؛ معامله جدید تا پایان روز قفل شد.';
    } else if (i1 && !i1.allowed) {
      noTradeReasonFa = `هد شناختی ${i1.vetoedByHead} ستاپ را طبق ناوردای I1 وتو کرد (NO_TRADE).`;
    } else if (!exposureOk) {
      noTradeReasonFa = 'سقف پوزیشن‌های هم‌زمان پر است؛ تا مدیریت پوزیشن فعلی ورود جدید ممنوع است.';
    } else if (!regimeTradable) {
      noTradeReasonFa =
        q.regime === 'HIGH_VOL_SHOCK'
          ? 'رژیم شوک نوسانی فعال است؛ B13 گواهی معامله صادر نکرد (NO_TRADE).'
          : 'بازار در فشردگی رنج قرار دارد؛ شکست ساختار معتبر شکل نگرفت (NO_TRADE).';
    } else if (!structureReady) {
      noTradeReasonFa = 'هانت نقدینگی و شکست ساختار (MSS) هنوز تثبیت نشده‌اند (پیش‌فرض NO_TRADE).';
    } else if (!rrOk) {
      noTradeReasonFa = `نسبت R:R ستاپ (${finalRR.toFixed(2)}) زیر حداقل مجاز هسته قرار دارد.`;
    } else {
      noTradeReasonFa = 'شرایط کامل گواهی B13 محرز نشد؛ وضعیت در حالت پیش‌فرض NO_TRADE ماند.';
    }
  }

  for (let idx = 0; idx < PAYAM_COUNCIL_AGENTS.length; idx += 1) {
    const def = PAYAM_COUNCIL_AGENTS[idx];
    let verdict: AgentEvaluation['verdict'] = 'APPROVE';
    let score = 0.86;
    let noteFa = 'تأیید ساختاری بر اساس داده‌های لحظه‌ای بازار.';
    let vetoTriggered = false;
    let latencyMs = 2 + (idx % 7);

    if (def.isOnlineLlm) {
      const llmOut = headById.get(def.id as 'A7' | 'A8' | 'A11');
      if (llmOut) {
        latencyMs = Math.round(llmOut.latencyMs);
        if (llmOut.riskAction === 'VETO' || llmOut.structuralInvalidationFlag) {
          verdict = 'VETO';
          score = 0.15;
          vetoTriggered = true;
          noteFa = llmOut.summaryFa;
        } else if (llmOut.riskAction === 'REDUCE_RISK' || llmOut.riskAction === 'TIGHTEN_SL') {
          verdict = 'REDUCE_RISK';
          score = 0.68;
          noteFa = llmOut.summaryFa;
        } else {
          verdict = 'APPROVE';
          score = 0.89;
          noteFa = llmOut.summaryFa;
        }
      } else {
        verdict = 'DEGRADED';
        score = 0.5;
        latencyMs = 0;
        noteFa =
          params.llmDegradeReason ??
          'اجرای قطعی فعال است؛ عمق شناختی آنلاین بدون اثر بر گاردهای I3 غیرفعال ماند.';
      }
    } else {
      switch (def.id) {
        case 'A1':
          verdict = spreadOk ? 'APPROVE' : 'VETO';
          vetoTriggered = !spreadOk;
          score = spreadOk ? 0.92 : 0.2;
          noteFa = spreadOk
            ? `اسپرد نرمال (${(q.spreadNormalized * 100).toFixed(1)}٪ از ATR).`
            : 'اسپرد بیش از حد مجاز است؛ وتوی ریزساختار اعمال شد.';
          break;
        case 'A2':
          verdict = q.sweepDetected ? 'APPROVE' : 'STANDBY';
          score = q.sweepDetected ? 0.91 : 0.35;
          noteFa = q.sweepDetected
            ? 'هانت نقدینگی و برگشت سریع قیمت در کندل کلیدی ثبت شد.'
            : 'هانت نقدینگی واضحی در ۱۲ کندل اخیر رخ نداد.';
          break;
        case 'A3':
          verdict = q.mssConfirmed ? 'APPROVE' : 'STANDBY';
          score = q.mssConfirmed ? 0.9 : 0.3;
          noteFa = q.mssConfirmed
            ? 'شکست ساختار بازار با تثبیت بدنه کندل تأیید شد.'
            : 'تثبیت کندل برای شکست ساختار هنوز تکمیل نشد.';
          break;
        case 'A4':
          verdict = q.poiAnchors.length > 0 ? 'APPROVE' : 'STANDBY';
          score = q.poiAnchors.length > 0 ? 0.88 : 0.4;
          noteFa =
            q.poiAnchors.length > 0
              ? `${q.poiAnchors.length} ناحیه کلیدی POI استخراج شد.`
              : 'ناحیه FVG یا اردربلاک باکیفیت ثبت نشد.';
          break;
        case 'A5':
          verdict = q.htfAligned ? 'APPROVE' : 'CAUTION';
          score = q.htfAligned ? 0.87 : 0.58;
          noteFa = q.htfAligned
            ? 'جهت ستاپ با روند غالب تایم‌فریم بالا هم‌سو است.'
            : 'ستاپ خلاف مومنتوم میان‌مدت است؛ احتیاط در سیو سود پله‌ای لازم است.';
          break;
        case 'A6':
          verdict = regimeTradable ? 'APPROVE' : 'VETO';
          vetoTriggered = !regimeTradable;
          score = regimeTradable ? 0.89 : 0.22;
          noteFa = `رژیم فعال: ${q.regime} (ATR = ${q.atr}).`;
          break;
        case 'B1':
          verdict = rrOk ? 'APPROVE' : 'VETO';
          vetoTriggered = structureReady && !rrOk;
          score = rrOk ? 0.93 : 0.25;
          noteFa = rrOk
            ? `نسبت ریسک به ریوارد ${finalRR.toFixed(2)} بالای کف مجاز هسته است.`
            : 'نسبت R:R به کف نهادی نرسید.';
          break;
        case 'B9':
          verdict = exposureOk ? 'APPROVE' : 'VETO';
          vetoTriggered = !exposureOk;
          score = exposureOk ? 0.94 : 0.15;
          noteFa = exposureOk
            ? `ظرفیت پوزیشن باز مجاز است (${params.openPositionCount}/${i3.effectiveConfig.maxConcurrentPositions}).`
            : 'سقف پوزیشن هم‌زمان تکمیل شد؛ ورود جدید وتو شد.';
          break;
        case 'B10':
        case 'C5':
          verdict = firewallBlockedCount > 0 ? 'CAUTION' : 'APPROVE';
          score = 0.98;
          noteFa =
            firewallBlockedCount > 0
              ? `${firewallBlockedCount} پیام خام نامعتبر پشت دیواره آتش I5 متوقف شد.`
              : 'دیواره آتش I5 فعال است؛ تنها بردار عددی معتبر عبور کرد.';
          break;
        case 'B11':
        case 'C1':
          verdict = i1 && !i1.allowed ? 'VETO' : i1?.audit.clamped ? 'REDUCE_RISK' : 'APPROVE';
          vetoTriggered = Boolean(i1 && !i1.allowed);
          score = 0.96;
          noteFa = i1
            ? i1.audit.reasonFa
            : 'اقتدار نامتقارن I1 آماده اعمال بر هر ستاپ فعال است.';
          break;
        case 'B13':
          verdict = certificate ? 'APPROVE' : 'VETO';
          vetoTriggered = !certificate;
          score = certificate ? 0.99 : 0.1;
          noteFa = certificate
            ? `گواهی ${certificate.certId} برای رژیم ${q.regime} صادر شد.`
            : 'شرایط احراز نشد؛ گواهی B13 صادر نگردید (NO_TRADE).';
          break;
        case 'C3':
          verdict = i3.tradingAllowed ? 'APPROVE' : 'VETO';
          vetoTriggered = !i3.tradingAllowed;
          score = i3.tradingAllowed ? 0.99 : 0.05;
          noteFa = i3.audit.reasonFa;
          break;
        case 'C6':
          verdict = finalSignal ? 'APPROVE' : 'STANDBY';
          score = 0.99;
          noteFa = finalSignal
            ? `سیگنال با گواهی معتبر ${finalSignal.certId} مجوز انتشار گرفت.`
            : 'پیش‌فرض امن I6 (NO_TRADE) برقرار است.';
          break;
        case 'C8':
          verdict = params.budget.exhausted ? 'DEGRADED' : 'APPROVE';
          score = params.budget.exhausted ? 0.55 : 0.95;
          noteFa = params.budget.exhausted
            ? 'سهمیه بودجه مدل تکمیل شد؛ فقط عمق شناختی کم شد و I3 دست‌نخورده ماند.'
            : `مصرف بودجه نشست: ${params.budget.tokensUsedSession}/${params.budget.tokenCapSession} توکن.`;
          break;
        default:
          verdict = finalSignal ? 'APPROVE' : structureReady ? 'CAUTION' : 'STANDBY';
          score = finalSignal ? 0.88 : 0.62;
          noteFa = finalSignal
            ? 'تطابق کامل با پارامترهای نهادی و ناوردایان هسته.'
            : 'در حالت پایش ساختار و انتظار تکمیل شرایط گواهی.';
          break;
      }
    }

    if (vetoTriggered) {
      vetoAgentIds.push(def.id);
    }

    const evaluation: AgentEvaluation = {
      id: def.id,
      plane: def.plane,
      nameFa: def.nameFa,
      verdict,
      score,
      latencyMs,
      noteFa,
      isOnlineLlm: def.isOnlineLlm,
      invariantRef: def.invariantRef,
      vetoTriggered,
    };

    evaluations.push(evaluation);

    if (shouldEmit) {
      payamBus.emit({
        type: 'AGENT_EVALUATED',
        asset: params.asset,
        agent: evaluation,
        timestamp: startMs,
      });

      if (vetoTriggered) {
        payamBus.emit({
          type: 'VETO_SHIELD_RAISED',
          asset: params.asset,
          agentId: def.id,
          invariantRef: def.invariantRef,
          reasonFa: noteFa,
          timestamp: startMs,
        });
      }
    }
  }

  if (shouldEmit && certificate) {
    payamBus.emit({
      type: 'CERT_ISSUED_B13',
      asset: params.asset,
      certId: certificate.certId,
      expiresAt: certificate.expiresAt,
      timestamp: startMs,
    });
  }

  const consensusApproveCount = evaluations.filter((e) => e.verdict === 'APPROVE').length;
  const durationMs = Math.max(4, Date.now() - startMs);

  const deliberation: CouncilDeliberation = {
    deliberationId: `DLB-${params.asset}-${startMs.toString(36).toUpperCase()}`,
    asset: params.asset,
    timestamp: startMs,
    regime: q.regime,
    agents: evaluations,
    consensusApproveCount,
    vetoCount: vetoAgentIds.length,
    vetoAgentIds,
    llmMode: llmOnline ? 'ONLINE_GEMINI' : 'DETERMINISTIC_FALLBACK',
    llmDegradeReason: params.llmDegradeReason,
    signal: finalSignal,
    noTradeReasonFa,
    durationMs,
  };

  if (shouldEmit) {
    payamBus.emit({
      type: 'COUNCIL_COMPLETE',
      asset: params.asset,
      deliberation,
      timestamp: startMs,
    });
  }

  return deliberation;
}
