import multer from 'multer';
import HTTP_STATUS from '../constants/httpStatus.js';
import * as store from '../services/attachments/attachmentStore.js';
import { validateUpload, limits } from '../services/attachments/attachmentPolicy.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';

const recordAttachment = (req, action, meta, { messageId = null } = {}) =>
  audit.record({
    action,
    actorType: ACTOR_TYPES.HUMAN,
    actorId: req.user?.id ?? null,
    actorRole: req.user?.role ?? null,
    attachmentId: meta.attachmentId,
    queryId: meta.queryId ?? null,
    messageId,
    details: { filename: meta.filename, mimeType: meta.mimeType, size: meta.size },
  });

function buildUpload() {
  const { maxFileBytes, maxFiles } = limits();
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileBytes, files: maxFiles },
  }).array('files', maxFiles);
}

function uploadMiddleware(req, res, next) {
  buildUpload()(req, res, (err) => {
    if (err) {
      err.status = HTTP_STATUS.BAD_REQUEST;
      return next(err);
    }
    next();
  });
}

function toPublicRecord(meta) {
  return {
    attachmentId: meta.attachmentId,
    filename: meta.filename,
    mimeType: meta.mimeType,
    size: meta.size,
  };
}

async function uploadFiles(req, res, next) {
  try {
    const files = req.files || [];
    const validation = validateUpload(files);
    if (!validation.ok) {
      throw Object.assign(new Error(validation.message), {
        status: HTTP_STATUS.BAD_REQUEST,
        details: { errors: validation.errors },
      });
    }

    const saved = await Promise.all(
      files.map((file) =>
        store.save({
          buffer: file.buffer,
          filename: file.originalname,
          mimeType: file.mimetype,
          queryId: req.body?.queryId || null,
          uploadedBy: req.user?.id || null,
        }),
      ),
    );

    await Promise.all(saved.map((meta) => recordAttachment(req, AUDIT_ACTIONS.ATTACHMENT_UPLOADED, meta)));

    res.status(HTTP_STATUS.CREATED).json({ attachments: saved.map(toPublicRecord) });
  } catch (error) {
    next(error);
  }
}

async function getMeta(req, res, next) {
  try {
    const meta = await store.getMetadata(req.params.id);
    if (!meta) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Attachment not found', attachmentId: req.params.id });
    }
    res.status(HTTP_STATUS.OK).json(toPublicRecord(meta));
  } catch (error) {
    next(error);
  }
}

async function sendAttachment(req, res, attachmentId, { messageId = null } = {}) {
  const meta = await store.getMetadata(attachmentId);
  if (!meta) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Attachment not found', attachmentId });
  }

  let buffer;
  try {
    buffer = await store.readBytes(attachmentId);
  } catch {
    return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Attachment bytes are unavailable', attachmentId });
  }

  const disposition = req.query.download ? 'attachment' : 'inline';
  const asciiName = (meta.filename || 'attachment').replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");

  res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(meta.filename || 'attachment')}`,
  );
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.removeHeader('X-Frame-Options');

  await recordAttachment(req, AUDIT_ACTIONS.ATTACHMENT_DOWNLOADED, meta, { messageId });
  return res.send(buffer);
}

async function serveFile(req, res, next) {
  try {
    await sendAttachment(req, res, req.params.id);
  } catch (error) {
    next(error);
  }
}

export { uploadMiddleware, uploadFiles, getMeta, serveFile, sendAttachment };
