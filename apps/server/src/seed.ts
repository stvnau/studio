/**
 * Seed loader: upserts businesses/editions/assets from a JSON file.
 *
 *   { businesses: Business[], editions: Edition[],
 *     assets?: [{ id, file (path relative to the seed file), meta }] }
 *
 * CLI: tsx src/seed.ts <seedPath>   (data dir from GUIDE_DATA_DIR or default)
 */

import { copyFileSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Business, Edition, ImageAsset } from '@guide/shared';
import { checkNumberingIntegrity, normalizeOrder } from '@guide/shared';
import { ensureDataDirs, nowIso, openDb } from './db.js';

interface SeedAsset {
  id: string;
  /** Path to the image file, relative to the seed file. */
  file: string;
  meta: ImageAsset;
}

interface SeedFile {
  businesses?: Business[];
  editions?: Edition[];
  assets?: SeedAsset[];
}

export function loadSeed(
  dataDir: string,
  seedPath: string,
): { businesses: number; editions: number; assets: number } {
  const resolvedSeed = path.resolve(seedPath);
  const seedDir = path.dirname(resolvedSeed);
  const seed = JSON.parse(readFileSync(resolvedSeed, 'utf8')) as SeedFile;

  const dirs = ensureDataDirs(dataDir);
  const db = openDb(dataDir);
  try {
    const upsertBusiness = db.prepare(
      `INSERT INTO businesses (id, doc, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at`,
    );
    const upsertEdition = db.prepare(
      `INSERT INTO editions (id, doc, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at`,
    );
    const upsertAsset = db.prepare(
      `INSERT INTO assets (id, meta, filename, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET meta = excluded.meta, filename = excluded.filename`,
    );

    const run = db.transaction(() => {
      for (const business of seed.businesses ?? []) {
        upsertBusiness.run(business.id, JSON.stringify(business), nowIso());
      }
      for (const edition of seed.editions ?? []) {
        const doc: Edition = { ...edition, updatedAt: edition.updatedAt || nowIso() };
        doc.listingOrder = normalizeOrder(doc);
        const integrity = checkNumberingIntegrity(doc);
        if (!integrity.ok) {
          throw new Error(`seed edition ${doc.id}: numbering integrity violated after repair`);
        }
        upsertEdition.run(doc.id, JSON.stringify(doc), doc.updatedAt);
      }
      for (const asset of seed.assets ?? []) {
        const src = path.resolve(seedDir, asset.file);
        const ext = path.extname(src).toLowerCase() === '.png' ? 'png' : 'jpg';
        const storedName = `${asset.id}.${ext}`;
        copyFileSync(src, path.join(dirs.assets, storedName));
        const meta: ImageAsset = { ...asset.meta, id: asset.id };
        upsertAsset.run(asset.id, JSON.stringify(meta), storedName, nowIso());
      }
    });
    run();

    return {
      businesses: seed.businesses?.length ?? 0,
      editions: seed.editions?.length ?? 0,
      assets: seed.assets?.length ?? 0,
    };
  } finally {
    db.close();
  }
}

/* CLI entry: tsx src/seed.ts <seedPath> */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.resolve(HERE, '../../../data');

function isMain(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return pathToFileURL(realpathSync(argv1)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMain()) {
  const seedPath = process.argv[2];
  if (!seedPath) {
    console.error('usage: tsx src/seed.ts <seedPath>');
    process.exit(1);
  }
  const dataDir = process.env.GUIDE_DATA_DIR ?? DEFAULT_DATA_DIR;
  const counts = loadSeed(dataDir, seedPath);
  console.log(
    `seeded ${counts.businesses} businesses, ${counts.editions} editions, ${counts.assets} assets into ${dataDir}`,
  );
}
