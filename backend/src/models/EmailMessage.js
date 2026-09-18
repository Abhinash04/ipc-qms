import { mongoose } from '../config/db.js';

const emailMessageSchema = new mongoose.Schema(
  {
    messageId: { type: String, required: true, unique: true, index: true },
    threadId: { type: String, default: null, index: true },
    queryId: { type: String, default: null, index: true },
    direction: { type: String, default: 'INBOUND' },
    emailType: { type: String, default: 'ENQUIRY' },
    timestamp: { type: String, required: true },
    to: { type: mongoose.Schema.Types.Mixed, default: [] },
    from: { type: String, default: '' },
    cc: { type: Array, default: [] },
    bcc: { type: Array, default: [] },
    subject: { type: String, default: '' },
    body: { type: String, default: '' },
    attachments: { type: Array, default: [] },
    /**
     * The provider's id for the incoming message this record came from.
     *
     * Only inbound records carry one; acknowledgements, forwards and responses
     * legitimately have none. The uniqueness constraint is declared as a
     * partial index below rather than inline — see the note there.
     */
    sourceMessageId: { type: String, default: null },
    providerMessageId: { type: String, default: null },
    providerThreadId: { type: String, default: null },
  },
  { versionKey: false },
);

/**
 * One incoming email can open exactly one case — enforced by the database, not
 * by one browser tab's memory.
 *
 * A **partial** index, not `sparse: true`. Sparse excludes documents where the
 * field is *absent*, but `sourceMessageId` has `default: null`, so Mongoose
 * writes an explicit null on every outbound record and sparse indexes all of
 * them — every acknowledgement and forward then collided on `null`. Filtering
 * on `$type: 'string'` is the constraint actually intended: unique among
 * records that have a source message, ignored by those that do not.
 */
emailMessageSchema.index(
  { sourceMessageId: 1 },
  { unique: true, partialFilterExpression: { sourceMessageId: { $type: 'string' } } },
);

const EmailMessage =
  mongoose.models.EmailMessage || mongoose.model('EmailMessage', emailMessageSchema);

export { EmailMessage };
