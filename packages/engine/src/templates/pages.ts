/**
 * The non-listing page templates: cover, back cover, welcome, the redesigned
 * image-led hotel-info pages, section dividers, and the die-cut "Your Keys"
 * page. Each draws into a PageBuilder using the shared helpers and the theme.
 */

import {
  mm,
  rectPath,
  roundedRectPath,
  type Edition,
  type HotelInfoBlock,
  type Rect,
  type Section,
} from '@guide/shared';
import type { PageBuilder } from '../builder.js';
import { P, fullBleed, hairline, folio, panel } from './helpers.js';

/* ------------------------------------------------------------------ */
/* cover                                                               */
/* ------------------------------------------------------------------ */

export function coverPage(b: PageBuilder, ed: Edition): void {
  const t = b.theme;
  const o = t.geo.trimOrigin;
  const { w: tw, h: th } = t.geo.trim;
  fullBleed(b, t.colors.brandField);

  // Editorial inset frame.
  const inset = mm(9);
  b.add({
    t: 'path',
    d: rectPath({ x: o.x + inset, y: o.y + inset, w: tw - 2 * inset, h: th - 2 * inset }),
    stroke: { color: t.colors.paper, width: 0.6, alpha: 0.5 },
  });

  const cx = o.x + tw / 2;
  // Top mark.
  b.text(`cover:eyebrow`, { x: o.x, y: o.y + inset + 18, w: tw, h: 12 }, [
    P(t.styles.kicker, 'Pocket Guide', { color: t.colors.paper, align: 'center', tracking: 240 }),
  ]);

  // Wordmark, optically centred a little above middle.
  const mark = ed.hotel.wordmark ?? ed.hotel.name;
  b.text(
    `cover:wordmark`,
    { x: o.x + inset + 6, y: o.y + th * 0.34, w: tw - 2 * (inset + 6), h: th * 0.3 },
    [P(t.styles.display(34), mark, { color: t.colors.paper, align: 'center', leading: 36 })],
    { valign: 'center', copyfit: { minScale: 0.5, maxScale: 1 } },
  );

  // Double rule + tagline.
  const ry = o.y + th * 0.62;
  hairline(b, cx - 22, ry, 44, t.colors.paper, 0.8);
  if (ed.hotel.tagline) {
    b.text(`cover:tagline`, { x: o.x + inset + 10, y: ry + 12, w: tw - 2 * (inset + 10), h: 30 }, [
      P(t.styles.oneLiner, ed.hotel.tagline, { color: t.colors.paper, align: 'center', size: 9.5, leading: 13 }),
    ]);
  }

  // Foot: publisher + edition.
  b.text(`cover:publisher`, { x: o.x, y: o.y + th - inset - 26, w: tw, h: 12 }, [
    P(t.styles.folio, ed.settings.publisher ? `By ${ed.settings.publisher}` : '', {
      color: t.colors.paper,
      align: 'center',
    }),
  ]);
  b.text(`cover:edition`, { x: o.x, y: o.y + th - inset - 14, w: tw, h: 12 }, [
    P(t.styles.folio, ed.name, { color: t.colors.paper, align: 'center', tracking: 160 }),
  ]);
}

/* ------------------------------------------------------------------ */
/* back cover                                                          */
/* ------------------------------------------------------------------ */

