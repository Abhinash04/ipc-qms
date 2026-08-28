import { createHash } from 'crypto';
import * as store from './attachmentStore.js';
import { AttachmentUnavailableError } from './errors.js';

/**
 * Turns `{attachmentId}` references into real bytes, or fails the whole batch.
 *
 * This is the fail-closed gate for every outbound email that may carry
 * attachments (enquiry, forward-to-OIC, final response): if any referenced
 * attachment is unknown, its bytes are missing on disk, or its bytes no
 * longer match the checksum recorded at upload time, nothing is resolved and
 * an `AttachmentUnavailableError` is thrown naming every offending file. A
 * partially-resolved send would let the recipient believe they received
 * everything when a document is silently missing — that must never happen.
 *
 * Returns `[]` for no refs. On success, returns one record per ref:
 * `{ attachmentId, filename, mimeType, size, content: Buffer }`.
 */
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

/** Strips raw bytes before a resolved record is echoed back over HTTP or into a mailbox. */
function toPublicRecord({ attachmentId, filename, mimeType, size }) {
  return { attachmentId, filename, mimeType, size };
}

export { resolveAttachments, toPublicRecord };
