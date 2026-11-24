/**
 * GlassBoxDrawer — Layer-3 Institutional Audit, 38-Agent Matrix, PayamGates & Feed Simulator
 * Opened via hotkey `D` or TopPerceptionBar button. Never blocks the underlying cockpit when closed.
 */

import { useState } from 'react';
import { CheckCircle2, Download, Play, Shield, X, XCircle } from 'lucide-react';
import {
  FEED_HEALTH_META,
  type AssetRuntimeSnapshot,
  type BudgetState,
  type FeedHealthState,
  type LedgerEntry,
} from '../../core/types';
import type { BinaryTransportCapabilities } from '../../core/feed/transport';
import { runPayamGates, type PayamGateResult } from '../../core/gates/payamGates';
import type { PayamColorTokens } from '../theme/tokens';
import { LtrNum, SemanticShape } from './SemanticShape';

interface GlassBoxDrawerProps {
  readonly open: boolean;
  readonly snapshot: AssetRuntimeSnapshot;
  readonly theme: PayamColorTokens;
  readonly budget: BudgetState;
  readonly onlineLlmEnabled: boolean;
  readonly geminiServerReady: boolean;
  readonly feedHealth: FeedHealthState;
  readonly transportCaps: BinaryTransportCapabilities;
  readonly ledgerEntries: readonly LedgerEntry[];
  readonly bridgeUrl: string | null;
  readonly onClose: () => void;
  readonly onToggleOnlineLlm: () => void;
  readonly onSetFeedHealthOverride: (health: FeedHealthState | null) => void;
  readonly onConnectBridge: (url: string | null) => void;
  readonly onExportLedger: () => void;
}

type DrawerTab = 'COUNCIL' | 'GATES' | 'LEDGER' | 'FEED';

const ALL_FEED_STATES: readonly FeedHealthState[] = [
  'HEALTHY',
  'DEGRADED',
  'LATENCY_SPIKE',
  'RECONNECTING',
  'STALE',
  'DEAD',
  'SIMULATED_REPLAY',
];

