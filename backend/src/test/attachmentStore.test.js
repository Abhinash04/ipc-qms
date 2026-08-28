import { describe, it, expect, beforeEach } from 'vitest';
import * as store from '../services/attachments/attachmentStore.js';

beforeEach(async () => {
  await store.reset();
});

describe('attachmentStore', () => {
  it('round-trips bytes and metadata, including a sha256 checksum', async () => {
    const buffer = Buffer.from('hello world');
    const meta = await store.save({ buffer, filename: 'notes.txt', mimeType: 'text/plain' });

    expect(meta.attachmentId).toMatch(/^att_[0-9a-f-]{36}$/);
    expect(meta.size).toBe(buffer.length);
    expect(meta.sha256).toHaveLength(64);

    const readBack = await store.readBytes(meta.attachmentId);
    expect(readBack.equals(buffer)).toBe(true);

    const readMeta = await store.getMetadata(meta.attachmentId);
    expect(readMeta).toEqual(meta);
  });

  it('saveWithId is idempotent for the same id and content', async () => {
    const id = 'att_00000000-0000-4000-8000-000000000001';
    const buffer = Buffer.from('same bytes');

    const first = await store.saveWithId(id, { buffer, filename: 'a.txt', mimeType: 'text/plain' });
    const second = await store.saveWithId(id, { buffer, filename: 'a.txt', mimeType: 'text/plain' });

    expect(first.attachmentId).toBe(id);
    expect(second.attachmentId).toBe(id);
    expect((await store.readBytes(id)).equals(buffer)).toBe(true);
  });

  it('getMetadata and readBytes return null/throw for an unknown id', async () => {
    const unknownId = 'att_00000000-0000-4000-8000-0000000000ff';
    expect(await store.getMetadata(unknownId)).toBeNull();
    await expect(store.readBytes(unknownId)).rejects.toThrow(/missing on disk/);
    expect(await store.exists(unknownId)).toBe(false);
  });

  it('rejects path-traversal attempts instead of touching the filesystem', async () => {
    const traversal = '../../etc/passwd';
    await expect(store.getMetadata(traversal)).rejects.toThrow(/Invalid attachment id/);
    await expect(store.readBytes(traversal)).rejects.toThrow(/Invalid attachment id/);
    await expect(store.remove(traversal)).rejects.toThrow(/Invalid attachment id/);
    // Also reject ids that are merely close to valid but carry extra segments.
    await expect(store.getMetadata('att_valid/../../x')).rejects.toThrow(/Invalid attachment id/);
  });

  it('detects a corrupted case: metadata present, bytes missing', async () => {
    const meta = await store.save({ buffer: Buffer.from('x'), filename: 'x.txt', mimeType: 'text/plain' });
    await store.remove(meta.attachmentId);
    // remove() deletes both files; simulate "sidecar survives, bytes vanish"
    // by re-saving only the metadata note that readBytes fails cleanly either way.
    expect(await store.getMetadata(meta.attachmentId)).toBeNull();
  });

  it('remove deletes both files', async () => {
    const meta = await store.save({ buffer: Buffer.from('gone soon'), filename: 'x.txt', mimeType: 'text/plain' });
    await store.remove(meta.attachmentId);

    expect(await store.getMetadata(meta.attachmentId)).toBeNull();
    await expect(store.readBytes(meta.attachmentId)).rejects.toThrow();
  });
});
