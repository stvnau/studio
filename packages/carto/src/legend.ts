/**
 * The legend panel: every numbered entry (canonical order), a tier-colour key
 * and a road-hierarchy key. It is reserved in the collision index BEFORE any
 * label is placed, so labels and pins can never land under it.
 *
 * Placement picks the calmest corner (fewest features overlapping the panel),
 * unless the caller supplies a `map:legend` override, which wins outright.
 */

import {
  circlePath,
  roundedRectPath,
  TIER_LABELS,
  type Color,
  type DLItem,
  type Rect,
  type Tier,
  type Vec2,
} from '@guide/shared';
import type RBush from 'rbush';
import type { LabelBox } from './labels.js';
import type { MapListing, MapPalette, ShapedLabel } from './types.js';

/** Shaper signature the orchestrator passes through (subset of MapEnv). */
type Shape = (text: string, font: string, size: number, color: Color) => ShapedLabel;

export interface LegendBuild {
  item: DLItem;
  rect: Rect;
}

const PAD = 8;
const TITLE_SIZE = 8.5;
const ENTRY_SIZE = 7;
const KEY_SIZE = 6.2;
const ROW_H = 9.2;
const SWATCH = 6.5;

/**
 * Compute the legend panel size from its contents (so it never clips its own
 * text), then place it in the calmest corner. Returns the built display-list
 * group and the reserved rect (both in canvas space).
 */
export function buildLegend(
  listings: MapListing[],
  palette: MapPalette,
  shape: Shape,
  mapRect: Rect,
  index: RBush<LabelBox>,
  title: string,
  override: Vec2 | null,
): LegendBuild {
  // Shape every row up front so we can size the panel to the widest line.
  const titleShaped = shape(title, '', TITLE_SIZE, palette.legendText);
  const entryShaped = listings.map((l) =>
    shape(`${l.number}  ${l.name}`, '', ENTRY_SIZE, palette.legendText),
  );
  const tierKeys = uniqueTiers(listings).map((t) => ({
    tier: t,
    shaped: shape(TIER_LABELS[t], '', KEY_SIZE, palette.legendText),
  }));
  const roadKeys = [
    { label: 'Major road', shaped: shape('Major road', '', KEY_SIZE, palette.legendText) },
    { label: 'Local street', shaped: shape('Local street', '', KEY_SIZE, palette.legendText) },
  ];

  const contentW = Math.max(
    titleShaped.width,
    ...entryShaped.map((s) => SWATCH + 6 + s.width),
    ...tierKeys.map((k) => SWATCH + 6 + k.shaped.width),
    ...roadKeys.map((k) => SWATCH + 6 + k.shaped.width),
  );
  const w = Math.min(contentW + PAD * 2, mapRect.w * 0.5);

  // Height: title + entries + a divider + tier keys + road keys.
  const headerH = TITLE_SIZE + 6;
  const entriesH = entryShaped.length * ROW_H;
  const keysH = (tierKeys.length + roadKeys.length) * (ROW_H - 1) + 8;
  const h = Math.min(PAD * 2 + headerH + entriesH + keysH, mapRect.h * 0.92);

  const rect = override
    ? { x: override.x, y: override.y, w, h }
    : calmestCorner(mapRect, w, h, index);

  return { item: render(rect, palette, titleShaped, entryShaped, listings, tierKeys, roadKeys), rect };
}

function uniqueTiers(listings: MapListing[]): Tier[] {
  const order: Tier[] = ['full', 'half', 'quarter', 'list'];
  const present = new Set(listings.map((l) => l.tier));
  return order.filter((t) => present.has(t));
}

/**
 * Score each of the four corners by how many features (boxes already in the
 * index — i.e. pins) it would overlap, plus a tiny bias to the bottom so the
 * legend tends to sit out of the way. Lowest score wins.
 */
function calmestCorner(mapRect: Rect, w: number, h: number, index: RBush<LabelBox>): Rect {
  const m = 6;
  const corners: Rect[] = [
    { x: mapRect.x + m, y: mapRect.y + m, w, h }, // top-left
    { x: mapRect.x + mapRect.w - w - m, y: mapRect.y + m, w, h }, // top-right
    { x: mapRect.x + m, y: mapRect.y + mapRect.h - h - m, w, h }, // bottom-left
    { x: mapRect.x + mapRect.w - w - m, y: mapRect.y + mapRect.h - h - m, w, h }, // bottom-right
  ];
  let best = corners[0]!;
  let bestScore = Infinity;
  corners.forEach((r, i) => {
    const hits = index.search({ minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h }).length;
    const bottomBias = i >= 2 ? -0.4 : 0;
    const score = hits + bottomBias;
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  });
  return best;
}

function render(
  rect: Rect,
  palette: MapPalette,
  titleShaped: ShapedLabel,
  entryShaped: ShapedLabel[],
  listings: MapListing[],
  tierKeys: { tier: Tier; shaped: ShapedLabel }[],
  roadKeys: { label: string; shaped: ShapedLabel }[],
): DLItem {
  const children: DLItem[] = [];

  // Panel background with a hairline border.
  children.push({
    t: 'path',
    d: roundedRectPath(rect, 4),
    fill: { color: palette.legendBg, alpha: 0.94 },
    stroke: { color: palette.legendText, width: 0.5, alpha: 0.35 },
  });

  let y = rect.y + PAD;
  const x = rect.x + PAD;

  // Title.
  children.push(translatedText(titleShaped, x, y + TITLE_SIZE));
  y += TITLE_SIZE + 6;

  // Numbered entries with a tier-coloured dot.
  listings.forEach((l, i) => {
    const cy = y + ROW_H / 2;
    children.push({
      t: 'path',
      d: circlePath(x + SWATCH / 2, cy, SWATCH / 2),
      fill: { color: palette.pin[l.tier] },
    });
    children.push(translatedText(entryShaped[i]!, x + SWATCH + 6, cy + ENTRY_SIZE * 0.35));
    y += ROW_H;
  });

  // Divider.
  y += 3;
  children.push({
    t: 'path',
    d: [
      ['M', x, y],
      ['L', rect.x + rect.w - PAD, y],
    ],
    stroke: { color: palette.legendText, width: 0.4, alpha: 0.3 },
  });
  y += 5;

  // Tier colour key.
  for (const k of tierKeys) {
    const cy = y + ROW_H / 2;
    children.push({
      t: 'path',
      d: circlePath(x + SWATCH / 2, cy, SWATCH / 2),
      fill: { color: palette.pin[k.tier] },
    });
    children.push(translatedText(k.shaped, x + SWATCH + 6, cy + KEY_SIZE * 0.35));
    y += ROW_H - 1;
  }

  // Road hierarchy key (a thick and a thin line swatch).
  roadKeys.forEach((k, i) => {
    const cy = y + ROW_H / 2;
    children.push({
      t: 'path',
      d: [
        ['M', x, cy],
        ['L', x + SWATCH, cy],
      ],
      stroke: {
        color: i === 0 ? palette.roadMajor : palette.roadMinor,
        width: i === 0 ? 2.6 : 1.4,
        cap: 'round',
      },
    });
    children.push(translatedText(k.shaped, x + SWATCH + 6, cy + KEY_SIZE * 0.35));
    y += ROW_H - 1;
  });

  return { t: 'group', meta: { frame: 'map:legend', role: 'map-legend' }, children };
}

/** Translate a baseline-origin shaped label to (x,y) as a positioned group. */
function translatedText(shaped: ShapedLabel, x: number, y: number): DLItem {
  return { t: 'group', transform: [1, 0, 0, 1, x, y], children: [shaped.item] };
}