export function GlassBoxDrawer({
  open,
  snapshot,
  theme,
  budget,
  onlineLlmEnabled,
  geminiServerReady,
  feedHealth,
  transportCaps,
  ledgerEntries,
  bridgeUrl,
  onClose,
  onToggleOnlineLlm,
  onSetFeedHealthOverride,
  onConnectBridge,
  onExportLedger,
}: GlassBoxDrawerProps) {
  const [activeTab, setActiveTab] = useState<DrawerTab>('COUNCIL');
  const [planeFilter, setPlaneFilter] = useState<'ALL' | 'A' | 'B' | 'C'>('ALL');
  const [gateResults, setGateResults] = useState<readonly PayamGateResult[] | null>(null);
  const [bridgeInput, setBridgeInput] = useState('ws://localhost:8765');

  if (!open) return null;

  const deliberation = snapshot.lastDeliberation;
  const filteredAgents = (deliberation?.agents ?? []).filter(
    (a) => planeFilter === 'ALL' || a.plane === planeFilter
  );

  const handleRunGates = () => {
    setGateResults(runPayamGates());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.56)' }}
      role="dialog"
      aria-modal="true"
      aria-label="کشوی شفافیت لایه ۳ پایام ساورین"
      data-testid="glassbox-drawer"
    >
      {/* Backdrop click to close */}
      <button
        type="button"
        aria-label="بستن کشو با کلیک پس‌زمینه"
        onClick={onClose}
        className="flex-1 cursor-default"
      />

      <div
        className="w-full max-w-2xl h-full flex flex-col border-s shadow-2xl"
        style={{
          backgroundColor: theme.bgSurface,
          borderColor: theme.borderStrong,
        }}
      >
        {/* Drawer Header */}
        <div
          className="px-4 py-3 border-b flex items-center justify-between shrink-0"
          style={{ borderColor: theme.borderHairline }}
        >
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" style={{ color: theme.accentPrimary }} aria-hidden="true" />
            <h2 className="text-sm font-bold" style={{ color: theme.textPrimary }}>
              جعبه شیشه‌ای لایه ۳ — ممیزی شورای ۳۸ ایجنت و ناوردایان
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="بستن کشوی لایه ۳"
            className="p-1.5 rounded border cursor-pointer"
            style={{
              borderColor: theme.borderHairline,
              color: theme.textSecondary,
            }}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Drawer Segmented Tabs */}
        <div
          role="tablist"
          className="px-4 py-2 border-b flex items-center gap-2 shrink-0"
          style={{
            backgroundColor: theme.bgCanvas,
            borderColor: theme.borderHairline,
          }}
        >
          {(
            [
              { id: 'COUNCIL', label: 'شورای ۳۸ ایجنت' },
              { id: 'GATES', label: 'ناوردایان و PayamGates' },
              { id: 'LEDGER', label: `دفترچه PayamLedger (${ledgerEntries.length})` },
              { id: 'FEED', label: 'فید داده و پل محلی' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              style={{
                backgroundColor: activeTab === tab.id ? theme.bgElevated : 'transparent',
                color: activeTab === tab.id ? theme.accentPrimary : theme.textSecondary,
              }}
              data-testid={`drawer-tab-${tab.id.toLowerCase()}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Drawer Content Area */}
        <div className="flex-1 min-h-0 overflow-y-auto ps-scroll p-4">
          {/* TAB 1: 38-AGENT COUNCIL MATRIX */}
          {activeTab === 'COUNCIL' && (
            <div className="flex flex-col gap-4">
              {/* Online LLM Heads (A7, A8, A11) & C8 Budget Governance */}
              <div
                className="p-3 rounded border flex flex-wrap items-center justify-between gap-3 text-xs"
                style={{
                  backgroundColor: theme.bgCanvas,
                  borderColor: theme.borderHairline,
                }}
              >
                <div className="flex flex-col gap-1">
                  <span className="font-semibold" style={{ color: theme.textPrimary }}>
                    هدهای شناختی آنلاین Gemini (<LtrNum>A7 / A8 / A11</LtrNum>)
                  </span>
                  <span style={{ color: theme.textMuted }}>
                    وضعیت سرور: {geminiServerReady ? 'آماده اتصال با مهلت ۱۲ ثانیه' : 'حالت ۱۰۰٪ قطعی محلی (I3)'} ·
                    مصرف بودجه C8: <LtrNum>{budget.tokensUsedSession}/{budget.tokenCapSession}</LtrNum>
                  </span>
                </div>

                <button
                  type="button"
                  onClick={onToggleOnlineLlm}
                  aria-pressed={onlineLlmEnabled}
                  className="px-3 py-1.5 rounded border text-xs font-semibold cursor-pointer whitespace-nowrap"
                  style={{
                    backgroundColor: onlineLlmEnabled ? theme.bgElevated : 'transparent',
                    borderColor: onlineLlmEnabled ? theme.accentPrimary : theme.borderStrong,
                    color: onlineLlmEnabled ? theme.accentPrimary : theme.textSecondary,
                  }}
                >
                  {onlineLlmEnabled ? 'هدهای آنلاین فعال است' : 'فعال‌سازی هدهای آنلاین'}
                </button>
              </div>

              {/* Plane Filter */}
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  {(['ALL', 'A', 'B', 'C'] as const).map((plane) => (
                    <button
                      key={plane}
                      type="button"
                      onClick={() => setPlaneFilter(plane)}
                      className="px-2.5 py-1 rounded border text-xs cursor-pointer"
                      style={{
                        backgroundColor: planeFilter === plane ? theme.bgElevated : 'transparent',
                        borderColor: planeFilter === plane ? theme.accentPrimary : theme.borderHairline,
                        color: planeFilter === plane ? theme.textPrimary : theme.textMuted,
                      }}
                    >
                      {plane === 'ALL'
                        ? 'همه ۳۸ ایجنت'
                        : plane === 'A'
                          ? 'صفحه A (ادراک ۱۲)'
                          : plane === 'B'
                            ? 'صفحه B (ترکیب ۱۴)'
                            : 'صفحه C (هسته ریسک ۱۲)'}
                    </button>
                  ))}
                </div>

                <span style={{ color: theme.textMuted }}>
                  دارایی: <LtrNum className="font-semibold">{snapshot.symbol}</LtrNum>
                </span>
              </div>

              {/* Agent Rows Table */}
              <div
                className="border rounded overflow-hidden"
                style={{ borderColor: theme.borderHairline }}
              >
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr
                      className="border-b text-start"
                      style={{
                        backgroundColor: theme.bgCanvas,
                        borderColor: theme.borderHairline,
                        color: theme.textMuted,
                      }}
                    >
                      <th className="py-2 px-2.5 text-start font-medium">کد</th>
                      <th className="py-2 px-2.5 text-start font-medium">ایجنت</th>
                      <th className="py-2 px-2.5 text-start font-medium">رأی</th>
                      <th className="py-2 px-2.5 text-start font-medium">یادداشت ممیزی</th>
                      <th className="py-2 px-2.5 text-end font-medium">تأخیر</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAgents.map((ag) => {
                      const vColor =
                        ag.verdict === 'APPROVE'
                          ? theme.bullish
                          : ag.verdict === 'VETO'
                            ? theme.veto
                            : ag.verdict === 'DEGRADED'
                              ? theme.freeze
                              : ag.verdict === 'REDUCE_RISK' || ag.verdict === 'CAUTION'
                                ? theme.warning
                                : theme.textMuted;
                      return (
                        <tr
                          key={ag.id}
                          className="border-b last:border-b-0"
                          style={{ borderColor: theme.borderHairline }}
                        >
                          <td className="py-2 px-2.5 font-semibold whitespace-nowrap">
                            <LtrNum>{ag.id}</LtrNum>
                          </td>
                          <td className="py-2 px-2.5 whitespace-nowrap" style={{ color: theme.textPrimary }}>
                            {ag.nameFa}
                          </td>
                          <td className="py-2 px-2.5 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: vColor }}>
                              <SemanticShape
                                shape={ag.vetoTriggered ? 'cross' : ag.isOnlineLlm ? 'diamond' : 'circle'}
                                color={vColor}
                                size={8}
                              />
                              <LtrNum>{ag.verdict}</LtrNum>
                            </span>
                          </td>
                          <td className="py-2 px-2.5 persian-copy" style={{ color: theme.textSecondary }}>
                            {ag.noteFa}
                          </td>
                          <td className="py-2 px-2.5 text-end whitespace-nowrap" style={{ color: theme.textMuted }}>
                            <LtrNum>{ag.latencyMs}ms</LtrNum>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: INVARIANTS I1..I7 & PAYAMGATES SELF-VERIFICATION */}
          {activeTab === 'GATES' && (
            <div className="flex flex-col gap-4">
              <div
                className="p-3.5 rounded border flex items-center justify-between gap-3"
                style={{
                  backgroundColor: theme.bgCanvas,
                  borderColor: theme.borderHairline,
                }}
              >
                <div>
                  <h3 className="text-xs font-bold" style={{ color: theme.textPrimary }}>
                    مجموعه خودآزمون دروازه‌های پایام (<LtrNum>PayamGates</LtrNum>)
                  </h3>
                  <p className="text-[11px] mt-1" style={{ color: theme.textSecondary }}>
                    اجرای زنده آزمون‌های سخت برای هر ۷ ناوردای I1..I7، پالایش کلیپ‌بورد BiDi و شورای ۳۸ ایجنت.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleRunGates}
                  className="px-3.5 py-2 rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  style={{
                    backgroundColor: theme.accentPrimary,
                    color: '#0F172A',
                  }}
                  data-testid="run-payam-gates-btn"
                >
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>اجرای PayamGates</span>
                </button>
              </div>

              {gateResults ? (
                <div className="flex flex-col gap-2" data-testid="payam-gates-results">
                  {gateResults.map((gate) => (
                    <div
                      key={gate.gateId}
                      className="p-3 rounded border flex items-start justify-between gap-3 text-xs"
                      style={{
                        backgroundColor: theme.bgCanvas,
                        borderColor: gate.passed ? theme.borderHairline : theme.bearish,
                      }}
                    >
                      <div className="flex items-start gap-2.5">
                        {gate.passed ? (
                          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: theme.bullish }} />
                        ) : (
                          <XCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: theme.bearish }} />
                        )}
                        <div>
                          <div className="font-semibold" style={{ color: theme.textPrimary }}>
                            <LtrNum className="me-1.5">{gate.gateId}</LtrNum>
                            {gate.titleFa}
                          </div>
                          <div className="mt-1 persian-copy" style={{ color: theme.textSecondary }}>
                            {gate.detailFa}
                          </div>
                        </div>
                      </div>
                      <LtrNum className="text-[11px] shrink-0">{gate.durationMs}ms</LtrNum>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className="p-6 rounded border text-center text-xs"
                  style={{
                    backgroundColor: theme.bgCanvas,
                    borderColor: theme.borderHairline,
                    color: theme.textMuted,
                  }}
                >
                  برای بررسی زنده تمامی ناوردایان I1..I7، روی دکمه «اجرای PayamGates» کلیک کنید.
                </div>
              )}
            </div>
          )}

          {/* TAB 3: PAYAMLEDGER AUDIT TRAIL */}
          {activeTab === 'LEDGER' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: theme.textSecondary }}>
                  ثبت غیرقابل تغییر در IndexedDB (حافظه محلی امن مرورگر)
                </span>
                <button
                  type="button"
                  onClick={onExportLedger}
                  className="px-3 py-1.5 rounded border text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                  style={{
                    borderColor: theme.borderStrong,
                    color: theme.textPrimary,
                  }}
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>خروجی JSON</span>
                </button>
              </div>

              <div className="flex flex-col gap-2">
                {ledgerEntries.length === 0 ? (
                  <p className="text-xs text-center py-6" style={{ color: theme.textMuted }}>
                    هنوز رویدادی ثبت نشده است.
                  </p>
                ) : (
                  ledgerEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-2.5 rounded border text-xs flex flex-col gap-1"
                      style={{
                        backgroundColor: theme.bgCanvas,
                        borderColor: theme.borderHairline,
                      }}
                    >
                      <div className="flex items-center justify-between text-[11px]" style={{ color: theme.textMuted }}>
                        <span className="flex items-center gap-2">
                          <LtrNum className="font-semibold">{entry.asset}</LtrNum>
                          <span>·</span>
                          <LtrNum>{entry.category}</LtrNum>
                          {entry.invariantRef && (
                            <>
                              <span>·</span>
                              <LtrNum className="font-semibold">{entry.invariantRef}</LtrNum>
                            </>
                          )}
                        </span>
                        <LtrNum>{new Date(entry.timestamp).toLocaleTimeString('en-GB')}</LtrNum>
                      </div>
                      <p className="persian-copy" style={{ color: theme.textPrimary }}>
                        {entry.summaryFa}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 4: FEED HEALTH SIMULATOR & LAYER-5 COMPANION BRIDGE */}
          {activeTab === 'FEED' && (
            <div className="flex flex-col gap-4 text-xs">
              <div
                className="p-3.5 rounded border flex flex-col gap-2"
                style={{
                  backgroundColor: theme.bgCanvas,
                  borderColor: theme.borderHairline,
                }}
              >
                <div className="font-bold" style={{ color: theme.textPrimary }}>
                  بافر انتقال دودویی Worker به Canvas
                </div>
                <div className="flex items-center justify-between" style={{ color: theme.textSecondary }}>
                  <span>حالت فعال انتقال</span>
                  <LtrNum className="font-semibold">{transportCaps.mode}</LtrNum>
                </div>
                <div className="flex items-center justify-between" style={{ color: theme.textSecondary }}>
                  <span>crossOriginIsolated (ارتقا به SAB)</span>
                  <LtrNum>{String(transportCaps.crossOriginIsolated)}</LtrNum>
                </div>
              </div>

              <div
                className="p-3.5 rounded border flex flex-col gap-2.5"
                style={{
                  backgroundColor: theme.bgCanvas,
                  borderColor: theme.borderHairline,
                }}
              >
                <div className="font-bold" style={{ color: theme.textPrimary }}>
                  آزمون وضعیت‌های ۷گانه فید و قفل سخت (Fail-Loudly)
                </div>
                <p className="persian-copy" style={{ color: theme.textSecondary }}>
                  انتخاب وضعیت‌های STALE یا DEAD بلافاصله نمودار را خاکستری و تمام دکمه‌های داک اقدام را قفل می‌کند.
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {ALL_FEED_STATES.map((st) => {
                    const meta = FEED_HEALTH_META[st];
                    const active = feedHealth === st;
                    return (
                      <button
                        key={st}
                        type="button"
                        onClick={() => onSetFeedHealthOverride(st === 'HEALTHY' ? null : st)}
                        className="px-2.5 py-2 rounded border text-xs font-medium flex items-center gap-2 cursor-pointer text-start"
                        style={{
                          backgroundColor: active ? theme.bgElevated : 'transparent',
                          borderColor: active ? theme.accentPrimary : theme.borderHairline,
                          color: active ? theme.textPrimary : theme.textSecondary,
                        }}
                        data-testid={`sim-feed-${st.toLowerCase()}`}
                      >
                        <SemanticShape
                          shape={meta.shape}
                          color={
                            meta.isLockedOut
                              ? theme.bearish
                              : meta.tone === 'bullish'
                                ? theme.bullish
                                : theme.warning
                          }
                          size={9}
                        />
                        <span className="truncate">{meta.labelFa}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div
                className="p-3.5 rounded border flex flex-col gap-2.5"
                style={{
                  backgroundColor: theme.bgCanvas,
                  borderColor: theme.borderHairline,
                }}
              >
                <div className="font-bold" style={{ color: theme.textPrimary }}>
                  پل اختیاری لایه ۵ (Companion Bridge — Python / Databento)
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={bridgeInput}
                    onChange={(e) => setBridgeInput(e.target.value)}
                    dir="ltr"
                    className="num-ltr flex-1 px-2.5 py-1.5 rounded border text-xs"
                    style={{
                      backgroundColor: theme.bgSurface,
                      borderColor: theme.borderStrong,
                      color: theme.textPrimary,
                    }}
                  />
                  {bridgeUrl ? (
                    <button
                      type="button"
                      onClick={() => onConnectBridge(null)}
                      className="px-3 py-1.5 rounded border text-xs font-semibold cursor-pointer"
                      style={{
                        borderColor: theme.bearish,
                        color: theme.bearish,
                      }}
                    >
                      قطع پل
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onConnectBridge(bridgeInput)}
                      className="px-3 py-1.5 rounded border text-xs font-semibold cursor-pointer"
                      style={{
                        borderColor: theme.accentPrimary,
                        color: theme.accentPrimary,
                      }}
                    >
                      اتصال پل
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
