/**
 * Content-stream builder. A tiny writer that emits raw PDF operators with
 * numbers at fixed precision (4 decimals, trailing zeros stripped, never
 * exponent notation).
 *
 * Coordinate system: the writer itself is space-agnostic; pdf/writer.ts
 * establishes the root CTM `1 0 0 -1 slugX (mediaH - slugY) cm` at the top
 * of every page so that all subsequent coordinates are display-list space
 * (top-left of the BLEED box, y down). This file only needs to counter the
 * flip for text (see beginTextRun in writer.ts which emits Tm [1 0 0 -1 x y]).
 */

import type { Mat2D, PathSpec } from '@guide/shared';

/** Fixed-precision PDF number: 4 decimals, no trailing zeros, no exponents. */
export function pdfNum(v: number): string {
  if (!Number.isFinite(v)) return '0';
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  let s = v.toFixed(4);
  s = s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s;
}

/** Escape a PDF literal string (parentheses + backslashes + control bytes). */
export function escapePdfString(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x28 || c === 0x29 || c === 0x5c) out += '\\' + s[i];
    else if (c === 0x0a) out += '\\n';
    else if (c === 0x0d) out += '\\r';
    else if (c < 0x20 || c > 0x7e) out += '\\' + c.toString(8).padStart(3, '0');
    else out += s[i];
  }
  return out;
}

/** UTF-16BE hex string with BOM — used for ActualText and ToUnicode values. */
export function utf16HexString(s: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) {
    hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  }
  return `<${hex}>`;
}

export class ContentWriter {
  private parts: string[] = [];
  /** Current point for Q->C conversion when emitting paths. */
  private cx = 0;
  private cy = 0;
  /** Start of the current subpath (for Z). */
  private sx = 0;
  private sy = 0;

  op(...tokens: (string | number)[]): void {
    this.parts.push(
      tokens.map((t) => (typeof t === 'number' ? pdfNum(t) : t)).join(' '),
    );
  }

  raw(line: string): void {
    this.parts.push(line);
  }

  /* --- graphics state --- */

  save(): void {
    this.op('q');
  }

  restore(): void {
    this.op('Q');
  }

  cm(m: Mat2D): void {
    this.op(m[0], m[1], m[2], m[3], m[4], m[5], 'cm');
  }

  /** Named ExtGState. */
  gs(name: string): void {
    this.op(`/${name}`, 'gs');
  }

  lineWidth(w: number): void {
    this.op(w, 'w');
  }

  lineCap(cap: 'butt' | 'round' | 'square'): void {
    this.op(cap === 'butt' ? 0 : cap === 'round' ? 1 : 2, 'J');
  }

  lineJoin(join: 'miter' | 'round' | 'bevel'): void {
    this.op(join === 'miter' ? 0 : join === 'round' ? 1 : 2, 'j');
  }

  dash(pattern: number[], phase = 0): void {
    this.raw(`[${pattern.map(pdfNum).join(' ')}] ${pdfNum(phase)} d`);
  }

  miterLimit(m: number): void {
    this.op(m, 'M');
  }

  /* --- colour --- */

  fillCmyk(c: number, m: number, y: number, k: number): void {
    this.op(c, m, y, k, 'k');
  }

  strokeCmyk(c: number, m: number, y: number, k: number): void {
    this.op(c, m, y, k, 'K');
  }

  fillRgb(r: number, g: number, b: number): void {
    this.op(r, g, b, 'rg');
  }

  strokeRgb(r: number, g: number, b: number): void {
    this.op(r, g, b, 'RG');
  }

  /** Separation fill: /Cs cs t scn */
  fillSeparation(csName: string, tint: number): void {
    this.op(`/${csName}`, 'cs');
    this.op(tint, 'scn');
  }

  strokeSeparation(csName: string, tint: number): void {
    this.op(`/${csName}`, 'CS');
    this.op(tint, 'SCN');
  }

  /* --- path construction --- */

  moveTo(x: number, y: number): void {
    this.op(x, y, 'm');
    this.cx = this.sx = x;
    this.cy = this.sy = y;
  }

