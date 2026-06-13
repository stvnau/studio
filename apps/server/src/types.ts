/** Fastify module augmentation for the decorators this server adds. */

import type DatabaseT from 'better-sqlite3';
import type { preHandlerAsyncHookHandler } from 'fastify';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'member';
}

declare module 'fastify' {
  interface FastifyInstance {
    db: DatabaseT.Database;
    dataDir: string;
    requireUser: preHandlerAsyncHookHandler;
  }
  interface FastifyRequest {
    user?: AuthUser;
  }
}
