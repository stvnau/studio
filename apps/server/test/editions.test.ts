import { checkNumberingIntegrity, type Edition } from '@guide/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  makeServer,
  mulberry32,
  registerUser,
  sampleEdition,
  type TestServer,
} from './helpers.js';

describe('editions', () => {
  let t: TestServer;
  let cookie: string;

  beforeEach(async () => {
    t = await makeServer();
    cookie = (await registerUser(t.app)).cookie;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const createEdition = async (): Promise<Edition> => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/editions',
      headers: { cookie },
      payload: sampleEdition(),
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  };

  const getEdition = async (id: string): Promise<Edition> => {
    const res = await t.app.inject({ method: 'GET', url: `/api/editions/${id}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    return res.json();
  };

  it('creates a minimal edition with defaults filled, listed in summaries', async () => {
    const doc = await createEdition();
    expect(doc.id).toBeTruthy();
    expect(doc.updatedAt).toBeTruthy();
    expect(doc.listings).toEqual([]);
    expect(doc.listingOrder).toEqual([]);
    expect(doc.settings.trimWidthMm).toBeGreaterThan(0);
    expect(doc.hotel.brand.primary).toMatch(/^#/);

    const list = await t.app.inject({ method: 'GET', url: '/api/editions', headers: { cookie } });
    expect(list.json()).toEqual([
      { id: doc.id, name: 'Summer 2026', hotel: 'The Sandling', updatedAt: doc.updatedAt },
    ]);
  });

  it('PUT applies with the right baseUpdatedAt and 409s on a stale one', async () => {
    const doc = await createEdition();

    const ok = await t.app.inject({
      method: 'PUT',
      url: `/api/editions/${doc.id}`,
      headers: { cookie },
      payload: { ...doc, name: 'Winter 2026', baseUpdatedAt: doc.updatedAt },
    });
    expect(ok.statusCode).toBe(200);
    const updated = ok.json();
    expect(updated.name).toBe('Winter 2026');
    expect(updated.updatedAt > doc.updatedAt).toBe(true);

    // Replaying the first write with the now-stale token must conflict.
    const stale = await t.app.inject({
      method: 'PUT',
      url: `/api/editions/${doc.id}`,
      headers: { cookie },
      payload: { ...doc, name: 'Lost Update', baseUpdatedAt: doc.updatedAt },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().current.name).toBe('Winter 2026');
    expect((await getEdition(doc.id)).name).toBe('Winter 2026');
  });

  it('rejects a listing-order that is not a permutation', async () => {
    const doc = await createEdition();
    const add = await t.app.inject({
      method: 'POST',
      url: `/api/editions/${doc.id}/listings`,
      headers: { cookie },
      payload: { businessId: 'b1', sectionId: 'eat', tier: 'list' },
    });
    const listingId: string = add.json().listing.id;

    for (const order of [
      [], // wrong length
      [listingId, listingId], // duplicate
      ['not-a-listing'], // stale id
      [listingId, 'extra'], // superset
    ]) {
      const res = await t.app.inject({
        method: 'POST',
        url: `/api/editions/${doc.id}/listing-order`,
        headers: { cookie },
        payload: { order },
      });
      expect(res.statusCode).toBe(400);
    }

    const okRes = await t.app.inject({
      method: 'POST',
      url: `/api/editions/${doc.id}/listing-order`,
      headers: { cookie },
      payload: { order: [listingId] },
    });
    expect(okRes.statusCode).toBe(200);
  });

  it('keeps listingOrder a perfect permutation across 20 random add/remove/reorder ops', async () => {
    const rand = mulberry32(0xa11ce);
    const doc = await createEdition();
    const tiers = ['full', 'half', 'quarter', 'list'] as const;

    const assertIntegrity = (edition: Edition) => {
      const integrity = checkNumberingIntegrity(edition);
      expect(integrity).toMatchObject({ ok: true, missing: [], stale: [], duplicates: [] });
      // Perfect permutation: same multiset, no duplicates.
      const ids = edition.listings.map((l) => l.id).sort();
      const order = [...edition.listingOrder].sort();
      expect(order).toEqual(ids);
      expect(new Set(edition.listingOrder).size).toBe(edition.listingOrder.length);
    };

    for (let i = 0; i < 20; i++) {
      const current = await getEdition(doc.id);
      const ops: string[] = ['add'];
      if (current.listings.length > 0) ops.push('remove', 'reorder');
      const op = ops[Math.floor(rand() * ops.length)]!;

      if (op === 'add') {
        const res = await t.app.inject({
          method: 'POST',
          url: `/api/editions/${doc.id}/listings`,
          headers: { cookie },
          payload: {
            businessId: `biz-${i}`,
            sectionId: 'eat',
            tier: tiers[Math.floor(rand() * tiers.length)],
          },
        });
        expect(res.statusCode).toBe(201);
        // New listing must land at the end of the order.
        const after: Edition = res.json().edition;
        expect(after.listingOrder[after.listingOrder.length - 1]).toBe(res.json().listing.id);
      } else if (op === 'remove') {
        const victim = current.listings[Math.floor(rand() * current.listings.length)]!;
        const res = await t.app.inject({
          method: 'DELETE',
          url: `/api/editions/${doc.id}/listings/${victim.id}`,
          headers: { cookie },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().listingOrder).not.toContain(victim.id);
      } else {
        const shuffled = [...current.listingOrder];
        for (let j = shuffled.length - 1; j > 0; j--) {
          const k = Math.floor(rand() * (j + 1));
          [shuffled[j], shuffled[k]] = [shuffled[k]!, shuffled[j]!];
        }
        const res = await t.app.inject({
          method: 'POST',
          url: `/api/editions/${doc.id}/listing-order`,
          headers: { cookie },
          payload: { order: shuffled },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().listingOrder).toEqual(shuffled);
      }

      assertIntegrity(await getEdition(doc.id));
    }
  });

  it('deletes an edition', async () => {
    const doc = await createEdition();
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/editions/${doc.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
    const gone = await t.app.inject({
      method: 'GET',
      url: `/api/editions/${doc.id}`,
      headers: { cookie },
    });
    expect(gone.statusCode).toBe(404);
  });
});
