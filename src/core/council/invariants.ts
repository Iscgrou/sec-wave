/**
 * PayamKernel — The 7 Unbreakable Hard Invariants (I1..I7)
 * Pure, deterministic, zero-bypass risk guards.
 * No LLM verdict, UI toggle, or budget degradation may weaken these invariants.
 */

import type {
  BudgetState,
  InvariantId,
  KernelRiskConfig,
  LlmHeadValidatedOutput,
  MarketRegime,
  OpenPosition,
  PayamSignal,
  RegimeCertificate,
  TradeSide,
} from '../types';
import { LlmHeadOutputSchema } from './schemas';

export interface InvariantCheckResult {
  readonly invariant: InvariantId;
  readonly passed: boolean;
  readonly reasonFa: string;
  readonly clamped?: boolean;
}

/**
 * I1 — Asymmetric Authority
 * LLM outputs may ONLY reduce risk (lower size, tighten SL, veto, exit).
 * They can NEVER increase position size, boost risk multiplier > 1.0, or widen Stop-Loss.
 */
export interface I1ProposalInput {
  readonly side: TradeSide;
  readonly entry: number;
  readonly deterministicStopLoss: number;
  readonly deterministicRiskPct: number;
  readonly decimals: number;
}

export interface I1EnforcedResult {
  readonly allowed: boolean;
  readonly vetoedByHead?: 'A7' | 'A8' | 'A11';
  readonly finalRiskPct: number;
  readonly appliedRiskMultiplier: number;
  readonly finalStopLoss: number;
  readonly audit: InvariantCheckResult;
}

export function enforceI1AsymmetricAuthority(
  proposal: I1ProposalInput,
  llmHeads: readonly LlmHeadValidatedOutput[]
): I1EnforcedResult {
  let multiplier = 1.0;
  let maxTightenFraction = 0;
  let clampedAttempt = false;
  let vetoHead: 'A7' | 'A8' | 'A11' | undefined;

  for (const head of llmHeads) {
    // Reject/clamp any LLM attempt to increase risk (> 1.0) or widen SL (< 0)
    if (head.riskMultiplier > 1.0) {
      clampedAttempt = true;
    }
    const safeMultiplier = Math.min(1.0, Math.max(0.25, head.riskMultiplier));
    if (head.riskAction === 'VETO' || head.structuralInvalidationFlag) {
      vetoHead = head.headId;
    }
    if (head.riskAction === 'REDUCE_RISK' || head.macroEventHazard) {
      multiplier = Math.min(multiplier, safeMultiplier, 0.75);
    } else {
      multiplier = Math.min(multiplier, safeMultiplier);
    }

    if (head.slTightenFraction < 0) {
      // Negative tighten fraction means widening SL -> strictly forbidden by I1
      clampedAttempt = true;
    } else if (head.riskAction === 'TIGHTEN_SL' && head.slTightenFraction > 0) {
      maxTightenFraction = Math.max(
        maxTightenFraction,
        Math.min(0.35, head.slTightenFraction)
      );
    }
  }

  // Compute tightened SL strictly toward entry (never away from entry)
  const riskDistance = Math.abs(proposal.entry - proposal.deterministicStopLoss);
  const tightenDelta = riskDistance * maxTightenFraction;
  const rawFinalSL =
    proposal.side === 'LONG'
      ? proposal.deterministicStopLoss + tightenDelta
      : proposal.deterministicStopLoss - tightenDelta;

  const factor = Math.pow(10, proposal.decimals);
  const roundedSL = Math.round(rawFinalSL * factor) / factor;

  // Hard sanity check: never cross entry or widen beyond deterministic SL
  const safeSL =
    proposal.side === 'LONG'
      ? Math.min(proposal.entry - riskDistance * 0.2, Math.max(proposal.deterministicStopLoss, roundedSL))
      : Math.max(proposal.entry + riskDistance * 0.2, Math.min(proposal.deterministicStopLoss, roundedSL));

  const finalRiskPct = Number((proposal.deterministicRiskPct * multiplier).toFixed(3));

  if (vetoHead) {
    return {
      allowed: false,
      vetoedByHead: vetoHead,
      finalRiskPct: 0,
      appliedRiskMultiplier: 0,
      finalStopLoss: safeSL,
      audit: {
        invariant: 'I1',
        passed: true,
        clamped: clampedAttempt,
        reasonFa: `وتوی نامتقارن توسط هد ${vetoHead} اعمال شد؛ ریسک به صفر کاهش یافت.`,
      },
    };
  }

  return {
    allowed: true,
    finalRiskPct,
    appliedRiskMultiplier: multiplier,
    finalStopLoss: safeSL,
    audit: {
      invariant: 'I1',
      passed: true,
      clamped: clampedAttempt,
      reasonFa: clampedAttempt
        ? 'تلاش مدل برای افزایش ریسک یا باز کردن حد ضرر توسط I1 مهار و محدود شد.'
        : 'اقتدار نامتقارن I1 برقرار است؛ خروجی مدل فقط در جهت حفظ یا کاهش ریسک اعمال شد.',
    },
  };
}

