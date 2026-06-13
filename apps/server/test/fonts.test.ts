import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeServer, type TestServer } from './helpers.js';

describe('fonts', () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await makeServer();
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it('lists the catalog, including fraunces-600', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/fonts' });
    expect(res.statusCode).toBe(200);
    const faces = res.json();
    const fraunces = faces.find((f: { id: string }) => f.id === 'fraunces-600');
    expect(fraunces).toMatchObject({
      family: 'Fraunces',
      weight: 600,
      italic: false,
      license: 'OFL-1.1',
    });
  });

  it('serves TTF bytes (sfnt header 0x00010000) with immutable caching', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/fonts/fraunces-600/file' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('font/ttf');
    expect(res.headers['cache-control']).toContain('immutable');
    // Verified on disk: Fraunces_600SemiBold.ttf begins 00 01 00 00 (TrueType sfnt).
    expect(Array.from(res.rawPayload.subarray(0, 4))).toEqual([0x00, 0x01, 0x00, 0x00]);
    expect(res.rawPayload.length).toBeGreaterThan(10_000);
  });

  it('404s for an unknown font id', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/fonts/comic-sans-400/file' });
    expect(res.statusCode).toBe(404);
  });
});
