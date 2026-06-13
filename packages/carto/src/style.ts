/**
 * Feature classification and palette-driven styling.
 *
 * Two responsibilities live here, both pure:
 *   1. `classifyFeatures` — turn raw OSM elements into projected
 *      `ProjectedFeature`s in the continuous canvas space (geometry computed
 *      ONCE, split per page later). This is where OSM tag soup becomes the
 *      handful of cartographic categories the map actually draws.
 *   2. The style tables (`roadStyle`, fills) — given the (already
 *      hotel-tinted) `MapPalette`, decide stroke widths, casings and fills.
 *
 * Nothing here clips, places or measures text; that is the orchestrator's and
 * `labels.ts`'s job.
 */

import type {
  Color,
  OsmData,
  OsmElement,
  PathSpec,
  Stroke,
} from '@guide/shared';
import type { MapProjection } from './project.js';
import type { MapPalette, ProjectedFeature } from './types.js';

/* ------------------------------------------------------------------ */
/* OSM classification + projection                                     */
/* ------------------------------------------------------------------ */

type Kind = ProjectedFeature['kind'];

/** Road classes we draw, widest → narrowest (drives draw order + width). */
export const ROAD_CLASSES = [
  'motorway',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'service',
] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

const ROAD_RANK: Record<RoadClass, number> = {
  motorway: 0,
  primary: 1,
  secondary: 2,
  tertiary: 3,
  residential: 4,
  service: 5,
};

/** Label priority by feature kind (higher wins in collision resolution). */
const LABEL_PRIORITY: Record<Kind, number> = {
  water: 90,
  coast: 0,
  park: 70,
  sand: 40,
  building: 0,
  rail: 30,
  road: 50,
  path: 20,
  pier: 35,
};

/** Roads earn a small priority bump by hierarchy so the spine wins. */
function roadPriority(rc: RoadClass): number {
  return LABEL_PRIORITY.road + (ROAD_CLASSES.length - ROAD_RANK[rc]) * 2;
}

interface Classified {
  kind: Kind;
  roadClass?: RoadClass;
  name?: string;
  closed: boolean;
  priority: number;
}

/**
 * Decide what a tagged element is, or `null` to ignore it. Order matters:
 * water/coast first (they read as the backdrop), then green, then transport.
 */
function classify(el: OsmElement): Classified | null {
  if (el.type === 'relation') return null; // fixture uses ways/nodes only
  const t = el.tags ?? {};
  const name = t.name;

  // Water bodies and waterways.
  if (
    t.natural === 'water' ||
    t.natural === 'bay' ||
    t.natural === 'strait' ||
    t.water ||
    t.waterway ||
    t.place === 'sea'
  ) {
    return { kind: 'water', name, closed: true, priority: LABEL_PRIORITY.water };
  }
  if (t.natural === 'coastline') {
    return { kind: 'coast', name, closed: false, priority: LABEL_PRIORITY.coast };
  }

  // Greenery.
  if (
    t.leisure === 'park' ||
    t.leisure === 'garden' ||
    t.landuse === 'grass' ||
    t.landuse === 'forest' ||
    t.landuse === 'recreation_ground'
  ) {
    return { kind: 'park', name, closed: true, priority: LABEL_PRIORITY.park };
  }

  // Sand / beach.
  if (t.natural === 'beach' || t.natural === 'sand') {
    return { kind: 'sand', name, closed: true, priority: LABEL_PRIORITY.sand };
  }

  // Piers / jetties.
  if (t.man_made === 'pier') {
    return { kind: 'pier', name, closed: false, priority: LABEL_PRIORITY.pier };
  }

  // Rail.
  if (t.railway === 'rail' || t.railway === 'light_rail' || t.railway === 'tram') {
    return { kind: 'rail', name, closed: false, priority: LABEL_PRIORITY.rail };
  }

  // Buildings.
  if (t.building) {
    return { kind: 'building', name, closed: true, priority: LABEL_PRIORITY.building };
  }

  // Roads + pedestrian paths.
  if (t.highway) {
    const hw = t.highway;
    if (hw === 'footway' || hw === 'path' || hw === 'pedestrian' || hw === 'steps') {
      return { kind: 'path', name, closed: false, priority: LABEL_PRIORITY.path };
    }
    const rc = roadClassFor(hw);
    if (rc) {
      return { kind: 'road', roadClass: rc, name, closed: false, priority: roadPriority(rc) };
    }
  }
  return null;
}

