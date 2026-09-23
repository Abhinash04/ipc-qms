import HTTP_STATUS from '../constants/httpStatus.js';
import { isConnected } from '../config/db.js';
import * as mailbox from '../services/email/mailbox/index.js';
import * as mailboxHealth from '../services/email/mailbox/health.js';
import { status as aiStatus } from '../services/ai/gemmaService.js';

function getHealth(req, res) {
  res.status(HTTP_STATUS.OK).json({
    status: 'healthy',
    service: 'qms-backend',
    timestamp: new Date().toISOString(),
    database: { connected: isConnected() },
    mailbox: { source: mailbox.describe().backend, ...mailboxHealth.snapshot() },
    ai: aiStatus(),
  });
}

export { getHealth };
