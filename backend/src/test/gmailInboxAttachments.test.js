import { describe, it, expect, beforeEach, vi } from 'vitest';
import { list, materialiseAttachments, resetCache } from '../services/email/mailbox/gmailInboxReader.js';
import * as store from '../services/attachments/attachmentStore.js';
import env from '../config/env.js';

const listMessages = vi.fn();
const getMessage = vi.fn();
const getAttachment = vi.fn();

const fakeGmail = {
  users: {
    messages: {
      list: listMessages,
      get: getMessage,
      attachments: { get: getAttachment },
    },
  },
};

const INQUIRER = 'inquirer@test.invalid';
const FRONT_OFFICE = 'front-office@test.invalid';

function gmailMessageWithAttachment({
  id = 'msg-1',
  filename = 'report.pdf',
  mimeType = 'application/pdf',
  attachmentId = 'gmail-att-1',
  attachmentSize = 2048,
} = {}) {
  return {
    id,
    threadId: 'thread-1',
    internalDate: '1755500000000',
    labelIds: ['INBOX', 'UNREAD'],
    payload: {
      headers: [
        { name: 'From', value: `Test Inquirer <${INQUIRER}>` },
        { name: 'To', value: FRONT_OFFICE },
        { name: 'Subject', value: 'Please review the attached report' },
      ],
      parts: [
        { mimeType: 'text/plain', body: { data: Buffer.from('See attached.').toString('base64') } },
        {
          filename,
          mimeType,
          body: { attachmentId, size: attachmentSize },
        },
      ],
    },
  };
}

function inboxContains(...messages) {
  listMessages.mockResolvedValue({ data: { messages: messages.map(({ id }) => ({ id })) } });
  getMessage.mockImplementation(({ id }) => Promise.resolve({ data: messages.find((m) => m.id === id) }));
}

beforeEach(async () => {
  // The reader caches parsed messages between polls; each test starts fresh.
  resetCache();
  vi.clearAllMocks();
  await store.reset();
});

describe('list() materialises inbound attachment bytes', () => {
  it('downloads, decodes (base64url) and persists the attachment for an eligible message', async () => {
    const original = Buffer.from('%PDF-1.4 real attachment bytes for the test');
    getAttachment.mockResolvedValue({ data: { data: original.toString('base64url') } });
    inboxContains(gmailMessageWithAttachment());

    const [message] = await list(FRONT_OFFICE, { unreadOnly: true, client: fakeGmail });

    expect(getAttachment).toHaveBeenCalledWith({ userId: 'me', messageId: 'msg-1', id: 'gmail-att-1' });
    expect(message.attachments).toHaveLength(1);
    const [att] = message.attachments;
    expect(att.attachmentId).toMatch(/^att_/);
    expect(att.name).toBe('report.pdf');

    const bytes = await store.readBytes(att.attachmentId);
    expect(bytes.equals(original)).toBe(true);
  });

  it('does not download attachments for mail that fails the eligibility filter', async () => {
    inboxContains(
      gmailMessageWithAttachment({ id: 'elsewhere', filename: 'photo.jpg', mimeType: 'image/jpeg' }),
    );
    // Make it ineligible. Sender no longer qualifies anything — intake is N:1 —
    // so the remaining filter is the one that matters: this was not addressed
    // to the Front Officer.
    listMessages.mockResolvedValue({ data: { messages: [{ id: 'elsewhere' }] } });
    getMessage.mockResolvedValue({
      data: {
        ...gmailMessageWithAttachment({ id: 'elsewhere' }),
        payload: {
          headers: [
            { name: 'From', value: 'A Stranger <new@example.com>' },
            { name: 'To', value: 'someone.else@example.com' },
            { name: 'Subject', value: 'Not addressed to IPC' },
          ],
          parts: [{ filename: 'photo.jpg', mimeType: 'image/jpeg', body: { attachmentId: 'x', size: 10 } }],
        },
      },
    });

    const messages = await list(FRONT_OFFICE, { unreadOnly: true, client: fakeGmail });
    expect(messages).toHaveLength(0);
    expect(getAttachment).not.toHaveBeenCalled();
  });

  it('re-polling the same message is idempotent — same id, same bytes, single file on disk', async () => {
    const original = Buffer.from('idempotency check bytes');
    getAttachment.mockResolvedValue({ data: { data: original.toString('base64url') } });
    inboxContains(gmailMessageWithAttachment());

    const [first] = await list(FRONT_OFFICE, { unreadOnly: true, client: fakeGmail });
    const [second] = await list(FRONT_OFFICE, { unreadOnly: true, client: fakeGmail });

    expect(first.attachments[0].attachmentId).toBe(second.attachments[0].attachmentId);
    const bytes = await store.readBytes(second.attachments[0].attachmentId);
    expect(bytes.equals(original)).toBe(true);
  });

  it('degrades gracefully when a single attachment fails to download, without failing the poll', async () => {
    getAttachment.mockRejectedValue(new Error('Gmail attachments.get failed'));
    inboxContains(gmailMessageWithAttachment());

    const [message] = await list(FRONT_OFFICE, { unreadOnly: true, client: fakeGmail });

    expect(message).toBeTruthy();
    expect(message.attachments[0].attachmentId).toBeNull();
    expect(message.attachments[0].materializeError).toMatch(/failed/);
  });

  it('rejects an unsupported attachment type before attempting a download', async () => {
    inboxContains(gmailMessageWithAttachment({ filename: 'payload.exe', mimeType: 'application/x-msdownload' }));

    const [message] = await list(FRONT_OFFICE, { unreadOnly: true, client: fakeGmail });

    expect(getAttachment).not.toHaveBeenCalled();
    expect(message.attachments[0].attachmentId).toBeNull();
    expect(message.attachments[0].materializeError).toMatch(/unsupported/);
  });
});

