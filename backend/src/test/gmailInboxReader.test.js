import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The Gmail inbox reader's `list()` — the function that actually serves
 * `GET /api/v1/mailbox/messages`.
 *
 * This suite exists because a regression shipped that its helpers' tests could
 * not catch: `inboxQuery()`, `isEnquirySender()` and `toMailboxMessage()` were
 * all covered as pure functions while `list()` itself — which wires them
 * together — was never called, and a stale reference inside it threw
 * `ReferenceError: QUERY is not defined` on the `unreadOnly=true` branch only.
 *
 * The Gmail client is faked here. No credential is read, nothing is sent, and
 * no real inbox is touched.
 */

import { list, markIngested, remove } from '../services/email/mailbox/gmailInboxReader.js';

const listMessages = vi.fn();
const getMessage = vi.fn();
const modifyMessage = vi.fn();
const trashMessage = vi.fn();

/** Stands in for the Gmail client; no credential is read, nothing is sent. */
const fakeGmail = {
  users: {
    messages: {
      list: listMessages,
      get: getMessage,
      modify: modifyMessage,
      trash: trashMessage,
    },
  },
};

const INQUIRER = 'inquirer@test.invalid';
const FRONT_OFFICE = 'front-office@test.invalid';

/** A Gmail message in the shape the API actually returns. */
function gmailMessage({
  id = 'msg-1',
  threadId = 'thread-1',
  from = `Test Inquirer <${INQUIRER}>`,
  to = FRONT_OFFICE,
  subject = 'Clarification on monograph revision',
  body = 'Please clarify the submission window.',
  unread = true,
  internalDate = '1755500000000',
} = {}) {
  return {
    id,
    threadId,
    internalDate,
    labelIds: unread ? ['INBOX', 'UNREAD'] : ['INBOX'],
    payload: {
      headers: [
        { name: 'From', value: from },
        { name: 'To', value: to },
        { name: 'Subject', value: subject },
      ],
      body: { data: Buffer.from(body).toString('base64') },
    },
  };
}

