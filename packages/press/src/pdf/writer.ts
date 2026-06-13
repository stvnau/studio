/**
 * writePdf — the press painter. Turns a display-list DocRender into either a
 * PDF/X-4 CMYK press file (mode 'press') or an RGB screen proof (mode
 * 'proof'). It adds no geometry beyond printer's marks in the slug area; the
 * numbers it emits are the numbers compileEdition() produced, so editor and
 * press stay in lockstep.
 *
 * Pipeline per call:
 *   1. Embed + subset every used font (FontEmbedder) and every image XObject
 *      (embedImages) up front, deduplicated.
 *   2. Walk each page's display list, emitting one content stream per page in
 *      display-list space (top-left origin, y down) via the root CTM flip.
 *   3. Draw printer's marks into the bleed/slug area (press, or when marks on).
 *   4. Finish fonts, attach OutputIntent + XMP (press), write Info, save.
 *   5. Collect preflight diagnostics over the source render and the result.
 *
 * Coordinate convention (mirrors content.ts): every page begins with
 *   1 0 0 -1 0 mediaH cm
 * so that display-list coordinates — top-left of the BLEED box, y down — map
 * straight onto PDF user space. Text counters the flip per run with a Tm of
 * [1 0 0 -1 x y] so glyph outlines render upright.
 */

import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib';
import {
  effectiveCmyk,
  inkCoverage,
  isPureBlack,
  colorToScreenRgb,
  pathBounds,
  transformPath,
  walkItems,
  type Color,
  type Diagnostic,
  type DLItem,
  type DocRender,
  type Fill,
  type GlyphRun,
  type Mat2D,
  type PageRender,
  type PathSpec,
  type Rect,
  type Stroke,
} from '@guide/shared';
import type { PressOptions, PressResult, WritePdfFn } from '../types.js';
import { ContentWriter } from './content.js';
import { FontEmbedder } from './fonts.js';
import {
  embedImages,
  imageKey,
  type EmbeddedImage,
  type ImageRequest,
} from './images.js';
import {
  buildAlphaGState,
  buildAlphaScrimGState,
  buildAxialShading,
  buildOverprintGState,
  gradientHasAlpha,
} from './shading.js';

/* ------------------------------------------------------------------ */
/* Per-page resource accounting                                       */
/* ------------------------------------------------------------------ */

/**
 * Collects the indirect objects a single page's content references. Fonts and
 * images are shared across pages (allocated once), but ExtGStates, shadings
 * and Separation colour spaces are emitted on demand and named per page.
 */
class PageResources {
  readonly fonts = new Map<string, PDFRef>(); // resourceName -> font dict ref
  readonly xobjects = new Map<string, PDFRef>(); // resourceName -> xobject ref
  readonly extGStates = new Map<string, PDFRef>();
  readonly shadings = new Map<string, PDFRef>();
  readonly colorSpaces = new Map<string, PDFRef>();
  private csByRef = new Map<PDFRef, string>();
  private gsCounter = 0;
  private shCounter = 0;
  private csCounter = 0;

  constructor(private doc: PDFDocument) {}

  font(resourceName: string, ref: PDFRef): void {
    this.fonts.set(resourceName, ref);
  }

  image(resourceName: string, ref: PDFRef): void {
    this.xobjects.set(resourceName, ref);
  }

  /** Register an ExtGState dict, return its page-local resource name. */
  gstate(dict: PDFDict): string {
    const name = `GS${this.gsCounter++}`;
    this.extGStates.set(name, this.doc.context.register(dict));
    return name;
  }

  /** Register an already-allocated shading ref, return its resource name. */
  shading(ref: PDFRef): string {
    const name = `Sh${this.shCounter++}`;
    this.shadings.set(name, ref);
    return name;
  }

  /** Register a Separation colour-space ref (deduped per page by ref). */
  colorSpace(ref: PDFRef): string {
    const existing = this.csByRef.get(ref);
    if (existing) return existing;
    const name = `CS${this.csCounter++}`;
    this.colorSpaces.set(name, ref);
    this.csByRef.set(ref, name);
    return name;
  }

  /** Build the page /Resources dictionary. */
  build(): PDFDict {
    const ctx = this.doc.context;
    const dict = (entries: Map<string, PDFRef>): PDFDict => {
      const d = ctx.obj({});
      for (const [name, ref] of entries) d.set(PDFName.of(name), ref);
      return d;
    };
    const res = ctx.obj({ ProcSet: ['PDF', 'Text', 'ImageC', 'ImageB'] });
    if (this.fonts.size) res.set(PDFName.of('Font'), dict(this.fonts));
    if (this.xobjects.size) res.set(PDFName.of('XObject'), dict(this.xobjects));
    if (this.extGStates.size) res.set(PDFName.of('ExtGState'), dict(this.extGStates));
    if (this.shadings.size) res.set(PDFName.of('Shading'), dict(this.shadings));
    if (this.colorSpaces.size) res.set(PDFName.of('ColorSpace'), dict(this.colorSpaces));
    return res;
  }
}

