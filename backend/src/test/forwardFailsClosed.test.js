import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import * as mockTransport from '../services/email/transports/mockTransport.js';
import * as store from '../services/attachments/attachmentStore.js';

/**
 * The Forward-to-OIC fail-safe contract: the OIC must never receive a
 * message that looks complete but is silently missing a document. Any
 * unresolvable attachment must abort the forward BEFORE anything is sent —
 * verified here by spying on the transport itself, not just checking the
 * HTTP status.
 */

beforeEach(async () => {
  await mockTransport.reset();
  await store.reset();
  vi.restoreAllMocks();
});

async function uploadFixture(filename = 'good.pdf', contentType = 'application/pdf') {
  const res = await request(app)
    .post('/api/v1/attachments')
    .attach('files', Buffer.from('fixture bytes'), { filename, contentType });
  return res.body.attachments[0];
}

describe('forwarding fails closed on an unresolvable attachment', () => {
  it('an unknown attachment id -> 409, names the file, and sends nothing', async () => {
    const sendSpy = vi.spyOn(mockTransport, 'send');

    const res = await request(app).post('/api/v1/emails/forward').send({
      queryId: 'QRY-2026-00010',
      subject: 'Missing attachment',
      body: 'body',
      attachments: [{ attachmentId: 'att_00000000-0000-4000-8000-000000000099', filename: 'ghost.pdf' }],
    });

    expect(res.status).toBe(409);
    expect(res.body.unavailableAttachments).toEqual([
      { attachmentId: 'att_00000000-0000-4000-8000-000000000099', filename: 'ghost.pdf', reason: 'attachment not found' },
    ]);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('a deleted .bin behind a valid .json -> 409, sends nothing', async () => {
    const good = await uploadFixture();
    await store.remove(good.attachmentId); // deletes both files, simulating disk loss

    const sendSpy = vi.spyOn(mockTransport, 'send');

    const res = await request(app)
      .post('/api/v1/emails/forward')
      .send({ queryId: 'QRY-2026-00011', subject: 'Vanished bytes', body: 'body', attachments: [good] });

    expect(res.status).toBe(409);
    expect(res.body.unavailableAttachments[0].attachmentId).toBe(good.attachmentId);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('a corrupted attachment (checksum mismatch) -> 409, sends nothing', async () => {
    const good = await uploadFixture('corrupt-me.pdf');
    // Overwrite the metadata's sha256 so the stored bytes no longer match.
    const meta = await store.getMetadata(good.attachmentId);
    await store.saveWithId(good.attachmentId, {
      buffer: Buffer.from('fixture bytes'),
      filename: meta.filename,
      mimeType: meta.mimeType,
    });
    // Now hand-corrupt just the sidecar's checksum to simulate silent bit-rot.
    const corrupted = { ...(await store.getMetadata(good.attachmentId)), sha256: 'deadbeef'.repeat(8) };
    const fs = await import('fs/promises');
    const path = await import('path');
    const env = (await import('../config/env.js')).default;
    await fs.writeFile(path.join(env.ATTACHMENT_DIR, `${good.attachmentId}.json`), JSON.stringify(corrupted));

    const sendSpy = vi.spyOn(mockTransport, 'send');

    const res = await request(app)
      .post('/api/v1/emails/forward')
      .send({ queryId: 'QRY-2026-00012', subject: 'Corrupted', body: 'body', attachments: [good] });

    expect(res.status).toBe(409);
    expect(res.body.unavailableAttachments[0].reason).toMatch(/checksum mismatch/);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('one bad file among several good ones aborts the whole forward — nothing partial is sent', async () => {
    const good1 = await uploadFixture('good1.pdf');
    const good2 = await uploadFixture('good2.png', 'image/png');
    const bad = { attachmentId: 'att_00000000-0000-4000-8000-0000000000ab', filename: 'missing.docx' };

    const sendSpy = vi.spyOn(mockTransport, 'send');

    const res = await request(app).post('/api/v1/emails/forward').send({
      queryId: 'QRY-2026-00013',
      subject: 'Mixed batch',
      body: 'body',
      attachments: [good1, bad, good2],
    });

    expect(res.status).toBe(409);
    expect(res.body.unavailableAttachments).toHaveLength(1);
    expect(res.body.unavailableAttachments[0].filename).toBe('missing.docx');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('a forward with no attachments at all is unaffected and still succeeds', async () => {
    const res = await request(app)
      .post('/api/v1/emails/forward')
      .send({ queryId: 'QRY-2026-00014', subject: 'Plain forward', body: 'body' });

    expect(res.status).toBe(201);
  });
});
