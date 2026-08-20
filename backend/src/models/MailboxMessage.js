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
  },
  { versionKey: false },
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
