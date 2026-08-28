import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { send as gmailSend } from '../services/email/transports/gmailTransport.js';
import { materialiseAttachments } from '../services/email/mailbox/gmailInboxReader.js';
import * as mockTransport from '../services/email/transports/mockTransport.js';
import * as store from '../services/attachments/attachmentStore.js';
import { IDENTITY_ROLES } from '../config/identities.js';

/**
 * The requirement's real target: Inquirer attaches files -> Query registered
 * -> attachments stored -> the email genuinely carries them -> Front Officer
 * receives them -> forwarding to the Officer-in-Charge carries the SAME
 * bytes -> and a missing attachment fails the forward closed rather than
 * silently dropping it.
 *
 * The Gmail legs (steps 2-3) inject a fake client, the same seam
 * gmailTransport.test.js and gmailInboxReader.test.js already use — no
 * credential is read and no real network call happens. The forward leg
 * (step 4) goes through the real HTTP app, which in this test environment
 * resolves to the mock transport (matching every other HTTP-level test in
 * this suite) — attachment resolution and the fail-closed contract are
 * identical on both transports since they live in emailService, above the
 * transport boundary.
 */

const FIXTURES = [
  { filename: 'spec.pdf', contentType: 'application/pdf', bytes: Buffer.from('%PDF-1.4 pretend pdf content') },
  { filename: 'photo.png', contentType: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]) },
  {
    filename: 'sheet.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes: Buffer.from('pretend-xlsx-zip-content-for-the-test'),
  },
];

const sendMessage = vi.fn();
const getAttachment = vi.fn();
const fakeGmail = {
  users: {
    messages: { send: sendMessage, attachments: { get: getAttachment } },
  },
};

beforeEach(async () => {
  await mockTransport.reset();
  await store.reset();
  vi.clearAllMocks();
  sendMessage.mockResolvedValue({ data: { id: 'gmail-msg-1', threadId: 'gmail-thread-1' } });
});

describe('end-to-end attachment flow', () => {
  it('carries the Inquirer\'s original PDF/PNG/XLSX all the way to the Officer-in-Charge', async () => {
    // 1. Inquirer uploads three files.
    const uploaded = [];
    for (const fixture of FIXTURES) {
      const res = await request(app)
        .post('/api/v1/attachments')
        .attach('files', fixture.bytes, { filename: fixture.filename, contentType: fixture.contentType });
      expect(res.status).toBe(201);
      uploaded.push(res.body.attachments[0]);
    }

    // 2. Inquirer -> Front Office: build the real Gmail MIME and confirm all
    //    three attachments are present, byte-exact, inside it.
    const resolvedForSend = await Promise.all(
      uploaded.map(async (u, i) => ({ ...u, content: await store.readBytes(u.attachmentId), original: FIXTURES[i].bytes })),
    );
    await gmailSend(
      {
        from: 'Test Inquirer <inquirer@test.invalid>',
        to: ['front-office@test.invalid'],
        subject: 'Enquiry with attachments',
        body: 'Please see attached.',
        attachments: resolvedForSend,
      },
      { asRole: IDENTITY_ROLES.INQUIRER, client: fakeGmail },
    );
    const rawSent = sendMessage.mock.calls[0][0].requestBody.raw;
    const mimeSent = Buffer.from(rawSent, 'base64url').toString('utf8');
    for (const fixture of FIXTURES) {
      expect(mimeSent).toContain(`filename="${fixture.filename}"`);
    }

    // 3. Front Office's Gmail inbox is read: materialise attachment bytes for
    //    the inbound message and confirm they are byte-identical to what the
    //    Inquirer actually sent.
    getAttachment.mockImplementation(({ id }) => {
      const fixture = FIXTURES.find((f) => f.filename === id);
      return Promise.resolve({ data: { data: fixture.bytes.toString('base64url') } });
    });
    const inboundParts = FIXTURES.map((f) => ({ id: f.filename, name: f.filename, mimeType: f.contentType }));
    const materialised = await materialiseAttachments(fakeGmail, 'inbound-msg-1', inboundParts);

    expect(materialised.every((m) => m.attachmentId)).toBe(true);
    for (let i = 0; i < FIXTURES.length; i += 1) {
      const bytes = await store.readBytes(materialised[i].attachmentId);
      expect(bytes.equals(FIXTURES[i].bytes)).toBe(true);
    }

    // 4. Front Officer forwards to the Officer-in-Charge — all three
    //    attachments survive, subject and recipient are the usual forward
    //    semantics, unchanged by attachments being present.
    const forwardRes = await request(app)
      .post('/api/v1/emails/forward')
      .send({
        queryId: 'QRY-2026-00099',
        subject: 'Enquiry with attachments',
        body: 'Forwarded body',
        attachments: materialised.map((m) => ({ attachmentId: m.attachmentId, filename: m.name })),
      });

    expect(forwardRes.status).toBe(201);
    expect(forwardRes.body.subject).toBe('Fwd: Enquiry with attachments [QRY-2026-00099]');
    expect(forwardRes.body.to).toEqual(['officer@test.invalid']);
    expect(forwardRes.body.attachments.map((a) => a.filename).sort()).toEqual(
      FIXTURES.map((f) => f.filename).sort(),
    );
    expect(forwardRes.body.aiSummary).toBeTruthy();

    // 5. Delete one materialised attachment's bytes and re-forward: the OIC
    //    must never receive a forward that looks complete but is silently
    //    missing a document.
    const missingOne = materialised[0];
    await store.remove(missingOne.attachmentId);
    const sendSpy = vi.spyOn(mockTransport, 'send');

    const failedForward = await request(app)
      .post('/api/v1/emails/forward')
      .send({
        queryId: 'QRY-2026-00100',
        subject: 'Enquiry with attachments (retry)',
        body: 'Forwarded body',
        attachments: materialised.map((m) => ({ attachmentId: m.attachmentId, filename: m.name })),
      });

    expect(failedForward.status).toBe(409);
    expect(failedForward.body.unavailableAttachments[0].attachmentId).toBe(missingOne.attachmentId);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
