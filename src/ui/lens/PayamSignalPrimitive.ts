/**
 * PayamLens Native Lightweight Charts v5 ISeriesPrimitive
 * STRICT <= 4 LAYER CONTRACT:
 *   Layer 1: Neutral muted candlesticks (owned by CandlestickSeries)
 *   Layer 2: Entry / SL / TP1 / TP2 R:R bracket (zOrder: 'bottom')
 *   Layer 3: Dashed Invalidation line
 *   Layer 4: Max 1–2 POI anchors (FVG / Liquidity Sweep zones)
 * ZERO indicators, ZERO legends, ZERO moving averages, ZERO drawing toolbars.
 */

import type {
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  PrimitivePaneViewZOrder,
  Time,
} from 'lightweight-charts';
import type { OpenPosition, PayamSignal, PoiAnchor } from '../../core/types';
import type { PayamColorTokens } from '../theme/tokens';

export interface SignalOverlayData {
  readonly signal: PayamSignal | null;
  readonly position: OpenPosition | null;
  readonly theme: PayamColorTokens;
  readonly decimals: number;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

class PayamBracketRenderer implements IPrimitivePaneRenderer {
  private readonly getParam: () => SeriesAttachedParameter<Time> | null;
  private readonly getData: () => SignalOverlayData | null;

  constructor(
    getParam: () => SeriesAttachedParameter<Time> | null,
    getData: () => SignalOverlayData | null
  ) {
    this.getParam = getParam;
    this.getData = getData;
  }

  draw(target: {
    useMediaCoordinateSpace: (
      cb: (scope: {
        context: CanvasRenderingContext2D;
        mediaSize: { width: number; height: number };
      }) => void
    ) => void;
  }): void {
    const param = this.getParam();
    const data = this.getData();
    if (!param || !data) return;

    const { series, chart } = param;
    const { signal, position, theme, decimals } = data;
    const active = position ?? signal;
    if (!active) return;

    const entry = position ? position.entryPrice : signal!.entry;
    const sl = position ? position.currentStopLoss : signal!.stopLoss;
    const tp1 = active.tp1;
    const tp2 = active.tp2;
    const inv = active.invalidationPrice;
    const pois: readonly PoiAnchor[] = signal ? signal.poiAnchors.slice(0, 2) : [];

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const width = mediaSize.width;
      const timeScale = chart.timeScale();

      const yEntry = series.priceToCoordinate(entry);
      const ySl = series.priceToCoordinate(sl);
      const yTp1 = series.priceToCoordinate(tp1);
      const yTp2 = series.priceToCoordinate(tp2);
      const yInv = series.priceToCoordinate(inv);

      // Determine bracket horizontal span (anchored near recent structure to right edge)
      const startX = Math.max(48, width * 0.56);
      const bracketW = Math.max(60, width - startX - 6);

      ctx.save();

      // -------------------------------------------------------------------
      // LAYER 4: Max 1–2 POI Anchors (FVG / Sweep Zones)
      // -------------------------------------------------------------------
      for (const poi of pois) {
        const yTop = series.priceToCoordinate(poi.priceTop);
        const yBot = series.priceToCoordinate(poi.priceBottom);
        if (yTop === null || yBot === null) continue;
        const x1Raw = timeScale.timeToCoordinate(poi.startTime as Time);
        const x1 = x1Raw !== null ? Math.max(0, x1Raw) : Math.max(24, width * 0.42);
        const rectTop = Math.min(yTop, yBot);
        const rectH = Math.max(4, Math.abs(yBot - yTop));

        ctx.fillStyle = hexToRgba(theme.info, 0.14);
        ctx.strokeStyle = hexToRgba(theme.info, 0.45);
        ctx.lineWidth = 1;
        ctx.fillRect(x1, rectTop, width - x1, rectH);
        ctx.strokeRect(x1 + 0.5, rectTop + 0.5, width - x1 - 1, rectH - 1);

        ctx.font = '500 10px "IBM Plex Mono", monospace';
        ctx.fillStyle = hexToRgba(theme.textSecondary, 0.9);
        ctx.fillText(poi.kind, x1 + 6, rectTop + 11);
      }

      // -------------------------------------------------------------------
      // LAYER 2: Entry / SL / TP1 / TP2 R:R Bracket (zOrder: 'bottom')
      // -------------------------------------------------------------------
      if (yEntry !== null && ySl !== null) {
        const riskTop = Math.min(yEntry, ySl);
        const riskH = Math.max(2, Math.abs(ySl - yEntry));
        ctx.fillStyle = hexToRgba(theme.bearish, 0.14);
        ctx.fillRect(startX, riskTop, bracketW, riskH);
      }

      if (yEntry !== null && yTp2 !== null) {
        const rewardTop = Math.min(yEntry, yTp2);
        const rewardH = Math.max(2, Math.abs(yTp2 - yEntry));
        ctx.fillStyle = hexToRgba(theme.bullish, 0.13);
        ctx.fillRect(startX, rewardTop, bracketW, rewardH);
      }

      const drawHorizontalLine = (
        y: number | null,
        color: string,
        label: string,
        priceVal: number,
        dashed: boolean,
        lineWidth: number = 1.25
      ) => {
        if (y === null || !Number.isFinite(y)) return;
        const snappedY = Math.round(y) + 0.5;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        if (dashed) {
          ctx.setLineDash([5, 4]);
        }
        ctx.beginPath();
        ctx.moveTo(startX, snappedY);
        ctx.lineTo(width, snappedY);
        ctx.stroke();

        // Compact crisp ASCII numeric tag inside bracket edge
        ctx.setLineDash([]);
        const text = `${label} ${priceVal.toFixed(decimals)}`;
        ctx.font = '600 10px "IBM Plex Mono", monospace';
        const metrics = ctx.measureText(text);
        const padX = 5;
        const boxW = metrics.width + padX * 2;
        const boxH = 16;
        const boxX = startX + 4;
        const boxY = snappedY - boxH / 2;

        ctx.fillStyle = theme.bgElevated;
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);
        ctx.fillStyle = theme.textPrimary;
        ctx.fillText(text, boxX + padX, snappedY + 3.5);
        ctx.restore();
      };