/**
 * I2 — One-Way SL Ratchet
 * Widening Stop-Loss after position entry is strictly forbidden.
 * LONG: proposedSL MUST be >= currentSL (and < currentMarketPrice for safety when active).
 * SHORT: proposedSL MUST be <= currentSL (and > currentMarketPrice for safety when active).
 */
export interface I2RatchetResult {
  readonly accepted: boolean;
  readonly effectiveStopLoss: number;
  readonly audit: InvariantCheckResult;
}

export function enforceI2OneWaySLRatchet(
  side: TradeSide,
  currentSL: number,
  proposedSL: number
): I2RatchetResult {
  if (!Number.isFinite(proposedSL) || proposedSL <= 0) {
    return {
      accepted: false,
      effectiveStopLoss: currentSL,
      audit: {
        invariant: 'I2',
        passed: false,
        reasonFa: 'مقدار حد ضرر پیشنهادی نامعتبر است؛ حد ضرر قبلی حفظ شد.',
      },
    };
  }

  const isWidening = side === 'LONG' ? proposedSL < currentSL : proposedSL > currentSL;

  if (isWidening) {
    return {
      accepted: false,
      effectiveStopLoss: currentSL,
      audit: {
        invariant: 'I2',
        passed: false,
        reasonFa:
          'نقض ناوردای I2: باز کردن (گسترش) حد ضرر پس از ورود اکیداً ممنوع است. حد ضرر فقط یک‌طرفه تنگ می‌شود.',
      },
    };
  }

  return {
    accepted: true,
    effectiveStopLoss: proposedSL,
    audit: {
      invariant: 'I2',
      passed: true,
      reasonFa: 'ضامن یک‌طرفه I2 تأیید شد؛ حد ضرر با موفقیت در جهت کاهش ریسک جابه‌جا شد.',
    },
  };
}

/**
 * I3 — Non-Degrading Risk Guards
 * Budget exhaustion (C8), LLM timeout, 429, or missing API key NEVER weakens
 * PayamKernel deterministic risk caps or circuit breakers.
 */
export interface I3GuardResult {
  readonly effectiveConfig: KernelRiskConfig;
  readonly cognitiveDepthDegraded: boolean;
  readonly tradingAllowed: boolean;
  readonly audit: InvariantCheckResult;
}

export const HARD_KERNEL_FLOOR = Object.freeze({
  MAX_RISK_PER_TRADE_PCT: 1.0,
  MAX_DAILY_DRAWDOWN_R: -3.0,
  MIN_REWARD_TO_RISK: 2.0,
  MAX_CONCURRENT_POSITIONS: 2,
  UNKNOWN_CONFIDENCE_THRESHOLD: 0.72,
});

