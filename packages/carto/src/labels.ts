/**
 * Label shaping helpers and collision placement.
 *
 * All text is shaped through `env.shapeLabel` (the single shaping path); this
 * module only positions the already-shaped runs and resolves collisions with
 * an rbush index. A label is never rendered as letter-spaced fragments — we
 * shape the whole string once and translate it as a unit.
 *
 * The collision index is shared across the whole placement pass: pins, the
 * legend and previously placed labels are all loaded as occupied boxes before
 * the first street name is tried, so labels can never land on top of them.
 */

import RBush from 'rbush';
import type { RBushBox } from 'rbush';
import type { Color, DLItem, PathSpec, Rect, Vec2 } from '@guide/shared';
import type { MapPalette, ProjectedFeature, ShapedLabel } from './types.js';

export interface LabelBox extends RBushBox {
  kind: 'pin' | 'legend' | 'label' | 'attribution';
}

export function rectToBox(r: Rect, kind: LabelBox['kind']): LabelBox {
  return { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h, kind };
}

/** Pad a box by `m` on every side (labels keep a little air around them). */
function pad(b: RBushBox, m: number): RBushBox {
  return { minX: b.minX - m, minY: b.minY - m, maxX: b.maxX + m, maxY: b.maxY + m };
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

/** Total length and a midpoint+angle along a polyline PathSpec. */
function polyline(path: PathSpec): { pts: Vec2[]; length: number } {
  const pts: Vec2[] = [];
  for (const seg of path) {
    if (seg[0] === 'M' || seg[0] === 'L') pts.push({ x: seg[1], y: seg[2] });
  }
  let length = 0;
  for (let i = 1; i < pts.length; i++) {
    length += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  }
  return { pts, length };
}

/** Point + tangent angle at arc-length `s` along a polyline. */
function atLength(pts: Vec2[], s: number): { p: Vec2; angle: number } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg >= s || i === pts.length - 1) {
      const t = seg === 0 ? 0 : (s - acc) / seg;
      let angle = Math.atan2(b.y - a.y, b.x - a.x);
      // Keep text upright (never upside-down along a road heading west).
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, angle };
    }
    acc += seg;
  }
  const last = pts[pts.length - 1]!;
  return { p: last, angle: 0 };
}

