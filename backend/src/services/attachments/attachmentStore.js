import { randomUUID, createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import env from '../../config/env.js';

/**
 * Disk is the single source of truth for attachment bytes. Mongo is optional
 * in this repo (config/db.js falls back to an in-memory mailbox when
 * DATABASE_URL is unset or unreachable), so disk is the only store that works
 * in every configuration and is what can feed real bytes into a Gmail MIME
 * multipart.
 *
 * Each attachment is a pair of files: `<id>.bin` (raw bytes) and `<id>.json`
 * (metadata sidecar). The sidecar means metadata survives a backend restart
 * without a database, the same guarantee the rest of this store gives.
 */

const ID_PATTERN = /^att_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function root() {
  return env.ATTACHMENT_DIR;
}

/**
 * The only thing standing between `:attachmentId` and directory traversal —
 * every path built by this module passes through here first.
 */
function assertValidId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw Object.assign(new Error(`Invalid attachment id "${id}"`), { status: 400 });
  }
}

function binPath(id) {
  assertValidId(id);
  return path.join(root(), `${id}.bin`);
}

function metaPath(id) {
  assertValidId(id);
  return path.join(root(), `${id}.json`);
}

async function ensureRoot() {
  await fs.mkdir(root(), { recursive: true });
}

/**
 * Writes bytes + metadata under a caller-supplied id. Idempotent by design —
 * writing the same id twice just overwrites — which is what lets Gmail
 * ingestion derive a deterministic id from (messageId, providerAttachmentId)
 * and re-poll safely without an index.
 */
async function saveWithId(
  id,
  { buffer, filename, mimeType, queryId = null, providerMessageId = null, providerAttachmentId = null },
) {
  assertValidId(id);
  if (!Buffer.isBuffer(buffer)) throw new Error('attachmentStore.saveWithId: buffer is required');
  if (!filename) throw new Error('attachmentStore.saveWithId: filename is required');

  await ensureRoot();
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const metadata = {
    attachmentId: id,
    filename,
    mimeType: mimeType || 'application/octet-stream',
    size: buffer.length,
    sha256,
    queryId,
    providerMessageId,
    providerAttachmentId,
    createdAt: new Date().toISOString(),
  };

  await fs.writeFile(binPath(id), buffer);
  await fs.writeFile(metaPath(id), JSON.stringify(metadata));
  return metadata;
}

async function save({ buffer, filename, mimeType, queryId = null }) {
  const id = `att_${randomUUID()}`;
  return saveWithId(id, { buffer, filename, mimeType, queryId });
}

async function getMetadata(id) {
  assertValidId(id);
  try {
    const raw = await fs.readFile(metaPath(id), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readBytes(id) {
  assertValidId(id);
  try {
    return await fs.readFile(binPath(id));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`attachment ${id}: bytes are missing on disk`, { cause: error });
    }
    throw error;
  }
}

async function exists(id) {
  return Boolean(await getMetadata(id));
}

async function remove(id) {
  assertValidId(id);
  await Promise.allSettled([fs.unlink(binPath(id)), fs.unlink(metaPath(id))]);
}

/** Test-only: wipes the whole store. Never called from production code paths. */
async function reset() {
  await fs.rm(root(), { recursive: true, force: true });
  await ensureRoot();
}

export { save, saveWithId, getMetadata, readBytes, exists, remove, reset, ID_PATTERN };
