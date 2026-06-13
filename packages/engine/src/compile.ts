/**
 * compileEdition — the single producer of geometry in the system. It turns an
 * Edition + injected environment into one DocRender (the display list) plus a
 * frame index for the canvas. Every consumer (studio canvas, digital edition,
 * press writer, screen proof) only *paints* this output, which is what makes
 * what the user sees on screen identical to what prints.
 *
 * Data drives layout: editing the structure reflows pages automatically;
 * manual overrides are applied per frame and conflicts are surfaced, never
 * silently dropped.
 */

import {
  checkNumberingIntegrity,
  collectAssetUsage,
  collectFontUsage,
  numberedListings,
  type Diagnostic,
  type DocRender,
  type Edition,
  type FrameOverride,
  type HotelInfoBlock,
  type PageRender,
  type PageSpec,
} from '@guide/shared';
import { makeTheme, styleFontId, type GuideTheme } from './theme.js';
import { makeHyphenator } from './text/hyphen.js';
import { PageBuilder } from './builder.js';
import type { CompileEnv, CompileResult } from './types.js';
import type { TextEnv } from './text/types.js';
import {
  coverPage,
  backCoverPage,
  welcomePage,
  hotelInfoPage,
  dividerPage,
  keysPage,
} from './templates/pages.js';
import { paginateSection, drawListingBlocks, type PlacedListing } from './templates/listings.js';
import { resolveListing, folio, runningHead } from './templates/helpers.js';
import { buildMapEnv, drawMapNotice } from './templates/map.js';

interface PhysicalPage {
  pageId: string;
  side: 'left' | 'right';
  spreadWith?: string;
  draw: (b: PageBuilder) => void;
  /** Map pages are produced by carto, not a PageBuilder. */
  map?: { specId: string };
}

