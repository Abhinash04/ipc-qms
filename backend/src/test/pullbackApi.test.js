import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';

describe('POST /api/v1/queries/:queryId/pullback API endpoint tests', () => {
  it('returns 401 Unauthorized if request has no auth session', async () => {
    const res = await request(app)
      .post('/api/v1/queries/QRY-2026-00001/pullback')
      .send({ targetStage: 'PENDING_ASSIGNMENT', reason: 'Requires correction' });
    expect(res.status).toBe(401);
  });

  it('returns 403 Forbidden if called by a non-Admin user (e.g. Officer-in-Charge or Official)', async () => {
    const res1 = await request(app)
      .post('/api/v1/queries/QRY-2026-00001/pullback')
      .set(authHeader(ROLES.OFFICER_IN_CHARGE))
      .send({ targetStage: 'PENDING_ASSIGNMENT', reason: 'Requires correction' });
    expect(res1.status).toBe(403);
    expect(res1.body.error).toContain('You do not have permission to pull back this query.');

    const res2 = await request(app)
      .post('/api/v1/queries/QRY-2026-00001/pullback')
      .set(authHeader(ROLES.ASSIGNED_OFFICIAL))
      .send({ targetStage: 'PENDING_ASSIGNMENT', reason: 'Requires correction' });
    expect(res2.status).toBe(403);
    expect(res2.body.error).toContain('You do not have permission to pull back this query.');
  });

  it('returns 400 Bad Request if targetStage or reason is missing', async () => {
    const res1 = await request(app)
      .post('/api/v1/queries/QRY-2026-00001/pullback')
      .set(authHeader(ROLES.ADMIN))
      .send({ reason: 'Requires correction' });
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .post('/api/v1/queries/QRY-2026-00001/pullback')
      .set(authHeader(ROLES.ADMIN))
      .send({ targetStage: 'PENDING_ASSIGNMENT' });
    expect(res2.status).toBe(400);
  });

  it('returns 200 OK and pullback payload for ADMIN and SUPER_ADMIN users', async () => {
    const payload = {
      targetStage: 'PENDING_ASSIGNMENT',
      reason: 'Incorrect assignment',
      remarks: 'Reassigning to correct department.',
    };

    const resAdmin = await request(app)
      .post('/api/v1/queries/QRY-2026-00001/pullback')
      .set(authHeader(ROLES.ADMIN))
      .send(payload);

    expect(resAdmin.status).toBe(200);
    expect(resAdmin.body.success).toBe(true);
    expect(resAdmin.body.queryId).toBe('QRY-2026-00001');
    expect(resAdmin.body.targetStage).toBe('PENDING_ASSIGNMENT');
    expect(resAdmin.body.reason).toBe('Incorrect assignment');
    expect(resAdmin.body.remarks).toBe('Reassigning to correct department.');
    expect(resAdmin.body.pulledBackBy.role).toBe(ROLES.ADMIN);

    const resSuper = await request(app)
      .post('/api/v1/queries/QRY-2026-00001/pullback')
      .set(authHeader(ROLES.SUPER_ADMIN))
      .send(payload);

    expect(resSuper.status).toBe(200);
    expect(resSuper.body.success).toBe(true);
    expect(resSuper.body.pulledBackBy.role).toBe(ROLES.SUPER_ADMIN);
  });
});
