/**
 * Export jobs. One in-process job at a time via a simple promise queue;
 * job state lives in the exports table so the studio can poll. Output
 * files land in data/exports/<jobId>-<filename>.
 */

import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Edition } from '@guide/shared';
import { z } from 'zod';
import { nowIso } from '../db.js';
import type { Exporter } from '../exporter.js';

const ExportBody = z.object({ kind: z.enum(['press', 'proof', 'digital']) });
const JobParams = z.object({ jobId: z.string() });
const ListQuery = z.object({ editionId: z.string().optional() });

interface ExportRow {
  id: string;
  edition_id: string;
  kind: string;
  status: string;
  error: string | null;
  diagnostics: string | null;
  stats: string | null;
  filename: string | null;
  created_at: string;
  finished_at: string | null;
}

function toJson(row: ExportRow) {
  return {
    id: row.id,
    editionId: row.edition_id,
    kind: row.kind,
    status: row.status,
    error: row.error ?? undefined,
    diagnostics: row.diagnostics ? JSON.parse(row.diagnostics) : undefined,
    stats: row.stats ? JSON.parse(row.stats) : undefined,
    filename: row.filename ?? undefined,
    createdAt: row.created_at,
    finishedAt: row.finished_at ?? undefined,
  };
}

export function registerExportRoutes(app: FastifyInstance, exporter?: Exporter): void {
  const db = app.db;
  const auth = { preHandler: app.requireUser };
  const exportsDir = path.join(app.dataDir, 'exports');

  // Simple in-process serialization: each job chains onto the previous one.
  let queue: Promise<void> = Promise.resolve();

  const runJob = async (jobId: string, edition: Edition, kind: 'press' | 'proof' | 'digital') => {
    if (!exporter) return;
    try {
      const result = await exporter.run(edition, kind, (msg) =>
        app.log.info({ jobId, msg }, 'export progress'),
      );
      const safeName = path.basename(result.filename) || 'export.bin';
      await writeFile(path.join(exportsDir, `${jobId}-${safeName}`), result.bytes);
      db.prepare(
        `UPDATE exports SET status = 'done', filename = ?, diagnostics = ?, stats = ?, finished_at = ? WHERE id = ?`,
      ).run(
        safeName,
        JSON.stringify(result.diagnostics),
        result.stats === undefined ? null : JSON.stringify(result.stats),
        nowIso(),
        jobId,
      );
    } catch (err) {
      db.prepare(
        `UPDATE exports SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`,
      ).run(err instanceof Error ? err.message : String(err), nowIso(), jobId);
    }
  };

  app.post('/api/editions/:id/export', auth, async (req, reply) => {
    if (!exporter) return reply.code(503).send({ error: 'exporter not configured' });
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { kind } = ExportBody.parse(req.body);
    const row = db.prepare('SELECT doc FROM editions WHERE id = ?').get(id) as
      | { doc: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'edition not found' });
    const edition = JSON.parse(row.doc) as Edition;

    const jobId = randomUUID();
    db.prepare(
      `INSERT INTO exports (id, edition_id, kind, status, created_at) VALUES (?, ?, ?, 'running', ?)`,
    ).run(jobId, id, kind, nowIso());
    queue = queue.then(() => runJob(jobId, edition, kind));

    const created = db.prepare('SELECT * FROM exports WHERE id = ?').get(jobId) as ExportRow;
    return reply.code(202).send(toJson(created));
  });

  app.get('/api/exports', auth, async (req) => {
    const { editionId } = ListQuery.parse(req.query);
    const rows = (
      editionId
        ? db
            .prepare('SELECT * FROM exports WHERE edition_id = ? ORDER BY created_at DESC')
            .all(editionId)
        : db.prepare('SELECT * FROM exports ORDER BY created_at DESC').all()
    ) as ExportRow[];
    return rows.map(toJson);
  });

  app.get('/api/exports/:jobId', auth, async (req, reply) => {
    const { jobId } = JobParams.parse(req.params);
    const row = db.prepare('SELECT * FROM exports WHERE id = ?').get(jobId) as
      | ExportRow
      | undefined;
    if (!row) return reply.code(404).send({ error: 'export not found' });
    return toJson(row);
  });

  app.get('/api/exports/:jobId/file', auth, async (req, reply) => {
    const { jobId } = JobParams.parse(req.params);
    const row = db.prepare('SELECT * FROM exports WHERE id = ?').get(jobId) as
      | ExportRow
      | undefined;
    if (!row || row.status !== 'done' || !row.filename) {
      return reply.code(404).send({ error: 'export file not available' });
    }
    const filePath = path.join(exportsDir, `${jobId}-${row.filename}`);
    if (!existsSync(filePath)) return reply.code(404).send({ error: 'export file missing' });
    reply.header('content-type', 'application/octet-stream');
    reply.header('content-disposition', `attachment; filename="${row.filename}"`);
    return reply.send(createReadStream(filePath));
  });
}
