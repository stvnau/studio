/**
 * Press contract. writePdf() consumes a DocRender (the display list — it
 * adds no geometry except printer's marks in the slug area) and produces
 * either a PDF/X-4 CMYK press file or an RGB screen proof from the same
 * input. Preflight runs over source render + finished bytes.
 */

import type { CMYK, Diagnostic, DocRender, FontFace, FontSource } from '@guide/shared';

export interface PressImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Format of the stored original. */
  format: 'jpeg' | 'png';
}

export interface PressAssetStore {
  getImage(id: string): Promise<PressImage>;
}

export interface IccProfile {
  /** Shown in the OutputIntent ('Guide Studio Coated CMYK'). */
  name: string;
  bytes: Uint8Array;
}

export interface PressOptions {
  mode: 'press' | 'proof';
  title: string;
  icc: IccProfile;
  fonts: FontSource;
  faces: FontFace[];
  assets: PressAssetStore;
  /** Render the brand spot colour on its own Separation plate. */
  spot?: { name: string; alt: CMYK };
  inkLimit: number; // percent, e.g. 300
  /** Crop + registration marks and slug; always true for press. */
  marks: boolean;
  /** Effective-resolution floor for warnings. */
  targetDpi: number;
}

export interface PressResult {
  bytes: Uint8Array;
  preflight: Diagnostic[];
  /** Stats for the export report. */
  stats: {
    pages: number;
    fontsEmbedded: string[];
    imagesEmbedded: number;
    maxInkCoverage: number;
    pdfVersion: string;
  };
}

export type WritePdfFn = (render: DocRender, opts: PressOptions) => Promise<PressResult>;
