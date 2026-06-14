/**
 * Template helpers — the shared vocabulary every page draws with: paragraph
 * builders over the theme styles, hairlines, kickers, folios, running heads,
 * numbered badges (the same number that appears on the map pin and legend),
 * and the resolved copy for a listing. Templates compose these; they never
 * reach for raw colours or font ids.
 */

import {
  circlePath,
  rectPath,
  roundedRectPath,
  type Business,
  type Color,
  type Listing,
  type ParagraphContent,
  type ParagraphStyle,
  type Rect,
  type Tier,
} from '@guide/shared';
import type { GuideTheme } from '../theme.js';
import type { PageBuilder } from '../builder.js';

/** One-span paragraph from a theme style, with optional inline overrides. */
export function P(
  style: ParagraphStyle,
  text: string,
  over?: Partial<ParagraphStyle>,
): ParagraphContent {
  return { spans: [{ text }], style: over ? { ...style, ...over } : style };
}

/** Fill the entire bleed box with a solid colour (covers/dividers). */
export function fullBleed(b: PageBuilder, color: Color): void {
  const { page } = b.theme.geo;
  b.add({ t: 'path', d: rectPath({ x: 0, y: 0, w: page.w, h: page.h }), fill: { color } });
}

/** A hairline rule. */
export function hairline(
  b: PageBuilder,
  x: number,
  y: number,
  w: number,
  color: Color,
  weight = 0.6,
): void {
  b.add({
    t: 'path',
    d: [
      ['M', x, y],
      ['L', x + w, y],
    ],
    stroke: { color, width: weight },
  });
}

/** A filled rectangle (panel/field). */
export function panel(b: PageBuilder, rect: Rect, color: Color, radius = 0): void {
  b.add({
    t: 'path',
    d: radius > 0 ? roundedRectPath(rect, radius) : rectPath(rect),
    fill: { color },
  });
}

/**
 * The canonical number badge — a tinted disc with the listing's number, in
 * the tier colour. This is the single visual form of the number; the map pin
 * and legend reuse the very same value, never a parallel count.
 */
export function numberBadge(
  b: PageBuilder,
  cx: number,
  cy: number,
  r: number,
  n: number,
  tier: Tier,
  opts: { onField?: boolean } = {},
): void {
  const t = b.theme;
  const fill = opts.onField ? t.colors.paper : t.colors.tier[tier];
  const fg = opts.onField ? t.colors.tier[tier] : t.colors.paper;
  b.add({ t: 'path', d: circlePath(cx, cy, r), fill: { color: fill } });
  // Number centred in the disc, tabular figures.
  b.text(
    `badge:${b.pageId}:${cx.toFixed(1)}:${cy.toFixed(1)}`,
    { x: cx - r, y: cy - r, w: r * 2, h: r * 2 },
    [P(t.styles.meta, String(n), { color: fg, caps: false, tracking: 0, align: 'center', size: r * 1.05, leading: r * 2, features: { tnum: true } })],
    { valign: 'center' },
  );
}

/**
 * Page furniture bands, reserved INSIDE the content box (i.e. within the page
 * margins) so the running head and folio never sit in the margin / off the
 * safe area. Body layout subtracts these from the content rect.
 */
export const HEAD_BAND = 16; // pt at the content top for a running head
export const FOLIO_BAND = 13; // pt at the content bottom for the page number

/** The body rect available to a template, after reserving furniture bands. */
export function bodyRect(b: PageBuilder, opts: { head?: boolean; folio?: boolean } = {}): Rect {
  const c = b.theme.geo.content(b.side);
  const top = opts.head ? HEAD_BAND : 0;
  const bottom = opts.folio ? FOLIO_BAND : 0;
  return { x: c.x, y: c.y + top, w: c.w, h: c.h - top - bottom };
}

/** Running head: section title at the top of the content box, with a hairline. */
export function runningHead(b: PageBuilder, label: string): void {
  const t = b.theme;
  const c = t.geo.content(b.side);
  b.text(
    `runhead:${b.pageId}`,
    { x: c.x, y: c.y, w: c.w, h: 11 },
    [P(t.styles.folio, label, { color: t.colors.secondary, align: b.side === 'right' ? 'left' : 'right' })],
    { valign: 'top' },
  );
  hairline(b, c.x, c.y + HEAD_BAND - 6, c.w, t.colors.inkFaint, 0.5);
}

/** Folio at the foot, inside the content box: page number outer, wordmark inner. */
export function folio(b: PageBuilder, pageNumber: number, wordmark: string): void {
  const t = b.theme;
  const c = t.geo.content(b.side);
  const yy = c.y + c.h - FOLIO_BAND;
  const numAlign = b.side === 'right' ? 'right' : 'left';
  const markAlign = b.side === 'right' ? 'left' : 'right';
  b.text(
    `folio:${b.pageId}`,
    { x: c.x, y: yy, w: c.w, h: FOLIO_BAND },
    [P(t.styles.folio, String(pageNumber), { align: numAlign })],
    { valign: 'center' },
  );
  b.text(
    `folio-mark:${b.pageId}`,
    { x: c.x, y: yy, w: c.w, h: FOLIO_BAND },
    [P(t.styles.folio, wordmark, { align: markAlign, color: t.colors.inkFaint })],
    { valign: 'center' },
  );
}

/** Resolve a listing's effective copy: per-edition overrides win over the record. */
export interface ResolvedListing {
  id: string;
  name: string;
  category: string;
  oneLiner: string;
  description: string;
  address: string;
  suburb: string;
  website?: string;
  instagram?: string;
  phone?: string;
  imageId?: string;
  qrTarget?: string;
  lat: number;
  lng: number;
}

export function resolveListing(listing: Listing, biz: Business | undefined): ResolvedListing {
  return {
    id: listing.id,
    name: listing.copy?.name ?? biz?.name ?? 'Untitled',
    category: biz?.category ?? '',
    oneLiner: listing.copy?.oneLiner ?? biz?.oneLiner ?? '',
    description: listing.copy?.description ?? biz?.description ?? '',
    address: biz?.address ?? '',
    suburb: biz?.suburb ?? '',
    website: biz?.website,
    instagram: biz?.instagram,
    phone: biz?.phone,
    imageId: listing.imageId ?? biz?.images?.[0],
    qrTarget: biz?.qrTarget ?? biz?.website,
    lat: biz?.lat ?? 0,
    lng: biz?.lng ?? 0,
  };
}

/** A compact "socials" string from website/instagram/phone. */
export function socialsLine(r: ResolvedListing): string {
  const parts: string[] = [];
  if (r.website) parts.push(r.website.replace(/^https?:\/\//, '').replace(/\/$/, ''));
  if (r.instagram) parts.push('@' + r.instagram.replace(/^@/, ''));
  if (r.phone) parts.push(r.phone);
  return parts.join('   ·   ');
}