/* ------------------------------------------------------------------ */
/* writePdf                                                           */
/* ------------------------------------------------------------------ */

export const writePdf: WritePdfFn = async (render, opts) => {
  const press = opts.mode === 'press';
  const marks = press || opts.marks;
  const preflight: Diagnostic[] = [];

  const doc = await PDFDocument.create();

  /* --- ICC availability (press OutputIntent) --- */
  if (press && (!opts.icc || !opts.icc.bytes || opts.icc.bytes.length === 0)) {
    preflight.push({
      code: 'press.icc-missing',
      severity: 'error',
      message: 'No ICC profile available for the PDF/X-4 OutputIntent.',
    });
  }

  /* --- Fonts: subset every used font up front --- */
  let fontEmbedder: FontEmbedder | undefined;
  try {
    fontEmbedder = await FontEmbedder.create(doc, opts.fonts, render.fontsUsed);
  } catch (err) {
    preflight.push({
      code: 'press.font-embed',
      severity: 'error',
      message: `Font subsetting failed: ${(err as Error).message}`,
    });
  }

  /* --- Images: embed all referenced XObjects up front --- */
  const imageRequests = collectImageRequests(render);
  const imageResult = await embedImages(
    doc,
    imageRequests,
    opts.assets,
    opts.mode,
    opts.targetDpi,
    opts.inkLimit,
  );
  preflight.push(...imageResult.diagnostics);

  /* --- Source-render colour preflight (ink limit, spot usage, bleed) --- */
  const sourceInk = analyseSource(render, opts, preflight);
  const maxInkCoverage = Math.max(sourceInk, imageResult.maxInkCoverage);

  /* --- Shared overprint graphics state (allocated once; scoped via q/Q) --- */
  const overprintRef = press ? doc.context.register(buildOverprintGState(doc)) : undefined;

  /* --- Per-spot Separation colour space (shared) --- */
  let spotSeparationRef: PDFRef | undefined;
  if (press && opts.spot) {
    spotSeparationRef = buildSeparation(doc, opts.spot.name, opts.spot.alt);
  }
  // Registration "All" separation for crop / registration marks.
  const registrationRef = press ? buildRegistrationSeparation(doc) : undefined;

  /* --- Walk pages --- */
  for (const page of render.pages) {
    const painter = new Painter(doc, opts, {
      fontEmbedder,
      images: imageResult.byKey,
      overprintRef,
      spotSeparationRef,
      registrationRef,
    });
    painter.paintPage(page);
    if (marks) painter.paintMarks(page);

    const mediaW = page.trim.w + 2 * page.bleed;
    const mediaH = page.trim.h + 2 * page.bleed;
    const pdfPage = doc.addPage([mediaW, mediaH]);
    pdfPage.setMediaBox(0, 0, mediaW, mediaH);
    pdfPage.setBleedBox(0, 0, mediaW, mediaH);
    pdfPage.setTrimBox(page.bleed, page.bleed, page.trim.w, page.trim.h);

    const streamRef = doc.context.register(
      doc.context.flateStream(painter.content.toBytes()),
    );
    pdfPage.node.set(PDFName.of('Contents'), streamRef);
    pdfPage.node.set(PDFName.of('Resources'), painter.resources.build());
  }

  /* --- Finish fonts (after ALL pages incl. marks have requested glyphs) --- */
  if (fontEmbedder) fontEmbedder.finish();

  /* --- Document Info + (press) PDF/X-4 metadata + OutputIntent --- */
  const now = new Date();
  writeInfo(doc, opts, now, press);
  if (press && opts.icc && opts.icc.bytes && opts.icc.bytes.length) {
    addOutputIntent(doc, opts);
    attachXmp(doc, opts, now);
  }

  const bytes = await doc.save({ useObjectStreams: false });

  /* --- Final preflight over the emitted document --- */
  if (!fontEmbedder) {
    // already reported the embed failure above.
  } else {
    finishFontPreflight(fontEmbedder, preflight);
  }
  if (press) imageColorspacePreflight(doc, imageResult.byKey, preflight);
  inkLimitPreflight(maxInkCoverage, opts.inkLimit, preflight);

  const stats: PressResult['stats'] = {
    pages: render.pages.length,
    fontsEmbedded: fontEmbedder ? fontEmbedder.list().map((f) => f.baseFont) : [],
    imagesEmbedded: imageResult.imagesEmbedded,
    maxInkCoverage: Math.round(maxInkCoverage * 10) / 10,
    pdfVersion: '1.7',
  };

  return { bytes, preflight, stats };
};

