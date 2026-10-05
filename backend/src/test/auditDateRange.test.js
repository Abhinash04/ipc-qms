import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import * as audit from '../services/audit/auditService.js';

const ADMIN = authHeader(ROLES.ADMIN);

const at = (timestamp, action = 'EMAIL_SENT') => audit.record({ action, timestamp, messageId: timestamp });

beforeEach(async () => {
  audit.resetBuffer();
  await at('2026-09-29T23:59:59.000Z');
  await at('2026-09-30T00:00:00.000Z');
  await at('2026-09-30T18:45:00.000Z');
  await at('2026-10-01T00:00:00.001Z');
});

const listed = async (query) =>
  (await request(app).get('/api/v1/audit').query(query).set(ADMIN)).body.events.map((e) => e.messageId).sort();

describe('the audit date range', () => {
  it('includes the whole of a bare "to" date', async () => {
    expect(await listed({ from: '2026-09-30', to: '2026-09-30' })).toEqual([
      '2026-09-30T00:00:00.000Z',
      '2026-09-30T18:45:00.000Z',
    ]);
  });

  it('uses a full timestamp exactly', async () => {
    expect(await listed({ to: '2026-09-30T12:00:00.000Z' })).toEqual([
      '2026-09-29T23:59:59.000Z',
      '2026-09-30T00:00:00.000Z',
    ]);
  });

  it('builds the same range for the database', () => {
    expect(audit.toMongoFilter({ from: '2026-09-30', to: '2026-09-30' }).timestamp).toEqual({
      $gte: '2026-09-30',
      $lte: '2026-09-30T23:59:59.999Z',
    });
    expect(audit.toMongoFilter({ to: '2026-09-30T12:00:00.000Z' }).timestamp).toEqual({ $lte: '2026-09-30T12:00:00.000Z' });
  });
});