export async function compileEdition(edition: Edition, env: CompileEnv): Promise<CompileResult> {
  const faces = env.fonts.list();
  const theme = makeTheme(edition, faces);

  // Load every face the theme can call on, so shaping never blocks.
  await env.fonts.ensure(Object.values(theme.font));

  const textEnv: TextEnv = {
    fonts: env.fonts,
    hyphenate: makeHyphenator(),
    resolveFont: (sel) => styleFontId(theme, { font: sel }),
  };
  const overrides = new Map<string, FrameOverride>(edition.overrides.map((o) => [o.frame, o]));

  const diagnostics: Diagnostic[] = [];

  // Numbering integrity is a hard invariant — report any breach loudly.
  const integrity = checkNumberingIntegrity(edition);
  if (!integrity.ok) {
    diagnostics.push({
      code: 'numbering.integrity',
      severity: 'error',
      message: `Listing numbering is inconsistent (missing ${integrity.missing.length}, stale ${integrity.stale.length}, duplicate ${integrity.duplicates.length}).`,
    });
  }

  const sectionById = new Map(edition.sections.map((s, i) => [s.id, { section: s, index: i }]));
  const numbered = numberedListings(edition);
  const numberByListing = new Map(numbered.map((n) => [n.listing.id, n.number]));
  const renderedListings = new Set<string>();

  // ---- 1. expand page specs into physical pages ----
  const physical: PhysicalPage[] = [];
  let pageNo = 0;

  for (const spec of edition.pages) {
    pageNo++;
    switch (spec.kind) {
      case 'cover':
        physical.push({ pageId: spec.id, side: 'right', draw: (b) => coverPage(b, edition) });
        break;
      case 'back-cover':
        physical.push({ pageId: spec.id, side: 'left', draw: (b) => backCoverPage(b, edition) });
        break;
      case 'welcome': {
        const n = physical.length + 1;
        physical.push({ pageId: spec.id, side: 'right', draw: (b) => welcomePage(b, edition, n) });
        break;
      }
      case 'keys': {
        const n = physical.length + 1;
        physical.push({ pageId: spec.id, side: 'right', draw: (b) => keysPage(b, edition, n) });
        break;
      }
      case 'hotel-info': {
        const blocks = blocksFor(edition.hotel.infoBlocks, spec.blockIds);
        const n = physical.length + 1;
        physical.push({ pageId: spec.id, side: 'right', draw: (b) => hotelInfoPage(b, edition, blocks, n) });
        break;
      }
      case 'divider': {
        const sect = sectionById.get(spec.sectionId);
        if (!sect) break;
        const count = edition.listings.filter((l) => l.sectionId === spec.sectionId).length;
        physical.push({
          pageId: spec.id,
          side: 'right',
          draw: (b) => dividerPage(b, edition, sect.section, sect.index, count),
        });
        break;
      }
      case 'listings': {
        const items = listingsForSection(edition, env, spec.sectionId, numberByListing);
        const contentH = theme.geo.content('right').h;
        const pages = paginateSection(items, contentH);
        for (const blocks of pages) {
          for (const bl of blocks) if ('item' in bl) renderedListings.add(bl.item.r.id);
        }
        const sect = sectionById.get(spec.sectionId);
        pages.forEach((blocks, i) => {
          const pid = pages.length === 1 ? spec.id : `${spec.id}:p${i + 1}`;
          const n = physical.length + 1 + i;
          physical.push({
            pageId: pid,
            side: 'right',
            draw: (b) => {
              if (sect) runningHead(b, sect.section.title);
              drawListingBlocks(b, blocks, b.theme.geo.content(b.side));
              folio(b, n, edition.hotel.wordmark ?? edition.hotel.name);
            },
          });
        });
        break;
      }
      case 'map': {
        if (spec.spread) {
          physical.push({ pageId: `${spec.id}:L`, side: 'left', spreadWith: `${spec.id}:R`, draw: () => {}, map: { specId: spec.id } });
          physical.push({ pageId: `${spec.id}:R`, side: 'right', spreadWith: `${spec.id}:L`, draw: () => {}, map: { specId: spec.id } });
        } else {
          physical.push({ pageId: spec.id, side: 'right', draw: () => {}, map: { specId: spec.id } });
        }
        break;
      }
    }
  }

  // Assign binding sides by running parity (cover = recto/right), except map
  // spreads which are forced verso|recto so they read across the fold.
  assignSides(physical);

  // ---- 2. render each physical page ----
  const pages: PageRender[] = [];
  const frames: CompileResult['frames'] = {};

  // Map: collect the spec ids and compile once per map spec.
  const mapSpecs = new Set(physical.filter((p) => p.map).map((p) => p.map!.specId));
  const mapItemsByPage = new Map<string, PageRender['items']>();
  for (const specId of mapSpecs) {
    const mapPhys = physical.filter((p) => p.map?.specId === specId);
    const result = compileMapFor(edition, theme, env, mapPhys, overrides, diagnostics);
    for (const [pid, items] of result.perPage) mapItemsByPage.set(pid, items);
    Object.assign(frames, result.frames);
  }

  for (const p of physical) {
    if (p.map) {
      pages.push({
        pageId: p.pageId,
        trim: theme.geo.trim,
        bleed: theme.geo.bleed,
        side: p.side,
        spreadWith: p.spreadWith,
        items: mapItemsByPage.get(p.pageId) ?? [],
      });
      continue;
    }
    const b = new PageBuilder(p.pageId, p.side, theme, env.assets, textEnv, overrides);
    p.draw(b);
    for (const d of b.diagnostics) diagnostics.push(d);
    for (const [id, fr] of Object.entries(b.frames)) frames[id] = fr;
    pages.push({
      pageId: p.pageId,
      trim: theme.geo.trim,
      bleed: theme.geo.bleed,
      side: p.side,
      items: b.items,
    });
  }

  // ---- 3. cross-checks ----
  for (const { listing, number } of numbered) {
    if (!renderedListings.has(listing.id)) {
      const sect = sectionById.get(listing.sectionId);
      diagnostics.push({
        code: 'listing.unplaced',
        severity: 'warning',
        subject: listing.id,
        message: `Listing #${number} is not placed on any page${sect ? '' : ' (its section has no listings page)'}.`,
      });
    }
  }

  const render: DocRender = {
    editionId: edition.id,
    pages,
    fontsUsed: collectFontUsage(pages),
    assetsUsed: collectAssetUsage(pages),
    diagnostics,
  };
  return { ...render, frames };
}

