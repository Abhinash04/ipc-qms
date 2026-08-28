import { describe, it, expect, beforeEach, vi } from 'vitest';
import { send, buildRawMessage } from '../services/email/transports/gmailTransport.js';
import { IDENTITY_ROLES } from '../config/identities.js';

/**
 * The Gmail client is faked here, matching the seam gmailInboxReader already
 * uses. No credential is read and nothing is sent.
 */
const sendMessage = vi.fn();
const fakeGmail = { users: { messages: { send: sendMessage } } };

const MESSAGE = {
  from: 'Bhumika Makker <front-office@test.invalid>',
  to: ['officer@test.invalid'],
  subject: 'Fwd: Sterility clarification [QRY-2026-00001]',
  body: 'Please assign this enquiry.',
};

/** What Gmail returns when a threadId belongs to some other account. */
const gmailError = (status) => Object.assign(new Error('Requested entity was not found.'), { status });

const call = () => sendMessage.mock.calls.at(-1)[0];

beforeEach(() => {
  vi.clearAllMocks();
  sendMessage.mockResolvedValue({ data: { id: 'msg-1', threadId: 'thread-1' } });
});

describe('sending through Gmail', () => {
  it('threads the message when a usable thread id is supplied', async () => {
    const result = await send(
      { ...MESSAGE, providerThreadId: 'thread-1' },
      { asRole: IDENTITY_ROLES.FRONT_OFFICE, client: fakeGmail },
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(call().requestBody.threadId).toBe('thread-1');
    expect(result.providerMessageId).toBe('msg-1');
    expect(result.transport).toBe('gmail');
  });

  it('sends unthreaded when no thread id is supplied', async () => {
    await send(MESSAGE, { asRole: IDENTITY_ROLES.FRONT_OFFICE, client: fakeGmail });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(call().requestBody).not.toHaveProperty('threadId');
  });
});

describe('a thread id from another mailbox does not lose the message', () => {
  it.each([404, 400])('retries without the thread id after a %i', async (status) => {
    sendMessage
      .mockRejectedValueOnce(gmailError(status))
      .mockResolvedValueOnce({ data: { id: 'msg-2', threadId: 'thread-9' } });

    const result = await send(
      { ...MESSAGE, providerThreadId: 'thread-from-another-account' },
      { asRole: IDENTITY_ROLES.FRONT_OFFICE, client: fakeGmail },
    );

    expect(sendMessage).toHaveBeenCalledTimes(2);
    // The retry drops the threading rather than the message.
    expect(sendMessage.mock.calls[0][0].requestBody.threadId).toBe(
      'thread-from-another-account',
    );
    expect(call().requestBody).not.toHaveProperty('threadId');
    expect(result.providerMessageId).toBe('msg-2');
  });

  it('reads the status off googleapis error shapes too', async () => {
    sendMessage
      .mockRejectedValueOnce({ code: 404, message: 'Not Found' })
      .mockResolvedValueOnce({ data: { id: 'msg-3', threadId: 't' } });

    await send(
      { ...MESSAGE, providerThreadId: 'foreign' },
      { asRole: IDENTITY_ROLES.FRONT_OFFICE, client: fakeGmail },
    );

    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('does not retry a genuine failure — those stay loud', async () => {
    sendMessage.mockRejectedValue(gmailError(500));

    await expect(
      send(
        { ...MESSAGE, providerThreadId: 'thread-1' },
        { asRole: IDENTITY_ROLES.FRONT_OFFICE, client: fakeGmail },
      ),
    ).rejects.toThrow(/Requested entity was not found/);

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not retry when there was no thread id to blame', async () => {
    sendMessage.mockRejectedValue(gmailError(404));

    await expect(
      send(MESSAGE, { asRole: IDENTITY_ROLES.FRONT_OFFICE, client: fakeGmail }),
    ).rejects.toThrow();

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('the raw message keeps its headers', () => {
  it('carries From, To and Subject through the retry unchanged', async () => {
    sendMessage
      .mockRejectedValueOnce(gmailError(404))
      .mockResolvedValueOnce({ data: { id: 'msg-4', threadId: 't' } });

    await send(
      { ...MESSAGE, providerThreadId: 'foreign' },
      { asRole: IDENTITY_ROLES.FRONT_OFFICE, client: fakeGmail },
    );

    const expected = buildRawMessage(MESSAGE);
    expect(call().requestBody.raw).toBe(expected);
    const decoded = Buffer.from(call().requestBody.raw, 'base64').toString();
    expect(decoded).toMatch(/^To: officer@test\.invalid$/m);
  });
});