export function backCoverPage(b: PageBuilder, ed: Edition): void {
  const t = b.theme;
  const o = t.geo.trimOrigin;
  const { page } = t.geo;
  const { w: tw, h: th } = t.geo.trim;

  // Full-bleed hero with a deepening scrim toward the foot.
  b.image(`back:hero`, ed.hotel.heroImageId, { x: 0, y: 0, w: page.w, h: page.h }, {
    scrim: 'bottom',
    scrimAlpha: 0.6,
  });

  const inset = mm(9);
  const footY = o.y + th - inset - 64;
  b.text(`back:wordmark`, { x: o.x + inset, y: footY, w: tw - 2 * inset, h: 30 }, [
    P(t.styles.display(20), ed.hotel.wordmark ?? ed.hotel.name, { color: t.colors.paper, leading: 22 }),
  ]);
  if (ed.hotel.url) {
    b.text(`back:url`, { x: o.x + inset, y: footY + 30, w: tw - 2 * inset - 56, h: 12 }, [
      P(t.styles.meta, ed.hotel.url.replace(/^https?:\/\//, ''), { color: t.colors.paper }),
    ]);
  }
  b.text(`back:by`, { x: o.x + inset, y: footY + 44, w: tw - 2 * inset - 56, h: 12 }, [
    P(t.styles.folio, ed.settings.publisher ? `By ${ed.settings.publisher}` : '', {
      color: t.colors.paper,
    }),
  ]);

  // QR to the digital edition.
  const qr = 50;
  b.qr(`back:qr`, ed.settings.digitalBaseUrl || ed.hotel.url || '', {
    x: o.x + tw - inset - qr,
    y: o.y + th - inset - qr,
    w: qr,
    h: qr,
  });
}

/* ------------------------------------------------------------------ */
/* welcome                                                             */
/* ------------------------------------------------------------------ */

export function welcomePage(b: PageBuilder, ed: Edition, pageNumber: number): void {
  const t = b.theme;
  const c = t.geo.content(b.side);
  const w = ed.hotel.welcome;
  let y = c.y;

  b.text(`welcome:kicker`, { x: c.x, y, w: c.w, h: 10 }, [P(t.styles.kicker, 'Welcome')]);
  y += 14;
  const head = b.text(`welcome:heading`, { x: c.x, y, w: c.w, h: 60 }, [
    P(t.styles.display(26), w.heading, { color: t.colors.ink, leading: 27 }),
  ]);
  y += (head?.used.h ?? 28) + 12;

  if (w.intro) {
    const intro = b.text(`welcome:intro`, { x: c.x, y, w: c.w, h: 110 }, [P(t.styles.intro, w.intro)], {
      copyfit: { minScale: 0.85, maxScale: 1 },
    });
    y += (intro?.used.h ?? 40) + 18;
  }

  // Stay Essentials table.
  if (ed.hotel.stayEssentials.length) {
    b.text(`welcome:essentials-kicker`, { x: c.x, y, w: c.w, h: 10 }, [
      P(t.styles.kicker, 'Stay Essentials', { color: t.colors.secondary }),
    ]);
    y += 13;
    hairline(b, c.x, y, c.w, t.colors.inkFaint, 0.5);
    y += 4;
    const labelW = c.w * 0.42;
    for (const [i, row] of ed.hotel.stayEssentials.entries()) {
      const rowH = 15;
      b.text(`welcome:ess:${i}:label`, { x: c.x, y: y + 2, w: labelW - 8, h: rowH }, [
        P(t.styles.tableLabel, row.label),
      ]);
      b.text(`welcome:ess:${i}:value`, { x: c.x + labelW, y: y + 1, w: c.w - labelW, h: rowH }, [
        P(t.styles.tableValue, row.value),
      ]);
      y += rowH;
      hairline(b, c.x, y, c.w, t.colors.inkFaint, 0.35);
    }
    y += 16;
  }

  // Guide intro + QR, anchored toward the foot so the page reads composed —
  // the airy space sits in the middle, not stranded at the bottom. A thin rule
  // marks the block.
  const qr = 56;
  const blockY = Math.max(y + 14, c.y + c.h - qr - 8);
  hairline(b, c.x, blockY - 12, c.w, t.colors.inkFaint, 0.5);
  if (w.guideIntro) {
    b.text(
      `welcome:guide-intro`,
      { x: c.x, y: blockY, w: c.w - qr - 18, h: qr },
      [P(t.styles.bodyRagged, w.guideIntro, { size: 8.8, leading: 12.5 })],
      { copyfit: { minScale: 0.8, maxScale: 1 }, valign: 'center' },
    );
  }
  b.qr(`welcome:qr`, ed.settings.digitalBaseUrl || ed.hotel.url || '', {
    x: c.x + c.w - qr,
    y: blockY,
    w: qr,
    h: qr,
  });

  folio(b, pageNumber, ed.hotel.wordmark ?? ed.hotel.name);
}

/* ------------------------------------------------------------------ */
/* hotel info — image-led editorial bands                              */
/* ------------------------------------------------------------------ */

export function hotelInfoPage(
  b: PageBuilder,
  ed: Edition,
  blocks: HotelInfoBlock[],
  pageNumber: number,
): void {
  const t = b.theme;
  const c = t.geo.content(b.side);

  b.text(`info:runhead:${b.pageId}`, { x: c.x, y: c.y - 13, w: c.w, h: 10 }, [
    P(t.styles.folio, 'The Hotel', { color: t.colors.secondary, align: b.side === 'right' ? 'left' : 'right' }),
  ]);
  hairline(b, c.x, c.y - 6, c.w, t.colors.inkFaint, 0.5);

  const n = Math.max(1, blocks.length);
  const gap = 18;
  const bandH = (c.h - gap * (n - 1)) / n;
  let y = c.y;
  let flip = false;
  for (const block of blocks) {
    drawInfoBand(b, { x: c.x, y, w: c.w, h: bandH }, block, flip);
    y += bandH + gap;
    flip = !flip;
  }

  folio(b, pageNumber, ed.hotel.wordmark ?? ed.hotel.name);
}

function drawInfoBand(b: PageBuilder, rect: Rect, block: HotelInfoBlock, flip: boolean): void {
  const t = b.theme;
  // A lone block on a page becomes a full feature: a tall hero image and a
  // larger, more generous body so the page reads composed, never top-heavy.
  // Stacked bands keep a calmer half-height image. The ratio scales with the
  // band so the image always fills its share (no fixed width cap).
  const feature = rect.h > 360;
  const imgH = rect.h * (feature ? 0.62 : 0.5);
  const imgRect: Rect = { x: rect.x, y: rect.y, w: rect.w, h: imgH };
  b.image(`info:${block.id}:image`, block.imageId, imgRect, { radius: 2, scrim: 'bottom', scrimAlpha: 0.34 });

  // Title sits over the foot of the image for an editorial, magazine feel.
  const titleSize = feature ? 22 : 17;
  b.text(`info:${block.id}:title`, { x: rect.x + 12, y: rect.y + imgH - titleSize - 12, w: rect.w - 24, h: titleSize + 8 }, [
    P(t.styles.display(titleSize), block.title, { color: t.colors.paper, leading: titleSize + 1 }),
  ]);

  let ty = rect.y + imgH + (feature ? 16 : 10);
  if (block.kicker) {
    b.text(`info:${block.id}:kicker`, { x: rect.x, y: ty, w: rect.w, h: 10 }, [
      P(t.styles.kicker, block.kicker, { color: t.colors.secondary }),
    ]);
    ty += feature ? 15 : 12;
  }
  b.text(
    `info:${block.id}:body`,
    { x: rect.x, y: ty, w: rect.w, h: rect.y + rect.h - ty },
    [P(t.styles.bodyRagged, block.body, feature ? { size: 9.6, leading: 14.5 } : {})],
    { copyfit: { minScale: 0.78, maxScale: 1 } },
  );
  // suppress unused warning for flip (kept for future alternating layouts)
  void flip;
}

/* ------------------------------------------------------------------ */
/* divider                                                             */
/* ------------------------------------------------------------------ */

export function dividerPage(b: PageBuilder, ed: Edition, section: Section, index: number, count: number): void {
  const t = b.theme;
  const o = t.geo.trimOrigin;
  const { w: tw, h: th } = t.geo.trim;
  fullBleed(b, t.colors.brandField);

  const inset = mm(9);
  const cx = o.x + tw / 2;

  // Big section numeral.
  b.text(`divider:${section.id}:num`, { x: o.x, y: o.y + th * 0.26, w: tw, h: 90 }, [
    P(t.styles.display(72), String(index + 1).padStart(2, '0'), {
      color: t.colors.paper,
      align: 'center',
    }),
  ]);

  // Title.
  b.text(
    `divider:${section.id}:title`,
    { x: o.x + inset, y: o.y + th * 0.5, w: tw - 2 * inset, h: th * 0.22 },
    [P(t.styles.display(30), section.title, { color: t.colors.paper, align: 'center', leading: 32 })],
    { valign: 'top', copyfit: { minScale: 0.6, maxScale: 1 } },
  );

  hairline(b, cx - 18, o.y + th * 0.5 - 16, 36, t.colors.paper, 0.8);

  b.text(`divider:${section.id}:count`, { x: o.x, y: o.y + th - inset - 24, w: tw, h: 12 }, [
    P(t.styles.kicker, `${count} ${count === 1 ? 'place' : 'places'}`, {
      color: t.colors.paper,
      align: 'center',
      tracking: 200,
    }),
  ]);
}

/* ------------------------------------------------------------------ */
/* your keys — die-cut holders                                         */
/* ------------------------------------------------------------------ */

export function keysPage(b: PageBuilder, ed: Edition, pageNumber: number): void {
  const t = b.theme;
  const c = t.geo.content(b.side);
  let y = c.y;

  b.text(`keys:kicker`, { x: c.x, y, w: c.w, h: 10 }, [P(t.styles.kicker, 'Your Stay')]);
  y += 14;
  const head = b.text(`keys:heading`, { x: c.x, y, w: c.w, h: 40 }, [
    P(t.styles.display(26), 'Your Keys', { color: t.colors.ink, leading: 27 }),
  ]);
  y += (head?.used.h ?? 28) + 10;

  if (ed.hotel.keysNote) {
    const note = b.text(`keys:note`, { x: c.x, y, w: c.w, h: 60 }, [
      P(t.styles.intro, ed.hotel.keysNote, { size: 9.5, leading: 14 }),
    ], { copyfit: { minScale: 0.85, maxScale: 1 } });
    y += (note?.used.h ?? 28) + 20;
  }

  // Two keycard holders — die-cut slots carrying the hotel mark, sized to fill
  // the space below the note and centred so the page reads composed.
  const holders = 2;
  const slotGap = 22;
  const availH = c.y + c.h - 18 - y;
  const slotH = Math.max(58, Math.min(118, (availH - slotGap * (holders - 1)) / holders));
  const blockH = slotH * holders + slotGap * (holders - 1);
  const startY = y + Math.max(0, (availH - blockH) / 2);
  for (let i = 0; i < holders; i++) {
    const sy = startY + i * (slotH + slotGap);
    const slot: Rect = { x: c.x, y: sy, w: c.w, h: slotH };
    // Holder field.
    panel(b, slot, t.colors.wash, 4);
    // Die-cut line for the card pocket (dashed = cut/score guidance). Leaves a
    // clear strip at the foot for the room-key label.
    const cut: Rect = { x: slot.x + 10, y: slot.y + 11, w: slot.w - 20, h: slotH - 32 };
    b.add({
      t: 'path',
      d: roundedRectPath(cut, 3),
      stroke: { color: t.colors.tier.full, width: 0.7, dash: [3, 2] },
    });
    // Card mouth — the slit the key card slides through.
    hairline(b, cut.x + cut.w * 0.18, cut.y + 6, cut.w * 0.64, t.colors.inkSoft, 1.1);
    // Hotel mark on the holder.
    b.text(`keys:mark:${i}`, { x: cut.x, y: cut.y + cut.h / 2 + 1, w: cut.w, h: 16 }, [
      P(t.styles.display(13), ed.hotel.wordmark ?? ed.hotel.name, { color: t.colors.tier.full, align: 'center' }),
    ]);
    b.text(`keys:label:${i}`, { x: cut.x, y: slot.y + slotH - 13, w: cut.w, h: 11 }, [
      P(t.styles.folio, `Room key ${i + 1}`, { align: 'center', color: t.colors.inkSoft }),
    ]);
  }

  folio(b, pageNumber, ed.hotel.wordmark ?? ed.hotel.name);
}
