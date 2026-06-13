/**
 * compileMap — the cartography orchestrator.
 *
 * Turns OSM data + listings into styled, collision-free display-list
 * fragments for a single map page or a two-page spread. Everything is laid
 * out ONCE in the projection's continuous canvas space (so a road, a label or
 * a pin straddling the fold lines up exactly), then split and clipped per
 * page into local page space.
 *
 * Draw order (per page): land → water → parks → sand → buildings → rail →
 * road casings → road fills → piers → labels → pins → legend → attribution.
 */

import RBush from 'rbush';
import {
  pathBounds,
  rectPath,
  rectsIntersect,
  type Diagnostic,
  type DLItem,
  type PathSpec,
  type Rect,
  type Vec2,
} from '@guide/shared';
import { createProjection, type MapProjection } from './project.js';
import {
  classifyFeatures,
  pathStroke,
  pierStroke,
  railStrokes,
  roadStyle,
  ROAD_CLASSES,
  type RoadClass,
} from './style.js';
import {
  placeLabels,
  rectToBox,
  type LabelBox,
  type LabelRequest,
} from './labels.js';
import {
  buildHotelMarker,
  buildPin,
  clampPinToRect,
  PIN_H,
  PIN_R,
  pinBox,
  pushOutOfGutter,
} from './pins.js';
import { buildLegend } from './legend.js';
import type { MapEnv, MapResult, PlacedFrame, ProjectedFeature } from './types.js';

/** Keep pins this far inside the trim edge (pt). */
const TRIM_MARGIN = 5;
/** Pin-vs-pin separation before we nudge (pt, centre distance). */
const PIN_NUDGE_DIST = PIN_R * 1.7;
/** Distance from true point past which a pin earns a leader line (pt). */
const LEADER_THRESHOLD = PIN_R * 1.6;

/* ------------------------------------------------------------------ */
/* Public entry                                                        */
/* ------------------------------------------------------------------ */

/**
 * Compile a styled map from OSM data and the page/listing environment.
 * `data` is the already-fetched OSM document (the caller resolves the source,
 * e.g. via `fixtureSource`); see `index.ts` for the convenience that pairs
 * the fixture loader with this.
 */
export function compileMap(data: OsmDataLike, env: MapEnv): MapResult {
  const diagnostics: Diagnostic[] = [];
  const frames: PlacedFrame[] = [];
  const perPage: Record<string, DLItem[]> = {};
  for (const p of env.pages) perPage[p.pageId] = [];

  const proj = createProjection(env.pages, bboxOf(env));

  // Empty data still yields a (blank) styled map, but is flagged.
  const elementCount = data.elements?.length ?? 0;
  if (elementCount === 0) {
    diagnostics.push({
      code: 'map.data-empty',
      severity: 'warning',
      message: 'No OSM features for this map area — only land, pins and the legend will draw.',
    });
  }

  // 1) Classify + project the basemap, then split/clip it per page.
  const features = classifyFeatures({ elements: data.elements ?? [] }, proj);
  emitBasemap(features, proj, env, perPage);

  // 2) Seed the shared collision index with pins (placed first so labels and
  //    the legend yield to them), then the legend, then labels.
  const index = new RBush<LabelBox>();

  const pinPlacements = placePins(env, proj, diagnostics, frames);
  for (const pp of pinPlacements) index.insert(rectToBox(pp.canvasBox, 'pin'));

  // 3) Legend — reserve its rect before labels so nothing lands under it.
  emitLegendAndAttribution(env, proj, index, perPage, frames, diagnostics);

  // 4) Labels — streets, areas, water — against the seeded index.
  emitLabels(features, env, proj, index, perPage, frames, diagnostics);

  // 5) Pins are drawn after labels (on top), split into their owning page.
  for (const pp of pinPlacements) emitSplit(pp.item, proj, env, perPage, pp.frameId, frames, pinBoxRect(pp.center));

  return { perPage, frames, diagnostics };
}

/** Minimal structural view of OsmData (lets an empty `{}` flow through). */
interface OsmDataLike {
  elements?: ProjectedInput[];
}
type ProjectedInput = Parameters<typeof classifyFeatures>[0]['elements'][number];

