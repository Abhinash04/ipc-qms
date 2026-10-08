import { mongoose } from '../config/db.js';

const OUTBOUND_STATUS = {
  SENDING: 'SENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  UNCERTAIN: 'UNCERTAIN',
};

const OUTBOUND_TYPES = {
  ACKNOWLEDGEMENT: 'ACKNOWLEDGEMENT',
  FORWARD: 'FORWARD',
  OUTGOING_RESPONSE: 'OUTGOING_RESPONSE',
};

const historySchema = new mongoose.Schema(
  {
    at: { type: String, required: true },
    event: { type: String, required: true },
    detail: { type: String, default: null },
  },
  { _id: false },
);

const outboundEmailSchema = new mongoose.Schema(
  {
    dispatchKey: { type: String, required: true, unique: true },
    queryId: { type: String, required: true, index: true },
    emailType: { type: String, required: true, enum: Object.values(OUTBOUND_TYPES) },
    status: { type: String, required: true, enum: Object.values(OUTBOUND_STATUS), index: true },
    recipients: { type: [String], default: [] },
    subject: { type: String, default: '' },
    transport: { type: String, default: null },
    rfcMessageId: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    claimToken: { type: String, default: null },
    leaseExpiresAt: { type: String, default: null },
    attemptedAt: { type: String, default: null },
    providerMessageId: { type: String, default: null },
    providerThreadId: { type: String, default: null },
    sentAt: { type: String, default: null },
    lastError: { type: String, default: null },
    lastOutcome: { type: String, default: null },
    resolvedBy: { type: Object, default: null },
    history: { type: [historySchema], default: [] },
    createdAt: { type: String, default: () => new Date().toISOString() },
    updatedAt: { type: String, default: () => new Date().toISOString() },
  },
  { versionKey: false },
);

outboundEmailSchema.index({ queryId: 1, emailType: 1 });

const OutboundEmail =
  mongoose.models.OutboundEmail || mongoose.model('OutboundEmail', outboundEmailSchema);

export { OutboundEmail, OUTBOUND_STATUS, OUTBOUND_TYPES };
