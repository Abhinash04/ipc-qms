/**
 * SECURITY GAP — see backend/README.md "Security status: NOT production-ready".
 *
 * The backend has no authentication mechanism at all (no JWT, no session, no
 * `req.user`, no middleware on any existing route), so there is nothing for
 * an authorization check here to enforce against. This is the seam where
 * per-query authorization belongs the moment backend auth exists — an
 * Inquirer may read only their own case's attachments; FRONT_OFFICE,
 * OFFICER_IN_CHARGE, and the assigned official per the rules already encoded
 * in frontend/src/constants/workflowRules.js.
 *
 * Until then this is a deliberate, explicit no-op: it neither authenticates
 * nor authorizes. It exists so wiring real auth in later is one function body
 * to fill in, not a new middleware chain to design and re-wire across three
 * routes. Frontend RBAC (ProtectedRoute.jsx, workflowRules.js) still gates
 * what the UI *offers*, but it is a usability boundary, not a security one —
 * anyone who can reach this server directly bypasses it entirely.
 *
 * TODO(security): implement real per-query authorization here before any
 * production deployment.
 */
function authorizeAttachmentAccess(req, res, next) {
  next();
}

export default authorizeAttachmentAccess;
