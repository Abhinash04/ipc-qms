import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import authConfig from '../config/authConfig.js';
import { validateAuthConfig } from '../config/authConfig.js';
import { reset as resetCredentials } from '../services/auth/credentials.js';
import { AUTH, authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';

const PASSWORD = 'test-pw-superadmin-0008';
const SUPER_ADMIN = 'admin@ipc.example';

const OFFICIAL = 'neha.singh@ipc.example';
const OFFICIAL_PASSWORD = 'test-pw-official-0004';

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

    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body.error).toBe(wrong.body.error);
  });

  it('400s when a field is missing', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: SUPER_ADMIN });
    expect(res.status).toBe(400);
  });

  it('does not accept one account password for a different account', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: SUPER_ADMIN, password: OFFICIAL_PASSWORD });

    expect(res.status).toBe(401);
    expect(sessionCookie(res)).toBeUndefined();
  });

  it('accepts each account only with its own password', async () => {
    const official = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: OFFICIAL, password: OFFICIAL_PASSWORD });
    expect(official.status).toBe(200);
    expect(official.body.user).toMatchObject({ id: 'USR-0004', role: 'ASSIGNED_OFFICIAL' });

    const crossed = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: OFFICIAL, password: PASSWORD });
    expect(crossed.status).toBe(401);
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
      .send({ email: OFFICIAL, password: OFFICIAL_PASSWORD });

    const res = await request(app).get('/api/v1/auth/me').set('Cookie', sessionCookie(login));

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('ASSIGNED_OFFICIAL');
  });
});

describe('GET /auth/users', () => {
  it('401s with no session cookie', async () => {
    expect((await request(app).get('/api/v1/auth/users')).status).toBe(401);
  });

  it('returns the directory to a signed-in caller, with no credential material', async () => {
    const res = await request(app).get('/api/v1/auth/users').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThan(1);
    expect(res.body.users[0]).toHaveProperty('email');

    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toMatch(/password|hash|secret/i);
  });

  it('is readable by any role — it is a directory, not an admin console', async () => {
    const res = await request(app).get('/api/v1/auth/users').set(authHeader(ROLES.REVIEWER));
    expect(res.status).toBe(200);
  });
});

describe('POST /auth/logout', () => {
  it('clears the session cookie', async () => {
    const res = await request(app).post('/api/v1/auth/logout').set(AUTH);

    expect(res.status).toBe(200);
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

  it('requires a credential for every seeded account', () => {
    vi.stubEnv('QMS_PASSWORDS_FILE', '');
    resetCredentials();

    const errors = validateAuthConfig();
    expect(errors).toContainEqual(expect.stringContaining('No sign-in credential configured for'));
    expect(errors.join(' ')).toContain('QMS_PASSWORD_USR_0008');

    vi.unstubAllEnvs();
    resetCredentials();
  });

  it('requires QMS_SEED_PASSWORD when the shared-password mode is enabled', () => {
    vi.stubEnv('QMS_ALLOW_SHARED_PASSWORD', 'true');
    resetCredentials();

    expect(validateAuthConfig({ ...authConfig, SEED_PASSWORD: '' })).toContainEqual(
      expect.stringContaining('requires QMS_SEED_PASSWORD'),
    );

    vi.unstubAllEnvs();
    resetCredentials();
  });

  it('accepts the suite configuration as valid', () => {
    expect(validateAuthConfig()).toEqual([]);
  });
});
