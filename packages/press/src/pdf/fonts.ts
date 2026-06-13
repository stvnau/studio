/**
 * Font embedding: fontkit subsetting + Type0/CIDFontType2 (Identity-H).
 *
 * fontkit subsets REINDEX glyphs: a glyph's id in the subset font is its
 * position in inclusion order (glyph 0 / .notdef is always included first by
 * the Subset constructor). We mirror that ordering in `glyphMap` — every
 * PlacedGlyph.g from the display list MUST be remapped through `mapGlyph()`
 * when content is emitted, and the W array / ToUnicode CMap are keyed by the
 * NEW ids. Composite-glyph components pulled in during `subset.encode()` are
 * appended after our glyphs and never referenced as CIDs, so they need no
 * W/ToUnicode entries.
 */

import * as fontkit from 'fontkit';
import type { Font } from 'fontkit';
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
} from 'pdf-lib';
import type { FontSource } from '@guide/shared';

interface SubsetHandle {
  includeGlyph(glyph: number): number;
  encode(): Uint8Array;
}

export interface EmbeddedFont {
  id: string;
  /** Resource name in page Resources, e.g. 'F0'. */
  resourceName: string;
  ref: PDFRef;
  font: Font;
  unitsPerEm: number;
  /** Original TTF byte length (for stats / tests). */
  originalLength: number;
  /** Subset byte length, available after finish(). */
  subsetLength: number;
  baseFont: string;
}

interface FontState extends EmbeddedFont {
  subset: SubsetHandle;
  /** old glyph id -> new (subset) glyph id, in inclusion order. */
  glyphMap: Map<number, number>;
  /** new glyph id -> advance width in 1000/em units. */
  advances: Map<number, number>;
  /** new glyph id -> unicode code points (from the ORIGINAL font). */
  unicode: Map<number, number[]>;
  /** Lazy old-glyph-id -> code point, built from the cmap on first miss. */
  reverseCmap?: Map<number, number>;
}

/**
 * fontkit only attaches `codePoints` to glyphs produced by `font.layout()`;
 * glyphs fetched by id via `getGlyph()` — which is how display-list glyph
 * usage (GIDs only, no text) reaches us — come back with an empty list. To
 * keep ToUnicode complete we build a reverse cmap (glyph id -> code point)
 * from the font's character set once and consult it on demand.
 */
function reverseCmapFor(font: Font): Map<number, number> {
  const rev = new Map<number, number>();
  for (const cp of font.characterSet) {
    const glyph = font.glyphForCodePoint(cp);
    if (glyph && !rev.has(glyph.id)) rev.set(glyph.id, cp);
  }
  return rev;
}

function subsetTag(index: number): string {
  // Deterministic 6-letter tag per font index: GSAAAA, GSAAAB, ...
  let n = index;
  let tail = '';
  for (let i = 0; i < 4; i++) {
    tail = String.fromCharCode(65 + (n % 26)) + tail;
    n = Math.floor(n / 26);
  }
  return `GS${tail}`;
}

