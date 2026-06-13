/**
 * Cartography contract. compileMap() turns OSM data + listings into styled,
 * collision-free display-list fragments for one page or a two-page spread.
 * It depends only on @guide/shared and injected closures (shaping comes
 * from the engine via MapEnv), so it stays painter- and IO-agnostic.
 */

import type {
  Color,
  Diagnostic,
  DLItem,
  FrameOverride,
  OpenTypeFeatures,
  PathSpec,
  Rect,
  Tier,
} from '@guide/shared';

export interface MapPalette {
  /** Land base (paper or near-paper tint). */
  land: Color;
  water: Color;
  park: Color;
  sand?: Color;
  /** Road casing/fill by hierarchy. */
  roadMajor: Color;
  roadMinor: Color;
  roadCasing: Color;
  rail: Color;
  /** Building footprint fill (very quiet). */
  building: Color;
  labelText: Color;
  labelWater: Color;
  /** Halo behind labels — usually the land colour. */
  labelHalo: Color;
  /** Pin colours by tier group. */
  pin: Record<Tier, Color>;
  pinNumber: Color;
  hotel: Color;
  legendBg: Color;
  legendText: Color;
  attribution: Color;
}

export interface ShapedLabel {
  /** Positioned glyphs at origin (0,0) baseline-left; carto translates. */
  item: Extract<DLItem, { t: 'text' }>;
  width: number;
  ascent: number;
  descent: number;
}

export interface MapPageEnv {
  pageId: string;
  side: 'left' | 'right';
  /** Map area in page space (bleed-inclusive coordinates). */
  rect: Rect;
  trim: { w: number; h: number };
  bleed: number;
}

export interface MapListing {
  listingId: string;
  number: number;
  name: string;
  tier: Tier;
  lat: number;
  lng: number;
}

export interface MapEnv {
  /** One entry for a single page, two for a spread (left first). */
  pages: MapPageEnv[];
  /** Total no-go width straddling the fold on spreads, pt. */
  gutterWidth: number;
  palette: MapPalette;
  fonts: {
    label: string;
    labelStrong: string;
    legend: string;
    legendTitle: string;
    pinNumber: string;
    attribution: string;
    /**
     * Optional italic-feel face for water/sea labels (additive; falls back
     * to `label` when absent).
     */
    labelWater?: string;
  };
  /** Shape a one-line label (provided by the engine — single shaping path). */
  shapeLabel: (
    text: string,
    font: string,
    size: number,
    color: Color,
    letterSpacing?: number,
    /** Optional OpenType features (additive; e.g. tnum for pin numbers). */
    features?: OpenTypeFeatures,
  ) => ShapedLabel;
  listings: MapListing[];
  hotel: { name: string; lat: number; lng: number };
  /** Manual overrides keyed by frame id (map:pin:<listingId>, map:label:<id>, map:legend). */
  overrides: ReadonlyMap<string, FrameOverride>;
  /** Always rendered. '© OpenStreetMap contributors'. */
  attribution: string;
  /** Optional legend panel title (additive); default 'In this guide'. */
  legendTitle?: string;
}

export interface PlacedFrame {
  frame: string;
  pageId: string;
  rect: Rect;
  kind: 'map-pin' | 'map-label' | 'map-legend' | 'map-attribution';
}

export interface MapResult {
  perPage: Record<string, DLItem[]>;
  frames: PlacedFrame[];
  diagnostics: Diagnostic[];
}

/** Projected feature, after Mercator projection into page space. */
export interface ProjectedFeature {
  kind:
    | 'water'
    | 'coast'
    | 'park'
    | 'sand'
    | 'building'
    | 'rail'
    | 'road'
    | 'path'
    | 'pier';
  /** Road class when kind === 'road': motorway/primary/secondary/tertiary/residential/service. */
  roadClass?: string;
  name?: string;
  path: PathSpec;
  closed: boolean;
  /** Label priority: higher wins in collision resolution. */
  priority: number;
}
