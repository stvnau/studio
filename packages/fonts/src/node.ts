/** Server-side font source: resolves catalog entries to files on disk. */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { FontFace, FontSource } from '@guide/shared';
import { FACE_BY_ID, FONT_FACES } from './index.js';

const require = createRequire(import.meta.url);

export function resolveFontFile(face: FontFace): string {
  return require.resolve(face.file);
}

export class NodeFontSource implements FontSource {
  async getBytes(fontId: string): Promise<Uint8Array> {
    const face = FACE_BY_ID.get(fontId);
    if (!face) throw new Error(`Unknown font id: ${fontId}`);
    return new Uint8Array(await readFile(resolveFontFile(face)));
  }

  list(): FontFace[] {
    return FONT_FACES;
  }
}
