import { mongoose } from '../config/db.js';

const queryCaseSchema = new mongoose.Schema(
  {
    queryId: { type: String, required: true, unique: true, index: true },
    subject: { type: String, required: true },
    description: { type: String, default: '' },
    source: { type: String, default: 'Email' },
    inquirer: { type: Object, default: null },
    category: { type: String, default: null },
    priority: { type: String, default: 'NORMAL', index: true },
    businessStatus: { type: String, default: 'OPEN', index: true },
    workflowState: { type: String, required: true, index: true },
    currentAssigneeId: { type: String, default: null, index: true },
    currentWorkflowStepId: { type: String, default: null },
    attachments: { type: Array, default: [] },
    dueDate: { type: String, default: null },
    createdAt: { type: String, default: () => new Date().toISOString() },
    updatedAt: { type: String, default: () => new Date().toISOString() },

    /**
     * The email this case came from.
     *
     * `sourceMailboxMessageId` is the provider's id for the incoming message
     * and is what makes duplicate detection possible across a reload — the
     * client's guard reads it, and without it stored the guard matched every
     * case. Unique among cases that have one (see the index below): one
     * incoming email opens one case. Portal-raised cases have none.
     */
    threadId: { type: String, default: null, index: true },
    sourceEmailId: { type: String, default: null },
    sourceMailboxMessageId: { type: String, default: null },

    /**
     * The mailbox the enquiry arrived in — `{ source, address }`, e.g.
     * `{ source: 'nic-browser', address: <NIC_EMAIL> }`. Set by the server at
     * intake and never by the client. External mail on this case (the
     * acknowledgement and the final response) goes out through the same
     * mailbox. Null on portal-raised cases and on cases from before it existed,
     * which use the configured EMAIL_TRANSPORT as they always did.
     */
    sourceMailbox: { type: Object, default: null },

    /** Client-side state that must survive a reload rather than be recomputed. */
    aiSummary: { type: Object, default: null },
    assignmentDecision: { type: Object, default: null },
    pullbackHistory: { type: Array, default: [] },
  },
  { versionKey: false },
);

/**
 * One incoming email opens one case — enforced by the database.
 *
 * Two accepts of the same message that overlap (a double click, two Front
 * Officers) each mint a Case ID before either has written; the second insert
 * now fails here, and acceptMessage continues with the case that won. Partial
 * on `$type: 'string'`, not sparse: the field defaults to null, and a sparse
 * unique index would collide every portal-raised case on that null — the same
 * trap as EmailMessage.sourceMessageId.
 */
queryCaseSchema.index(
  { sourceMailboxMessageId: 1 },
  { unique: true, partialFilterExpression: { sourceMailboxMessageId: { $type: 'string' } } },
);

const QueryCase = mongoose.models.QueryCase || mongoose.model('QueryCase', queryCaseSchema);

export { QueryCase };
