/**
 * Web-Mercator projection fitted to the map canvas.
 *
 * The canvas is the union of MapEnv.pages rects laid out side-by-side in
 * spread order: for a spread the left page's map rect and the right page's
 * map rect butt against each other and form ONE continuous coordinate space
 * (origin at the combined rect's top-left). All geometry is computed once in
 * this space and split per page, which is what makes a road crossing the
 * fold align exactly at the shared bleed edges.
 *
 * The MapSpec bbox is fitted to COVER the canvas (preserve aspect, crop the
 * excess, centered — like `background-size: cover`).
 */

import type { BBox, Rect, Vec2 } from '@guide/shared';
import type { MapPageEnv } from './types.js';

const EARTH_CIRCUMFERENCE_M = 40075016.686;

/** Ground resolution (m/pt) the road width tables are designed for. */
export const REF_METRES_PER_PT = 2.4;

/** Normalized Web-Mercator x, 0..1 across the full globe. */
export function mercatorX(lng: number): number {
  return (lng + 180) / 360;
}

/** Normalized Web-Mercator y, 0..1, y DOWN (matches page space). */
export function mercatorY(lat: number): number {
  const phi = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2;
}

export interface PagePlacement {
  pageId: string;
  side: 'left' | 'right';
  /** The page's map rect, in its own page space (bleed-inclusive coords). */
  rect: Rect;
  trim: { w: number; h: number };
  bleed: number;
  /** Canvas x at which this page's map rect begins. */
  spanX: number;
}

export interface MapProjection {
  /** Combined canvas rect, origin (0,0). */
  canvas: Rect;
  pages: PagePlacement[];
  /** Canvas x of the page junction on spreads (null for single pages). */
  foldX: number | null;
  /** Ground resolution at the bbox centre, metres per pt. */
  metresPerPt: number;
  /** Stroke-width multiplier derived from metresPerPt, clamped 0.75–1.35. */
  widthScale: number;
  latLngToCanvas(lat: number, lng: number): Vec2;
  /** Canvas-space rect of an arbitrary lat/lng bbox. */
  bboxToCanvasRect(b: BBox): Rect;
  /** Index of the page whose canvas span contains x (clamped to ends). */
  pageIndexAt(x: number): number;
  /** Canvas space → the page's local (page) space. */
  canvasToPage(pageIndex: number, p: Vec2): Vec2;
  /** Page-local space → canvas space. */
  pageToCanvas(pageIndex: number, p: Vec2): Vec2;
  canvasRectToPage(pageIndex: number, r: Rect): Rect;
  pageRectToCanvas(pageIndex: number, r: Rect): Rect;
  /** The page's trim box, expressed in canvas coordinates. */
  trimRectCanvas(pageIndex: number): Rect;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function createProjection(pages: MapPageEnv[], bbox: BBox): MapProjection {
  if (pages.length === 0) throw new Error('createProjection: MapEnv.pages is empty');

  const placements: PagePlacement[] = [];
  let spanX = 0;
  for (const p of pages) {
    placements.push({
      pageId: p.pageId,
      side: p.side,
      rect: p.rect,
      trim: p.trim,
      bleed: p.bleed,
      spanX,
    });
    spanX += p.rect.w;
  }
  const canvasW = spanX;
  const canvasH = Math.max(...pages.map((p) => p.rect.h));
  const canvas: Rect = { x: 0, y: 0, w: canvasW, h: canvasH };

  // Fit the bbox to cover the canvas, centred.
  const mx0 = mercatorX(bbox.minLng);
  const mx1 = mercatorX(bbox.maxLng);
  const my0 = mercatorY(bbox.maxLat); // top (smaller y)
  const my1 = mercatorY(bbox.minLat);
  const mw = mx1 - mx0;
  const mh = my1 - my0;
  if (mw <= 0 || mh <= 0) throw new Error('createProjection: degenerate bbox');
  const scale = Math.max(canvasW / mw, canvasH / mh);
  const ox = (canvasW - mw * scale) / 2 - mx0 * scale;
  const oy = (canvasH - mh * scale) / 2 - my0 * scale;

  const centerLat = (bbox.minLat + bbox.maxLat) / 2;
  const metresPerPt = (EARTH_CIRCUMFERENCE_M * Math.cos((centerLat * Math.PI) / 180)) / scale;
  const widthScale = clamp(Math.sqrt(REF_METRES_PER_PT / metresPerPt), 0.75, 1.35);

  const latLngToCanvas = (lat: number, lng: number): Vec2 => ({
    x: mercatorX(lng) * scale + ox,
    y: mercatorY(lat) * scale + oy,
  });

  const pageIndexAt = (x: number): number => {
    for (let i = placements.length - 1; i >= 1; i--) {
      if (x >= placements[i]!.spanX) return i;
    }
    return 0;
  };

  const canvasToPage = (i: number, p: Vec2): Vec2 => {
    const pl = placements[i]!;
    return { x: p.x - pl.spanX + pl.rect.x, y: p.y + pl.rect.y };
  };

  const pageToCanvas = (i: number, p: Vec2): Vec2 => {
    const pl = placements[i]!;
    return { x: p.x + pl.spanX - pl.rect.x, y: p.y - pl.rect.y };
  };

  return {
    canvas,
    pages: placements,
    foldX: placements.length === 2 ? placements[1]!.spanX : null,
    metresPerPt,
    widthScale,
    latLngToCanvas,
    bboxToCanvasRect(b: BBox): Rect {
      const tl = latLngToCanvas(b.maxLat, b.minLng);
      const br = latLngToCanvas(b.minLat, b.maxLng);
      return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
    },
    pageIndexAt,
    canvasToPage,
    pageToCanvas,
    canvasRectToPage(i: number, r: Rect): Rect {
      const p = canvasToPage(i, { x: r.x, y: r.y });
      return { x: p.x, y: p.y, w: r.w, h: r.h };
    },
    pageRectToCanvas(i: number, r: Rect): Rect {
      const p = pageToCanvas(i, { x: r.x, y: r.y });
      return { x: p.x, y: p.y, w: r.w, h: r.h };
    },
    trimRectCanvas(i: number): Rect {
      const pl = placements[i]!;
      const p = pageToCanvas(i, { x: pl.bleed, y: pl.bleed });
      return { x: p.x, y: p.y, w: pl.trim.w, h: pl.trim.h };
    },
  };
}
