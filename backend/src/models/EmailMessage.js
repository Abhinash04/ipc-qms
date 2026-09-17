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
    sourceMessageId: { type: String, default: null },
    providerMessageId: { type: String, default: null },
    providerThreadId: { type: String, default: null },
  },
  { versionKey: false },
);

const EmailMessage =
  mongoose.models.EmailMessage || mongoose.model('EmailMessage', emailMessageSchema);

export { EmailMessage };
