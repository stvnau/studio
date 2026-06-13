/**
 * Image assets. Originals under data/assets/<id>.<png|jpg>; thumbnails are
 * cached to data/thumbs/<id>-<w>.jpg. Upload computes dimensions and luma
 * stats (mean luminance of top/bottom thirds + overall) so the layout
 * engine can decide where text scrims are needed. GETs are public — asset
 * ids are uuids and the digital edition fetches them without a session.
 */

import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ImageAsset } from '@guide/shared';
import sharp from 'sharp';
import { z } from 'zod';
import { nowIso } from '../db.js';

const IdParams = z.object({ id: z.string() });
const FocalBody = z.object({
  focal: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
});
const ThumbQuery = z.object({ w: z.coerce.number().int().optional() });

const EXT_BY_MIME: Record<string, 'png' | 'jpg'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
};
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
};

/** Mean luminance (0..1) of the top third, bottom third and whole image. */
export async function computeLuma(
  input: Buffer,
): Promise<{ top: number; bottom: number; overall: number }> {
  const { data, info } = await sharp(input)
    .resize({ width: 64 })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const mean = (fromRow: number, toRow: number): number => {
    let sum = 0;
    let n = 0;
    for (let y = fromRow; y < toRow; y++) {
      const rowStart = y * width * channels;
      for (let x = 0; x < width; x++) {
        sum += data[rowStart + x * channels] ?? 0;
        n++;
      }
    }
    return n === 0 ? 0 : sum / n / 255;
  };
  const third = Math.max(1, Math.floor(height / 3));
  return {
    top: mean(0, third),
    bottom: mean(height - third, height),
    overall: mean(0, height),
  };
}

function sendImmutable(reply: FastifyReply, etag: string, contentType: string): boolean {
  reply.header('cache-control', 'public, max-age=31536000, immutable');
  reply.header('etag', `"${etag}"`);
  reply.header('content-type', contentType);
  const inm = reply.request.headers['if-none-match'];
  if (inm && inm.replace(/"/g, '') === etag) {
    reply.code(304).send();
    return true;
  }
  return false;
}

export function registerAssetRoutes(app: FastifyInstance): void {
  const db = app.db;
  const auth = { preHandler: app.requireUser };
  const assetsDir = path.join(app.dataDir, 'assets');
  const thumbsDir = path.join(app.dataDir, 'thumbs');

  const getAsset = (id: string): { meta: ImageAsset; filename: string } | null => {
    const row = db.prepare('SELECT meta, filename FROM assets WHERE id = ?').get(id) as
      | { meta: string; filename: string }
      | undefined;
    return row ? { meta: JSON.parse(row.meta) as ImageAsset, filename: row.filename } : null;
  };

  app.post('/api/assets', auth, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "multipart field 'file' required" });
    const ext = EXT_BY_MIME[file.mimetype];
    if (!ext) return reply.code(415).send({ error: 'only image/png and image/jpeg are accepted' });
    const buf = await file.toBuffer(); // throws 413 via @fastify/multipart if over the limit

    const probe = await sharp(buf).metadata();
    if (!probe.width || !probe.height) {
      return reply.code(400).send({ error: 'could not read image dimensions' });
    }
    const luma = await computeLuma(buf);

    const id = randomUUID();
    const storedName = `${id}.${ext}`;
    await writeFile(path.join(assetsDir, storedName), buf);

    const meta: ImageAsset = {
      id,
      filename: file.filename || storedName,
      width: probe.width,
      height: probe.height,
      focal: { x: 0.5, y: 0.5 },
      luma,
    };
    db.prepare('INSERT INTO assets (id, meta, filename, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      JSON.stringify(meta),
      storedName,
      nowIso(),
    );
    return reply.code(201).send(meta);
  });

  app.patch('/api/assets/:id', auth, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const { focal } = FocalBody.parse(req.body);
    const asset = getAsset(id);
    if (!asset) return reply.code(404).send({ error: 'asset not found' });
    const meta: ImageAsset = { ...asset.meta, focal };
    db.prepare('UPDATE assets SET meta = ? WHERE id = ?').run(JSON.stringify(meta), id);
    return meta;
  });

  app.get('/api/assets', async () => {
    const rows = db.prepare('SELECT meta FROM assets ORDER BY created_at DESC').all() as {
      meta: string;
    }[];
    return rows.map((r) => JSON.parse(r.meta) as ImageAsset);
  });

  app.get('/api/assets/:id/file', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const asset = getAsset(id);
    if (!asset) return reply.code(404).send({ error: 'asset not found' });
    const filePath = path.join(assetsDir, asset.filename);
    if (!existsSync(filePath)) return reply.code(404).send({ error: 'asset file missing' });
    const ext = path.extname(asset.filename).slice(1);
    if (sendImmutable(reply, id, MIME_BY_EXT[ext] ?? 'application/octet-stream')) return reply;
    const st = await stat(filePath);
    reply.header('content-length', st.size);
    return reply.send(createReadStream(filePath));
  });

  app.get('/api/assets/:id/thumb', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const asset = getAsset(id);
    if (!asset) return reply.code(404).send({ error: 'asset not found' });
    const q = ThumbQuery.parse(req.query);
    const w = Math.min(1600, Math.max(64, q.w ?? 320));
    if (sendImmutable(reply, `${id}-${w}`, 'image/jpeg')) return reply;
    const cached = path.join(thumbsDir, `${id}-${w}.jpg`);
    if (!existsSync(cached)) {
      const original = path.join(assetsDir, asset.filename);
      if (!existsSync(original)) return reply.code(404).send({ error: 'asset file missing' });
      const buf = await sharp(original).resize({ width: w }).jpeg({ quality: 82 }).toBuffer();
      await writeFile(cached, buf);
    }
    return reply.send(createReadStream(cached));
  });
}
