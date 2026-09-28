import { OAuth2Client } from 'google-auth-library';
import env from '../../config/env.js';

function failure(message, code, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

export async function verifyGoogleToken(idToken) {
  const clientId = env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    throw failure('Google sign-in is not configured yet.', 'GOOGLE_NOT_CONFIGURED', 503);
  }

  if (!idToken || typeof idToken !== 'string') {
    throw failure('Google credential is required', 'MISSING_CREDENTIAL', 400);
  }

  try {
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();

    if (!payload) throw failure('Invalid Google payload', 'INVALID_PAYLOAD', 401);
    if (!payload.sub) throw failure('Missing Google sub identifier', 'INVALID_SUB', 401);
    if (!payload.email) throw failure('Google account email is missing', 'MISSING_EMAIL', 400);
    if (payload.email_verified !== true) {
      throw failure('Google account email is not verified', 'UNVERIFIED_EMAIL', 400);
    }

    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name || payload.email.split('@')[0],
      picture: payload.picture || '',
    };
  } catch (error) {
    if (error.code && error.statusCode) throw error;
    throw failure('Invalid or expired Google token', 'INVALID_TOKEN', 401);
  }
}
