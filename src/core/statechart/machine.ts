/**
 * PayamCore Harel Statechart — Deterministic Lifecycle Transitions
 * Manages SEARCH / LOCKED / TWS modes, I2 One-Way SL Ratchet,
 * I4 Unknown State Freeze & Reconciliation, I7 Broker SL/TP Gate,
 * and Fail-Loudly Feed Lockout (STALE / DEAD).
 */

import {
  FEED_HEALTH_META,
  type AssetSymbol,
  type FeedHealthState,
  type FmaMode,
  type OpenPosition,
  type PayamSignal,
  type PayamStatechartNode,
} from '../types';
import {
  enforceI2OneWaySLRatchet,
  enforceI4UnknownStateFreeze,
  enforceI6DefaultNoTradeAndCertificate,
  enforceI7BrokerOrderConfirmation,
  type I7ManualEntryConfirmation,
} from '../council/invariants';
import { ReconcilePositionInputSchema } from '../council/schemas';

export interface PositionMetrics {
  readonly currentR: number;
  readonly unrealizedPoints: number;
  readonly structuralBreakevenEligible: boolean;
  readonly partialTp1Reached: boolean;
  readonly directiveFa: string;
}

/**
 * Computes real-time R-multiple and active-voice Iranian institutional Persian directive
 * for an open manual position. Frozen cleanly when I4 is active.
 */
export function computePositionMetrics(
  position: OpenPosition,
  currentPrice: number
): PositionMetrics {
  const i4 = enforceI4UnknownStateFreeze(position);
  if (i4.frozen) {
    return {
      currentR: 0,
      unrealizedPoints: 0,
      structuralBreakevenEligible: false,
      partialTp1Reached: false,
      directiveFa: 'انجماد وضعیت ناشناخته (I4): تمام توصیه‌های سود و زیان متوقف شد. فقط تطبیق وضعیت پوزیشن مجاز است.',
    };
  }

  const initialRisk = Math.abs(position.entryPrice - position.initialStopLoss);
  const delta =
    position.side === 'LONG'
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;
  const currentR = initialRisk > 0 ? Number((delta / initialRisk).toFixed(2)) : 0;

  const partialTp1Reached =
    position.side === 'LONG' ? currentPrice >= position.tp1 : currentPrice <= position.tp1;
  const structuralBreakevenEligible =
    currentR >= 1.0 &&
    (position.side === 'LONG'
      ? position.currentStopLoss < position.entryPrice
      : position.currentStopLoss > position.entryPrice);

  let directiveFa = 'حفظ پوزیشن مطابق پلن؛ حد ضرر ساختاری در بروکر فعال بماند.';
  if (partialTp1Reached && position.remainingSizePct > 50) {
    directiveFa = 'هدف اول لمس شد؛ ۵۰٪ سیو سود پله‌ای انجام دهید و حد ضرر را به نقطه ورود منتقل کنید.';
  } else if (structuralBreakevenEligible) {
    directiveFa = 'سود از +1R عبور کرد؛ ریسک‌فری ساختاری را فعال و حد ضرر را در بروکر جابه‌جا کنید.';
  } else if (currentR <= -0.65) {
    directiveFa = 'قیمت نزدیک سطح ابطال است؛ هرگز حد ضرر را باز نکنید (I2) و به سفارش بروکر پایبند بمانید.';
  } else if (position.remainingSizePct <= 50) {
    directiveFa = 'پوزیشن سبک شد؛ بخش باقی‌مانده را تا هدف دوم (TP2) با تریل ساختاری همراهی کنید.';
  }

  return {
    currentR,
    unrealizedPoints: Number(delta.toFixed(4)),
    structuralBreakevenEligible,
    partialTp1Reached,
    directiveFa,
  };
}

/**
 * Derives the authoritative FMA mode & Harel Statechart node for an asset.
 */
