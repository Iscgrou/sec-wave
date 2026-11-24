/**
 * Payam Sovereign — Anti-Halation Dark & Okabe-Ito CVD Token Registry
 * Pure #000000 and #FFFFFF are strictly forbidden.
 * Calibrated for APCA Lc >= 75 body, >= 60 headers, >= 50 structural lines.
 */

export type PayamThemeMode = 'institutional' | 'okabe-ito';

export interface PayamColorTokens {
  readonly mode: PayamThemeMode;
  readonly labelFa: string;
  readonly bgCanvas: string;
  readonly bgSurface: string;
  readonly bgElevated: string;
  readonly bgMuted: string;
  readonly borderHairline: string;
  readonly borderStrong: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly accentPrimary: string;
  readonly bullish: string;
  readonly bearish: string;
  readonly warning: string;
  readonly info: string;
  readonly veto: string;
  readonly freeze: string;
}

export const PAYAM_THEMES: Readonly<Record<PayamThemeMode, PayamColorTokens>> = Object.freeze({
  institutional: Object.freeze({
    mode: 'institutional',
    labelFa: 'نهادی کالیبره‌شده',
    bgCanvas: '#0F172A',
    bgSurface: '#141E33',
    bgElevated: '#1A263F',
    bgMuted: '#1E293B',
    borderHairline: '#273449',
    borderStrong: '#3B4B66',
    textPrimary: '#E2E8F0',
    textSecondary: '#94A3B8',
    textMuted: '#7C8CA3',
    accentPrimary: '#38BDF8',
    bullish: '#22C55E',
    bearish: '#EF4444',
    warning: '#F59E0B',
    info: '#60A5FA',
    veto: '#F87171',
    freeze: '#FB923C',
  }),
  'okabe-ito': Object.freeze({
    mode: 'okabe-ito',
    labelFa: 'کدگذاری Okabe-Ito CVD',
    bgCanvas: '#12151C',
    bgSurface: '#181C26',
    bgElevated: '#1F2533',
    bgMuted: '#242B3A',
    borderHairline: '#2E3748',
    borderStrong: '#435068',
    textPrimary: '#E6E9EF',
    textSecondary: '#A3AEC2',
    textMuted: '#8491A7',
    accentPrimary: '#56B4E9',
    bullish: '#009E73',
    bearish: '#D55E00',
    warning: '#E69F00',
    info: '#56B4E9',
    veto: '#CC79A7',
    freeze: '#F0E442',
  }),
});

export function applyPayamTheme(mode: PayamThemeMode): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', mode);
  }
}
