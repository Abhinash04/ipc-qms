import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { verifyRole, verifyAction } from '../middleware/verifyRole.js';
import validateBody from '../middleware/validateBody.js';
import authorizeCaseDelta from '../middleware/authorizeCaseDelta.js';
import { ROLES } from '../constants/roles.js';
import { WORKFLOW_ACTION } from '../constants/workflowActions.js';
import {
  persistTransitionSchema,
  resetQueryStateSchema,
  finalApprovalSchema,
  resolveOutboundSchema,
} from '../validators/queryStateSchemas.js';
import {
  loadAllQueries,
  checkIsEmpty,
  persistTransition,
  resetQueryState,
  finalApproval,
  resolveOutbound,
} from '../controllers/queryController.js';

const router = express.Router();

/**
 * The workflow-state sync API.
 *
 * Every signed-in role hydrates from GET /queries and writes transitions
 * through POST /queries/persist, so neither can carry a role allow-list — an
 * allow-list naming every role denies nothing. Per-case ownership is the guard
 * that belongs here, and it is now server-side:
 *
 *   - GET /queries is filtered to the cases the caller is party to, by
 *     services/authz/caseAccess.js. The four roles whose scope is "everything"
 *     (Front Office, Officer-in-Charge, Admin, Super Admin) still see all of
 *     them; an Inquirer sees their own enquiry.
 *   - POST /queries/persist runs middleware/authorizeCaseDelta.js, which checks
 *     the values the delta sets against the caller's workflow actions, and then
 *     checks every case it touches against the caller's scope as stored BEFORE
 *     the delta.
 *
 * Also still enforced: the body is validated against a schema so a caller
 * cannot `$set` fields the models never declared, and the audit actor is taken
 * from the session, not the payload.
 *
 * /queries/reset is different in kind: it deletes every case in the system.
 * That is an administrative act, not a workflow one.
 */
router.get('/queries', verifyToken, loadAllQueries);
router.get('/queries/is-empty', verifyToken, checkIsEmpty);

router.post(
  '/queries/persist',
  verifyToken,
  validateBody(persistTransitionSchema),
  authorizeCaseDelta,
  persistTransition,
);

/**
 * Final approval, and the response that follows it — one call, server-side.
 *
 * Gated on FINAL_APPROVE, which the Officer-in-Charge holds. The send inside it
 * is performed by the server under the Front Office identity, so DISPATCH stays
 * a Front Office permission and nobody gained it: the client used to make this
 * call itself from the approving officer's session, against the Front-Office-only
 * /emails/response, and every approval ended in a 403.
 */
router.post(
  '/queries/:queryId/final-approval',
  verifyToken,
  verifyAction(WORKFLOW_ACTION.FINAL_APPROVE),
  validateBody(finalApprovalSchema),
  finalApproval,
);

/**
 * "It was sent" / "It was not sent" — settles a case email whose send was
 * UNCERTAIN, after someone has checked the sending mailbox's Sent folder.
 *
 * The Front Office owns the mailbox and the retry buttons, so it owns the
 * answer; Super Admin for support. Nothing is sent by this call.
 */
router.post(
  '/queries/:queryId/outbound/resolve',
  verifyToken,
  verifyRole(ROLES.FRONT_OFFICE, ROLES.SUPER_ADMIN),
  validateBody(resolveOutboundSchema),
  resolveOutbound,
);

router.post(
  '/queries/reset',
  verifyToken,
  verifyRole(ROLES.SUPER_ADMIN),
  validateBody(resetQueryStateSchema),
  resetQueryState,
);

export default router;
