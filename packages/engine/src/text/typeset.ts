/**
 * The typesetter — real H&J in display-list space.
 *
 * Given a frame and styled paragraphs it produces positioned glyph runs with:
 *   • greedy line-breaking with Knuth–Liang hyphenation,
 *   • justified or ragged setting with even word-space distribution,
 *   • baseline-grid snapping (per paragraph opt-in),
 *   • runt suppression (no lone-word last lines) and widow/orphan handling
 *     across columns,
 *   • copyfit (shrink-to-fit) with an honest overset report — text that does
 *     not fit is returned as `oversetText` and a `text.overset` diagnostic is
 *     raised; nothing is ever silently clipped or truncated.
 *
 * All shaping goes through the injected FontManager, so the studio canvas and
 * the press renderer set identical lines. Output coordinates are page space
 * (pt, top-left origin, y down); glyph y is the baseline.
 */

import {
  BLACK,
  effectiveCmyk,
  type Color,
  type Diagnostic,
  type DLItem,
  type GlyphRun,
  type InlineSpan,
  type ParagraphContent,
  type ParagraphStyle,
  type PlacedGlyph,
  type Rect,
} from '@guide/shared';
import type { FontManager, ShapedGlyph } from '../fonts.js';
import type { LineInfo, TextEnv, TextFrameSpec, TypesetResult } from './types.js';

/** A shaped, measured atom on a line: a word or an inter-word space. */
interface Token {
  kind: 'word' | 'space';
  text: string;
  glyphs: ShapedGlyph[];
  /** Advance width in pt at the token's size. */
  width: number;
  fontId: string;
  size: number;
  color: Color;
  /** Whether this token can be the elastic part of justification. */
  stretchy: boolean;
  /** Shaped at this size scale (so copyfit can recompute cheaply). */
  features?: Record<string, boolean>;
  tracking?: number;
}

interface Line {
  tokens: Token[];
  /** Natural (unjustified) width. */
  width: number;
  ascent: number;
  descent: number;
  /** True for the last line of a paragraph or a forced break (never justified). */
  flush: boolean;
  /** Paragraph index this line belongs to. */
  para: number;
  source: string;
}

const EPS = 0.01;

function colorKey(c: Color): string {
  const v = effectiveCmyk(c);
  const sp = c.space === 'spot' ? `spot:${c.name}:${c.tint}` : c.space;
  return `${sp}:${v.join(',')}`;
}

/** Collapse internal whitespace and trim — paragraphs are pre-split upstream. */
function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ');
}

export function typesetFrame(spec: TextFrameSpec, env: TextEnv): TypesetResult {
  const diagnostics: Diagnostic[] = [];
  const copyfit = spec.copyfit;
  const minScale = copyfit ? copyfit.minScale : 1;

  // Try decreasing scales until the text fits (or we hit the floor). Without
  // copyfit there is a single pass at scale 1 and honest overset reporting.
  let scale = 1;
  let attempt = layoutAtScale(spec, env, scale);
  if (copyfit && attempt.overset) {
    const step = 0.02;
    while (scale > minScale + EPS && attempt.overset) {
      scale = Math.max(minScale, scale - step);
      attempt = layoutAtScale(spec, env, scale);
    }
  }

  if (scale !== 1) {
    diagnostics.push({
      code: 'text.copyfit',
      severity: 'info',
      frame: spec.id,
      message: `Copyfit scaled type to ${Math.round(scale * 100)}% to fit “${spec.id}”.`,
      data: { scale: Math.round(scale * 100) },
    });
  }

  const { runs, lines, used, overset, oversetText, missingGlyph } = attempt;

  if (overset) {
    diagnostics.push({
      code: 'text.overset',
      severity: 'error',
      frame: spec.id,
      message: `Text overflows its frame in “${spec.id}”: ${truncateForMsg(oversetText ?? '')}`,
      data: { chars: (oversetText ?? '').length },
    });
  }
  if (missingGlyph) {
    diagnostics.push({
      code: 'text.missing-glyph',
      severity: 'warning',
      frame: spec.id,
      message: `Some characters have no glyph in the chosen font in “${spec.id}”.`,
    });
  }
  for (const d of attempt.diagnostics) diagnostics.push({ ...d, frame: spec.id });

  return {
    item: { t: 'text', runs, meta: { frame: spec.id, role: 'text' } },
    used,
    overset,
    oversetText,
    lines,
    scale,
    diagnostics,
  };
}

