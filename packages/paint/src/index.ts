/**
 * The SVG painter — paints a PageRender (display list) to an SVG string.
 *
 * Used by the studio canvas, the digital edition, and every visual test.
 * Text is painted as glyph *outlines* obtained from the same FontManager
 * that shaped it, so what you see needs no font installation and cannot
 * drift from the press output: both painters consume identical geometry.
 */

import {
  colorToCss,
  pathToSvg,
  transformPath,
  type Color,
  type DLItem,
  type Fill,
  type GlyphRun,
  type Mat2D,
  type PageRender,
  type PathSpec,
  type Stroke,
} from '@guide/shared';

export interface PaintOptions {
  /** Glyph outline provider — FontManager.glyphPath bound, or equivalent. */
  glyphPath: (fontId: string, glyphId: number) => PathSpec;
  /** Units-per-em per font id — FontManager.metrics(id).unitsPerEm. */
  unitsPerEm: (fontId: string) => number;
  /** Resolve an image asset id to a URL (data: or http). */
  assetUrl: (assetId: string) => string;
  /** Show the full bleed box (true) or clip to trim (false). */
  showBleed?: boolean;
  /** Emit data-frame attributes for canvas hit-testing. */
  interactive?: boolean;
  /** Override the background; default paper white. */
  background?: string;
}

let uid = 0;

export function paintPageSvg(page: PageRender, opts: PaintOptions): string {
  const defs: string[] = [];
  const body = paintItems(page.items, opts, defs);
  const b = page.bleed;
  const viewBox = opts.showBleed
    ? `0 0 ${page.trim.w + 2 * b} ${page.trim.h + 2 * b}`
    : `${b} ${b} ${page.trim.w} ${page.trim.h}`;
  const [, , vw, vh] = viewBox.split(' ').map(Number);
  const bg = opts.background ?? '#ffffff';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="${viewBox}" width="${vw}" height="${vh}">` +
    (defs.length ? `<defs>${defs.join('')}</defs>` : '') +
    `<rect x="${viewBox.split(' ')[0]}" y="${viewBox.split(' ')[1]}" width="${vw}" height="${vh}" fill="${bg}"/>` +
    body +
    `</svg>`
  );
}

/** Paint raw items (used by tests and partial previews). */
export function paintItems(items: DLItem[], opts: PaintOptions, defs: string[]): string {
  return items.map((item) => paintItem(item, opts, defs)).join('');
}

function paintItem(item: DLItem, opts: PaintOptions, defs: string[]): string {
  const dataAttr =
    opts.interactive && item.meta?.frame ? ` data-frame="${esc(item.meta.frame)}"` : '';
  switch (item.t) {
    case 'group': {
      const attrs: string[] = [];
      if (item.transform) attrs.push(`transform="${matrix(item.transform)}"`);
      if (item.alpha !== undefined && item.alpha < 1) attrs.push(`opacity="${item.alpha}"`);
      if (item.clip) {
        const id = `c${uid++}`;
        defs.push(`<clipPath id="${id}"><path d="${pathToSvg(item.clip)}"/></clipPath>`);
        attrs.push(`clip-path="url(#${id})"`);
      }
      return `<g ${attrs.join(' ')}${dataAttr}>${paintItems(item.children, opts, defs)}</g>`;
    }
    case 'path': {
      const attrs = [`d="${pathToSvg(item.d)}"`];
      attrs.push(fillAttrs(item.fill, defs));
      attrs.push(strokeAttrs(item.stroke));
      return `<path ${attrs.filter(Boolean).join(' ')}${dataAttr}/>`;
    }
    case 'text': {
      const runs = item.runs.map((r) => paintRun(r, opts)).join('');
      return dataAttr ? `<g${dataAttr}>${runs}</g>` : runs;
    }
    case 'image': {
      const { rect, crop } = item;
      const url = opts.assetUrl(item.asset);
      const id = `c${uid++}`;
      defs.push(
        `<clipPath id="${id}"><rect x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.w)}" height="${n(rect.h)}"/></clipPath>`,
      );
      // Scale the full source so the crop window exactly fills rect.
      const drawW = rect.w / crop.w;
      const drawH = rect.h / crop.h;
      const dx = rect.x - crop.x * drawW;
      const dy = rect.y - crop.y * drawH;
      return (
        `<g clip-path="url(#${id})"${dataAttr}>` +
        `<image href="${esc(url)}" xlink:href="${esc(url)}" x="${n(dx)}" y="${n(dy)}" ` +
        `width="${n(drawW)}" height="${n(drawH)}" preserveAspectRatio="none"/></g>`
      );
    }
  }
}