/* ------------------------------------------------------------------ */
/* Basemap                                                             */
/* ------------------------------------------------------------------ */

/**
 * Emit the basemap. Each page draws the land base, then every feature clipped
 * to that page's map rect and translated into page-local space. Geometry is
 * shared canvas geometry, so the two halves of a spread align at the fold.
 */
function emitBasemap(
  features: ProjectedFeature[],
  proj: MapProjection,
  env: MapEnv,
  perPage: Record<string, DLItem[]>,
): void {
  const ws = proj.widthScale;
  const palette = env.palette;

  env.pages.forEach((page, i) => {
    const items = perPage[page.pageId]!;
    const mapRect = page.rect;
    const clip = rectPath(mapRect);

    // Land base fills the whole map rect.
    items.push({ t: 'path', d: clip, fill: { color: palette.land } });

    // Collect styled paths in draw order, all clipped to this page.
    const layers: DLItem[] = [];
    const push = (
      kind: ProjectedFeature['kind'] | 'roadCasing' | 'roadFill',
      rc?: RoadClass,
    ) => {
      for (const f of features) {
        const local = toPageLocal(f.path, i, proj);
        if (!touchesRect(local, mapRect)) continue;
        const dl = styleFeature(f, kind, rc, palette, ws, local);
        if (dl) layers.push(dl);
      }
    };

    push('water');
    push('park');
    push('sand');
    push('building');
    push('rail');
    // Road casings (all classes) under all road fills, widest first.
    for (const rc of ROAD_CLASSES) push('roadCasing', rc);
    for (const rc of ROAD_CLASSES) push('roadFill', rc);
    push('path');
    push('pier');

    // One clipped group keeps the whole basemap inside the map rect.
    items.push({ t: 'group', clip, children: layers });
  });
}

/**
 * Produce the display item for `feature` in the requested draw layer, or null
 * if it does not belong to that layer. `local` is the page-local PathSpec.
 */
