import { mongoose } from '../config/db.js';

/**
 * One row per email a case owes someone — the acknowledgement to the inquirer,
 * the forward to the Officer-in-Charge, the final response — and the single
 * authority on whether it has been sent.
 *
 * `EmailMessage` records a message *after* it went out, and used to double as
 * the "already sent?" guard. A guard that is read before the send and written
 * after it cannot stop two requests that overlap: in a live test four clicks on
 * Approve, made while the first send hung on DNS, all read "not sent yet" and
 * the inquirer received the response three times. This row is written *before*
 * the send, under a unique key, so exactly one request ever holds the right to
 * send — see services/email/outbox.js for the protocol.
 *
 *   SENDING    — claimed; a send is in flight until `leaseExpiresAt`
 *   SENT       — the transport accepted it. Final; nothing sends again.
 *   FAILED     — it provably did not go out (DNS failure, refused connection,
 *                a 4xx from the provider). Safe to claim and send again.
 *   UNCERTAIN  — it may have gone out (timeout, reset connection, 5xx, a
 *                NICeMail send pressed but not confirmed). Never re-sent blindly:
 *                the provider's Sent folder is checked first, or a person
 *                confirms what happened.
 */
const OUTBOUND_STATUS = {
  SENDING: 'SENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  UNCERTAIN: 'UNCERTAIN',
};

/** The emails a case sends at most once each. */
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
    /** `${emailType}:${queryId}` — unique, and the whole of the once-only guarantee. */
    dispatchKey: { type: String, required: true, unique: true },
    queryId: { type: String, required: true, index: true },
    emailType: { type: String, required: true, enum: Object.values(OUTBOUND_TYPES) },
    status: { type: String, required: true, enum: Object.values(OUTBOUND_STATUS), index: true },

    recipients: { type: [String], default: [] },
    subject: { type: String, default: '' },
    transport: { type: String, default: null },

    /**
     * The Message-ID header of the latest attempt. Unique per attempt, and what
     * lets the Gmail transport find this exact message in the Sent folder when
     * the outcome of a send is unknown.
     */
    rfcMessageId: { type: String, default: null },

    attempts: { type: Number, default: 0 },
    /** Identifies the request holding the claim; only it may settle the row. */
    claimToken: { type: String, default: null },
    leaseExpiresAt: { type: String, default: null },
    /** When the latest attempt began — the start of the Sent-folder search window. */
    attemptedAt: { type: String, default: null },

    providerMessageId: { type: String, default: null },
    providerThreadId: { type: String, default: null },
    sentAt: { type: String, default: null },

    lastError: { type: String, default: null },
    /** How the last failure was classified: NOT_SENT or UNCERTAIN. */
    lastOutcome: { type: String, default: null },

    /** Set when a person settled an UNCERTAIN send by checking the Sent folder. */
    resolvedBy: { type: Object, default: null },

    /** The last few transitions, newest last — what the Front Office sees on the case. */
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