  lineTo(x: number, y: number): void {
    this.op(x, y, 'l');
    this.cx = x;
    this.cy = y;
  }

  curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    this.op(x1, y1, x2, y2, x, y, 'c');
    this.cx = x;
    this.cy = y;
  }

  /** Quadratic via cubic elevation (PDF has no quadratic operator). */
  quadTo(qx: number, qy: number, x: number, y: number): void {
    const c1x = this.cx + (2 / 3) * (qx - this.cx);
    const c1y = this.cy + (2 / 3) * (qy - this.cy);
    const c2x = x + (2 / 3) * (qx - x);
    const c2y = y + (2 / 3) * (qy - y);
    this.curveTo(c1x, c1y, c2x, c2y, x, y);
  }

  closePath(): void {
    this.op('h');
    this.cx = this.sx;
    this.cy = this.sy;
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.op(x, y, w, h, 're');
    this.cx = this.sx = x;
    this.cy = this.sy = y;
  }

  path(spec: PathSpec): void {
    for (const seg of spec) {
      switch (seg[0]) {
        case 'M':
          this.moveTo(seg[1], seg[2]);
          break;
        case 'L':
          this.lineTo(seg[1], seg[2]);
          break;
        case 'C':
          this.curveTo(seg[1], seg[2], seg[3], seg[4], seg[5], seg[6]);
          break;
        case 'Q':
          this.quadTo(seg[1], seg[2], seg[3], seg[4]);
          break;
        case 'Z':
          this.closePath();
          break;
      }
    }
  }

  /* --- path painting --- */

  fill(rule: 'nonzero' | 'evenodd' = 'nonzero'): void {
    this.op(rule === 'evenodd' ? 'f*' : 'f');
  }

  stroke(): void {
    this.op('S');
  }

  fillAndStroke(rule: 'nonzero' | 'evenodd' = 'nonzero'): void {
    this.op(rule === 'evenodd' ? 'B*' : 'B');
  }

  endPathNoOp(): void {
    this.op('n');
  }

  clip(rule: 'nonzero' | 'evenodd' = 'nonzero'): void {
    this.op(rule === 'evenodd' ? 'W*' : 'W');
  }

  /** Clip to a path spec: path, W, n. */
  clipPath(spec: PathSpec, rule: 'nonzero' | 'evenodd' = 'nonzero'): void {
    this.path(spec);
    this.clip(rule);
    this.endPathNoOp();
  }

  /* --- text --- */

  beginText(): void {
    this.op('BT');
  }

  endText(): void {
    this.op('ET');
  }

  font(resourceName: string, size: number): void {
    this.op(`/${resourceName}`, size, 'Tf');
  }

  textMatrix(m: Mat2D): void {
    this.op(m[0], m[1], m[2], m[3], m[4], m[5], 'Tm');
  }

  renderMode(mode: number): void {
    this.op(mode, 'Tr');
  }

  /** Show glyphs: items are 2-byte glyph ids (numbers) or kern adjustments (strings already formatted). */
  showGlyphs(items: { glyphs?: number[]; adjust?: number }[]): void {
    let out = '[';
    for (const item of items) {
      if (item.glyphs) {
        out += '<' + item.glyphs.map((g) => g.toString(16).padStart(4, '0').toUpperCase()).join('') + '>';
      } else if (item.adjust !== undefined) {
        out += ' ' + pdfNum(item.adjust) + ' ';
      }
    }
    out += '] TJ';
    this.raw(out);
  }

  /* --- marked content --- */

  beginActualText(text: string): void {
    this.raw(`/Span << /ActualText ${utf16HexString(text)} >> BDC`);
  }

  endMarkedContent(): void {
    this.op('EMC');
  }

  /* --- XObjects & shadings --- */

  drawXObject(resourceName: string): void {
    this.op(`/${resourceName}`, 'Do');
  }

  shading(resourceName: string): void {
    this.op(`/${resourceName}`, 'sh');
  }

  toString(): string {
    return this.parts.join('\n');
  }

  toBytes(): Uint8Array {
    const s = this.toString();
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }
}