/** Polygon centroid (for area/water labels) — average of polyline points. */
function centroid(path: PathSpec): Vec2 {
  const { pts } = polyline(path);
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

/** Axis-aligned box of a rotated label rect (its corners' bounds). */
function rotatedBounds(origin: Vec2, w: number, h: number, angle: number): Rect {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Label baseline origin is bottom-left; extend up by h, right by w.
  const corners: Vec2[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: -h },
    { x: 0, y: -h },
  ].map((c) => ({ x: origin.x + c.x * cos - c.y * sin, y: origin.y + c.x * sin + c.y * cos }));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/* ------------------------------------------------------------------ */
/* Placement                                                           */
/* ------------------------------------------------------------------ */

export interface PlacedLabel {
  /** Display-list group, positioned in canvas space. */
  item: DLItem;
  /** Final occupied box (canvas space). */
  box: Rect;
  frame: string;
}

interface Candidate {
  origin: Vec2;
  angle: number;
}

/**
 * Build the halo+text group for a shaped label, positioned at a baseline
 * origin and optionally rotated. The halo is a fattened stroke of the same
 * glyphs (via the painter's `paint-order:stroke`).
 */
function labelItem(
  shaped: ShapedLabel,
  origin: Vec2,
  angle: number,
  halo: Color,
  frame: string,
): DLItem {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Clone the text run, adding a halo stroke under the fill.
  const text = shaped.item;
  const haloRuns = text.runs.map((r) => ({
    ...r,
    stroke: { color: halo, width: Math.max(1.6, r.size * 0.22), join: 'round' as const },
  }));
  return {
    t: 'group',
    meta: { frame, role: 'map-label' },
    transform: [cos, sin, -sin, cos, origin.x, origin.y],
    children: [{ ...text, runs: haloRuns }],
  };
}

export interface LabelRequest {
  feature: ProjectedFeature;
  shaped: ShapedLabel;
  frame: string;
  /** Pre-resolved override origin (canvas space), if the caller has one. */
  override?: Vec2;
}

export interface PlacementResult {
  placed: PlacedLabel[];
  dropped: { frame: string; name: string; priority: number }[];
  moved: { frame: string; name: string }[];
}

/**
 * Place a batch of labels against a pre-seeded collision `index` (pins +
 * legend already loaded). Higher-priority requests are placed first; a label
 * that cannot find a clear, in-bounds slot is dropped.
 */
export function placeLabels(
  requests: LabelRequest[],
  index: RBush<LabelBox>,
  mapRect: Rect,
  palette: MapPalette,
): PlacementResult {
  const placed: PlacedLabel[] = [];
  const dropped: PlacementResult['dropped'] = [];
  const moved: PlacementResult['moved'] = [];

  // Highest priority first so the important names claim their spot.
  const ordered = [...requests].sort((a, b) => b.feature.priority - a.feature.priority);

  for (const req of ordered) {
    const { shaped, feature, frame } = req;
    const w = shaped.width;
    const h = shaped.ascent - shaped.descent;

    const candidates = req.override
      ? [{ origin: req.override, angle: 0 }]
      : candidatesFor(feature, w, h);

    let chosen: Candidate | null = null;
    let chosenBox: Rect | null = null;
    let first = true;
    for (const cand of candidates) {
      const b = rotatedBounds(cand.origin, w, h, cand.angle);
      // Must stay on the map (override is authoritative — skip the bounds gate).
      if (!req.override && !rectInside(b, mapRect)) {
        first = false;
        continue;
      }
      if (!index.collides(pad(rectToBox(b, 'label'), 1))) {
        chosen = cand;
        chosenBox = b;
        if (!first && feature.name) moved.push({ frame, name: feature.name });
        break;
      }
      first = false;
    }

    if (!chosen || !chosenBox) {
      dropped.push({ frame, name: feature.name ?? '', priority: feature.priority });
      continue;
    }

    index.insert(rectToBox(chosenBox, 'label'));
    placed.push({
      item: labelItem(shaped, chosen.origin, chosen.angle, palette.labelHalo, frame),
      box: chosenBox,
      frame,
    });
  }

  return { placed, dropped, moved };
}

/** Is `inner` fully within `outer`? */
function rectInside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/**
 * Candidate baseline origins for a feature, best first.
 *   - roads/piers/rail ride along the line near its midpoint, both up- and
 *     down-shifted off the centreline;
 *   - area/water features sit centred on the centroid, with nearby fallbacks.
 */
function candidatesFor(feature: ProjectedFeature, w: number, h: number): Candidate[] {
  if (feature.kind === 'road' || feature.kind === 'pier' || feature.kind === 'path') {
    const { pts, length } = polyline(feature.path);
    if (pts.length < 2 || length < w * 0.6) {
      // Too short to ride — fall back to a centred horizontal label.
      const c = centroid(feature.path);
      return centredCandidates(c, w, h);
    }
    const out: Candidate[] = [];
    // Try a few stations along the road, centred then sliding.
    for (const frac of [0.5, 0.38, 0.62, 0.28, 0.72]) {
      const { p, angle } = atLength(pts, length * frac);
      const dx = (w / 2) * Math.cos(angle);
      const dy = (w / 2) * Math.sin(angle);
      // Offset perpendicular to sit just off the centreline (above the line).
      const off = h * 0.35;
      const nx = Math.sin(angle) * off;
      const ny = -Math.cos(angle) * off;
      out.push({ origin: { x: p.x - dx + nx, y: p.y - dy + ny + h * 0.32 }, angle });
    }
    return out;
  }
  // Area / water / sand labels: centred, then a ring of offsets.
  return centredCandidates(centroid(feature.path), w, h);
}

function centredCandidates(c: Vec2, w: number, h: number): Candidate[] {
  const base = { x: c.x - w / 2, y: c.y + h * 0.32 };
  const ring = [
    { x: 0, y: 0 },
    { x: 0, y: -h * 1.4 },
    { x: 0, y: h * 1.4 },
    { x: w * 0.6, y: 0 },
    { x: -w * 0.6, y: 0 },
    { x: w * 0.6, y: -h * 1.4 },
    { x: -w * 0.6, y: h * 1.4 },
  ];
  return ring.map((d) => ({ origin: { x: base.x + d.x, y: base.y + d.y }, angle: 0 }));
}

