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

router.get('/queries', verifyToken, loadAllQueries);
router.get('/queries/is-empty', verifyToken, checkIsEmpty);

router.post(
  '/queries/persist',
  verifyToken,
  validateBody(persistTransitionSchema),
  authorizeCaseDelta,
  persistTransition,
);

router.post(
  '/queries/:queryId/final-approval',
  verifyToken,
  verifyAction(WORKFLOW_ACTION.FINAL_APPROVE),
  validateBody(finalApprovalSchema),
  finalApproval,
);

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
