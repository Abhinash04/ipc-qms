import { mongoose } from '../config/db.js';
import { ACTOR_TYPES } from '../constants/roles.js';
import { AUDIT_RESULTS } from '../constants/auditActions.js';

/**
 * One immutable record of one significant action.
 *
 * `action` is deliberately NOT an enum: an unrecognised action name must
 * still be recorded. Refusing to persist an event because a constant was
 * missed is precisely the failure mode an audit trail exists to prevent.
 */
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

    /**
     * The client's own id for an event it originated (`AUD-00007`).
     *
     * Optional, because events the server writes on its own — intake, denials,
     * transport failures — have no client to have named them, and those read
     * back keyed by `_id` instead. Not unique: the counter it comes from lives
     * in a browser, so two tabs can mint the same one, and rejecting the second
     * would lose an audit record to protect a display detail.
     */
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

    /**
     * Provenance for anything a model produced: aiGenerated, model,
     * modelVersion, promptVersion, generatedAt, approvedBy, approvedAt,
     * editedBy, finalContent. Free-form because the fields differ per
     * generation type and must not be lost to a schema mismatch.
     */
    aiMetadata: { type: Object, default: null },

    details: { type: Object, default: null },
  },
  { versionKey: false },
);

const AuditEvent = mongoose.models.AuditEvent || mongoose.model('AuditEvent', auditEventSchema);

export { AuditEvent };
