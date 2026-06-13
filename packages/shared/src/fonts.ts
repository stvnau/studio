/**
 * Font identity. A FontId names one physical font file (family + weight +
 * style). The catalog maps ids to files on the server; the studio fetches
 * bytes over the API so browser and press always shape with identical
 * binaries.
 */

export interface FontFace {
  id: string; // 'fraunces-600'
  family: string; // 'Fraunces'
  weight: number;
  italic: boolean;
  /** package-relative path, resolved by @guide/fonts on the server */
  file: string;
  license: string; // 'OFL-1.1'
}

export interface FontSource {
  /** Returns the raw TTF/OTF bytes for a font id. */
  getBytes(fontId: string): Promise<Uint8Array>;
  list(): FontFace[];
}
