import env from '../../config/env.js';

/**
 * One table drives both validations: an upload must have an extension AND a
 * declared mimetype that agree with each other and appear together in some
 * row here. A `.pdf` claiming `application/x-msdownload` is rejected even
 * though `.pdf` alone is allowed — mismatch, not just "unknown type".
 */
const SUPPORTED_TYPES = [
  { category: 'image', exts: ['png'], mimes: ['image/png'] },
  { category: 'image', exts: ['jpg', 'jpeg'], mimes: ['image/jpeg'] },
  { category: 'image', exts: ['gif'], mimes: ['image/gif'] },
  { category: 'image', exts: ['webp'], mimes: ['image/webp'] },
  { category: 'video', exts: ['mp4'], mimes: ['video/mp4'] },
  { category: 'video', exts: ['webm'], mimes: ['video/webm'] },
  { category: 'video', exts: ['mov'], mimes: ['video/quicktime'] },
  { category: 'audio', exts: ['mp3'], mimes: ['audio/mpeg'] },
  { category: 'audio', exts: ['wav'], mimes: ['audio/wav', 'audio/x-wav'] },
  { category: 'audio', exts: ['ogg'], mimes: ['audio/ogg'] },
  { category: 'audio', exts: ['m4a'], mimes: ['audio/mp4', 'audio/x-m4a'] },
  { category: 'document', exts: ['pdf'], mimes: ['application/pdf'] },
  { category: 'document', exts: ['xls'], mimes: ['application/vnd.ms-excel'] },
  {
    category: 'document',
    exts: ['xlsx'],
    mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  },
  { category: 'document', exts: ['doc'], mimes: ['application/msword'] },
  {
    category: 'document',
    exts: ['docx'],
    mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  },
  { category: 'document', exts: ['ppt'], mimes: ['application/vnd.ms-powerpoint'] },
  {
    category: 'document',
    exts: ['pptx'],
    mimes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  },
  { category: 'document', exts: ['csv'], mimes: ['text/csv', 'application/vnd.ms-excel'] },
  { category: 'document', exts: ['txt'], mimes: ['text/plain'] },
  { category: 'archive', exts: ['zip'], mimes: ['application/zip', 'application/x-zip-compressed'] },
];

function extensionOf(filename) {
  const match = /\.([a-z0-9]+)$/i.exec(filename || '');
  return match ? match[1].toLowerCase() : '';
}

function findRow(ext, mime) {
  return SUPPORTED_TYPES.find(
    (row) => row.exts.includes(ext) && row.mimes.includes(String(mime || '').toLowerCase()),
  );
}

/** Bytes are read once per request at boot time via env, not cached at import,
 *  to match the rest of the config (identities.js, mailbox/index.js). */
function limits() {
  return {
    maxFileBytes: env.ATTACHMENT_MAX_FILE_MB * 1024 * 1024,
    maxTotalBytes: env.ATTACHMENT_MAX_TOTAL_MB * 1024 * 1024,
    maxFiles: env.ATTACHMENT_MAX_FILES,
  };
}

/**
 * Validates one file's declared name + mimetype + size against the policy.
 * Returns `{ ok: true }` or `{ ok: false, reason }`.
 */
function validateFile({ filename, mimeType, size }) {
  const { maxFileBytes } = limits();
  const ext = extensionOf(filename);

  if (!ext) return { ok: false, reason: 'missing file extension' };
  if (!findRow(ext, mimeType)) {
    return { ok: false, reason: `unsupported file type "${ext}" (${mimeType || 'unknown mimetype'})` };
  }
  if (typeof size === 'number' && size <= 0) return { ok: false, reason: 'empty file' };
  if (typeof size === 'number' && size > maxFileBytes) {
    return { ok: false, reason: `exceeds the ${env.ATTACHMENT_MAX_FILE_MB}MB per-file limit` };
  }
  return { ok: true };
}

/**
 * Validates a whole upload batch: each file individually, plus file-count and
 * combined-size ceilings. Returns `{ ok, message, errors }` where `errors` is
 * per-file `{ filename, reason }`.
 */
function validateUpload(files) {
  const { maxTotalBytes, maxFiles } = limits();
  const errors = [];

  if (!files || files.length === 0) {
    return { ok: false, message: 'At least one file is required', errors: [] };
  }
  if (files.length > maxFiles) {
    return { ok: false, message: `at most ${maxFiles} files may be uploaded at once`, errors: [] };
  }

  let total = 0;
  for (const file of files) {
    const filename = file.originalname || file.filename;
    const size = typeof file.size === 'number' ? file.size : file.buffer?.length || 0;
    total += size;
    const result = validateFile({ filename, mimeType: file.mimetype, size });
    if (!result.ok) errors.push({ filename, reason: result.reason });
  }

  if (total > maxTotalBytes) {
    errors.push({ filename: null, reason: `combined upload exceeds the ${env.ATTACHMENT_MAX_TOTAL_MB}MB total limit` });
  }

  if (errors.length) {
    return { ok: false, message: 'One or more files failed validation', errors };
  }
  return { ok: true, message: null, errors: [] };
}

export { SUPPORTED_TYPES, extensionOf, validateFile, validateUpload, limits };
