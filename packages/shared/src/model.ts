/**
 * The document model: Businesses are reusable directory records; an Edition
 * is one guide for one hotel; a Listing places a business in an edition.
 *
 * Canonical numbering: a listing's number is NEVER stored. It is derived,
 * always, from the edition's `listingOrder` via `listingNumber()` below —
 * the list row, feature reference, map pin and legend all call the same
 * function over the same array, so mismatches, duplicates and gaps are
 * structurally impossible.
 */

export interface FocalPoint {
  x: number; // 0..1 from left
  y: number; // 0..1 from top
}

export interface ImageAsset {
  id: string;
  filename: string;
  width: number; // px of the stored original
  height: number;
  focal: FocalPoint;
  /** Mean luminance 0..1 of the upper/lower thirds, for scrim decisions. */
  luma?: { top: number; bottom: number; overall: number };
}

export interface Business {
  id: string;
  name: string;
  category: string; // 'restaurant' | 'bar' | 'cafe' | 'gallery' | ... free
  oneLiner: string;
  description: string;
  address: string;
  suburb: string;
  lat: number;
  lng: number;
  website?: string;
  instagram?: string;
  phone?: string;
  images: string[]; // ImageAsset ids, first = default
  /** Where this business's QR points; defaults to website. */
  qrTarget?: string;
}

export type Tier = 'full' | 'half' | 'quarter' | 'list';

export const TIER_LABELS: Record<Tier, string> = {
  full: 'Premium',
  half: 'Half',
  quarter: 'Quarter',
  list: 'Counter Pick',
};

export interface Listing {
  id: string;
  businessId: string;
  sectionId: string;
  tier: Tier;
  /** Per-edition copy overrides; undefined = use the business record. */
  copy?: {
    name?: string;
    oneLiner?: string;
    description?: string;
  };
  /** Chosen image asset; undefined = business's first image. */
  imageId?: string;
}

export interface Section {
  id: string;
  title: string; // 'Eat & Drink'
  /** Short label used in running heads / legend ('Eat', 'Do'). */
  short: string;
}

export interface StayEssential {
  label: string;
  value: string;
}

export interface HotelInfoBlock {
  id: string;
  title: string; // 'The Pool Club'
  kicker?: string; // 'Level 3 · 6am – 10pm'
  body: string;
  imageId?: string;
}

export interface HotelProfile {
  name: string;
  /** Short name for the wordmark when different (e.g. 'The Sandling'). */
  wordmark?: string;
  tagline?: string;
  url?: string;
  phone?: string;
  address?: string;
  /** Brand colours as hex; converted once via the shared transform. */
  brand: {
    primary: string;
    secondary: string;
    accent: string;
  };
  logoId?: string; // optional uploaded logo asset
  stayEssentials: StayEssential[];
  welcome: {
    heading: string;
    intro: string;
    guideIntro: string;
  };
  infoBlocks: HotelInfoBlock[];
  keysNote?: string;
  heroImageId?: string; // back-cover full bleed
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

export type PageSpec =
  | { id: string; kind: 'cover' }
  | { id: string; kind: 'welcome' }
  | { id: string; kind: 'hotel-info'; blockIds: string[] }
  | { id: string; kind: 'divider'; sectionId: string }
  /** Expands at compile time into as many physical pages as the section needs. */
  | { id: string; kind: 'listings'; sectionId: string }
  | { id: string; kind: 'map'; spread: boolean }
  | { id: string; kind: 'keys' }
  | { id: string; kind: 'back-cover' };

export type PageKind = PageSpec['kind'];

/* ------------------------------------------------------------------ */
/* Manual overrides                                                    */
/* ------------------------------------------------------------------ */

/**
 * A manual canvas override, bound to a stable frame id (frame ids derive
 * from content identity — `listing:<id>:image`, `map:pin:<listingId>` — so
 * they survive reflow). `base` records the auto-geometry at the moment of
 * override; if regeneration later disagrees with `base`, the engine keeps
 * the manual value and raises `override.conflict` instead of silently
 * discarding either.
 */
export interface FrameOverride {
  frame: string;
  patch: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    /** Multiplier on the frame's resolved type size (text frames). */
    fontScale?: number;
    align?: 'start' | 'center' | 'end';
    hidden?: boolean;
  };
  base: { x: number; y: number; w: number; h: number };
  at: string; // ISO timestamp
}

