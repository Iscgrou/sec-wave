/**
 * Payam Sovereign — Strict Core Domain Types
 * Covers 5 Institutional Assets, 7-State Feed Health, FMA Modes,
 * 38-Agent 3-Plane Council (PayamCouncil), B13 Regime Certificates,
 * 7 Hard Invariants (I1..I7), and Harel Statechart States.
 */

export type AssetSymbol = 'XAUUSD' | 'XAGUSD' | 'WTI' | 'BTCUSD' | 'NAS100';

export interface AssetSpec {
  readonly symbol: AssetSymbol;
  readonly nameFa: string;
  readonly categoryFa: string;
  readonly decimals: number;
  readonly tickSize: number;
  readonly defaultPrice: number;
  readonly atrBaseline: number;
  readonly tradingViewUrl: string;
  readonly sessionLabelFa: string;
}

export const ASSET_SPECS: Readonly<Record<AssetSymbol, AssetSpec>> = Object.freeze({
  XAUUSD: Object.freeze({
    symbol: 'XAUUSD',
    nameFa: 'طلای جهانی',
    categoryFa: 'فلزات گران‌بها',
    decimals: 2,
    tickSize: 0.01,
    defaultPrice: 2684.5,
    atrBaseline: 6.4,
    tradingViewUrl: 'https://www.tradingview.com/chart/?symbol=OANDA:XAUUSD',
    sessionLabelFa: 'سشن لندن / نیویورک',
  }),
  XAGUSD: Object.freeze({
    symbol: 'XAGUSD',
    nameFa: 'نقره‌ی جهانی',
    categoryFa: 'فلزات گران‌بها',
    decimals: 3,
    tickSize: 0.001,
    defaultPrice: 31.425,
    atrBaseline: 0.14,
    tradingViewUrl: 'https://www.tradingview.com/chart/?symbol=OANDA:XAGUSD',
    sessionLabelFa: 'سشن لندن / نیویورک',
  }),
  WTI: Object.freeze({
    symbol: 'WTI',
    nameFa: 'نفت خام WTI',
    categoryFa: 'انرژی',
    decimals: 2,
    tickSize: 0.01,
    defaultPrice: 71.85,
    atrBaseline: 0.42,
    tradingViewUrl: 'https://www.tradingview.com/chart/?symbol=TVC:USOIL',
    sessionLabelFa: 'سشن نیویورک (NYMEX)',
  }),
  BTCUSD: Object.freeze({
    symbol: 'BTCUSD',
    nameFa: 'بیت‌کوین',
    categoryFa: 'دارایی دیجیتال',
    decimals: 1,
    tickSize: 0.5,
    defaultPrice: 94280.0,
    atrBaseline: 340.0,
    tradingViewUrl: 'https://www.tradingview.com/chart/?symbol=BITSTAMP:BTCUSD',
    sessionLabelFa: 'نقدینگی ۲۴ ساعته',
  }),
  NAS100: Object.freeze({
    symbol: 'NAS100',
    nameFa: 'شاخص نزدک ۱۰۰',
    categoryFa: 'شاخص سهام آمریکا',
    decimals: 1,
    tickSize: 0.25,
    defaultPrice: 20845.5,
    atrBaseline: 48.0,
    tradingViewUrl: 'https://www.tradingview.com/chart/?symbol=PEPPERSTONE:NAS100',
    sessionLabelFa: 'سشن نیویورک (NASDAQ)',
  }),
});

export const ASSET_LIST: readonly AssetSymbol[] = Object.freeze([
  'XAUUSD',
  'XAGUSD',
  'WTI',
  'BTCUSD',
  'NAS100',
]);

/** 7-State Feed Health Model (Fail-Loudly on STALE / DEAD) */
export type FeedHealthState =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'LATENCY_SPIKE'
  | 'RECONNECTING'
  | 'STALE'
  | 'DEAD'
  | 'SIMULATED_REPLAY';

export interface FeedHealthMeta {
  readonly state: FeedHealthState;
  readonly labelFa: string;
  readonly shape: 'circle' | 'triangle' | 'diamond' | 'square' | 'hexagon' | 'cross' | 'ring';
  readonly isLockedOut: boolean;
  readonly tone: 'bullish' | 'warning' | 'bearish' | 'info' | 'freeze';
}

