/**
 * The export pipeline — the one place that composes the engine (layout),
 * carto (map) and press (PDF) into finished artifacts. Press, proof and the
 * digital edition all derive from a SINGLE compileEdition() pass, so they can
 * never disagree about geometry or numbering.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type DatabaseT from 'better-sqlite3';
import {
  effectiveCmyk,
  hexToCmyk,
  type Edition,
  type OsmData,
} from '@guide/shared';
import { FontManager, compileEdition, type CompileEnv } from '@guide/engine';
import { NodeFontSource } from '@guide/fonts/node';
import { compileMap, resolveMapSource } from '@guide/carto';
import { writePdf, BUILTIN_CMYK_PROFILE, type PressOptions } from '@guide/press';
import type { Exporter, ExportKind, ExportResult } from '../exporter.js';
import {
  DbAssetCatalog,
  DbBusinessCatalog,
  DiskPressAssetStore,
  loadAssetMeta,
} from './catalogs.js';
import { renderDigitalHtml } from './digital.js';

export function createExporter(db: DatabaseT.Database, dataDir: string): Exporter {
  const assetsDir = path.join(dataDir, 'assets');

  return {
    async run(edition: Edition, kind: ExportKind, onProgress): Promise<ExportResult> {
      const progress = onProgress ?? (() => {});
      const fontSource = new NodeFontSource();
      const fonts = new FontManager(fontSource);
      const assetMeta = loadAssetMeta(db);
      const assets = new DbAssetCatalog(assetMeta);
      const businesses = new DbBusinessCatalog(db);

      progress('loading map data');
      const mapData = await loadMapData(edition);

      progress('compiling layout');
      const env: CompileEnv = { fonts, assets, businesses, mapData, compileMap };
      const render = await compileEdition(edition, env);

      const slug = slugify(`${edition.hotel.name}-${edition.name}`);

      if (kind === 'digital') {
        progress('rendering digital edition');
        const assetUrl = await buildAssetDataUrls(assetsDir, assetMeta, render.assetsUsed);
        const html = renderDigitalHtml(render, edition, { fonts, assetUrl });
        return {
          filename: `${slug}.html`,
          bytes: new TextEncoder().encode(html),
          diagnostics: render.diagnostics,
        };
      }

      // press / proof — both from the same render.
      progress(kind === 'press' ? 'writing press PDF/X-4' : 'writing screen proof');
      const pressStore = new DiskPressAssetStore(assetsDir, assetMeta);
      const spot =
        kind === 'press' && edition.settings.spotColor
          ? {
              name: edition.settings.spotColor.name,
              alt: effectiveCmyk(hexToCmyk(edition.settings.spotColor.altHex)),
            }
          : undefined;

      const opts: PressOptions = {
        mode: kind === 'press' ? 'press' : 'proof',
        title: `${edition.hotel.name} — ${edition.name}`,
        icc: BUILTIN_CMYK_PROFILE,
        fonts: fontSource,
        faces: fontSource.list(),
        assets: pressStore,
        spot,
        inkLimit: edition.settings.inkLimit,
        marks: kind === 'press',
        targetDpi: 300,
      };
      const result = await writePdf(render, opts);
      return {
        filename: `${slug}-${kind}.pdf`,
        bytes: result.bytes,
        diagnostics: [...render.diagnostics, ...result.preflight],
        stats: result.stats,
      };
    },
  };
}

async function loadMapData(edition: Edition): Promise<OsmData | undefined> {
  const src = edition.map.source;
  if (!src) return undefined;
  try {
    const source = resolveMapSource(src);
    const bbox = edition.map.bbox ?? boundsFromListings(edition);
    if (!bbox) return undefined;
    return await source.fetch(bbox);
  } catch {
    // A missing/unknown source is not fatal — the engine shows a placeholder
    // and raises a diagnostic.
    return undefined;
  }
}

function boundsFromListings(edition: Edition): NonNullable<Edition['map']['bbox']> | undefined {
  // Without explicit bbox we cannot fetch a fixture window; fixtures ignore it
  // anyway, so return a permissive global box so the source still loads.
  if (edition.map.bbox) return edition.map.bbox;
  return { minLat: -90, minLng: -180, maxLat: 90, maxLng: 180 };
}

async function buildAssetDataUrls(
  assetsDir: string,
  meta: Map<string, { filename: string }>,
  used: string[],
): Promise<(id: string) => string> {
  const urls = new Map<string, string>();
  await Promise.all(
    used.map(async (id) => {
      const m = meta.get(id);
      if (!m) return;
      try {
        const bytes = await readFile(path.join(assetsDir, m.filename));
        const mime = m.filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        urls.set(id, `data:${mime};base64,${bytes.toString('base64')}`);
      } catch {
        /* missing file → leave unresolved; the painter shows nothing, render flags it */
      }
    }),
  );
  return (id: string) => urls.get(id) ?? '';
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-') || 'guide'
  );
}
