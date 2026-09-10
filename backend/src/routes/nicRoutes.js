import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { verifyRole } from '../middleware/verifyRole.js';
import { ROLES } from '../constants/roles.js';
import { status, readMail, sendMail } from '../controllers/nicController.js';

const router = express.Router();

/**
 * NICeMail verification endpoints.
 *
 * These operate the official Front Office mailbox directly, so they are held
 * to the same roles as the mailbox routes. Sending in particular is never
 * automatic — it happens only on an explicit authenticated request.
 */
const MAILBOX_OPERATORS = [ROLES.FRONT_OFFICE, ROLES.SUPER_ADMIN];

router.get('/nic/status', verifyToken, verifyRole(MAILBOX_OPERATORS), status);
router.post('/nic/read', verifyToken, verifyRole(MAILBOX_OPERATORS), readMail);
router.post('/nic/send', verifyToken, verifyRole(MAILBOX_OPERATORS), sendMail);

export default router;