/* ------------------------------------------------------------------ */
/* Painter — walks one page's display list into a content stream      */
/* ------------------------------------------------------------------ */

interface PainterCtx {
  fontEmbedder?: FontEmbedder;
  images: Map<string, EmbeddedImage>;
  overprintRef?: PDFRef;
  spotSeparationRef?: PDFRef;
  registrationRef?: PDFRef;
}

class Painter {
  readonly content = new ContentWriter();
  readonly resources: PageResources;
  private mediaH = 0;

  constructor(
    private doc: PDFDocument,
    private opts: PressOptions,
    private ctx: PainterCtx,
  ) {
    this.resources = new PageResources(doc);
  }

  private get press(): boolean {
    return this.opts.mode === 'press';
  }

  paintPage(page: PageRender): void {
    this.mediaH = page.trim.h + 2 * page.bleed;
    // Root CTM: flip y so display-list space (top-left, y down) maps onto
    // PDF user space (bottom-left, y up). Everything below is in DL space.
    this.content.save();
    this.content.cm([1, 0, 0, -1, 0, this.mediaH]);
    for (const item of page.items) this.paintItem(item);
    this.content.restore();
  }

  /* --- item dispatch --- */

  private paintItem(item: DLItem): void {
    switch (item.t) {
      case 'group':
        this.paintGroup(item);
        break;
      case 'path':
        this.paintPath(item);
        break;
      case 'text':
        this.paintText(item);
        break;
      case 'image':
        this.paintImage(item);
        break;
    }
  }

  private paintGroup(item: Extract<DLItem, { t: 'group' }>): void {
    this.content.save();
    if (item.transform) this.content.cm(item.transform);
    if (item.clip) this.content.clipPath(item.clip, 'nonzero');
    // Constant group alpha as a plain ExtGState (isolation is best-effort:
    // pdf-lib has no transparency-group form here, so we apply alpha only).
    if (item.alpha !== undefined && item.alpha < 1) {
      const name = this.resources.gstate(buildAlphaGState(this.doc, item.alpha, item.alpha));
      this.content.gs(name);
    }
    for (const child of item.children) this.paintItem(child);
    this.content.restore();
  }

  private paintPath(item: Extract<DLItem, { t: 'path' }>): void {
    const { d, fill, stroke } = item;
    if (fill) this.fillPath(d, fill);
    if (stroke) this.strokePath(d, stroke);
  }

  /* --- fills --- */

  private fillPath(d: PathSpec, fill: Fill): void {
    if (fill.gradient) {
      this.fillGradient(d, fill);
      return;
    }
    if (!fill.color) return;
    const rule = fill.rule ?? 'nonzero';
    const overprint = this.press && (fill.overprint || isPureBlack(fill.color));

    this.content.save();
    if (fill.alpha !== undefined && fill.alpha < 1) {
      const name = this.resources.gstate(buildAlphaGState(this.doc, fill.alpha, fill.alpha));
      this.content.gs(name);
    }
    if (overprint && this.ctx.overprintRef) {
      this.content.gs(this.resources.gstate(this.refGState(this.ctx.overprintRef)));
    }
    this.setFillColor(fill.color);
    this.content.path(d);
    this.content.fill(rule);
    this.content.restore();
  }

  /** Gradient fill: clip to the path, paint an axial shading over its bounds. */
  private fillGradient(d: PathSpec, fill: Fill): void {
    const grad = fill.gradient!;
    const bounds = pathBounds(d);
    const shadingRef = buildAxialShading(this.doc, grad, this.opts.mode);

    this.content.save();
    // Clip to the path so the shading only paints inside it.
    this.content.clipPath(d, fill.rule ?? 'nonzero');
    if (this.press && gradientHasAlpha(grad)) {
      const scrim = buildAlphaScrimGState(this.doc, grad, bounds, fill.alpha ?? 1);
      this.content.gs(this.resources.gstate(scrim));
    } else if (fill.alpha !== undefined && fill.alpha < 1) {
      const name = this.resources.gstate(buildAlphaGState(this.doc, fill.alpha, fill.alpha));
      this.content.gs(name);
    }
    this.content.shading(this.resources.shading(shadingRef));
    this.content.restore();
  }

