import { describe, it, expect, vi } from 'vitest';
import { buildRawMessage, send, reconcile } from '../services/email/transports/gmailTransport.js';
import {
  classifyDelivery,
  isTransientNetworkFailure,
  isUnreachable,
  isAuthFailure,
  DELIVERY,
} from '../services/email/delivery.js';

/**
 * Telling a send that never left from one that might have.
 *
 * Everything downstream rests on this single judgement: a NOT_SENT failure may
 * be retried, and an UNCERTAIN one may not be. The live failure that prompted
 * it — `getaddrinfo ENOTFOUND gmail.googleapis.com` — is the clearest case of
 * "nothing left this machine", and it was being treated exactly like a timeout
 * mid-request, which is the opposite.
 */

const decode = (raw) => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();

const gaxiosError = (message, properties = {}) =>
  Object.assign(new Error(message), { config: { url: 'https://gmail.googleapis.com/…' }, ...properties });

describe('classifying a failed send', () => {
  it('counts a DNS failure as never sent', () => {
    const error = gaxiosError('request to https://gmail.googleapis.com/… failed, reason: getaddrinfo ENOTFOUND', {
      code: 'ENOTFOUND',
    });

    expect(classifyDelivery(error)).toBe(DELIVERY.NOT_SENT);
    // And worth one immediate retry: the name may resolve a second later.
    expect(isTransientNetworkFailure(error)).toBe(true);
  });

  it('counts a refusal by the provider as never sent', () => {
    expect(classifyDelivery(gaxiosError('Invalid to header', { status: 400 }))).toBe(DELIVERY.NOT_SENT);
    expect(classifyDelivery(gaxiosError('invalid_grant', { status: 400 }))).toBe(DELIVERY.NOT_SENT);
    // But a 4xx will not fix itself, so it is not retried automatically.
    expect(isTransientNetworkFailure(gaxiosError('Invalid to header', { status: 400 }))).toBe(false);
  });

  it('counts a connection lost mid-request as uncertain', () => {
    expect(classifyDelivery(gaxiosError('socket hang up', { code: 'ECONNRESET' }))).toBe(DELIVERY.UNCERTAIN);
    expect(classifyDelivery(gaxiosError('timeout', { code: 'TimeoutError' }))).toBe(DELIVERY.UNCERTAIN);
    expect(classifyDelivery(gaxiosError('Backend error', { status: 500 }))).toBe(DELIVERY.UNCERTAIN);
  });

  /**
   * A local error — a missing credential, a bad template, a refused attachment —
   * is raised before anything is sent. Treating those as uncertain would strand
   * every configuration mistake behind a manual check.
   */
  it('counts a local error as never sent', () => {
    expect(classifyDelivery(new Error('Gmail transport selected but the OAuth app is not configured.'))).toBe(
      DELIVERY.NOT_SENT,
    );
  });

  it('lets a transport overrule it', () => {
    const pressedSend = Object.assign(new Error('no confirmation seen'), { unconfirmed: true });
    expect(classifyDelivery(pressedSend)).toBe(DELIVERY.UNCERTAIN);

    const neverSent = Object.assign(new Error('mock could not deposit'), { delivery: DELIVERY.NOT_SENT });
    expect(classifyDelivery(neverSent)).toBe(DELIVERY.NOT_SENT);
  });

  it('separates "cannot be reached" from "credential refused", for the inbox poll', () => {
    expect(isUnreachable(gaxiosError('getaddrinfo ENOTFOUND', { code: 'ENOTFOUND' }))).toBe(true);
    expect(isUnreachable(gaxiosError('Too many requests', { status: 429 }))).toBe(true);
    expect(isUnreachable(gaxiosError('Backend error', { status: 500 }))).toBe(true);

    expect(isAuthFailure(gaxiosError('Invalid Credentials', { status: 401 }))).toBe(true);
    expect(isAuthFailure(gaxiosError('invalid_grant: Token has been expired or revoked.', { status: 400 }))).toBe(true);
    expect(isAuthFailure(gaxiosError('getaddrinfo ENOTFOUND', { code: 'ENOTFOUND' }))).toBe(false);
  });
});

