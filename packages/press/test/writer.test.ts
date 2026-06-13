/**
 * writePdf end-to-end tests. Builds a small DocRender by hand (real shaping
 * via fontkit — the same engine FontManager uses — over a real @guide/fonts
 * font), runs both press and proof modes, and asserts structure, preflight
 * and the PDF/X-4 OutputIntent.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import * as fontkit from 'fontkit';
import type { Font } from 'fontkit';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { NodeFontSource } from '@guide/fonts/node';
import {
  cmyk,
  rectPath,
  type Color,
  type DLItem,
  type DocRender,
  type GlyphRun,
  type PageRender,
  type PlacedGlyph,
} from '@guide/shared';
import { BUILTIN_CMYK_PROFILE } from '../src/icc/builtin.js';
import { writePdf } from '../src/index.js';
import type { PressAssetStore, PressImage, PressOptions } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');

// 100 x 200 mm trim, 3 mm bleed, in points.
const MM = 72 / 25.4;
const TRIM_W = 100 * MM; // 283.46pt
const TRIM_H = 200 * MM; // 566.93pt
const BLEED = 3 * MM; // 8.5pt

const FONT_ID = 'newsreader-400';

/**
 * Shape a word with fontkit (the same library + bytes @guide/engine's
 * FontManager uses) and turn it into a single positioned GlyphRun at (x,y).
 * Kerning and ligatures come straight from fontkit's layout engine.
 */
function shapeRun(
  font: Font,
  fontId: string,
  text: string,
  size: number,
  color: Color,
  originX: number,
  baselineY: number,
): { run: GlyphRun; gids: number[] } {
  const run = font.layout(text, { liga: true, kern: true });
  const scale = size / font.unitsPerEm;
  const glyphs: PlacedGlyph[] = [];
  const gids: number[] = [];
  let penX = originX;
  for (let i = 0; i < run.glyphs.length; i++) {
    const g = run.glyphs[i]!;
    const pos = run.positions[i]!;
    glyphs.push({ g: g.id, x: penX + pos.xOffset * scale, y: baselineY - pos.yOffset * scale });
    gids.push(g.id);
    penX += pos.xAdvance * scale;
  }
  return { run: { font: fontId, size, color, glyphs, text }, gids };
}

/** A stub asset store returning a tiny solid-colour JPEG. */
class StubAssets implements PressAssetStore {
  private cache?: PressImage;
  async getImage(): Promise<PressImage> {
    if (this.cache) return this.cache;
    const bytes = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 40, g: 90, b: 160 } },
    })
      .jpeg({ quality: 80 })
      .toBuffer();
    this.cache = { bytes: new Uint8Array(bytes), width: 100, height: 100, format: 'jpeg' };
    return this.cache;
  }
}

/** Load a catalog font's bytes and parse it with fontkit. */
async function loadFont(fontId: string): Promise<Font> {
  const bytes = await new NodeFontSource().getBytes(fontId);
  return fontkit.create(Buffer.from(bytes)) as Font;
}

async function buildRender(font: Font): Promise<{ render: DocRender; gids: number[] }> {
  const fonts = font;
  const allGids = new Set<number>();
  const collect = (gids: number[]) => gids.forEach((g) => allGids.add(g));

  // Page 1: a CMYK rect (mid green), a pure-black hairline, a text run, an image.
  const greenRect: DLItem = {
    t: 'path',
    d: rectPath({ x: BLEED + 20, y: BLEED + 20, w: 120, h: 80 }),
    fill: { color: cmyk(0.5, 0.1, 0.7, 0) },
  };
  const hairline: DLItem = {
    t: 'path',
    d: [
      ['M', BLEED + 20, BLEED + 140],
      ['L', BLEED + 200, BLEED + 140],
    ],
    stroke: { color: cmyk(0, 0, 0, 1), width: 0.3 }, // pure K -> overprint
  };
  const headline = shapeRun(fonts, FONT_ID, 'Wexford', 24, cmyk(0, 0, 0, 1), BLEED + 20, BLEED + 200);
  collect(headline.gids);
  const text1: DLItem = { t: 'text', runs: [headline.run] };
  const image1: DLItem = {
    t: 'image',
    asset: 'photo-1',
    rect: { x: BLEED + 20, y: BLEED + 240, w: 160, h: 120 },
    crop: { x: 0, y: 0, w: 1, h: 1 },
    dpi: 300,
    meta: { frame: 'hero' },
  };

  const page1: PageRender = {
    pageId: 'p1',
    trim: { w: TRIM_W, h: TRIM_H },
    bleed: BLEED,
    side: 'right',
    items: [greenRect, hairline, text1, image1],
  };

  // Page 2: a full-bleed background rect that DOES reach all edges + a label.
  const fullBleed: DLItem = {
    t: 'path',
    d: rectPath({ x: 0, y: 0, w: TRIM_W + 2 * BLEED, h: TRIM_H + 2 * BLEED }),
    fill: { color: cmyk(0.05, 0.05, 0.1, 0) },
  };
  const label = shapeRun(fonts, FONT_ID, 'Page two', 14, cmyk(0, 0, 0, 1), BLEED + 30, BLEED + 60);
  collect(label.gids);
  const text2: DLItem = { t: 'text', runs: [label.run] };

  const page2: PageRender = {
    pageId: 'p2',
    trim: { w: TRIM_W, h: TRIM_H },
    bleed: BLEED,
    side: 'left',
    items: [fullBleed, text2],
  };

  const render: DocRender = {
    editionId: 'test-edition',
    pages: [page1, page2],
    fontsUsed: { [FONT_ID]: { glyphs: [...allGids].sort((a, b) => a - b) } },
    assetsUsed: ['photo-1'],
    diagnostics: [],
  };
  return { render, gids: [...allGids] };
}

