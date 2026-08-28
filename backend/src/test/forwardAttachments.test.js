import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import * as mockTransport from '../services/email/transports/mockTransport.js';
import * as mailbox from '../services/email/mailbox/index.js';
import * as store from '../services/attachments/attachmentStore.js';

beforeEach(async () => {
  await mockTransport.reset();
  await store.reset();
});

async function uploadFixture(filename, contentType, bytes = 'fixture bytes') {
  const res = await request(app)
    .post('/api/v1/attachments')
    .attach('files', Buffer.from(bytes), { filename, contentType });
  return res.body.attachments[0];
}

describe('POST /emails/forward carries attachments to the OIC', () => {
  it('forwards a single attachment with correct filename and byte content', async () => {
    const pdf = await uploadFixture('spec.pdf', 'application/pdf', 'pdf-bytes-here');

    const res = await request(app)
      .post('/api/v1/emails/forward')
      .send({ queryId: 'QRY-2026-00001', subject: 'Sterility clarification', body: 'body', attachments: [pdf] });

    expect(res.status).toBe(201);
    expect(res.body.attachments).toEqual([
      { attachmentId: pdf.attachmentId, filename: 'spec.pdf', mimeType: 'application/pdf', size: pdf.size },
    ]);

    const oicInbox = await mailbox.list('officer@test.invalid');
    expect(oicInbox).toHaveLength(1);
    expect(oicInbox[0].attachments[0].attachmentId).toBe(pdf.attachmentId);
  });

  it('forwards multiple attachments, all present', async () => {
    const pdf = await uploadFixture('spec.pdf', 'application/pdf');
    const png = await uploadFixture('photo.png', 'image/png');
    const xlsx = await uploadFixture(
      'sheet.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const res = await request(app).post('/api/v1/emails/forward').send({
      queryId: 'QRY-2026-00002',
      subject: 'Multi-attachment query',
      body: 'body',
      attachments: [pdf, png, xlsx],
    });

    expect(res.status).toBe(201);
    expect(res.body.attachments.map((a) => a.filename).sort()).toEqual(['photo.png', 'sheet.xlsx', 'spec.pdf']);
  });

  it('still preserves the Gemma summary block and forward semantics with attachments present', async () => {
    const pdf = await uploadFixture('spec.pdf', 'application/pdf');

    const res = await request(app)
      .post('/api/v1/emails/forward')
      .send({ queryId: 'QRY-2026-00003', subject: 'Original subject', body: 'original body', attachments: [pdf] });

    expect(res.status).toBe(201);
    expect(res.body.subject).toBe('Fwd: Original subject [QRY-2026-00003]');
    expect(res.body.aiSummary).toBeTruthy();
    expect(res.body.to).toEqual(['officer@test.invalid']);
  });

  it('a forward with no attachments still succeeds unchanged', async () => {
    const res = await request(app)
      .post('/api/v1/emails/forward')
      .send({ queryId: 'QRY-2026-00004', subject: 'No attachments here', body: 'body' });

    expect(res.status).toBe(201);
    expect(res.body.attachments).toEqual([]);
  });
});