/** Map an OSM highway value onto one of our drawn road classes. */
function roadClassFor(hw: string): RoadClass | null {
  switch (hw) {
    case 'motorway':
    case 'motorway_link':
    case 'trunk':
    case 'trunk_link':
      return 'motorway';
    case 'primary':
    case 'primary_link':
      return 'primary';
    case 'secondary':
    case 'secondary_link':
      return 'secondary';
    case 'tertiary':
    case 'tertiary_link':
      return 'tertiary';
    case 'residential':
    case 'living_street':
    case 'unclassified':
      return 'residential';
    case 'service':
    case 'track':
      return 'service';
    default:
      return null;
  }
}

/**
 * Classify and project every supported element into the continuous canvas.
 * Coordinates are canvas-space (origin top-left of the combined map rect);
 * the orchestrator clips them per page afterwards.
 */
export function classifyFeatures(data: OsmData, proj: MapProjection): ProjectedFeature[] {
  const out: ProjectedFeature[] = [];
  for (const el of data.elements) {
    if (el.type !== 'way' || el.geometry.length < 2) continue;
    const c = classify(el);
    if (!c) continue;
    const path = projectWay(el.geometry, c.closed, proj);
    if (path.length < 2) continue;
    out.push({
      kind: c.kind,
      roadClass: c.roadClass,
      name: c.name,
      path,
      closed: c.closed,
      priority: c.priority,
    });
  }
  return out;
}

/** Project an OSM way's geometry into a canvas-space PathSpec. */
function projectWay(
  geometry: { lat: number; lon: number }[],
  closed: boolean,
  proj: MapProjection,
): PathSpec {
  const path: PathSpec = [];
  geometry.forEach((g, i) => {
    const p = proj.latLngToCanvas(g.lat, g.lon);
    path.push([i === 0 ? 'M' : 'L', p.x, p.y]);
  });
  if (closed) path.push(['Z']);
  return path;
}

/* ------------------------------------------------------------------ */
/* Styling                                                             */
/* ------------------------------------------------------------------ */

export interface RoadStyle {
  /** Casing (outline) stroke width in pt, before width scaling. */
  casing: number;
  /** Fill (centre) stroke width in pt, before width scaling. */
  fill: number;
  casingColor: Color;
  fillColor: Color;
}

/**
 * Reference road widths (pt) at REF_METRES_PER_PT. The orchestrator multiplies
 * by `projection.widthScale` so a denser map keeps legible line weights.
 */
const ROAD_WIDTHS: Record<RoadClass, { casing: number; fill: number }> = {
  motorway: { casing: 6.0, fill: 4.2 },
  primary: { casing: 5.0, fill: 3.4 },
  secondary: { casing: 4.0, fill: 2.6 },
  tertiary: { casing: 3.4, fill: 2.1 },
  residential: { casing: 2.8, fill: 1.7 },
  service: { casing: 2.0, fill: 1.1 },
};

/** Major arteries take the stronger road colour; minor ones the quiet one. */
export function roadStyle(rc: RoadClass, palette: MapPalette): RoadStyle {
  const w = ROAD_WIDTHS[rc];
  const major = rc === 'motorway' || rc === 'primary' || rc === 'secondary';
  return {
    casing: w.casing,
    fill: w.fill,
    casingColor: palette.roadCasing,
    fillColor: major ? palette.roadMajor : palette.roadMinor,
  };
}

/** Pedestrian path stroke (dashed, quiet). */
export function pathStroke(palette: MapPalette, widthScale: number): Stroke {
  return {
    color: palette.roadMinor,
    width: 0.9 * widthScale,
    cap: 'round',
    join: 'round',
    dash: [2.4 * widthScale, 1.8 * widthScale],
  };
}

/** Rail stroke (dashed sleepers over a thin bed). */
export function railStrokes(palette: MapPalette, widthScale: number): Stroke[] {
  return [
    { color: palette.rail, width: 1.0 * widthScale, cap: 'butt', join: 'round' },
    {
      color: palette.rail,
      width: 2.6 * widthScale,
      cap: 'butt',
      dash: [1.2 * widthScale, 3.4 * widthScale],
    },
  ];
}

/** Pier stroke (solid, mid weight, square ends like a boardwalk). */
export function pierStroke(palette: MapPalette, widthScale: number): Stroke {
  return { color: palette.roadMinor, width: 2.2 * widthScale, cap: 'square', join: 'round' };
}
