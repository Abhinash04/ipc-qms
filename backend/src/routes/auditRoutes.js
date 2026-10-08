import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { verifyRole } from '../middleware/verifyRole.js';
import { ROLES } from '../constants/roles.js';
import {
  listEvents,
  getSummary,
  getForQuery,
  verifyChain,
  exportEvents,
} from '../controllers/auditController.js';

const router = express.Router();
const ADMINISTRATORS = [ROLES.ADMIN, ROLES.SUPER_ADMIN];

// Read-only. No route updates or deletes an audit event.
router.get('/audit', verifyToken, verifyRole(ADMINISTRATORS), listEvents);
router.get('/audit/summary', verifyToken, verifyRole(ADMINISTRATORS), getSummary);
router.get('/audit/verify', verifyToken, verifyRole(ADMINISTRATORS), verifyChain);
router.get('/audit/export', verifyToken, verifyRole(ADMINISTRATORS), exportEvents);
router.get('/audit/query/:queryId', verifyToken, verifyRole(ADMINISTRATORS), getForQuery);

export default router;
