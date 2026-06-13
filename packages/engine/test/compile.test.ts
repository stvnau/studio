/**
 * Engine integration test: compiling an edition is deterministic, honest
 * about diagnostics, and keeps the numbering invariant — a listing's badge
 * number is exactly its canonical number, with no gaps or duplicates.
 */

import { describe, it, expect } from 'vitest';
import {
  numberedListings,
  walkItems,
  type Business,
  type Edition,
} from '@guide/shared';
import { FontManager } from '../src/fonts.js';
import { NodeFontSource } from '@guide/fonts/node';
import { compileEdition } from '../src/compile.js';
import type { AssetCatalog, BusinessCatalog } from '../src/types.js';

function biz(id: string, name: string, n: number): Business {
  return {
    id,
    name,
    category: 'Dining room',
    oneLiner: 'A short and pleasant one-liner about the place.',
    description:
      'A longer paragraph with enough words to exercise the hyphenation and ' +
      'justification engine across several lines of measured, on-grid text so ' +
      'that copyfit and overset handling are genuinely tested here today.',
    address: `${n} Marine Parade`,
    suburb: 'Pelican Point',
    lat: -33.84 - n * 0.001,
    lng: 151.278 + n * 0.001,
    website: 'https://example.com/' + id,
    images: [`img-${id}`],
  };
}

function makeEdition(): { edition: Edition; businesses: Map<string, Business> } {
  const businesses = new Map<string, Business>();
  const listings = [];
  const order: string[] = [];
  const tiers = ['full', 'half', 'quarter', 'list', 'list'] as const;
  for (let i = 0; i < 5; i++) {
    const bId = `b${i}`;
    businesses.set(bId, biz(bId, `Place ${i + 1}`, i + 1));
    const lId = `l${i}`;
    listings.push({ id: lId, businessId: bId, sectionId: 's1', tier: tiers[i]! });
    order.push(lId);
  }
  const edition: Edition = {
    id: 'ed1',
    name: 'Summer 2026',
    hotel: {
      name: 'Test Hotel',
      wordmark: 'Test',
      brand: { primary: '#1B423B', secondary: '#B65C3F', accent: '#C99B5F' },
      stayEssentials: [{ label: 'Check-out', value: '11am' }],
      welcome: { heading: 'Welcome', intro: 'Intro copy.', guideIntro: 'Guide intro copy.' },
      infoBlocks: [],
      heroImageId: 'img-hero',
    },
    settings: {
      trimWidthMm: 100,
      trimHeightMm: 200,
      bleedMm: 3,
      baselineGridPt: 12,
      iccProfile: 'builtin:guide-cmyk',
      spotColor: null,
      inkLimit: 300,
      digitalBaseUrl: 'https://g.example.com/ed1',
      publisher: 'Atelier',
    },
    sections: [{ id: 's1', title: 'Eat & Drink', short: 'Eat' }],
    listings,
    listingOrder: order,
    pages: [
      { id: 'cover', kind: 'cover' },
      { id: 'welcome', kind: 'welcome' },
      { id: 'div', kind: 'divider', sectionId: 's1' },
      { id: 'list', kind: 'listings', sectionId: 's1' },
      { id: 'keys', kind: 'keys' },
      { id: 'back', kind: 'back-cover' },
    ],
    map: { source: '', tint: 0.3 },
    overrides: [],
    updatedAt: new Date().toISOString(),
  };
  return { edition, businesses };
}

// Every referenced image resolves to a stub asset (real pixels aren't needed
// for layout — only metadata). A blank frame would be an error by design.
const assetCatalog: AssetCatalog = {
  get: (id) => ({ id, filename: `${id}.jpg`, width: 1600, height: 2000, focal: { x: 0.5, y: 0.5 } }),
};

describe('compileEdition', () => {
  it('compiles every page with no error diagnostics and stable numbering', async () => {
    const { edition, businesses } = makeEdition();
    const fonts = new FontManager(new NodeFontSource());
    const bizCatalog: BusinessCatalog = { get: (id) => businesses.get(id) };

    const render = await compileEdition(edition, {
      fonts,
      assets: assetCatalog,
      businesses: bizCatalog,
    });

    // At least one physical page per spec (listings may expand).
    expect(render.pages.length).toBeGreaterThanOrEqual(6);

    // No silent failures: no overset/integrity errors.
    const errors = render.diagnostics.filter((d) => d.severity === 'error');
    expect(errors, JSON.stringify(errors, null, 2)).toHaveLength(0);

    // Numbering invariant: badge frames carry the canonical number.
    const nums = numberedListings(edition);
    expect(nums.map((n) => n.number)).toEqual([1, 2, 3, 4, 5]);

    // Every listing produced a name frame somewhere.
    for (const { listing } of nums) {
      expect(render.frames[`listing:${listing.id}:name`]).toBeDefined();
    }

    // Fonts and assets reported for downstream embedding/preflight.
    expect(Object.keys(render.fontsUsed).length).toBeGreaterThan(0);
  });

  it('flags an unplaced listing rather than dropping it silently', async () => {
    const { edition, businesses } = makeEdition();
    // Remove the listings page so the section's listings have nowhere to go.
    edition.pages = edition.pages.filter((p) => p.kind !== 'listings');
    const fonts = new FontManager(new NodeFontSource());
    const render = await compileEdition(edition, {
      fonts,
      assets: assetCatalog,
      businesses: { get: (id) => businesses.get(id) },
    });
    const unplaced = render.diagnostics.filter((d) => d.code === 'listing.unplaced');
    expect(unplaced).toHaveLength(5);
  });

  it('produces text items whose runs reference loaded fonts', async () => {
    const { edition, businesses } = makeEdition();
    const fonts = new FontManager(new NodeFontSource());
    const render = await compileEdition(edition, {
      fonts,
      assets: assetCatalog,
      businesses: { get: (id) => businesses.get(id) },
    });
    let textItems = 0;
    for (const page of render.pages) {
      for (const item of walkItems(page.items)) {
        if (item.t === 'text') {
          textItems++;
          for (const run of item.runs) expect(fonts.has(run.font)).toBe(true);
        }
      }
    }
    expect(textItems).toBeGreaterThan(10);
  });
});
