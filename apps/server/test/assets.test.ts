import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeServer, mulberry32, registerUser, type TestServer } from './helpers.js';

/** Dependency-free multipart body for fastify.inject. */
function multipart(filename: string, contentType: string, data: Buffer) {
  const boundary = '----gs-test-boundary-7f3a';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `content-disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `content-type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, data, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/**
 * A noisy 200x300 PNG: bright noisy top third, dark noisy bottom third.
 * Noise keeps the PNG large (so the jpeg thumb is genuinely smaller) and
 * the bright/dark split lets us assert the luma stats mean something.
 */
async function testPng(): Promise<Buffer> {
  const rand = mulberry32(42);
  const w = 200;
  const h = 300;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const base = y < h / 3 ? 215 : y >= (2 * h) / 3 ? 30 : 120;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) {
        raw[i + c] = Math.max(0, Math.min(255, base + Math.floor(rand() * 60) - 30));
      }
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe('assets', () => {
  let t: TestServer;
  let cookie: string;

  beforeEach(async () => {
    t = await makeServer();
    cookie = (await registerUser(t.app)).cookie;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it('uploads a png, reports dimensions and luma, serves thumbs, patches focal', async () => {
    const png = await testPng();
    const mp = multipart('hero.png', 'image/png', png);
    const up = await t.app.inject({
      method: 'POST',
      url: '/api/assets',
      headers: { cookie, ...mp.headers },
      payload: mp.payload,
    });
    expect(up.statusCode).toBe(201);
    const meta = up.json();
    expect(meta).toMatchObject({
      filename: 'hero.png',
      width: 200,
      height: 300,
      focal: { x: 0.5, y: 0.5 },
    });
    expect(meta.luma.top).toBeGreaterThan(0.6);
    expect(meta.luma.bottom).toBeLessThan(0.3);
    expect(meta.luma.overall).toBeGreaterThan(meta.luma.bottom);
    expect(meta.luma.overall).toBeLessThan(meta.luma.top);

    // Original file round-trips, with immutable caching by id.
    const file = await t.app.inject({ method: 'GET', url: `/api/assets/${meta.id}/file` });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers.etag).toBe(`"${meta.id}"`);
    expect(file.rawPayload.length).toBe(png.length);
    const cached = await t.app.inject({
      method: 'GET',
      url: `/api/assets/${meta.id}/file`,
      headers: { 'if-none-match': `"${meta.id}"` },
    });
    expect(cached.statusCode).toBe(304);

    // Thumb: jpeg, requested width, smaller than the original bytes.
    const thumb = await t.app.inject({ method: 'GET', url: `/api/assets/${meta.id}/thumb?w=128` });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/jpeg');
    const thumbMeta = await sharp(thumb.rawPayload).metadata();
    expect(thumbMeta.format).toBe('jpeg');
    expect(thumbMeta.width).toBe(128);
    expect(thumb.rawPayload.length).toBeLessThan(png.length);

    // Width clamps to [64, 1600].
    const tiny = await t.app.inject({ method: 'GET', url: `/api/assets/${meta.id}/thumb?w=1` });
    expect((await sharp(tiny.rawPayload).metadata()).width).toBe(64);

    // Focal patch persists.
    const patch = await t.app.inject({
      method: 'PATCH',
      url: `/api/assets/${meta.id}`,
      headers: { cookie },
      payload: { focal: { x: 0.25, y: 0.8 } },
    });
    expect(patch.statusCode).toBe(200);
    const list = await t.app.inject({ method: 'GET', url: '/api/assets' });
    const found = list.json().find((a: { id: string }) => a.id === meta.id);
    expect(found.focal).toEqual({ x: 0.25, y: 0.8 });
  });

  it('rejects non-image uploads and unauthenticated mutations', async () => {
    const mp = multipart('notes.txt', 'text/plain', Buffer.from('hello'));
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/assets',
      headers: { cookie, ...mp.headers },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(415);

    const png = await testPng();
    const mp2 = multipart('hero.png', 'image/png', png);
    const unauth = await t.app.inject({
      method: 'POST',
      url: '/api/assets',
      headers: mp2.headers,
      payload: mp2.payload,
    });
    expect(unauth.statusCode).toBe(401);
  });
});
