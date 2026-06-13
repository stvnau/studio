/**
 * Structured validation. Everything the system would otherwise fail at
 * silently is surfaced as a Diagnostic: from data (missing image), from
 * layout (overset text, widow), from cartography (label dropped), from
 * prepress (ink limit). The studio shows these live; export blocks on
 * `error` severity and requires acknowledgement for `warning`.
 */

export type Severity = 'error' | 'warning' | 'info';

export type DiagnosticCode =
  // content / data
  | 'image.missing'
  | 'image.lowres'
  | 'listing.unplaced'
  | 'numbering.integrity'
  // typesetting
  | 'text.overset'
  | 'text.widow'
  | 'text.orphan'
  | 'text.copyfit'
  | 'text.missing-glyph'
  // cartography
  | 'map.label-dropped'
  | 'map.label-moved'
  | 'map.pin-nudged'
  | 'map.pin-leader'
  | 'map.pin-outside'
  | 'map.attribution'
  | 'map.data-empty'
  // overrides
  | 'override.conflict'
  | 'override.orphaned'
  // prepress
  | 'press.ink-limit'
  | 'press.font-embed'
  | 'press.image-colorspace'
  | 'press.bleed-short'
  | 'press.icc-missing'
  | 'press.spot-unused';

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  /** Page id where this occurs, when page-specific. */
  pageId?: string;
  /** Frame id, when frame-specific (lets the UI focus the canvas). */
  frame?: string;
  /** Listing / business / asset id involved. */
  subject?: string;
  /** Machine-readable extras (e.g. { dpi: 184, required: 300 }). */
  data?: Record<string, string | number | boolean>;
}

export function worstSeverity(diags: Diagnostic[]): Severity | null {
  if (diags.some((d) => d.severity === 'error')) return 'error';
  if (diags.some((d) => d.severity === 'warning')) return 'warning';
  if (diags.length > 0) return 'info';
  return null;
}
