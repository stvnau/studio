/**
 * Fixture data source. Implements the same `MapDataSource` contract as the
 * live Overpass client, so `compileMap` cannot tell them apart — the bundled
 * neighbourhood JSON is byte-for-byte in Overpass `out geom` shape.
 *
 * A source key of `fixture:<name>` resolves to `fixtures/maps/<name>.json`
 * at the repository root.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { BBox, MapDataSource, OsmData } from '@guide/shared';

/** Repository-root `fixtures/maps` directory (…/packages/carto/src → up 3). */
const MAPS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/maps');

/**
 * Build a `MapDataSource` for a `fixture:<name>` key (or a bare `<name>`).
 * The fetch ignores the bbox — the fixture already covers the demo area — but
 * keeps the async signature so it is a drop-in for the Overpass source.
 */
export function fixtureSource(key: string): MapDataSource {
  const name = key.startsWith('fixture:') ? key.slice('fixture:'.length) : key;
  return {
    name: `fixture:${name}`,
    async fetch(_bbox: BBox): Promise<OsmData> {
      const file = resolve(MAPS_DIR, `${name}.json`);
      const raw = await readFile(file, 'utf8');
      const data = JSON.parse(raw) as OsmData;
      if (!data || !Array.isArray(data.elements)) {
        throw new Error(`fixture ${name}: not a valid OsmData document`);
      }
      return data;
    },
  };
}

/** True when a map source key names a fixture rather than the live API. */
export function isFixtureSource(key: string): boolean {
  return key.startsWith('fixture:');
}
