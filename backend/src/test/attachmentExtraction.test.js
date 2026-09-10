import { describe, it, expect, beforeEach, vi } from 'vitest';
import { extractAttachments, toMailboxMessage, list } from '../services/email/mailbox/gmailInboxReader.js';
import * as store from '../services/attachments/attachmentStore.js';

/**
 * Regression suite for phantom attachments.
 *
 * The reader used to treat any MIME part carrying a filename as a file the
 * inquirer attached. Gmail names inline parts too, so an email signature logo
 * became a real, downloadable, forwardable document on the case. These tests
 * pin the rule that replaced it: only `Content-Disposition: attachment` (or a
 * named, fetchable part with no Content-ID and no disposition header at all)
 * counts as an attachment.
 */

const INQUIRER = 'inquirer@test.invalid';
const FRONT_OFFICE = 'front-office@test.invalid';

const textPart = () => ({
  mimeType: 'text/plain',
  filename: '', // Gmail sends an empty string for body parts
  body: { data: Buffer.from('Hello,\n\nPlease advise.\n\nRegards').toString('base64'), size: 34 },
});

const htmlPart = () => ({
  mimeType: 'text/html',
  filename: '',
  body: { data: Buffer.from('<p>Hello</p>').toString('base64'), size: 12 },
});

/** A file the sender deliberately attached. */
const attachedPart = ({ filename = 'spec.pdf', mimeType = 'application/pdf', attachmentId = 'att-1' } = {}) => ({
  filename,
  mimeType,
  headers: [
    { name: 'Content-Type', value: `${mimeType}; name="${filename}"` },
    { name: 'Content-Disposition', value: `attachment; filename="${filename}"` },
  ],
  body: { attachmentId, size: 2048 },
});

/** An email-signature logo: named, fetchable, and referenced by the HTML body. */
const inlineLogoPart = ({ filename = 'image001.png', cid = 'image001@01DA1234.5678' } = {}) => ({
  filename,
  mimeType: 'image/png',
  headers: [
    { name: 'Content-Type', value: `image/png; name="${filename}"` },
    { name: 'Content-Disposition', value: `inline; filename="${filename}"` },
    { name: 'Content-ID', value: `<${cid}>` },
  ],
  body: { attachmentId: 'inline-att-1', size: 4096 },
});

const payload = (parts) => ({
  headers: [
    { name: 'From', value: `Test Inquirer <${INQUIRER}>` },
    { name: 'To', value: FRONT_OFFICE },
    { name: 'Subject', value: 'Enquiry' },
  ],
  parts,
});

describe('extractAttachments — an email with nothing attached', () => {
  it('case 1: plain-text only produces no attachment records', () => {
    expect(extractAttachments(payload([textPart()]))).toEqual([]);
  });

  it('case 1: a multipart/alternative body produces no attachment records', () => {
    const alternative = { mimeType: 'multipart/alternative', filename: '', parts: [textPart(), htmlPart()] };
    expect(extractAttachments(payload([alternative]))).toEqual([]);
  });

  it('case 4: an inline signature logo is NOT an attachment', () => {
    // This is the exact shape that produced phantom attachments: the logo has a
    // real filename AND a real attachmentId, and image/png is an allowed type.
    expect(extractAttachments(payload([textPart(), inlineLogoPart()]))).toEqual([]);
  });

  it('case 4: a multipart/related body with an embedded image produces nothing', () => {
    const related = {
      mimeType: 'multipart/related',
      filename: '',
      parts: [{ mimeType: 'multipart/alternative', filename: '', parts: [textPart(), htmlPart()] }, inlineLogoPart()],
    };
    expect(extractAttachments(payload([related]))).toEqual([]);
  });

  it('case 4: several signature images still produce nothing', () => {
    const parts = [
      textPart(),
      inlineLogoPart({ filename: 'image001.png', cid: 'a@b' }),
      inlineLogoPart({ filename: 'image002.jpg', cid: 'c@d' }),
      inlineLogoPart({ filename: 'logo.gif', cid: 'e@f' }),
    ];
    expect(extractAttachments(payload(parts))).toEqual([]);
  });

  it('an inline part is excluded even without a Content-ID', () => {
    const inlineOnly = {
      filename: 'ATT00001.htm',
      mimeType: 'text/html',
      headers: [{ name: 'Content-Disposition', value: 'inline; filename="ATT00001.htm"' }],
      body: { attachmentId: 'x', size: 10 },
    };
    expect(extractAttachments(payload([textPart(), inlineOnly]))).toEqual([]);
  });

  it('case 5: empty or absent part metadata creates nothing', () => {
    expect(extractAttachments(payload([{}, { filename: '' }, { filename: null }]))).toEqual([]);
    expect(extractAttachments(payload([]))).toEqual([]);
    expect(extractAttachments(undefined)).toEqual([]);
    expect(extractAttachments({})).toEqual([]);
  });

  it('a named part with no disposition and no fetchable bytes creates nothing', () => {
    const unfetchable = { filename: 'ghost.pdf', mimeType: 'application/pdf', body: { size: 0 } };
    expect(extractAttachments(payload([unfetchable]))).toEqual([]);
  });
});