function styleFeature(
  f: ProjectedFeature,
  layer: ProjectedFeature['kind'] | 'roadCasing' | 'roadFill',
  rc: RoadClass | undefined,
  palette: MapEnv['palette'],
  ws: number,
  local: PathSpec,
): DLItem | null {
  switch (layer) {
    case 'water':
      return f.kind === 'water' ? { t: 'path', d: local, fill: { color: palette.water } } : null;
    case 'park':
      return f.kind === 'park' ? { t: 'path', d: local, fill: { color: palette.park } } : null;
    case 'sand':
      return f.kind === 'sand' && palette.sand
        ? { t: 'path', d: local, fill: { color: palette.sand } }
        : null;
    case 'building':
      return f.kind === 'building'
        ? { t: 'path', d: local, fill: { color: palette.building } }
        : null;
    case 'rail':
      if (f.kind !== 'rail') return null;
      return {
        t: 'group',
        children: railStrokes(palette, ws).map((s) => ({ t: 'path', d: local, stroke: s })),
      };
    case 'roadCasing': {
      if (f.kind !== 'road' || !rc || f.roadClass !== rc) return null;
      const st = roadStyle(rc, palette);
      return {
        t: 'path',
        d: local,
        stroke: { color: st.casingColor, width: st.casing * ws, cap: 'round', join: 'round' },
      };
    }
    case 'roadFill': {
      if (f.kind !== 'road' || !rc || f.roadClass !== rc) return null;
      const st = roadStyle(rc, palette);
      return {
        t: 'path',
        d: local,
        stroke: { color: st.fillColor, width: st.fill * ws, cap: 'round', join: 'round' },
      };
    }
    case 'path':
      return f.kind === 'path' ? { t: 'path', d: local, stroke: pathStroke(palette, ws) } : null;
    case 'pier':
      return f.kind === 'pier' ? { t: 'path', d: local, stroke: pierStroke(palette, ws) } : null;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Pins                                                                */
/* ------------------------------------------------------------------ */

interface PinPlacement {
  frameId: string;
  center: Vec2; // canvas space (pin head)
  item: DLItem;
  canvasBox: Rect;
}

/**
 * Place every numbered pin plus the hotel marker in canvas space, applying
 * trim/gutter/nudge/leader rules. Returns placements; the caller seeds the
 * collision index and later splits them onto pages.
 */
function placePins(
  env: MapEnv,
  proj: MapProjection,
  diagnostics: Diagnostic[],
  frames: PlacedFrame[],
): PinPlacement[] {
  const placements: PinPlacement[] = [];
  // rbush used only to detect near-coincident pins.
  const occupied = new RBush<LabelBox>();

  const place = (
    frameId: string,
    truePt: Vec2,
    build: (center: Vec2, leaderTo?: Vec2) => { item: DLItem; box: Rect },
    fallible: boolean,
  ) => {
    const override = env.overrides.get(frameId);
    let center = override
      ? overrideCenter(override, proj)
      : { x: truePt.x, y: truePt.y - (PIN_H - PIN_R) / 2 + PIN_R / 2 };

    if (!override) {
      // First push out of the gutter band so the pin commits to one page…
      center = pushOutOfGutter(center, proj.foldX, env.gutterWidth);
      // …then nudge off near-coincident neighbours by spiralling outward…
      center = nudgeApart(center, occupied);
      // …and finally clamp into that page's pin-safe rect (trim minus margin,
      // with the fold-facing edge held back by half the gutter). The clamp is
      // last so neither the push nor the nudge can re-enter a forbidden zone.
      center = clampToSafeRect(center, proj, env.gutterWidth);
      center = pushOutOfGutter(center, proj.foldX, env.gutterWidth);
      center = clampToSafeRect(center, proj, env.gutterWidth);
    }

    const box = pinBoxRect(center);
    occupied.insert(rectToBox(box, 'pin'));

    const dist = Math.hypot(center.x - truePt.x, center.y - truePt.y);
    const leader = !override && dist > LEADER_THRESHOLD ? truePt : undefined;
    if (leader) {
      diagnostics.push({
        code: 'map.pin-leader',
        severity: 'info',
        message: `Pin moved ${dist.toFixed(0)}pt from its location; leader drawn.`,
        frame: frameId,
      });
    }

    const built = build(center, leader);
    placements.push({ frameId, center, item: built.item, canvasBox: box });

    // Report nudge / outside-bounds.
    if (!override && dist > PIN_NUDGE_DIST) {
      diagnostics.push({
        code: 'map.pin-nudged',
        severity: 'info',
        message: 'Pin nudged to avoid overlap or the gutter.',
        frame: frameId,
      });
    }
    if (fallible && !insideAnySafe(center, proj, env.gutterWidth)) {
      diagnostics.push({
        code: 'map.pin-outside',
        severity: 'warning',
        message: 'Pin could not be kept within the trimmed map area.',
        frame: frameId,
      });
    }
  };

  // Numbered listings, in canonical order.
  for (const l of env.listings) {
    const truePt = proj.latLngToCanvas(l.lat, l.lng);
    const fill = env.palette.pin[l.tier];
    const frameId = `map:pin:${l.listingId}`;
    place(
      frameId,
      truePt,
      (center, leaderTo) => {
        const num = env.shapeLabel(
          String(l.number),
          env.fonts.pinNumber,
          PIN_R * 1.05,
          env.palette.pinNumber,
          0,
          { tnum: true },
        );
        const v = buildPin(center, fill, num, frameId, leaderTo);
        return { item: v.item, box: { x: v.box.x, y: v.box.y, w: v.box.w, h: v.box.h } };
      },
      true,
    );
  }

  // Hotel marker.
  const hotelPt = proj.latLngToCanvas(env.hotel.lat, env.hotel.lng);
  place(
    'map:pin:hotel',
    hotelPt,
    (center) => {
      const v = buildHotelMarker(center, env.palette.hotel, 'map:pin:hotel');
      return { item: v.item, box: { x: v.box.x, y: v.box.y, w: v.box.w, h: v.box.h } };
    },
    false,
  );

  return placements;
}

/** Spiral a pin outward until it clears all already-placed pins. */
function nudgeApart(center: Vec2, occupied: RBush<LabelBox>): Vec2 {
  if (!occupied.collides(rectToBox(pinBoxRect(center), 'pin'))) return center;
  const step = PIN_R * 1.1;
  for (let ring = 1; ring <= 8; ring++) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const cand = { x: center.x + Math.cos(a) * step * ring, y: center.y + Math.sin(a) * step * ring };
      if (!occupied.collides(rectToBox(pinBoxRect(cand), 'pin'))) return cand;
    }
  }
  return center;
}

