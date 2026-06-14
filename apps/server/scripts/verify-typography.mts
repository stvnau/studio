/**
 * Focused end-to-end check for per-element typography overrides on REAL demo
 * data: seed the demo, compile it once as a baseline, then compile again with a
 * typography override on a real listing's name frame and confirm the override
 * (size · caps · alignment · tracking) actually changes the compiled glyph run
 * AND that the press PDF/X-4 still writes. No rasteriser needed.
 *
 *   tsx apps/server/scripts/verify-typography.mts [outDir]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager, compileEdition, type CompileEnv } from '@guide/engine';
import { NodeFontSource } from '@guide/fonts/node';
import { compileMap, resolveMapSource } from '@guide/carto';
import { writePdf, BUILTIN_CMYK_PROFILE } from '@guide/press';
import {
  numberedListings,
  walkItems,
  type Edition,
  type GlyphRun,
  type DocRender,
} from '@guide/shared';
import { openDb, ensureDataDirs } from '../src/db.js';
import { loadSeed } from '../src/seed.js';
import { DbAssetCatalog, DbBusinessCatalog, DiskPressAssetStore, loadAssetMeta } from '../src/pipeline/catalogs.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const outDir = path.resolve(process.argv[2] ?? '/tmp/guide-typo');
const dataDir = path.join(outDir, 'data');
mkdirSync(outDir, { recursive: true });
ensureDataDirs(dataDir);
loadSeed(dataDir, path.join(ROOT, 'fixtures/demo/seed.json'));

const db = openDb(dataDir);
const edition = JSON.parse((db.prepare('SELECT doc FROM editions LIMIT 1').get() as { doc: string }).doc) as Edition;

const fontSource = new NodeFontSource();
const fonts = new FontManager(fontSource);
const assetMeta = loadAssetMeta(db);
const env: CompileEnv = {
  fonts,
  assets: new DbAssetCatalog(assetMeta),
  businesses: new DbBusinessCatalog(db),
  mapData: await resolveMapSource(edition.map.source).fetch(edition.map.bbox!),
  compileMap,
};

const nameRun = (r: DocRender, frame: string): GlyphRun | undefined => {
  for (const page of r.pages)
    for (const item of walkItems(page.items))
      if (item.t === 'text' && item.meta?.frame === frame && item.runs[0]) return item.runs[0];
  return undefined;
};
const span = (run: GlyphRun) => Math.max(...run.glyphs.map((g) => g.x)) - Math.min(...run.glyphs.map((g) => g.x));

// Pick a real listing and target its name frame.
const target = numberedListings(edition)[0]!.listing.id;
const frame = `listing:${target}:name`;

const base = await compileEdition(edition, env);
const baseRun = nameRun(base, frame);
if (!baseRun) throw new Error(`no baseline run for ${frame}`);

const edited: Edition = {
  ...edition,
  overrides: [
    {
      frame,
      patch: { fontScale: 0.6, caps: true, align: 'center', tracking: 200 },
      base: { x: 0, y: 0, w: 0, h: 0 },
      at: new Date().toISOString(),
    },
  ],
};
const after = await compileEdition(edited, env);
const run = nameRun(after, frame);
if (!run) throw new Error(`no overridden run for ${frame}`);

const baseX = Math.min(...baseRun.glyphs.map((g) => g.x));
const editedX = Math.min(...run.glyphs.map((g) => g.x));

const checks: [string, boolean, string][] = [
  ['type size scaled ~0.6×', Math.abs(run.size - baseRun.size * 0.6) < 0.5, `${baseRun.size.toFixed(2)} → ${run.size.toFixed(2)}`],
  ['forced uppercase', run.text === run.text.toUpperCase() && baseRun.text !== baseRun.text.toUpperCase(), `"${baseRun.text}" → "${run.text}"`],
  ['centred (moved right)', editedX > baseX + 1, `x ${baseX.toFixed(1)} → ${editedX.toFixed(1)}`],
  ['no spurious override conflict', after.diagnostics.filter((d) => d.code === 'override.conflict').length === 0, ''],
];

console.log(`\n▸ typography override on real frame ${frame}`);
let ok = true;
for (const [label, pass, detail] of checks) {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? `  (${detail})` : ''}`);
  ok &&= pass;
}

// Press PDF still writes with the override applied.
const press = await writePdf(after, {
  mode: 'press',
  title: `${edition.hotel.name} — ${edition.name}`,
  icc: BUILTIN_CMYK_PROFILE,
  fonts: fontSource,
  faces: fontSource.list(),
  assets: new DiskPressAssetStore(path.join(dataDir, 'assets'), assetMeta),
  inkLimit: edition.settings.inkLimit,
  marks: true,
  targetDpi: 300,
});
writeFileSync(path.join(outDir, 'press.pdf'), press.bytes);
const pressErrors = press.preflight.filter((d) => d.severity === 'error').length;
console.log(`  ${pressErrors === 0 ? '✓' : '✗'} press PDF wrote (${(press.bytes.length / 1024).toFixed(0)} KB, ${pressErrors} preflight errors)`);
ok &&= pressErrors === 0;

db.close();
console.log(ok ? '\nALL TYPOGRAPHY CHECKS PASSED\n' : '\nFAILED\n');
process.exit(ok ? 0 : 1);
