/**
 * TopPerceptionBar — Fixed Top Bar of Payam Sovereign
 * Contains: Brand Wordmark, 5-Asset Switcher with live tabular prices,
 * 7-State Feed Health (Color + Geometric Shape + Persian Label),
 * FMA Mode (SEARCH / LOCKED / TWS), Event-Driven Council Pulse,
 * Dual-Lens Switcher (Tab), Layer-3 Drawer Trigger (D), and Okabe-Ito CVD Toggle.
 */

import { Eye, Layers, PanelLeftOpen } from 'lucide-react';
import {
  ASSET_LIST,
  ASSET_SPECS,
  FEED_HEALTH_META,
  type AssetRuntimeSnapshot,
  type AssetSymbol,
  type FeedHealthState,
  type FmaMode,
  type LensViewMode,
} from '../../core/types';
import { formatPrice } from '../../core/utils/sanitize';
import type { PayamColorTokens, PayamThemeMode } from '../theme/tokens';
import { LtrNum, SemanticShape, type SemanticShapeKind } from './SemanticShape';

interface TopPerceptionBarProps {
  readonly activeAsset: AssetSymbol;
  readonly snapshots: Readonly<Record<AssetSymbol, AssetRuntimeSnapshot>>;
  readonly feedHealth: FeedHealthState;
  readonly feedLatencyMs: number;
  readonly lensMode: LensViewMode;
  readonly canSplit: boolean;
  readonly themeMode: PayamThemeMode;
  readonly theme: PayamColorTokens;
  readonly drawerOpen: boolean;
  readonly councilBusy: boolean;
  readonly onSelectAsset: (asset: AssetSymbol) => void;
  readonly onChangeLens: (mode: LensViewMode) => void;
  readonly onToggleDrawer: () => void;
  readonly onToggleTheme: () => void;
}

function fmaMeta(mode: FmaMode, theme: PayamColorTokens): {
  labelFa: string;
  shape: SemanticShapeKind;
  color: string;
} {
  switch (mode) {
    case 'LOCKED':
      return { labelFa: 'قفل ستاپ', shape: 'diamond', color: theme.bullish };
    case 'TWS':
      return { labelFa: 'پوزیشن باز', shape: 'shield', color: theme.accentPrimary };
    default:
      return { labelFa: 'جستجو', shape: 'circle', color: theme.textSecondary };
  }
}

function healthToneColor(
  tone: (typeof FEED_HEALTH_META)[FeedHealthState]['tone'],
  theme: PayamColorTokens
): string {
  switch (tone) {
    case 'bullish':
      return theme.bullish;
    case 'warning':
      return theme.warning;
    case 'bearish':
      return theme.bearish;
    case 'freeze':
      return theme.freeze;
    default:
      return theme.info;
  }
}