export const FEED_HEALTH_META: Readonly<Record<FeedHealthState, FeedHealthMeta>> = Object.freeze({
  HEALTHY: Object.freeze({
    state: 'HEALTHY',
    labelFa: 'فید پایدار',
    shape: 'circle',
    isLockedOut: false,
    tone: 'bullish',
  }),
  DEGRADED: Object.freeze({
    state: 'DEGRADED',
    labelFa: 'کیفیت کاهش‌یافته',
    shape: 'triangle',
    isLockedOut: false,
    tone: 'warning',
  }),
  LATENCY_SPIKE: Object.freeze({
    state: 'LATENCY_SPIKE',
    labelFa: 'جهش تأخیر',
    shape: 'diamond',
    isLockedOut: false,
    tone: 'warning',
  }),
  RECONNECTING: Object.freeze({
    state: 'RECONNECTING',
    labelFa: 'تلاش اتصال مجدد',
    shape: 'ring',
    isLockedOut: false,
    tone: 'info',
  }),
  STALE: Object.freeze({
    state: 'STALE',
    labelFa: 'داده منقضی (قفل سخت)',
    shape: 'hexagon',
    isLockedOut: true,
    tone: 'freeze',
  }),
  DEAD: Object.freeze({
    state: 'DEAD',
    labelFa: 'قطع کامل فید (قفل سخت)',
    shape: 'cross',
    isLockedOut: true,
    tone: 'bearish',
  }),
  SIMULATED_REPLAY: Object.freeze({
    state: 'SIMULATED_REPLAY',
    labelFa: 'بازپخش ساختاریافته',
    shape: 'square',
    isLockedOut: false,
    tone: 'info',
  }),
});

/** Flight Mode Annunciator (FMA) */
export type FmaMode = 'SEARCH' | 'LOCKED' | 'TWS';

/** Harel Statechart Primary States */
export type PayamStatechartNode =
  | 'BOOT'
  | 'SCANNING'
  | 'SETUP_DETECTED'
  | 'COUNCIL_DELIBERATING'
  | 'SIGNAL_LOCKED'
  | 'IN_POSITION'
  | 'POSITION_UNKNOWN_FREEZE'
  | 'CIRCUIT_BREAKER_HALT'
  | 'FEED_LOCKOUT';

export type MarketRegime =
  | 'TRENDING_EXPANSION'
  | 'LIQUIDITY_REVERSAL'
  | 'RANGE_COMPRESSION'
  | 'HIGH_VOL_SHOCK';

export type TradeSide = 'LONG' | 'SHORT';

export type InvariantId = 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6' | 'I7';