/* ------------------------------------------------------------------ */

function blocksFor(all: HotelInfoBlock[], ids: string[]): HotelInfoBlock[] {
  const byId = new Map(all.map((b) => [b.id, b]));
  const picked = ids.map((id) => byId.get(id)).filter((b): b is HotelInfoBlock => !!b);
  return picked.length ? picked : all;
}

function listingsForSection(
  edition: Edition,
  env: CompileEnv,
  sectionId: string,
  numberByListing: Map<string, number>,
): PlacedListing[] {
  const out: PlacedListing[] = [];
  // Walk canonical order so page order matches numbering.
  for (const id of edition.listingOrder) {
    const listing = edition.listings.find((l) => l.id === id);
    if (!listing || listing.sectionId !== sectionId) continue;
    const biz = env.businesses.get(listing.businessId);
    out.push({
      number: numberByListing.get(listing.id) ?? 0,
      tier: listing.tier,
      r: resolveListing(listing, biz),
    });
  }
  return out;
}

/** Sides: parity from the cover, but map spreads forced to verso|recto. */
function assignSides(physical: PhysicalPage[]): void {
  let idx = 0;
  for (let i = 0; i < physical.length; i++) {
    const p = physical[i]!;
    if (p.spreadWith && p.pageId.endsWith(':L')) {
      // Start the spread on a verso (left). If parity says recto, burn a slot
      // so the spread aligns — acceptable for our short editions.
      p.side = 'left';
      const r = physical[i + 1];
      if (r) r.side = 'right';
      idx += 2;
      i++; // skip the paired right page
      continue;
    }
    p.side = idx % 2 === 0 ? 'right' : 'left';
    idx++;
  }
}

function compileMapFor(
  edition: Edition,
  theme: GuideTheme,
  env: CompileEnv,
  mapPhys: PhysicalPage[],
  overrides: ReadonlyMap<string, FrameOverride>,
  diagnostics: Diagnostic[],
): { perPage: Map<string, PageRender['items']>; frames: CompileResult['frames'] } {
  const perPage = new Map<string, PageRender['items']>();
  const frames: CompileResult['frames'] = {};

  if (!env.compileMap || !env.mapData || env.mapData.elements.length === 0) {
    diagnostics.push({
      code: 'map.data-empty',
      severity: env.compileMap ? 'warning' : 'info',
      pageId: mapPhys[0]?.pageId,
      message: 'No map data available; showing a placeholder.',
    });
    for (const p of mapPhys) {
      const b = new PageBuilder(p.pageId, p.side, theme, env.assets, {
        fonts: env.fonts,
        hyphenate: () => [],
        resolveFont: (sel) => styleFontId(theme, { font: sel }),
      }, overrides);
      drawMapNotice(b, 'Neighbourhood map');
      perPage.set(p.pageId, b.items);
      for (const [id, fr] of Object.entries(b.frames)) frames[id] = fr;
    }
    return { perPage, frames };
  }

  const mapEnv = buildMapEnv(
    edition,
    theme,
    env.fonts,
    env.businesses,
    mapPhys.map((p) => ({ pageId: p.pageId, side: p.side })),
    overrides,
  );
  const result = env.compileMap(env.mapData, mapEnv);
  for (const [pid, items] of Object.entries(result.perPage)) perPage.set(pid, items);
  for (const fr of result.frames) {
    frames[fr.frame] = { pageId: fr.pageId, rect: fr.rect, kind: fr.kind };
  }
  for (const d of result.diagnostics) diagnostics.push(d);
  return { perPage, frames };
}