/**
 * Per-page "pin-safe" rect in canvas space: the trim box inset by the trim
 * margin, with the fold-facing edge pulled in by half the gutter so a pin can
 * never end up in the binding. (On a single page there is no fold, so the
 * gutter inset is skipped.)
 */
function safeRectCanvas(i: number, proj: MapProjection, gutterWidth: number): Rect {
  const t = proj.trimRectCanvas(i);
  let r = { x: t.x + TRIM_MARGIN, y: t.y + TRIM_MARGIN, w: t.w - 2 * TRIM_MARGIN, h: t.h - 2 * TRIM_MARGIN };
  if (proj.foldX !== null && gutterWidth > 0) {
    const half = gutterWidth / 2;
    if (i === 0) {
      r = { ...r, w: r.w - half }; // hold the right (fold) edge back
    } else {
      r = { x: r.x + half, y: r.y, w: r.w - half, h: r.h };
    }
  }
  return r;
}

/** Clamp a pin into the safe rect of whichever page it currently sits over. */
function clampToSafeRect(center: Vec2, proj: MapProjection, gutterWidth: number): Vec2 {
  const i = proj.pageIndexAt(center.x);
  // clampPinToRect already keeps the whole teardrop inside, so pass margin 0.
  return clampPinToRect(center, safeRectCanvas(i, proj, gutterWidth), 0);
}

/** True when a pin's box sits within some page's pin-safe rect. */
function insideAnySafe(center: Vec2, proj: MapProjection, gutterWidth: number): boolean {
  for (let i = 0; i < proj.pages.length; i++) {
    const r = safeRectCanvas(i, proj, gutterWidth);
    if (
      center.x - PIN_R >= r.x - 0.5 &&
      center.x + PIN_R <= r.x + r.w + 0.5 &&
      center.y - PIN_R >= r.y - 0.5 &&
      center.y + (PIN_H - PIN_R) <= r.y + r.h + 0.5
    ) {
      return true;
    }
  }
  return false;
}