      drawHorizontalLine(yTp2, theme.bullish, 'TP2', tp2, false, 1.4);
      drawHorizontalLine(yTp1, hexToRgba(theme.bullish, 0.8), 'TP1', tp1, false, 1.1);
      drawHorizontalLine(yEntry, theme.accentPrimary, 'ENTRY', entry, false, 1.5);
      drawHorizontalLine(ySl, theme.bearish, 'SL', sl, false, 1.4);

      // -------------------------------------------------------------------
      // LAYER 3: Dashed Invalidation Line (Full-width structural line)
      // -------------------------------------------------------------------
      if (yInv !== null && Number.isFinite(yInv)) {
        const snappedInv = Math.round(yInv) + 0.5;
        ctx.save();
        ctx.strokeStyle = theme.warning;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(0, snappedInv);
        ctx.lineTo(width, snappedInv);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '600 10px "IBM Plex Mono", monospace';
        ctx.fillStyle = theme.warning;
        ctx.fillText(`INV ${inv.toFixed(decimals)}`, 8, snappedInv - 4);
        ctx.restore();
      }

      ctx.restore();
    });
  }
}

class PayamBracketPaneView implements IPrimitivePaneView {
  private readonly rendererInstance: PayamBracketRenderer;

  constructor(
    getParam: () => SeriesAttachedParameter<Time> | null,
    getData: () => SignalOverlayData | null
  ) {
    this.rendererInstance = new PayamBracketRenderer(getParam, getData);
  }

  zOrder(): PrimitivePaneViewZOrder {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer {
    return this.rendererInstance;
  }
}

export class PayamSignalPrimitive implements ISeriesPrimitive<Time> {
  private attachedParam: SeriesAttachedParameter<Time> | null = null;
  private overlayData: SignalOverlayData | null = null;
  private readonly paneView: PayamBracketPaneView;

  constructor() {
    this.paneView = new PayamBracketPaneView(
      () => this.attachedParam,
      () => this.overlayData
    );
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.attachedParam = param;
  }

  detached(): void {
    this.attachedParam = null;
  }

  updateData(next: SignalOverlayData | null): void {
    this.overlayData = next;
    this.attachedParam?.requestUpdate();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.paneView];
  }
}
