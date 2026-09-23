import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/db.js', () => ({
  isConnected: () => true,
  mongoose: { Schema: class {}, model: () => ({}), models: {} },
}));

const create = vi.fn();
const find = vi.fn(() => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }));
vi.mock('../models/AuditEvent.js', () => ({ AuditEvent: { create, find } }));

const audit = await import('../services/audit/auditService.js');
const { AUDIT_ACTIONS } = await import('../constants/auditActions.js');

let errorSpy;

beforeEach(() => {
  create.mockReset();
  audit.resetBuffer();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('a failing audit write', () => {
  it('does not throw', async () => {
    create.mockRejectedValue(new Error('connection lost mid-write'));

    await expect(
      audit.record({ action: AUDIT_ACTIONS.EMAIL_SENT, messageId: 'MSG-1' }),
    ).resolves.toBeTruthy();
  });

  it('reports the event as not persisted', async () => {
    create.mockRejectedValue(new Error('connection lost mid-write'));

    const event = await audit.record({ action: AUDIT_ACTIONS.EMAIL_SENT });
    expect(event.persisted).toBe(false);
  });

  it('keeps the event in the buffer rather than losing it outright', async () => {
    create.mockRejectedValue(new Error('connection lost mid-write'));

    await audit.record({ action: AUDIT_ACTIONS.EMAIL_SENT, messageId: 'MSG-2' });

    const [kept] = await audit.list({ action: AUDIT_ACTIONS.EMAIL_SENT });
    expect(kept.messageId).toBe('MSG-2');
  });

  it('says what failed, on stderr', async () => {
    create.mockRejectedValue(new Error('connection lost mid-write'));

    await audit.record({ action: AUDIT_ACTIONS.EMAIL_SENT });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('EMAIL_SENT'));
  });
});

describe('a successful audit write', () => {
  it('marks the event persisted and does not buffer it', async () => {
    create.mockResolvedValue({});

    const event = await audit.record({ action: AUDIT_ACTIONS.EMAIL_SENT, messageId: 'MSG-3' });

    expect(event.persisted).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
