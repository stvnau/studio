/**
 * Edition documents. Stored whole as JSON with optimistic concurrency on
 * updated_at. The numbering invariant (listingOrder is a perfect permutation
 * of listing ids) is enforced on EVERY write: normalizeOrder then
 * checkNumberingIntegrity — a violation after repair is a server bug and
 * fails the write hard.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Edition, Listing } from '@guide/shared';
import { checkNumberingIntegrity, normalizeOrder } from '@guide/shared';
import { z } from 'zod';
import { nextTimestamp } from '../db.js';

const TierSchema = z.enum(['full', 'half', 'quarter', 'list']);

const ListingSchema = z
  .object({
    id: z.string().min(1),
    businessId: z.string().min(1),
    sectionId: z.string().min(1),
    tier: TierSchema,
  })
  .passthrough();

const PageSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string(), kind: z.literal('cover') }).passthrough(),
  z.object({ id: z.string(), kind: z.literal('welcome') }).passthrough(),
  z
    .object({ id: z.string(), kind: z.literal('hotel-info'), blockIds: z.array(z.string()) })
    .passthrough(),
  z.object({ id: z.string(), kind: z.literal('divider'), sectionId: z.string() }).passthrough(),
  z.object({ id: z.string(), kind: z.literal('listings'), sectionId: z.string() }).passthrough(),
  z.object({ id: z.string(), kind: z.literal('map'), spread: z.boolean() }).passthrough(),
  z.object({ id: z.string(), kind: z.literal('keys') }).passthrough(),
  z.object({ id: z.string(), kind: z.literal('back-cover') }).passthrough(),
]);

/**
 * Loose on deep content (passthrough), strict on the parts the server's
 * invariants depend on: listings identity/tier, listingOrder, page kinds.
 */
const EditionInput = z
  .object({
    name: z.string().min(1),
    hotel: z.object({ name: z.string().min(1) }).passthrough(),
    settings: z.object({}).passthrough().optional(),
    sections: z.array(z.object({}).passthrough()).optional(),
    listings: z.array(ListingSchema).optional(),
    listingOrder: z.array(z.string()).optional(),
    pages: z.array(PageSchema).optional(),
    map: z.object({}).passthrough().optional(),
    overrides: z.array(z.object({}).passthrough()).optional(),
  })
  .passthrough();

type EditionInputT = z.infer<typeof EditionInput>;

const IdParams = z.object({ id: z.string() });
const ListingParams = z.object({ id: z.string(), listingId: z.string() });
const CreateListingBody = z.object({
  businessId: z.string().min(1),
  sectionId: z.string().min(1),
  tier: TierSchema,
});
const OrderBody = z.object({ order: z.array(z.string()) });

const DEFAULT_SETTINGS = {
  trimWidthMm: 105,
  trimHeightMm: 174,
  bleedMm: 3,
  margins: { top: 12, bottom: 14, inner: 12, outer: 9 },
  baselineGridPt: 12,
  iccProfile: 'builtin:guide-cmyk',
  spotColor: null,
  inkLimit: 300,
  digitalBaseUrl: '',
  publisher: '',
};

const DEFAULT_HOTEL = {
  brand: { primary: '#1f2a26', secondary: '#efe9dd', accent: '#c2613a' },
  stayEssentials: [],
  welcome: { heading: 'Welcome', intro: '', guideIntro: '' },
  infoBlocks: [],
};

/** Fill defaults so a minimal {name, hotel} post yields a complete doc. */
function buildDoc(input: EditionInputT, id: string, updatedAt: string): Edition {
  const doc = {
    ...input,
    id,
    hotel: { ...DEFAULT_HOTEL, ...input.hotel },
    settings: { ...DEFAULT_SETTINGS, ...(input.settings ?? {}) },
    sections: input.sections ?? [],
    listings: input.listings ?? [],
    listingOrder: input.listingOrder ?? [],
    pages: input.pages ?? [],
    map: { source: 'overpass', tint: 0.35, ...(input.map ?? {}) },
    overrides: input.overrides ?? [],
    updatedAt,
  } as unknown as Edition;
  return doc;
}

