/** Guide Studio API server assembly. */

import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { registerAuth } from './auth.js';
import { openDb } from './db.js';
import type { Exporter } from './exporter.js';
import { registerAssetRoutes } from './routes/assets.js';
import { registerBusinessRoutes } from './routes/businesses.js';
import { registerDigitalRoutes } from './routes/digital.js';
import { registerEditionRoutes } from './routes/editions.js';
import { registerExportRoutes } from './routes/export.js';
import { registerFontRoutes } from './routes/fonts.js';
import { registerPreviewRoutes } from './routes/preview.js';
import './types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.resolve(HERE, '../../../data');
const STUDIO_DIST = path.resolve(HERE, '../../studio/dist');

/** An exporter, or a factory built from the server's own db + data dir. */
export type ExporterFactory = (db: ReturnType<typeof openDb>, dataDir: string) => Exporter;

export interface CreateServerOptions {
  dataDir?: string;
  exporter?: Exporter | ExporterFactory;
  logger?: boolean;
}

const STATIC_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export async function createServer(opts: CreateServerOptions = {}): Promise<FastifyInstance> {
  const dataDir = opts.dataDir ?? process.env.GUIDE_DATA_DIR ?? DEFAULT_DATA_DIR;
  const db = openDb(dataDir);

  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 16 * 1024 * 1024, // edition docs can get chunky
  });
  app.decorate('db', db);
  app.decorate('dataDir', dataDir);
  app.addHook('onClose', async () => {
    db.close();
  });

  await app.register(fastifyCookie);
  await app.register(fastifyCors, {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  });
  await app.register(fastifyMultipart, { limits: { fileSize: 40 * 1024 * 1024 } });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation failed', issues: err.issues });
    }
    const e = err as { statusCode?: number; message?: string };
    const status = typeof e.statusCode === 'number' && e.statusCode >= 400 ? e.statusCode : 500;
    if (status >= 500) req.log.error(err);
    return reply
      .code(status)
      .send({ error: status >= 500 ? 'internal server error' : (e.message ?? 'request failed') });
  });

  app.get('/api/health', async () => ({ ok: true }));

  registerAuth(app);
  registerBusinessRoutes(app);
  registerEditionRoutes(app);
  registerAssetRoutes(app);
  registerFontRoutes(app);
  registerPreviewRoutes(app);
  const exporter =
    typeof opts.exporter === 'function' ? opts.exporter(db, dataDir) : opts.exporter;
  registerExportRoutes(app, exporter);
  registerDigitalRoutes(app, exporter);

  // Serve the built studio SPA when present (production single-binary mode).
  if (existsSync(STUDIO_DIST) && statSync(STUDIO_DIST).isDirectory()) {
    app.setNotFoundHandler(async (req, reply) => {
      const url = (req.raw.url ?? '/').split('?')[0] ?? '/';
      const isApi = url === '/api' || url.startsWith('/api/');
      const isDigital = url === '/g' || url.startsWith('/g/');
      if ((req.method !== 'GET' && req.method !== 'HEAD') || isApi || isDigital) {
        return reply.code(404).send({ error: 'not found' });
      }
      const rel = path.posix.normalize(decodeURIComponent(url)).replace(/^\/+/, '');
      let filePath = path.join(STUDIO_DIST, rel);
      if (rel.includes('..') || !filePath.startsWith(STUDIO_DIST)) {
        return reply.code(404).send({ error: 'not found' });
      }
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        filePath = path.join(STUDIO_DIST, 'index.html'); // SPA fallback
        if (!existsSync(filePath)) return reply.code(404).send({ error: 'not found' });
      }
      const ext = path.extname(filePath).toLowerCase();
      reply.header('content-type', STATIC_MIME[ext] ?? 'application/octet-stream');
      return reply.send(await readFile(filePath));
    });
  }

  return app;
}

export type { Exporter, ExportKind, ExportResult } from './exporter.js';
