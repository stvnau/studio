/**
 * Typesetting contract. Templates build TextFrameSpecs; the typesetter
 * (text/typeset.ts) turns them into positioned glyph runs with real H&J,
 * baseline-grid snapping, widow/orphan control and copyfit — and reports
 * overset honestly instead of clipping.
 */

import type {
  Color,
  CopyfitSpec,
  Diagnostic,
  DLItem,
  FontSelection,
  ParagraphContent,
  Rect,
} from '@guide/shared';
import type { FontManager } from '../fonts.js';

export interface TextEnv {
  fonts: FontManager;
  /** Splits a word into hyphenatable parts ('waffle' -> ['waf','fle']). */
  hyphenate: (word: string) => string[];
  /** Resolves a role/weight/italic selection to a concrete loaded font id. */
  resolveFont: (sel: FontSelection) => string;
}

export interface TextFrameSpec {
  /** Stable frame id (drives overrides + hit-testing). */
  id: string;
  rect: Rect;
  paragraphs: ParagraphContent[];
  valign?: 'top' | 'center' | 'bottom';
  /** When set, the typesetter scales type to fit the frame within bounds. */
  copyfit?: CopyfitSpec;
  columns?: number;
  columnGap?: number;
  /**
   * Baseline grid pitch in pt (page-level). Paragraph styles opt in via
   * snapToGrid; the grid origin is the top of the frame's page trim box.
   */
  baselineGrid?: number;
  /** Page-space y of the trim top, so grid snapping aligns across frames. */
  gridOrigin?: number;
}

export interface LineInfo {
  baselineY: number; // page space
  x: number;
  width: number;
  text: string;
}

export interface TypesetResult {
  /** Fully positioned text item (page space), ready for the display list. */
  item: Extract<DLItem, { t: 'text' }>;
  /** Actual ink bounds used. */
  used: Rect;
  /** True when not all text fit. The caller MUST surface the diagnostic. */
  overset: boolean;
  /** The text that did not fit, for the diagnostic message. */
  oversetText?: string;
  lines: LineInfo[];
  /** Copyfit scale that was applied (1 = none). */
  scale: number;
  diagnostics: Diagnostic[];
}

export interface MeasuredText {
  width: number;
  ascent: number; // pt
  descent: number; // pt, positive
}

/**
 * Convenience for single-line labels (map labels, folios, pins). Shapes,
 * tracks and positions one line; never wraps; reports its measured box.
 */
export interface LabelSpec {
  text: string;
  font: string; // FontId
  size: number;
  color: Color;
  letterSpacing?: number;
  caps?: boolean;
  features?: Record<string, boolean>;
}
