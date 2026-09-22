import HTTP_STATUS from '../constants/httpStatus.js';
import { isConnected } from '../config/db.js';
import * as mailbox from '../services/email/mailbox/index.js';
import * as mailboxHealth from '../services/email/mailbox/health.js';
import { status as aiStatus } from '../services/ai/gemmaService.js';

/**
 * What the server depends on, and whether it is answering.
 *
 * The dependencies fail quietly by design — the mailbox poll keeps retrying,
 * the AI falls back to deterministic text — so "still healthy" has to be able
 * to say *what* has been failing. Reads state already held in memory: no calls
 * are made to answer this.
 */
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
