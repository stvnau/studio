/**
 * Numbered pins and the hotel marker.
 *
 * A pin is a teardrop with the listing's canonical number set inside it. The
 * placement rules (in canvas space, so they hold across the fold):
 *   - keep the whole pin inside the trim box with a margin (never clipped);
 *   - never sit in the spread gutter no-go band;
 *   - nudge apart when venues nearly coincide (rbush overlap test);
 *   - when a pin ends up far from its true point, draw a leader line back.
 *
 * Geometry is emitted as a display-list group per pin so the orchestrator can
 * translate it into each page's local space.
 */

import {
  circlePath,
  type Color,
  type DLItem,
  type PathSpec,
  type Vec2,
} from '@guide/shared';
import type { ShapedLabel } from './types.js';

/** Outer radius of a pin's head, pt. */
export const PIN_R = 7.5;
/** Total pin height (head + point), pt — used for trim/gutter clearance. */
export const PIN_H = PIN_R + 9;
/** Hotel marker radius, pt. */
export const HOTEL_R = 6.5;

/** A pin's half-extent box (for collision tests), centred on its head. */
export function pinBox(center: Vec2): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: center.x - PIN_R,
    minY: center.y - PIN_R,
    maxX: center.x + PIN_R,
    // The point hangs below the head; include it so leaders/labels clear it.
    maxY: center.y + (PIN_H - PIN_R),
  };
}

/**
 * Teardrop outline: a circle head whose bottom is pulled to a point. `center`
 * is the head centre; the tip sits PIN_H below the top of the head.
 */
function teardropPath(center: Vec2, r: number): PathSpec {
  const { x: cx, y: cy } = center;
  const k = 0.5522847498307936 * r;
  const tipY = cy + (PIN_H - r); // pointed bottom
  // Sweep the upper 3/4 as a circle, then run two straight flanks to the tip.
  return [
    ['M', cx + r, cy],
    ['C', cx + r, cy - k, cx + k, cy - r, cx, cy - r],
    ['C', cx - k, cy - r, cx - r, cy - k, cx - r, cy],
    ['L', cx - r * 0.55, cy + r * 0.55],
    ['L', cx, tipY],
    ['L', cx + r * 0.55, cy + r * 0.55],
    ['Z'],
  ];
}

export interface PinVisual {
  /** Display-list group at absolute (canvas-translated) coordinates. */
  item: DLItem;
  /** Tight bounding box used for the placed frame. */
  box: { x: number; y: number; w: number; h: number };
}

/**
 * Build a numbered pin centred at `center`. The number is shaped by the caller
 * (single shaping path) and passed in; we centre it over the head.
 */
export function buildPin(
  center: Vec2,
  fill: Color,
  numberLabel: ShapedLabel,
  frame: string,
  leaderTo?: Vec2,
): PinVisual {
  const children: DLItem[] = [];

  // Leader line from the true point to the pin tip, drawn first (under).
  if (leaderTo) {
    const tip = { x: center.x, y: center.y + (PIN_H - PIN_R) };
    children.push({
      t: 'path',
      d: [
        ['M', leaderTo.x, leaderTo.y],
        ['L', tip.x, tip.y],
      ],
      stroke: { color: fill, width: 0.9, cap: 'round', dash: [1.6, 1.6] },
    });
    // A small dot anchoring the true location.
    children.push({
      t: 'path',
      d: circlePath(leaderTo.x, leaderTo.y, 1.3),
      fill: { color: fill },
    });
  }

  // Body: teardrop with a thin paper halo so it reads over any backdrop.
  children.push({
    t: 'path',
    d: teardropPath(center, PIN_R),
    fill: { color: fill },
    stroke: { color: { space: 'cmyk', v: [0, 0, 0, 0] }, width: 1.1, join: 'round' },
  });

  // The number, centred over the head.
  const tx = center.x - numberLabel.width / 2;
  const ty = center.y + (numberLabel.ascent - numberLabel.descent) / 2 - numberLabel.descent;
  children.push({
    t: 'group',
    transform: [1, 0, 0, 1, tx, ty],
    children: [numberLabel.item],
  });

  const box = pinBox(center);
  return {
    item: { t: 'group', meta: { frame, role: 'map-pin' }, children },
    box: { x: box.minX, y: box.minY, w: box.maxX - box.minX, h: box.maxY - box.minY },
  };
}

/** Hotel marker: a ringed diamond, visually distinct from the numbered pins. */
export function buildHotelMarker(center: Vec2, color: Color, frame: string): PinVisual {
  const r = HOTEL_R;
  const { x: cx, y: cy } = center;
  const diamond: PathSpec = [
    ['M', cx, cy - r],
    ['L', cx + r, cy],
    ['L', cx, cy + r],
    ['L', cx - r, cy],
    ['Z'],
  ];
  const children: DLItem[] = [
    {
      t: 'path',
      d: circlePath(cx, cy, r + 2),
      fill: { color: { space: 'cmyk', v: [0, 0, 0, 0] } },
      stroke: { color, width: 1.2 },
    },
    { t: 'path', d: diamond, fill: { color } },
  ];
  return {
    item: { t: 'group', meta: { frame, role: 'map-pin' }, children },
    box: { x: cx - r - 2, y: cy - r - 2, w: 2 * (r + 2), h: 2 * (r + 2) },
  };
}

/* ------------------------------------------------------------------ */
/* Placement maths (pure)                                              */
/* ------------------------------------------------------------------ */

/** Clamp a pin head so its whole body stays inside `rect` with `margin`. */
export function clampPinToRect(
  center: Vec2,
  rect: { x: number; y: number; w: number; h: number },
  margin: number,
): Vec2 {
  const minX = rect.x + margin + PIN_R;
  const maxX = rect.x + rect.w - margin - PIN_R;
  const minY = rect.y + margin + PIN_R;
  const maxY = rect.y + rect.h - margin - (PIN_H - PIN_R);
  return {
    x: Math.min(Math.max(center.x, minX), maxX),
    y: Math.min(Math.max(center.y, minY), maxY),
  };
}

/**
 * Push a pin head out of the gutter no-go band (centred on `foldX`, total
 * width `gutterWidth`) to whichever side it is closer to.
 */
export function pushOutOfGutter(
  center: Vec2,
  foldX: number | null,
  gutterWidth: number,
): Vec2 {
  if (foldX === null || gutterWidth <= 0) return center;
  const half = gutterWidth / 2 + PIN_R;
  const lo = foldX - half;
  const hi = foldX + half;
  if (center.x > lo && center.x < hi) {
    return { x: center.x < foldX ? lo : hi, y: center.y };
  }
  return center;
}
