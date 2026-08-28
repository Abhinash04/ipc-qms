import multer from 'multer';
import HTTP_STATUS from '../constants/httpStatus.js';
import * as store from '../services/attachments/attachmentStore.js';
import { validateUpload, limits } from '../services/attachments/attachmentPolicy.js';

/**
 * Memory storage: files are validated and persisted through attachmentStore
 * (disk), never left on multer's own temp path. `limits` catches an oversize
 * single file before it is even fully buffered; attachmentPolicy catches
 * everything limits() cannot (type, combined total, file count is enforced
 * again here as a matching guard so the two never drift silently).
 */
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
        }),
      ),
    );

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

/**
 * Streams the raw bytes. `?download=1` asks for Content-Disposition:
 * attachment; anything else serves inline so the browser can preview it.
 *
 * Two headers matter here beyond content: helmet's defaults set
 * Cross-Origin-Resource-Policy: same-origin and X-Frame-Options: SAMEORIGIN,
 * both of which would silently block an <img>/<iframe> on the Vite dev
 * origin (5173) from loading bytes served from here (5000). This route opts
 * itself out of both — it is the one place in the API meant to be embedded
 * cross-origin by the app's own frontend.
 */
async function serveFile(req, res, next) {
  try {
    const meta = await store.getMetadata(req.params.id);
    if (!meta) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Attachment not found', attachmentId: req.params.id });
    }

    let buffer;
    try {
      buffer = await store.readBytes(req.params.id);
    } catch {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ error: 'Attachment bytes are unavailable', attachmentId: req.params.id });
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
    res.send(buffer);
  } catch (error) {
    next(error);
  }
}

export { uploadMiddleware, uploadFiles, getMeta, serveFile };
