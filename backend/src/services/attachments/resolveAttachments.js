import { createHash } from 'crypto';
import * as store from './attachmentStore.js';
import { AttachmentUnavailableError } from './errors.js';

async function resolveAttachments(refs = []) {
  if (!refs || refs.length === 0) return [];

  const resolved = [];
  const unavailable = [];

  for (const ref of refs) {
    const id = ref?.attachmentId || ref?.id;
    const fallbackName = ref?.filename || ref?.name || null;

    if (!id) {
      unavailable.push({ attachmentId: null, filename: fallbackName, reason: 'no attachmentId provided' });
      continue;
    }

    try {
      const meta = await store.getMetadata(id);
      if (!meta) {
        unavailable.push({ attachmentId: id, filename: fallbackName, reason: 'attachment not found' });
        continue;
      }

      const buffer = await store.readBytes(id);
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      if (sha256 !== meta.sha256) {
        unavailable.push({ attachmentId: id, filename: meta.filename, reason: 'corrupted (checksum mismatch)' });
        continue;
      }

      resolved.push({
        attachmentId: id,
        filename: meta.filename,
        mimeType: meta.mimeType,
        size: meta.size,
        content: buffer,
      });
    } catch (error) {
      unavailable.push({ attachmentId: id, filename: fallbackName, reason: error.message });
    }
  }

  if (unavailable.length) throw new AttachmentUnavailableError(unavailable);
  return resolved;
}
function toPublicRecord({ attachmentId, filename, mimeType, size }) {
  return { attachmentId, filename, mimeType, size };
}

export { resolveAttachments, toPublicRecord };
