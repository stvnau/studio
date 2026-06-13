/**
 * Auth: scrypt-hashed passwords, 30-day DB-backed sessions, httpOnly cookie.
 * Open registration is intentional — this is a small-team in-house tool;
 * the first registered user becomes 'owner', everyone after is 'member'.
 */

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { nowIso } from './db.js';
import type { AuthUser } from './types.js';

export const SESSION_COOKIE = 'gs_session';
const SESSION_DAYS = 30;
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const RegisterBody = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string(),
});

interface UserRow {
  id: string;
  email: string;
  name: string;
  pass_hash: string;
  role: string;
  created_at: string;
}

function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role as AuthUser['role'] };
}

export function registerAuth(app: FastifyInstance): void {
  const db = app.db;

  function createSession(reply: FastifyReply, userId: string): void {
    const id = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
      id,
      userId,
      expiresAt,
    );
    reply.setCookie(SESSION_COOKIE, id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // dev: plain http
      path: '/',
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
  }

  function userForRequest(req: FastifyRequest): AuthUser | null {
    const sid = req.cookies[SESSION_COOKIE];
    if (!sid) return null;
    const row = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.pass_hash, u.role, u.created_at, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      )
      .get(sid) as (UserRow & { expires_at: string }) | undefined;
    if (!row) return null;
    if (Date.parse(row.expires_at) <= Date.now()) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
      return null;
    }
    return toAuthUser(row);
  }

  app.decorate('requireUser', async function requireUser(req: FastifyRequest, reply: FastifyReply) {
    const user = userForRequest(req);
    if (!user) {
      await reply.code(401).send({ error: 'unauthenticated' });
      return reply;
    }
    req.user = user;
  });

  app.post('/api/auth/register', async (req, reply) => {
    const body = RegisterBody.parse(req.body);
    const email = body.email.toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return reply.code(409).send({ error: 'email already registered' });
    const count = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    const role: AuthUser['role'] = count === 0 ? 'owner' : 'member';
    const user: UserRow = {
      id: randomUUID(),
      email,
      name: body.name,
      pass_hash: hashPassword(body.password),
      role,
      created_at: nowIso(),
    };
    db.prepare(
      'INSERT INTO users (id, email, name, pass_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(user.id, user.email, user.name, user.pass_hash, user.role, user.created_at);
    createSession(reply, user.id);
    return reply.code(201).send(toAuthUser(user));
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email.toLowerCase()) as
      | UserRow
      | undefined;
    if (!row || !verifyPassword(body.password, row.pass_hash)) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    createSession(reply, row.id);
    return toAuthUser(row);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const sid = req.cookies[SESSION_COOKIE];
    if (sid) db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: app.requireUser }, async (req) => req.user);
}
