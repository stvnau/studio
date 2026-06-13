/**
 * Digital edition placeholder. The real renderer is wired later; for now
 * /g/:editionId serves a minimal shell and the doc endpoint exposes the
 * edition publicly with manual overrides stripped.
 */

import type { FastifyInstance } from 'fastify';
import type { Edition } from '@guide/shared';
import { z } from 'zod';
import type { Exporter } from '../exporter.js';

const Params = z.object({ editionId: z.string() });

export function registerDigitalRoutes(app: FastifyInstance, exporter?: Exporter): void {
  const db = app.db;

  app.get('/g/:editionId', async (req, reply) => {
    const { editionId } = Params.parse(req.params);
    reply.header('content-type', 'text/html; charset=utf-8');
    const row = db.prepare('SELECT doc FROM editions WHERE id = ?').get(editionId) as
      | { doc: string }
      | undefined;
    if (!row) return reply.code(404).send('<!doctype html><title>Not found</title><h1>Guide not found</h1>');

    if (exporter) {
      const edition = JSON.parse(row.doc) as Edition;
      const result = await exporter.run(edition, 'digital');
      return Buffer.from(result.bytes);
    }
    // No exporter wired (e.g. test mode): minimal shell.
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Guide</title></head>
<body><main style="font-family: system-ui; padding: 4rem 1.5rem; text-align: center;">
<h1>Digital edition &mdash; coming online</h1>
<p data-edition-id="${editionId.replace(/[^a-zA-Z0-9-]/g, '')}">This guide will be available here shortly.</p>
</main></body>
</html>`;
  });

  app.get('/api/digital/:editionId/doc', async (req, reply) => {
    const { editionId } = Params.parse(req.params);
    const row = db.prepare('SELECT doc FROM editions WHERE id = ?').get(editionId) as
      | { doc: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'edition not found' });
    const doc = JSON.parse(row.doc) as Edition;
    // Public doc: strip print-canvas overrides — they are studio-internal.
    const { overrides: _overrides, ...publicDoc } = doc;
    return publicDoc;
  });
}
