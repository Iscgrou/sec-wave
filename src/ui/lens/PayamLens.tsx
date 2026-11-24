/**
 * PayamLens — 3-Second Signal Proof Verification Chart (Lightweight Charts v5)
 * STRICT BAN LIST: No RSI, MACD, moving averages, drawing toolbars, multi-chart grids, or legends.
 * Only 2 chart actions: Space (HTF 1H / 15m reset) and T (open TradingView).
 * Imperatively updated via ref handle — keeps React completely out of the tick hot path.
 * Fail-Loudly grey-out overlay on STALE / DEAD feeds.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import {
  ASSET_SPECS,
  FEED_HEALTH_META,
  type AssetSymbol,
  type CandleBar,
  type FeedHealthState,
  type OpenPosition,
  type PayamSignal,
} from '../../core/types';
import { aggregateToHtfCandles } from '../../core/feed/syntheticCandles';
import type { PayamColorTokens } from '../theme/tokens';
import { LtrNum, SemanticShape } from '../components/SemanticShape';
import { PayamSignalPrimitive } from './PayamSignalPrimitive';

export interface PayamLensHandle {
  setBars: (bars: readonly CandleBar[], htfMode: boolean) => void;
  updateLatestBar: (bar: CandleBar, htfMode: boolean) => void;
  resetView: () => void;
}

interface PayamLensProps {
  readonly asset: AssetSymbol;
  readonly theme: PayamColorTokens;
  readonly feedHealth: FeedHealthState;
  readonly signal: PayamSignal | null;
  readonly position: OpenPosition | null;
  readonly htfMode: boolean;
  readonly onToggleHtf: () => void;
  readonly initialBars: readonly CandleBar[];
}

function toChartCandle(bar: CandleBar): CandlestickData<Time> {
  return {
    time: bar.time as Time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  };
}

export const PayamLens = forwardRef<PayamLensHandle, PayamLensProps>(function PayamLens(
  {
    asset,
    theme,
    feedHealth,
    signal,
    position,
    htfMode,
    onToggleHtf,
    initialBars,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const primitiveRef = useRef<PayamSignalPrimitive | null>(null);
  const cachedBarsRef = useRef<readonly CandleBar[]>(initialBars);

  const spec = ASSET_SPECS[asset];
  const isLockedOut = FEED_HEALTH_META[feedHealth].isLockedOut;

  // Mount chart once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth || 640,
      height: el.clientHeight || 420,
      layout: {
        background: { type: ColorType.Solid, color: theme.bgCanvas },
        textColor: theme.textSecondary,
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: theme.borderHairline, style: 0 },
        horzLines: { color: theme.borderHairline, style: 0 },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: theme.borderStrong, width: 1, style: 2 },
        horzLine: { color: theme.borderStrong, width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: theme.borderHairline,
        scaleMargins: { top: 0.14, bottom: 0.14 },
      },
      timeScale: {
        borderColor: theme.borderHairline,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 10,
      },
    });

    // Layer 1: Neutral muted candlesticks (ISA-101 anti-halation base)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#64748B',
      downColor: '#334155',
      borderUpColor: '#94A3B8',
      borderDownColor: '#475569',
      wickUpColor: '#94A3B8',
      wickDownColor: '#64748B',
      priceLineVisible: true,
      lastValueVisible: true,
    });

    const primitive = new PayamSignalPrimitive();
    candleSeries.attachPrimitive(primitive);

    chartRef.current = chart;
    seriesRef.current = candleSeries;
    primitiveRef.current = primitive;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || !chartRef.current) return;
      const { width, height } = entry.contentRect;
      if (width > 20 && height > 20) {
        chartRef.current.applyOptions({
          width: Math.floor(width),
          height: Math.floor(height),
        });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      candleSeries.detachPrimitive(primitive);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      primitiveRef.current = null;
    };
    // Mount chart strictly once; options update in dedicated effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync theme colors without tearing down chart
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: theme.bgCanvas },
        textColor: theme.textSecondary,
      },
      grid: {
        vertLines: { color: theme.borderHairline },
        horzLines: { color: theme.borderHairline },
      },
      rightPriceScale: { borderColor: theme.borderHairline },
      timeScale: { borderColor: theme.borderHairline },
    });

    // Keep neutral muted candles on both themes; subtle contrast boost on Okabe-Ito
    series.applyOptions({
      upColor: theme.mode === 'okabe-ito' ? '#6B7A90' : '#64748B',
      downColor: theme.mode === 'okabe-ito' ? '#363F52' : '#334155',
      borderUpColor: theme.mode === 'okabe-ito' ? '#A3AEC2' : '#94A3B8',
      borderDownColor: theme.mode === 'okabe-ito' ? '#515E77' : '#475569',
      wickUpColor: theme.mode === 'okabe-ito' ? '#A3AEC2' : '#94A3B8',
      wickDownColor: theme.mode === 'okabe-ito' ? '#6B7A90' : '#64748B',
    });
  }, [theme]);

  // Sync bars when asset or HTF mode changes
  useEffect(() => {
    cachedBarsRef.current = initialBars;
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || initialBars.length === 0) return;

    series.applyOptions({
      priceFormat: {
        type: 'price',
        precision: spec.decimals,
        minMove: spec.tickSize,
      },
    });

    const displayBars = htfMode ? aggregateToHtfCandles(initialBars, 4) : initialBars;
    series.setData(displayBars.map(toChartCandle));
    chart.timeScale().fitContent();
  }, [asset, htfMode, initialBars, spec.decimals, spec.tickSize]);

  // Sync ISeriesPrimitive overlay (Layers 2, 3, 4)
  useEffect(() => {
    primitiveRef.current?.updateData({
      signal,
      position,
      theme,
      decimals: spec.decimals,
    });
  }, [signal, position, theme, spec.decimals]);

  // Imperative API for off-React tick updates
  useImperativeHandle(
    ref,
    () => ({
      setBars(bars, isHtf) {
        cachedBarsRef.current = bars;
        const series = seriesRef.current;
        if (!series || bars.length === 0) return;
        const displayBars = isHtf ? aggregateToHtfCandles(bars, 4) : bars;
        series.setData(displayBars.map(toChartCandle));
      },
      updateLatestBar(bar, isHtf) {
        const series = seriesRef.current;
        if (!series) return;
        if (isHtf) {
          // On HTF mode, re-aggregate tail cleanly without triggering React
          const prev = cachedBarsRef.current;
          if (prev.length > 0) {
            const next = [...prev];
            if (next[next.length - 1].time === bar.time) {
              next[next.length - 1] = bar;
            } else {
              next.push(bar);
            }
            cachedBarsRef.current = next;
            const htfBars = aggregateToHtfCandles(next, 4);
            const lastHtf = htfBars[htfBars.length - 1];
            if (lastHtf) series.update(toChartCandle(lastHtf));
          }
        } else {
          series.update(toChartCandle(bar));
        }
      },
      resetView() {
        chartRef.current?.timeScale().fitContent();
      },
    }),
    []
  );

  return (
    <div
      className="relative flex flex-col h-full w-full min-h-0 overflow-hidden"
      style={{ backgroundColor: theme.bgCanvas }}
      data-testid="payam-lens-container"
    >
      {/* Minimal 2-control verification strip (Space = HTF/Reset, T = TradingView) */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0 border-b text-xs"
        style={{
          backgroundColor: theme.bgSurface,
          borderColor: theme.borderHairline,
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-semibold text-sm whitespace-nowrap" style={{ color: theme.textPrimary }}>
            لنز اعتبارسنجی <LtrNum className="ms-1 font-semibold">{asset}</LtrNum>
          </span>
          <span style={{ color: theme.textMuted }} aria-hidden="true">
            ·
          </span>
          <span className="whitespace-nowrap" style={{ color: theme.textSecondary }}>
            تایم‌فریم <LtrNum className="font-semibold">{htfMode ? '1H' : '15M'}</LtrNum>
          </span>
          <span style={{ color: theme.textMuted }} aria-hidden="true">
            ·
          </span>
          <span className="truncate" style={{ color: theme.textMuted }}>
            {spec.sessionLabelFa}
          </span>
        </div>

        {/* Strictly ONLY 2 controls: Space (HTF/Reset) and T (TradingView) */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleHtf}
            className="px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 border cursor-pointer focus-visible:outline-2"
            style={{
              backgroundColor: htfMode ? theme.bgElevated : 'transparent',
              borderColor: htfMode ? theme.accentPrimary : theme.borderHairline,
              color: htfMode ? theme.accentPrimary : theme.textSecondary,
            }}
            aria-label="تغییر نمای تایم‌فریم بالا و بازنشانی مقیاس نمودار"
          >
            {htfMode ? 'بازگشت به 15M' : 'نمای تایم‌فریم بالا (1H)'}
            <span className="ms-1.5 opacity-75">
              <LtrNum>[Space]</LtrNum>
            </span>
          </button>

          <a
            href={spec.tradingViewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 border focus-visible:outline-2"
            style={{
              borderColor: theme.borderHairline,
              color: theme.textSecondary,
            }}
            aria-label={`باز کردن نمودار ${asset} در TradingView`}
          >
            باز کردن در TradingView
            <span className="ms-1.5 opacity-75">
              <LtrNum>[T]</LtrNum>
            </span>
          </a>
        </div>
      </div>

      {/* Chart Canvas Surface (<= 4 layers enforced) */}
      <div className="relative flex-1 min-h-0 w-full">
        <div
          ref={containerRef}
          className={`h-full w-full transition-opacity duration-200 ${
            isLockedOut ? 'opacity-25 grayscale pointer-events-none' : 'opacity-100'
          }`}
          data-testid="payam-lens-canvas"
        />

        {/* Fail-Loudly Overlay on STALE / DEAD Feeds */}
        {isLockedOut && (
          <div
            role="alert"
            className="absolute inset-0 flex items-center justify-center p-6"
            style={{ backgroundColor: 'rgba(15, 23, 42, 0.72)' }}
            data-testid="payam-lens-lockout"
          >
            <div
              className="max-w-md w-full p-5 rounded-md border text-center"
              style={{
                backgroundColor: theme.bgElevated,
                borderColor: feedHealth === 'DEAD' ? theme.bearish : theme.freeze,
              }}
            >
              <div className="flex items-center justify-center gap-2 mb-2">
                <SemanticShape
                  shape={FEED_HEALTH_META[feedHealth].shape}
                  color={feedHealth === 'DEAD' ? theme.bearish : theme.freeze}
                  size={14}
                />
                <h2 className="text-base font-bold" style={{ color: theme.textPrimary }}>
                  قفل سخت فید فعال شد ({FEED_HEALTH_META[feedHealth].labelFa})
                </h2>
              </div>
              <p className="text-xs persian-copy" style={{ color: theme.textSecondary }}>
                داده قیمتی دیگر تازه نیست. نمودار اعتبارسنجی خاکستری شد و تمام دکمه‌های اقدام تا بازگشت جریان پایدار قفل ماندند.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