export function deriveAssetState(
  feedHealth: FeedHealthState,
  signal: PayamSignal | null,
  position: OpenPosition | null,
  circuitBreakerTripped: boolean,
  nowMs: number
): { fmaMode: FmaMode; stateNode: PayamStatechartNode } {
  if (FEED_HEALTH_META[feedHealth].isLockedOut) {
    return {
      fmaMode: position ? 'TWS' : 'SEARCH',
      stateNode: 'FEED_LOCKOUT',
    };
  }

  if (position && position.status !== 'CLOSED') {
    const i4 = enforceI4UnknownStateFreeze(position);
    if (i4.frozen) {
      return { fmaMode: 'TWS', stateNode: 'POSITION_UNKNOWN_FREEZE' };
    }
    return { fmaMode: 'TWS', stateNode: 'IN_POSITION' };
  }

  if (circuitBreakerTripped) {
    return { fmaMode: 'SEARCH', stateNode: 'CIRCUIT_BREAKER_HALT' };
  }

  if (signal && signal.certificate.expiresAt > nowMs && !signal.certificate.revoked) {
    return { fmaMode: 'LOCKED', stateNode: 'SIGNAL_LOCKED' };
  }

  return { fmaMode: 'SEARCH', stateNode: 'SCANNING' };
}

/**
 * Opens a manual position in TWS mode ONLY if Feed is not locked out,
 * B13 certificate is unexpired (I6), and user explicitly confirmed
 * resting SL & TP orders at their broker (I7).
 */
export function transitionEnterManualPosition(params: {
  readonly feedHealth: FeedHealthState;
  readonly signal: PayamSignal | null;
  readonly activeRegime: PayamSignal['regime'];
  readonly confirmation: I7ManualEntryConfirmation;
  readonly nowMs: number;
}): { ok: true; position: OpenPosition } | { ok: false; reasonFa: string; invariant?: 'I6' | 'I7' } {
  if (FEED_HEALTH_META[params.feedHealth].isLockedOut) {
    return {
      ok: false,
      reasonFa: 'قفل سخت فید فعال است؛ تا بازگشت فید پایدار امکان ثبت ورود دستی وجود ندارد.',
    };
  }

  const i6 = enforceI6DefaultNoTradeAndCertificate(
    params.signal,
    params.signal?.certificate ?? null,
    params.activeRegime,
    params.nowMs
  );
  if (!i6.permitted || !params.signal) {
    return { ok: false, reasonFa: i6.audit.reasonFa, invariant: 'I6' };
  }

  const i7 = enforceI7BrokerOrderConfirmation(params.confirmation);
  if (!i7.passed) {
    return { ok: false, reasonFa: i7.reasonFa, invariant: 'I7' };
  }

  const position: OpenPosition = {
    positionId: `POS-${params.signal.asset}-${params.nowMs.toString(36).toUpperCase()}`,
    asset: params.signal.asset,
    side: params.signal.side,
    entryPrice: params.signal.entry,
    initialStopLoss: params.signal.stopLoss,
    currentStopLoss: params.signal.stopLoss,
    tp1: params.signal.tp1,
    tp2: params.signal.tp2,
    invalidationPrice: params.signal.invalidationPrice,
    remainingSizePct: 100,
    riskPct: params.signal.recommendedRiskPct,
    certId: params.signal.certId,
    openedAt: params.nowMs,
    brokerSlConfirmed: true,
    brokerTpConfirmed: true,
    status: 'OPEN',
    stateConfidence: 1.0,
    lastReconciledAt: params.nowMs,
    slRatchetCount: 0,
    directiveFa: 'پوزیشن ثبت شد؛ سفارش‌های محافظتی SL و TP در بروکر فعال هستند.',
  };

  return { ok: true, position };
}

/**
 * Applies a One-Way SL Ratchet (I2) while checking I4 freeze and feed lock.
 */
