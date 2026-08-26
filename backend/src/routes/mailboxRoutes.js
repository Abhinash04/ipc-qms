import express from 'express';
import {
  listMessages,
  receiveMessage,
  markIngested,
  deleteMessage,
  resetMailbox,
} from '../controllers/mailboxController.js';

const router = express.Router();

router.get('/mailbox/messages', listMessages);
router.post('/mailbox/receive', receiveMessage);
router.post('/mailbox/messages/:messageId/ingested', markIngested);
router.delete('/mailbox/messages/:messageId', deleteMessage);
router.delete('/mailbox', resetMailbox);

export default router;
