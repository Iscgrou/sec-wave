/**
 * PayamFeed Market Worker — Off-Main-Thread Tick Engine & Companion Bridge Adapter
 * Decodes live ticks or optional Layer-5 Companion Bridge WebSocket messages,
 * maintains 5-asset OHLCV buffers, monitors 7-state feed health, and transfers
 * ticks via zero-copy Transferable Float32Array ping-pong (upgrading to SAB only
 * when crossOriginIsolated === true).
 */

import {
  ASSET_LIST,
  ASSET_SPECS,
  type AssetSymbol,
  type CandleBar,
  type FeedHealthState,
} from '../core/types';
import {
  generateHistoricalCandles,
  stepDeterministicTick,
} from '../core/feed/syntheticCandles';
import {
  detectTransportCapabilities,
  PingPongFloat32Pool,
} from '../core/feed/transport';

type InboundMessage =
  | { type: 'INIT' }
  | { type: 'SET_HEALTH_OVERRIDE'; health: FeedHealthState | null }
  | { type: 'CONNECT_BRIDGE'; url: string | null }
  | { type: 'RECYCLE_BUFFER'; buffer: ArrayBuffer }
  | { type: 'REQUEST_BARS'; asset: AssetSymbol };

const BAR_INTERVAL_SEC = 900; // 15m verification lens bars
const TICK_INTERVAL_MS = 950; // Realistic off-main-thread feed cadence

const barsByAsset = new Map<AssetSymbol, CandleBar[]>();
const openBaselineByAsset = new Map<AssetSymbol, number>();
const lastPriceByAsset = new Map<AssetSymbol, number>();
const lastSpreadByAsset = new Map<AssetSymbol, number>();

const pool = new PingPongFloat32Pool(ASSET_LIST.length * 5, 2);
const capabilities = detectTransportCapabilities();

let stepCounter = 0;
let healthOverride: FeedHealthState | null = null;
let activeHealth: FeedHealthState = 'HEALTHY';
let lastTickTimestamp = Date.now();
let tickTimer: ReturnType<typeof setInterval> | null = null;
let bridgeSocket: WebSocket | null = null;

function bootstrapHistory(): void {
  const nowSec = Math.floor(Date.now() / 1000);
  for (const symbol of ASSET_LIST) {
    const bars = generateHistoricalCandles(symbol, 120, nowSec);
    barsByAsset.set(symbol, bars);
    const firstClose = bars[Math.max(0, bars.length - 32)]?.close ?? ASSET_SPECS[symbol].defaultPrice;
    const latest = bars[bars.length - 1];
    openBaselineByAsset.set(symbol, firstClose);
    lastPriceByAsset.set(symbol, latest?.close ?? ASSET_SPECS[symbol].defaultPrice);
    lastSpreadByAsset.set(symbol, ASSET_SPECS[symbol].tickSize * 12);
  }
}

function broadcastSnapshot(): void {
  const historyPayload: Record<string, CandleBar[]> = {};
  for (const symbol of ASSET_LIST) {
    historyPayload[symbol] = barsByAsset.get(symbol) ?? [];
  }
  self.postMessage({
    type: 'INIT_READY',
    capabilities,
    health: healthOverride ?? activeHealth,
    history: historyPayload,
    baselines: Object.fromEntries(openBaselineByAsset.entries()),
  });
}

function emitTickFrame(): void {
  const now = Date.now();
  const effectiveHealth = healthOverride ?? activeHealth;

  // On STALE or DEAD, freeze tick progression and report loud staleness
  if (effectiveHealth === 'STALE' || effectiveHealth === 'DEAD') {
    self.postMessage({
      type: 'HEALTH_STATUS',
      health: effectiveHealth,
      latencyMs: effectiveHealth === 'DEAD' ? 9999 : 4800,
      lastTickAt: lastTickTimestamp,
    });
    return;
  }

  stepCounter += 1;
  lastTickTimestamp = now;

  const tickView = pool.acquire();
  const updatedBars: Partial<Record<AssetSymbol, CandleBar>> = {};
  const nowSec = Math.floor(now / 1000);
  const currentBucketSec = Math.floor(nowSec / BAR_INTERVAL_SEC) * BAR_INTERVAL_SEC;

  for (let i = 0; i < ASSET_LIST.length; i += 1) {
    const symbol = ASSET_LIST[i];
    const currentPrice = lastPriceByAsset.get(symbol) ?? ASSET_SPECS[symbol].defaultPrice;
    const next = stepDeterministicTick(symbol, currentPrice, stepCounter);

    lastPriceByAsset.set(symbol, next.price);
    lastSpreadByAsset.set(symbol, next.spread);

    const base = i * 5;
    tickView[base] = next.price;
    tickView[base + 1] = next.bid;
    tickView[base + 2] = next.ask;
    tickView[base + 3] = next.spread;
    tickView[base + 4] = (now % 1_000_000_000) / 1000;

    const series = barsByAsset.get(symbol);
    if (series && series.length > 0) {
      const lastBar = series[series.length - 1];
      if (lastBar.time === currentBucketSec) {
        const merged: CandleBar = {
          time: lastBar.time,
          open: lastBar.open,
          high: Math.max(lastBar.high, next.price),
          low: Math.min(lastBar.low, next.price),
          close: next.price,
          volume: lastBar.volume + 18,
        };
        series[series.length - 1] = merged;
        updatedBars[symbol] = merged;
      } else if (currentBucketSec > lastBar.time) {
        const fresh: CandleBar = {
          time: currentBucketSec,
          open: lastBar.close,
          high: Math.max(lastBar.close, next.price),
          low: Math.min(lastBar.close, next.price),
          close: next.price,
          volume: 40,
        };
        series.push(fresh);
        if (series.length > 160) series.shift();
        updatedBars[symbol] = fresh;
      }
    }
  }

  const simulatedLatency =
    effectiveHealth === 'LATENCY_SPIKE'
      ? 680
      : effectiveHealth === 'DEGRADED'
        ? 310
        : effectiveHealth === 'RECONNECTING'
          ? 920
          : 24 + (stepCounter % 15);

  const transferableBuffer = tickView.buffer;
  self.postMessage(
    {
      type: 'TICK_BATCH',
      health: effectiveHealth,
      latencyMs: simulatedLatency,
      timestamp: now,
      buffer: transferableBuffer,
      updatedBars,
    },
    { transfer: [transferableBuffer] }
  );
}

