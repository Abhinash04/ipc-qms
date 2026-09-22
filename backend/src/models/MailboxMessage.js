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

    /**
     * Where the message was read from. `local` is a message deposited into the
     * mock/Mongo mailbox; `nic-browser` was read out of NICeMail by the browser
     * agent. `providerMessageId` is that provider's own id for the message, and
     * is unique so that re-reading the inbox can never store it twice.
     * `removedAt` hides a message the Front Office deleted without deleting the
     * record, so the next inbox sync cannot bring it back.
     */
    source: { type: String, default: 'local', index: true },
    providerMessageId: { type: String, default: null },
    removedAt: { type: String, default: null },

    /**
     * What a provider reader extracts beyond the common shape; empty on older
     * rows, which are never rewritten. `to` above is the mailbox a message was
     * filed under, `toAddresses` its To header. `providerUnread` is the
     * provider's own read state when the message was first read — a record,
     * not the QMS read state, which is `readAt`/`readByUserId` and never
     * touches the provider. `receivedAtSource` says whether `receivedAt` is the
     * message's own time ('message') or only when it was read ('sync').
     */
    toAddresses: { type: [String], default: [] },
    providerThreadId: { type: String, default: null },
    bodyHtml: { type: String, default: null },
    providerUnread: { type: Boolean, default: null },
    receivedAtSource: { type: String, default: null },
    readAt: { type: String, default: null },
    readByUserId: { type: String, default: null },
    // Set when the row is written. No default: a hydrated old row must not be
    // stamped with the time it was read.
    createdAt: { type: String, default: null },
  },
  { versionKey: false },
);

/** The inbox list: one mailbox, not removed, newest first. */
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
