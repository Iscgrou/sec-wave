/**
 * ActionDock — 2-Column Adaptive Manual-Trader Co-Pilot Dock
 * ZERO broker auto-execution.
 * Strictly enforces:
 *   - Fail-Loudly hard lock on STALE / DEAD feeds
 *   - I4 Unknown State Freeze (ONLY "تطبیق وضعیت پوزیشن" permitted)
 *   - I6 Default NO_TRADE + live B13 Certificate TTL countdown
 *   - I7 Explicit Broker Resting SL/TP Confirmation before entering TWS
 *   - I2 One-Way SL Ratchet (blocks widening with loud invariant feedback)
 *   - Atomic sanitized ASCII numeric copy (hotkeys 1-4)
 */

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  ASSET_SPECS,
  FEED_HEALTH_META,
  type AssetRuntimeSnapshot,
  type FeedHealthState,
} from '../../core/types';
import { enforceI4UnknownStateFreeze } from '../../core/council/invariants';
import { computePositionMetrics } from '../../core/statechart/machine';
import {
  formatCountdownMs,
  formatPrice,
  formatRatio,
  formatRMultiple,
} from '../../core/utils/sanitize';
import type { PayamColorTokens } from '../theme/tokens';
import { LtrNum, SemanticShape } from './SemanticShape';

interface ActionDockProps {
  readonly snapshot: AssetRuntimeSnapshot;
  readonly feedHealth: FeedHealthState;
  readonly theme: PayamColorTokens;
  readonly councilBusy: boolean;
  readonly onlineLlmEnabled: boolean;
  readonly copiedKey: string | null;
  readonly feedbackNotice: { tone: 'info' | 'warn' | 'block'; textFa: string } | null;
  readonly onCopyPrice: (slotKey: '1' | '2' | '3' | '4', value: number) => void;
  readonly onRunDeliberation: () => void;
  readonly onEnterManualPosition: (brokerSlPlaced: boolean, brokerTpPlaced: boolean) => void;
  readonly onRatchetSl: (proposedSl: number) => void;
  readonly onPartialCloseTp1: () => void;
  readonly onClosePosition: () => void;
  readonly onTriggerUnknownFreeze: () => void;
  readonly onReconcilePosition: (payload: {
    brokerPrice: number;
    brokerStopLoss: number;
    remainingSizePct: number;
    isStillOpen: boolean;
  }) => void;
  readonly onRestoreFeed: () => void;
}

const REGIME_LABELS_FA: Readonly<Record<AssetRuntimeSnapshot['regime'], string>> = Object.freeze({
  TRENDING_EXPANSION: 'انبساط رونددار',
  LIQUIDITY_REVERSAL: 'برگشت پس از هانت نقدینگی',
  RANGE_COMPRESSION: 'فشردگی رنج (بدون جهت)',
  HIGH_VOL_SHOCK: 'شوک نوسانی بالا',
});

