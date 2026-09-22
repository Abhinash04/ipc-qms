import HTTP_STATUS from '../constants/httpStatus.js';
import * as store from '../services/attachments/attachmentStore.js';
import { EmailMessage } from '../models/index.js';
import { isConnected } from '../config/db.js';
import { isPartyToCase, scopeKindForRole, SCOPE_KIND } from '../services/authz/caseAccess.js';

/**
 * Attachment access control — the case-level half of step 3 in
 * .claude/backend-rules.md.
 *
 * `attachmentRoutes.js` runs `verifyToken` ahead of this on every attachment
 * route, so the caller is a known QMS user by the time it runs. The `req.user`
 * check below is therefore not redundant: it is what makes a route mis-wired to
 * omit `verifyToken` fail closed rather than silently reopening the endpoints to
 * anyone who can reach the port.
 *
 * This used to be the whole of it. The middleware named for access control
 * performed none: it checked that a session existed and called next(), which is
 * what `verifyToken` had already established. Any signed-in account could read
 * any attachment by id — and ids were enumerable, because GET /queries returned
 * the `attachments` array of every case and every message to every caller. An
 * Inquirer, a member of the public, could therefore read every document on every
 * other inquirer's case and the division's internal correspondence.
 */

/**
 * The case an attachment belongs to, or null.
 *
 * `queryId` is often absent and that is not an error: the portal uploads
 * evidence before the case id exists, and Gmail ingestion stores files against
 * the provider's message id. The fallback recovers the whole mail-ingested
 * population once the case is registered — without it an official could not
 * open the attachment on their own case, which would read as data loss.
 */
export async function resolveAttachmentCase(meta) {
  if (meta?.queryId) return meta.queryId;
  if (!meta?.providerMessageId || !isConnected()) return null;

  const message = await EmailMessage.findOne({ sourceMessageId: meta.providerMessageId })
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

    /**
     * Uploads.
     *
     * A queryId is NOT required: portal intake attaches evidence before the
     * case exists, and requiring one would break it. But if the caller names a
     * case, it has to be one of theirs — otherwise this is a way to plant a
     * document on someone else's case.
     */
    if (!req.params.id) {
      const queryId = req.body?.queryId;
      if (queryId && !seesEverything && !(await isPartyToCase(req.user, queryId))) {
        return next(forbidden());
      }
      return next();
    }

    /**
     * A malformed id makes the store throw. Pass it on untouched rather than
     * turning it into a 500 here: the controller already maps it to a 400, and
     * an id that cannot name an attachment discloses nothing by being rejected
     * there instead.
     */
    let meta = null;
    try {
      meta = await store.getMetadata(req.params.id);
    } catch {
      return next();
    }

    // Let the controller answer 404 rather than duplicating it here, so a
    // missing attachment reads the same whoever asks for it.
    if (!meta) return next();

    if (seesEverything) return next();

    const queryId = await resolveAttachmentCase(meta);
    if (queryId) {
      if (!(await isPartyToCase(req.user, queryId))) return next(forbidden());
      return next();
    }

    /**
     * No case, even after the lookup. Two populations end up here: a file
     * uploaded seconds ago against a case that does not exist yet, and older
     * sidecars written before `uploadedBy` was recorded.
     *
     * The uploader may have their own; nobody else may, and a sidecar with no
     * uploader at all is readable only by the roles that see every case. That
     * is the fail-closed default, and it is narrow enough to be tolerable
     * because the population shrinks as soon as a case is registered.
     */
    if (meta.uploadedBy && meta.uploadedBy === req.user.id) return next();
    return next(forbidden());
  } catch (error) {
    return next(error);
  }
}

export default authorizeAttachmentAccess;