  /* --- strokes --- */

  private strokePath(d: PathSpec, stroke: Stroke): void {
    const overprint = this.press && isPureBlack(stroke.color);
    this.content.save();
    if (stroke.alpha !== undefined && stroke.alpha < 1) {
      const name = this.resources.gstate(buildAlphaGState(this.doc, stroke.alpha, stroke.alpha));
      this.content.gs(name);
    }
    if (overprint && this.ctx.overprintRef) {
      this.content.gs(this.resources.gstate(this.refGState(this.ctx.overprintRef)));
    }
    this.content.lineWidth(stroke.width);
    if (stroke.cap) this.content.lineCap(stroke.cap);
    if (stroke.join) this.content.lineJoin(stroke.join);
    if (stroke.dash && stroke.dash.length) this.content.dash(stroke.dash, stroke.dashOffset ?? 0);
    this.setStrokeColor(stroke.color);
    this.content.path(d);
    this.content.stroke();
    this.content.restore();
  }

  /* --- text --- */

  private paintText(item: Extract<DLItem, { t: 'text' }>): void {
    for (const run of item.runs) this.paintRun(run);
  }

  private paintRun(run: GlyphRun): void {
    const embedder = this.ctx.fontEmbedder;
    if (!embedder || !embedder.has(run.font) || run.glyphs.length === 0) return;
    const font = embedder.get(run.font);

    this.content.save();
    if (run.alpha !== undefined && run.alpha < 1) {
      const name = this.resources.gstate(buildAlphaGState(this.doc, run.alpha, run.alpha));
      this.content.gs(name);
    }
    // Register the font on this page's resources.
    this.resources.font(font.resourceName, font.ref);

    const stroked = !!run.stroke;
    const overprint = this.press && isPureBlack(run.color);
    if (overprint && this.ctx.overprintRef) {
      this.content.gs(this.resources.gstate(this.refGState(this.ctx.overprintRef)));
    }
    this.setFillColor(run.color);
    if (stroked) {
      this.setStrokeColor(run.stroke!.color);
      this.content.lineWidth(run.stroke!.width);
    }

    // ActualText for accessibility / extraction.
    this.content.beginActualText(run.text);
    this.content.beginText();
    this.content.font(font.resourceName, run.size);
    this.content.renderMode(stroked ? 2 : 0); // 2 = fill+stroke

    // Each glyph is positioned absolutely in local (DL) space. We counter the
    // root flip with a per-glyph Tm of [1 0 0 -1 x y] so outlines are upright,
    // then emit a single glyph with TJ. This keeps arbitrary glyph placement
    // (kerning already baked into x) exact.
    for (const g of run.glyphs) {
      const newGid = embedder.mapGlyph(run.font, g.g);
      this.content.textMatrix([1, 0, 0, -1, g.x, g.y]);
      this.content.showGlyphs([{ glyphs: [newGid] }]);
    }
    this.content.endText();
    this.content.endMarkedContent();
    this.content.restore();
  }

  /* --- images --- */

  private paintImage(item: Extract<DLItem, { t: 'image' }>): void {
    const req: ImageRequest = {
      asset: item.asset,
      rect: item.rect,
      crop: item.crop,
      pageId: '',
      frame: item.meta?.frame,
    };
    const key = imageKey(req, this.opts.mode, this.opts.targetDpi);
    const embedded = this.ctx.images.get(key);
    if (!embedded) return;
    this.resources.image(embedded.resourceName, embedded.ref);

    const { rect } = item;
    this.content.save();
    // Clip to the destination rect.
    this.content.rect(rect.x, rect.y, rect.w, rect.h);
    this.content.clip('nonzero');
    this.content.endPathNoOp();
    // Image space is a 1x1 unit square with its own y-up convention. We place
    // it so the unit square covers `rect` but flips vertically (PDF images draw
    // bottom-up; our DL space is y-down), giving an upright image.
    //   translate to top-left, scale to rect size, flip y.
    const m: Mat2D = [rect.w, 0, 0, -rect.h, rect.x, rect.y + rect.h];
    this.content.cm(m);
    this.content.drawXObject(embedded.resourceName);
    this.content.restore();
  }

  /* --- printer's marks --- */