describe('the Gmail transport', () => {
  const okClient = () => ({
    users: { messages: { send: vi.fn(async () => ({ data: { id: 'gmail-1', threadId: 'thread-1' } })) } },
  });

  it('carries the outbox’s Message-ID, so the send can be found afterwards', async () => {
    const client = okClient();

    await send(
      { from: 'a@b.example', to: ['c@d.example'], subject: 'Re: x', body: 'y', messageIdHeader: 'qms.response.QRY-1.abc@gmail.com' },
      { client },
    );

    const raw = decode(client.users.messages.send.mock.calls[0][0].requestBody.raw);
    expect(raw).toContain('Message-ID: <qms.response.QRY-1.abc@gmail.com>');
  });

  it('omits the header when there is none, leaving the message byte-identical', () => {
    const raw = decode(buildRawMessage({ from: 'a@b.example', to: ['c@d.example'], subject: 's', body: 'b' }));

    expect(raw).not.toContain('Message-ID');
  });

  it('labels an HTTP failure it cannot place as uncertain', async () => {
    const client = {
      users: { messages: { send: vi.fn(async () => { throw gaxiosError('something went wrong in transit'); }) } },
    };

    const error = await send({ from: 'a@b.example', to: ['c@d.example'], subject: 's', body: 'b' }, { client }).catch(
      (caught) => caught,
    );

    expect(classifyDelivery(error)).toBe(DELIVERY.UNCERTAIN);
  });
});

describe('asking Gmail whether an uncertain send went out', () => {
  const dispatch = {
    rfcMessageId: 'qms.response.QRY-2026-00001.abc@gmail.com',
    recipients: ['ravi@pharma.example'],
    subject: 'Re: Dissolution limits [QRY-2026-00001]',
    attemptedAt: '2026-09-18T09:45:21.000Z',
  };

  const clientWith = ({ byId = [], candidates = [], headers = {} }) => ({
    users: {
      messages: {
        list: vi.fn(async ({ q }) =>
          q.includes('rfc822msgid') ? { data: { messages: byId } } : { data: { messages: candidates } },
        ),
        get: vi.fn(async ({ id }) => ({
          data: { payload: { headers: Object.entries(headers[id] || {}).map(([name, value]) => ({ name, value })) } },
        })),
      },
    },
  });

  it('finds it by the Message-ID the outbox set', async () => {
    const client = clientWith({ byId: [{ id: 'gmail-9', threadId: 'thread-9' }] });

    const verdict = await reconcile(dispatch, { client });

    expect(verdict).toMatchObject({ verdict: 'SENT', providerMessageId: 'gmail-9' });
    expect(client.users.messages.list.mock.calls[0][0].q).toContain('in:sent rfc822msgid:');
  });

  /** Gmail may replace the header, so the recipient and exact subject are the fallback. */
  it('finds it by recipient and exact subject when the header did not survive', async () => {
    const client = clientWith({
      candidates: [{ id: 'other' }, { id: 'gmail-9' }],
      headers: {
        other: { Subject: 'Acknowledgement of Query Received [QRY-2026-00001]' },
        'gmail-9': { Subject: dispatch.subject },
      },
    });

    const verdict = await reconcile(dispatch, { client });

    expect(verdict).toMatchObject({ verdict: 'SENT', providerMessageId: 'gmail-9' });
    expect(client.users.messages.list.mock.calls[1][0].q).toContain('in:sent to:ravi@pharma.example');
  });

  it('says it was not sent once the Sent folder has had time to settle', async () => {
    const client = clientWith({});

    const verdict = await reconcile(dispatch, { client, now: Date.parse(dispatch.attemptedAt) + 120000 });

    expect(verdict.verdict).toBe('NOT_SENT');
  });

  /**
   * Gmail's search index trails a send by a few seconds. "Not found" that soon
   * is not evidence, and acting on it would send a second copy.
   */
  it('refuses to conclude anything while the search may still be catching up', async () => {
    const client = clientWith({});

    const verdict = await reconcile(dispatch, { client, now: Date.parse(dispatch.attemptedAt) + 5000 });

    expect(verdict.verdict).toBe('UNKNOWN');
  });
});
