import HTTP_STATUS from '../constants/httpStatus.js';
import * as store from '../services/attachments/attachmentStore.js';
import { EmailMessage } from '../models/index.js';
import { isConnected } from '../config/db.js';
import { isPartyToCase, scopeKindForRole, SCOPE_KIND } from '../services/authz/caseAccess.js';

export async function resolveAttachmentCase(meta) {
  if (meta?.queryId) return meta.queryId;
  if (!meta?.providerMessageId || !isConnected()) return null;

  const message = await EmailMessage.findOne({
    $or: [
      { sourceMessageId: meta.providerMessageId },
      { providerMessageId: meta.providerMessageId, direction: 'INBOUND' },
    ],
  })
    .select('queryId')
    .lean();
  return message?.queryId || null;
}

const forbidden = () =>
  Object.assign(new Error('You are not permitted to access this attachment'), {
    status: HTTP_STATUS.FORBIDDEN,
  });

async function authorizeAttachmentAccess(req, res, next) {
  try {
    if (!req.user) {
      return next(
        Object.assign(new Error('Authentication required'), {
          status: HTTP_STATUS.UNAUTHORIZED,
        }),
      );
    }

    const seesEverything = scopeKindForRole(req.user.role) === SCOPE_KIND.EVERYTHING;

    if (!req.params.id) {
      const queryId = req.body?.queryId;
      if (queryId && !seesEverything && !(await isPartyToCase(req.user, queryId))) {
        return next(forbidden());
      }
      return next();
    }

    let meta = null;
    try {
      meta = await store.getMetadata(req.params.id);
    } catch {
      return next();
    }

    if (!meta) return next();

    if (seesEverything) return next();

    const queryId = await resolveAttachmentCase(meta);
    if (queryId) {
      if (!(await isPartyToCase(req.user, queryId))) return next(forbidden());
      return next();
    }

    if (meta.uploadedBy && meta.uploadedBy === req.user.id) return next();
    return next(forbidden());
  } catch (error) {
    return next(error);
  }
}

export default authorizeAttachmentAccess;
