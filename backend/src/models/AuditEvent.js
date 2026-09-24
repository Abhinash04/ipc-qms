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
  },
  { versionKey: false },
);

const AuditEvent = mongoose.models.AuditEvent || mongoose.model('AuditEvent', auditEventSchema);

export { AuditEvent };
