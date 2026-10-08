import { createHash } from 'crypto';
import * as store from './attachmentStore.js';
import { AttachmentUnavailableError } from './errors.js';

/** Loads one attachment and checks it against its stored checksum: { attachment } or { missing }. */
async function resolveOne(ref) {
  const id = ref?.attachmentId || ref?.id;
  const fallbackName = ref?.filename || ref?.name || null;

  if (!id) {
    return { missing: { attachmentId: null, filename: fallbackName, reason: 'no attachmentId provided' } };
  }

  try {
    const meta = await store.getMetadata(id);
    if (!meta) {
      return { missing: { attachmentId: id, filename: fallbackName, reason: 'attachment not found' } };
    }

    const buffer = await store.readBytes(id);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    if (sha256 !== meta.sha256) {
      return { missing: { attachmentId: id, filename: meta.filename, reason: 'corrupted (checksum mismatch)' } };
    }

    return {
      attachment: {
        attachmentId: id,
        filename: meta.filename,
        mimeType: meta.mimeType,
        size: meta.size,
        content: buffer,
      },
    };
  } catch (error) {
    return { missing: { attachmentId: id, filename: fallbackName, reason: error.message } };
  }
}

async function resolveAttachments(refs = []) {
  if (!refs || refs.length === 0) return [];

  // The attachments are independent, so they load together; results keep the order they were given in.
  const outcomes = await Promise.all(refs.map(resolveOne));
  const resolved = outcomes.filter((outcome) => outcome.attachment).map((outcome) => outcome.attachment);
  const unavailable = outcomes.filter((outcome) => outcome.missing).map((outcome) => outcome.missing);

  if (unavailable.length) throw new AttachmentUnavailableError(unavailable);
  return resolved;
}
function toPublicRecord({ attachmentId, filename, mimeType, size }) {
  return { attachmentId, filename, mimeType, size };
}

export { resolveAttachments, toPublicRecord };
