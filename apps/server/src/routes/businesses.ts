/** Business directory CRUD. Documents stored as JSON; server assigns ids. */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Business, Edition } from '@guide/shared';
import { z } from 'zod';
import { nowIso } from '../db.js';

/** Mirrors shared Business minus id (server-assigned). */
export const BusinessInput = z.object({
  name: z.string().min(1),
  category: z.string(),
  oneLiner: z.string(),
  description: z.string(),
  address: z.string(),
  suburb: z.string(),
  lat: z.number(),
  lng: z.number(),
  website: z.string().optional(),
  instagram: z.string().optional(),
  phone: z.string().optional(),
  images: z.array(z.string()),
  qrTarget: z.string().optional(),
});

const IdParams = z.object({ id: z.string() });

export function registerBusinessRoutes(app: FastifyInstance): void {
  const db = app.db;
  const auth = { preHandler: app.requireUser };

  const getDoc = (id: string): Business | null => {
    const row = db.prepare('SELECT doc FROM businesses WHERE id = ?').get(id) as
      | { doc: string }
      | undefined;
    return row ? (JSON.parse(row.doc) as Business) : null;
  };

  app.get('/api/businesses', auth, async () => {
    const rows = db.prepare('SELECT doc FROM businesses').all() as { doc: string }[];
    const docs = rows.map((r) => JSON.parse(r.doc) as Business);
    docs.sort((a, b) => a.name.localeCompare(b.name));
    return docs;
  });

  app.post('/api/businesses', auth, async (req, reply) => {
    const input = BusinessInput.parse(req.body);
    const doc: Business = { id: randomUUID(), ...input };
    db.prepare('INSERT INTO businesses (id, doc, updated_at) VALUES (?, ?, ?)').run(
      doc.id,
      JSON.stringify(doc),
      nowIso(),
    );
    return reply.code(201).send(doc);
  });

  app.get('/api/businesses/:id', auth, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const doc = getDoc(id);
    if (!doc) return reply.code(404).send({ error: 'business not found' });
    return doc;
  });

  app.put('/api/businesses/:id', auth, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    if (!getDoc(id)) return reply.code(404).send({ error: 'business not found' });
    const input = BusinessInput.parse(req.body);
    const doc: Business = { id, ...input };
    db.prepare('UPDATE businesses SET doc = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(doc),
      nowIso(),
      id,
    );
    return doc;
  });

  app.delete('/api/businesses/:id', auth, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    if (!getDoc(id)) return reply.code(404).send({ error: 'business not found' });
    // 409 if any edition still places this business.
    const editions = db.prepare('SELECT doc FROM editions').all() as { doc: string }[];
    const referencedBy: string[] = [];
    for (const row of editions) {
      const edition = JSON.parse(row.doc) as Edition;
      if (edition.listings.some((l) => l.businessId === id)) referencedBy.push(edition.id);
    }
    if (referencedBy.length > 0) {
      return reply
        .code(409)
        .send({ error: 'business is referenced by edition listings', editions: referencedBy });
    }
    db.prepare('DELETE FROM businesses WHERE id = ?').run(id);
    return reply.code(204).send();
  });
}
