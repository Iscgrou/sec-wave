/**
 * Payam Sovereign — BiDi-Safe ASCII Clipboard Sanitizer & Numeric Formatting
 * Enforces strict zero-BiDi / zero-currency-symbol raw ASCII numeric copy
 * and deterministic FNV-1a digest for B13 Regime Certificates.
 */

/**
 * Strips all BiDi control characters (U+200B..U+206F, U+FEFF), commas,
 * currency symbols, percent signs, whitespace, and converts Persian/Arabic
 * digits to pure ASCII Latin digits (0-9).
 */
export function sanitizeForClipboard(rawValue: number | string, decimals?: number): string {
  const input =
    typeof rawValue === 'number'
      ? Number.isFinite(rawValue)
        ? decimals !== undefined
          ? rawValue.toFixed(decimals)
          : String(rawValue)
        : ''
      : rawValue;

  // Convert Persian (۰-۹) and Arabic-Indic (٠-٩) digits if ever encountered
  const asciiDigits = input
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));

  // Strip invisible BiDi / zero-width control chars U+200B..U+206F and U+FEFF
  const noBidi = asciiDigits.replace(/[\u200B-\u206F\uFEFF]/g, '');

  // Keep only ASCII sign, digits, and decimal point
  const cleaned = noBidi.replace(/[^0-9.\-]/g, '');

  // Normalize multiple dots or stray leading/trailing minus signs
  const match = cleaned.match(/^-?\d+(?:\.\d+)?/);
  return match ? match[0] : '';
}

/** Verify a clipboard string contains zero invisible BiDi characters or formatting artifacts */
export function isCleanAsciiNumber(value: string): boolean {
  if (value.length === 0) return false;
  if (/[\u200B-\u206F\uFEFF,$%\s]/.test(value)) return false;
  return /^-?\d+(?:\.\d+)?$/.test(value);
}

export function formatPrice(price: number, decimals: number): string {
  if (!Number.isFinite(price)) return '0';
  return price.toFixed(decimals);
}

export function formatRMultiple(rValue: number): string {
  if (!Number.isFinite(rValue)) return '0.00R';
  const sign = rValue > 0 ? '+' : '';
  return `${sign}${rValue.toFixed(2)}R`;
}

export function formatRatio(rr: number): string {
  if (!Number.isFinite(rr) || rr <= 0) return '1:0.0';
  return `1:${rr.toFixed(2)}`;
}

export function formatPct(pct: number): string {
  if (!Number.isFinite(pct)) return '0.00%';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatCountdownMs(remainingMs: number): string {
  if (remainingMs <= 0) return '00:00';
  const totalSec = Math.ceil(remainingMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** Fast deterministic FNV-1a 32-bit hex digest for B13 certificate binding */
export function fnv1aHex(payload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').toUpperCase();
}
