/**
 * Listing layouts — the four size tiers, plus the pagination that flows a
 * section's listings across as many pages as it needs. Assigning a tier
 * instantly yields the right layout; every block is bound to a stable frame
 * id (`listing:<id>:*`) so manual canvas tweaks survive reflow.
 */

import type { Rect, Tier } from '@guide/shared';
import type { GuideTheme } from '../theme.js';
import type { PageBuilder } from '../builder.js';
import { P, hairline, numberBadge, socialsLine, type ResolvedListing } from './helpers.js';

export interface PlacedListing {
  number: number;
  tier: Tier;
  r: ResolvedListing;
}

const GAP = 18;

/* ------------------------------------------------------------------ */
/* block heights (for pagination)                                      */
/* ------------------------------------------------------------------ */

export function listHeaderHeight(): number {
  return 24;
}
export function listRowHeight(): number {
  return 21;
}

export function blockHeight(tier: Tier, contentH: number): number {
  switch (tier) {
    case 'full':
      return contentH;
    case 'half':
      return (contentH - GAP) / 2;
    case 'quarter':
      return contentH * 0.235;
    case 'list':
      return listRowHeight();
  }
}

/* ------------------------------------------------------------------ */
/* pagination                                                          */
/* ------------------------------------------------------------------ */

export type Block =
  | { kind: 'full' | 'half' | 'quarter'; item: PlacedListing; h: number }
  | { kind: 'list-header'; h: number }
  | { kind: 'list-row'; item: PlacedListing; h: number };

/** Split a section's listings (already in canonical order) into pages of blocks. */
export function paginateSection(items: PlacedListing[], contentH: number): Block[][] {
  const pages: Block[][] = [];
  let page: Block[] = [];
  let used = 0;
  let inListRun = false;

  const flush = () => {
    if (page.length) pages.push(page);
    page = [];
    used = 0;
    inListRun = false;
  };
  const fits = (h: number) => used + (page.length ? GAP : 0) + h <= contentH + 0.5;
  const place = (block: Block) => {
    used += (page.length ? GAP : 0) + block.h;
    page.push(block);
  };

  for (const item of items) {
    if (item.tier === 'full') {
      flush();
      pages.push([{ kind: 'full', item, h: contentH }]);
      continue;
    }
    if (item.tier === 'list') {
      // Open a list run with a header; keep the header with its first row.
      if (!inListRun) {
        const need = listHeaderHeight() + listRowHeight();
        if (!fits(need)) flush();
        place({ kind: 'list-header', h: listHeaderHeight() });
        inListRun = true;
      } else if (!fits(listRowHeight())) {
        flush();
        place({ kind: 'list-header', h: listHeaderHeight() });
        inListRun = true;
      }
      place({ kind: 'list-row', item, h: listRowHeight() });
      continue;
    }
    // half / quarter
    const h = blockHeight(item.tier, contentH);
    if (!fits(h)) flush();
    inListRun = false;
    place({ kind: item.tier, item, h } as Block);
  }
  flush();
  return pages;
}

/** Lay a page's blocks top to bottom, distributing slack as breathing room. */
export function drawListingBlocks(b: PageBuilder, blocks: Block[], content: Rect): void {
  const totalH = blocks.reduce((s, bl) => s + bl.h, 0);
  const gaps = Math.max(0, blocks.length - 1);
  const slack = Math.max(0, content.h - totalH - gaps * GAP);
  const extra = gaps > 0 ? Math.min(slack / gaps, GAP * 1.6) : 0;

  let y = content.y;
  blocks.forEach((bl) => {
    const rect: Rect = { x: content.x, y, w: content.w, h: bl.h };
    switch (bl.kind) {
      case 'full':
        drawFull(b, rect, bl.item);
        break;
      case 'half':
        drawHalf(b, rect, bl.item);
        break;
      case 'quarter':
        drawQuarter(b, rect, bl.item);
        break;
      case 'list-header':
        drawListHeader(b, rect);
        break;
      case 'list-row':
        drawListRow(b, rect, bl.item);
        break;
    }
    y += bl.h + GAP + extra;
  });
}

/* ------------------------------------------------------------------ */
/* tier renderers                                                      */
/* ------------------------------------------------------------------ */