interface Attempt {
  runs: GlyphRun[];
  lines: LineInfo[];
  used: Rect;
  overset: boolean;
  oversetText?: string;
  missingGlyph: boolean;
  diagnostics: Diagnostic[];
}

function layoutAtScale(spec: TextFrameSpec, env: TextEnv, scale: number): Attempt {
  const diagnostics: Diagnostic[] = [];
  let missingGlyph = false;

  const columns = Math.max(1, spec.columns ?? 1);
  const gap = spec.columnGap ?? 14;
  const colWidth = (spec.rect.w - gap * (columns - 1)) / columns;

  // ---- 1. break every paragraph into lines at this scale ----
  const allLines: Line[] = [];
  for (let pi = 0; pi < spec.paragraphs.length; pi++) {
    const para = spec.paragraphs[pi]!;
    const tokens = tokenizeParagraph(para, env, scale, (m) => (missingGlyph ||= m));
    const broken = breakLines(tokens, colWidth, para.style, env, scale);
    suppressRunts(broken, para.style, colWidth);
    for (const ln of broken) {
      ln.para = pi;
      allLines.push(ln);
    }
  }

  // ---- 2. flow lines into columns with grid snapping + widow/orphan ----
  const grid = spec.baselineGrid;
  const gridOrigin = spec.gridOrigin ?? spec.rect.y;
  const placed: { line: Line; col: number; baseline: number }[] = [];
  let col = 0;
  let cursor = spec.rect.y; // running y (top of the next line's slot)
  let prevPara = -1;
  let firstInCol = true;

  const colBottom = spec.rect.y + spec.rect.h + EPS;

  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i]!;
    const para = spec.paragraphs[line.para]!.style;
    const leading = para.leading * scale;

    // Paragraph spacing (not at the very top of a column).
    if (line.para !== prevPara && !firstInCol && prevPara >= 0) {
      cursor += (spec.paragraphs[line.para]!.style.spaceBefore ?? 0) * scale;
    }

    // Candidate baseline. On a baseline grid we advance whole grid steps from
    // the previous baseline — `round(leading/grid)` (at least one). This keeps
    // a consistent rhythm and avoids the failure where a leading just larger
    // than the grid pitch snaps to the *next* line and doubles the spacing.
    let baseline: number;
    if (firstInCol) {
      baseline = cursor + line.ascent;
      if (para.snapToGrid && grid) baseline = snapBaseline(baseline, gridOrigin, grid);
    } else if (para.snapToGrid && grid) {
      const steps = Math.max(1, Math.round(leading / grid));
      baseline = cursor + steps * grid;
    } else {
      baseline = cursor + leading;
    }

    // Does it fit this column?
    if (baseline + line.descent > colBottom + EPS) {
      // Move to the next column, or overset.
      if (col < columns - 1) {
        col++;
        cursor = spec.rect.y;
        firstInCol = true;
        prevPara = -1;
        i--; // retry this line at the top of the new column
        continue;
      }
      // No more columns — everything from here is overset.
      const rest = allLines.slice(i);
      const oversetText = rest.map((l) => l.source).join(' ').trim();
      return finish(placed, spec, columns, colWidth, gap, scale, true, oversetText, missingGlyph, diagnostics, env);
    }

    placed.push({ line, col, baseline });
    cursor = firstInCol ? baseline : baseline; // baseline becomes the new reference
    firstInCol = false;
    prevPara = line.para;
  }

  return finish(placed, spec, columns, colWidth, gap, scale, false, undefined, missingGlyph, diagnostics, env);
}

