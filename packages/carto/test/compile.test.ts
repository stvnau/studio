/**
 * compileMap — end-to-end cartography tests.
 *
 * We build a real `shapeLabel` from the shared FontManager (the single shaping
 * path), compile the pelican-point fixture for both a single map page and a
 * two-page spread, render the resulting display lists to SVG via @guide/paint
 * (writing them to test/out for visual inspection), and assert the placement
 * invariants that define a correct, collision-free map.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { FontManager } from '@guide/engine';
import { NodeFontSource } from '@guide/fonts/node';
import { paintPageSvg } from '@guide/paint';
import {
  mm,
  rectsIntersect,
  type Color,
  type DLItem,
  type GlyphRun,
  type PageRender,
  type Rect,
} from '@guide/shared';

import { compileMap, fixtureSource } from '../src/index.js';
import type {
  MapEnv,
  MapListing,
  MapPageEnv,
  MapPalette,
  MapResult,
  ShapedLabel,
} from '../src/index.js';

/* ------------------------------------------------------------------ */
/* Harness: fonts, palette, env construction                           */
/* ------------------------------------------------------------------ */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const OUT = resolve(HERE, 'out');

const FONTS = {
  label: 'archivonarrow-500',
  labelStrong: 'archivonarrow-600',
  legend: 'archivonarrow-500',
  legendTitle: 'archivonarrow-600',
  pinNumber: 'archivo-600',
  attribution: 'archivonarrow-400',
  labelWater: 'newsreader-400i',
};

let fm: FontManager;

beforeAll(async () => {
  fm = new FontManager(new NodeFontSource());
  await fm.ensure(Object.values(FONTS));
  mkdirSync(OUT, { recursive: true });
});

/** Build a single-shaping `shapeLabel` closure backed by the FontManager. */
function makeShapeLabel(): MapEnv['shapeLabel'] {
  return (text, font, size, color, letterSpacing, features): ShapedLabel => {
    const m = fm.metrics(font);
    const s = size / m.unitsPerEm;
    const glyphs = fm.shape(font, text, { letterSpacing, features });
    let x = 0;
    const placed = glyphs.map((g) => {
      const gx = x + g.xOffset * s;
      x += g.xAdvance * s;
      return { g: g.id, x: gx, y: -g.yOffset * s };
    });
    const run: GlyphRun = { font, size, color, glyphs: placed, text };
    const item: Extract<DLItem, { t: 'text' }> = { t: 'text', runs: [run] };
    return {
      item,
      width: x,
      ascent: m.ascent * s,
      descent: m.descent * s, // negative
    };
  };
}

/** A neutral basemap palette, tinted to the demo hotel's brand colours. */
function palette(): MapPalette {
  const cmyk = (c: number, m: number, y: number, k: number): Color => ({ space: 'cmyk', v: [c, m, y, k] });
  // Hotel brand: primary #1B423B (deep green), secondary #B65C3F (terracotta),
  // accent #C99B5F (sand). Expressed directly as gentle CMYK tints here.
  return {
    land: cmyk(0.02, 0.02, 0.06, 0.0),
    water: cmyk(0.16, 0.04, 0.05, 0.02),
    park: cmyk(0.14, 0.0, 0.18, 0.02),
    sand: cmyk(0.04, 0.06, 0.18, 0.0),
    roadMajor: cmyk(0.0, 0.0, 0.0, 0.28),
    roadMinor: cmyk(0.0, 0.0, 0.0, 0.18),
    roadCasing: cmyk(0.0, 0.0, 0.0, 0.08),
    rail: cmyk(0.0, 0.0, 0.0, 0.55),
    building: cmyk(0.02, 0.03, 0.07, 0.06),
    labelText: cmyk(0.55, 0.45, 0.4, 0.65),
    labelWater: cmyk(0.6, 0.3, 0.15, 0.3),
    labelHalo: cmyk(0.0, 0.0, 0.0, 0.0),
    pin: {
      full: cmyk(0.6, 0.32, 0.5, 0.5), // deep green
      half: cmyk(0.18, 0.62, 0.7, 0.1), // terracotta
      quarter: cmyk(0.1, 0.32, 0.62, 0.0), // sand
      list: cmyk(0.0, 0.0, 0.0, 0.5), // grey
    },
    pinNumber: cmyk(0, 0, 0, 0), // paper (knockout)
    hotel: cmyk(0.18, 0.62, 0.7, 0.1),
    legendBg: cmyk(0.0, 0.0, 0.0, 0.0),
    legendText: cmyk(0.55, 0.45, 0.4, 0.7),
    attribution: cmyk(0.0, 0.0, 0.0, 0.45),
  };
}

