/**
 * Compile environment: everything the pure layout engine needs injected
 * (it performs no IO). Both callers — studio and server — construct one of
 * these from the same primitives.
 */

import type { Diagnostic, DLItem, DocRender, Edition, ImageAsset, OsmData, Rect } from '@guide/shared';
import type { FontManager } from './fonts.js';

export interface AssetCatalog {
  /** Metadata for any asset referenced by the edition; no pixel IO here. */
  get(id: string): ImageAsset | undefined;
}

export interface CompileEnv {
  fonts: FontManager;
  assets: AssetCatalog;
  /** Map data, pre-fetched for edition.map.bbox by the caller. */
  mapData?: OsmData;
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
