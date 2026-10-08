import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { verifyAction } from '../middleware/verifyRole.js';
import validateBody from '../middleware/validateBody.js';
import { WORKFLOW_ACTION } from '../constants/workflowActions.js';
import { pullbackSchema } from '../validators/pullbackSchemas.js';
import { pullBackQuery } from '../controllers/pullbackController.js';

const router = express.Router();

router.post(
  '/queries/:queryId/pullback',
  verifyToken,
  verifyAction(WORKFLOW_ACTION.PULLBACK),
  validateBody(pullbackSchema),
  pullBackQuery,
);

export default router;
