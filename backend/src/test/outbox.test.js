import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../models/OutboundEmail.js', async (importOriginal) => ({
  ...(await importOriginal()),
  OutboundEmail: (await import('./support/memoryDb.js')).memoryDb.model('OutboundEmail', {
    unique: ['dispatchKey'],
  }),
}));
vi.mock('../models/EmailMessage.js', async () => ({
  EmailMessage: (await import('./support/memoryDb.js')).memoryDb.model('EmailMessage', {
    unique: ['messageId'],
  }),
}));

import { memoryDb } from './support/memoryDb.js';
import { dispatchOnce, resolveUncertain, OUTCOMES, DELIVERY, dispatchKey } from '../services/email/outbox.js';
import { OutboundEmail, EmailMessage } from '../models/index.js';

const QUERY_ID = 'QRY-2026-00001';
const KEY = dispatchKey('OUTGOING_RESPONSE', QUERY_ID);

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const slowSuccess = () =>
  vi.fn(async () => {
    await tick();
    return { providerMessageId: 'provider-1', providerThreadId: 'thread-1', transport: 'nic', sentAt: '2026-09-18T10:00:00.000Z' };
  });

const failWith = (properties, message = 'send failed') =>
  vi.fn(async () => {
    throw Object.assign(new Error(message), properties);
  });

const dispatch = (overrides = {}) =>
  dispatchOnce({
    queryId: QUERY_ID,
    emailType: 'OUTGOING_RESPONSE',
    recipients: ['ravi@pharma.example'],
    subject: 'Re: Dissolution limits [QRY-2026-00001]',
    transport: 'nic',
    quickRetryDelayMs: 0,
    ...overrides,
  });

const row = async () => OutboundEmail.findOne({ dispatchKey: KEY }).lean();

beforeEach(() => {
  memoryDb.reset();
});