function finish(
  placed: { line: Line; col: number; baseline: number }[],
  spec: TextFrameSpec,
  columns: number,
  colWidth: number,
  gap: number,
  scale: number,
  overset: boolean,
  oversetText: string | undefined,
  missingGlyph: boolean,
  diagnostics: Diagnostic[],
  env: TextEnv,
): Attempt {
  // Vertical alignment shift (single-column frames only; multi-column stays top).
  let shift = 0;
  if (!overset && columns === 1 && placed.length > 0 && spec.valign && spec.valign !== 'top') {
    const last = placed[placed.length - 1]!;
    const usedBottom = last.baseline + last.line.descent;
    const slack = spec.rect.y + spec.rect.h - usedBottom;
    if (slack > 0) shift = spec.valign === 'center' ? slack / 2 : slack;
  }

  const runs: GlyphRun[] = [];
  const lines: LineInfo[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of placed) {
    const baseline = p.baseline + shift;
    const para = spec.paragraphs[p.line.para]!.style;
    const colX = spec.rect.x + p.col * (colWidth + gap);
    const lineRuns = layoutLine(p.line, colX, colWidth, baseline, para, env, scale);
    for (const r of lineRuns) runs.push(r);

    lines.push({ baselineY: baseline, x: colX, width: p.line.width, text: p.line.source });
    minX = Math.min(minX, colX);
    maxX = Math.max(maxX, colX + p.line.width);
    minY = Math.min(minY, baseline - p.line.ascent);
    maxY = Math.max(maxY, baseline + p.line.descent);
  }

  const used: Rect =
    placed.length === 0
      ? { x: spec.rect.x, y: spec.rect.y, w: 0, h: 0 }
      : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

  return { runs, lines, used, overset, oversetText, missingGlyph, diagnostics };
}

/** Snap a baseline down to the first grid line at or below the candidate. */
function snapBaseline(candidate: number, origin: number, grid: number): number {
  const k = Math.ceil((candidate - origin) / grid - EPS);
  return origin + k * grid;
}

/* ------------------------------------------------------------------ */
/* tokenisation                                                        */
/* ------------------------------------------------------------------ */

function tokenizeParagraph(
  para: ParagraphContent,
  env: TextEnv,
  scale: number,
  flagMissing: (m: boolean) => void,
): Token[] {
  const tokens: Token[] = [];
  for (const span of para.spans) {
    const cs = resolveSpanStyle(para.style, span);
    const fontId = env.resolveFont(cs.font);
    const size = cs.size * scale;
    const text = cs.caps ? normalizeWs(span.text).toUpperCase() : normalizeWs(span.text);
    if (text.length === 0) continue;

    // Split into words and single spaces.
    const parts = text.split(/(\s+)/).filter((p) => p.length > 0);
    for (const part of parts) {
      if (/^\s+$/.test(part)) {
        const w = measure(env.fonts, fontId, ' ', size, cs.tracking, cs.features);
        tokens.push({
          kind: 'space',
          text: ' ',
          glyphs: [],
          width: w,
          fontId,
          size,
          color: cs.color ?? para.style.color ?? BLACK,
          stretchy: true,
          features: cs.features,
          tracking: cs.tracking,
        });
      } else {
        const glyphs = env.fonts.shape(fontId, part, {
          features: cs.features,
          letterSpacing: cs.tracking,
        });
        if (glyphs.some((g) => g.missing)) flagMissing(true);
        const width = advanceWidth(env.fonts, fontId, glyphs, size);
        tokens.push({
          kind: 'word',
          text: part,
          glyphs,
          width,
          fontId,
          size,
          color: cs.color ?? para.style.color ?? BLACK,
          stretchy: false,
          features: cs.features,
          tracking: cs.tracking,
        });
      }
    }
  }
  return tokens;
}

interface ResolvedCharStyle {
  font: ParagraphStyle['font'];
  size: number;
  color?: Color;
  tracking?: number;
  features?: Record<string, boolean>;
  caps?: boolean;
}

function resolveSpanStyle(base: ParagraphStyle, span: InlineSpan): ResolvedCharStyle {
  const o = span.style ?? {};
  return {
    font: o.font ?? base.font,
    size: o.size ?? base.size,
    color: o.color ?? base.color,
    tracking: o.tracking ?? base.tracking,
    features: (o.features ?? base.features) as Record<string, boolean> | undefined,
    caps: o.caps ?? base.caps,
  };
}

/* ------------------------------------------------------------------ */
/* line breaking                                                       */
/* ------------------------------------------------------------------ */

