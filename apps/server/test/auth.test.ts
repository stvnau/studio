import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cookieFrom, makeServer, registerUser, type TestServer } from './helpers.js';

describe('auth', () => {
  let t: TestServer;
  beforeEach(async () => {
    t = await makeServer();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it('first registered user becomes owner, second becomes member', async () => {
    const first = await registerUser(t.app, 'owner@example.com', 'Owner');
    expect(first.res.json()).toMatchObject({ email: 'owner@example.com', role: 'owner' });

    const second = await registerUser(t.app, 'member@example.com', 'Member');
    expect(second.res.json()).toMatchObject({ email: 'member@example.com', role: 'member' });
  });

  it('login sets the session cookie and /api/auth/me round-trips', async () => {
    await registerUser(t.app, 'me@example.com', 'Me', 'hunter2hunter2');

    const login = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'me@example.com', password: 'hunter2hunter2' },
    });
    expect(login.statusCode).toBe(200);
    const cookie = cookieFrom(login);
    expect(cookie).toMatch(/^gs_session=/);
    const rawSetCookie = String(login.headers['set-cookie']);
    expect(rawSetCookie).toMatch(/HttpOnly/i);
    expect(rawSetCookie).toMatch(/SameSite=Lax/i);

    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: 'me@example.com', name: 'Me', role: 'owner' });
  });

  it('rejects a wrong password with 401', async () => {
    await registerUser(t.app, 'me@example.com', 'Me', 'hunter2hunter2');
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'me@example.com', password: 'wrong-password' },
    });
    expect(login.statusCode).toBe(401);
  });

  it('rejects short passwords and bad emails with 400', async () => {
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'not-an-email', name: 'X', password: 'short' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().issues).toBeTruthy();
  });

  it('requires auth for /api/businesses', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/businesses' });
    expect(res.statusCode).toBe(401);
  });

  it('logout invalidates the session', async () => {
    const { cookie } = await registerUser(t.app);
    const out = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(out.statusCode).toBe(200);
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });
});
