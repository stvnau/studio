/**
 * FontManager — the single shaping and metrics engine, shared verbatim by
 * the studio (browser) and the press renderer (Node). fontkit performs all
 * glyph layout (kerning, ligatures, OpenType features); nothing else in the
 * system measures text. Same library, same bytes, same numbers everywhere —
 * this is half of the editor↔press parity guarantee (the other half is the
 * display list).
 */

import * as fontkit from 'fontkit';
import type { Font } from 'fontkit';
import type { FontFace, FontSource, OpenTypeFeatures, PathSpec } from '@guide/shared';

export interface FontMetrics {
  unitsPerEm: number;
  /** All in font units; scale by size/unitsPerEm. */
  ascent: number;
  descent: number; // negative
  lineGap: number;
  capHeight: number;
  xHeight: number;
}

export interface ShapeOptions {
  features?: OpenTypeFeatures;
  letterSpacing?: number; // 1/1000 em
}

export interface ShapedGlyph {
  id: number;
  /** Advance in font units (letterSpacing already applied). */
  xAdvance: number;
  xOffset: number;
  yOffset: number;
  /** True if fontkit produced .notdef for a non-space character. */
  missing: boolean;
}

export class FontManager {
  private fonts = new Map<string, Font>();
  private bytes = new Map<string, Uint8Array>();

  constructor(private source: FontSource) {}

  list(): FontFace[] {
    return this.source.list();
  }

  async ensure(ids: Iterable<string>): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => !this.fonts.has(id));
    await Promise.all(
      missing.map(async (id) => {
        const data = await this.source.getBytes(id);
        // fontkit requires a Buffer-like; Uint8Array works via its internal view
        const font = fontkit.create(toBuffer(data)) as Font;
        this.fonts.set(id, font);
        this.bytes.set(id, data);
      }),
    );
  }

  has(id: string): boolean {
    return this.fonts.has(id);
  }

  get(id: string): Font {
    const f = this.fonts.get(id);
    if (!f) throw new Error(`Font not loaded: ${id} — call ensure() first`);
    return f;
  }

  getBytes(id: string): Uint8Array {
    const b = this.bytes.get(id);
    if (!b) throw new Error(`Font not loaded: ${id}`);
    return b;
  }

  metrics(id: string): FontMetrics {
    const f = this.get(id);
    return {
      unitsPerEm: f.unitsPerEm,
      ascent: f.ascent,
      descent: f.descent,
      lineGap: f.lineGap,
      capHeight: f.capHeight || f.ascent * 0.7,
      xHeight: f.xHeight || f.ascent * 0.5,
    };
  }

  /**
   * Shape a string. Returns glyphs with advances in font units; callers
   * scale by size/unitsPerEm. Deterministic for given (font, text, options).
   */
  shape(id: string, text: string, opts: ShapeOptions = {}): ShapedGlyph[] {
    const font = this.get(id);
    const features: Record<string, boolean> = { liga: true, kern: true };
    if (opts.features) {
      for (const [k, v] of Object.entries(opts.features)) features[k] = !!v;
    }
    const run = font.layout(text, features);
    const ls = opts.letterSpacing
      ? (opts.letterSpacing / 1000) * font.unitsPerEm
      : 0;
    const hasNonSpace = /\S/.test(text);
    const out: ShapedGlyph[] = [];
    for (let i = 0; i < run.glyphs.length; i++) {
      const glyph = run.glyphs[i]!;
      const pos = run.positions[i]!;
      out.push({
        id: glyph.id,
        xAdvance: pos.xAdvance + ls,
        xOffset: pos.xOffset,
        yOffset: pos.yOffset,
        missing: glyph.id === 0 && hasNonSpace,
      });
    }
    return out;
  }

  /** Width of a shaped string in font units. */
  measure(id: string, text: string, opts: ShapeOptions = {}): number {
    return this.shape(id, text, opts).reduce((w, g) => w + g.xAdvance, 0);
  }

  /** Glyph outline as a PathSpec in font units (y-up; callers flip). */
  glyphPath(id: string, glyphId: number): PathSpec {
    const font = this.get(id);
    const glyph = font.getGlyph(glyphId);
    const path: PathSpec = [];
    for (const cmd of glyph.path.commands) {
      const a = cmd.args;
      switch (cmd.command) {
        case 'moveTo':
          path.push(['M', a[0]!, a[1]!]);
          break;
        case 'lineTo':
          path.push(['L', a[0]!, a[1]!]);
          break;
        case 'quadraticCurveTo':
          path.push(['Q', a[0]!, a[1]!, a[2]!, a[3]!]);
          break;
        case 'bezierCurveTo':
          path.push(['C', a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!]);
          break;
        case 'closePath':
          path.push(['Z']);
          break;
      }
    }
    return path;
  }
}

function toBuffer(data: Uint8Array): Buffer {
  // In Node this is a zero-copy view; in the browser, fontkit's bundled
  // Buffer shim accepts a Uint8Array the same way.
  return Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}
