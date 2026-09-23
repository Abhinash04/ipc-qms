import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { verifyRole } from '../middleware/verifyRole.js';
import { ROLES } from '../constants/roles.js';
import { status, readMail, sendMail } from '../controllers/nicController.js';

const router = express.Router();
const MAILBOX_OPERATORS = [ROLES.FRONT_OFFICE, ROLES.SUPER_ADMIN];

router.get('/nic/status', verifyToken, verifyRole(MAILBOX_OPERATORS), status);
router.post('/nic/read', verifyToken, verifyRole(MAILBOX_OPERATORS), readMail);
router.post('/nic/send', verifyToken, verifyRole(MAILBOX_OPERATORS), sendMail);

export default router;