function connectCompanionBridge(url: string | null): void {
  if (bridgeSocket) {
    try {
      bridgeSocket.close();
    } catch {
      // ignore
    }
    bridgeSocket = null;
  }

  if (!url) {
    activeHealth = 'HEALTHY';
    self.postMessage({
      type: 'HEALTH_STATUS',
      health: healthOverride ?? activeHealth,
      latencyMs: 28,
      lastTickAt: lastTickTimestamp,
    });
    return;
  }

  activeHealth = 'RECONNECTING';
  self.postMessage({
    type: 'HEALTH_STATUS',
    health: healthOverride ?? activeHealth,
    latencyMs: 450,
    lastTickAt: lastTickTimestamp,
  });

  try {
    const ws = new WebSocket(url);
    bridgeSocket = ws;

    ws.onopen = () => {
      activeHealth = 'HEALTHY';
      self.postMessage({
        type: 'HEALTH_STATUS',
        health: healthOverride ?? activeHealth,
        latencyMs: 18,
        lastTickAt: Date.now(),
      });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          symbol?: AssetSymbol;
          price?: number;
          spread?: number;
        };
        if (msg.symbol && typeof msg.price === 'number' && ASSET_LIST.includes(msg.symbol)) {
          lastPriceByAsset.set(msg.symbol, msg.price);
          if (typeof msg.spread === 'number') {
            lastSpreadByAsset.set(msg.symbol, msg.spread);
          }
          lastTickTimestamp = Date.now();
        }
      } catch {
        // Ignore malformed bridge frames cleanly
      }
    };

    ws.onerror = () => {
      activeHealth = 'DEGRADED';
      self.postMessage({
        type: 'HEALTH_STATUS',
        health: healthOverride ?? activeHealth,
        latencyMs: 420,
        lastTickAt: lastTickTimestamp,
      });
    };

    ws.onclose = () => {
      if (bridgeSocket === ws) {
        bridgeSocket = null;
        activeHealth = 'SIMULATED_REPLAY';
        self.postMessage({
          type: 'HEALTH_STATUS',
          health: healthOverride ?? activeHealth,
          latencyMs: 42,
          lastTickAt: lastTickTimestamp,
        });
      }
    };
  } catch {
    activeHealth = 'SIMULATED_REPLAY';
  }
}

self.onmessage = (ev: MessageEvent<InboundMessage>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'INIT':
      bootstrapHistory();
      broadcastSnapshot();
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = setInterval(emitTickFrame, TICK_INTERVAL_MS);
      break;
    case 'SET_HEALTH_OVERRIDE':
      healthOverride = msg.health;
      self.postMessage({
        type: 'HEALTH_STATUS',
        health: healthOverride ?? activeHealth,
        latencyMs:
          healthOverride === 'DEAD'
            ? 9999
            : healthOverride === 'STALE'
              ? 4800
              : healthOverride === 'LATENCY_SPIKE'
                ? 720
                : 32,
        lastTickAt: lastTickTimestamp,
      });
      break;
    case 'CONNECT_BRIDGE':
      connectCompanionBridge(msg.url);
      break;
    case 'RECYCLE_BUFFER':
      pool.recycle(msg.buffer);
      break;
    case 'REQUEST_BARS':
      self.postMessage({
        type: 'ASSET_BARS',
        asset: msg.asset,
        bars: barsByAsset.get(msg.asset) ?? [],
      });
      break;
    default:
      break;
  }
};