function sanitizePsName(name: string): string {
  const clean = name.replace(/[^!-~]/g, '');
  return clean.replace(/[()<>[\]{}/%#]/g, '') || 'Embedded';
}

export class FontEmbedder {
  private states = new Map<string, FontState>();
  private finished = false;

  private constructor(private doc: PDFDocument) {}

  /**
   * Load every font in `fontsUsed`, create subsets and pre-include the
   * display list's glyph usage (sorted, so output is deterministic).
   */
  static async create(
    doc: PDFDocument,
    fonts: FontSource,
    fontsUsed: Record<string, { glyphs: number[] }>,
  ): Promise<FontEmbedder> {
    const embedder = new FontEmbedder(doc);
    const ids = Object.keys(fontsUsed).sort();
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const bytes = await fonts.getBytes(id);
      const fk = fontkit.create(Buffer.from(bytes)) as Font;
      if (!fk || typeof (fk as unknown as { createSubset?: unknown }).createSubset !== 'function') {
        throw new Error(`Font '${id}' is not a usable single font (collection?)`);
      }
      const subset = fk.createSubset() as unknown as SubsetHandle;
      const state: FontState = {
        id,
        resourceName: `F${i}`,
        ref: doc.context.nextRef(),
        font: fk,
        unitsPerEm: fk.unitsPerEm,
        originalLength: bytes.length,
        subsetLength: 0,
        baseFont: `${subsetTag(i)}+${sanitizePsName(fk.postscriptName ?? id)}`,
        subset,
        glyphMap: new Map([[0, 0]]), // .notdef included by the Subset constructor
        advances: new Map(),
        unicode: new Map(),
      };
      state.advances.set(0, Math.round((fk.getGlyph(0).advanceWidth / fk.unitsPerEm) * 1000));
      embedder.states.set(id, state);
      const used = fontsUsed[id]?.glyphs ?? [];
      for (const g of [...used].sort((a, b) => a - b)) embedder.mapGlyph(id, g);
    }
    return embedder;
  }

  has(fontId: string): boolean {
    return this.states.has(fontId);
  }

  get(fontId: string): EmbeddedFont {
    const s = this.states.get(fontId);
    if (!s) throw new Error(`Font '${fontId}' was not declared in render.fontsUsed`);
    return s;
  }

  /** All embedded fonts in deterministic (resource) order. */
  list(): EmbeddedFont[] {
    return [...this.states.values()];
  }

  /** First embedded font (marks info line), if any. */
  first(): EmbeddedFont | undefined {
    return this.states.values().next().value;
  }

  /**
   * Map an original glyph id to its subset id, including it on demand
   * (printer's-marks text adds glyphs beyond render.fontsUsed). Must be
   * called before finish().
   */
  mapGlyph(fontId: string, oldGid: number): number {
    const s = this.states.get(fontId);
    if (!s) throw new Error(`Font '${fontId}' was not declared in render.fontsUsed`);
    const existing = s.glyphMap.get(oldGid);
    if (existing !== undefined) return existing;
    if (this.finished) throw new Error(`Glyph ${oldGid} of '${fontId}' requested after subsetting`);
    // Mirror fontkit's inclusion-order indexing; also call includeGlyph so the
    // subset actually contains the glyph. fontkit returns the new id — assert
    // agreement so a fontkit behaviour change cannot silently mis-map text.
    const expected = s.glyphMap.size;
    const fromFontkit = s.subset.includeGlyph(oldGid) as unknown as number;
    if (typeof fromFontkit === 'number' && fromFontkit !== expected) {
      throw new Error(
        `fontkit reindex mismatch for '${fontId}' glyph ${oldGid}: got ${fromFontkit}, expected ${expected}`,
      );
    }
    s.glyphMap.set(oldGid, expected);
    const glyph = s.font.getGlyph(oldGid);
    s.advances.set(expected, Math.round((glyph.advanceWidth / s.unitsPerEm) * 1000));
    let cps = glyph.codePoints;
    if (!cps || cps.length === 0) {
      // GID-only inclusion (display-list usage) — recover the code point from
      // the font's reverse cmap so ToUnicode stays complete for extraction.
      s.reverseCmap ??= reverseCmapFor(s.font);
      const cp = s.reverseCmap.get(oldGid);
      if (cp !== undefined) cps = [cp];
    }
    if (cps && cps.length > 0) s.unicode.set(expected, [...cps]);
    return expected;
  }

  /** Advance of an ORIGINAL glyph id in 1000/em units. */
  advance1000(fontId: string, oldGid: number): number {
    const s = this.states.get(fontId);
    if (!s) throw new Error(`Font '${fontId}' was not declared in render.fontsUsed`);
    const newGid = this.mapGlyph(fontId, oldGid);
    return s.advances.get(newGid) ?? 0;
  }

  /**
   * Encode subsets and write all font objects. Call once, after every page's
   * content (including marks) has been emitted.
   */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    for (const s of this.states.values()) this.writeFont(s);
  }

  private writeFont(s: FontState): void {
    const ctx = this.doc.context;
    const subsetBytes = s.subset.encode();
    s.subsetLength = subsetBytes.length;

    const fontFileRef = ctx.register(
      ctx.flateStream(subsetBytes, { Length1: subsetBytes.length }),
    );

    const scale = 1000 / s.unitsPerEm;
    const bbox = s.font.bbox;
    const italicAngle = s.font.italicAngle ?? 0;
    // Flags: bit 3 (Symbolic, value 4) is correct for Identity-H CID fonts;
    // serif (2) and italic (64) best-effort.
    let flags = 4;
    if (/serif|fraunces|newsreader/i.test(s.font.familyName ?? '')) flags |= 2;
    if (italicAngle !== 0) flags |= 64;

    const descriptorRef = ctx.register(
      ctx.obj({
        Type: 'FontDescriptor',
        FontName: s.baseFont,
        Flags: flags,
        FontBBox: [
          Math.floor(bbox.minX * scale),
          Math.floor(bbox.minY * scale),
          Math.ceil(bbox.maxX * scale),
          Math.ceil(bbox.maxY * scale),
        ],
        ItalicAngle: italicAngle,
        Ascent: Math.round((s.font.ascent ?? 0) * scale),
        Descent: Math.round((s.font.descent ?? 0) * scale),
        CapHeight: Math.round((s.font.capHeight || s.font.ascent || 0) * scale),
        StemV: 80,
        FontFile2: fontFileRef,
      }),
    );

    // W array: our subset ids are contiguous 0..N in inclusion order.
    const count = s.glyphMap.size;
    const widths: number[] = [];
    for (let gid = 0; gid < count; gid++) widths.push(s.advances.get(gid) ?? 0);
    const wArray = ctx.obj([0, widths]);

    const cidFontRef = ctx.register(
      ctx.obj({
        Type: 'Font',
        Subtype: 'CIDFontType2',
        BaseFont: s.baseFont,
        CIDSystemInfo: {
          Registry: PDFString.of('Adobe'),
          Ordering: PDFString.of('Identity'),
          Supplement: 0,
        },
        FontDescriptor: descriptorRef,
        DW: 1000,
        W: wArray,
        CIDToGIDMap: 'Identity',
      }),
    );

    const toUnicodeRef = this.writeToUnicode(s);

    const fontDict = ctx.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: s.baseFont,
      Encoding: 'Identity-H',
      DescendantFonts: [cidFontRef],
    });
    if (toUnicodeRef) fontDict.set(PDFName.of('ToUnicode'), toUnicodeRef);
    ctx.assign(s.ref, fontDict);
  }

  private writeToUnicode(s: FontState): PDFRef | null {
    if (s.unicode.size === 0) return null;
    const entries = [...s.unicode.entries()].sort((a, b) => a[0] - b[0]);
    const bfchars = entries
      .map(([gid, cps]) => {
        // UTF-16BE of the code points.
        let hex = '';
        for (const cp of cps) {
          if (cp > 0xffff) {
            const v = cp - 0x10000;
            hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0');
            hex += (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
          } else {
            hex += cp.toString(16).padStart(4, '0');
          }
        }
        return `<${gid.toString(16).padStart(4, '0')}> <${hex}>`;
      })
      .join('\n');
    const cmap = [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def',
      '/CMapType 2 def',
      '1 begincodespacerange',
      '<0000> <FFFF>',
      'endcodespacerange',
      `${entries.length} beginbfchar`,
      bfchars,
      'endbfchar',
      'endcmap',
      'CMapName currentdict /CMap defineresource pop',
      'end',
      'end',
    ].join('\n');
    return this.doc.context.register(this.doc.context.flateStream(cmap));
  }

  /** Hex-encode for tests/debug. */
  static utf16be(text: string): PDFHexString {
    return PDFHexString.fromText(text);
  }
}