function drawFull(b: PageBuilder, rect: Rect, it: PlacedListing): void {
  const t = b.theme;
  const id = it.r.id;
  const imageH = rect.h * 0.5;
  b.image(`listing:${id}:image`, it.r.imageId, { x: rect.x, y: rect.y, w: rect.w, h: imageH }, {
    radius: 2,
  });
  numberBadge(b, rect.x + 17, rect.y + 17, 11, it.number, it.tier, { onField: true });

  const footerH = 50;
  const footerY = rect.y + rect.h - footerH;
  let ty = rect.y + imageH + 16;

  if (it.r.category) {
    b.text(`listing:${id}:kicker`, { x: rect.x, y: ty, w: rect.w, h: 10 }, [
      P(t.styles.kicker, it.r.category),
    ]);
    ty += 12;
  }
  const name = b.text(`listing:${id}:name`, { x: rect.x, y: ty, w: rect.w, h: 44 }, [
    P(t.styles.nameFull, it.r.name),
  ]);
  ty += (name?.used.h ?? 20) + 6;
  if (it.r.oneLiner) {
    const ol = b.text(`listing:${id}:oneliner`, { x: rect.x, y: ty, w: rect.w, h: 24 }, [
      P(t.styles.oneLiner, it.r.oneLiner, { size: 10, leading: 13 }),
    ], { copyfit: { minScale: 0.72, maxScale: 1 } });
    ty += (ol?.used.h ?? 12) + 8;
  }
  // Description fills the gap above the footer; copyfit guards against overset.
  b.text(
    `listing:${id}:desc`,
    { x: rect.x, y: ty, w: rect.w, h: footerY - ty - 10 },
    [P(t.styles.body, it.r.description)],
    { copyfit: { minScale: 0.82, maxScale: 1 } },
  );

  // Footer: address + socials on the inner edge, QR chip on the outer.
  hairline(b, rect.x, footerY, rect.w, t.colors.inkFaint, 0.5);
  const qrSize = 46;
  b.qr(`listing:${id}:qr`, it.r.qrTarget ?? '', {
    x: rect.x + rect.w - qrSize,
    y: footerY + 4,
    w: qrSize,
    h: qrSize,
  });
  b.text(`listing:${id}:addr`, { x: rect.x, y: footerY + 6, w: rect.w - qrSize - 12, h: 14 }, [
    P(t.styles.meta, it.r.address),
  ]);
  const socials = socialsLine(it.r);
  if (socials) {
    b.text(`listing:${id}:socials`, { x: rect.x, y: footerY + 22, w: rect.w - qrSize - 12, h: 14 }, [
      P(t.styles.meta, socials, { tracking: 20, color: t.colors.secondary }),
    ]);
  }
}

function drawHalf(b: PageBuilder, rect: Rect, it: PlacedListing): void {
  const t = b.theme;
  const id = it.r.id;
  // Image-led, content underneath — consistent with the full and hotel-info
  // layouts: a full-width image on top, then the copy below it.
  const imgH = rect.h * 0.5;
  b.image(`listing:${id}:image`, it.r.imageId, { x: rect.x, y: rect.y, w: rect.w, h: imgH }, {
    radius: 2,
  });
  numberBadge(b, rect.x + 15, rect.y + 15, 9.5, it.number, it.tier, { onField: true });

  let ty = rect.y + imgH + 11;
  if (it.r.category) {
    b.text(`listing:${id}:kicker`, { x: rect.x, y: ty, w: rect.w, h: 10 }, [P(t.styles.kicker, it.r.category)]);
    ty += 12;
  }
  const name = b.text(`listing:${id}:name`, { x: rect.x, y: ty, w: rect.w, h: 24 }, [
    P(t.styles.nameHalf, it.r.name, { size: 13, leading: 15 }),
  ]);
  ty += (name?.used.h ?? 15) + 5;
  if (it.r.oneLiner) {
    const ol = b.text(`listing:${id}:oneliner`, { x: rect.x, y: ty, w: rect.w, h: 22 }, [
      P(t.styles.oneLiner, it.r.oneLiner, { size: 9, leading: 12 }),
    ], { copyfit: { minScale: 0.72, maxScale: 1 } });
    ty += (ol?.used.h ?? 11) + 7;
  }
  const addrY = rect.y + rect.h - 11;
  b.text(
    `listing:${id}:desc`,
    { x: rect.x, y: ty, w: rect.w, h: addrY - ty - 4 },
    [P(t.styles.bodyRagged, it.r.description)],
    { copyfit: { minScale: 0.78, maxScale: 1 } },
  );
  b.text(`listing:${id}:addr`, { x: rect.x, y: addrY, w: rect.w, h: 12 }, [
    P(t.styles.meta, [it.r.address, it.r.suburb].filter(Boolean).join(' · ')),
  ]);
}

