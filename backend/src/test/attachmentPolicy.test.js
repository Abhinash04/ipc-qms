import { describe, it, expect } from 'vitest';
import { validateFile, validateUpload, limits } from '../services/attachments/attachmentPolicy.js';

const file = (overrides = {}) => ({
  filename: 'doc.pdf',
  mimeType: 'application/pdf',
  size: 1024,
  ...overrides,
});

describe('attachmentPolicy.validateFile', () => {
  it.each([
    ['image', 'photo.png', 'image/png'],
    ['image', 'photo.jpg', 'image/jpeg'],
    ['image', 'photo.jpeg', 'image/jpeg'],
    ['image', 'photo.gif', 'image/gif'],
    ['image', 'photo.webp', 'image/webp'],
    ['video', 'clip.mp4', 'video/mp4'],
    ['video', 'clip.webm', 'video/webm'],
    ['video', 'clip.mov', 'video/quicktime'],
    ['audio', 'sound.mp3', 'audio/mpeg'],
    ['audio', 'sound.wav', 'audio/wav'],
    ['audio', 'sound.ogg', 'audio/ogg'],
    ['document', 'sheet.pdf', 'application/pdf'],
    ['document', 'sheet.xls', 'application/vnd.ms-excel'],
    ['document', 'sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['document', 'letter.doc', 'application/msword'],
    ['document', 'letter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['document', 'deck.ppt', 'application/vnd.ms-powerpoint'],
    ['document', 'deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['document', 'table.csv', 'text/csv'],
    ['document', 'notes.txt', 'text/plain'],
    ['archive', 'bundle.zip', 'application/zip'],
  ])('accepts a supported %s file (%s)', (_category, filename, mimeType) => {
    expect(validateFile(file({ filename, mimeType }))).toEqual({ ok: true });
  });

  it('rejects an unsupported file type', () => {
    const result = validateFile(file({ filename: 'app.exe', mimeType: 'application/x-msdownload' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unsupported file type/);
  });

  it('rejects a mimetype/extension mismatch — a renamed .exe pretending to be a .pdf', () => {
    const result = validateFile(file({ filename: 'payload.pdf', mimeType: 'application/x-msdownload' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unsupported file type/);
  });

  it('rejects a file with no extension', () => {
    const result = validateFile(file({ filename: 'noextension', mimeType: 'application/pdf' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/missing file extension/);
  });

  it('rejects a zero-byte file', () => {
    const result = validateFile(file({ size: 0 }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/empty file/);
  });

  it('rejects a file over the per-file size limit', () => {
    const { maxFileBytes } = limits();
    const result = validateFile(file({ size: maxFileBytes + 1 }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/per-file limit/);
  });
});

describe('attachmentPolicy.validateUpload', () => {
  it('rejects an empty batch', () => {
    const result = validateUpload([]);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/at least one file/i);
  });

  it('rejects more files than the configured maximum', () => {
    const { maxFiles } = limits();
    const files = Array.from({ length: maxFiles + 1 }, (_, i) => ({
      originalname: `f${i}.txt`,
      mimetype: 'text/plain',
      buffer: Buffer.from('x'),
    }));
    const result = validateUpload(files);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/at most/);
  });

  it('rejects a batch whose combined size exceeds the total limit', () => {
    const { maxTotalBytes } = limits();
    const files = [
      { originalname: 'a.txt', mimetype: 'text/plain', buffer: Buffer.alloc(Math.ceil(maxTotalBytes / 2) + 1) },
      { originalname: 'b.txt', mimetype: 'text/plain', buffer: Buffer.alloc(Math.ceil(maxTotalBytes / 2) + 1) },
    ];
    const result = validateUpload(files);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /total limit/.test(e.reason))).toBe(true);
  });

  it('reports each bad file individually, by name', () => {
    const files = [
      { originalname: 'good.pdf', mimetype: 'application/pdf', buffer: Buffer.from('ok') },
      { originalname: 'bad.exe', mimetype: 'application/x-msdownload', buffer: Buffer.from('no') },
    ];
    const result = validateUpload(files);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ filename: 'bad.exe', reason: expect.stringMatching(/unsupported/) }]);
  });

  it('accepts a valid batch', () => {
    const files = [
      { originalname: 'a.pdf', mimetype: 'application/pdf', buffer: Buffer.from('ok') },
      { originalname: 'b.png', mimetype: 'image/png', buffer: Buffer.from('ok') },
    ];
    expect(validateUpload(files)).toEqual({ ok: true, message: null, errors: [] });
  });
});
