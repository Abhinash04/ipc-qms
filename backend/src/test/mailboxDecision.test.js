import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import { mailboxDecisionSchema } from '../validators/mailboxSchemas.js';

const PATH = '/api/v1/mailbox/messages/msg-1/decision';
const ACCEPT = { decision: 'ACCEPTED', queryId: 'QRY-2026-00001' };

describe('POST /mailbox/messages/:messageId/decision — authorization', () => {
  it('rejects an unauthenticated caller', async () => {
    const res = await request(app).post(PATH).send(ACCEPT);
    expect(res.status).toBe(401);
  });

  it('is refused to every role except Front Office and Super Admin', async () => {
    const denied = [
      ROLES.OFFICER_IN_CHARGE,
      ROLES.ASSIGNED_OFFICIAL,
      ROLES.REVIEWER,
      ROLES.ADMIN,
    ];

    for (const role of denied) {
      const res = await request(app).post(PATH).set(authHeader(role)).send(ACCEPT);
      expect(res.status).toBe(403);
    }
  });

  it('is allowed to the Front Officer, whose mailbox it is', async () => {
    const res = await request(app).post(PATH).set(authHeader(ROLES.FRONT_OFFICE)).send(ACCEPT);
    expect(res.status).not.toBe(403);
  });
});

describe('GET /mailbox/decisions', () => {
  it('is held to the same roles as the mailbox itself', async () => {
    expect((await request(app).get('/api/v1/mailbox/decisions')).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/mailbox/decisions').set(authHeader(ROLES.ASSIGNED_OFFICIAL))).status,
    ).toBe(403);
    expect(
      (await request(app).get('/api/v1/mailbox/decisions').set(authHeader(ROLES.FRONT_OFFICE)))
        .status,
    ).not.toBe(403);
  });
});

describe('decision storage availability', () => {
  it('answers 503, not 500, when the database is not connected', async () => {
    const res = await request(app).post(PATH).set(authHeader(ROLES.FRONT_OFFICE)).send(ACCEPT);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/unavailable/i);
  });
});

describe('the decision schema', () => {
  it('admits only ACCEPTED or REJECTED', () => {
    expect(mailboxDecisionSchema.safeParse({ decision: 'ACCEPTED' }).success).toBe(true);
    expect(mailboxDecisionSchema.safeParse({ decision: 'REJECTED' }).success).toBe(true);
    expect(mailboxDecisionSchema.safeParse({ decision: 'MAYBE' }).success).toBe(false);
    expect(mailboxDecisionSchema.safeParse({}).success).toBe(false);
  });

  it('strips an actor supplied by the caller', () => {
    const parsed = mailboxDecisionSchema.parse({
      decision: 'REJECTED',
      reason: 'Advertisement',
      decidedByUserId: 'USR-0008',
      decidedByRole: 'SUPER_ADMIN',
      decidedAt: '1999-01-01T00:00:00.000Z',
    });

    expect(parsed).toEqual({ decision: 'REJECTED', reason: 'Advertisement' });
  });

  it('keeps the message snapshot that makes a rejection answerable later', () => {
    const parsed = mailboxDecisionSchema.parse({
      decision: 'REJECTED',
      message: {
        from: 'Spammer <spam@example.com>',
        subject: 'Win a prize',
        receivedAt: '2026-09-17T08:00:00.000Z',
        body: 'dropped — not part of the snapshot',
      },
    });

    expect(parsed.message).toEqual({
      from: 'Spammer <spam@example.com>',
      subject: 'Win a prize',
      receivedAt: '2026-09-17T08:00:00.000Z',
    });
  });

  it('rejects a reason long enough to be a payload rather than a reason', () => {
    expect(
      mailboxDecisionSchema.safeParse({ decision: 'REJECTED', reason: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
});