function baseOpts(mode: 'press' | 'proof'): PressOptions {
  return {
    mode,
    title: 'Test Guide',
    icc: BUILTIN_CMYK_PROFILE,
    fonts: new NodeFontSource(),
    faces: [],
    assets: new StubAssets(),
    inkLimit: 300,
    marks: true,
    targetDpi: 300,
  };
}

describe('writePdf', () => {
  it('emits a valid PDF/X-4 press file with marks, fonts and OutputIntent', async () => {
    const font = await loadFont(FONT_ID);
    const { render } = await buildRender(font);
    const result = await writePdf(render, baseOpts('press'));

    // Bytes start with the PDF header.
    const head = new TextDecoder().decode(result.bytes.slice(0, 5));
    expect(head).toBe('%PDF-');

    // Reparses cleanly.
    const reparsed = await PDFDocument.load(result.bytes);
    expect(reparsed.getPageCount()).toBe(2);

    // MediaBox = bleed box; TrimBox inset by bleed.
    const page = reparsed.getPage(0);
    const media = page.getMediaBox();
    expect(media.width).toBeCloseTo(TRIM_W + 2 * BLEED, 2);
    expect(media.height).toBeCloseTo(TRIM_H + 2 * BLEED, 2);
    const trim = page.node.TrimBox();
    expect(trim).toBeTruthy();
    const trimNums = (trim as PDFArray).asRectangle();
    expect(trimNums.x).toBeCloseTo(BLEED, 2);
    expect(trimNums.y).toBeCloseTo(BLEED, 2);
    expect(trimNums.width).toBeCloseTo(TRIM_W, 2);
    expect(trimNums.height).toBeCloseTo(TRIM_H, 2);

    // OutputIntent present with GTS_PDFX.
    const intents = reparsed.catalog.lookup(PDFName.of('OutputIntents'), PDFArray);
    expect(intents.size()).toBe(1);

    // No error diagnostics for the clean doc.
    const errors = result.preflight.filter((d) => d.severity === 'error');
    expect(errors, JSON.stringify(errors)).toHaveLength(0);

    // Stats.
    expect(result.stats.pages).toBe(2);
    expect(result.stats.fontsEmbedded.length).toBeGreaterThan(0);
    expect(result.stats.imagesEmbedded).toBe(1);
    expect(result.stats.pdfVersion).toBe('1.7');

    // Write the sample for inspection.
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(join(OUT_DIR, 'sample.pdf'), result.bytes);
  });

  it('flags ink-limit errors when a colour exceeds the limit', async () => {
    const font = await loadFont(FONT_ID);
    const { render } = await buildRender(font);
    // Add an over-ink rect: CMYK 1,1,1,1 = 400% ink, limit 300%.
    render.pages[0]!.items.push({
      t: 'path',
      d: rectPath({ x: BLEED, y: BLEED, w: 200, h: 200 }),
      fill: { color: cmyk(1, 1, 1, 1) },
    });
    const result = await writePdf(render, baseOpts('press'));
    const inkErr = result.preflight.find(
      (d) => d.code === 'press.ink-limit' && d.severity === 'error',
    );
    expect(inkErr).toBeTruthy();
    expect(result.stats.maxInkCoverage).toBeGreaterThanOrEqual(400);
  });

  it('warns when a declared spot colour is unused', async () => {
    const font = await loadFont(FONT_ID);
    const { render } = await buildRender(font);
    const opts = baseOpts('press');
    opts.spot = { name: 'Brand Orange', alt: [0, 0.5, 1, 0] };
    const result = await writePdf(render, opts);
    expect(result.preflight.some((d) => d.code === 'press.spot-unused')).toBe(true);
  });

  it('produces an RGB proof without an X-4 OutputIntent, smaller than press', async () => {
    const font = await loadFont(FONT_ID);
    const { render: r1 } = await buildRender(font);
    const pressResult = await writePdf(r1, baseOpts('press'));

    const { render: r2 } = await buildRender(font);
    const proofResult = await writePdf(r2, baseOpts('proof'));

    const proof = await PDFDocument.load(proofResult.bytes);
    expect(proof.getPageCount()).toBe(2);

    // No OutputIntent in proof mode.
    const intents = proof.catalog.lookupMaybe(PDFName.of('OutputIntents'), PDFArray);
    expect(intents).toBeUndefined();

    // Proof is smaller (RGB JPEG image + no ICC profile stream).
    expect(proofResult.bytes.length).toBeLessThan(pressResult.bytes.length);

    // No X-4-only colourspace errors in proof.
    const csErrors = proofResult.preflight.filter((d) => d.code === 'press.image-colorspace');
    expect(csErrors).toHaveLength(0);
  });
});
