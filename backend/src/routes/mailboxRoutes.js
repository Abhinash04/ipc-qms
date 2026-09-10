import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { verifyRole } from '../middleware/verifyRole.js';
import { ROLES } from '../constants/roles.js';
import {
  listMessages,
  receiveMessage,
  markIngested,
  deleteMessage,
  resetMailbox,
} from '../controllers/mailboxController.js';

const router = express.Router();

/**
 * The mailbox is the Front Officer's. Under MAILBOX_SOURCE=gmail these routes
 * operate on a real Gmail account, so the destructive ones are held to
 * SUPER_ADMIN rather than merely to staff.
 */
const FRONT_OFFICE_ONLY = [ROLES.FRONT_OFFICE, ROLES.SUPER_ADMIN];

router.get('/mailbox/messages', verifyToken, verifyRole(FRONT_OFFICE_ONLY), listMessages);

// Injects a message into the store — a development/testing affordance.
router.post('/mailbox/receive', verifyToken, verifyRole(ROLES.SUPER_ADMIN), receiveMessage);

router.post(
  '/mailbox/messages/:messageId/ingested',
  verifyToken,
  verifyRole(FRONT_OFFICE_ONLY),
  markIngested,
);

// Trashes the message in the real account when MAILBOX_SOURCE=gmail.
router.delete(
  '/mailbox/messages/:messageId',
  verifyToken,
  verifyRole(FRONT_OFFICE_ONLY),
  deleteMessage,
);

// The single most destructive endpoint in the API: no body, no confirmation,
// wipes the whole store.
router.delete('/mailbox', verifyToken, verifyRole(ROLES.SUPER_ADMIN), resetMailbox);

export default router;
