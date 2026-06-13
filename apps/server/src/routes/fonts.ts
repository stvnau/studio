/**
 * Font catalog + bytes. Public: the studio and the digital edition shape
 * text with the exact binaries the press uses.
 */

import type { FastifyInstance } from 'fastify';
import { FACE_BY_ID, FONT_FACES } from '@guide/fonts';
import { NodeFontSource } from '@guide/fonts/node';
import { z } from 'zod';

const IdParams = z.object({ id: z.string() });

export function registerFontRoutes(app: FastifyInstance): void {
  const source = new NodeFontSource();

  app.get('/api/fonts', async () => FONT_FACES);

  app.get('/api/fonts/:id/file', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    if (!FACE_BY_ID.has(id)) return reply.code(404).send({ error: 'unknown font id' });
    const bytes = await source.getBytes(id);
    reply.header('content-type', 'font/ttf');
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    reply.header('etag', `"${id}"`);
    return reply.send(Buffer.from(bytes));
  });
}