/** Load the demo edition's listings + hotel from the seed. */
function seedListingsAndHotel(): { listings: MapListing[]; hotel: MapEnv['hotel'] } {
  const seed = JSON.parse(readFileSync(resolve(ROOT, 'fixtures/demo/seed.json'), 'utf8'));
  const ed = seed.editions[0];
  const biz: Record<string, { name: string; lat: number; lng: number }> = {};
  for (const b of seed.businesses) biz[b.id] = { name: b.name, lat: b.lat, lng: b.lng };
  const tierOf: Record<string, MapListing['tier']> = {};
  for (const l of ed.listings) tierOf[l.id] = l.tier;
  const listings: MapListing[] = ed.listingOrder.map((id: string, i: number) => {
    const l = ed.listings.find((x: { id: string }) => x.id === id);
    const b = biz[l.businessId]!;
    return { listingId: id, number: i + 1, name: b.name, tier: tierOf[id]!, lat: b.lat, lng: b.lng };
  });
  const hotel = { name: ed.hotel.name, lat: -33.8423, lng: 151.281 };
  return { listings, hotel };
}

const TRIM = { w: mm(100), h: mm(200) };
const BLEED = mm(3);
const PAGE_W = TRIM.w + 2 * BLEED;
const PAGE_H = TRIM.h + 2 * BLEED;
/** A full-bleed map rect (the whole bleed box, in page space). */
const FULL_MAP: Rect = { x: 0, y: 0, w: PAGE_W, h: PAGE_H };

function singlePageEnv(): MapEnv {
  const page: MapPageEnv = {
    pageId: 'p-map',
    side: 'right',
    rect: FULL_MAP,
    trim: TRIM,
    bleed: BLEED,
  };
  const { listings, hotel } = seedListingsAndHotel();
  return baseEnv([page], 0, listings, hotel);
}

function spreadEnv(): MapEnv {
  const left: MapPageEnv = {
    pageId: 'p-map-l',
    side: 'left',
    rect: FULL_MAP,
    trim: TRIM,
    bleed: BLEED,
  };
  const right: MapPageEnv = {
    pageId: 'p-map-r',
    side: 'right',
    rect: FULL_MAP,
    trim: TRIM,
    bleed: BLEED,
  };
  const { listings, hotel } = seedListingsAndHotel();
  return baseEnv([left, right], mm(12), listings, hotel);
}

function baseEnv(
  pages: MapPageEnv[],
  gutterWidth: number,
  listings: MapListing[],
  hotel: MapEnv['hotel'],
): MapEnv {
  return {
    pages,
    gutterWidth,
    palette: palette(),
    fonts: FONTS,
    shapeLabel: makeShapeLabel(),
    listings,
    hotel,
    overrides: new Map(),
    attribution: '© OpenStreetMap contributors',
    legendTitle: 'In this guide',
  };
}

async function loadOsm() {
  return fixtureSource('fixture:pelican-point').fetch({
    minLat: -33.8466,
    minLng: 151.2762,
    maxLat: -33.8374,
    maxLng: 151.2878,
  });
}

/** Paint one page of a result to SVG and return the string. */
function pageSvg(result: MapResult, page: MapPageEnv): string {
  const render: PageRender = {
    pageId: page.pageId,
    trim: page.trim,
    bleed: page.bleed,
    side: page.side,
    items: result.perPage[page.pageId] ?? [],
  };
  return paintPageSvg(render, {
    glyphPath: (font, gid) => fm.glyphPath(font, gid),
    unitsPerEm: (font) => fm.metrics(font).unitsPerEm,
    assetUrl: () => '',
    showBleed: true,
    background: '#fbfaf7',
  });
}

/* ------------------------------------------------------------------ */
/* Collision helpers for assertions                                    */
/* ------------------------------------------------------------------ */

