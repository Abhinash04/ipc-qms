import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { verifyRole } from '../middleware/verifyRole.js';
import { ROLES } from '../constants/roles.js';
import { listEvents, getSummary, getForQuery } from '../controllers/auditController.js';

const router = express.Router();

/**
 * The audit trail records who did what across the whole system, so reading it
 * is an administrative capability — not something an operational role needs.
 */
const ADMINISTRATORS = [ROLES.ADMIN, ROLES.SUPER_ADMIN];

router.get('/audit', verifyToken, verifyRole(ADMINISTRATORS), listEvents);
router.get('/audit/summary', verifyToken, verifyRole(ADMINISTRATORS), getSummary);
router.get('/audit/query/:queryId', verifyToken, verifyRole(ADMINISTRATORS), getForQuery);

export default router;