function breakLines(
  tokens: Token[],
  maxWidth: number,
  style: ParagraphStyle,
  env: TextEnv,
  scale: number,
): Line[] {
  const lines: Line[] = [];
  let cur: Token[] = [];
  let curWidth = 0;
  const queue = tokens.slice();

  const pushLine = (flush: boolean) => {
    // Drop a trailing space.
    while (cur.length > 0 && cur[cur.length - 1]!.kind === 'space') {
      const t = cur.pop()!;
      curWidth -= t.width;
    }
    if (cur.length === 0) return;
    lines.push(makeLine(cur, curWidth, flush));
    cur = [];
    curWidth = 0;
  };

  while (queue.length > 0) {
    const tok = queue.shift()!;
    if (tok.kind === 'space') {
      if (cur.length === 0) continue; // no leading spaces
      cur.push(tok);
      curWidth += tok.width;
      continue;
    }

    // Word.
    if (curWidth + tok.width <= maxWidth + EPS) {
      cur.push(tok);
      curWidth += tok.width;
      continue;
    }

    // Doesn't fit. Try hyphenation into the remaining space.
    const remaining = maxWidth - curWidth;
    const split = style.hyphenate
      ? hyphenateToFit(tok, remaining, env, cur.length > 0)
      : null;
    if (split) {
      cur.push(split.head);
      curWidth += split.head.width;
      pushLine(false);
      queue.unshift(split.tail);
      continue;
    }

    if (cur.length === 0) {
      // A single word wider than the column and unbreakable: place it anyway
      // (it will be flagged via used-bounds), then continue on a fresh line.
      cur.push(tok);
      curWidth += tok.width;
      pushLine(false);
      continue;
    }

    // Break before the word, retry it on the next line.
    pushLine(false);
    queue.unshift(tok);
  }
  pushLine(true);

  // Mark the final line of the paragraph as flush (ragged-bottom, never justified).
  if (lines.length > 0) lines[lines.length - 1]!.flush = true;
  return lines;
}

interface HyphenSplit {
  head: Token;
  tail: Token;
}

function hyphenateToFit(
  word: Token,
  remaining: number,
  env: TextEnv,
  haveLineStart: boolean,
): HyphenSplit | null {
  if (word.text.length < 6) return null;
  const frags = env.hyphenate(word.text);
  if (frags.length < 2) return null;
  // Largest prefix (≥1 fragment) whose shaped "<prefix>-" fits the remaining
  // space, leaving at least one fragment for the tail.
  for (let k = frags.length - 1; k >= 1; k--) {
    const headText = frags.slice(0, k).join('') + '-';
    const headGlyphs = env.fonts.shape(word.fontId, headText, {
      features: word.features,
      letterSpacing: word.tracking,
    });
    const headW = advanceWidth(env.fonts, word.fontId, headGlyphs, word.size);
    if (headW <= remaining + EPS) {
      const tailText = frags.slice(k).join('');
      const tailGlyphs = env.fonts.shape(word.fontId, tailText, {
        features: word.features,
        letterSpacing: word.tracking,
      });
      const tailW = advanceWidth(env.fonts, word.fontId, tailGlyphs, word.size);
      return {
        head: { ...word, text: headText, glyphs: headGlyphs, width: headW },
        tail: { ...word, text: tailText, glyphs: tailGlyphs, width: tailW },
      };
    }
  }
  return null;
}

function makeLine(tokens: Token[], width: number, flush: boolean): Line {
  let ascent = 0;
  let descent = 0;
  for (const t of tokens) {
    // Estimate per-token vertical metrics from its size.
    const a = t.size * 0.8;
    const d = t.size * 0.22;
    if (a > ascent) ascent = a;
    if (d > descent) descent = d;
  }
  const source = tokens.map((t) => t.text).join('').replace(/-$/, '');
  return { tokens: tokens.slice(), width, ascent, descent, flush, para: 0, source };
}

/**
 * Runt suppression: if a paragraph's last line is a single short word, pull
 * the previous line's last word down so the last line carries at least two
 * words — eliminating the "stranded single word" defect.
 */