/** Make the fake API return exactly these messages. */
function inboxContains(...messages) {
  listMessages.mockResolvedValue({ data: { messages: messages.map(({ id }) => ({ id })) } });
  getMessage.mockImplementation(({ id }) =>
    Promise.resolve({ data: messages.find((m) => m.id === id) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('list() — the call the endpoint makes', () => {
  it('succeeds with unreadOnly=true', async () => {
    // The exact call that used to return HTTP 500.
    inboxContains(gmailMessage());

    const messages = await list(FRONT_OFFICE, { unreadOnly: true, client: fakeGmail });

    expect(messages).toHaveLength(1);
    expect(listMessages).toHaveBeenCalledWith(
      expect.objectContaining({ q: expect.stringContaining('is:unread') }),
    );
  });

  it('succeeds with unreadOnly=false, and omits the unread constraint', async () => {
    inboxContains(gmailMessage({ unread: false }));

    const messages = await list(FRONT_OFFICE, { unreadOnly: false, client: fakeGmail });

    expect(messages).toHaveLength(1);
    expect(listMessages.mock.calls[0][0].q).not.toContain('is:unread');
  });

  it('constrains the search to the inquirer and the Front Officer', async () => {
    inboxContains(gmailMessage());
    await list(FRONT_OFFICE, { unreadOnly: true, client: fakeGmail });

    const { q } = listMessages.mock.calls[0][0];
    expect(q).toContain(`from:(${INQUIRER})`);
    expect(q).toContain(`to:(${FRONT_OFFICE})`);
  });

  it('returns the enquiry with its sender, recipient and Gmail ids intact', async () => {
    inboxContains(gmailMessage({ id: 'abc123', threadId: 'thread-abc' }));

    const [message] = await list(FRONT_OFFICE, { unreadOnly: true, client: fakeGmail });

    expect(message.mailboxMessageId).toBe('abc123');
    expect(message.providerThreadId).toBe('thread-abc');
    expect(message.from).toBe(`Test Inquirer <${INQUIRER}>`);
    expect(message.to).toBe(FRONT_OFFICE);
    expect(message.subject).toBe('Clarification on monograph revision');
    expect(message.body).toContain('Please clarify');
    expect(message.ingested).toBe(false);
  });

  it('returns nothing when the inbox has no matching mail', async () => {
    listMessages.mockResolvedValue({ data: {} });
    expect(await list(FRONT_OFFICE, { unreadOnly: true, client: fakeGmail })).toEqual([]);
  });

  it('orders oldest first', async () => {
    inboxContains(
      gmailMessage({ id: 'newer', subject: 'Second', internalDate: '1755600000000' }),
      gmailMessage({ id: 'older', subject: 'First', internalDate: '1755400000000' }),
    );

    const messages = await list(FRONT_OFFICE, { unreadOnly: true, client: fakeGmail });
    expect(messages.map((m) => m.subject)).toEqual(['First', 'Second']);
  });
});

describe('list() drops anything that may not open a case', () => {
  // The Gmail query is the first filter; this is the binding one. If Gmail ever
  // returns more than asked, her private mail still cannot become a Query Case.

  it('ignores an unrelated unread email from someone else', async () => {
    inboxContains(
      gmailMessage({ id: 'friend', from: 'A Friend <friend@example.com>', subject: 'Lunch?' }),
      gmailMessage({ id: 'enquiry' }),
    );

    const messages = await list(FRONT_OFFICE, { unreadOnly: true, client: fakeGmail });

    expect(messages).toHaveLength(1);
    expect(messages[0].mailboxMessageId).toBe('enquiry');
  });

  it('ignores mail from IPC staff — they do not open cases', async () => {
    inboxContains(
      gmailMessage({ id: 'oic', from: 'Test Officer <officer@test.invalid>' }),
      gmailMessage({ id: 'official', from: 'assigned-official@test.invalid' }),
    );

    expect(await list(FRONT_OFFICE, { unreadOnly: true, client: fakeGmail })).toEqual([]);
  });

  it('ignores mail addressed to somebody else', async () => {
    inboxContains(gmailMessage({ id: 'elsewhere', to: 'someone.else@example.com' }));

    expect(await list(FRONT_OFFICE, { unreadOnly: true, client: fakeGmail })).toEqual([]);
  });

  it('accepts an enquiry that lists several recipients including her', async () => {
    inboxContains(
      gmailMessage({ id: 'multi', to: `colleague@example.com, ${FRONT_OFFICE}` }),
    );

    expect(await list(FRONT_OFFICE, { unreadOnly: true, client: fakeGmail })).toHaveLength(1);
  });

  it('filters on the unreadOnly=false path too', async () => {
    // Returning the whole inbox unfiltered was the second half of the bug.
    inboxContains(
      gmailMessage({ id: 'friend', from: 'friend@example.com', unread: false }),
      gmailMessage({ id: 'enquiry', unread: false }),
    );

    const messages = await list(FRONT_OFFICE, { unreadOnly: false, client: fakeGmail });

    expect(messages).toHaveLength(1);
    expect(messages[0].mailboxMessageId).toBe('enquiry');
  });
});

describe('markIngested', () => {
  it('removes the UNREAD label so the message is not polled again', async () => {
    modifyMessage.mockResolvedValue({ data: gmailMessage({ id: 'msg-1', unread: false }) });

    const result = await markIngested(FRONT_OFFICE, 'msg-1', { client: fakeGmail });

    expect(modifyMessage).toHaveBeenCalledWith({
      userId: 'me',
      id: 'msg-1',
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
    expect(result.ingested).toBe(true);
  });
});

describe('remove', () => {
  it('moves the message to Trash rather than destroying it', async () => {
    trashMessage.mockResolvedValue({ data: gmailMessage({ id: 'msg-1', subject: 'Doomed' }) });

    const result = await remove(FRONT_OFFICE, 'msg-1', { client: fakeGmail });

    expect(trashMessage).toHaveBeenCalledWith({ userId: 'me', id: 'msg-1' });
    expect(result.mailboxMessageId).toBe('msg-1');
    expect(result.subject).toBe('Doomed');
  });

  it('returns null when Gmail hands back no message', async () => {
    trashMessage.mockResolvedValue({});

    expect(await remove(FRONT_OFFICE, 'msg-1', { client: fakeGmail })).toBeNull();
  });
});
