/**
 * The guide theme — the printed artifact's design system. One theme is
 * derived per edition from the hotel's brand; every template draws its
 * colours, type styles and page geometry from here, never ad hoc.
 *
 * Voice: editorial and calm. Fraunces for display, Source Serif for text,
 * Archivo for the typographic "hardware" (labels, numbers, folios).
 */

import {
  BLACK,
  cmyk,
  hexToCmyk,
  mixCmyk,
  mm,
  spot,
  tintColor,
  type Color,
  type Edition,
  type FontFace,
  type ParagraphStyle,
  type Rect,
  type Tier,
} from '@guide/shared';

export interface PageGeometry {
  /** Trim size in pt. */
  trim: { w: number; h: number };
  bleed: number;
  /** Full painted page (trim + bleed each side). */
  page: { w: number; h: number };
  /** Margins from the trim edges. */
  margins: { top: number; bottom: number; inner: number; outer: number };
  /** Content rect for a given binding side, in page space (bleed-inclusive). */
  content(side: 'left' | 'right'): Rect;
  /** Page-space x/y of the trim box origin. */
  trimOrigin: { x: number; y: number };
  baselineGrid: number;
  /** Grid origin (page-space y of the trim top). */
  gridOrigin: number;
}

export interface GuideColors {
  paper: Color;
  ink: Color;
  inkSoft: Color; // 62% K — secondary text
  inkFaint: Color; // 30% K — hairlines
  primary: Color;
  secondary: Color;
  accent: Color;
  /** Deep variant of primary for scrims/fields. */
  primaryDeep: Color;
  /** The brand field used on cover/dividers: the spot ink when declared. */
  brandField: Color;
  /** Quiet wash of primary for backgrounds. */
  wash: Color;
  tier: Record<Tier, Color>;
}

export interface GuideTheme {
  colors: GuideColors;
  geo: PageGeometry;
  font: {
    display: string;
    displayItalic: string;
    text: string;
    textItalic: string;
    textSemibold: string;
    sans: string;
    sansMedium: string;
    sansSemibold: string;
    sansNarrow: string;
    sansNarrowSemibold: string;
  };
  /** Paragraph style factories — single source of typographic truth. */
  styles: ReturnType<typeof makeStyles>;
}

/* ------------------------------------------------------------------ */

function findFaceId(faces: FontFace[], family: string, weight: number, italic = false): string {
  let best: FontFace | undefined;
  let dist = Infinity;
  for (const f of faces) {
    if (f.family !== family || f.italic !== italic) continue;
    const d = Math.abs(f.weight - weight);
    if (d < dist) {
      best = f;
      dist = d;
    }
  }
  if (!best) throw new Error(`No face for ${family} ${weight}${italic ? ' italic' : ''}`);
  return best.id;
}

export function makeGeometry(settings: Edition['settings']): PageGeometry {
  const trim = { w: mm(settings.trimWidthMm), h: mm(settings.trimHeightMm) };
  const bleed = mm(settings.bleedMm);
  const margins = { top: mm(12), bottom: mm(14), inner: mm(12), outer: mm(9) };
  return {
    trim,
    bleed,
    page: { w: trim.w + 2 * bleed, h: trim.h + 2 * bleed },
    margins,
    trimOrigin: { x: bleed, y: bleed },
    baselineGrid: settings.baselineGridPt,
    gridOrigin: bleed,
    content(side) {
      const left = side === 'right' ? margins.inner : margins.outer;
      const right = side === 'right' ? margins.outer : margins.inner;
      return {
        x: bleed + left,
        y: bleed + margins.top,
        w: trim.w - left - right,
        h: trim.h - margins.top - margins.bottom,
      };
    },
  };
}

function makeColors(edition: Edition): GuideColors {
  const brand = edition.hotel.brand;
  const primary = hexToCmyk(brand.primary);
  const secondary = hexToCmyk(brand.secondary);
  const accent = hexToCmyk(brand.accent);
  const spotDef = edition.settings.spotColor;
  const brandField = spotDef
    ? spot(spotDef.name, (hexToCmyk(spotDef.altHex) as { space: 'cmyk'; v: [number, number, number, number] }).v)
    : primary;
  return {
    paper: cmyk(0, 0, 0, 0),
    ink: BLACK,
    inkSoft: cmyk(0, 0, 0, 0.62),
    inkFaint: cmyk(0, 0, 0, 0.3),
    primary,
    secondary,
    accent,
    primaryDeep: mixCmyk(primary, BLACK, 0.35),
    brandField,
    wash: tintColor(primary, 0.07),
    tier: {
      full: primary,
      half: secondary,
      quarter: mixCmyk(accent, BLACK, 0.18),
      list: cmyk(0, 0, 0, 0.72),
    },
  };
}

