import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { AUTH } from './helpers/auth.js';
import app from '../app.js';
import * as mockTransport from '../services/email/transports/mockTransport.js';
import * as store from '../services/attachments/attachmentStore.js';

/**
 * The requirement's real target: files are uploaded -> stored -> the forward to
 * the Officer-in-Charge carries the SAME bytes -> and a missing attachment
 * fails the forward closed rather than silently dropping it.
 *
 * The forward is the only case email that carries attachments at all. It runs
 * through the real HTTP app, which resolves to the mock transport here, as
 * every other HTTP-level test in this suite does: attachment resolution and
 * the fail-closed contract live in emailService, above the transport boundary,
 * so they are identical whichever transport ends up sending.
 *
 * The NICeMail leg — that those resolved bytes reach the browser agent
 * unchanged — is pinned in nicBrowserMailbox.test.js, where the agent is
 * replaced at its module boundary.
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

beforeEach(async () => {
  await mockTransport.reset();
  await store.reset();
  vi.clearAllMocks();
});

describe('end-to-end attachment flow', () => {
  it("carries the enquiry's original PDF/PNG/XLSX all the way to the Officer-in-Charge", async () => {
    // 1. The files arrive and are stored.
    const uploaded = [];
    for (const fixture of FIXTURES) {
      const res = await request(app)
        .post('/api/v1/attachments').set(AUTH)
        .attach('files', fixture.bytes, { filename: fixture.filename, contentType: fixture.contentType });
      expect(res.status).toBe(201);
      uploaded.push(res.body.attachments[0]);
    }

    // 2. Stored bytes are byte-identical to what was uploaded. Everything
    //    downstream reads them from here, so this is where a corruption would
    //    enter.
    for (let i = 0; i < FIXTURES.length; i += 1) {
      const bytes = await store.readBytes(uploaded[i].attachmentId);
      expect(bytes.equals(FIXTURES[i].bytes)).toBe(true);
    }

    // 3. The forward to the Officer-in-Charge carries all three, with the
    //    usual forward subject and recipient.
    const sendSpy = vi.spyOn(mockTransport, 'send');
    const forwardRes = await request(app)
      .post('/api/v1/emails/forward').set(AUTH)
      .send({
        queryId: 'QRY-2026-00099',
        subject: 'Enquiry with attachments',
        body: 'Forwarded body',
        attachments: uploaded.map((u) => ({ attachmentId: u.attachmentId, filename: u.filename })),
      });

    expect(forwardRes.status).toBe(201);
    expect(forwardRes.body.subject).toBe('Fwd: Enquiry with attachments [QRY-2026-00099]');
    expect(forwardRes.body.to).toEqual(['officer@test.invalid']);
    expect(forwardRes.body.attachments.map((a) => a.filename).sort()).toEqual(
      FIXTURES.map((f) => f.filename).sort(),
    );
    expect(forwardRes.body.aiSummary).toBeTruthy();

    // The bytes the transport was actually handed, not just the metadata that
    // came back over HTTP.
    const dispatched = sendSpy.mock.calls[0][0].attachments;
    for (const fixture of FIXTURES) {
      const carried = dispatched.find((a) => a.filename === fixture.filename);
      expect(carried.content.equals(fixture.bytes)).toBe(true);
    }

    // 4. Delete one attachment's bytes and re-forward: the Officer-in-Charge
    //    must never receive a forward that looks complete but is silently
    //    missing a document.
    const missingOne = uploaded[0];
    await store.remove(missingOne.attachmentId);
    sendSpy.mockClear();

    const failedForward = await request(app)
      .post('/api/v1/emails/forward').set(AUTH)
      .send({
        queryId: 'QRY-2026-00100',
        subject: 'Enquiry with attachments (retry)',
        body: 'Forwarded body',
        attachments: uploaded.map((u) => ({ attachmentId: u.attachmentId, filename: u.filename })),
      });

    expect(failedForward.status).toBe(409);
    expect(failedForward.body.unavailableAttachments[0].attachmentId).toBe(missingOne.attachmentId);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