function paintRun(run: GlyphRun, opts: PaintOptions): string {
  const upem = opts.unitsPerEm(run.font);
  const s = run.size / upem;
  const parts: string[] = [];
  for (const g of run.glyphs) {
    const outline = opts.glyphPath(run.font, g.g);
    if (outline.length === 0) continue;
    // Font units are y-up; page space is y-down: scale(s, -s) at the glyph origin.
    parts.push(pathToSvg(transformPath(outline, [s, 0, 0, -s, g.x, g.y])));
  }
  if (parts.length === 0) return '';
  const alpha = run.alpha !== undefined && run.alpha < 1 ? ` fill-opacity="${run.alpha}"` : '';
  const stroke = run.stroke
    ? ` stroke="${colorToCss(run.stroke.color)}" stroke-width="${n(run.stroke.width)}" paint-order="stroke" stroke-linejoin="round"`
    : '';
  return `<path d="${parts.join('')}" fill="${colorToCss(run.color)}"${alpha}${stroke}/>`;
}

function fillAttrs(fill: Fill | undefined, defs: string[]): string {
  if (!fill) return 'fill="none"';
  const alpha = fill.alpha !== undefined && fill.alpha < 1 ? ` fill-opacity="${fill.alpha}"` : '';
  const rule = fill.rule === 'evenodd' ? ' fill-rule="evenodd"' : '';
  if (fill.gradient) {
    const g = fill.gradient;
    const id = `g${uid++}`;
    const stops = g.stops
      .map(
        (st) =>
          `<stop offset="${st.at * 100}%" stop-color="${colorToCss(st.color)}"` +
          (st.alpha !== undefined && st.alpha < 1 ? ` stop-opacity="${st.alpha}"` : '') +
          `/>`,
      )
      .join('');
    defs.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
        `x1="${n(g.from[0])}" y1="${n(g.from[1])}" x2="${n(g.to[0])}" y2="${n(g.to[1])}">${stops}</linearGradient>`,
    );
    return `fill="url(#${id})"${alpha}${rule}`;
  }
  if (fill.color) return `fill="${colorToCss(fill.color)}"${alpha}${rule}`;
  return 'fill="none"';
}

function strokeAttrs(stroke: Stroke | undefined): string {
  if (!stroke) return '';
  const parts = [
    `stroke="${colorToCss(stroke.color)}"`,
    `stroke-width="${n(stroke.width)}"`,
  ];
  if (stroke.alpha !== undefined && stroke.alpha < 1) parts.push(`stroke-opacity="${stroke.alpha}"`);
  if (stroke.cap && stroke.cap !== 'butt') parts.push(`stroke-linecap="${stroke.cap}"`);
  if (stroke.join && stroke.join !== 'miter') parts.push(`stroke-linejoin="${stroke.join}"`);
  if (stroke.dash && stroke.dash.length) {
    parts.push(`stroke-dasharray="${stroke.dash.map(n).join(' ')}"`);
    if (stroke.dashOffset) parts.push(`stroke-dashoffset="${n(stroke.dashOffset)}"`);
  }
  return parts.join(' ');
}

const matrix = (m: Mat2D) => `matrix(${m.map(n).join(' ')})`;

function n(v: number): string {
  const r = v.toFixed(3);
  return r.replace(/\.?0+$/, '') || '0';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/** Soft-proof CSS colour for UI accents that must match print swatches. */
export function swatchCss(c: Color): string {
  return colorToCss(c);
}
