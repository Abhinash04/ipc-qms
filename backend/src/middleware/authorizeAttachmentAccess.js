import HTTP_STATUS from '../constants/httpStatus.js';

/**
 * Attachment access control — the case-level half of step 3 in
 * .claude/backend-rules.md.
 *
 * `attachmentRoutes.js` runs `verifyToken` ahead of this on every attachment
 * route, so the caller is a known QMS user by the time it runs. The `req.user`
 * check below is therefore not redundant: it is what makes a route mis-wired
 * to omit `verifyToken` fail closed rather than silently reopening the
 * endpoints to anyone who can reach the port.
 *
 * TODO(phase-2): narrow to per-case access. An Inquirer should reach only
 * their own case's attachments, and staff only cases they are party to, per
 * the rules in frontend/src/constants/workflowRules.js. That needs Query Case
 * state server-side, which lives in the browser's IndexedDB today — until then
 * any authenticated user can read any attachment by id.
 */
function authorizeAttachmentAccess(req, res, next) {
  if (!req.user) {
    return next(
      Object.assign(new Error('Authentication required'), {
        status: HTTP_STATUS.UNAUTHORIZED,
      }),
    );
  }

  return next();
}

export default authorizeAttachmentAccess;
