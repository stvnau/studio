import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Exporter } from '../src/exporter.js';
import { createServer } from '../src/index.js';

export interface TestServer {
  app: FastifyInstance;
  dataDir: string;
  cleanup: () => Promise<void>;
}

export async function makeServer(exporter?: Exporter): Promise<TestServer> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'gs-test-'));
  const app = await createServer({ dataDir, exporter, logger: false });
  await app.ready();
  return {
    app,
    dataDir,
    cleanup: async () => {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

export function cookieFrom(res: LightMyRequestResponse): string {
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('no set-cookie header in response');
  return raw.split(';')[0]!;
}

export async function registerUser(
  app: FastifyInstance,
  email = 'steven@stvn.au',
  name = 'Steven',
  password = 'correct horse battery',
): Promise<{ res: LightMyRequestResponse; cookie: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, name, password },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  return { res, cookie: cookieFrom(res) };
}

export const sampleBusiness = (overrides: Record<string, unknown> = {}) => ({
  name: 'Coastal Espresso',
  category: 'cafe',
  oneLiner: 'Flat whites by the pier',
  description: 'A tiny roastery with a big view.',
  address: '1 Pier Rd',
  suburb: 'Pelican Point',
  lat: -33.91,
  lng: 151.26,
  website: 'https://coastal.example',
  images: [],
  ...overrides,
});

export const sampleEdition = (overrides: Record<string, unknown> = {}) => ({
  name: 'Summer 2026',
  hotel: { name: 'The Sandling' },
  sections: [{ id: 'eat', title: 'Eat & Drink', short: 'Eat' }],
  ...overrides,
});

/** Deterministic PRNG for property-style tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
