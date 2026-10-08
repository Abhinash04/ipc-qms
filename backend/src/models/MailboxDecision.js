import { mongoose } from '../config/db.js';

const DECISIONS = { ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED' };
const mailboxDecisionSchema = new mongoose.Schema(
  {
    mailboxMessageId: { type: String, required: true, unique: true, index: true },
    decision: { type: String, required: true, enum: Object.values(DECISIONS), index: true },
    queryId: { type: String, default: null, index: true },
    reason: { type: String, default: '' },
    decidedByUserId: { type: String, default: null },
    decidedByRole: { type: String, default: null },
    decidedAt: { type: String, required: true },
    from: { type: String, default: '' },
    subject: { type: String, default: '' },
    receivedAt: { type: String, default: null },
  },
  { versionKey: false },
);

const MailboxDecision =
  mongoose.models.MailboxDecision || mongoose.model('MailboxDecision', mailboxDecisionSchema);

export { MailboxDecision, DECISIONS };
