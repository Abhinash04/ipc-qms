/**
 * Attachment presentation, client-side.
 *
 * This file once mirrored the backend's whole upload policy — supported
 * extensions, per-file and total ceilings, and a `validateFile` pre-flight — for
 * the enquiry form's file picker. That form and its picker are gone: an enquiry
 * arrives as email, and its attachments are fetched from the mailbox by the
 * server, which applies services/attachments/attachmentPolicy.js and is the only
 * authority. Nothing in the app uploads a file any more, so a client-side
 * pre-flight has nothing to check.
 *
 * What is left is formatting, which is presentation and belongs here.
 */
export function formatFileSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