export function ActionDock({
  snapshot,
  feedHealth,
  theme,
  councilBusy,
  onlineLlmEnabled,
  copiedKey,
  feedbackNotice,
  onCopyPrice,
  onRunDeliberation,
  onEnterManualPosition,
  onRatchetSl,
  onPartialCloseTp1,
  onClosePosition,
  onTriggerUnknownFreeze,
  onReconcilePosition,
  onRestoreFeed,
}: ActionDockProps) {
  const spec = ASSET_SPECS[snapshot.symbol];
  const isFeedLocked = FEED_HEALTH_META[feedHealth].isLockedOut;
  const signal = snapshot.signal;
  const position = snapshot.position;

  // I7 Broker confirmation checkboxes (reset cleanly whenever signal changes)
  const [brokerSlChecked, setBrokerSlChecked] = useState(false);
  const [brokerTpChecked, setBrokerTpChecked] = useState(false);

  // I2 SL Ratchet input
  const [slInput, setSlInput] = useState('');

  // I4 Reconciliation form state
  const [recPrice, setRecPrice] = useState('');
  const [recSl, setRecSl] = useState('');
  const [recSize, setRecSize] = useState('100');
  const [recStillOpen, setRecStillOpen] = useState(true);

  // Live B13 Certificate TTL countdown (1s low-cost timer)
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!signal) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [signal]);

  useEffect(() => {
    setBrokerSlChecked(false);
    setBrokerTpChecked(false);
  }, [signal?.signalId]);

  useEffect(() => {
    if (position) {
      setSlInput(formatPrice(position.currentStopLoss, spec.decimals));
      setRecPrice(formatPrice(snapshot.lastPrice, spec.decimals));
      setRecSl(formatPrice(position.currentStopLoss, spec.decimals));
      setRecSize(String(position.remainingSizePct));
      setRecStillOpen(true);
    }
  }, [position?.positionId, position?.currentStopLoss, position?.status, spec.decimals, snapshot.lastPrice]);

  const i4Check = enforceI4UnknownStateFreeze(position);
  const certRemainingMs = signal ? Math.max(0, signal.certificate.expiresAt - nowMs) : 0;
  const certExpired = signal ? certRemainingMs <= 0 : true;

  return (
    <aside
      className="h-full min-h-0 flex flex-col border-s overflow-hidden"
      style={{
        backgroundColor: theme.bgSurface,
        borderColor: theme.borderHairline,
      }}
      aria-label="داک اقدام معاملاتی دستی"
      data-testid="action-dock"
    >
      {/* Dock Header: Asset Summary + Live Price */}
      <div
        className="px-3.5 py-2.5 border-b shrink-0 flex items-center justify-between gap-2"
        style={{ borderColor: theme.borderHairline }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold truncate" style={{ color: theme.textPrimary }}>
              {spec.nameFa}
            </h1>
            <LtrNum className="text-xs font-semibold" >
              <span style={{ color: theme.accentPrimary }}>{snapshot.symbol}</span>
            </LtrNum>
          </div>
          <div className="text-[11px] mt-0.5 flex items-center gap-2" style={{ color: theme.textMuted }}>
            <span>{REGIME_LABELS_FA[snapshot.regime]}</span>
            <span aria-hidden="true">·</span>
            <span>
              ATR <LtrNum>{formatPrice(snapshot.atr, spec.decimals)}</LtrNum>
            </span>
          </div>
        </div>

        <div className="text-end shrink-0">
          <div className="text-base font-bold" style={{ color: theme.textPrimary }}>
            <LtrNum>{formatPrice(snapshot.lastPrice, spec.decimals)}</LtrNum>
          </div>
          <div className="text-[11px]" style={{ color: theme.textMuted }}>
            اسپرد <LtrNum>{formatPrice(snapshot.spread, spec.decimals)}</LtrNum>
          </div>
        </div>
      </div>

      {/* Inline Kernel / Invariant Feedback Banner */}
      {feedbackNotice && (
        <div
          role="status"
          className="px-3.5 py-2 border-b text-xs persian-copy shrink-0 flex items-start gap-2"
          style={{
            backgroundColor: theme.bgElevated,
            borderColor:
              feedbackNotice.tone === 'block'
                ? theme.bearish
                : feedbackNotice.tone === 'warn'
                  ? theme.warning
                  : theme.accentPrimary,
            color:
              feedbackNotice.tone === 'block'
                ? theme.bearish
                : feedbackNotice.tone === 'warn'
                  ? theme.warning
                  : theme.textPrimary,
          }}
          data-testid="dock-feedback-banner"
        >
          <SemanticShape
            shape={feedbackNotice.tone === 'block' ? 'cross' : feedbackNotice.tone === 'warn' ? 'triangle' : 'circle'}
            color={
              feedbackNotice.tone === 'block'
                ? theme.bearish
                : feedbackNotice.tone === 'warn'
                  ? theme.warning
                  : theme.accentPrimary
            }
            size={10}
            className="mt-1"
          />
          <span>{feedbackNotice.textFa}</span>
        </div>
      )}

      {/* Dock Scrollable Interior (Bounded inside single-screen zero-scroll shell) */}
      <div className="flex-1 min-h-0 overflow-y-auto ps-scroll p-3.5 flex flex-col gap-3.5">
        {/* =================================================================
            PRIORITY 1: FAIL-LOUDLY FEED LOCKOUT (STALE / DEAD)
            ================================================================= */}
        {isFeedLocked ? (
          <section className="flex flex-col gap-3" data-testid="dock-feed-lockout">
            <div
              className="p-3.5 rounded border"
              style={{
                backgroundColor: theme.bgElevated,
                borderColor: feedHealth === 'DEAD' ? theme.bearish : theme.freeze,
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Lock className="w-4 h-4 shrink-0" style={{ color: theme.bearish }} aria-hidden="true" />
                <h2 className="text-sm font-bold" style={{ color: theme.textPrimary }}>
                  قفل سخت دکمه‌های اقدام ({FEED_HEALTH_META[feedHealth].labelFa})
                </h2>
              </div>
              <p className="text-xs persian-copy" style={{ color: theme.textSecondary }}>
                در وضعیت انقضا یا قطع فید، صدور سیگنال جدید، ثبت ورود دستی و ویرایش حد ضرر به‌طور کامل مسدود است تا از تصمیم بر پایه قیمت قدیمی جلوگیری شود.
              </p>
            </div>

            <button
              type="button"
              onClick={onRestoreFeed}
              className="w-full py-2.5 px-3 rounded text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer border transition-colors"
              style={{
                backgroundColor: theme.bgElevated,
                borderColor: theme.accentPrimary,
                color: theme.accentPrimary,
              }}
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>بازیابی اتصال فید پایدار</span>
            </button>
          </section>
        ) : position && i4Check.frozen ? (
          /* =================================================================
             PRIORITY 2: I4 UNKNOWN STATE FREEZE (ONLY RECONCILE PERMITTED)
             ================================================================= */
          <section className="flex flex-col gap-3" data-testid="dock-i4-freeze">
            <div
              className="p-3.5 rounded border"
              style={{
                backgroundColor: theme.bgElevated,
                borderColor: theme.freeze,
              }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <ShieldAlert className="w-4 h-4 shrink-0" style={{ color: theme.freeze }} aria-hidden="true" />
                <h2 className="text-sm font-bold" style={{ color: theme.freeze }}>
                  انجماد وضعیت ناشناخته (I4)
                </h2>
              </div>
              <p className="text-xs persian-copy" style={{ color: theme.textSecondary }}>
                اطمینان تطابق پوزیشن به <LtrNum className="font-semibold">{Math.round(position.stateConfidence * 100)}%</LtrNum> افت کرد. تمام توصیه‌های سود و زیان متوقف شد؛ تنها اقدام مجاز، تطبیق دستی با بروکر است.
              </p>
            </div>

            <form
              className="flex flex-col gap-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                onReconcilePosition({
                  brokerPrice: Number(recPrice),
                  brokerStopLoss: Number(recSl),
                  remainingSizePct: Number(recSize),
                  isStillOpen: recStillOpen,
                });
              }}
            >
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setRecStillOpen(true)}
                  className="flex-1 py-1.5 px-2 rounded border text-xs font-medium cursor-pointer"
                  style={{
                    backgroundColor: recStillOpen ? theme.bgElevated : 'transparent',
                    borderColor: recStillOpen ? theme.accentPrimary : theme.borderHairline,
                    color: recStillOpen ? theme.textPrimary : theme.textMuted,
                  }}
                >
                  پوزیشن در بروکر باز است
                </button>
                <button
                  type="button"
                  onClick={() => setRecStillOpen(false)}
                  className="flex-1 py-1.5 px-2 rounded border text-xs font-medium cursor-pointer"
                  style={{
                    backgroundColor: !recStillOpen ? theme.bgElevated : 'transparent',
                    borderColor: !recStillOpen ? theme.warning : theme.borderHairline,
                    color: !recStillOpen ? theme.textPrimary : theme.textMuted,
                  }}
                >
                  در بروکر بسته شده
                </button>
              </div>

              {recStillOpen && (
                <>
                  <label className="flex flex-col gap-1 text-xs" style={{ color: theme.textSecondary }}>
                    <span>قیمت فعلی در بروکر</span>
                    <input
                      type="number"
                      step="any"
                      required
                      value={recPrice}
                      onChange={(e) => setRecPrice(e.target.value)}
                      dir="ltr"
                      className="num-ltr px-2.5 py-2 rounded border text-xs"
                      style={{
                        backgroundColor: theme.bgCanvas,
                        borderColor: theme.borderStrong,
                        color: theme.textPrimary,
                      }}
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs" style={{ color: theme.textSecondary }}>
                    <span>حد ضرر (SL) مستقر در بروکر</span>
                    <input
                      type="number"
                      step="any"
                      required
                      value={recSl}
                      onChange={(e) => setRecSl(e.target.value)}
                      dir="ltr"
                      className="num-ltr px-2.5 py-2 rounded border text-xs"
                      style={{
                        backgroundColor: theme.bgCanvas,
                        borderColor: theme.borderStrong,
                        color: theme.textPrimary,
                      }}
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs" style={{ color: theme.textSecondary }}>
                    <span>حجم باقی‌مانده (%)</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      required
                      value={recSize}
                      onChange={(e) => setRecSize(e.target.value)}
                      dir="ltr"
                      className="num-ltr px-2.5 py-2 rounded border text-xs"
                      style={{
                        backgroundColor: theme.bgCanvas,
                        borderColor: theme.borderStrong,
                        color: theme.textPrimary,
                      }}
                    />
                  </label>
                </>
              )}

              <button
                type="submit"
                className="w-full py-2.5 px-3 rounded text-xs font-bold cursor-pointer transition-colors"
                style={{
                  backgroundColor: theme.freeze,
                  color: '#0F172A',
                }}
                data-testid="reconcile-submit-btn"
              >
                تطبیق وضعیت پوزیشن
              </button>
            </form>
          </section>
        ) : position ? (
          /* =================================================================
             PRIORITY 3: TWS MODE — ACTIVE MANUAL POSITION MANAGEMENT
             ================================================================= */
          (() => {
            const metrics = computePositionMetrics(position, snapshot.lastPrice);
            const rColor =
              metrics.currentR > 0
                ? theme.bullish
                : metrics.currentR < 0
                  ? theme.bearish
                  : theme.textSecondary;

            return (
              <section className="flex flex-col gap-3" data-testid="dock-tws-position">
                {/* Position Header */}
                <div
                  className="p-3 rounded border flex items-center justify-between"
                  style={{
                    backgroundColor: theme.bgElevated,
                    borderColor: theme.borderStrong,
                  }}
                >
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <SemanticShape
                        shape={position.side === 'LONG' ? 'triangle' : 'triangle-down'}
                        color={position.side === 'LONG' ? theme.bullish : theme.bearish}
                        size={10}
                      />
                      <span style={{ color: theme.textPrimary }}>
                        پوزیشن باز {position.side === 'LONG' ? 'خرید' : 'فروش'}
                      </span>
                    </div>
                    <div className="text-[11px] mt-1" style={{ color: theme.textMuted }}>
                      حجم فعال <LtrNum className="font-semibold">{position.remainingSizePct}%</LtrNum> · گواهی{' '}
                      <LtrNum>{position.certId}</LtrNum>
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="text-lg font-bold" style={{ color: rColor }}>
                      <LtrNum>{formatRMultiple(metrics.currentR)}</LtrNum>
                    </div>
                    <div className="text-[11px]" style={{ color: theme.textMuted }}>
                      ریسک <LtrNum>{position.riskPct}%</LtrNum>
                    </div>
                  </div>
                </div>

                {/* Active-Voice Institutional Persian Directive */}
                <div
                  className="p-3 rounded border text-xs persian-copy"
                  style={{
                    backgroundColor: theme.bgCanvas,
                    borderColor: theme.borderHairline,
                    color: theme.textPrimary,
                  }}
                >
                  <div className="text-[11px] font-semibold mb-1" style={{ color: theme.accentPrimary }}>
                    فرمان مدیریت پوزیشن (C9)
                  </div>
                  <p>{metrics.directiveFa}</p>
                </div>

                {/* Position Key Levels */}
                <div
                  className="grid grid-cols-2 gap-2 text-xs p-2.5 rounded border"
                  style={{
                    backgroundColor: theme.bgCanvas,
                    borderColor: theme.borderHairline,
                  }}
                >
                  <div>
                    <div className="text-[11px]" style={{ color: theme.textMuted }}>ورود دستی</div>
                    <LtrNum className="font-semibold">{formatPrice(position.entryPrice, spec.decimals)}</LtrNum>
                  </div>
                  <div>
                    <div className="text-[11px]" style={{ color: theme.textMuted }}>حد ضرر فعلی (SL)</div>
                    <LtrNum className="font-semibold" >
                      <span style={{ color: theme.bearish }}>
                        {formatPrice(position.currentStopLoss, spec.decimals)}
                      </span>
                    </LtrNum>
                  </div>
                  <div>
                    <div className="text-[11px]" style={{ color: theme.textMuted }}>هدف اول (TP1)</div>
                    <LtrNum className="font-semibold">{formatPrice(position.tp1, spec.decimals)}</LtrNum>
                  </div>
                  <div>
                    <div className="text-[11px]" style={{ color: theme.textMuted }}>هدف دوم (TP2)</div>
                    <LtrNum className="font-semibold">
                      <span style={{ color: theme.bullish }}>
                        {formatPrice(position.tp2, spec.decimals)}
                      </span>
                    </LtrNum>
                  </div>
                </div>

                {/* I2 One-Way SL Ratchet Control */}
                <div
                  className="p-3 rounded border flex flex-col gap-2"
                  style={{
                    backgroundColor: theme.bgElevated,
                    borderColor: theme.borderHairline,
                  }}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold" style={{ color: theme.textPrimary }}>
                      ضامن یک‌طرفه حد ضرر (I2)
                    </span>
                    <span className="text-[11px]" style={{ color: theme.textMuted }}>
                      دفعات تنگ‌شدن: <LtrNum>{position.slRatchetCount}</LtrNum>
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="any"
                      value={slInput}
                      onChange={(e) => setSlInput(e.target.value)}
                      dir="ltr"
                      aria-label="مقدار حد ضرر جدید برای ضامن یک‌طرفه I2"
                      className="num-ltr flex-1 min-w-0 px-2.5 py-1.5 rounded border text-xs"
                      style={{
                        backgroundColor: theme.bgCanvas,
                        borderColor: theme.borderStrong,
                        color: theme.textPrimary,
                      }}
                      data-testid="i2-sl-input"
                    />
                    <button
                      type="button"
                      onClick={() => onRatchetSl(Number(slInput))}
                      className="px-3 py-1.5 rounded text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer border"
                      style={{
                        backgroundColor: theme.bgCanvas,
                        borderColor: theme.accentPrimary,
                        color: theme.accentPrimary,
                      }}
                      data-testid="i2-sl-apply-btn"
                    >
                      اعمال SL
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRatchetSl(position.entryPrice)}
                    className="w-full py-1.5 px-2.5 rounded border text-xs font-medium cursor-pointer transition-colors"
                    style={{
                      borderColor: theme.borderStrong,
                      color: theme.textSecondary,
                    }}
                  >
                    ریسک‌فری ساختاری (انتقال SL به ورود)
                  </button>
                </div>

                {/* Partial TP1 & Close Position Controls */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={position.remainingSizePct <= 50}
                    onClick={onPartialCloseTp1}
                    className="py-2 px-2.5 rounded border text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: theme.bgElevated,
                      borderColor: theme.bullish,
                      color: theme.bullish,
                    }}
                  >
                    سیو سود پله‌ای ۵۰٪
                  </button>

                  <button
                    type="button"
                    onClick={onClosePosition}
                    className="py-2 px-2.5 rounded border text-xs font-semibold cursor-pointer"
                    style={{
                      backgroundColor: theme.bgElevated,
                      borderColor: theme.bearish,
                      color: theme.bearish,
                    }}
                  >
                    ثبت خروج کامل
                  </button>
                </div>

                {/* Live Verification Trigger for I4 Unknown State Freeze */}
                <button
                  type="button"
                  onClick={onTriggerUnknownFreeze}
                  className="w-full py-1.5 px-2.5 rounded border text-[11px] font-medium cursor-pointer transition-colors"
                  style={{
                    borderColor: theme.borderHairline,
                    color: theme.textMuted,
                  }}
                  data-testid="trigger-i4-freeze-btn"
                >
                  شبیه‌سازی افت اطمینان بروکر (آزمون انجماد I4)
                </button>
              </section>
            );
          })()
        ) : signal && !certExpired ? (
          /* =================================================================
             PRIORITY 4: LOCKED MODE — CERTIFIED SIGNAL WITH B13 CERT + I7 GATE
             ================================================================= */
          <section className="flex flex-col gap-3" data-testid="dock-locked-signal">
            {/* Signal Direction + B13 Certificate Strip */}
            <div
              className="p-3 rounded border"
              style={{
                backgroundColor: theme.bgElevated,
                borderColor: signal.side === 'LONG' ? theme.bullish : theme.bearish,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <SemanticShape
                    shape={signal.side === 'LONG' ? 'triangle' : 'triangle-down'}
                    color={signal.side === 'LONG' ? theme.bullish : theme.bearish}
                    size={12}
                  />
                  <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>
                    ستاپ {signal.side === 'LONG' ? 'خرید (LONG)' : 'فروش (SHORT)'}
                  </span>
                </div>
                <span className="text-xs font-semibold" style={{ color: theme.accentPrimary }}>
                  <LtrNum>{formatRatio(signal.rrRatio)}</LtrNum>
                </span>
              </div>

              <div
                className="mt-2 pt-2 border-t flex items-center justify-between text-[11px]"
                style={{ borderColor: theme.borderHairline, color: theme.textSecondary }}
              >
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" style={{ color: theme.bullish }} aria-hidden="true" />
                  <LtrNum>{signal.certId}</LtrNum>
                </span>
                <span>
                  انقضا <LtrNum className="font-semibold">{formatCountdownMs(certRemainingMs)}</LtrNum>
                </span>
              </div>
            </div>

            {/* 4 Atomic Sanitized Copyable Levels (Hotkeys 1-4) */}
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { key: '1' as const, label: 'ورود (Entry)', price: signal.entry, tone: theme.accentPrimary },
                  { key: '2' as const, label: 'حد ضرر (SL)', price: signal.stopLoss, tone: theme.bearish },
                  { key: '3' as const, label: 'حد سود ۱ (TP1)', price: signal.tp1, tone: theme.bullish },
                  { key: '4' as const, label: 'حد سود ۲ (TP2)', price: signal.tp2, tone: theme.bullish },
                ] as const
              ).map((item) => {
                const isCopied = copiedKey === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onCopyPrice(item.key, item.price)}
                    aria-label={`کپی عدد خام ${item.label} برابر ${formatPrice(item.price, spec.decimals)}`}
                    className="p-2 rounded border text-start transition-colors cursor-pointer group"
                    style={{
                      backgroundColor: theme.bgCanvas,
                      borderColor: isCopied ? theme.bullish : theme.borderHairline,
                    }}
                    data-testid={`copy-price-${item.key}`}
                  >
                    <div className="flex items-center justify-between text-[11px]" style={{ color: theme.textMuted }}>
                      <span>{item.label}</span>
                      <span className="flex items-center gap-1">
                        {isCopied ? (
                          <Check className="w-3 h-3" style={{ color: theme.bullish }} aria-hidden="true" />
                        ) : (
                          <Copy className="w-3 h-3 opacity-60 group-hover:opacity-100" aria-hidden="true" />
                        )}
                        <LtrNum>[{item.key}]</LtrNum>
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-bold" style={{ color: item.tone }}>
                      <LtrNum>{formatPrice(item.price, spec.decimals)}</LtrNum>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Sizing & Risk Summary (Unboxed Metadata) */}
            <div
              className="flex items-center justify-between text-xs px-1"
              style={{ color: theme.textSecondary }}
            >
              <span>
                ریسک مجاز: <LtrNum className="font-semibold">{signal.recommendedRiskPct}%</LtrNum>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                ضریب I1: <LtrNum className="font-semibold">×{signal.llmRiskMultiplierApplied.toFixed(2)}</LtrNum>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                سطح ابطال: <LtrNum>{formatPrice(signal.invalidationPrice, spec.decimals)}</LtrNum>
              </span>
            </div>

            {/* 4-Bullet Active-Voice Institutional Persian Rationale */}
            <div
              className="p-3 rounded border"
              style={{
                backgroundColor: theme.bgCanvas,
                borderColor: theme.borderHairline,
              }}
            >
              <div className="text-[11px] font-semibold mb-2" style={{ color: theme.textSecondary }}>
                استدلال ساختاری شورای ۳۸ ایجنت
              </div>
              <ul className="space-y-1.5 text-xs persian-copy" style={{ color: theme.textPrimary }}>
                {signal.rationaleFa.map((line, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: theme.accentPrimary }} />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* I7 Mandatory Manual Entry Gate (App Is Never the Stop-Loss) */}
            <div
              className="p-3 rounded border flex flex-col gap-2.5"
              style={{
                backgroundColor: theme.bgElevated,
                borderColor: theme.borderStrong,
              }}
              data-testid="i7-confirmation-gate"
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: theme.warning }}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>تأیید اجباری I7 (اپلیکیشن حد ضرر نیست)</span>
              </div>

              <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: theme.textPrimary }}>
                <input
                  type="checkbox"
                  checked={brokerSlChecked}
                  onChange={(e) => setBrokerSlChecked(e.target.checked)}
                  className="mt-0.5 accent-sky-400"
                  data-testid="i7-sl-checkbox"
                />
                <span>سفارش حد ضرر (SL) را مستقیماً در بروکر ثبت کردم.</span>
              </label>

              <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: theme.textPrimary }}>
                <input
                  type="checkbox"
                  checked={brokerTpChecked}
                  onChange={(e) => setBrokerTpChecked(e.target.checked)}
                  className="mt-0.5 accent-sky-400"
                  data-testid="i7-tp-checkbox"
                />
                <span>سفارش‌های حد سود (TP1/TP2) را در بروکر قرار دادم.</span>
              </label>

              <button
                type="button"
                disabled={!brokerSlChecked || !brokerTpChecked}
                onClick={() => onEnterManualPosition(brokerSlChecked, brokerTpChecked)}
                className="w-full py-2.5 px-3 rounded text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  backgroundColor:
                    brokerSlChecked && brokerTpChecked ? theme.accentPrimary : theme.bgMuted,
                  color: brokerSlChecked && brokerTpChecked ? '#0F172A' : theme.textMuted,
                }}
                data-testid="enter-manual-position-btn"
              >
                ثبت ورود دستی و انتقال به TWS
              </button>
            </div>
          </section>
        ) : (
          /* =================================================================
             PRIORITY 5: SEARCH MODE (I6 DEFAULT NO_TRADE)
             ================================================================= */
          <section className="flex flex-col gap-3" data-testid="dock-search-notrade">
            <div
              className="p-3.5 rounded border"
              style={{
                backgroundColor: theme.bgElevated,
                borderColor: theme.borderHairline,
              }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <SemanticShape shape="square" color={theme.textSecondary} size={10} />
                <h2 className="text-sm font-bold" style={{ color: theme.textPrimary }}>
                  وضعیت پیش‌فرض <LtrNum>NO_TRADE</LtrNum> (I6)
                </h2>
              </div>
              <p className="text-xs persian-copy" style={{ color: theme.textSecondary }}>
                {snapshot.lastDeliberation?.noTradeReasonFa ??
                  'تا زمان تکمیل هانت نقدینگی، شکست ساختار و صدور گواهی معتبر B13، سیستم هیچ سیگنالی صادر نمی‌کند.'}
              </p>
            </div>

            <div
              className="p-3 rounded border text-xs flex flex-col gap-1.5"
              style={{
                backgroundColor: theme.bgCanvas,
                borderColor: theme.borderHairline,
                color: theme.textSecondary,
              }}
            >
              <div className="flex items-center justify-between">
                <span>موتور شناختی آنلاین (A7/A8/A11)</span>
                <span style={{ color: onlineLlmEnabled ? theme.accentPrimary : theme.textMuted }}>
                  {onlineLlmEnabled ? 'فعال (درخواست‌محور)' : 'قطعی محلی (I3)'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>آرای تأیید آخرین بررسی</span>
                <LtrNum className="font-semibold">
                  {snapshot.lastDeliberation?.consensusApproveCount ?? 0}/38
                </LtrNum>
              </div>
              <div className="flex items-center justify-between">
                <span>تعداد وتوها</span>
                <LtrNum className="font-semibold">{snapshot.lastDeliberation?.vetoCount ?? 0}</LtrNum>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Persistent Dock Footer Action: Trigger Fresh 38-Agent Council Deliberation */}
      <div
        className="p-3 border-t shrink-0 flex items-center justify-between gap-2"
        style={{
          backgroundColor: theme.bgCanvas,
          borderColor: theme.borderHairline,
        }}
      >
        <button
          type="button"
          disabled={isFeedLocked || councilBusy}
          onClick={onRunDeliberation}
          className="w-full py-2 px-3 rounded border text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            backgroundColor: theme.bgElevated,
            borderColor: theme.borderStrong,
            color: theme.textPrimary,
          }}
          data-testid="run-council-btn"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${councilBusy ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>
            {councilBusy
              ? 'در حال هم‌اندیشی شورای ۳۸ ایجنت...'
              : 'ارزیابی مجدد شورای ۳۸ ایجنت'}
          </span>
        </button>
      </div>
    </aside>
  );
}