  /**
   * Crop marks at the four trim corners, four registration targets centred on
   * the trim edges, and a slug info line — all in registration colour, kept
   * outside the TrimBox in the bleed/slug area.
   */
  paintMarks(page: PageRender): void {
    this.mediaH = page.trim.h + 2 * page.bleed;
    const b = page.bleed;
    const tw = page.trim.w;
    const th = page.trim.h;
    // Trim box in DL space.
    const tx0 = b;
    const ty0 = b;
    const tx1 = b + tw;
    const ty1 = b + th;

    const markLen = Math.min(b * 0.8, 18); // mark length
    const gap = Math.min(b * 0.35, 6); // gap between trim edge and mark start

    this.content.save();
    this.content.cm([1, 0, 0, -1, 0, this.mediaH]);
    this.setStrokeRegistration();
    this.content.lineWidth(0.25);
    this.content.lineCap('butt');

    const line = (x1: number, y1: number, x2: number, y2: number) => {
      this.content.moveTo(x1, y1);
      this.content.lineTo(x2, y2);
      this.content.stroke();
    };

    // Crop marks: two strokes per corner (horizontal + vertical), offset out.
    // Top-left
    line(tx0 - gap, ty0, tx0 - gap - markLen, ty0);
    line(tx0, ty0 - gap, tx0, ty0 - gap - markLen);
    // Top-right
    line(tx1 + gap, ty0, tx1 + gap + markLen, ty0);
    line(tx1, ty0 - gap, tx1, ty0 - gap - markLen);
    // Bottom-left
    line(tx0 - gap, ty1, tx0 - gap - markLen, ty1);
    line(tx0, ty1 + gap, tx0, ty1 + gap + markLen);
    // Bottom-right
    line(tx1 + gap, ty1, tx1 + gap + markLen, ty1);
    line(tx1, ty1 + gap, tx1, ty1 + gap + markLen);

    // Registration targets centred on each trim-edge midpoint, in the bleed.
    const targetR = Math.min(b * 0.3, 4);
    const target = (cx: number, cy: number) => {
      // Crosshair + circle.
      line(cx - targetR * 1.6, cy, cx + targetR * 1.6, cy);
      line(cx, cy - targetR * 1.6, cx, cy + targetR * 1.6);
      this.strokeCircle(cx, cy, targetR);
    };
    const midX = (tx0 + tx1) / 2;
    const midY = (ty0 + ty1) / 2;
    target(midX, b / 2); // top
    target(midX, ty1 + b / 2); // bottom
    target(b / 2, midY); // left
    target(tx1 + b / 2, midY); // right

    this.content.restore();

    // Slug info line (title + standard + date) along the bottom slug, using
    // the first embedded font. Drawn fill-only in registration colour.
    this.paintSlug(page);
  }

  private paintSlug(page: PageRender): void {
    const embedder = this.ctx.fontEmbedder;
    const font = embedder?.first();
    if (!embedder || !font) return;

    const fm = font.font;
    const standard = this.press ? 'PDF/X-4' : 'PROOF';
    const date = new Date().toISOString().slice(0, 10);
    const text = `${this.opts.title}  ·  ${standard}  ·  ${date}  ·  ${page.pageId}`;

    // Shape minimally through fontkit (the same binary FontManager uses).
    const layout = (fm as unknown as { layout(s: string): { glyphs: { id: number }[] } }).layout(
      text,
    );
    const size = Math.min(page.bleed * 0.7, 5);
    if (size < 2) return;
    // Baseline near the bottom slug, inside the bleed, clear of the trim box.
    const baselineY = page.trim.h + 2 * page.bleed - page.bleed * 0.3;
    let penX = page.bleed;

    this.content.save();
    this.content.cm([1, 0, 0, -1, 0, this.mediaH]);
    this.setFillRegistration();
    this.resources.font(font.resourceName, font.ref);
    this.content.beginText();
    this.content.font(font.resourceName, size);
    const scale = size / fm.unitsPerEm;
    for (const glyph of layout.glyphs) {
      const newGid = embedder.mapGlyph(font.id, glyph.id);
      this.content.textMatrix([1, 0, 0, -1, penX, baselineY]);
      this.content.showGlyphs([{ glyphs: [newGid] }]);
      penX += (fm.getGlyph(glyph.id).advanceWidth ?? 0) * scale;
    }
    this.content.endText();
    this.content.restore();
  }

  /* --- colour helpers --- */

  private setFillColor(color: Color): void {
    if (!this.press) {
      const [r, g, b] = colorToScreenRgb(color);
      this.content.fillRgb(r, g, b);
      return;
    }
    if (color.space === 'registration') {
      this.setFillRegistration();
      return;
    }
    if (color.space === 'spot' && this.matchesSpot(color.name) && this.ctx.spotSeparationRef) {
      const name = this.resources.colorSpace(this.ctx.spotSeparationRef);
      this.content.fillSeparation(name, color.tint);
      return;
    }
    const [c, m, y, k] = effectiveCmyk(color);
    this.content.fillCmyk(c, m, y, k);
  }

