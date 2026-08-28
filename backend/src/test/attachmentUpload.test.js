import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';

describe('POST /api/v1/attachments', () => {
  it('uploads a single file and returns metadata only, never bytes', async () => {
    const res = await request(app)
      .post('/api/v1/attachments')
      .attach('files', Buffer.from('%PDF-1.4 fake pdf bytes'), { filename: 'spec.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.attachments).toHaveLength(1);
    const [att] = res.body.attachments;
    expect(att.attachmentId).toMatch(/^att_/);
    expect(att.filename).toBe('spec.pdf');
    expect(att.mimeType).toBe('application/pdf');
    expect(att.size).toBeGreaterThan(0);
    expect(att).not.toHaveProperty('content');
    expect(att).not.toHaveProperty('buffer');
  });

  it('uploads multiple files of different types in one request', async () => {
    const res = await request(app)
      .post('/api/v1/attachments')
      .attach('files', Buffer.from('pdf-bytes'), { filename: 'a.pdf', contentType: 'application/pdf' })
      .attach('files', Buffer.from('png-bytes'), { filename: 'b.png', contentType: 'image/png' })
      .attach('files', Buffer.from('xlsx-bytes'), {
        filename: 'c.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(201);
    expect(res.body.attachments.map((a) => a.filename).sort()).toEqual(['a.pdf', 'b.png', 'c.xlsx']);
  });

  it('rejects an unsupported file type', async () => {
    const res = await request(app)
      .post('/api/v1/attachments')
      .attach('files', Buffer.from('MZ...'), { filename: 'virus.exe', contentType: 'application/x-msdownload' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/failed validation/i);
    expect(res.body.errors).toEqual([{ filename: 'virus.exe', reason: expect.stringMatching(/unsupported/) }]);
  });

  it('rejects an oversize file', async () => {
    const oversize = Buffer.alloc(11 * 1024 * 1024); // > default 10MB
    const res = await request(app)
      .post('/api/v1/attachments')
      .attach('files', oversize, { filename: 'huge.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
  });

  it('rejects an empty request', async () => {
    const res = await request(app).post('/api/v1/attachments').field('note', 'no files attached');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/attachments/:id', () => {
  async function uploadOne() {
    const res = await request(app)
      .post('/api/v1/attachments')
      .attach('files', Buffer.from('hello attachment bytes'), { filename: 'note.txt', contentType: 'text/plain' });
    return res.body.attachments[0];
  }

  it('serves the exact original bytes inline by default', async () => {
    const { attachmentId } = await uploadOne();
    const res = await request(app).get(`/api/v1/attachments/${attachmentId}`);

    expect(res.status).toBe(200);
    expect(res.text).toBe('hello attachment bytes');
    expect(res.headers['content-disposition']).toMatch(/^inline;/);
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it('serves as a download when ?download=1 is set', async () => {
    const { attachmentId } = await uploadOne();
    const res = await request(app).get(`/api/v1/attachments/${attachmentId}?download=1`);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['content-disposition']).toContain('filename="note.txt"');
  });

  it('404s for an unknown id', async () => {
    const res = await request(app).get('/api/v1/attachments/att_00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });

  it('rejects a malformed id without touching the filesystem', async () => {
    const res = await request(app).get('/api/v1/attachments/..%2f..%2fetc%2fpasswd');
    expect(res.status).toBe(400);
  });

  it('GET /api/v1/attachments/:id/meta returns metadata without bytes', async () => {
    const { attachmentId } = await uploadOne();
    const res = await request(app).get(`/api/v1/attachments/${attachmentId}/meta`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      attachmentId,
      filename: 'note.txt',
      mimeType: 'text/plain',
      size: 'hello attachment bytes'.length,
    });
  });

  it('meta 404s for an unknown id', async () => {
    const res = await request(app).get('/api/v1/attachments/att_00000000-0000-4000-8000-000000000000/meta');
    expect(res.status).toBe(404);
  });
});
