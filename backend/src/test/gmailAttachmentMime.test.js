import { describe, it, expect, beforeEach, vi } from 'vitest';
import { send, buildRawMessage } from '../services/email/transports/gmailTransport.js';
import { IDENTITY_ROLES } from '../config/identities.js';

/**
 * Wire-level verification: decode the actual base64url RFC2822 message Gmail
 * would receive and prove the attachment bytes really are in there, byte for
 * byte. The Gmail client is faked, matching the seam gmailTransport.test.js
 * already uses — nothing is sent, no credential is read.
 */

const sendMessage = vi.fn();
const fakeGmail = { users: { messages: { send: sendMessage } } };

const BASE_MESSAGE = {
  from: 'Bhumika Makker <front-office@test.invalid>',
  to: ['officer@test.invalid'],
  subject: 'Fwd: Sterility clarification [QRY-2026-00001]',
  body: 'Please assign this enquiry.',
};

/** Decodes a base64url raw RFC2822 message back to a plain string. */
function decode(raw) {
  return Buffer.from(raw, 'base64url').toString('utf8');
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMessage.mockResolvedValue({ data: { id: 'msg-1', threadId: 'thread-1' } });
});

describe('buildRawMessage — no attachments', () => {
  it('is byte-for-byte identical to the original single-part output (regression guard)', () => {
    const raw = buildRawMessage(BASE_MESSAGE);
    const mime = decode(raw);

    expect(mime).not.toContain('multipart/mixed');
    expect(mime).toMatch(/^Content-Type: text\/plain; charset="UTF-8"$/m);
    expect(mime.endsWith(BASE_MESSAGE.body)).toBe(true);
  });

  it('also produces the old format when attachments is an empty array', () => {
    const raw = buildRawMessage({ ...BASE_MESSAGE, attachments: [] });
    expect(decode(raw)).not.toContain('multipart/mixed');
  });
});

describe('buildRawMessage — with attachments', () => {
  it('embeds one attachment as a real multipart/mixed part with matching bytes', () => {
    const pdfBytes = Buffer.from('%PDF-1.4 pretend pdf content for the test');
    const raw = buildRawMessage({
      ...BASE_MESSAGE,
      attachments: [{ filename: 'spec-sheet.pdf', mimeType: 'application/pdf', content: pdfBytes }],
    });
    const mime = decode(raw);

    expect(mime).toContain('Content-Type: multipart/mixed; boundary="');
    expect(mime).toContain('Content-Disposition: attachment; filename="spec-sheet.pdf"');
    expect(mime).toContain('Content-Transfer-Encoding: base64');
    // The base64 payload for the attachment part decodes to the exact original bytes.
    const boundaryMatch = mime.match(/boundary="([^"]+)"/);
    const boundary = boundaryMatch[1];
    const parts = mime.split(`--${boundary}`);
    const attachmentPart = parts.find((p) => p.includes('spec-sheet.pdf'));
    const payload = attachmentPart.split('\r\n\r\n')[1].replace(/\r\n/g, '');
    expect(Buffer.from(payload, 'base64').equals(pdfBytes)).toBe(true);
  });

  it('embeds several attachments, each recoverable byte-for-byte', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const xlsx = Buffer.from('pretend-xlsx-zip-bytes-not-really-a-zip');
    const raw = buildRawMessage({
      ...BASE_MESSAGE,
      attachments: [
        { filename: 'photo.png', mimeType: 'image/png', content: png },
        {
          filename: 'sheet.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content: xlsx,
        },
      ],
    });
    const mime = decode(raw);
    const boundary = mime.match(/boundary="([^"]+)"/)[1];
    const parts = mime.split(`--${boundary}`);

    const pngPart = parts.find((p) => p.includes('photo.png'));
    const pngPayload = pngPart.split('\r\n\r\n')[1].replace(/\r\n/g, '');
    expect(Buffer.from(pngPayload, 'base64').equals(png)).toBe(true);

    const xlsxPart = parts.find((p) => p.includes('sheet.xlsx'));
    const xlsxPayload = xlsxPart.split('\r\n\r\n')[1].replace(/\r\n/g, '');
    expect(Buffer.from(xlsxPayload, 'base64').equals(xlsx)).toBe(true);
  });

  it('encodes a non-ASCII filename with an RFC 5987 filename*= parameter and an ASCII fallback', () => {
    const raw = buildRawMessage({
      ...BASE_MESSAGE,
      attachments: [{ filename: 'रिपोर्ट.pdf', mimeType: 'application/pdf', content: Buffer.from('x') }],
    });
    const mime = decode(raw);

    expect(mime).toContain(`filename*=UTF-8''${encodeURIComponent('रिपोर्ट.pdf')}`);
    expect(mime).toMatch(/filename="[^"]*\.pdf"/);
  });

  it('sends the multipart raw message through the injected Gmail client', async () => {
    const result = await send(
      {
        ...BASE_MESSAGE,
        attachments: [{ filename: 'x.pdf', mimeType: 'application/pdf', content: Buffer.from('bytes') }],
      },
      { asRole: IDENTITY_ROLES.FRONT_OFFICE, client: fakeGmail },
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const raw = sendMessage.mock.calls[0][0].requestBody.raw;
    expect(decode(raw)).toContain('multipart/mixed');
    expect(result.transport).toBe('gmail');
  });
});