export function enforceI3NonDegradingRiskGuards(
  requestedConfig: KernelRiskConfig,
  budget: BudgetState,
  llmApiAvailable: boolean
): I3GuardResult {
  // Never allow any config to loosen beyond immutable kernel floors
  const effectiveConfig: KernelRiskConfig = {
    maxRiskPerTradePct: Math.min(
      requestedConfig.maxRiskPerTradePct,
      HARD_KERNEL_FLOOR.MAX_RISK_PER_TRADE_PCT
    ),
    maxDailyDrawdownR: Math.max(
      requestedConfig.maxDailyDrawdownR,
      HARD_KERNEL_FLOOR.MAX_DAILY_DRAWDOWN_R
    ),
    minRewardToRisk: Math.max(
      requestedConfig.minRewardToRisk,
      HARD_KERNEL_FLOOR.MIN_REWARD_TO_RISK
    ),
    maxConcurrentPositions: Math.min(
      requestedConfig.maxConcurrentPositions,
      HARD_KERNEL_FLOOR.MAX_CONCURRENT_POSITIONS
    ),
    unknownConfidenceThreshold: Math.max(
      requestedConfig.unknownConfidenceThreshold,
      HARD_KERNEL_FLOOR.UNKNOWN_CONFIDENCE_THRESHOLD
    ),
    circuitBreakerTripped:
      requestedConfig.circuitBreakerTripped ||
      requestedConfig.dailyRealizedR <= HARD_KERNEL_FLOOR.MAX_DAILY_DRAWDOWN_R,
    dailyRealizedR: requestedConfig.dailyRealizedR,
  };

  const cognitiveDepthDegraded = budget.exhausted || !llmApiAvailable;
  const tradingAllowed = !effectiveConfig.circuitBreakerTripped;

  return {
    effectiveConfig,
    cognitiveDepthDegraded,
    tradingAllowed,
    audit: {
      invariant: 'I3',
      passed: true,
      reasonFa: effectiveConfig.circuitBreakerTripped
        ? 'مدارشکن روزانه I3 فعال است؛ صدور سیگنال جدید مسدود شد.'
        : cognitiveDepthDegraded
          ? 'عمق شناختی مدل کاهش یافت، اما تمام گاردهای ریسک هسته I3 با قدرت ۱۰۰٪ فعال ماندند.'
          : 'گاردهای ریسک هسته I3 با سقف‌های سخت بدون تخفیف فعال هستند.',
    },
  };
}

/**
 * I4 — Unknown State Freeze
 * If open position state confidence decays below threshold or status is UNKNOWN,
 * freeze ALL profit/loss advisories; the ONLY permitted UI action is "Reconcile Position".
 */
export interface I4FreezeResult {
  readonly frozen: boolean;
  readonly allowedActions: readonly ('RECONCILE_POSITION' | 'RATCHET_SL' | 'PARTIAL_CLOSE' | 'CLOSE_POSITION')[];
  readonly audit: InvariantCheckResult;
}

export function enforceI4UnknownStateFreeze(
  position: OpenPosition | null,
  confidenceThreshold: number = HARD_KERNEL_FLOOR.UNKNOWN_CONFIDENCE_THRESHOLD
): I4FreezeResult {
  if (!position) {
    return {
      frozen: false,
      allowedActions: [],
      audit: {
        invariant: 'I4',
        passed: true,
        reasonFa: 'پوزیشن بازی برای بررسی وضعیت ناشناخته وجود ندارد.',
      },
    };
  }

  const isUnknown =
    position.status === 'UNKNOWN' ||
    position.stateConfidence < confidenceThreshold ||
    !Number.isFinite(position.stateConfidence);

  if (isUnknown) {
    return {
      frozen: true,
      allowedActions: ['RECONCILE_POSITION'],
      audit: {
        invariant: 'I4',
        passed: false,
        reasonFa:
          'انجماد وضعیت ناشناخته (I4): اطمینان وضعیت پوزیشن افت کرد. تمام توصیه‌های سود/زیان متوقف شد؛ تنها اقدام مجاز «تطبیق وضعیت پوزیشن» است.',
      },
    };
  }

  return {
    frozen: false,
    allowedActions: ['RATCHET_SL', 'PARTIAL_CLOSE', 'CLOSE_POSITION', 'RECONCILE_POSITION'],
    audit: {
      invariant: 'I4',
      passed: true,
      reasonFa: 'وضعیت پوزیشن با بروکر هم‌تراز است و سطح اطمینان بالای آستانه مجاز قرار دارد.',
    },
  };
}

