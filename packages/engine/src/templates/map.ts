/**
 * Map wiring. The engine owns no cartography of its own; it builds the
 * MapEnv (palette tinted to the hotel brand, the single label-shaping path,
 * page geometry, numbered listings whose numbers are the canonical ones) and
 * hands it to the injected `compileMap`. Pins reuse the tier colours of the
 * number badges, so a pin, its legend row and the in-guide reference always
 * carry one identical number.
 */

import {
  cmyk,
  mixCmyk,
  numberedListings,
  rectPath,
  tintColor,
  type Color,
  type Edition,
  type FrameOverride,
  type GlyphRun,
  type OpenTypeFeatures,
  type PlacedGlyph,
} from '@guide/shared';
import type { MapEnv, MapListing, MapPageEnv, MapPalette, ShapedLabel } from '@guide/carto';
import type { GuideTheme } from '../theme.js';
import type { FontManager } from '../fonts.js';
import type { BusinessCatalog } from '../types.js';
import type { PageBuilder } from '../builder.js';
import { P } from './helpers.js';

/** Cartographic palette: neutral base mixed toward the hotel brand by `tint`. */
export function mapPaletteFromTheme(theme: GuideTheme, tint: number): MapPalette {
  const c = theme.colors;
  const k = (v: number) => cmyk(0, 0, 0, v);
  const baseWater = cmyk(0.22, 0.07, 0.05, 0.0);
  const basePark = cmyk(0.14, 0.0, 0.2, 0.0);
  const t = Math.max(0, Math.min(1, tint));

  return {
    land: tintColor(c.primary, 0.03 * t),
    water: mixCmyk(baseWater, c.primary, 0.3 * t),
    park: mixCmyk(basePark, c.accent, 0.25 * t),
    sand: mixCmyk(cmyk(0.04, 0.07, 0.18, 0.0), c.accent, 0.2 * t),
    roadMajor: k(0.0),
    roadMinor: k(0.0),
    roadCasing: mixCmyk(k(0.2), c.primary, 0.25 * t),
    rail: k(0.45),
    building: mixCmyk(k(0.07), c.primary, 0.15 * t),
    labelText: c.ink,
    labelWater: mixCmyk(c.primary, k(0.5), 0.4),
    labelHalo: c.paper,
    pin: { ...c.tier },
    pinNumber: c.paper,
    hotel: c.primaryDeep,
    legendBg: c.paper,
    legendText: c.ink,
    attribution: c.inkFaint,
  };
}

/** The single label-shaping closure injected into carto. */
export function makeShapeLabel(fonts: FontManager) {
  return (
    text: string,
    fontId: string,
    size: number,
    color: Color,
    letterSpacing?: number,
    features?: OpenTypeFeatures,
  ): ShapedLabel => {
    const glyphs = fonts.shape(fontId, text, { letterSpacing, features });
    const m = fonts.metrics(fontId);
    const s = size / m.unitsPerEm;
    const placed: PlacedGlyph[] = [];
    let x = 0;
    for (const g of glyphs) {
      placed.push({ g: g.id, x: x + g.xOffset * s, y: -g.yOffset * s });
      x += g.xAdvance * s;
    }
    const run: GlyphRun = { font: fontId, size, color, glyphs: placed, text };
    return {
      item: { t: 'text', runs: [run] },
      width: x,
      ascent: m.ascent * s,
      descent: -m.descent * s,
    };
  };
}

/** Numbered listings with coordinates — numbers are the canonical numbers. */
export function mapListings(ed: Edition, businesses: BusinessCatalog): MapListing[] {
  const out: MapListing[] = [];
  for (const { listing, number } of numberedListings(ed)) {
    const biz = businesses.get(listing.businessId);
    if (!biz) continue;
    out.push({
      listingId: listing.id,
      number,
      name: listing.copy?.name ?? biz.name,
      tier: listing.tier,
      lat: biz.lat,
      lng: biz.lng,
    });
  }
  return out;
}

export interface MapPageGeom {
  pageId: string;
  side: 'left' | 'right';
}

/** Assemble the MapEnv for one map (single page or two-page spread). */
export function buildMapEnv(
  ed: Edition,
  theme: GuideTheme,
  fonts: FontManager,
  businesses: BusinessCatalog,
  pages: MapPageGeom[],
  overrides: ReadonlyMap<string, FrameOverride>,
): MapEnv {
  const geo = theme.geo;
  const pageEnvs: MapPageEnv[] = pages.map((p) => ({
    pageId: p.pageId,
    side: p.side,
    rect: { x: 0, y: 0, w: geo.page.w, h: geo.page.h }, // full-bleed basemap
    trim: { w: geo.trim.w, h: geo.trim.h },
    bleed: geo.bleed,
  }));

  return {
    pages: pageEnvs,
    gutterWidth: pages.length > 1 ? geo.bleed * 2 + 10 : 0,
    palette: mapPaletteFromTheme(theme, ed.map.tint),
    fonts: {
      label: theme.font.sansMedium,
      labelStrong: theme.font.sansSemibold,
      legend: theme.font.sans,
      legendTitle: theme.font.sansSemibold,
      pinNumber: theme.font.sansSemibold,
      attribution: theme.font.sans,
      labelWater: theme.font.textItalic,
    },
    shapeLabel: makeShapeLabel(fonts),
    listings: mapListings(ed, businesses),
    hotel: { name: ed.hotel.wordmark ?? ed.hotel.name, lat: hotelLat(ed), lng: hotelLng(ed) },
    overrides,
    attribution: '© OpenStreetMap contributors',
    legendTitle: 'In this guide',
  };
}

/** Hotel coordinates: explicit bbox centre, else the listings' centroid. */
function hotelLat(ed: Edition): number {
  if (ed.map.bbox) return (ed.map.bbox.minLat + ed.map.bbox.maxLat) / 2;
  return 0;
}
function hotelLng(ed: Edition): number {
  if (ed.map.bbox) return (ed.map.bbox.minLng + ed.map.bbox.maxLng) / 2;
  return 0;
}

/** Fallback when no map data/compiler is available — never a blank page. */
export function drawMapNotice(b: PageBuilder, message: string): void {
  const t = b.theme;
  const { page } = t.geo;
  b.add({ t: 'path', d: rectPath({ x: 0, y: 0, w: page.w, h: page.h }), fill: { color: t.colors.wash } });
  const c = t.geo.content(b.side);
  b.text(`map:notice:${b.pageId}`, { x: c.x, y: c.y + c.h / 2 - 20, w: c.w, h: 40 }, [
    P(t.styles.bodyRagged, message, { align: 'center', color: t.colors.inkSoft }),
  ]);
}