/* ------------------------------------------------------------------ */
/* Map                                                                 */
/* ------------------------------------------------------------------ */

export interface MapSpec {
  /** Bounding box; if absent, computed from hotel + listings with padding. */
  bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  /** Data source key: 'overpass' (live) or 'fixture:<name>'. */
  source: string;
  /** Tint strength of the hotel palette over the neutral base style, 0..1. */
  tint: number;
}

/* ------------------------------------------------------------------ */
/* Edition                                                             */
/* ------------------------------------------------------------------ */

export interface EditionSettings {
  trimWidthMm: number;
  trimHeightMm: number;
  bleedMm: number;
  /** Page margins from the trim edges, in mm. Optional for legacy docs. */
  margins?: { top: number; bottom: number; inner: number; outer: number };
  /** Baseline grid pitch in pt. */
  baselineGridPt: number;
  /** ICC profile for press output: 'builtin:guide-cmyk' or an asset id. */
  iccProfile: string;
  /** Optional brand spot colour rendered on its own plate. */
  spotColor?: { name: string; altHex: string } | null;
  /** Total ink coverage limit, percent. */
  inkLimit: number;
  /** Base URL of the digital edition (QR targets). */
  digitalBaseUrl: string;
  /** Shown on the cover: 'By Atelier North'. */
  publisher: string;
}

export interface Edition {
  id: string;
  name: string; // 'Summer 2026'
  hotel: HotelProfile;
  settings: EditionSettings;
  sections: Section[];
  listings: Listing[];
  /**
   * THE canonical order. Listing numbers are positions in this array
   * (1-based). Reordering renumbers everything together — list, pins,
   * legend — atomically, by construction.
   */
  listingOrder: string[];
  pages: PageSpec[];
  map: MapSpec;
  overrides: FrameOverride[];
  updatedAt: string;
}

/* ------------------------------------------------------------------ */

/** The single derivation of a listing's canonical number. 1-based; 0 = unplaced. */
export function listingNumber(edition: Pick<Edition, 'listingOrder'>, listingId: string): number {
  return edition.listingOrder.indexOf(listingId) + 1;
}

/** All listings in canonical order, with numbers. The only enumerator painters use. */
export function numberedListings(
  edition: Pick<Edition, 'listings' | 'listingOrder'>,
): { listing: Listing; number: number }[] {
  const byId = new Map(edition.listings.map((l) => [l.id, l]));
  const out: { listing: Listing; number: number }[] = [];
  edition.listingOrder.forEach((id, i) => {
    const listing = byId.get(id);
    if (listing) out.push({ listing, number: i + 1 });
  });
  return out;
}

/**
 * Integrity check for the numbering rule: every listing appears in the order
 * exactly once and vice versa. Violations are repaired by `normalizeOrder`
 * and reported as diagnostics — never silently rendered.
 */
export function checkNumberingIntegrity(
  edition: Pick<Edition, 'listings' | 'listingOrder'>,
): { ok: boolean; missing: string[]; stale: string[]; duplicates: string[] } {
  const ids = new Set(edition.listings.map((l) => l.id));
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const stale: string[] = [];
  for (const id of edition.listingOrder) {
    if (seen.has(id)) duplicates.push(id);
    seen.add(id);
    if (!ids.has(id)) stale.push(id);
  }
  const missing = [...ids].filter((id) => !seen.has(id));
  return { ok: missing.length + stale.length + duplicates.length === 0, missing, stale, duplicates };
}

/** Repair listingOrder: drop stale/duplicate entries, append missing at end. */
export function normalizeOrder(edition: Edition): string[] {
  const ids = new Set(edition.listings.map((l) => l.id));
  const out: string[] = [];
  for (const id of edition.listingOrder) {
    if (ids.has(id) && !out.includes(id)) out.push(id);
  }
  for (const l of edition.listings) {
    if (!out.includes(l.id)) out.push(l.id);
  }
  return out;
}
