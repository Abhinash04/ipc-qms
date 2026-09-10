import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import authConfig from '../config/authConfig.js';
import { validateAuthConfig } from '../config/authConfig.js';
import { AUTH } from './helpers/auth.js';

/** vitest.config.mjs sets QMS_SEED_PASSWORD for the whole suite. */
const PASSWORD = 'test-seed-password';
const SUPER_ADMIN = 'admin@ipc.example';

/** The `Set-Cookie` entry for the session, or undefined. */
const sessionCookie = (res) =>
  (res.headers['set-cookie'] || []).find((entry) => entry.startsWith(`${authConfig.COOKIE_NAME}=`));

describe('POST /auth/login', () => {
  it('sets an httpOnly session cookie and returns the public user', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: SUPER_ADMIN, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 'USR-0008', role: 'SUPER_ADMIN', email: SUPER_ADMIN });

    const cookie = sessionCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('never returns the token in the body — it is cookie-only', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: SUPER_ADMIN, password: PASSWORD });

    expect(res.body.token).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/eyJ|password|hash/i);
  });

  it('is case-insensitive about the address', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ADMIN@IPC.EXAMPLE', password: PASSWORD });

    expect(res.status).toBe(200);
  });

  it('rejects a wrong password with 401 and no cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: SUPER_ADMIN, password: 'not-the-password' });

    expect(res.status).toBe(401);
    expect(sessionCookie(res)).toBeUndefined();
  });

  it('gives an unknown address the same answer as a wrong password', async () => {
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@ipc.example', password: PASSWORD });
    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: SUPER_ADMIN, password: 'not-the-password' });

    // Distinguishing the two would enumerate valid accounts.
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body.error).toBe(wrong.body.error);
  });

  it('400s when a field is missing', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: SUPER_ADMIN });
    expect(res.status).toBe(400);
  });
});

describe('GET /auth/me', () => {
  it('401s with no session cookie', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('401s on a forged or malformed cookie', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', `${authConfig.COOKIE_NAME}=not-a-real-jwt`);

    expect(res.status).toBe(401);
  });

  it('returns the signed-in user', async () => {
    const res = await request(app).get('/api/v1/auth/me').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 'USR-0008', role: 'SUPER_ADMIN' });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('accepts the cookie the login endpoint actually issued', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'neha.singh@ipc.example', password: PASSWORD });

    const res = await request(app).get('/api/v1/auth/me').set('Cookie', sessionCookie(login));

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('ASSIGNED_OFFICIAL');
  });
});

describe('POST /auth/logout', () => {
  it('clears the session cookie', async () => {
    const res = await request(app).post('/api/v1/auth/logout').set(AUTH);

    expect(res.status).toBe(200);
    // An expiry in the past is how a cookie is removed.
    expect(sessionCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
  });

  it('is safe to call without a session', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(200);
  });
});

describe('auth configuration', () => {
  it('requires a JWT secret of at least 32 characters', () => {
    expect(validateAuthConfig({ ...authConfig, JWT_SECRET: '' })).toContainEqual(
      expect.stringContaining('JWT_SECRET is required'),
    );
    expect(validateAuthConfig({ ...authConfig, JWT_SECRET: 'short' })).toContainEqual(
      expect.stringContaining('at least 32 characters'),
    );
  });

  it('requires a seed password', () => {
    expect(validateAuthConfig({ ...authConfig, SEED_PASSWORD: '' })).toContainEqual(
      expect.stringContaining('QMS_SEED_PASSWORD is required'),
    );
  });

  it('accepts the suite configuration as valid', () => {
    expect(validateAuthConfig()).toEqual([]);
  });
});