  private setStrokeColor(color: Color): void {
    if (!this.press) {
      const [r, g, b] = colorToScreenRgb(color);
      this.content.strokeRgb(r, g, b);
      return;
    }
    if (color.space === 'registration') {
      this.setStrokeRegistration();
      return;
    }
    if (color.space === 'spot' && this.matchesSpot(color.name) && this.ctx.spotSeparationRef) {
      const name = this.resources.colorSpace(this.ctx.spotSeparationRef);
      this.content.strokeSeparation(name, color.tint);
      return;
    }
    const [c, m, y, k] = effectiveCmyk(color);
    this.content.strokeCmyk(c, m, y, k);
  }

  private setFillRegistration(): void {
    if (this.press && this.ctx.registrationRef) {
      const name = this.resources.colorSpace(this.ctx.registrationRef);
      this.content.fillSeparation(name, 1);
    } else if (this.press) {
      this.content.fillCmyk(1, 1, 1, 1);
    } else {
      this.content.fillRgb(0, 0, 0);
    }
  }

  private setStrokeRegistration(): void {
    if (this.press && this.ctx.registrationRef) {
      const name = this.resources.colorSpace(this.ctx.registrationRef);
      this.content.strokeSeparation(name, 1);
    } else if (this.press) {
      this.content.strokeCmyk(1, 1, 1, 1);
    } else {
      this.content.strokeRgb(0, 0, 0);
    }
  }

  private matchesSpot(name: string): boolean {
    return !!this.opts.spot && this.opts.spot.name === name;
  }

  /** Wrap an existing ExtGState ref as a dict pdf-lib can re-register. */
  private refGState(ref: PDFRef): PDFDict {
    return this.doc.context.lookup(ref, PDFDict);
  }

  private strokeCircle(cx: number, cy: number, r: number): void {
    const k = 0.5522847498307936 * r;
    this.content.moveTo(cx + r, cy);
    this.content.curveTo(cx + r, cy + k, cx + k, cy + r, cx, cy + r);
    this.content.curveTo(cx - k, cy + r, cx - r, cy + k, cx - r, cy);
    this.content.curveTo(cx - r, cy - k, cx - k, cy - r, cx, cy - r);
    this.content.curveTo(cx + k, cy - r, cx + r, cy - k, cx + r, cy);
    this.content.closePath();
    this.content.stroke();
  }
}

/* ------------------------------------------------------------------ */
/* Separation colour spaces                                           */
/* ------------------------------------------------------------------ */

/**
 * A Separation colour space whose alternate is DeviceCMYK and whose tint
 * transform maps tint t -> the spot's alt CMYK scaled by t (a Type 2
 * exponential function from [0,0,0,0] to alt).
 */
function buildSeparation(doc: PDFDocument, name: string, alt: readonly number[]): PDFRef {
  const ctx = doc.context;
  const tintFn = ctx.register(
    ctx.obj({
      FunctionType: 2,
      Domain: [0, 1],
      C0: [0, 0, 0, 0],
      C1: [alt[0] ?? 0, alt[1] ?? 0, alt[2] ?? 0, alt[3] ?? 0],
      N: 1,
    }),
  );
  const arr = ctx.obj([
    PDFName.of('Separation'),
    PDFName.of(sanitizeColorantName(name)),
    PDFName.of('DeviceCMYK'),
    tintFn,
  ]);
  return ctx.register(arr);
}

/** Registration "All" separation: tint t -> [t t t t] across every plate. */
function buildRegistrationSeparation(doc: PDFDocument): PDFRef {
  const ctx = doc.context;
  const tintFn = ctx.register(
    ctx.obj({
      FunctionType: 2,
      Domain: [0, 1],
      C0: [0, 0, 0, 0],
      C1: [1, 1, 1, 1],
      N: 1,
    }),
  );
  const arr = ctx.obj([
    PDFName.of('Separation'),
    PDFName.of('All'),
    PDFName.of('DeviceCMYK'),
    tintFn,
  ]);
  return ctx.register(arr);
}