describe('materialiseAttachments (unit)', () => {
  it('marks an attachment with no provider id rather than throwing', async () => {
    const [result] = await materialiseAttachments(fakeGmail, 'msg-x', [
      { id: null, name: 'no-id.pdf', mimeType: 'application/pdf', sizeKb: 1 },
    ]);
    expect(result.attachmentId).toBeNull();
    expect(result.materializeError).toMatch(/no attachmentId/);
  });
});

/**
 * The size ceiling on the one ingest path a fully external sender can drive.
 *
 * `materialiseAttachments` used to call the shared policy with `size: null`,
 * and the policy skipped both size guards when the size was absent — so
 * ATTACHMENT_MAX_FILE_MB bounded an upload but not an emailed attachment, while
 * the sibling NIC ingester passed `buffer.length` to the very same helper. The
 * writes happen during polling, gated only on the recipient, so any member of
 * the public who mails the published intake address causes them.
 */
describe('the per-file size limit on emailed attachments', () => {
  const overLimit = (env.ATTACHMENT_MAX_FILE_MB + 1) * 1024 * 1024;

  beforeEach(() => {
    getAttachment.mockReset();
  });

  it('refuses a part that declares a size over the limit, without downloading it', async () => {
    const [result] = await materialiseAttachments(fakeGmail, 'msg-1', [
      { id: 'att-1', name: 'huge.pdf', mimeType: 'application/pdf', declaredSize: overLimit },
    ]);

    expect(result.attachmentId).toBeNull();
    expect(result.materializeError).toMatch(/per-file limit/i);
    // Refused before the fetch: the point of checking the declaration first.
    expect(getAttachment).not.toHaveBeenCalled();
  });

  it('refuses a part that under-declares but downloads oversize', async () => {
    getAttachment.mockResolvedValue({
      data: { data: Buffer.alloc(overLimit).toString('base64url') },
    });

    const [result] = await materialiseAttachments(fakeGmail, 'msg-1', [
      // The sender's claim is a lie; the real length is what settles it.
      { id: 'att-2', name: 'sneaky.pdf', mimeType: 'application/pdf', declaredSize: 1024 },
    ]);

    expect(getAttachment).toHaveBeenCalled();
    expect(result.attachmentId).toBeNull();
    // A null attachmentId is itself the proof nothing was written: the store
    // call sits after this check, so reaching it would have produced an id.
    expect(result.materializeError).toMatch(/per-file limit/i);
  });

  it('still accepts a part within the limit that declares no size at all', async () => {
    const bytes = Buffer.from('a modest report');
    getAttachment.mockResolvedValue({ data: { data: bytes.toString('base64url') } });

    const [result] = await materialiseAttachments(fakeGmail, 'msg-1', [
      { id: 'att-3', name: 'fine.pdf', mimeType: 'application/pdf' },
    ]);

    expect(result.materializeError).toBeUndefined();
    expect(result.attachmentId).toBeTruthy();
  });

  it('does not carry the internal declaredSize into the stored record', async () => {
    const bytes = Buffer.from('bytes');
    getAttachment.mockResolvedValue({ data: { data: bytes.toString('base64url') } });

    const [result] = await materialiseAttachments(fakeGmail, 'msg-1', [
      { id: 'att-4', name: 'ok.pdf', mimeType: 'application/pdf', declaredSize: bytes.length },
    ]);

    expect(result).not.toHaveProperty('declaredSize');
  });
});