function suppressRunts(lines: Line[], style: ParagraphStyle, maxWidth: number): void {
  if (!style.noRunts || lines.length < 2) return;
  const last = lines[lines.length - 1]!;
  const wordCount = last.tokens.filter((t) => t.kind === 'word').length;
  const tiny = last.width < maxWidth * 0.2;
  if (wordCount > 1 && !tiny) return;

  const prev = lines[lines.length - 2]!;
  const prevWords = prev.tokens.filter((t) => t.kind === 'word').length;
  if (prevWords < 3) return; // don't strip the previous line bare

  // Move the last (word[, preceding space]) of prev to the front of last.
  const moved: Token[] = [];
  while (prev.tokens.length > 0) {
    const t = prev.tokens.pop()!;
    moved.unshift(t);
    if (t.kind === 'word') break;
  }
  // Ensure a separating space between the moved word and the old last line.
  const sep: Token = { ...moved[moved.length - 1]!, kind: 'space', text: ' ', glyphs: [], width: moved[moved.length - 1]!.size * 0.25, stretchy: true };
  last.tokens = [...moved, sep, ...last.tokens];
  // Recompute widths.
  prev.width = prev.tokens.reduce((w, t) => w + t.width, 0);
  trimTrailingSpace(prev);
  last.width = last.tokens.reduce((w, t) => w + t.width, 0);
  trimLeadingSpace(last);
}

function trimTrailingSpace(line: Line): void {
  while (line.tokens.length && line.tokens[line.tokens.length - 1]!.kind === 'space') {
    line.width -= line.tokens.pop()!.width;
  }
}
function trimLeadingSpace(line: Line): void {
  while (line.tokens.length && line.tokens[0]!.kind === 'space') {
    line.width -= line.tokens.shift()!.width;
  }
}

/* ------------------------------------------------------------------ */
/* line placement (pen run, justification)                             */
/* ------------------------------------------------------------------ */

function layoutLine(
  line: Line,
  colX: number,
  colWidth: number,
  baseline: number,
  style: ParagraphStyle,
  _env: TextEnv,
  _scale: number,
): GlyphRun[] {
  const align = style.align;
  const spaces = line.tokens.filter((t) => t.kind === 'space');
  let extraPerSpace = 0;
  let penX = colX;

  if (align === 'justify' && !line.flush && spaces.length > 0) {
    extraPerSpace = (colWidth - line.width) / spaces.length;
    if (extraPerSpace < 0) extraPerSpace = 0;
  } else if (align === 'right') {
    penX = colX + (colWidth - line.width);
  } else if (align === 'center') {
    penX = colX + (colWidth - line.width) / 2;
  }

  // Group consecutive glyphs sharing (font,size,color) into runs.
  const runs: GlyphRun[] = [];
  let cur: { run: GlyphRun; key: string } | null = null;

  const flush = () => {
    if (cur && cur.run.glyphs.length > 0) runs.push(cur.run);
    cur = null;
  };

  for (const tok of line.tokens) {
    if (tok.kind === 'space') {
      penX += tok.width + extraPerSpace;
      continue;
    }
    const key = `${tok.fontId}|${tok.size}|${colorKey(tok.color)}`;
    if (!cur || cur.key !== key) {
      flush();
      cur = {
        key,
        run: { font: tok.fontId, size: tok.size, color: tok.color, glyphs: [], text: '' },
      };
    }
    const s = tok.size / glyphScaleDenom(_env.fonts, tok.fontId);
    let adv = 0;
    for (const g of tok.glyphs) {
      const placed: PlacedGlyph = {
        g: g.id,
        x: penX + adv + g.xOffset * s,
        y: baseline - g.yOffset * s,
      };
      cur.run.glyphs.push(placed);
      adv += g.xAdvance * s;
    }
    cur.run.text += tok.text;
    penX += tok.width;
  }
  flush();
  return runs;
}

/* ------------------------------------------------------------------ */
/* measurement helpers                                                 */
/* ------------------------------------------------------------------ */

function glyphScaleDenom(fonts: FontManager, fontId: string): number {
  return fonts.metrics(fontId).unitsPerEm;
}

function advanceWidth(fonts: FontManager, fontId: string, glyphs: ShapedGlyph[], size: number): number {
  const upem = fonts.metrics(fontId).unitsPerEm;
  let units = 0;
  for (const g of glyphs) units += g.xAdvance;
  return (units * size) / upem;
}

function measure(
  fonts: FontManager,
  fontId: string,
  text: string,
  size: number,
  tracking: number | undefined,
  features: Record<string, boolean> | undefined,
): number {
  const glyphs = fonts.shape(fontId, text, { features, letterSpacing: tracking });
  return advanceWidth(fonts, fontId, glyphs, size);
}

function truncateForMsg(s: string): string {
  const t = s.trim();
  return t.length > 60 ? `“${t.slice(0, 57)}…”` : `“${t}”`;
}
