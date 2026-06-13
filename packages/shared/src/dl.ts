/**
 * The display list — the single layout model.
 *
 * `compileEdition()` (in @guide/engine) is the only producer of geometry in
 * the system. Every consumer — the studio canvas, the digital edition, the
 * press PDF writer, the screen-proof writer — is a *painter* of this IR and
 * adds no geometry of its own. That is the editor↔press parity guarantee.
 *
 * Coordinates: PDF points, top-left origin, y down. Page space includes
 * bleed: (0,0) is the top-left of the BLEED box; the trim box starts at
 * (bleed, bleed). Painters that show only the trimmed page translate by
 * -bleed and clip.
 */

import type { Color } from './color.js';
import type { Mat2D, PathSpec, Rect } from './geometry.js';
import type { Diagnostic } from './diagnostics.js';

export interface GradientStop {
  at: number; // 0..1
  color: Color;
  alpha?: number; // 0..1, default 1
}

export interface LinearGradient {
  kind: 'linear';
  from: [number, number];
  to: [number, number];
  stops: GradientStop[];
}

export interface Fill {
  color?: Color;
  gradient?: LinearGradient;
  alpha?: number; // constant alpha, default 1
  rule?: 'nonzero' | 'evenodd';
  /** Explicit overprint; pure-K fills overprint automatically in press. */
  overprint?: boolean;
}

export interface Stroke {
  color: Color;
  width: number;
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
  dash?: number[];
  dashOffset?: number;
  alpha?: number;
}

/** One positioned glyph. x/y are the glyph origin in the item's local space. */
export interface PlacedGlyph {
  g: number; // glyph id in the run's font
  x: number;
  y: number;
}

export interface GlyphRun {
  font: string; // FontId, resolvable via FontCatalog
  size: number; // pt
  color: Color;
  glyphs: PlacedGlyph[];
  /** Source text of the run — for ActualText in PDF, selection, digital edition. */
  text: string;
  alpha?: number;
  /** Stroke-only or stroke+fill text (used for registration marks legends etc.) */
  stroke?: Stroke;
}

/**
 * Identifies what a display item was generated from, for hit-testing,
 * selection, and binding manual overrides. `frame` is the stable frame id
 * the item belongs to (see FrameRef in model.ts).
 */
export interface ItemMeta {
  frame?: string;
  role?: string; // e.g. 'listing-title', 'map-pin', 'map-label', 'scrim'
  data?: Record<string, string | number>;
}

export type DLItem =
  | {
      t: 'group';
      id?: string;
      transform?: Mat2D;
      clip?: PathSpec;
      alpha?: number;
      isolate?: boolean; // transparency group isolation
      children: DLItem[];
      meta?: ItemMeta;
    }
  | { t: 'path'; d: PathSpec; fill?: Fill; stroke?: Stroke; meta?: ItemMeta }
  | { t: 'text'; runs: GlyphRun[]; meta?: ItemMeta }
  | {
      t: 'image';
      /** Asset id, resolved by the painter's AssetResolver. */
      asset: string;
      /** Destination rect in local space. */
      rect: Rect;
      /**
       * Normalized source crop (0..1 of the source image) — non-destructive;
       * the painter samples this window of the original.
       */
      crop: { x: number; y: number; w: number; h: number };
      /** Effective resolution in dpi at this placement, for preflight. */
      dpi: number;
      meta?: ItemMeta;
    };

export interface PageRender {
  /** Stable page id from the edition's page list. */
  pageId: string;
  /** Trim size in pt. */
  trim: { w: number; h: number };
  /** Bleed in pt on every side. */
  bleed: number;
  /**
   * Which side this page falls on when bound (`left`/`right`), for gutter
   * logic and spread assembly. Cover is `right`, back cover `left`.
   */
  side: 'left' | 'right';
  /** Optional spread partner page id (two-page map). */
  spreadWith?: string;
  items: DLItem[];
}

export interface DocRender {
  editionId: string;
  pages: PageRender[];
  /** Fonts referenced by any glyph run, with usage for subsetting. */
  fontsUsed: Record<string, { glyphs: number[] }>;
  /** Assets referenced by any image item. */
  assetsUsed: string[];
  diagnostics: Diagnostic[];
}

/* ------------------------------------------------------------------ */

export function* walkItems(items: DLItem[]): Generator<DLItem> {
  for (const item of items) {
    yield item;
    if (item.t === 'group') yield* walkItems(item.children);
  }
}

export function collectFontUsage(pages: PageRender[]): Record<string, { glyphs: number[] }> {
  const usage = new Map<string, Set<number>>();
  for (const page of pages) {
    for (const item of walkItems(page.items)) {
      if (item.t !== 'text') continue;
      for (const run of item.runs) {
        let set = usage.get(run.font);
        if (!set) usage.set(run.font, (set = new Set()));
        for (const g of run.glyphs) set.add(g.g);
      }
    }
  }
  return Object.fromEntries(
    [...usage.entries()].map(([font, set]) => [font, { glyphs: [...set].sort((a, b) => a - b) }]),
  );
}

export function collectAssetUsage(pages: PageRender[]): string[] {
  const assets = new Set<string>();
  for (const page of pages) {
    for (const item of walkItems(page.items)) {
      if (item.t === 'image') assets.add(item.asset);
    }
  }
  return [...assets];
}
