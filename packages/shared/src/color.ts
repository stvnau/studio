/**
 * Colour. Print colours are authored and stored as CMYK (or spot) — the
 * screen representation is *derived* via the soft-proof transform below, so
 * the numbers that reach the press PDF are the numbers the user approved.
 * RGB sources (brand hex values, photographs on screen) are converted with
 * the single deterministic transform here; there is no second code path.
 */

export type CMYK = [number, number, number, number]; // each 0..1

export type Color =
  | { space: 'cmyk'; v: CMYK }
  | { space: 'spot'; name: string; alt: CMYK; tint: number }
  | { space: 'registration' }; // crop/registration marks only — all plates

export const cmyk = (c: number, m: number, y: number, k: number): Color => ({
  space: 'cmyk',
  v: [c, m, y, k],
});

export const BLACK: Color = cmyk(0, 0, 0, 1);
export const PAPER: Color = cmyk(0, 0, 0, 0);
/** Rich black for large solids — never for body text. */
export const RICH_BLACK: Color = cmyk(0.6, 0.4, 0.4, 1);

export function spot(name: string, alt: CMYK, tint = 1): Color {
  return { space: 'spot', name, alt, tint };
}

/** True when a colour is pure K — drives automatic black overprint. */
export function isPureBlack(c: Color): boolean {
  return c.space === 'cmyk' && c.v[0] === 0 && c.v[1] === 0 && c.v[2] === 0 && c.v[3] > 0;
}

export function inkCoverage(c: Color): number {
  const v = effectiveCmyk(c);
  return (v[0] + v[1] + v[2] + v[3]) * 100; // percent
}

export function effectiveCmyk(c: Color): CMYK {
  switch (c.space) {
    case 'cmyk':
      return c.v;
    case 'spot':
      return [c.alt[0] * c.tint, c.alt[1] * c.tint, c.alt[2] * c.tint, c.alt[3] * c.tint];
    case 'registration':
      return [1, 1, 1, 1];
  }
}

/* ------------------------------------------------------------------ */
/* RGB <-> CMYK                                                        */
/* ------------------------------------------------------------------ */

export type RGB = [number, number, number]; // each 0..1, sRGB

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : 1 * v);

/**
 * sRGB -> CMYK with moderate grey-component replacement and a gentle tone
 * curve on K to keep shadows from plugging. Deterministic; used for brand
 * hex colours and as the working transform for soft proofing symmetry.
 */
export function rgbToCmyk([r, g, b]: RGB): CMYK {
  const k = 1 - Math.max(r, g, b);
  if (k >= 0.999) return [0, 0, 0, 1];
  const c = (1 - r - k) / (1 - k);
  const m = (1 - g - k) / (1 - k);
  const y = (1 - b - k) / (1 - k);
  // GCR: replace shared component with K at 80% strength.
  const grey = Math.min(c, m, y);
  const gcr = grey * 0.8;
  return [
    clamp01(c - gcr),
    clamp01(m - gcr),
    clamp01(y - gcr),
    clamp01(k + gcr * (1 - k)),
  ];
}

/** Soft-proof: CMYK -> sRGB for on-screen display. Inverse-consistent with rgbToCmyk. */
export function cmykToRgb([c, m, y, k]: CMYK): RGB {
  return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function hexToCmyk(hex: string): Color {
  return { space: 'cmyk', v: rgbToCmyk(hexToRgb(hex)) };
}

/** Screen colour of any print colour — THE soft-proof used by every painter. */
export function colorToScreenRgb(c: Color): RGB {
  return cmykToRgb(effectiveCmyk(c));
}

export function colorToCss(c: Color, alpha = 1): string {
  const [r, g, b] = colorToScreenRgb(c);
  const to255 = (v: number) => Math.round(clamp01(v) * 255);
  return alpha >= 1
    ? `rgb(${to255(r)},${to255(g)},${to255(b)})`
    : `rgba(${to255(r)},${to255(g)},${to255(b)},${alpha})`;
}

/** Perceived lightness 0..1 of a print colour (for scrim/contrast decisions). */
export function colorLuminance(c: Color): number {
  const [r, g, b] = colorToScreenRgb(c);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Mix two CMYK colours in CMYK space. t = 0 → a, 1 → b. */
export function mixCmyk(a: Color, b: Color, t: number): Color {
  const va = effectiveCmyk(a);
  const vb = effectiveCmyk(b);
  return {
    space: 'cmyk',
    v: [
      va[0] + (vb[0] - va[0]) * t,
      va[1] + (vb[1] - va[1]) * t,
      va[2] + (vb[2] - va[2]) * t,
      va[3] + (vb[3] - va[3]) * t,
    ],
  };
}

/** Tint toward paper. t = 0 → paper, 1 → full colour. */
export function tintColor(c: Color, t: number): Color {
  if (c.space === 'spot') return { ...c, tint: c.tint * t };
  return mixCmyk(PAPER, c, t);
}
