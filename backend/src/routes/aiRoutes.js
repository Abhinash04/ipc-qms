import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { verifyRole } from '../middleware/verifyRole.js';
import { ROLES } from '../constants/roles.js';
import * as aiController from '../controllers/aiController.js';

const router = express.Router();

router.post('/summary', verifyToken, aiController.generateSummary);
router.post('/recommend', verifyToken, aiController.recommendOfficial);
router.post('/draft', verifyToken, aiController.generateDraft);
// Who a case can be assigned or transferred to: the people who do either, and administrators.
router.get(
  '/officials',
  verifyToken,
  verifyRole(ROLES.OFFICER_IN_CHARGE, ROLES.ASSIGNED_OFFICIAL, ROLES.ADMIN, ROLES.SUPER_ADMIN),
  aiController.listOfficials,
);

export default router;
