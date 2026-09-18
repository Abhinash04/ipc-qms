import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { verifyRole, verifyAction } from '../middleware/verifyRole.js';
import validateBody from '../middleware/validateBody.js';
import { ROLES } from '../constants/roles.js';
import { WORKFLOW_ACTION } from '../constants/workflowActions.js';
import {
  persistTransitionSchema,
  resetQueryStateSchema,
  finalApprovalSchema,
} from '../validators/queryStateSchemas.js';
import {
  loadAllQueries,
  checkIsEmpty,
  persistTransition,
  resetQueryState,
  finalApproval,
} from '../controllers/queryController.js';

const router = express.Router();

/**
 * The workflow-state sync API.
 *
 * Every signed-in role hydrates from GET /queries and writes transitions
 * through POST /queries/persist, so neither can carry a role allow-list — the
 * guard that belongs there is per-case ownership, which is not yet server-side
 * (see middleware/authorizeAttachmentAccess.js for the same gap, and
 * constants/workflowActions.js for why the workflow-state half of `canPerform`
 * is still client-side). What IS enforced here: the request body is validated
 * against a schema so a caller cannot `$set` fields the models never declared,
 * and the audit actor is taken from the session, not the payload.
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

router.post(
  '/queries/reset',
  verifyToken,
  verifyRole(ROLES.SUPER_ADMIN),
  validateBody(resetQueryStateSchema),
  resetQueryState,
);

export default router;
