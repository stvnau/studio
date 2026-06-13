/**
 * OpenStreetMap data as the carto engine consumes it: the JSON shape
 * returned by the Overpass API (`[out:json]` with `out geom`). The fixture
 * dataset is stored in exactly this format, so the live Overpass source and
 * the bundled source are interchangeable.
 */

export interface OsmTags {
  [key: string]: string;
}

export interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: OsmTags;
}

export interface OsmWay {
  type: 'way';
  id: number;
  tags?: OsmTags;
  /** From Overpass `out geom`. */
  geometry: { lat: number; lon: number }[];
}

export interface OsmRelationMember {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role: string;
  geometry?: { lat: number; lon: number }[];
}

export interface OsmRelation {
  type: 'relation';
  id: number;
  tags?: OsmTags;
  members: OsmRelationMember[];
}

export type OsmElement = OsmNode | OsmWay | OsmRelation;

export interface OsmData {
  elements: OsmElement[];
}

export interface BBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** Interface implemented by the live Overpass client and the fixture loader. */
export interface MapDataSource {
  /** Human name for attribution/debug ('Overpass', 'fixture:pelican-point'). */
  name: string;
  fetch(bbox: BBox): Promise<OsmData>;
}