describe('two requests, one email', () => {
  it('sends once when three requests arrive together', async () => {
    const send = slowSuccess();

    const results = await Promise.all([dispatch({ send }), dispatch({ send }), dispatch({ send })]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.outcome === OUTCOMES.SENT)).toHaveLength(1);
    expect(results.filter((r) => r.outcome === OUTCOMES.IN_PROGRESS)).toHaveLength(2);
    expect((await row()).status).toBe('SENT');
  });

  it('answers a later request from the record, without sending again', async () => {
    const send = slowSuccess();
    await dispatch({ send });

    const again = await dispatch({ send });

    expect(again.outcome).toBe(OUTCOMES.ALREADY_SENT);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('finishes the bookkeeping of a send whose recording failed', async () => {
    const send = slowSuccess();
    const finalize = vi
      .fn()
      .mockRejectedValueOnce(new Error('mongo went away'))
      .mockResolvedValue(undefined);

    const first = await dispatch({ send, finalize });
    expect(first.outcome).toBe(OUTCOMES.SENT);
    expect((await row()).status).toBe('SENT');

    const second = await dispatch({ send, finalize });
    expect(second.outcome).toBe(OUTCOMES.ALREADY_SENT);
    expect(finalize).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('a send that provably did not go out', () => {
  it('is FAILED, and can be claimed again', async () => {
    const send = failWith({ code: 'ENOTFOUND' }, 'getaddrinfo ENOTFOUND smtp.mgovcloud.in');
    const onFailure = vi.fn();

    const result = await dispatch({ send, onFailure });

    expect(result.outcome).toBe(OUTCOMES.FAILED);
    expect(result.retryable).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0][2]).toBe(DELIVERY.NOT_SENT);

    const stored = await row();
    expect(stored.status).toBe('FAILED');
    expect(stored.lastError).toMatch(/ENOTFOUND/);

    const retry = await dispatch({ send: slowSuccess() });
    expect(retry.outcome).toBe(OUTCOMES.SENT);
  });

  it('self-heals when the second attempt succeeds', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' }))
      .mockResolvedValue({ providerMessageId: 'provider-2', transport: 'nic' });
    const onFailure = vi.fn();

    const result = await dispatch({ send, onFailure });

    expect(result.outcome).toBe(OUTCOMES.SENT);
    expect(send).toHaveBeenCalledTimes(2);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('does not retry a request the provider refused', async () => {
    const send = failWith({ status: 400 }, 'Invalid To header');

    const result = await dispatch({ send });

    expect(result.outcome).toBe(OUTCOMES.FAILED);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('treats a local failure as not sent — nothing reached the provider', async () => {
    const send = failWith({}, 'NICeMail SMTP selected but no app password is configured.');

    const result = await dispatch({ send });

    expect(result.outcome).toBe(OUTCOMES.FAILED);
    expect((await row()).lastOutcome).toBe(DELIVERY.NOT_SENT);
  });

  it('records the step a staged sender stopped at, with its cause, where the Front Office reads it', async () => {
    const send = failWith(
      {
        failedStep: 'fill_body',
        cause: new Error('focus moved to a dialog'),
        seen: 'dialog open: "Email Satisfaction Survey"',
      },
      'The NICeMail message editor does not hold the message body; nothing was sent.',
    );

    const result = await dispatch({ send });

    const recorded =
      'The NICeMail message editor does not hold the message body; nothing was sent. ' +
      '[stage: fill_body; cause: focus moved to a dialog; seen: dialog open: "Email Satisfaction Survey"]';
    expect(result).toMatchObject({ outcome: OUTCOMES.FAILED, stage: 'fill_body', error: recorded });
    expect((await row()).lastError).toBe(recorded);
  });
});

describe('a send that may have gone out', () => {
  const uncertainSend = () => failWith({ code: 'ECONNRESET' }, 'socket hang up');

  it('is UNCERTAIN, and is never sent again on its own', async () => {
    const send = uncertainSend();
    const onFailure = vi.fn();

    const result = await dispatch({ send, onFailure });

    expect(result.outcome).toBe(OUTCOMES.UNCERTAIN);
    expect(result.unconfirmed).toBe(true);
    expect(onFailure.mock.calls[0][2]).toBe(DELIVERY.UNCERTAIN);
    expect((await row()).status).toBe('UNCERTAIN');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('is settled by the Sent folder: found means sent, and nothing is sent again', async () => {
    await dispatch({ send: uncertainSend() });

    const send = slowSuccess();
    const reconcile = vi.fn(async () => ({ verdict: 'SENT', providerMessageId: 'provider-9' }));
    const finalize = vi.fn();

    const result = await dispatch({ send, reconcile, finalize });

    expect(result.outcome).toBe(OUTCOMES.ALREADY_SENT);
    expect(result.reconciled).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledTimes(1);
    expect((await row()).providerMessageId).toBe('provider-9');
  });

  it('is settled by the Sent folder: absent means it can be sent', async () => {
    await dispatch({ send: uncertainSend() });

    const send = slowSuccess();
    const result = await dispatch({ send, reconcile: async () => 'NOT_SENT' });

    expect(result.outcome).toBe(OUTCOMES.SENT);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses to send while the answer is unknown', async () => {
    await dispatch({ send: uncertainSend() });

    const send = slowSuccess();
    const result = await dispatch({ send, reconcile: async () => 'UNKNOWN' });

    expect(result.outcome).toBe(OUTCOMES.BLOCKED_UNCERTAIN);
    expect(result.error).toMatch(/may already have sent/i);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses to send when the transport cannot be asked at all', async () => {
    await dispatch({ send: uncertainSend() });

    const send = slowSuccess();
    const result = await dispatch({ send });

    expect(result.outcome).toBe(OUTCOMES.BLOCKED_UNCERTAIN);
    expect(send).not.toHaveBeenCalled();
  });

  it('turns an abandoned claim into UNCERTAIN rather than sending again', async () => {
    await OutboundEmail.create({
      dispatchKey: KEY,
      queryId: QUERY_ID,
      emailType: 'OUTGOING_RESPONSE',
      status: 'SENDING',
      attempts: 1,
      claimToken: 'a-process-that-is-gone',
      leaseExpiresAt: '2020-01-01T00:00:00.000Z',
      attemptedAt: '2020-01-01T00:00:00.000Z',
    });

    const send = slowSuccess();
    const result = await dispatch({ send });

    expect(result.outcome).toBe(OUTCOMES.BLOCKED_UNCERTAIN);
    expect(send).not.toHaveBeenCalled();
    expect((await row()).status).toBe('UNCERTAIN');
  });
});

describe('a case answered before this ledger existed', () => {
  it('is adopted as sent, and never answered twice', async () => {
    await EmailMessage.create({
      messageId: 'MSG-00005',
      queryId: QUERY_ID,
      emailType: 'OUTGOING_RESPONSE',
      direction: 'OUTBOUND',
      to: ['ravi@pharma.example'],
      subject: 'Re: Dissolution limits [QRY-2026-00001]',
      timestamp: '2026-09-18T09:45:44.239Z',
      providerMessageId: 'provider-legacy',
    });

    const send = slowSuccess();
    const result = await dispatch({ send });

    expect(result.outcome).toBe(OUTCOMES.ALREADY_SENT);
    expect(send).not.toHaveBeenCalled();
    expect(await row()).toMatchObject({ status: 'SENT', providerMessageId: 'provider-legacy' });
  });
});

describe('a person settles what the server could not', () => {
  beforeEach(async () => {
    await dispatch({ send: failWith({ unconfirmed: true }, 'NICeMail did not confirm the send') });
  });

  it('records it as sent, and runs the bookkeeping that a send would', async () => {
    const finalize = vi.fn();

    const { dispatch: settled } = await resolveUncertain({
      queryId: QUERY_ID,
      emailType: 'OUTGOING_RESPONSE',
      outcome: 'SENT',
      actor: { id: 'USR-0014', role: 'FRONT_OFFICE' },
      finalize,
    });

    expect(settled.status).toBe('SENT');
    expect(settled.resolvedBy).toMatchObject({ id: 'USR-0014', outcome: 'SENT' });
    expect(finalize).toHaveBeenCalledTimes(1);

    const send = slowSuccess();
    expect((await dispatch({ send })).outcome).toBe(OUTCOMES.ALREADY_SENT);
    expect(send).not.toHaveBeenCalled();
  });

  it('records it as not sent, which unlocks the retry', async () => {
    await resolveUncertain({
      queryId: QUERY_ID,
      emailType: 'OUTGOING_RESPONSE',
      outcome: 'NOT_SENT',
      actor: { id: 'USR-0014', role: 'FRONT_OFFICE' },
    });

    expect((await row()).status).toBe('FAILED');

    const send = slowSuccess();
    expect((await dispatch({ send })).outcome).toBe(OUTCOMES.SENT);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses to settle a send that is not in doubt', async () => {
    await resolveUncertain({ queryId: QUERY_ID, emailType: 'OUTGOING_RESPONSE', outcome: 'SENT' });

    await expect(
      resolveUncertain({ queryId: QUERY_ID, emailType: 'OUTGOING_RESPONSE', outcome: 'NOT_SENT' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
