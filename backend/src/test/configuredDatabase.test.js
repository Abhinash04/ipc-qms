import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../services/email/emailService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendAcknowledgement: vi.fn(),
}));

vi.mock('../services/email/caseMail.js', async (importOriginal) => ({
  ...(await importOriginal()),
  acknowledge: vi.fn(),
}));

import app from '../app.js';
import env from '../config/env.js';
import { isConnected } from '../config/db.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import { OUTCOMES } from '../services/email/outbox.js';
import * as mailbox from '../services/email/mailbox/index.js';
import * as audit from '../services/audit/auditService.js';
import * as emailService from '../services/email/emailService.js';
import * as caseMail from '../services/email/caseMail.js';

const QUERY_ID = 'QRY-2026-00001';
const original = env.DATABASE_URL;

beforeEach(() => {
  env.DATABASE_URL = 'mongodb://127.0.0.1:27017/qms_unit';
  caseMail.acknowledge.mockReset().mockResolvedValue({ outcome: OUTCOMES.SENT, sent: null });
  emailService.sendAcknowledgement.mockReset();
});

afterEach(() => {
  env.DATABASE_URL = original;
  mailbox.forceInMemory();
});

describe('a configured database that is not connected yet', () => {
  it('keeps the mailbox on Mongo', () => {
    mailbox.useAuto();

    expect(isConnected()).toBe(false);
    expect(mailbox.describe().backend).toBe('mongo');
  });

  it('keeps the audit trail durable', () => {
    expect(audit.describe()).toEqual({ backend: 'mongo', durable: true });
  });

  it('sends the acknowledgement through the case ledger, never the legacy direct send', async () => {
    const res = await request(app)
      .post('/api/v1/emails/acknowledgement')
      .set(authHeader(ROLES.FRONT_OFFICE))
      .send({ queryId: QUERY_ID, to: 'ravi@pharma.example' });

    expect(res.status).toBe(201);
    expect(caseMail.acknowledge).toHaveBeenCalledWith(expect.objectContaining({ queryId: QUERY_ID }));
    expect(emailService.sendAcknowledgement).not.toHaveBeenCalled();
  });
});
