/**
 * QR generation as vector geometry. We emit the module matrix as a single
 * PathSpec in a 0..1 unit square (origin top-left, y down). The PageBuilder
 * scales it into the destination chip, so the same path prints crisp at any
 * size — it is true vector art in the press PDF, never a rasterised image.
 */

import QRCode from 'qrcode';
import { rectPath, type PathSpec } from '@guide/shared';

export interface QrArt {
  /** Filled modules as a unit-square path (0..1). */
  path: PathSpec;
  /** Module count per side (the QR "size"). */
  modules: number;
}

const cache = new Map<string, QrArt>();

/**
 * Build vector QR art for `target`. Error-correction level M balances
 * density against a comfortable scan margin at pocket-guide sizes. Modules
 * are merged into horizontal runs so the path stays compact.
 */
export function makeQrPath(target: string): QrArt {
  const key = target || ' ';
  const hit = cache.get(key);
  if (hit) return hit;

  const qr = QRCode.create(key, { errorCorrectionLevel: 'M' });
  const m = qr.modules;
  const n = m.size;
  const u = 1 / n;
  const path: PathSpec = [];

  for (let y = 0; y < n; y++) {
    let runStart = -1;
    for (let x = 0; x <= n; x++) {
      const on = x < n && m.get(x, y) === 1;
      if (on && runStart < 0) {
        runStart = x;
      } else if (!on && runStart >= 0) {
        // Emit one rectangle for the horizontal run [runStart, x).
        path.push(...rectPath({ x: runStart * u, y: y * u, w: (x - runStart) * u, h: u }));
        runStart = -1;
      }
    }
  }

  const art: QrArt = { path, modules: n };
  cache.set(key, art);
  return art;
}
