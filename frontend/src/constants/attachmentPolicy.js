/**
 * Client-side mirror of backend/src/services/attachments/attachmentPolicy.js.
 * Two unlinked packages, so this duplication is unavoidable — this is only a
 * pre-flight check for a nicer UX (reject obviously-bad files before an
 * upload round trip); the backend re-validates everything regardless, and is
 * the actual authority. Keep the two tables in sync by hand.
 */

export const SUPPORTED_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp',
  'mp4', 'webm', 'mov',
  'mp3', 'wav', 'ogg', 'm4a',
  'pdf', 'xls', 'xlsx', 'doc', 'docx', 'ppt', 'pptx', 'csv', 'txt',
  'zip',
];

export const MAX_FILE_MB = 10;
export const MAX_TOTAL_MB = 15;
export const MAX_FILES = 10;

export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
export const MAX_TOTAL_BYTES = MAX_TOTAL_MB * 1024 * 1024;

function extensionOf(filename) {
  const match = /\.([a-z0-9]+)$/i.exec(filename || '');
  return match ? match[1].toLowerCase() : '';
}

/** Returns `{ ok: true }` or `{ ok: false, reason }`. Pre-flight only. */
export function validateFile(file) {
  const ext = extensionOf(file?.name);
  if (!ext) return { ok: false, reason: 'missing file extension' };
  if (!SUPPORTED_EXTENSIONS.includes(ext)) return { ok: false, reason: 'unsupported file type' };
  if (file.size === 0) return { ok: false, reason: 'empty file' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: `exceeds ${MAX_FILE_MB}MB` };
  return { ok: true };
}

/** True when any pending file failed pre-flight validation. */
export function hasBlockingErrors(files) {
  return files.some((entry) => Boolean(entry.error));
}

export function formatFileSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
