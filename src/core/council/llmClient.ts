/**
 * Browser Client for Server-Side Gemini Council Heads (A7, A8, A11)
 * Enforces strict 12-second AbortController timeout and Zod validation.
 * Never imports @google/genai on the client; falls back cleanly to
 * 100% deterministic execution on timeout, 429, or C8 budget exhaustion (I3).
 */

import type { AssetSymbol, BudgetState, MarketRegime, TradeSide } from '../types';
import { CouncilLlmApiResponseSchema, type ValidatedLlmHead } from './schemas';

const CLIENT_TIMEOUT_MS = 12_000;

export interface CouncilLlmRequestPayload {
  readonly asset: AssetSymbol;
  readonly regime: MarketRegime;
  readonly side: TradeSide | null;
  readonly entry: number;
  readonly stopLoss: number;
  readonly tp1: number;
  readonly tp2: number;
  readonly rrRatio: number;
  readonly atr: number;
  readonly displacementRatio: number;
}

export interface CouncilLlmFetchResult {
  readonly status: 'OK' | 'DEGRADED';
  readonly heads: readonly ValidatedLlmHead[];
  readonly tokensEstimated: number;
  readonly reason?: string;
}

export async function requestOnlineLlmHeads(
  payload: CouncilLlmRequestPayload,
  budget: BudgetState
): Promise<CouncilLlmFetchResult> {
  if (budget.exhausted || budget.tokensUsedSession >= budget.tokenCapSession) {
    return {
      status: 'DEGRADED',
      heads: [],
      tokensEstimated: 0,
      reason: 'بودجه نشست C8 تکمیل شده است؛ عمق شناختی کاهش یافت و گاردهای I3 کامل فعال ماندند.',
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  try {
    const res = await fetch('/api/council/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (res.status === 429) {
      return {
        status: 'DEGRADED',
        heads: [],
        tokensEstimated: 0,
        reason: 'محدودیت نرخ (429)؛ اجرای قطعی بدون افت گاردهای I3 ادامه یافت.',
      };
    }

    if (!res.ok) {
      return {
        status: 'DEGRADED',
        heads: [],
        tokensEstimated: 0,
        reason: `پاسخ غیرمنتظره سرور (${res.status})؛ بازگشت ایمن به موتور قطعی I3.`,
      };
    }

    const raw = (await res.json()) as unknown;
    const parsed = CouncilLlmApiResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        status: 'DEGRADED',
        heads: [],
        tokensEstimated: 0,
        reason: 'دیواره آتش I5 پاسخ نامعتبر سرور را مسدود کرد؛ اجرای قطعی برقرار است.',
      };
    }

    return {
      status: parsed.data.status,
      heads: parsed.data.heads,
      tokensEstimated: parsed.data.tokensEstimated,
      reason: parsed.data.reason,
    };
  } catch (err: unknown) {
    const isAbort = (err as { name?: string })?.name === 'AbortError' || controller.signal.aborted;
    return {
      status: 'DEGRADED',
      heads: [],
      tokensEstimated: 0,
      reason: isAbort
        ? 'مهلت ۱۲ ثانیه‌ای (Timeout) منقضی شد؛ اجرای ۱۰۰٪ قطعی با گاردهای کامل I3.'
        : 'سرویس شناختی در دسترس نبود؛ اجرای ۱۰۰٪ قطعی فعال است.',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