/* ------------------------------------------------------------------ */

function makeStyles(font: GuideTheme['font'], colors: GuideColors) {
  const base = (over: Partial<ParagraphStyle> & Pick<ParagraphStyle, 'size' | 'leading'>): ParagraphStyle => ({
    font: { role: 'text', weight: 400 },
    align: 'left',
    color: colors.ink,
    ...over,
  });
  const display: ParagraphStyle['font'] = { role: 'display', weight: 600 };
  const sansLabel: ParagraphStyle['font'] = { role: 'sans', weight: 600 };
  const sansMeta: ParagraphStyle['font'] = { role: 'sans', weight: 500 };
  return {
    /** Divider display — large Fraunces, tight. */
    display: (size = 40) =>
      base({ font: display, size, leading: size * 1.02, color: colors.paper, features: { liga: true } }),
    /** Page heading (welcome, keys). */
    h1: base({ font: display, size: 17.5, leading: 23 }),
    /** Listing name by tier. */
    nameFull: base({ font: display, size: 16.5, leading: 19 }),
    nameHalf: base({ font: display, size: 11.5, leading: 13.5 }),
    nameQuarter: base({ font: display, size: 9.5, leading: 11.5 }),
    /** Kicker / section label — tracked caps. */
    kicker: base({ font: sansLabel, size: 6.6, leading: 9, tracking: 145, caps: true, color: colors.secondary }),
    /** Body text — justified with hyphenation, on the grid. */
    body: base({
      size: 8.5,
      leading: 11.5,
      align: 'justify',
      hyphenate: true,
      snapToGrid: true,
      noRunts: true,
      features: { onum: true, liga: true },
    }),
    /** Body, ragged (short blocks, hotel info). */
    bodyRagged: base({
      size: 8.5,
      leading: 11.5,
      hyphenate: true,
      snapToGrid: true,
      noRunts: true,
      features: { onum: true, liga: true },
    }),
    /** One-liner — serif italic. */
    oneLiner: base({ font: { role: 'text', weight: 400, italic: true }, size: 8.6, leading: 11, color: colors.inkSoft }),
    /** Meta lines (address, phone) — small tracked caps. */
    meta: base({ font: sansMeta, size: 6.2, leading: 9.5, tracking: 65, caps: true, color: colors.inkSoft }),
    /** Folio / running foot. */
    folio: base({ font: sansMeta, size: 6.4, leading: 8, tracking: 85, caps: true, color: colors.inkSoft }),
    /** Stay-essentials table. */
    tableLabel: base({ font: sansLabel, size: 6.4, leading: 11.5, tracking: 110, caps: true, color: colors.inkSoft }),
    tableValue: base({ size: 8.2, leading: 11.5, features: { onum: true } }),
    /** Welcome intro — larger serif. */
    intro: base({ size: 10.5, leading: 15, color: colors.ink }),
  };
}

/* ------------------------------------------------------------------ */

export function makeTheme(edition: Edition, faces: FontFace[]): GuideTheme {
  const geo = makeGeometry(edition.settings);
  const colors = makeColors(edition);
  const font = {
    display: findFaceId(faces, 'Fraunces', 600),
    displayItalic: findFaceId(faces, 'Fraunces', 600, true),
    text: findFaceId(faces, 'Source Serif 4', 400),
    textItalic: findFaceId(faces, 'Source Serif 4', 400, true),
    textSemibold: findFaceId(faces, 'Source Serif 4', 600),
    sans: findFaceId(faces, 'Archivo', 400),
    sansMedium: findFaceId(faces, 'Archivo', 500),
    sansSemibold: findFaceId(faces, 'Archivo', 600),
    sansNarrow: findFaceId(faces, 'Archivo Narrow', 500),
    sansNarrowSemibold: findFaceId(faces, 'Archivo Narrow', 600),
  };
  return { colors, geo, font, styles: makeStyles(font, colors) };
}

/** Font id for a style within this theme (paragraph styles carry roles). */
export function styleFontId(theme: GuideTheme, style: ParagraphStyle | { font: ParagraphStyle['font'] }): string {
  const sel = style.font;
  const { role, weight, italic } = sel;
  if (role === 'display') return italic ? theme.font.displayItalic : theme.font.display;
  if (role === 'sans') {
    if (weight >= 600) return theme.font.sansSemibold;
    if (weight >= 500) return theme.font.sansMedium;
    return theme.font.sans;
  }
  if (role === 'mono') return theme.font.sans; // mono unused in guides
  // text
  if (italic) return theme.font.textItalic;
  if (weight >= 600) return theme.font.textSemibold;
  return theme.font.text;
}
