/**
 * PageBuilder — what templates build pages with. It owns the three
 * mechanics templates must never reimplement:
 *   1. frames: stable ids, manual-override application, conflict detection;
 *   2. images: focal-point crops, effective-dpi guard, legibility scrims,
 *      and LOUD missing-image placeholders (a blank frame is a defect);
 *   3. text: typesetting via the engine with diagnostics surfaced.
 */

import {
  rectPath,
  roundedRectPath,
  type Color,
  type Diagnostic,
  type DLItem,
  type FrameOverride,
  type ImageAsset,
  type ParagraphContent,
  type Rect,
} from '@guide/shared';
import type { GuideTheme } from './theme.js';
import type { AssetCatalog } from './types.js';
import { typesetFrame } from './text/typeset.js';
import type { TextEnv, TextFrameSpec, TypesetResult } from './text/types.js';
import { makeQrPath } from './qr.js';
import { transformPath } from '@guide/shared';

export interface FrameInfo {
  pageId: string;
  rect: Rect;
  kind: string;
}

export interface FramedRect {
  rect: Rect;
  hidden: boolean;
}

export class PageBuilder {
  items: DLItem[] = [];
  frames: Record<string, FrameInfo> = {};
  diagnostics: Diagnostic[] = [];

  constructor(
    readonly pageId: string,
    readonly side: 'left' | 'right',
    readonly theme: GuideTheme,
    readonly assets: AssetCatalog,
    readonly textEnv: TextEnv,
    private overrides: ReadonlyMap<string, FrameOverride>,
  ) {}

  add(...items: DLItem[]): void {
    this.items.push(...items);
  }

  diag(d: Diagnostic): void {
    this.diagnostics.push({ pageId: this.pageId, ...d });
  }

  /**
   * Register a frame: applies any manual override to the auto rect and
   * detects conflicts (the auto layout moved since the user pinned this
   * frame). Manual values always win; the conflict is reported, not
   * resolved silently.
   */
  frame(id: string, auto: Rect, kind = 'box'): FramedRect {
    const ov = this.overrides.get(id);
    let rect = auto;
    let hidden = false;
    if (ov) {
      const moved =
        Math.abs(ov.base.x - auto.x) > 0.25 ||
        Math.abs(ov.base.y - auto.y) > 0.25 ||
        Math.abs(ov.base.w - auto.w) > 0.25 ||
        Math.abs(ov.base.h - auto.h) > 0.25;
      if (moved) {
        this.diag({
          code: 'override.conflict',
          severity: 'warning',
          frame: id,
          message: `Generated layout for “${id}” changed since it was manually adjusted; keeping the manual position.`,
        });
      }
      rect = {
        x: ov.patch.x ?? auto.x,
        y: ov.patch.y ?? auto.y,
        w: ov.patch.w ?? auto.w,
        h: ov.patch.h ?? auto.h,
      };
      hidden = ov.patch.hidden ?? false;
    }
    this.frames[id] = { pageId: this.pageId, rect, kind };
    return { rect, hidden };
  }

  /** Font scale override for a text frame (inspector "nudge type"). */
  fontScaleOf(id: string): number {
    return this.overrides.get(id)?.patch.fontScale ?? 1;
  }

  /* ---------------------------------------------------------------- */

  text(
    id: string,
    auto: Rect,
    paragraphs: ParagraphContent[],
    opts: Partial<Omit<TextFrameSpec, 'id' | 'rect' | 'paragraphs'>> = {},
  ): TypesetResult | null {
    const { rect, hidden } = this.frame(id, auto, 'text');
    if (hidden) return null;
    const scale = this.fontScaleOf(id);
    const scaled =
      scale === 1
        ? paragraphs
        : paragraphs.map((p) => ({
            ...p,
            style: { ...p.style, size: p.style.size * scale, leading: p.style.leading * scale },
          }));
    // A frame too short to hold two lines is a single-line label; let it
    // shrink to fit its width rather than overflow. (Copyfit reduces type
    // until the one line fits — never a clipped or wrapped-away tail.)
    const firstLeading = scaled[0]?.style.leading ?? this.theme.geo.baselineGrid;
    const singleLine = rect.h < firstLeading * 1.8;
    const copyfit = opts.copyfit ?? (singleLine ? { minScale: 0.5, maxScale: 1 } : undefined);
    const result = typesetFrame(
      {
        id,
        rect,
        paragraphs: scaled,
        baselineGrid: this.theme.geo.baselineGrid,
        gridOrigin: this.theme.geo.gridOrigin,
        ...opts,
        copyfit,
      },
      this.textEnv,
    );
    this.diagnostics.push(...result.diagnostics.map((d) => ({ pageId: this.pageId, ...d })));
    if (result.item.runs.length > 0) this.items.push(result.item);
    return result;
  }

  /* ---------------------------------------------------------------- */

