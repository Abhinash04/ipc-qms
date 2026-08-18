import express from 'express';
import {
  listMessages,
  receiveMessage,
  markIngested,
  resetMailbox,
} from '../controllers/mailboxController.js';

const router = express.Router();

router.get('/mailbox/messages', listMessages);
router.post('/mailbox/receive', receiveMessage);
router.post('/mailbox/messages/:messageId/ingested', markIngested);
router.delete('/mailbox', resetMailbox);

export default router;
