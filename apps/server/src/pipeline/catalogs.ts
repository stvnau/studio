/**
 * Server-side catalogs: adapt the SQLite document store and the on-disk asset
 * files to the read-only interfaces the engine and press writer expect. No
 * pixel IO happens during layout (the engine only reads metadata); the press
 * writer pulls bytes lazily through PressAssetStore.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type DatabaseT from 'better-sqlite3';
import type { Business, ImageAsset } from '@guide/shared';
import type { AssetCatalog, BusinessCatalog } from '@guide/engine';
import type { PressAssetStore, PressImage } from '@guide/press';

export function loadAssetMeta(db: DatabaseT.Database): Map<string, ImageAsset & { filename: string }> {
  const rows = db.prepare('SELECT id, meta, filename FROM assets').all() as {
    id: string;
    meta: string;
    filename: string;
  }[];
  const map = new Map<string, ImageAsset & { filename: string }>();
  for (const r of rows) {
    const meta = JSON.parse(r.meta) as ImageAsset;
    map.set(r.id, { ...meta, filename: r.filename });
  }
  return map;
}

export class DbAssetCatalog implements AssetCatalog {
  constructor(private meta: Map<string, ImageAsset & { filename: string }>) {}
  get(id: string): ImageAsset | undefined {
    return this.meta.get(id);
  }
}

export class DbBusinessCatalog implements BusinessCatalog {
  private cache = new Map<string, Business | null>();
  constructor(private db: DatabaseT.Database) {}
  get(id: string): Business | undefined {
    const hit = this.cache.get(id);
    if (hit !== undefined) return hit ?? undefined;
    const row = this.db.prepare('SELECT doc FROM businesses WHERE id = ?').get(id) as
      | { doc: string }
      | undefined;
    const biz = row ? (JSON.parse(row.doc) as Business) : null;
    this.cache.set(id, biz);
    return biz ?? undefined;
  }
}

/** Reads the stored original image bytes for press embedding. */
export class DiskPressAssetStore implements PressAssetStore {
  constructor(
    private assetsDir: string,
    private meta: Map<string, ImageAsset & { filename: string }>,
  ) {}

  async getImage(id: string): Promise<PressImage> {
    const m = this.meta.get(id);
    if (!m) throw new Error(`asset not found: ${id}`);
    const bytes = new Uint8Array(await readFile(path.join(this.assetsDir, m.filename)));
    const ext = path.extname(m.filename).toLowerCase();
    return {
      bytes,
      width: m.width,
      height: m.height,
      format: ext === '.png' ? 'png' : 'jpeg',
    };
  }
}
