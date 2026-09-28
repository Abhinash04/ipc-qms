import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const verifyIdToken = vi.fn();

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn(function OAuth2Client(clientId) {
    this.clientId = clientId;
    this.verifyIdToken = verifyIdToken;
  }),
}));

import { OAuth2Client } from 'google-auth-library';
import env from '../config/env.js';
import { verifyGoogleToken } from '../services/auth/googleAuthService.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const original = env.GOOGLE_CLIENT_ID;

const ticket = (payload) => ({ getPayload: () => payload });

beforeEach(() => {
  env.GOOGLE_CLIENT_ID = CLIENT_ID;
  verifyIdToken.mockReset();
  vi.mocked(OAuth2Client).mockClear();
});
afterEach(() => {
  env.GOOGLE_CLIENT_ID = original;
});

describe('verifying a Google ID token', () => {
  it('refuses with GOOGLE_NOT_CONFIGURED when no client id is set', async () => {
    env.GOOGLE_CLIENT_ID = '';
    await expect(verifyGoogleToken('token')).rejects.toMatchObject({
      code: 'GOOGLE_NOT_CONFIGURED',
      statusCode: 503,
    });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('requires a credential string', async () => {
    await expect(verifyGoogleToken(undefined)).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL', statusCode: 400 });
  });

  it('checks the token against this client id as the audience', async () => {
    verifyIdToken.mockResolvedValue(
      ticket({ sub: 'g-1', email: 'Staff@ipc.example', email_verified: true, name: 'Staff Member', picture: 'p' }),
    );

    const result = await verifyGoogleToken('token');

    expect(OAuth2Client).toHaveBeenCalledWith(CLIENT_ID);
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'token', audience: CLIENT_ID });
    expect(result).toEqual({ sub: 'g-1', email: 'Staff@ipc.example', name: 'Staff Member', picture: 'p' });
  });

  it.each([
    ['unverified', { sub: 'g-1', email: 'a@ipc.example', email_verified: false }, 'UNVERIFIED_EMAIL', 400],
    ['missing the verified claim', { sub: 'g-1', email: 'a@ipc.example' }, 'UNVERIFIED_EMAIL', 400],
    ['without an email', { sub: 'g-1', email_verified: true }, 'MISSING_EMAIL', 400],
    ['without a subject', { email: 'a@ipc.example', email_verified: true }, 'INVALID_SUB', 401],
  ])('rejects a token %s', async (_label, payload, code, statusCode) => {
    verifyIdToken.mockResolvedValue(ticket(payload));
    await expect(verifyGoogleToken('token')).rejects.toMatchObject({ code, statusCode });
  });

  it('reports a forged or expired token as INVALID_TOKEN', async () => {
    verifyIdToken.mockRejectedValue(new Error('Token used too late'));
    await expect(verifyGoogleToken('token')).rejects.toMatchObject({ code: 'INVALID_TOKEN', statusCode: 401 });
  });
});
