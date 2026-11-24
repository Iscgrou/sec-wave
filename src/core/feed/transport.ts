/**
 * PayamFeed Binary Transport — Zero-Copy Transferable Float32Array Ping-Pong
 * Auto-upgrades to SharedArrayBuffer ONLY when `globalThis.crossOriginIsolated === true`.
 * Safe for Google AI Studio sandbox iframes without COOP/COEP headers.
 */

export type TransportMode = 'SHARED_ARRAY_BUFFER' | 'TRANSFERABLE_PING_PONG';

/** Fixed 6-float stride per candle: [time, open, high, low, close, volume] */
export const CANDLE_STRIDE = 6;

export interface BinaryTransportCapabilities {
  readonly mode: TransportMode;
  readonly crossOriginIsolated: boolean;
  readonly sharedArrayBufferAvailable: boolean;
}

export function detectTransportCapabilities(): BinaryTransportCapabilities {
  const isolated =
    typeof globalThis !== 'undefined' &&
    'crossOriginIsolated' in globalThis &&
    Boolean((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated);

  const hasSab = typeof SharedArrayBuffer !== 'undefined';
  const mode: TransportMode =
    isolated && hasSab ? 'SHARED_ARRAY_BUFFER' : 'TRANSFERABLE_PING_PONG';

  return {
    mode,
    crossOriginIsolated: isolated,
    sharedArrayBufferAvailable: hasSab,
  };
}

/** Encode an array of OHLCV bars into a tightly packed Float64Array / Float32Array buffer */
export function packTicksToFloat32(
  prices: readonly number[],
  bids: readonly number[],
  asks: readonly number[],
  spreads: readonly number[],
  timestampsMs: readonly number[]
): Float32Array<ArrayBuffer> {
  const count = prices.length;
  const buf = new ArrayBuffer(count * 5 * Float32Array.BYTES_PER_ELEMENT);
  const view = new Float32Array(buf);
  for (let i = 0; i < count; i += 1) {
    const base = i * 5;
    view[base] = prices[i] ?? 0;
    view[base + 1] = bids[i] ?? 0;
    view[base + 2] = asks[i] ?? 0;
    view[base + 3] = spreads[i] ?? 0;
    // Relative seconds modulo 1e6 to preserve float32 precision
    view[base + 4] = ((timestampsMs[i] ?? 0) % 1_000_000_000) / 1000;
  }
  return view;
}

export interface UnpackedAssetTick {
  readonly price: number;
  readonly bid: number;
  readonly ask: number;
  readonly spread: number;
}

export function unpackFloat32Ticks(
  view: Float32Array,
  assetCount: number
): UnpackedAssetTick[] {
  const out: UnpackedAssetTick[] = [];
  for (let i = 0; i < assetCount; i += 1) {
    const base = i * 5;
    out.push({
      price: view[base] ?? 0,
      bid: view[base + 1] ?? 0,
      ask: view[base + 2] ?? 0,
      spread: view[base + 3] ?? 0,
    });
  }
  return out;
}

/**
 * Ping-pong buffer pool for Worker -> Main zero-copy Transferable swaps.
 * Returns the recycled ArrayBuffer back to the Worker so GC allocations stay near zero.
 */
export class PingPongFloat32Pool {
  private readonly buffers: ArrayBuffer[];
  private activeIdx = 0;

  constructor(floatLength: number, poolSize: number = 2) {
    const bytes = floatLength * Float32Array.BYTES_PER_ELEMENT;
    this.buffers = Array.from({ length: poolSize }, () => new ArrayBuffer(bytes));
  }

  acquire(): Float32Array<ArrayBuffer> {
    const buf = this.buffers[this.activeIdx];
    this.activeIdx = (this.activeIdx + 1) % this.buffers.length;
    if (!buf || buf.byteLength === 0) {
      return new Float32Array(new ArrayBuffer(25 * Float32Array.BYTES_PER_ELEMENT));
    }
    return new Float32Array(buf);
  }

  recycle(detachedOrReturned: ArrayBuffer): void {
    if (detachedOrReturned.byteLength > 0) {
      this.buffers[this.activeIdx] = detachedOrReturned;
    }
  }
}
