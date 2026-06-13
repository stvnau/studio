/**
 * Typographic style types. Concrete style sheets (the guide theme) live in
 * @guide/engine; these are the shapes shared by engine, inspector UI and
 * digital edition.
 */

import type { Color } from './color.js';

/** Font roles a theme maps to concrete font ids per weight. */
export type FontRole = 'display' | 'text' | 'sans' | 'mono';

export interface FontSelection {
  role: FontRole;
  weight: number; // 100..900
  italic?: boolean;
}

export interface OpenTypeFeatures {
  liga?: boolean;
  dlig?: boolean;
  smcp?: boolean;
  onum?: boolean; // old-style figures
  tnum?: boolean; // tabular figures
  case?: boolean;
  ss01?: boolean;
}

export interface CharacterStyle {
  font: FontSelection;
  size: number; // pt
  tracking?: number; // 1/1000 em
  color?: Color;
  features?: OpenTypeFeatures;
  /** All-caps transform applied before shaping. */
  caps?: boolean;
}

export interface ParagraphStyle extends CharacterStyle {
  leading: number; // pt baseline-to-baseline
  align: 'left' | 'center' | 'right' | 'justify';
  spaceBefore?: number;
  spaceAfter?: number;
  indent?: number;
  hyphenate?: boolean;
  /** Snap baselines to the edition baseline grid. */
  snapToGrid?: boolean;
  /** Minimum lines kept together at frame top/bottom (orphan/widow control). */
  keepFirst?: number;
  keepLast?: number;
  /** Disallow a final line consisting of a single word. */
  noRunts?: boolean;
}

export interface CopyfitSpec {
  /** Engine may scale size+leading down to this fraction to fit the frame. */
  minScale: number;
  /** And up to this fraction (display frames may grow into space). */
  maxScale: number;
}

/** Inline rich content: a paragraph is a list of styled spans. */
export interface InlineSpan {
  text: string;
  /** Overrides applied over the paragraph's character style. */
  style?: Partial<CharacterStyle>;
}

export interface ParagraphContent {
  spans: InlineSpan[];
  style: ParagraphStyle;
}