  image(
    id: string,
    assetId: string | undefined,
    auto: Rect,
    opts: {
      scrim?: 'bottom' | 'top';
      /** Override the luma-derived scrim alpha. */
      scrimAlpha?: number;
      scrimColor?: Color;
      radius?: number;
      /** Required output resolution; default 300. */
      targetDpi?: number;
      bleedEdges?: boolean;
    } = {},
  ): { rect: Rect } | null {
    const { rect, hidden } = this.frame(id, auto, 'image');
    if (hidden) return null;
    const asset = assetId ? this.assets.get(assetId) : undefined;
    if (!asset) {
      this.placeholder(id, rect, assetId);
      return { rect };
    }

    // Focal crop: largest window of the source matching the rect's aspect.
    const srcAspect = asset.width / asset.height;
    const dstAspect = rect.w / rect.h;
    let cw = 1;
    let ch = 1;
    if (dstAspect > srcAspect) {
      ch = srcAspect / dstAspect;
    } else {
      cw = dstAspect / srcAspect;
    }
    const cx = clamp(asset.focal.x - cw / 2, 0, 1 - cw);
    const cy = clamp(asset.focal.y - ch / 2, 0, 1 - ch);
    const crop = { x: cx, y: cy, w: cw, h: ch };

    const dpi = (asset.width * cw) / (rect.w / 72);
    const targetDpi = opts.targetDpi ?? 300;
    if (dpi < targetDpi - 0.5) {
      this.diag({
        code: 'image.lowres',
        severity: 'warning',
        frame: id,
        subject: asset.id,
        message: `“${asset.filename}” renders at ${Math.round(dpi)} dpi here (need ${targetDpi}).`,
        data: { dpi: Math.round(dpi), required: targetDpi },
      });
    }

    const imageItem: DLItem = {
      t: 'image',
      asset: asset.id,
      rect,
      crop,
      dpi,
      meta: { frame: id, role: 'image' },
    };
    const children: DLItem[] = [imageItem];

    if (opts.scrim) {
      const luma = asset.luma ?? { top: 0.5, bottom: 0.5, overall: 0.5 };
      const edgeLuma = opts.scrim === 'bottom' ? luma.bottom : luma.top;
      // Brighter photo edges need a stronger scrim for type to hold.
      const alpha = opts.scrimAlpha ?? (edgeLuma > 0.55 ? 0.58 : edgeLuma > 0.35 ? 0.46 : 0.34);
      const color = opts.scrimColor ?? this.theme.colors.primaryDeep;
      const span = rect.h * 0.52;
      const [y0, y1] =
        opts.scrim === 'bottom' ? [rect.y + rect.h - span, rect.y + rect.h] : [rect.y + span, rect.y];
      children.push({
        t: 'path',
        d: rectPath(
          opts.scrim === 'bottom'
            ? { x: rect.x, y: rect.y + rect.h - span, w: rect.w, h: span }
            : { x: rect.x, y: rect.y, w: rect.w, h: span },
        ),
        fill: {
          gradient: {
            kind: 'linear',
            from: [rect.x, y0],
            to: [rect.x, y1],
            stops: [
              { at: 0, color, alpha: 0 },
              { at: 0.45, color, alpha: alpha * 0.55 },
              { at: 1, color, alpha },
            ],
          },
        },
        meta: { frame: id, role: 'scrim' },
      });
    }

    this.items.push({
      t: 'group',
      clip: opts.radius ? roundedRectPath(rect, opts.radius) : rectPath(rect),
      children,
      meta: { frame: id, role: 'image-group' },
    });
    return { rect };
  }

  /** Visible, unmistakable placeholder — never an empty frame. */
  private placeholder(id: string, rect: Rect, assetId: string | undefined): void {
    this.diag({
      code: 'image.missing',
      severity: 'error',
      frame: id,
      subject: assetId,
      message: assetId
        ? `Image “${assetId}” could not be found for this frame.`
        : 'No image selected for this frame.',
    });
    const c = this.theme.colors;
    this.items.push({
      t: 'group',
      clip: rectPath(rect),
      children: [
        { t: 'path', d: rectPath(rect), fill: { color: c.wash } },
        {
          t: 'path',
          d: [
            ['M', rect.x, rect.y],
            ['L', rect.x + rect.w, rect.y + rect.h],
            ['M', rect.x + rect.w, rect.y],
            ['L', rect.x, rect.y + rect.h],
          ],
          stroke: { color: c.inkFaint, width: 0.6 },
        },
        { t: 'path', d: rectPath(rect), stroke: { color: c.inkFaint, width: 0.8 } },
      ],
      meta: { frame: id, role: 'image-missing' },
    });
  }

  /* ---------------------------------------------------------------- */

  /**
   * QR block: quiet chip + brand-dark modules (scannable on any field).
   * Returns the chip rect actually used.
   */
  qr(
    id: string,
    target: string,
    auto: Rect,
    opts: { chip?: boolean; moduleColor?: Color; chipColor?: Color } = {},
  ): Rect | null {
    const { rect, hidden } = this.frame(id, auto, 'qr');
    if (hidden) return null;
    const c = this.theme.colors;
    const { path } = makeQrPath(target);
    const children: DLItem[] = [];
    const pad = rect.w * 0.09; // quiet zone
    if (opts.chip !== false) {
      children.push({
        t: 'path',
        d: roundedRectPath(rect, rect.w * 0.07),
        fill: { color: opts.chipColor ?? c.paper },
      });
    }
    const inner = rect.w - 2 * pad;
    children.push({
      t: 'path',
      d: transformPath(path, [inner, 0, 0, inner, rect.x + pad, rect.y + pad]),
      fill: { color: opts.moduleColor ?? c.primaryDeep },
    });
    this.items.push({ t: 'group', children, meta: { frame: id, role: 'qr' } });
    return rect;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
