import { mongoose } from '../config/db.js';
import { ACTOR_TYPES } from '../constants/roles.js';
import { AUDIT_RESULTS } from '../constants/auditActions.js';

const auditEventSchema = new mongoose.Schema(
  {
    timestamp: { type: String, required: true, index: true },

    actorType: {
      type: String,
      required: true,
      enum: Object.values(ACTOR_TYPES),
      index: true,
    },
    actorId: { type: String, default: null, index: true },
    actorRole: { type: String, default: null },
    // The user's name at the time, and the IP address and browser the request came from.
    // Events recorded before these existed have neither.
    actorName: { type: String },
    source: { type: Object },
    // What the event changed: { field: { from, to } } (status, assignee, category, priority).
    changes: { type: Object },
    auditId: { type: String, default: null, index: true },
    action: { type: String, required: true, index: true },
    result: {
      type: String,
      required: true,
      enum: Object.values(AUDIT_RESULTS),
      default: AUDIT_RESULTS.SUCCESS,
    },
    queryId: { type: String, default: null, index: true },
    messageId: { type: String, default: null, index: true },
    threadId: { type: String, default: null },
    attachmentId: { type: String, default: null },
    error: { type: String, default: null },
    aiMetadata: { type: Object, default: null },

    details: { type: Object, default: null },

    // Tamper-evident chain (services/audit/auditChain.js). Rows written before
    // the chain existed have none of these and are reported as "legacy".
    seq: { type: Number },
    prevHash: { type: String },
    hash: { type: String },
  },
  { versionKey: false, minimize: false },
);

// One row per chain position. Legacy rows (no seq) are outside the index, and
// a second writer that races for the same seq gets a duplicate-key error and
// retries rather than forking the chain.
auditEventSchema.index(
  { seq: 1 },
  { unique: true, partialFilterExpression: { seq: { $type: 'number' } }, name: 'audit_chain_seq' },
);

// The audit trail is append-only. Every update, replace and delete path is
// refused at the model; the one sanctioned wipe (a local-only reset) goes
// through auditService.resetChain, which uses the raw collection on purpose.
const IMMUTABLE = (operation) =>
  function refuse() {
    throw new Error(`Audit events are append-only: ${operation} is not allowed`);
  };

for (const operation of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
]) {
  auditEventSchema.pre(operation, { query: true, document: false }, IMMUTABLE(operation));
}

auditEventSchema.pre('bulkWrite', IMMUTABLE('bulkWrite'));

auditEventSchema.pre('save', function refuseResave() {
  if (!this.isNew) throw new Error('Audit events are append-only: saving an existing event is not allowed');
});

auditEventSchema.pre(['deleteOne', 'updateOne'], { document: true, query: false }, function refuseDoc() {
  throw new Error('Audit events are append-only: changing a stored event is not allowed');
});

const AuditEvent = mongoose.models.AuditEvent || mongoose.model('AuditEvent', auditEventSchema);

export { AuditEvent };