export function registerEditionRoutes(app: FastifyInstance): void {
  const db = app.db;
  const auth = { preHandler: app.requireUser };

  const getRow = (id: string): { doc: Edition; updatedAt: string } | null => {
    const row = db.prepare('SELECT doc, updated_at FROM editions WHERE id = ?').get(id) as
      | { doc: string; updated_at: string }
      | undefined;
    return row ? { doc: JSON.parse(row.doc) as Edition, updatedAt: row.updated_at } : null;
  };

  /**
   * The single write path: normalize listingOrder, verify the numbering
   * invariant, stamp updatedAt strictly after the previous one, persist.
   */
  const persist = (doc: Edition, prevUpdatedAt: string | null, insert: boolean): Edition => {
    doc.listingOrder = normalizeOrder(doc);
    const integrity = checkNumberingIntegrity(doc);
    if (!integrity.ok) {
      // normalizeOrder repairs every violation by construction; reaching
      // here means a server bug, and we refuse to persist a broken doc.
      throw Object.assign(new Error('numbering integrity violated after normalization'), {
        statusCode: 500,
        integrity,
      });
    }
    doc.updatedAt = nextTimestamp(prevUpdatedAt);
    if (insert) {
      db.prepare('INSERT INTO editions (id, doc, updated_at) VALUES (?, ?, ?)').run(
        doc.id,
        JSON.stringify(doc),
        doc.updatedAt,
      );
    } else {
      db.prepare('UPDATE editions SET doc = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(doc),
        doc.updatedAt,
        doc.id,
      );
    }
    return doc;
  };

  app.get('/api/editions', auth, async () => {
    const rows = db.prepare('SELECT doc, updated_at FROM editions').all() as {
      doc: string;
      updated_at: string;
    }[];
    return rows
      .map((r) => {
        const doc = JSON.parse(r.doc) as Edition;
        return { id: doc.id, name: doc.name, hotel: doc.hotel.name, updatedAt: r.updated_at };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  app.post('/api/editions', auth, async (req, reply) => {
    const input = EditionInput.parse(req.body);
    delete (input as Record<string, unknown>).id;
    delete (input as Record<string, unknown>).updatedAt;
    const doc = persist(buildDoc(input, randomUUID(), ''), null, true);
    return reply.code(201).send(doc);
  });

  app.get('/api/editions/:id', auth, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const row = getRow(id);
    if (!row) return reply.code(404).send({ error: 'edition not found' });
    return row.doc;
  });

  app.put('/api/editions/:id', auth, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const row = getRow(id);
    if (!row) return reply.code(404).send({ error: 'edition not found' });
    const { baseUpdatedAt, ...rest } = z
      .object({ baseUpdatedAt: z.string() })
      .passthrough()
      .parse(req.body);
    if (baseUpdatedAt !== row.updatedAt) {
      return reply.code(409).send({ error: 'stale write', current: row.doc });
    }
    const input = EditionInput.parse(rest);
    delete (input as Record<string, unknown>).id;
    delete (input as Record<string, unknown>).updatedAt;
    return persist(buildDoc(input, id, row.updatedAt), row.updatedAt, false);
  });

  app.delete('/api/editions/:id', auth, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const info = db.prepare('DELETE FROM editions WHERE id = ?').run(id);
    if (info.changes === 0) return reply.code(404).send({ error: 'edition not found' });
    return reply.code(204).send();
  });

  /* ---------------- atomic listing operations ---------------- */

  app.post('/api/editions/:id/listings', auth, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const body = CreateListingBody.parse(req.body);
    const row = getRow(id);
    if (!row) return reply.code(404).send({ error: 'edition not found' });
    const listing: Listing = { id: randomUUID(), ...body };
    row.doc.listings.push(listing);
    row.doc.listingOrder.push(listing.id);
    const doc = persist(row.doc, row.updatedAt, false);
    return reply.code(201).send({ listing, edition: doc });
  });

  app.delete('/api/editions/:id/listings/:listingId', auth, async (req, reply) => {
    const { id, listingId } = ListingParams.parse(req.params);
    const row = getRow(id);
    if (!row) return reply.code(404).send({ error: 'edition not found' });
    const before = row.doc.listings.length;
    row.doc.listings = row.doc.listings.filter((l) => l.id !== listingId);
    if (row.doc.listings.length === before) {
      return reply.code(404).send({ error: 'listing not found' });
    }
    // normalizeOrder (inside persist) drops the now-stale order entry.
    return persist(row.doc, row.updatedAt, false);
  });

  app.post('/api/editions/:id/listing-order', auth, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const { order } = OrderBody.parse(req.body);
    const row = getRow(id);
    if (!row) return reply.code(404).send({ error: 'edition not found' });
    const current = row.doc.listings.map((l) => l.id);
    const wanted = new Set(current);
    let isPermutation = order.length === current.length;
    if (isPermutation) {
      const seen = new Set<string>();
      for (const oid of order) {
        if (!wanted.has(oid) || seen.has(oid)) {
          isPermutation = false;
          break;
        }
        seen.add(oid);
      }
    }
    if (!isPermutation) {
      return reply
        .code(400)
        .send({ error: 'order must be a permutation of the current listing ids' });
    }
    row.doc.listingOrder = order;
    return persist(row.doc, row.updatedAt, false);
  });
}