export function TopPerceptionBar({
  activeAsset,
  snapshots,
  feedHealth,
  feedLatencyMs,
  lensMode,
  canSplit,
  themeMode,
  theme,
  drawerOpen,
  councilBusy,
  onSelectAsset,
  onChangeLens,
  onToggleDrawer,
  onToggleTheme,
}: TopPerceptionBarProps) {
  const activeSnap = snapshots[activeAsset];
  const fma = fmaMeta(activeSnap.fmaMode, theme);
  const healthMeta = FEED_HEALTH_META[feedHealth];
  const healthColor = healthToneColor(healthMeta.tone, theme);

  return (
    <header
      className="h-14 shrink-0 border-b px-3 flex items-center justify-between gap-4 select-none overflow-hidden"
      style={{
        backgroundColor: theme.bgSurface,
        borderColor: theme.borderHairline,
      }}
      data-testid="top-perception-bar"
    >
      {/* Zone 1: Single-line Brand Wordmark + 5-Asset Switcher */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 shrink-0 pe-3 border-e" style={{ borderColor: theme.borderHairline }}>
          <SemanticShape shape="hexagon" color={theme.accentPrimary} size={14} />
          <span
            className="text-sm font-bold whitespace-nowrap shrink-0"
            style={{ color: theme.textPrimary }}
          >
            پایام ساورین
          </span>
        </div>

        <nav aria-label="انتخابگر ۵ دارایی" className="flex items-center gap-1 min-w-0">
          {ASSET_LIST.map((symbol) => {
            const snap = snapshots[symbol];
            const spec = ASSET_SPECS[symbol];
            const isSelected = symbol === activeAsset;
            const itemFma = fmaMeta(snap.fmaMode, theme);
            return (
              <button
                key={symbol}
                type="button"
                onClick={() => onSelectAsset(symbol)}
                aria-pressed={isSelected}
                aria-label={`انتخاب دارایی ${symbol} ${spec.nameFa}`}
                className="px-2.5 py-1.5 rounded text-xs transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer border focus-visible:outline-2"
                style={{
                  backgroundColor: isSelected ? theme.bgElevated : 'transparent',
                  borderColor: isSelected ? theme.accentPrimary : 'transparent',
                  color: isSelected ? theme.textPrimary : theme.textSecondary,
                }}
              >
                <SemanticShape shape={itemFma.shape} color={itemFma.color} size={8} />
                <LtrNum className="font-semibold text-[11px]">{symbol}</LtrNum>
                <LtrNum
                  className="text-[11px] opacity-90 hidden xl:inline-block"
                >
                  {formatPrice(snap.lastPrice, spec.decimals)}
                </LtrNum>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Zone 2: Perception Telemetry (Unboxed Metadata: 7-State Health · FMA · Council State) */}
      <div className="hidden lg:flex items-center gap-3 text-xs shrink-0">
        {/* 7-State Feed Health (Triple Redundancy: Color + Shape + Label) */}
        <div
          className="flex items-center gap-1.5 whitespace-nowrap"
          data-testid="feed-health-readout"
          data-health={feedHealth}
        >
          <SemanticShape shape={healthMeta.shape} color={healthColor} size={10} />
          <span className="font-medium" style={{ color: healthColor }}>
            {healthMeta.labelFa}
          </span>
          <LtrNum className="text-[11px] opacity-75">{feedLatencyMs}ms</LtrNum>
        </div>

        <span style={{ color: theme.borderStrong }} aria-hidden="true">
          /
        </span>

        {/* FMA Mode Annunciator */}
        <div
          className="flex items-center gap-1.5 whitespace-nowrap"
          data-testid="fma-mode-readout"
          data-fma={activeSnap.fmaMode}
        >
          <SemanticShape shape={fma.shape} color={fma.color} size={10} />
          <span className="font-semibold" style={{ color: theme.textPrimary }}>
            <LtrNum>{activeSnap.fmaMode}</LtrNum>
          </span>
          <span style={{ color: theme.textSecondary }}>{fma.labelFa}</span>
        </div>

        <span style={{ color: theme.borderStrong }} aria-hidden="true">
          /
        </span>

        {/* Event-Bound Council Pulse (Never decorative pulsing; reacts 1:1 to deliberation) */}
        <div className="flex items-center gap-1.5 whitespace-nowrap" style={{ color: theme.textSecondary }}>
          <SemanticShape
            shape={councilBusy ? 'diamond' : 'square'}
            color={councilBusy ? theme.warning : theme.info}
            size={8}
          />
          <span>
            {councilBusy
              ? 'شورای ۳۸ ایجنت در حال بررسی'
              : `شورا ${activeSnap.lastDeliberation?.consensusApproveCount ?? 0}/38`}
          </span>
        </div>
      </div>

      {/* Zone 3: Lens Switcher (Tab) + CVD Toggle + Layer-3 Drawer (D) */}
      <div className="flex items-center gap-2 shrink-0">
        <div
          role="tablist"
          aria-label="تغییر لنز مرکزی"
          className="flex items-center p-0.5 rounded border"
          style={{
            backgroundColor: theme.bgCanvas,
            borderColor: theme.borderHairline,
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={lensMode === 'CHART'}
            onClick={() => onChangeLens('CHART')}
            className="px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            style={{
              backgroundColor: lensMode === 'CHART' ? theme.bgElevated : 'transparent',
              color: lensMode === 'CHART' ? theme.textPrimary : theme.textMuted,
            }}
          >
            نمودار
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={lensMode === 'ARENA'}
            onClick={() => onChangeLens('ARENA')}
            className="px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            style={{
              backgroundColor: lensMode === 'ARENA' ? theme.bgElevated : 'transparent',
              color: lensMode === 'ARENA' ? theme.textPrimary : theme.textMuted,
            }}
          >
            میدان ۳۸ ایجنت
          </button>
          {canSplit && (
            <button
              type="button"
              role="tab"
              aria-selected={lensMode === 'SPLIT'}
              onClick={() => onChangeLens('SPLIT')}
              className="px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              style={{
                backgroundColor: lensMode === 'SPLIT' ? theme.bgElevated : 'transparent',
                color: lensMode === 'SPLIT' ? theme.textPrimary : theme.textMuted,
              }}
            >
              ترکیبی
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-pressed={themeMode === 'okabe-ito'}
          aria-label="تغییر پالت رنگی به حالت کوررنگی Okabe-Ito CVD"
          title="تغییر تم Okabe-Ito CVD"
          className="px-2.5 py-1.5 rounded border text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          style={{
            backgroundColor: themeMode === 'okabe-ito' ? theme.bgElevated : 'transparent',
            borderColor: themeMode === 'okabe-ito' ? theme.accentPrimary : theme.borderHairline,
            color: themeMode === 'okabe-ito' ? theme.accentPrimary : theme.textSecondary,
          }}
          data-testid="cvd-theme-toggle"
        >
          <Eye className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">
            {themeMode === 'okabe-ito' ? 'Okabe-Ito فعال' : 'حالت CVD'}
          </span>
        </button>

        <button
          type="button"
          onClick={onToggleDrawer}
          aria-expanded={drawerOpen}
          aria-label="باز و بسته کردن کشوی شفافیت لایه ۳"
          className="px-2.5 py-1.5 rounded border text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          style={{
            backgroundColor: drawerOpen ? theme.bgElevated : 'transparent',
            borderColor: drawerOpen ? theme.accentPrimary : theme.borderHairline,
            color: drawerOpen ? theme.accentPrimary : theme.textPrimary,
          }}
          data-testid="glassbox-drawer-toggle"
        >
          {drawerOpen ? (
            <PanelLeftOpen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>لایه ۳</span>
          <LtrNum className="text-[10px] opacity-75">[D]</LtrNum>
        </button>
      </div>
    </header>
  );
}
