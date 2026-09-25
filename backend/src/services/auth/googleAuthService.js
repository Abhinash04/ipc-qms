import { OAuth2Client } from 'google-auth-library';
import env from '../../config/env.js';

export async function verifyGoogleToken(idToken) {
  const clientId = env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    const error = new Error('Google Sign Up is not configured yet.');
    error.code = 'GOOGLE_NOT_CONFIGURED';
    error.statusCode = 503;
    throw error;
  }

  if (!idToken || typeof idToken !== 'string') {
    const error = new Error('Google credential is required');
    error.code = 'MISSING_CREDENTIAL';
    error.statusCode = 400;
    throw error;
  }

  try {
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({
      idToken,
      audience: clientId,
    });

    const payload = ticket.getPayload();

    if (!payload) {
      const error = new Error('Invalid Google payload');
      error.code = 'INVALID_PAYLOAD';
      error.statusCode = 401;
      throw error;
    }

    if (!payload.sub) {
      const error = new Error('Missing Google sub identifier');
      error.code = 'INVALID_SUB';
      error.statusCode = 401;
      throw error;
    }

    if (!payload.email) {
      const error = new Error('Google account email is missing');
      error.code = 'MISSING_EMAIL';
      error.statusCode = 400;
      throw error;
    }

    if (payload.email_verified === false) {
      const error = new Error('Google account email is not verified');
      error.code = 'UNVERIFIED_EMAIL';
      error.statusCode = 400;
      throw error;
    }

    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name || payload.email.split('@')[0],
      picture: payload.picture || '',
    };
  } catch (err) {
    if (err.code && err.statusCode) {
      throw err;
    }
    const error = new Error('Invalid or expired Google token');
    error.code = 'INVALID_TOKEN';
    error.statusCode = 401;
    throw error;
  }
}
