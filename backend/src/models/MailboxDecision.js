import { mongoose } from '../config/db.js';

/**
 * The Front Officer's accept/reject decision on one incoming message.
 *
 * Kept apart from `MailboxMessage` on purpose. When the mailbox is a live
 * NICeMail account — read over IMAP, or through the browser agent — it is a
 * read-only view: there is no row to update, and `MailboxMessage` is not even
 * populated. A decision has to survive independently of whichever store the
 * mailbox is being read from, so it is keyed by the stable provider message id
 * and nothing else.
 *
 * `MailboxMessage.ingested` is a different thing and stays as it is: it means
 * "this copy has been swept" and carries no actor. This model is the decision —
 * who decided, when, and what became of the message.
 */
const DECISIONS = { ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED' };

const mailboxDecisionSchema = new mongoose.Schema(
  {
    mailboxMessageId: { type: String, required: true, unique: true, index: true },
    decision: { type: String, required: true, enum: Object.values(DECISIONS), index: true },

    /** Set when accepted; null for a rejection, which creates no case. */
    queryId: { type: String, default: null, index: true },
    reason: { type: String, default: '' },

    decidedByUserId: { type: String, default: null },
    decidedByRole: { type: String, default: null },
    // ISO-8601 string, matching every other model in this project — see the
    // note in backend/README.md on why these are not Date.
    decidedAt: { type: String, required: true },

    /**
     * A snapshot of the message as it was when the decision was taken.
     *
     * A rejected message sits in somebody's real mailbox, where its owner can
     * read, move, archive or delete it at any time. Without this the audit
     * question "what was rejected, and from whom?" would have no answer a month
     * later.
     */
    from: { type: String, default: '' },
    subject: { type: String, default: '' },
    receivedAt: { type: String, default: null },
  },
  { versionKey: false },
);

const MailboxDecision =
  mongoose.models.MailboxDecision || mongoose.model('MailboxDecision', mailboxDecisionSchema);

export { MailboxDecision, DECISIONS };
