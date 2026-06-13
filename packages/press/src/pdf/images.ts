/**
 * Image pipeline (sharp): crop -> downsample -> colour-convert -> embed.
 *
 * press: raw 8-bit DeviceCMYK, FlateDecode (avoids the Adobe CMYK-JPEG
 *        inversion ambiguity entirely), with the total-ink guard applied on
 *        the raw pixels (CMY scaled down proportionally, K preserved).
 * proof: sRGB JPEG quality 90, DCTDecode.
 *
 * XObjects are deduplicated by (asset, crop, target size, mode).
 */

import sharp from 'sharp';
import { PDFDocument, PDFRef } from 'pdf-lib';
import type { Diagnostic, Rect } from '@guide/shared';
import type { PressAssetStore } from '../types.js';

export interface ImageRequest {
  asset: string;
  rect: Rect;
  crop: { x: number; y: number; w: number; h: number };
  pageId: string;
  frame?: string;
}

export interface EmbeddedImage {
  resourceName: string;
  ref: PDFRef;
  widthPx: number;
  heightPx: number;
}

export interface ImagePipelineResult {
  /** Lookup key (see imageKey) -> embedded XObject. */
  byKey: Map<string, EmbeddedImage>;
  diagnostics: Diagnostic[];
  imagesEmbedded: number;
  /** Highest total ink (percent) seen in any CMYK pixel BEFORE clamping. */
  maxInkCoverage: number;
}

export function imageKey(req: ImageRequest, mode: 'press' | 'proof', targetDpi: number): string {
  const { w: tw, h: th } = targetPx(req, targetDpi);
  const c = req.crop;
  return `${req.asset}|${c.x.toFixed(6)},${c.y.toFixed(6)},${c.w.toFixed(6)},${c.h.toFixed(6)}|${tw}x${th}|${mode}`;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Target pixel size: rect inches x dpi x 1.15 headroom (capped later at source size). */
function targetPx(req: ImageRequest, targetDpi: number): { w: number; h: number } {
  return {
    w: Math.ceil((req.rect.w / 72) * targetDpi * 1.15),
    h: Math.ceil((req.rect.h / 72) * targetDpi * 1.15),
  };
}

export async function embedImages(
  doc: PDFDocument,
  requests: ImageRequest[],
  assets: PressAssetStore,
  mode: 'press' | 'proof',
  targetDpi: number,
  inkLimit: number,
): Promise<ImagePipelineResult> {
  const byKey = new Map<string, EmbeddedImage>();
  const diagnostics: Diagnostic[] = [];
  let maxInkCoverage = 0;
  let counter = 0;

  for (const req of requests) {
    const key = imageKey(req, mode, targetDpi);
    if (byKey.has(key)) continue;

    const original = await assets.getImage(req.asset);

    // Crop window on the source pixel grid, clamped.
    const left = clamp(Math.round(req.crop.x * original.width), 0, original.width - 1);
    const top = clamp(Math.round(req.crop.y * original.height), 0, original.height - 1);
    const cropW = clamp(Math.round(req.crop.w * original.width), 1, original.width - left);
    const cropH = clamp(Math.round(req.crop.h * original.height), 1, original.height - top);

    // Never upscale: cap target at the cropped source size.
    const want = targetPx(req, targetDpi);
    const outW = Math.min(want.w, cropW);
    const outH = Math.min(want.h, cropH);

    let pipeline = sharp(Buffer.from(original.bytes))
      .extract({ left, top, width: cropW, height: cropH })
      .resize(outW, outH, { fit: 'fill', kernel: 'lanczos3' });

    let ref: PDFRef;
    if (mode === 'press') {
      const { data } = await pipeline
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .toColourspace('cmyk')
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Total-ink guard: scale CMY (never K) down proportionally.
      const limit255 = (inkLimit / 100) * 255;
      let clamped = 0;
      let maxBefore = 0;
      const px = outW * outH;
      for (let i = 0; i < px; i++) {
        const o = i * 4;
        const c = data[o]!;
        const m = data[o + 1]!;
        const y = data[o + 2]!;
        const k = data[o + 3]!;
        const total = c + m + y + k;
        if (total > maxBefore) maxBefore = total;
        if (total > limit255) {
          const cmy = c + m + y;
          const room = Math.max(0, limit255 - k);
          const f = cmy > 0 ? room / cmy : 0;
          data[o] = Math.round(c * f);
          data[o + 1] = Math.round(m * f);
          data[o + 2] = Math.round(y * f);
          clamped++;
        }
      }
      const maxBeforePct = (maxBefore / 255) * 100;
      if (maxBeforePct > maxInkCoverage) maxInkCoverage = maxBeforePct;
      if (clamped > 0.005 * px) {
        diagnostics.push({
          code: 'press.ink-limit',
          severity: 'info',
          message:
            `Image '${req.asset}': ${clamped} of ${px} pixels (` +
            `${((clamped / px) * 100).toFixed(1)}%) exceeded the ${inkLimit}% ink limit ` +
            `(max ${maxBeforePct.toFixed(0)}%) and were reduced (CMY scaled, K preserved)`,
          pageId: req.pageId,
          subject: req.asset,
          data: { clampedPixels: clamped, totalPixels: px, maxInk: Math.round(maxBeforePct), limit: inkLimit },
        });
      }

      ref = doc.context.register(
        doc.context.flateStream(new Uint8Array(data), {
          Type: 'XObject',
          Subtype: 'Image',
          Width: outW,
          Height: outH,
          ColorSpace: 'DeviceCMYK',
          BitsPerComponent: 8,
        }),
      );
    } else {
      const jpeg = await pipeline
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: 90, chromaSubsampling: '4:2:0' })
        .toBuffer();
      ref = doc.context.register(
        doc.context.stream(new Uint8Array(jpeg), {
          Type: 'XObject',
          Subtype: 'Image',
          Width: outW,
          Height: outH,
          ColorSpace: 'DeviceRGB',
          BitsPerComponent: 8,
          Filter: 'DCTDecode',
        }),
      );
    }

    // Re-verify effective resolution against actual embedded pixels.
    const effDpi = outW / (req.rect.w / 72);
    if (effDpi < targetDpi * 0.999) {
      diagnostics.push({
        code: 'image.lowres',
        severity: 'warning',
        message: `Image '${req.asset}' is ${Math.round(effDpi)} dpi at placed size (need ${targetDpi})`,
        pageId: req.pageId,
        frame: req.frame,
        subject: req.asset,
        data: { dpi: Math.round(effDpi), required: targetDpi },
      });
    }

    byKey.set(key, { resourceName: `Im${counter++}`, ref, widthPx: outW, heightPx: outH });
  }

  return { byKey, diagnostics, imagesEmbedded: byKey.size, maxInkCoverage };
}
