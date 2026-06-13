/**
 * End-to-end verification: seed the demo edition, compile it once, then
 * (a) rasterise every page to a PNG contact sheet so a human can LOOK at the
 * output, (b) write the press PDF/X-4 and screen proof, (c) render the digital
 * edition, and (d) print all diagnostics + preflight + stats.
 *
 *   tsx apps/server/scripts/verify-demo.mts [outDir]
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { paintPageSvg } from '@guide/paint';
import { FontManager, compileEdition, type CompileEnv } from '@guide/engine';
import { NodeFontSource } from '@guide/fonts/node';
import { compileMap, resolveMapSource } from '@guide/carto';
import { writePdf, BUILTIN_CMYK_PROFILE } from '@guide/press';
import { worstSeverity, type Diagnostic, type Edition, type DocRender } from '@guide/shared';
import { openDb, ensureDataDirs } from '../src/db.js';
import { loadSeed } from '../src/seed.js';
import {
  DbAssetCatalog,
  DbBusinessCatalog,
  DiskPressAssetStore,
  loadAssetMeta,
} from '../src/pipeline/catalogs.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const outDir = path.resolve(process.argv[2] ?? '/tmp/guide-verify');
const dataDir = path.join(outDir, 'data');
mkdirSync(outDir, { recursive: true });
ensureDataDirs(dataDir);

console.log('▸ seeding demo into', dataDir);
loadSeed(dataDir, path.join(ROOT, 'fixtures/demo/seed.json'));

const db = openDb(dataDir);
const editionRow = db.prepare('SELECT doc FROM editions LIMIT 1').get() as { doc: string };
const edition = JSON.parse(editionRow.doc) as Edition;

const fontSource = new NodeFontSource();
const fonts = new FontManager(fontSource);
const assetMeta = loadAssetMeta(db);
const assets = new DbAssetCatalog(assetMeta);
const businesses = new DbBusinessCatalog(db);

console.log('▸ loading map fixture', edition.map.source);
const mapData = await resolveMapSource(edition.map.source).fetch(edition.map.bbox!);

console.log('▸ compiling edition');
const env: CompileEnv = { fonts, assets, businesses, mapData, compileMap };
const render: DocRender = await compileEdition(edition, env);
console.log(`  ${render.pages.length} pages, ${render.assetsUsed.length} assets, ${Object.keys(render.fontsUsed).length} fonts`);

/* ---- rasterise a contact sheet ---- */
const assetsDir = path.join(dataDir, 'assets');
const assetDataUrl = (id: string): string => {
  const m = assetMeta.get(id);
  if (!m) return '';
  const bytes = readFileSync(path.join(assetsDir, m.filename));
  const mime = m.filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${bytes.toString('base64')}`;
};

const PAGE_W = 460;
const pngs: Buffer[] = [];
for (const page of render.pages) {
  const svg = paintPageSvg(page, {
    glyphPath: (f, g) => fonts.glyphPath(f, g),
    unitsPerEm: (f) => fonts.metrics(f).unitsPerEm,
    assetUrl: assetDataUrl,
    showBleed: false,
    background: '#ffffff',
  });
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: PAGE_W } });
  const png = Buffer.from(r.render().asPng());
  pngs.push(png);
  writeFileSync(path.join(outDir, `page-${String(render.pages.indexOf(page) + 1).padStart(2, '0')}-${page.pageId.replace(/[^\w]/g, '_')}.png`), png);
}

// Contact sheet: grid of pages.
const metas = await Promise.all(pngs.map((p) => sharp(p).metadata()));
const cellW = PAGE_W;
const cellH = Math.max(...metas.map((m) => m.height ?? 0));
const cols = 5;
const rows = Math.ceil(pngs.length / cols);
const pad = 24;
const sheetW = cols * cellW + (cols + 1) * pad;
const sheetH = rows * cellH + (rows + 1) * pad;
const composites = pngs.map((p, i) => ({
  input: p,
  left: pad + (i % cols) * (cellW + pad),
  top: pad + Math.floor(i / cols) * (cellH + pad),
}));
await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: '#d9d7cf' } })
  .composite(composites)
  .png()
  .toFile(path.join(outDir, 'contact-sheet.png'));
console.log('▸ wrote contact-sheet.png', `${sheetW}×${sheetH}`);

/* ---- press PDF + proof ---- */
const pressStore = new DiskPressAssetStore(assetsDir, assetMeta);
const press = await writePdf(render, {
  mode: 'press',
  title: `${edition.hotel.name} — ${edition.name}`,
  icc: BUILTIN_CMYK_PROFILE,
  fonts: fontSource,
  faces: fontSource.list(),
  assets: pressStore,
  spot: undefined,
  inkLimit: edition.settings.inkLimit,
  marks: true,
  targetDpi: 300,
});
writeFileSync(path.join(outDir, 'press.pdf'), press.bytes);
console.log('▸ wrote press.pdf', `${(press.bytes.length / 1024).toFixed(0)} KB`, JSON.stringify(press.stats));

/* ---- diagnostics ---- */
const all: Diagnostic[] = [...render.diagnostics, ...press.preflight];
const byCode = new Map<string, { sev: string; n: number; sample: string }>();
for (const d of all) {
  const e = byCode.get(d.code) ?? { sev: d.severity, n: 0, sample: d.message };
  e.n++;
  byCode.set(d.code, e);
}
console.log('\n=== DIAGNOSTICS (worst: ' + (worstSeverity(all) ?? 'none') + ') ===');
for (const [code, e] of [...byCode.entries()].sort()) {
  console.log(`  [${e.sev}] ${code} ×${e.n} — ${e.sample.slice(0, 90)}`);
}
const errors = all.filter((d) => d.severity === 'error');
console.log(`\n${errors.length} error(s), ${all.filter((d) => d.severity === 'warning').length} warning(s).`);
console.log('\nOverset frames:');
for (const d of all.filter((d) => d.code === 'text.overset')) {
  console.log(`  ${d.frame} :: ${d.message.slice(0, 70)}`);
}
db.close();