function pinBoxRect(center: Vec2): Rect {
  const b = pinBox(center);
  return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

/**
 * Shape and place street/area/water labels, then split the placed groups onto
 * their owning page(s). Distinct names only — we do not repeat the same street
 * name for every way segment.
 */
function emitLabels(
  features: ProjectedFeature[],
  env: MapEnv,
  proj: MapProjection,
  index: RBush<LabelBox>,
  perPage: Record<string, DLItem[]>,
  frames: PlacedFrame[],
  diagnostics: Diagnostic[],
): void {
  const requests: LabelRequest[] = [];
  const seen = new Set<string>();

  for (const f of features) {
    if (!f.name) continue;
    if (f.kind === 'building' || f.kind === 'coast') continue;
    // One label per distinct name (the longest segment wins as the carrier).
    const key = `${f.kind}:${f.name}`;
    const existing = seen.has(key);
    if (existing) continue;
    seen.add(key);

    const isWater = f.kind === 'water';
    const font = isWater ? env.fonts.labelWater ?? env.fonts.label : env.fonts.label;
    const color = isWater ? env.palette.labelWater : env.palette.labelText;
    const size = labelSize(f);
    const shaped = env.shapeLabel(f.name, font, size, color);
    const frame = `map:label:${slug(f.kind, f.name)}`;
    const override = env.overrides.get(frame);
    requests.push({
      feature: f,
      shaped,
      frame,
      override: override ? overridePoint(override, proj) : undefined,
    });
  }

  const mapRect = proj.canvas;
  const result = placeLabels(requests, index, mapRect, env.palette);

  for (const pl of result.placed) {
    emitSplit(pl.item, proj, env, perPage, pl.frame, frames, pl.box, 'map-label');
  }
  for (const d of result.dropped) {
    diagnostics.push({
      code: 'map.label-dropped',
      severity: 'info',
      message: `Label "${d.name}" dropped to avoid a collision.`,
      frame: d.frame,
    });
  }
  for (const m of result.moved) {
    diagnostics.push({
      code: 'map.label-moved',
      severity: 'info',
      message: `Label "${m.name}" moved to an alternate position.`,
      frame: m.frame,
    });
  }
}

function labelSize(f: ProjectedFeature): number {
  if (f.kind === 'water') return 9.5;
  if (f.kind === 'park' || f.kind === 'sand') return 7.5;
  if (f.kind === 'road') {
    if (f.roadClass === 'primary' || f.roadClass === 'motorway') return 7.5;
    if (f.roadClass === 'secondary') return 7;
    return 6.4;
  }
  return 6.4;
}

/* ------------------------------------------------------------------ */
/* Legend + attribution                                                */
/* ------------------------------------------------------------------ */

function emitLegendAndAttribution(
  env: MapEnv,
  proj: MapProjection,
  index: RBush<LabelBox>,
  perPage: Record<string, DLItem[]>,
  frames: PlacedFrame[],
  diagnostics: Diagnostic[],
): void {
  // --- Legend ---
  const override = env.overrides.get('map:legend');
  const legend = buildLegend(
    env.listings,
    env.palette,
    (text, _font, size, color) => env.shapeLabel(text, env.fonts.legend, size, color),
    proj.canvas,
    index,
    env.legendTitle ?? 'In this guide',
    override ? overridePoint(override, proj) : null,
  );
  // Reserve the legend rect so labels avoid it.
  index.insert(rectToBox(legend.rect, 'legend'));
  emitSplit(legend.item, proj, env, perPage, 'map:legend', frames, legend.rect, 'map-legend');

  // --- Attribution (always rendered, in a bottom corner clear of the legend) ---
  if (!env.attribution) {
    diagnostics.push({
      code: 'map.attribution',
      severity: 'error',
      message: 'Map attribution text is missing — OSM data requires attribution.',
    });
  }
  const attrText = env.attribution || '© OpenStreetMap contributors';
  const shaped = env.shapeLabel(attrText, env.fonts.attribution, 5.5, env.palette.attribution);
  const w = shaped.width;
  const h = shaped.ascent - shaped.descent;
  const pad = 4;
  // Place attribution in the bottom corner of the last page that the legend
  // does NOT occupy (default bottom-right; flip to bottom-left if the legend
  // claimed the right side of that page).
  const last = proj.pages.length - 1;
  const trim = proj.trimRectCanvas(last);
  const legendCx = legend.rect.x + legend.rect.w / 2;
  const legendBottom = legend.rect.y + legend.rect.h > trim.y + trim.h * 0.55;
  // If the legend sits in the bottom-right of the last page, drop attribution
  // bottom-left instead; otherwise keep the conventional bottom-right corner.
  const onLeft = legendBottom && legendCx > trim.x + trim.w * 0.5;
  const rect: Rect = {
    x: onLeft ? trim.x + pad : trim.x + trim.w - w - pad,
    y: trim.y + trim.h - h - pad,
    w,
    h,
  };
  const origin = { x: rect.x, y: rect.y + shaped.ascent };
  const item: DLItem = {
    t: 'group',
    meta: { frame: 'map:attribution', role: 'map-attribution' },
    children: [
      // A faint scrim so the credit reads over any backdrop.
      {
        t: 'path',
        d: rectPath({ x: rect.x - 2, y: rect.y - 1, w: w + 4, h: h + 2 }),
        fill: { color: env.palette.legendBg, alpha: 0.6 },
      },
      { t: 'group', transform: [1, 0, 0, 1, origin.x, origin.y], children: [shaped.item] },
    ],
  };
  emitSplit(item, proj, env, perPage, 'map:attribution', frames, rect, 'map-attribution');
}

/* ------------------------------------------------------------------ */
/* Per-page split helpers                                              */
/* ------------------------------------------------------------------ */

/**
 * Translate a canvas-space group into the page owning `anchor`, append it to
 * that page, and record a PlacedFrame (in page-local space). Used by pins,
 * labels, legend and attribution — anything positioned in canvas space.
 */
function emitSplit(
  item: DLItem,
  proj: MapProjection,
  env: MapEnv,
  perPage: Record<string, DLItem[]>,
  frame: string,
  frames: PlacedFrame[],
  canvasRect: Rect,
  kind: PlacedFrame['kind'] = 'map-pin',
): void {
  // The owning page is the one containing the element's canvas-space centre.
  const i = proj.pageIndexAt(canvasRect.x + canvasRect.w / 2);
  const page = env.pages[i]!;
  const offset = proj.canvasToPage(i, { x: 0, y: 0 });
  const local = translateItem(item, offset.x, offset.y);
  perPage[page.pageId]!.push(local);

  const r = proj.canvasRectToPage(i, canvasRect);
  frames.push({ frame, pageId: page.pageId, rect: r, kind });
}

/** Translate any DLItem tree by (dx,dy) via a wrapping group. */
function translateItem(item: DLItem, dx: number, dy: number): DLItem {
  if (dx === 0 && dy === 0) return item;
  return { t: 'group', transform: [1, 0, 0, 1, dx, dy], children: [item] };
}

/** Project a canvas-space path into page `i`'s local space. */
function toPageLocal(path: PathSpec, i: number, proj: MapProjection): PathSpec {
  const off = proj.canvasToPage(i, { x: 0, y: 0 });
  return path.map((seg): PathSpec[number] => {
    switch (seg[0]) {
      case 'M':
      case 'L':
        return [seg[0], seg[1] + off.x, seg[2] + off.y];
      case 'Q':
        return ['Q', seg[1] + off.x, seg[2] + off.y, seg[3] + off.x, seg[4] + off.y];
      case 'C':
        return [
          'C',
          seg[1] + off.x,
          seg[2] + off.y,
          seg[3] + off.x,
          seg[4] + off.y,
          seg[5] + off.x,
          seg[6] + off.y,
        ];
      case 'Z':
        return ['Z'];
    }
  });
}

/** Does a page-local path overlap the page's map rect at all? */
function touchesRect(path: PathSpec, rect: Rect): boolean {
  const b = pathBounds(path);
  return rectsIntersect(b, rect);
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

/** Compute the bbox from the listings + hotel (padded), used for projection. */
function bboxOf(env: MapEnv): { minLat: number; minLng: number; maxLat: number; maxLng: number } {
  const lats = [env.hotel.lat, ...env.listings.map((l) => l.lat)];
  const lngs = [env.hotel.lng, ...env.listings.map((l) => l.lng)];
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  // Pad ~8% so pins are never flush to the edge.
  const padLat = (maxLat - minLat) * 0.12 || 0.001;
  const padLng = (maxLng - minLng) * 0.12 || 0.001;
  return {
    minLat: minLat - padLat,
    minLng: minLng - padLng,
    maxLat: maxLat + padLat,
    maxLng: maxLng + padLng,
  };
}

/** Override → pin head centre (canvas space). */
function overrideCenter(o: { patch: { x?: number; y?: number }; base: Rect }, proj: MapProjection): Vec2 {
  const p = overridePoint(o, proj);
  return { x: p.x + PIN_R, y: p.y + PIN_R };
}

/** Override patch → top-left point in canvas space (page-local → canvas). */
function overridePoint(
  o: { patch: { x?: number; y?: number }; base: Rect },
  proj: MapProjection,
): Vec2 {
  const x = o.patch.x ?? o.base.x;
  const y = o.patch.y ?? o.base.y;
  // Overrides are stored in page-local space of the page they cover; map the
  // point back to canvas via the page it falls in (best effort: page 0 if the
  // x is small, else the spanning page).
  const local = { x, y };
  // Find the page whose local rect contains the override x, default page 0.
  let i = 0;
  for (let k = 0; k < proj.pages.length; k++) {
    const pl = proj.pages[k]!;
    if (x >= pl.rect.x && x <= pl.rect.x + pl.rect.w) {
      i = k;
      break;
    }
  }
  return proj.pageToCanvas(i, local);
}

/** Frame-safe slug from a feature name. */
function slug(kind: string, name: string): string {
  return `${kind}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}
