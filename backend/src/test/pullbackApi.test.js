import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';

const PATH = '/api/v1/queries/QRY-2026-00001/pullback';
const VALID = { targetStage: 'PENDING_ASSIGNMENT', reason: 'Requires correction' };

describe('POST /api/v1/queries/:queryId/pullback', () => {
  it('returns 401 when the request carries no session', async () => {
    const res = await request(app).post(PATH).send(VALID);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a role that may not perform PULLBACK', async () => {
    for (const role of [ROLES.OFFICER_IN_CHARGE, ROLES.ASSIGNED_OFFICIAL, ROLES.REVIEWER]) {
      const res = await request(app).post(PATH).set(authHeader(role)).send(VALID);
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('PULLBACK');
    }
  });

  it('returns 400 when targetStage or reason is missing or blank', async () => {
    const cases = [
      { reason: 'Requires correction' },
      { targetStage: 'PENDING_ASSIGNMENT' },
      { targetStage: '   ', reason: 'Requires correction' },
      { targetStage: 'PENDING_ASSIGNMENT', reason: '   ' },
    ];

    for (const body of cases) {
      const res = await request(app).post(PATH).set(authHeader(ROLES.ADMIN)).send(body);
      expect(res.status).toBe(400);
    }
  });

  /**
   * The suite runs with DATABASE_URL blank (vitest.config.mjs), so this is the
   * unavailable-storage path. It is asserted deliberately: the handler used to
   * answer 200 with a success envelope while writing nothing, and 503 here is
   * the proof that it no longer claims a pullback it did not perform.
   */
  it('returns 503 rather than a fabricated success when storage is unavailable', async () => {
    for (const role of [ROLES.ADMIN, ROLES.SUPER_ADMIN]) {
      const res = await request(app).post(PATH).set(authHeader(role)).send(VALID);
      expect(res.status).toBe(503);
      expect(res.body.success).toBeUndefined();
    }
  });

  it('no longer exposes the duplicated /api/v1/api/... path', async () => {
    const res = await request(app)
      .post('/api/v1/api/queries/QRY-2026-00001/pullback')
      .set(authHeader(ROLES.ADMIN))
      .send(VALID);
    expect(res.status).toBe(404);
  });
});