describe('extractAttachments — genuine attachments still work', () => {
  it('case 2: one attached file yields exactly one record', () => {
    const found = extractAttachments(payload([textPart(), attachedPart()]));

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: 'att-1', name: 'spec.pdf', mimeType: 'application/pdf' });
  });

  it('case 3: several attached files all survive, in order', () => {
    const found = extractAttachments(
      payload([
        textPart(),
        attachedPart({ filename: 'a.pdf', attachmentId: 'att-a' }),
        attachedPart({ filename: 'b.png', mimeType: 'image/png', attachmentId: 'att-b' }),
        attachedPart({ filename: 'c.xlsx', mimeType: 'application/vnd.ms-excel', attachmentId: 'att-c' }),
      ]),
    );

    expect(found.map((a) => a.name)).toEqual(['a.pdf', 'b.png', 'c.xlsx']);
  });

  it('keeps the real attachment and drops the signature logo in the same email', () => {
    const found = extractAttachments(payload([textPart(), inlineLogoPart(), attachedPart()]));

    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('spec.pdf');
  });

  it('a client that omits Content-Disposition is still honoured', () => {
    // Back-compat: named + fetchable + no Content-ID means a real attachment.
    const noDisposition = { filename: 'legacy.pdf', mimeType: 'application/pdf', body: { attachmentId: 'att-l', size: 99 } };

    expect(extractAttachments(payload([textPart(), noDisposition]))).toHaveLength(1);
  });

  it('an attached .eml counts once, not once per file inside it', () => {
    const forwardedEml = {
      filename: 'forwarded.eml',
      mimeType: 'message/rfc822',
      headers: [{ name: 'Content-Disposition', value: 'attachment; filename="forwarded.eml"' }],
      body: { attachmentId: 'att-eml', size: 8192 },
      parts: [textPart(), attachedPart({ filename: 'inner.pdf', attachmentId: 'att-inner' })],
    };

    const found = extractAttachments(payload([textPart(), forwardedEml]));

    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('forwarded.eml');
  });
});

describe('toMailboxMessage reflects the corrected extraction', () => {
  const message = (parts) => ({
    id: 'msg-1',
    threadId: 'thread-1',
    internalDate: '1755500000000',
    labelIds: ['INBOX', 'UNREAD'],
    payload: payload(parts),
  });

  it('case 6: a signature-only email exposes an empty attachments array', () => {
    const mapped = toMailboxMessage(message([textPart(), inlineLogoPart()]), FRONT_OFFICE);

    expect(mapped.attachments).toEqual([]);
    expect(mapped.body).toContain('Please advise');
  });

  it('a genuinely attached file is still exposed', () => {
    const mapped = toMailboxMessage(message([textPart(), attachedPart()]), FRONT_OFFICE);
    expect(mapped.attachments).toHaveLength(1);
  });
});

describe('list() never downloads bytes for a part nobody attached', () => {
  const listMessages = vi.fn();
  const getMessage = vi.fn();
  const getAttachment = vi.fn();
  const fakeGmail = {
    users: { messages: { list: listMessages, get: getMessage, attachments: { get: getAttachment } } },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await store.reset();
  });

  it('an inline logo is neither fetched nor written to disk', async () => {
    const msg = {
      id: 'msg-1',
      threadId: 'thread-1',
      internalDate: '1755500000000',
      labelIds: ['INBOX', 'UNREAD'],
      payload: payload([textPart(), inlineLogoPart()]),
    };
    listMessages.mockResolvedValue({ data: { messages: [{ id: 'msg-1' }] } });
    getMessage.mockResolvedValue({ data: msg });

    const [received] = await list(FRONT_OFFICE, { unreadOnly: true, client: fakeGmail });

    expect(received.attachments).toEqual([]);
    // The decisive assertion: no Gmail attachment fetch, so no bytes on disk.
    expect(getAttachment).not.toHaveBeenCalled();
  });

  it('a real attachment is still fetched and persisted byte-for-byte', async () => {
    const bytes = Buffer.from('%PDF-1.4 genuine attachment');
    getAttachment.mockResolvedValue({ data: { data: bytes.toString('base64url') } });

    const msg = {
      id: 'msg-2',
      threadId: 'thread-2',
      internalDate: '1755500000000',
      labelIds: ['INBOX', 'UNREAD'],
      payload: payload([textPart(), attachedPart()]),
    };
    listMessages.mockResolvedValue({ data: { messages: [{ id: 'msg-2' }] } });
    getMessage.mockResolvedValue({ data: msg });

    const [received] = await list(FRONT_OFFICE, { unreadOnly: true, client: fakeGmail });

    expect(received.attachments).toHaveLength(1);
    expect(getAttachment).toHaveBeenCalledTimes(1);
    const stored = await store.readBytes(received.attachments[0].attachmentId);
    expect(stored.equals(bytes)).toBe(true);
  });
});
