/**
 * @guide/carto — the cartography engine.
 *
 * `compileMap()` turns OSM data + listings into styled, collision-free
 * display-list fragments for a single map page or a two-page spread. The
 * fixture loader (`fixtureSource`) and the live Overpass client share one
 * `MapDataSource` contract, so the engine is source-agnostic.
 */

export * from './types.js';
export { compileMap } from './compile.js';
export { createProjection } from './project.js';
export type { MapProjection, PagePlacement } from './project.js';
export { fixtureSource, isFixtureSource } from './fixture.js';

import type { MapDataSource } from '@guide/shared';
import { fixtureSource, isFixtureSource } from './fixture.js';

/**
 * Resolve a `MapSpec.source` key to a data source. Today this only knows the
 * bundled fixtures; the live Overpass client plugs in here behind the same
 * `MapDataSource` interface.
 */
export function resolveMapSource(key: string): MapDataSource {
  if (isFixtureSource(key)) return fixtureSource(key);
  throw new Error(
    `resolveMapSource: unknown source "${key}" (live Overpass is network-blocked here; use fixture:<name>)`,
  );
}