export function transitionRatchetStopLoss(
  position: OpenPosition,
  proposedSL: number,
  feedHealth: FeedHealthState
): { ok: true; position: OpenPosition; reasonFa: string } | { ok: false; reasonFa: string; invariant: 'I2' | 'I4' } {
  if (FEED_HEALTH_META[feedHealth].isLockedOut) {
    return {
      ok: false,
      reasonFa: 'فید قفل است؛ پیش از تغییر حد ضرر، وضعیت داده را بازیابی کنید.',
      invariant: 'I2',
    };
  }

  const i4 = enforceI4UnknownStateFreeze(position);
  if (i4.frozen) {
    return {
      ok: false,
      reasonFa: i4.audit.reasonFa,
      invariant: 'I4',
    };
  }

  const i2 = enforceI2OneWaySLRatchet(position.side, position.currentStopLoss, proposedSL);
  if (!i2.accepted) {
    return {
      ok: false,
      reasonFa: i2.audit.reasonFa,
      invariant: 'I2',
    };
  }

  return {
    ok: true,
    reasonFa: i2.audit.reasonFa,
    position: {
      ...position,
      currentStopLoss: i2.effectiveStopLoss,
      slRatchetCount: position.slRatchetCount + 1,
      directiveFa: 'حد ضرر یک‌طرفه تنگ شد؛ فراموش نکنید مقدار جدید را در بروکر نیز به‌روز کنید.',
    },
  };
}

/**
 * Triggers I4 Unknown State Freeze (e.g., after position confidence decay or broker drift).
 */
export function transitionTriggerUnknownFreeze(
  position: OpenPosition,
  decayedConfidence: number = 0.42
): OpenPosition {
  return {
    ...position,
    status: 'UNKNOWN',
    stateConfidence: Math.min(0.65, Math.max(0, decayedConfidence)),
    directiveFa:
      'انجماد وضعیت ناشناخته (I4): تمام توصیه‌های سود و زیان متوقف شد. فقط «تطبیق وضعیت پوزیشن» مجاز است.',
  };
}

/**
 * Reconciles an UNKNOWN frozen position back into verified TWS tracking or CLOSED.
 * Also enforces I2 if the trader attempts to enter a wider SL during reconciliation.
 */
export function transitionReconcilePosition(
  position: OpenPosition,
  rawInput: unknown,
  nowMs: number
):
  | { ok: true; position: OpenPosition | null; reasonFa: string }
  | { ok: false; reasonFa: string } {
  const parsed = ReconcilePositionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      reasonFa: 'ورودی‌های تطبیق پوزیشن نامعتبر هستند؛ اعداد صحیح و مثبت وارد کنید.',
    };
  }

  const { brokerStopLoss, remainingSizePct, isStillOpen } = parsed.data;
  if (!isStillOpen || remainingSizePct <= 0) {
    return {
      ok: true,
      position: null,
      reasonFa: 'تطبیق I4 تکمیل شد؛ بسته شدن پوزیشن در بروکر ثبت گردید و سیستم به حالت SEARCH برگشت.',
    };
  }

  // Enforce I2 even on reconciliation: warn/clamp if broker SL is wider than recorded SL
  const i2 = enforceI2OneWaySLRatchet(position.side, position.currentStopLoss, brokerStopLoss);
  const effectiveSL = i2.accepted ? brokerStopLoss : position.currentStopLoss;

  return {
    ok: true,
    reasonFa: i2.accepted
      ? 'تطبیق وضعیت I4 با موفقیت انجام شد؛ سطح اطمینان به ۱۰۰٪ بازگشت.'
      : 'تطبیق وضعیت I4 انجام شد؛ حد ضرر قبلی به‌دلیل ضامن یک‌طرفه I2 حفظ گردید.',
    position: {
      ...position,
      status: remainingSizePct < 100 ? 'PARTIAL_TP1' : 'OPEN',
      remainingSizePct,
      currentStopLoss: effectiveSL,
      stateConfidence: 1.0,
      lastReconciledAt: nowMs,
      directiveFa: 'وضعیت پوزیشن با بروکر تطبیق داده شد؛ پایش چرخه عمر از سر گرفته شد.',
    },
  };
}

/**
 * Helper to check if an open position exists across assets.
 */
export function countActivePositions(
  positions: Readonly<Record<AssetSymbol, OpenPosition | null>>
): number {
  let count = 0;
  for (const pos of Object.values(positions)) {
    if (pos && pos.status !== 'CLOSED') count += 1;
  }
  return count;
}
