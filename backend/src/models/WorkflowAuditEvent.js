import { mongoose } from '../config/db.js';

/**
 * One entry in a query case's workflow history.
 *
 * Deliberately separate from `AuditEvent`, which records API activity —
 * logins, mail sends, authorization denials — for the Administration console.
 * The two were briefly conflated: the client's workflow events were coerced
 * into the API audit schema, failed its `actorType` enum, and were dropped by a
 * swallowed catch, while the dashboard's activity feed read API records it had
 * no fields for. They are different concepts and now have different homes.
 *
 * The shape mirrors the client's workflow store exactly, so nothing has to be
 * translated on the way in or out.
 */
const workflowAuditEventSchema = new mongoose.Schema(
  {
    auditId: { type: String, required: true, unique: true, index: true },
    queryId: { type: String, default: null, index: true },

    /** The workflow event name, e.g. QUERY_ASSIGNED. Not an enum: an
        unrecognised event must still be recorded rather than refused. */
    event: { type: String, required: true, index: true },

    /** Display name of whoever acted, or a label like "AI Summary Assistant". */
    actor: { type: String, default: null },

    /** ISO timestamp, matching the client's `at`. */
    at: { type: String, required: true, index: true },

    details: { type: String, default: null },
  },
  { versionKey: false },
);

export const WorkflowAuditEvent = mongoose.model(
  'WorkflowAuditEvent',
  workflowAuditEventSchema,
);
