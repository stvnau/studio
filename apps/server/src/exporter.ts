/**
 * Export pipeline seam. The real press/proof/digital pipeline lives in
 * other packages; the server only knows this interface. createServer takes
 * an optional Exporter — without one, export requests answer 503.
 */

import type { Diagnostic, Edition } from '@guide/shared';

export type ExportKind = 'press' | 'proof' | 'digital';

export interface ExportResult {
  filename: string;
  bytes: Uint8Array;
  diagnostics: Diagnostic[];
  stats?: unknown;
}

export interface Exporter {
  run(
    edition: Edition,
    kind: ExportKind,
    onProgress?: (msg: string) => void,
  ): Promise<ExportResult>;
}
