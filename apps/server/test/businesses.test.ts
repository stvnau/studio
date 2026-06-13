import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeServer, registerUser, sampleBusiness, sampleEdition, type TestServer } from './helpers.js';

describe('businesses', () => {
  let t: TestServer;
  let cookie: string;

  beforeEach(async () => {
    t = await makeServer();
    cookie = (await registerUser(t.app)).cookie;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it('supports the CRUD happy path, list sorted by name', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/businesses',
      headers: { cookie },
      payload: sampleBusiness({ name: 'Zinc Bar' }),
    });
    expect(created.statusCode).toBe(201);
    const zinc = created.json();
    expect(zinc.id).toBeTruthy();

    await t.app.inject({
      method: 'POST',
      url: '/api/businesses',
      headers: { cookie },
      payload: sampleBusiness({ name: 'Anchor Cafe' }),
    });

    const list = await t.app.inject({ method: 'GET', url: '/api/businesses', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().map((b: { name: string }) => b.name)).toEqual(['Anchor Cafe', 'Zinc Bar']);

    const got = await t.app.inject({
      method: 'GET',
      url: `/api/businesses/${zinc.id}`,
      headers: { cookie },
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().name).toBe('Zinc Bar');

    const put = await t.app.inject({
      method: 'PUT',
      url: `/api/businesses/${zinc.id}`,
      headers: { cookie },
      payload: sampleBusiness({ name: 'Zinc Wine Bar' }),
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ id: zinc.id, name: 'Zinc Wine Bar' });

    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/businesses/${zinc.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
    const gone = await t.app.inject({
      method: 'GET',
      url: `/api/businesses/${zinc.id}`,
      headers: { cookie },
    });
    expect(gone.statusCode).toBe(404);
  });

  it('rejects invalid input with 400 and zod issues', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/businesses',
      headers: { cookie },
      payload: { name: 'No coords' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues.length).toBeGreaterThan(0);
  });

  it('refuses to delete a business referenced by an edition listing (409)', async () => {
    const biz = (
      await t.app.inject({
        method: 'POST',
        url: '/api/businesses',
        headers: { cookie },
        payload: sampleBusiness(),
      })
    ).json();

    const edition = (
      await t.app.inject({
        method: 'POST',
        url: '/api/editions',
        headers: { cookie },
        payload: sampleEdition(),
      })
    ).json();

    const addListing = await t.app.inject({
      method: 'POST',
      url: `/api/editions/${edition.id}/listings`,
      headers: { cookie },
      payload: { businessId: biz.id, sectionId: 'eat', tier: 'half' },
    });
    expect(addListing.statusCode).toBe(201);

    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/businesses/${biz.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(409);
    expect(del.json().editions).toContain(edition.id);

    // Remove the listing, then deletion succeeds.
    const listingId = addListing.json().listing.id;
    await t.app.inject({
      method: 'DELETE',
      url: `/api/editions/${edition.id}/listings/${listingId}`,
      headers: { cookie },
    });
    const del2 = await t.app.inject({
      method: 'DELETE',
      url: `/api/businesses/${biz.id}`,
      headers: { cookie },
    });
    expect(del2.statusCode).toBe(204);
  });
});