function framesOfKind(result: MapResult, kind: string) {
  return result.frames.filter((f) => f.kind === kind);
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('compileMap', () => {
  it('renders a handsome single map page (SVG written)', async () => {
    const env = singlePageEnv();
    const osm = await loadOsm();
    const result = compileMap(osm, env);

    const svg = pageSvg(result, env.pages[0]!);
    writeFileSync(resolve(OUT, 'single.svg'), svg);
    expect(svg).toContain('<svg');
    // The map drew real geometry (more than just the background rect).
    expect((svg.match(/<path/g) ?? []).length).toBeGreaterThan(30);
  });

  it('gives every listing exactly one pin with its canonical number', async () => {
    const env = singlePageEnv();
    const result = compileMap(await loadOsm(), env);

    const pinFrames = framesOfKind(result, 'map-pin');
    for (const l of env.listings) {
      const f = pinFrames.filter((p) => p.frame === `map:pin:${l.listingId}`);
      expect(f.length, `one pin for ${l.listingId}`).toBe(1);
    }
    // Plus the hotel marker — and no extras.
    expect(pinFrames.filter((p) => p.frame === 'map:pin:hotel').length).toBe(1);
    expect(pinFrames.length).toBe(env.listings.length + 1);

    // The number rendered inside each pin equals the canonical number, and the
    // canonical numbers are exactly 1..N with no gaps or duplicates.
    const numbers = env.listings.map((l) => l.number).sort((a, b) => a - b);
    expect(numbers).toEqual(env.listings.map((_, i) => i + 1));
  });

  it('places no two labels overlapping each other', async () => {
    const env = singlePageEnv();
    const result = compileMap(await loadOsm(), env);
    const labels = framesOfKind(result, 'map-label').map((f) => f.rect);
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        expect(
          rectsIntersect(labels[i]!, labels[j]!),
          `labels ${i} and ${j} overlap`,
        ).toBe(false);
      }
    }
    // And we actually placed some labels (not a vacuous pass).
    expect(labels.length).toBeGreaterThan(3);
  });

  it('always renders attribution and does not flag it', async () => {
    const env = singlePageEnv();
    const result = compileMap(await loadOsm(), env);
    expect(framesOfKind(result, 'map-attribution').length).toBe(1);
    expect(result.diagnostics.some((d) => d.code === 'map.attribution')).toBe(false);
  });

  it('flags empty OSM data with map.data-empty', async () => {
    const env = singlePageEnv();
    const result = compileMap({ elements: [] }, env);
    expect(result.diagnostics.some((d) => d.code === 'map.data-empty')).toBe(true);
    // Pins and legend still render on an empty basemap.
    expect(framesOfKind(result, 'map-pin').length).toBe(env.listings.length + 1);
    expect(framesOfKind(result, 'map-legend').length).toBe(1);
  });

  it('keeps every pin inside the trim box and out of the gutter (spread, SVGs written)', async () => {
    const env = spreadEnv();
    const osm = await loadOsm();
    const result = compileMap(osm, env);

    // Write both halves for inspection.
    writeFileSync(resolve(OUT, 'spread-left.svg'), pageSvg(result, env.pages[0]!));
    writeFileSync(resolve(OUT, 'spread-right.svg'), pageSvg(result, env.pages[1]!));

    const trimRect: Rect = { x: BLEED, y: BLEED, w: TRIM.w, h: TRIM.h };
    const pinFrames = framesOfKind(result, 'map-pin');
    expect(pinFrames.length).toBe(env.listings.length + 1);

    for (const f of pinFrames) {
      // Pin frame rect must sit fully inside the trim box of its page.
      const r = f.rect;
      expect(r.x).toBeGreaterThanOrEqual(trimRect.x - 0.5);
      expect(r.y).toBeGreaterThanOrEqual(trimRect.y - 0.5);
      expect(r.x + r.w).toBeLessThanOrEqual(trimRect.x + trimRect.w + 0.5);
      expect(r.y + r.h).toBeLessThanOrEqual(trimRect.y + trimRect.h + 0.5);
    }

    // None of the pins fall in the gutter band. The gutter straddles the fold;
    // on a full-bleed spread the fold is the inner trim edge of each page (the
    // left page's right edge, the right page's left edge). A pin on the left
    // page must keep gutterWidth/2 clear of x = trim.x + trim.w; one on the
    // right page must keep clear of x = trim.x.
    const half = env.gutterWidth / 2;
    for (const f of pinFrames) {
      const r = f.rect;
      if (f.pageId === env.pages[0]!.pageId) {
        const innerEdge = trimRect.x + trimRect.w;
        expect(r.x + r.w, `left-page pin clear of gutter`).toBeLessThanOrEqual(innerEdge - half + 0.5);
      } else {
        const innerEdge = trimRect.x;
        expect(r.x, `right-page pin clear of gutter`).toBeGreaterThanOrEqual(innerEdge + half - 0.5);
      }
    }
  });

  it('honours a pin override (manual wins, no auto-placement)', async () => {
    const env = spreadEnv();
    const target = env.listings[0]!;
    const overrideX = BLEED + 40;
    const overrideY = BLEED + 60;
    const overrides = new Map(env.overrides);
    overrides.set(`map:pin:${target.listingId}`, {
      frame: `map:pin:${target.listingId}`,
      patch: { x: overrideX, y: overrideY },
      base: { x: 0, y: 0, w: 16, h: 18 },
      at: '2026-06-13T00:00:00Z',
    });
    const result = compileMap(await loadOsm(), { ...env, overrides });
    const f = framesOfKind(result, 'map-pin').find(
      (p) => p.frame === `map:pin:${target.listingId}`,
    );
    expect(f).toBeDefined();
    // The pin lands at (near) the override position on the left page.
    expect(f!.pageId).toBe(env.pages[0]!.pageId);
    expect(Math.abs(f!.rect.x - overrideX)).toBeLessThan(PIN_TOL);
    expect(Math.abs(f!.rect.y - overrideY)).toBeLessThan(PIN_TOL);
  });
});

const PIN_TOL = 12;
