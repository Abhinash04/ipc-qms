import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { verifyAction } from '../middleware/verifyRole.js';
import validateBody from '../middleware/validateBody.js';
import { WORKFLOW_ACTION } from '../constants/workflowActions.js';
import { pullbackSchema } from '../validators/pullbackSchemas.js';
import { pullBackQuery } from '../controllers/pullbackController.js';

const router = express.Router();

/**
 * Authorization goes through `verifyAction(PULLBACK)` rather than a hand-rolled
 * role comparison inside the handler. ROLE_ACTIONS already grants PULLBACK to
 * ADMIN and SUPER_ADMIN only, so the allow-set is unchanged — what changes is
 * that a refusal is now recorded in the audit trail like every other one, and
 * that the rule lives with the other workflow rules instead of being restated.
 *
 * This router is mounted under /api/v1 (routes/index.js), so the path below
 * resolves to /api/v1/queries/:queryId/pullback. A second registration for
 * '/api/queries/:queryId/pullback' used to sit here too, which resolved to
 * /api/v1/api/queries/... — a path no client could sensibly call.
 */
router.post(
  '/queries/:queryId/pullback',
  verifyToken,
  verifyAction(WORKFLOW_ACTION.PULLBACK),
  validateBody(pullbackSchema),
  pullBackQuery,
);

export default router;
