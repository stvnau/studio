/**
 * Canvas preview route. Renders an edition (the stored doc, or an unsaved
 * draft posted in the body) to per-page SVG + frame geometry + diagnostics,
 * via the one compileEdition the press exporter uses.
 */

import type { FastifyInstance } from 'fastify';
import type { Edition } from '@guide/shared';
import { normalizeOrder } from '@guide/shared';
import { z } from 'zod';
import { renderEditionPreview } from '../pipeline/preview.js';

const IdParams = z.object({ id: z.string() });
const Body = z.object({ edition: z.record(z.unknown()).optional(), showBleed: z.boolean().optional() });

export function registerPreviewRoutes(app: FastifyInstance): void {
  const db = app.db;
  const auth = { preHandler: app.requireUser };

  app.post('/api/editions/:id/preview', auth, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const body = Body.parse(req.body ?? {});

    let edition: Edition;
    if (body.edition) {
      edition = body.edition as unknown as Edition;
      edition.id = id;
      edition.listingOrder = normalizeOrder(edition);
    } else {
      const row = db.prepare('SELECT doc FROM editions WHERE id = ?').get(id) as
        | { doc: string }
        | undefined;
      if (!row) return reply.code(404).send({ error: 'edition not found' });
      edition = JSON.parse(row.doc) as Edition;
    }

    const result = await renderEditionPreview(db, app.dataDir, edition, {
      showBleed: body.showBleed,
    });
    return result;
  });
}