export interface CandleBar {
  readonly time: number; // Unix seconds (ascending)
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface PoiAnchor {
  readonly id: string;
  readonly labelFa: string;
  readonly kind: 'FVG' | 'OB' | 'SWEEP';
  readonly priceTop: number;
  readonly priceBottom: number;
  readonly startTime: number;
  readonly endTime: number;
}

/** B13 Issued Regime Certificate (I6) */
export interface RegimeCertificate {
  readonly certId: string;
  readonly issuedBy: 'B13';
  readonly asset: AssetSymbol;
  readonly regime: MarketRegime;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly revoked: boolean;
  readonly signatureHash: string;
}

export interface PayamSignal {
  readonly signalId: string;
  readonly asset: AssetSymbol;
  readonly side: TradeSide;
  readonly entry: number;
  readonly stopLoss: number;
  readonly tp1: number;
  readonly tp2: number;
  readonly invalidationPrice: number;
  readonly rrRatio: number;
  readonly recommendedRiskPct: number;
  readonly confidenceScore: number; // 0..100 calibrated deterministic score
  readonly regime: MarketRegime;
  readonly certId: string;
  readonly certificate: RegimeCertificate;
  readonly rationaleFa: readonly [string, string, string, string];
  readonly poiAnchors: readonly PoiAnchor[]; // Max 2 POI anchors
  readonly createdAt: number;
  readonly llmRiskMultiplierApplied: number; // Always in (0, 1] per I1
  readonly llmDegraded: boolean;
  readonly llmDegradeReason?: string;
}

export type PositionStatus = 'OPEN' | 'PARTIAL_TP1' | 'UNKNOWN' | 'CLOSED';

export interface OpenPosition {
  readonly positionId: string;
  readonly asset: AssetSymbol;
  readonly side: TradeSide;
  readonly entryPrice: number;
  readonly initialStopLoss: number;
  readonly currentStopLoss: number;
  readonly tp1: number;
  readonly tp2: number;
  readonly invalidationPrice: number;
  readonly remainingSizePct: number; // 100 or 50
  readonly riskPct: number;
  readonly certId: string;
  readonly openedAt: number;
  readonly brokerSlConfirmed: boolean;
  readonly brokerTpConfirmed: boolean;
  readonly status: PositionStatus;
  readonly stateConfidence: number; // 0..1; decays below 0.72 -> I4 UNKNOWN FREEZE
  readonly lastReconciledAt: number;
  readonly slRatchetCount: number;
  readonly directiveFa: string;
}

/** 38-Agent Council Types */
export type CouncilPlane = 'A' | 'B' | 'C';

export type AgentVerdict = 'APPROVE' | 'CAUTION' | 'REDUCE_RISK' | 'VETO' | 'STANDBY' | 'DEGRADED';

export interface AgentDefinition {
  readonly id: string; // A1..A12, B1..B14, C1..C12
  readonly plane: CouncilPlane;
  readonly code: string;
  readonly nameFa: string;
  readonly roleFa: string;
  readonly isOnlineLlm: boolean;
  readonly invariantRef?: InvariantId;
}

export interface AgentEvaluation {
  readonly id: string;
  readonly plane: CouncilPlane;
  readonly nameFa: string;
  readonly verdict: AgentVerdict;
  readonly score: number; // 0..1
  readonly latencyMs: number;
  readonly noteFa: string;
  readonly isOnlineLlm: boolean;
  readonly invariantRef?: InvariantId;
  readonly vetoTriggered: boolean;
}

export interface CouncilDeliberation {
  readonly deliberationId: string;
  readonly asset: AssetSymbol;
  readonly timestamp: number;
  readonly regime: MarketRegime;
  readonly agents: readonly AgentEvaluation[];
  readonly consensusApproveCount: number;
  readonly vetoCount: number;
  readonly vetoAgentIds: readonly string[];
  readonly llmMode: 'ONLINE_GEMINI' | 'DETERMINISTIC_FALLBACK';
  readonly llmDegradeReason?: string;
  readonly signal: PayamSignal | null;
  readonly noTradeReasonFa?: string;
  readonly durationMs: number;
}

/** PayamKernel Risk Configuration (Protected by I3) */
export interface KernelRiskConfig {
  readonly maxRiskPerTradePct: number;
  readonly maxDailyDrawdownR: number;
  readonly minRewardToRisk: number;
  readonly maxConcurrentPositions: number;
  readonly unknownConfidenceThreshold: number;
  readonly circuitBreakerTripped: boolean;
  readonly dailyRealizedR: number;
}

export interface BudgetState {
  readonly tokensUsedSession: number;
  readonly tokenCapSession: number;
  readonly callsThisHour: number;
  readonly hourlyCallCap: number;
  readonly exhausted: boolean;
}

/** Structured LLM Head Output (I5 Firewall validated) */
export interface LlmHeadValidatedOutput {
  readonly headId: 'A7' | 'A8' | 'A11';
  readonly riskAction: 'ALLOW' | 'REDUCE_RISK' | 'TIGHTEN_SL' | 'VETO';
  readonly riskMultiplier: number; // Clamped to [0.25, 1.0] per I1
  readonly slTightenFraction: number; // [0, 0.35] — only moves SL closer to entry
  readonly macroEventHazard: boolean;
  readonly structuralInvalidationFlag: boolean;
  readonly summaryFa: string; // Display-only text; never enters deterministic math (I5)
  readonly latencyMs: number;
}

/** Append-only Audit Ledger Entry */
export interface LedgerEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly asset: AssetSymbol;
  readonly category:
    | 'COUNCIL_DECISION'
    | 'CERT_ISSUED'
    | 'INVARIANT_GUARD'
    | 'POSITION_OPEN'
    | 'SL_RATCHET'
    | 'PARTIAL_CLOSE'
    | 'POSITION_CLOSE'
    | 'RECONCILE_I4'
    | 'FEED_STATE'
    | 'LLM_DEGRADATION';
  readonly invariantRef?: InvariantId;
  readonly severity: 'INFO' | 'WARN' | 'BLOCK';
  readonly summaryFa: string;
  readonly numericPayload?: Record<string, number | string | boolean>;
}

export type LensViewMode = 'CHART' | 'ARENA' | 'SPLIT';

export interface AssetRuntimeSnapshot {
  readonly symbol: AssetSymbol;
  readonly lastPrice: number;
  readonly bid: number;
  readonly ask: number;
  readonly spread: number;
  readonly changePct: number;
  readonly atr: number;
  readonly regime: MarketRegime;
  readonly fmaMode: FmaMode;
  readonly stateNode: PayamStatechartNode;
  readonly signal: PayamSignal | null;
  readonly position: OpenPosition | null;
  readonly lastDeliberation: CouncilDeliberation | null;
  readonly lastTickAt: number;
}