function drawQuarter(b: PageBuilder, rect: Rect, it: PlacedListing): void {
  const t = b.theme;
  const id = it.r.id;
  const side = rect.h - 6;
  b.image(`listing:${id}:image`, it.r.imageId, { x: rect.x, y: rect.y, w: side, h: side }, {
    radius: 2,
  });
  numberBadge(b, rect.x + 13, rect.y + 13, 8.5, it.number, it.tier, { onField: true });

  const tx = rect.x + side + 14;
  const tw = rect.w - side - 14;
  let ty = rect.y + 1;
  const name = b.text(`listing:${id}:name`, { x: tx, y: ty, w: tw, h: 24 }, [
    P(t.styles.nameQuarter, it.r.name),
  ]);
  ty += (name?.used.h ?? 11) + 4;
  if (it.r.oneLiner) {
    const ol = b.text(`listing:${id}:oneliner`, { x: tx, y: ty, w: tw, h: 26 }, [
      P(t.styles.oneLiner, it.r.oneLiner, { size: 8, leading: 10.5 }),
    ], { copyfit: { minScale: 0.72, maxScale: 1 } });
    ty += (ol?.used.h ?? 10) + 4;
  }
  b.text(`listing:${id}:addr`, { x: tx, y: rect.y + side - 9, w: tw, h: 11 }, [
    P(t.styles.meta, [it.r.address, it.r.suburb].filter(Boolean).join(' · ')),
  ]);
}

function drawListHeader(b: PageBuilder, rect: Rect): void {
  const t = b.theme;
  b.text(`listhdr:${b.pageId}:${rect.y.toFixed(0)}`, { x: rect.x, y: rect.y + 2, w: rect.w, h: 12 }, [
    P(t.styles.kicker, 'Counter Picks', { color: t.colors.tier.list }),
  ]);
  hairline(b, rect.x, rect.y + 17, rect.w, t.colors.inkFaint, 0.5);
}

function drawListRow(b: PageBuilder, rect: Rect, it: PlacedListing): void {
  const t = b.theme;
  const id = it.r.id;
  // Number figure (tabular, tier colour) in a fixed gutter.
  b.text(`listing:${id}:num`, { x: rect.x, y: rect.y + 2, w: 18, h: 14 }, [
    P(t.styles.meta, String(it.number), {
      caps: false,
      tracking: 0,
      size: 9,
      color: t.colors.tier.list,
      features: { tnum: true },
    }),
  ]);
  const tx = rect.x + 20;
  const addrW = rect.w * 0.32;
  const mainW = rect.w - 20 - addrW - 10;
  // Name · one-liner on the main column.
  b.text(`listing:${id}:name`, { x: tx, y: rect.y, w: mainW, h: 14 }, [
    {
      spans: [
        { text: it.r.name, style: { font: { role: 'text' as const, weight: 600 }, color: t.colors.ink } },
        ...(it.r.oneLiner
          ? [{ text: '  ' + it.r.oneLiner, style: { font: { role: 'text' as const, weight: 400, italic: true }, color: t.colors.inkSoft } }]
          : []),
      ],
      style: { ...t.styles.tableValue, size: 8.6, leading: 11 },
    },
  ]);
  b.text(`listing:${id}:addr`, { x: rect.x + rect.w - addrW, y: rect.y + 1, w: addrW, h: 12 }, [
    P(t.styles.meta, it.r.suburb || it.r.address, { align: 'right', size: 5.8 }),
  ]);
  hairline(b, rect.x, rect.y + rect.h - 4, rect.w, t.colors.inkFaint, 0.35);
}