function sanitizeColorantName(name: string): string {
  return name.replace(/[^\x21-\x7e]/g, '').replace(/[()<>[\]{}/%#]/g, '') || 'Spot';
}

/* ------------------------------------------------------------------ */
/* Image request collection                                           */
/* ------------------------------------------------------------------ */

function collectImageRequests(render: DocRender): ImageRequest[] {
  const out: ImageRequest[] = [];
  for (const page of render.pages) {
    for (const item of walkItems(page.items)) {
      if (item.t !== 'image') continue;
      out.push({
        asset: item.asset,
        rect: item.rect,
        crop: item.crop,
        pageId: page.pageId,
        frame: item.meta?.frame,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* OutputIntent + Info + XMP                                          */
/* ------------------------------------------------------------------ */

function addOutputIntent(doc: PDFDocument, opts: PressOptions): void {
  const ctx = doc.context;
  const profileStream = ctx.flateStream(opts.icc.bytes, { N: 4 });
  const profileRef = ctx.register(profileStream);
  const intent = ctx.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFX',
    OutputConditionIdentifier: PDFString.of(opts.icc.name),
    Info: PDFString.of(opts.icc.name),
    DestOutputProfile: profileRef,
  });
  const arrRef = ctx.register(ctx.obj([intent]));
  doc.catalog.set(PDFName.of('OutputIntents'), arrRef);
}

function writeInfo(doc: PDFDocument, opts: PressOptions, now: Date, press: boolean): void {
  const ctx = doc.context;
  const info = ctx.obj({});
  info.set(PDFName.of('Title'), PDFHexString.fromText(opts.title));
  info.set(PDFName.of('Producer'), PDFString.of('Guide Studio Press'));
  info.set(PDFName.of('Creator'), PDFString.of('Guide Studio'));
  info.set(PDFName.of('CreationDate'), PDFString.fromDate(now));
  info.set(PDFName.of('ModDate'), PDFString.fromDate(now));
  if (press) {
    info.set(PDFName.of('GTS_PDFXVersion'), PDFString.of('PDF/X-4'));
    info.set(PDFName.of('GTS_PDFXConformance'), PDFString.of('PDF/X-4'));
  }
  const infoRef = ctx.register(info);
  ctx.trailerInfo.Info = infoRef;
}

/**
 * XMP metadata packet with the PDF/X identification schema (pdfxid) and a
 * Dublin Core title, attached as the catalog /Metadata stream.
 */
function attachXmp(doc: PDFDocument, opts: PressOptions, now: Date): void {
  const ctx = doc.context;
  const iso = now.toISOString().replace(/\.\d+Z$/, 'Z');
  const title = xmlEscape(opts.title);
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
    xmlns:pdfx="http://ns.adobe.com/pdfx/1.3/"
    xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">
   <dc:title>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${title}</rdf:li>
    </rdf:Alt>
   </dc:title>
   <dc:format>application/pdf</dc:format>
   <xmp:CreateDate>${iso}</xmp:CreateDate>
   <xmp:ModifyDate>${iso}</xmp:ModifyDate>
   <xmp:CreatorTool>Guide Studio</xmp:CreatorTool>
   <pdf:Producer>Guide Studio Press</pdf:Producer>
   <pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>
   <pdfx:GTS_PDFXVersion>PDF/X-4</pdfx:GTS_PDFXVersion>
   <pdfx:GTS_PDFXConformance>PDF/X-4</pdfx:GTS_PDFXConformance>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  const stream = ctx.stream(xmp, {
    Type: 'Metadata',
    Subtype: 'XML',
  });
  const ref = ctx.register(stream);
  doc.catalog.set(PDFName.of('Metadata'), ref);
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ */
/* Preflight                                                          */
/* ------------------------------------------------------------------ */

/**
 * Source-render colour pass: tracks the maximum CMYK ink coverage over every
 * solid fill/stroke colour, records whether the declared spot was used, and
 * checks full-bleed paths against the bleed edge. Returns the max ink seen.
 */
function analyseSource(render: DocRender, opts: PressOptions, preflight: Diagnostic[]): number {
  let maxInk = 0;
  let spotUsed = false;
  const press = opts.mode === 'press';

  for (const page of render.pages) {
    const pageW = page.trim.w + 2 * page.bleed;
    const pageH = page.trim.h + 2 * page.bleed;
    for (const item of walkItems(page.items)) {
      const colors: Color[] = [];
      if (item.t === 'path') {
        if (item.fill?.color) colors.push(item.fill.color);
        if (item.fill?.gradient) for (const s of item.fill.gradient.stops) colors.push(s.color);
        if (item.stroke) colors.push(item.stroke.color);
      } else if (item.t === 'text') {
        for (const run of item.runs) {
          colors.push(run.color);
          if (run.stroke) colors.push(run.stroke.color);
        }
      }
      for (const c of colors) {
        if (c.space === 'spot' && opts.spot && c.name === opts.spot.name) spotUsed = true;
        const ink = inkCoverage(c);
        if (ink > maxInk) maxInk = ink;
      }

      // Bleed-short: a path that visually wants to reach an edge but stops
      // short. Heuristic — only top-level paths whose fill nearly spans the
      // page (>= 90% of a dimension) but miss the bleed edge.
      if (press && item.t === 'path' && (item.fill?.color || item.fill?.gradient)) {
        checkBleedShort(item.d, pageW, pageH, page.pageId, item.meta?.frame, preflight);
      }
      if (press && item.t === 'image') {
        const r = item.rect;
        checkBleedShort(rectAsPath(r), pageW, pageH, page.pageId, item.meta?.frame, preflight, item.asset);
      }
    }
  }

  if (press && opts.spot && !spotUsed) {
    preflight.push({
      code: 'press.spot-unused',
      severity: 'warning',
      message: `Spot colour '${opts.spot.name}' was declared but no item used it.`,
      subject: opts.spot.name,
    });
  }
  return maxInk;
}

function rectAsPath(r: Rect): PathSpec {
  return [
    ['M', r.x, r.y],
    ['L', r.x + r.w, r.y],
    ['L', r.x + r.w, r.y + r.h],
    ['L', r.x, r.y + r.h],
    ['Z'],
  ];
}

/**
 * Best-effort full-bleed check: when a filled element spans most of the page
 * along a dimension, but its bounds stop inside the page edge it ought to
 * bleed past, warn. `transformPath` is identity here — items are already in
 * page space when produced at the top level.
 */
function checkBleedShort(
  d: PathSpec,
  pageW: number,
  pageH: number,
  pageId: string,
  frame: string | undefined,
  preflight: Diagnostic[],
  subject?: string,
): void {
  const b = pathBounds(transformPath(d, [1, 0, 0, 1, 0, 0]));
  const spansX = b.w >= pageW * 0.9;
  const spansY = b.h >= pageH * 0.9;
  if (!spansX && !spansY) return; // not a full-bleed element
  const tol = 0.5; // pt — must reach within half a point of the edge
  const short: string[] = [];
  if (spansX) {
    if (b.x > tol) short.push('left');
    if (b.x + b.w < pageW - tol) short.push('right');
  }
  if (spansY) {
    if (b.y > tol) short.push('top');
    if (b.y + b.h < pageH - tol) short.push('bottom');
  }
  if (short.length) {
    preflight.push({
      code: 'press.bleed-short',
      severity: 'warning',
      message: `Full-bleed element stops short of the ${short.join(', ')} bleed edge.`,
      pageId,
      frame,
      subject,
      data: { edges: short.join(',') },
    });
  }
}

function finishFontPreflight(embedder: FontEmbedder, preflight: Diagnostic[]): void {
  for (const f of embedder.list()) {
    if (f.subsetLength <= 0) {
      preflight.push({
        code: 'press.font-embed',
        severity: 'error',
        message: `Font '${f.id}' failed to subset/embed (empty subset).`,
        subject: f.id,
      });
    }
  }
}

/**
 * Verify every embedded image XObject is DeviceCMYK (or a Separation/spot).
 * embedImages produces CMYK for press; this re-reads the emitted objects so a
 * future RGB leak is caught structurally, not just trusted.
 */
function imageColorspacePreflight(
  doc: PDFDocument,
  images: Map<string, EmbeddedImage>,
  preflight: Diagnostic[],
): void {
  for (const [key, img] of images) {
    // Image XObjects are raw streams; the ColorSpace lives in the stream dict.
    const xobject = doc.context.lookup(img.ref) as { dict?: PDFDict } | undefined;
    const cs = xobject?.dict?.get(PDFName.of('ColorSpace'));
    const name = cs?.toString() ?? '';
    const ok = /DeviceCMYK|Separation|DeviceN/.test(name);
    if (!ok) {
      preflight.push({
        code: 'press.image-colorspace',
        severity: 'error',
        message: `Embedded image is not CMYK (colour space ${name || 'unknown'}).`,
        subject: key.split('|')[0],
        data: { colorSpace: name },
      });
    }
  }
}

function inkLimitPreflight(maxInk: number, limit: number, preflight: Diagnostic[]): void {
  if (maxInk > limit + 1e-6) {
    preflight.push({
      code: 'press.ink-limit',
      severity: 'error',
      message: `Maximum ink coverage ${maxInk.toFixed(0)}% exceeds the ${limit}% limit.`,
      data: { maxInk: Math.round(maxInk), limit },
    });
  }
}

