import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { Exporter } from '../src/exporter.js';
import { makeServer, registerUser, sampleEdition, type TestServer } from './helpers.js';

async function createEdition(app: FastifyInstance, cookie: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/editions',
    headers: { cookie },
    payload: sampleEdition(),
  });
  return res.json().id;
}

async function pollUntilSettled(
  app: FastifyInstance,
  cookie: string,
  jobId: string,
): Promise<Record<string, unknown>> {
  for (let i = 0; i < 200; i++) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/exports/${jobId}`,
      headers: { cookie },
    });
    const job = res.json();
    if (job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('export job never settled');
}

describe('export', () => {
  let t: TestServer;
  afterEach(async () => {
    await t.cleanup();
  });

  it('answers 503 when no exporter is configured', async () => {
    t = await makeServer();
    const { cookie } = await registerUser(t.app);
    const editionId = await createEdition(t.app, cookie);
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/editions/${editionId}/export`,
      headers: { cookie },
      payload: { kind: 'proof' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('exporter not configured');
  });

  it('runs the job lifecycle running -> done with a stub exporter, file downloadable', async () => {
    const progress: string[] = [];
    const stub: Exporter = {
      async run(edition, kind, onProgress) {
        onProgress?.(`rendering ${edition.name} as ${kind}`);
        return {
          filename: 'guide-proof.pdf',
          bytes: new TextEncoder().encode('%PDF-1.7 stub proof'),
          diagnostics: [
            { code: 'text.widow', severity: 'warning', message: 'widow on page 7' },
          ],
          stats: { pages: 12 },
        };
      },
    };
    t = await makeServer(stub);
    const { cookie } = await registerUser(t.app);
    const editionId = await createEdition(t.app, cookie);

    const started = await t.app.inject({
      method: 'POST',
      url: `/api/editions/${editionId}/export`,
      headers: { cookie },
      payload: { kind: 'proof' },
    });
    expect(started.statusCode).toBe(202);
    const job = started.json();
    expect(job.status).toBe('running');
    expect(job.editionId).toBe(editionId);
    expect(job.kind).toBe('proof');

    const done = await pollUntilSettled(t.app, cookie, job.id);
    expect(done.status).toBe('done');
    expect(done.filename).toBe('guide-proof.pdf');
    expect(done.diagnostics).toEqual([
      { code: 'text.widow', severity: 'warning', message: 'widow on page 7' },
    ]);
    expect(done.stats).toEqual({ pages: 12 });
    expect(done.finishedAt).toBeTruthy();

    const list = await t.app.inject({
      method: 'GET',
      url: `/api/exports?editionId=${editionId}`,
      headers: { cookie },
    });
    expect(list.json().map((j: { id: string }) => j.id)).toContain(job.id);

    const file = await t.app.inject({
      method: 'GET',
      url: `/api/exports/${job.id}/file`,
      headers: { cookie },
    });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-disposition']).toBe('attachment; filename="guide-proof.pdf"');
    expect(file.body).toContain('%PDF-1.7 stub proof');
  });

  it('records a failed job with its error', async () => {
    const stub: Exporter = {
      async run() {
        throw new Error('ink limit exceeded');
      },
    };
    t = await makeServer(stub);
    const { cookie } = await registerUser(t.app);
    const editionId = await createEdition(t.app, cookie);
    const started = await t.app.inject({
      method: 'POST',
      url: `/api/editions/${editionId}/export`,
      headers: { cookie },
      payload: { kind: 'press' },
    });
    const failed = await pollUntilSettled(t.app, cookie, started.json().id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('ink limit exceeded');
    const file = await t.app.inject({
      method: 'GET',
      url: `/api/exports/${started.json().id}/file`,
      headers: { cookie },
    });
    expect(file.statusCode).toBe(404);
  });
});
