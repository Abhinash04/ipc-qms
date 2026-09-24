import { mongoose } from '../config/db.js';

const mailboxMessageSchema = new mongoose.Schema(
  {
    mailboxMessageId: { type: String, required: true, unique: true, index: true },
    to: { type: String, required: true, index: true },
    from: { type: String, required: true },
    cc: { type: [String], default: [] },
    bcc: { type: [String], default: [] },
    subject: { type: String, default: '(no subject)' },
    body: { type: String, default: '' },
    attachments: { type: Array, default: [] },
    receivedAt: { type: String, required: true },
    ingested: { type: Boolean, default: false, index: true },
    aiSummary: { type: Object, default: null },

    source: { type: String, default: 'local', index: true },
    providerMessageId: { type: String, default: null },
    removedAt: { type: String, default: null },

    /**
     * When the retention sweep stripped this message's content.
     *
     * Distinct from `removedAt` on purpose. `removedAt` means "the Front Office
     * deleted this" and is what hides it from the next sync; `purgedAt` means
     * "the body, the HTML and the attachment bytes are gone, and the rest of
     * this row exists only so the next sync cannot re-ingest the message". A
     * purge sets both, so `purgedAt != null` is the machine and
     * `removedAt != null && purgedAt == null` is a person — a distinction that
     * would be lost if the sweep reused `removedAt` alone.
     */
    purgedAt: { type: String, default: null },

    toAddresses: { type: [String], default: [] },
    providerThreadId: { type: String, default: null },
    bodyHtml: { type: String, default: null },
    providerUnread: { type: Boolean, default: null },
    receivedAtSource: { type: String, default: null },
    readAt: { type: String, default: null },
    readByUserId: { type: String, default: null },
    createdAt: { type: String, default: null },
  },
  { versionKey: false },
);

mailboxMessageSchema.index({ to: 1, source: 1, removedAt: 1, receivedAt: -1, mailboxMessageId: -1 });

mailboxMessageSchema.index(
  { providerMessageId: 1 },
  { unique: true, partialFilterExpression: { providerMessageId: { $type: 'string' } } },
);

const counterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Number, default: 0 },
  },
  { versionKey: false },
);

const MailboxMessage =
  mongoose.models.MailboxMessage || mongoose.model('MailboxMessage', mailboxMessageSchema);
const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

export { MailboxMessage, Counter };
