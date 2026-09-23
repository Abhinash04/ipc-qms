import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { verifyRole } from '../middleware/verifyRole.js';
import validateBody from '../middleware/validateBody.js';
import validateQuery from '../middleware/validateQuery.js';
import { ROLES } from '../constants/roles.js';
import {
  mailboxDecisionSchema,
  acceptMessageSchema,
  listMessagesQuerySchema,
} from '../validators/mailboxSchemas.js';
import {
  listMessages,
  receiveMessage,
  markIngested,
  deleteMessage,
  resetMailbox,
  decideMessage,
  acceptMessage,
  listDecisions,
  getMessage,
  downloadMessageAttachment,
  markRead,
  syncMailbox,
} from '../controllers/mailboxController.js';

const router = express.Router();

/**
 * The mailbox is the Front Officer's. When it is a live NICeMail account these
 * routes operate on somebody's real mail, so the destructive ones are held to
 * SUPER_ADMIN rather than merely to staff.
 */
const FRONT_OFFICE_ONLY = [ROLES.FRONT_OFFICE, ROLES.SUPER_ADMIN];

// `?q=` searches, `?limit=&offset=` pages; without `limit` the whole list, as before.
router.get(
  '/mailbox/messages',
  verifyToken,
  verifyRole(FRONT_OFFICE_ONLY),
  validateQuery(listMessagesQuerySchema),
  listMessages,
);

// One message in full, with its case; and its attachments, only through it.
router.get('/mailbox/messages/:messageId', verifyToken, verifyRole(FRONT_OFFICE_ONLY), getMessage);
router.get(
  '/mailbox/messages/:messageId/attachments/:attachmentId',
  verifyToken,
  verifyRole(FRONT_OFFICE_ONLY),
  downloadMessageAttachment,
);

// The Front Office opened it. QMS state only: NICeMail's own is never changed.
router.post('/mailbox/messages/:messageId/read', verifyToken, verifyRole(FRONT_OFFICE_ONLY), markRead);

// Read the NICeMail inbox now rather than on the next poll. Background; 202.
router.post('/mailbox/sync', verifyToken, verifyRole(FRONT_OFFICE_ONLY), syncMailbox);

// Injects a message into the store — a development/testing affordance, and
// refused by the controller when NODE_ENV=production.
router.post('/mailbox/receive', verifyToken, verifyRole(ROLES.SUPER_ADMIN), receiveMessage);

router.post(
  '/mailbox/messages/:messageId/ingested',
  verifyToken,
  verifyRole(FRONT_OFFICE_ONLY),
  markIngested,
);

/**
 * The validation gate: the Front Officer accepts an incoming message as an IPC
 * query, or rejects it. Nothing upstream of this creates a case.
 *
 * Idempotent by construction — the first decision on a message wins, and a
 * repeat returns the stored one with `alreadyDecided: true` rather than
 * deciding again. See services/email/mailbox/decisions.js.
 */
router.post(
  '/mailbox/messages/:messageId/decision',
  verifyToken,
  verifyRole(FRONT_OFFICE_ONLY),
  validateBody(mailboxDecisionSchema),
  decideMessage,
);

/**
 * Accept: the whole intake sequence in one call — mint the Case ID, create the
 * case, acknowledge the sender, forward to the Officer-in-Charge.
 *
 * Server-side because the browser is the wrong place for it: a closed tab
 * halfway through used to leave a case nobody had been told about, and the id
 * came from a counter the client held, so two tabs could mint the same one.
 * Safe to retry — every step checks its own artefact before acting.
 */
router.post(
  '/mailbox/messages/:messageId/accept',
  verifyToken,
  verifyRole(FRONT_OFFICE_ONLY),
  validateBody(acceptMessageSchema),
  acceptMessage,
);

// Lets the inbox show what has already been accepted or rejected. Necessary
// because a message read from a real mailbox carries no QMS state of its own.
router.get('/mailbox/decisions', verifyToken, verifyRole(FRONT_OFFICE_ONLY), listDecisions);

// Removes the message from the Front Office inbox. The NICeMail store marks it
// removed rather than deleting it, so a later sync does not bring it back.
router.delete(
  '/mailbox/messages/:messageId',
  verifyToken,
  verifyRole(FRONT_OFFICE_ONLY),
  deleteMessage,
);

// The single most destructive endpoint in the API: no body, no confirmation,
// wipes the whole store. Refused by the controller when NODE_ENV=production.
router.delete('/mailbox', verifyToken, verifyRole(ROLES.SUPER_ADMIN), resetMailbox);

export default router;
