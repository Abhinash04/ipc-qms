/**
 * Thrown when one or more attachments referenced on a send/forward cannot be
 * resolved to real bytes — unknown id, missing file, or a checksum mismatch.
 * Carries every offending attachment so the caller can report all of them at
 * once rather than failing one at a time.
 */
class AttachmentUnavailableError extends Error {
  constructor(unavailable) {
    const names = unavailable.map((u) => u.filename || u.attachmentId || 'unknown').join(', ');
    super(`Attachment(s) unavailable: ${names}`);
    this.name = 'AttachmentUnavailableError';
    this.status = 409;
    this.unavailableAttachments = unavailable;
    // errorHandler.js spreads `details` onto the JSON error response.
    this.details = { unavailableAttachments: unavailable };
  }
}

export { AttachmentUnavailableError };
