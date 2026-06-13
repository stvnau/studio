/**
 * Compile environment: everything the pure layout engine needs injected
 * (it performs no IO). Both callers — studio and server — construct one of
 * these from the same primitives.
 */

import type {
  Business,
  Diagnostic,
  DLItem,
  DocRender,
  Edition,
  ImageAsset,
  OsmData,
  Rect,
} from '@guide/shared';
import type { MapEnv, MapResult } from '@guide/carto';
import type { FontManager } from './fonts.js';

export interface AssetCatalog {
  /** Metadata for any asset referenced by the edition; no pixel IO here. */
  get(id: string): ImageAsset | undefined;
}

export interface BusinessCatalog {
  /** The directory record a listing places, or undefined if it was removed. */
  get(id: string): Business | undefined;
}

/**
 * The cartography compiler, injected so the engine stays the single producer
 * of geometry without taking a runtime dependency on @guide/carto: the
 * exporter (which owns both) passes carto's `compileMap` here. Its output is
 * merged straight into the one DocRender, preserving editor↔press parity.
 */
export type MapCompileFn = (data: OsmData, env: MapEnv) => MapResult;

export interface CompileEnv {
  fonts: FontManager;
  assets: AssetCatalog;
  businesses: BusinessCatalog;
  /** Map data, pre-fetched for edition.map.bbox by the caller. */
  mapData?: OsmData;
  /** Cartography compiler (carto.compileMap); absent → map pages show a notice. */
  compileMap?: MapCompileFn;
}

export interface CompileResult extends DocRender {
  /**
   * Auto-geometry of every overridable frame this compile produced —
   * the canvas uses it for selection handles, and override conflict
   * detection compares against FrameOverride.base.
   */
  frames: Record<string, { pageId: string; rect: Rect; kind: string }>;
}

export type CompileFn = (edition: Edition, env: CompileEnv) => Promise<CompileResult>;

export interface MapCompilation {
  /** Display items per physical page id of the map. */
  perPage: Record<string, DLItem[]>;
  frames: Record<string, { pageId: string; rect: Rect; kind: string }>;
  diagnostics: Diagnostic[];
}
