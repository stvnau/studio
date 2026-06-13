/**
 * Canvas preview: renders an edition with the SAME compileEdition() the press
 * exporter uses, then paints each page to SVG (soft-proofed to screen). The
 * studio canvas displays these, so what the designer sees on screen is the
 * exact press geometry — there is one layout engine, not two. Live drafts are
 * rendered without persisting, so editing feels immediate.
 */

import type DatabaseT from 'better-sqlite3';
import { paintPageSvg } from '@guide/paint';
import type { Diagnostic, Edition, Rect } from '@guide/shared';
import { FontManager, compileEdition, type CompileEnv } from '@guide/engine';
import { NodeFontSource } from '@guide/fonts/node';
import { compileMap, resolveMapSource } from '@guide/carto';
import { DbAssetCatalog, DbBusinessCatalog, loadAssetMeta } from './catalogs.js';

export interface PagePreview {
  pageId: string;
  side: 'left' | 'right';
  spreadWith?: string;
  trim: { w: number; h: number };
  bleed: number;
  svg: string;
}

export interface PreviewResult {
  pages: PagePreview[];
  frames: Record<string, { pageId: string; rect: Rect; kind: string }>;
  diagnostics: Diagnostic[];
}

// One FontManager per process — font files are read once and shaping is cached.
let sharedFonts: FontManager | undefined;
function fonts(): FontManager {
  return (sharedFonts ??= new FontManager(new NodeFontSource()));
}

export async function renderEditionPreview(
  db: DatabaseT.Database,
  dataDir: string,
  edition: Edition,
  opts: { showBleed?: boolean } = {},
): Promise<PreviewResult> {
  const assetMeta = loadAssetMeta(db);
  const env: CompileEnv = {
    fonts: fonts(),
    assets: new DbAssetCatalog(assetMeta),
    businesses: new DbBusinessCatalog(db),
    mapData: await loadMapData(edition),
    compileMap,
  };
  const render = await compileEdition(edition, env);
  const fm = fonts();

  const pages: PagePreview[] = render.pages.map((page) => ({
    pageId: page.pageId,
    side: page.side,
    spreadWith: page.spreadWith,
    trim: page.trim,
    bleed: page.bleed,
    svg: paintPageSvg(page, {
      glyphPath: (f, g) => fm.glyphPath(f, g),
      unitsPerEm: (f) => fm.metrics(f).unitsPerEm,
      assetUrl: (id) => `/api/assets/${encodeURIComponent(id)}/file`,
      showBleed: opts.showBleed ?? false,
      interactive: true,
      background: '#ffffff',
    }),
  }));

  return { pages, frames: render.frames, diagnostics: render.diagnostics };
}

async function loadMapData(edition: Edition) {
  const src = edition.map?.source;
  if (!src) return undefined;
  try {
    const source = resolveMapSource(src);
    return await source.fetch(edition.map.bbox ?? { minLat: -90, minLng: -180, maxLat: 90, maxLng: 180 });
  } catch {
    return undefined;
  }
}