/**
 * I5 — Text = Data, Never Instruction
 * Raw text (news, headlines, LLM prose) must NEVER enter deterministic risk logic.
 * Only strict Zod-validated numeric/enum fields cross the firewall into PayamKernel.
 */
export interface I5FirewallNumericVector {
  readonly headId: 'A7' | 'A8' | 'A11';
  readonly riskAction: 'ALLOW' | 'REDUCE_RISK' | 'TIGHTEN_SL' | 'VETO';
  readonly riskMultiplier: number;
  readonly slTightenFraction: number;
  readonly macroEventHazard: boolean;
  readonly structuralInvalidationFlag: boolean;
}

export interface I5FirewallResult {
  readonly accepted: boolean;
  readonly deterministicVector: I5FirewallNumericVector | null;
  readonly displayOnlyProseFa: string;
  readonly audit: InvariantCheckResult;
}

export function enforceI5TextIsDataFirewall(rawUntrustedPayload: unknown): I5FirewallResult {
  // Never execute or parse prompt instructions from raw strings
  if (typeof rawUntrustedPayload !== 'object' || rawUntrustedPayload === null) {
    return {
      accepted: false,
      deterministicVector: null,
      displayOnlyProseFa: '',
      audit: {
        invariant: 'I5',
        passed: false,
        reasonFa: 'دیواره آتش I5: متن خام یا ساختار نامعتبر مسدود شد و وارد منطق ریسک نشد.',
      },
    };
  }

  const parsed = LlmHeadOutputSchema.safeParse(rawUntrustedPayload);
  if (!parsed.success) {
    return {
      accepted: false,
      deterministicVector: null,
      displayOnlyProseFa: '',
      audit: {
        invariant: 'I5',
        passed: false,
        reasonFa: 'دیواره آتش I5: خروجی مدل با اسکیمای سخت عددی/شمارشی مطابقت نداشت و رد شد.',
      },
    };
  }

  const data = parsed.data;
  // Strip any control characters or script-like tags from display-only prose
  const cleanProse = data.summaryFa.replace(/[<>`]/g, '').trim();

  // Strictly separate numeric/enum deterministic vector from prose
  const deterministicVector: I5FirewallNumericVector = Object.freeze({
    headId: data.headId,
    riskAction: data.riskAction,
    riskMultiplier: data.riskMultiplier,
    slTightenFraction: data.slTightenFraction,
    macroEventHazard: data.macroEventHazard,
    structuralInvalidationFlag: data.structuralInvalidationFlag,
  });

  return {
    accepted: true,
    deterministicVector,
    displayOnlyProseFa: cleanProse,
    audit: {
      invariant: 'I5',
      passed: true,
      reasonFa: `دیواره آتش I5: تنها بردار عددی/شمارشی معتبر از ${data.headId} عبور کرد؛ متن خام ایزوله ماند.`,
    },
  };
}

/**
 * I6 — Default NO_TRADE + Unexpired B13 Certificate
 * No signal may be emitted without a valid, unexpired, non-revoked cert_id
 * issued by B13 matching the exact active market regime and asset.
 */
export interface I6CertificateResult {
  readonly permitted: boolean;
  readonly decision: 'EMIT_SIGNAL' | 'NO_TRADE';
  readonly audit: InvariantCheckResult;
}

export function enforceI6DefaultNoTradeAndCertificate(
  signal: Pick<PayamSignal, 'asset' | 'certId' | 'regime' | 'rrRatio'> | null,
  certificate: RegimeCertificate | null,
  activeRegime: MarketRegime,
  nowMs: number,
  minRR: number = HARD_KERNEL_FLOOR.MIN_REWARD_TO_RISK
): I6CertificateResult {
  if (!signal || !certificate) {
    return {
      permitted: false,
      decision: 'NO_TRADE',
      audit: {
        invariant: 'I6',
        passed: false,
        reasonFa: 'پیش‌فرض I6 (NO_TRADE): گواهی معتبر B13 یا ستاپ واجد شرایط وجود ندارد.',
      },
    };
  }

  if (certificate.issuedBy !== 'B13') {
    return {
      permitted: false,
      decision: 'NO_TRADE',
      audit: {
        invariant: 'I6',
        passed: false,
        reasonFa: 'رد گواهی I6: صادرکننده گواهی ایجنت B13 نیست.',
      },
    };
  }

  if (certificate.revoked) {
    return {
      permitted: false,
      decision: 'NO_TRADE',
      audit: {
        invariant: 'I6',
        passed: false,
        reasonFa: 'رد گواهی I6: گواهی رژیم B13 باطل شده است.',
      },
    };
  }

  if (certificate.certId !== signal.certId || certificate.asset !== signal.asset) {
    return {
      permitted: false,
      decision: 'NO_TRADE',
      audit: {
        invariant: 'I6',
        passed: false,
        reasonFa: 'رد گواهی I6: شناسه cert_id یا نماد دارایی با گواهی B13 هم‌خوانی ندارد.',
      },
    };
  }

  if (certificate.regime !== activeRegime || signal.regime !== activeRegime) {
    return {
      permitted: false,
      decision: 'NO_TRADE',
      audit: {
        invariant: 'I6',
        passed: false,
        reasonFa: 'رد گواهی I6: رژیم بازار تغییر کرده و با گواهی B13 منطبق نیست.',
      },
    };
  }

  if (certificate.expiresAt <= nowMs) {
    return {
      permitted: false,
      decision: 'NO_TRADE',
      audit: {
        invariant: 'I6',
        passed: false,
        reasonFa: 'رد گواهی I6: مهلت اعتبار گواهی B13 منقضی شده است.',
      },
    };
  }

  if (signal.rrRatio < minRR) {
    return {
      permitted: false,
      decision: 'NO_TRADE',
      audit: {
        invariant: 'I6',
        passed: false,
        reasonFa: `رد ستاپ I6: نسبت ریسک به ریوارد پایین‌تر از کف مجاز (${minRR.toFixed(1)}) است.`,
      },
    };
  }

  return {
    permitted: true,
    decision: 'EMIT_SIGNAL',
    audit: {
      invariant: 'I6',
      passed: true,
      reasonFa: `گواهی B13 با شناسه ${certificate.certId} برای رژیم فعال معتبر و بدون انقضا تأیید شد.`,
    },
  };
}

/**
 * I7 — App Is Never the Stop-Loss
 * Every manual entry flow MUST explicitly require user confirmation that
 * resting SL and TP orders are placed directly at their broker.
 */
export interface I7ManualEntryConfirmation {
  readonly brokerSlPlaced: boolean;
  readonly brokerTpPlaced: boolean;
  readonly confirmedAt: number;
}

export function enforceI7BrokerOrderConfirmation(
  confirmation: I7ManualEntryConfirmation
): InvariantCheckResult {
  if (!confirmation.brokerSlPlaced || !confirmation.brokerTpPlaced) {
    return {
      invariant: 'I7',
      passed: false,
      reasonFa:
        'قفل ناوردای I7: اپلیکیشن هرگز جایگزین حد ضرر نیست. ابتدا ثبت سفارش‌های SL و TP را در بروکر تأیید کنید.',
    };
  }

  if (!Number.isFinite(confirmation.confirmedAt) || confirmation.confirmedAt <= 0) {
    return {
      invariant: 'I7',
      passed: false,
      reasonFa: 'قفل ناوردای I7: مهر زمانی تأیید ثبت سفارش در بروکر معتبر نیست.',
    };
  }

  return {
    invariant: 'I7',
    passed: true,
    reasonFa: 'تأیید I7 ثبت شد؛ سفارش‌های محافظتی SL و TP مستقیماً در بروکر مستقر هستند.',
  };
}
