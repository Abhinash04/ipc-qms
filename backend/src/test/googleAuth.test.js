import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../services/auth/googleAuthService.js', () => ({ verifyGoogleToken: vi.fn() }));

import app from '../app.js';
import env from '../config/env.js';
import authConfig from '../config/authConfig.js';
import { verifyGoogleToken } from '../services/auth/googleAuthService.js';
import * as audit from '../services/audit/auditService.js';

const OFFICIAL = 'neha.singh@ipc.example';

const sessionCookie = (res) =>
  (res.headers['set-cookie'] || []).find((entry) => entry.startsWith(`${authConfig.COOKIE_NAME}=`));

const googleSays = (email, overrides = {}) =>
  vi.mocked(verifyGoogleToken).mockResolvedValue({ sub: 'google-sub-1', email, name: 'Someone', picture: '', ...overrides });

const signIn = (body = { credential: 'id-token' }) => request(app).post('/api/v1/auth/google').send(body);

beforeEach(() => {
  vi.mocked(verifyGoogleToken).mockReset();
  audit.resetBuffer();
});

describe('POST /auth/google', () => {
  it('asks for the Google credential', async () => {
    const res = await signIn({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_CREDENTIAL');
    expect(verifyGoogleToken).not.toHaveBeenCalled();
  });

  describe('when GOOGLE_CLIENT_ID is not set', () => {
    const original = env.GOOGLE_CLIENT_ID;
    beforeEach(async () => {
      env.GOOGLE_CLIENT_ID = '';
      const actual = await vi.importActual('../services/auth/googleAuthService.js');
      vi.mocked(verifyGoogleToken).mockImplementation(actual.verifyGoogleToken);
    });
    afterEach(() => {
      env.GOOGLE_CLIENT_ID = original;
    });

    it('answers 503 GOOGLE_NOT_CONFIGURED and sets no session', async () => {
      const res = await signIn();

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('GOOGLE_NOT_CONFIGURED');
      expect(sessionCookie(res)).toBeUndefined();
    });
  });

  it('passes an invalid token through as 401 with no session', async () => {
    vi.mocked(verifyGoogleToken).mockRejectedValue(
      Object.assign(new Error('Invalid or expired Google token'), { code: 'INVALID_TOKEN', statusCode: 401 }),
    );

    const res = await signIn();

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
    expect(sessionCookie(res)).toBeUndefined();
  });

  it('refuses a Google account that is not an IPC-QMS staff account, and audits it', async () => {
    googleSays('stranger@gmail.example');

    const res = await signIn();

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NO_ACCOUNT');
    expect(sessionCookie(res)).toBeUndefined();
    const failed = await audit.list({ action: 'LOGIN_FAILED' });
    expect(failed[0].details).toMatchObject({ email: 'stranger@gmail.example', authProvider: 'google' });
  });

  it('signs a staff member in with their directory role, whatever the request claims', async () => {
    googleSays('Neha.Singh@IPC.example');

    const res = await signIn({ credential: 'id-token', role: 'SUPER_ADMIN' });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: 'USR-0004',
      name: 'Neha Singh',
      email: OFFICIAL,
      role: 'ASSIGNED_OFFICIAL',
      divisionId: 'DIV-005',
    });
    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toMatch(/eyJ|password|hash/i);

    const succeeded = await audit.list({ action: 'LOGIN_SUCCEEDED' });
    expect(succeeded[0]).toMatchObject({ actorId: 'USR-0004', details: { authProvider: 'google' } });

    const me = await request(app).get('/api/v1/auth/me').set('Cookie', cookie.split(';')[0]);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ id: 'USR-0004', role: 'ASSIGNED_OFFICIAL' });
  });

  it('leaves password sign-in untouched', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: OFFICIAL, password: 'test-pw-official-0004' });

    expect(res.status).toBe(200);
    expect(verifyGoogleToken).not.toHaveBeenCalled();
  });
});
