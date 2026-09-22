import { z } from 'zod';

/**
 * Schemas for the workflow-state sync API (`/queries/persist`, `/queries/reset`).
 *
 * These endpoints take documents authored by the client and write them straight
 * into Mongo, so the schema is the only thing standing between a caller and an
 * arbitrary `$set`. Zod's `z.object` **strips** unknown keys rather than
 * rejecting them, which is what we want here: a client running a newer build
 * must not 400 the whole batch over one field the server has not learned yet,
 * but it must not be able to write that field either.
 *
 * Field lists mirror `src/models/*.js` exactly. Types stay deliberately loose
 * (the models store timestamps as ISO strings, `to` as Mixed) — the job here is
 * to bound the *key space*, not to re-litigate the schema.
 */

const str = z.string();
const nullableStr = z.string().nullable().optional();
const optStr = z.string().optional();
const nullableObj = z.record(z.string(), z.unknown()).nullable().optional();
const arr = z.array(z.unknown()).optional();

const queryCaseSchema = z.object({
  queryId: str,
  subject: optStr,
  description: optStr,
  source: optStr,
  inquirer: nullableObj,
  category: nullableStr,
  priority: optStr,
  businessStatus: optStr,
  workflowState: optStr,
  currentAssigneeId: nullableStr,
  currentWorkflowStepId: nullableStr,
  attachments: arr,
  dueDate: nullableStr,
  createdAt: optStr,
  updatedAt: optStr,

  /**
   * Links back to the email the case came from, and the client-side state that
   * has to survive a reload.
   *
   * These were absent, and because `z.object` strips silently the effect was
   * not a rejection but quiet data loss on every persist. `threadId` going
   * missing orphaned every EmailMessage from its thread; `sourceMailboxMessageId`
   * going missing permanently disarmed the portal-claim duplicate guard, which
   * tests `!q.sourceMailboxMessageId` and therefore matched everything after a
   * refresh.
   */
  threadId: nullableStr,
  sourceEmailId: nullableStr,
  sourceMailboxMessageId: nullableStr,
  aiSummary: nullableObj,
  assignmentDecision: nullableObj,
  pullbackHistory: arr,
});

const workflowStepSchema = z.object({
  stepId: str,
  queryId: str,
  stepType: optStr,
  sequence: z.number().optional(),
  assignedUserId: nullableStr,
  status: optStr,
  createdAt: optStr,
  startedAt: nullableStr,
  completedAt: nullableStr,
});

/**
 * A review decision, as the client writes it.
 *
 * Three fields here were wrong in ways that cost real data. `stepId` was
 * required, so the Officer-in-Charge returning a draft from final approval —
 * where no review level is open — 400ed the entire delta. `comments` never
 * matched the client's `comment`, so every reviewer's words were stripped in
 * silence. `responseId` and `version` were absent, so the link between a
 * comment and the draft it judged never survived the wire.
 *
 * `.nullable()` on `reviewerId` for the same reason it is used throughout this
 * file: the client sends an explicit `null`, and `.optional()` alone only
 * tolerates the key being missing.
 */
const reviewSchema = z.object({
  reviewId: str,
  queryId: str,
  stepId: nullableStr,
  reviewerId: nullableStr,
  decision: optStr,
  // `.nullable()`, because `approveReview` sends `comment || null` — approving
  // without typing anything is the ordinary case, and `.optional()` alone
  // rejects an explicit null. That 400ed the whole delta, so a reviewer's
  // approval showed in the tab and never reached the database.
  comment: nullableStr,
  responseId: nullableStr,
  version: nullableStr,
  at: optStr,
});

const responseVersionSchema = z.object({
  responseId: str,
  queryId: str,
  version: z.union([z.string(), z.number()]).optional(),
  label: nullableStr,
  content: optStr,
  createdBy: nullableStr,
  aiMetadata: nullableObj,
  createdAt: optStr,

  // `status` carries the final-approval lock that `saveDraftVersion` enforces;
  // omitting it here stripped the lock on every write, so it survived only
  // until a reload. See the note on models/ResponseVersion.js.
  status: nullableStr,
  source: nullableStr,
  aiGenerated: z.boolean().optional(),
  approvedAt: nullableStr,
});

const notificationSchema = z.object({
  notificationId: str,
  queryId: nullableStr,
  recipientRole: nullableStr,
  recipientUserId: nullableStr,
  title: optStr,
  message: optStr,
  type: optStr,
  read: z.boolean().optional(),
  at: optStr,
});

const emailMessageSchema = z.object({
  messageId: str,
  threadId: nullableStr,
  queryId: nullableStr,
  direction: optStr,
  emailType: optStr,
  timestamp: optStr,
  to: z.unknown().optional(),
  from: optStr,
  cc: arr,
  bcc: arr,
  subject: optStr,
  body: optStr,
  attachments: arr,
  sourceMessageId: nullableStr,
  providerMessageId: nullableStr,
  providerThreadId: nullableStr,
});

const emailThreadSchema = z.object({
  threadId: str,
  queryId: nullableStr,
  createdAt: optStr,
});

/**
 * The workflow store's id counters — a map of prefix to last-issued number.
 * Stored whole (see models/QueryCounter.js), so the shape is validated here.
 */
const countersSchema = z.record(z.string(), z.number());

/**
 * An audit event as the *client* may describe it.
 *
 * `actorType`, `actorRole` and `actorId` are deliberately absent: the server
 * fills those from the session. Accepting them from the body would make the
 * audit trail self-reported, which is the one thing an audit trail may not be.
 */
const auditEventSchema = z.object({
  /**
   * The client's id for this event. Accepted, unlike the actor fields below,
   * because it identifies the record rather than asserting who caused it — and
   * because stripping it left the trail with no stable key at all once the
   * store began reading events back from the server.
   */
  auditId: nullableStr,

  event: str,
  at: optStr,
  queryId: nullableStr,

  /**
   * A string OR an object, because the client sends both.
   *
   * `models/AuditEvent.js` declares `details` as an Object, and this schema was
   * originally typed from the model. The client does not use it that way: every
   * `applyTransition` call passes a human-readable sentence — "Front Office
   * verified the query details and attachments." — while the server's own audit
   * writes pass a structured object. Typing it as an object alone rejected the
   * entire delta with a 400, on every workflow transition, which meant nothing
   * the client did was ever persisted. The union is the honest description of
   * the contract.
   */
  details: z.union([z.string(), z.record(z.string(), z.unknown())]).nullable().optional(),
});

/**
 * `.nullable()` throughout, not just `.optional()`: the store sends an explicit
 * `null` for a slot it has nothing for — see the `|| null` at
 * `frontend/src/store/useWorkflowStore.js:238` — and rejecting that would 400
 * every transition that does not happen to touch a case.
 */
export const persistTransitionSchema = z.object({
  query: queryCaseSchema.nullable().optional(),
  auditEvent: auditEventSchema.nullable().optional(),
  notification: notificationSchema.nullable().optional(),
  counters: countersSchema.nullable().optional(),
  upsertSteps: z.array(workflowStepSchema).nullable().optional(),
  deleteStepIds: z.array(z.string()).nullable().optional(),
  addReviews: z.array(reviewSchema).nullable().optional(),
  addVersions: z.array(responseVersionSchema).nullable().optional(),
  upsertVersions: z.array(responseVersionSchema).nullable().optional(),
  addMessages: z.array(emailMessageSchema).nullable().optional(),
  addThreads: z.array(emailThreadSchema).nullable().optional(),
});

/**
 * Granting final approval. The Officer-in-Charge may add a note; everything
 * else about the decision — who, when, which version — is read from the session
 * and the stored case, never from the caller.
 */
export const finalApprovalSchema = z.object({
  comment: z.string().max(2000).optional(),
});

/**
 * A person's answer to "did this email go out?", given after checking the
 * sending mailbox's Sent folder for a send whose outcome was UNCERTAIN.
 */
export const resolveOutboundSchema = z.object({
  emailType: z.enum(['ACKNOWLEDGEMENT', 'FORWARD', 'OUTGOING_RESPONSE']),
  outcome: z.enum(['SENT', 'NOT_SENT']),
});

export const resetQueryStateSchema = z.object({
  queries: z.array(queryCaseSchema).optional(),
  workflowSteps: z.array(workflowStepSchema).optional(),
  reviews: z.array(reviewSchema).optional(),
  responseVersions: z.array(responseVersionSchema).optional(),
  notifications: z.array(notificationSchema).optional(),
  emailMessages: z.array(emailMessageSchema).optional(),
  emailThreads: z.array(emailThreadSchema).optional(),
  counters: countersSchema.optional(),

  // Seeded history. Without this key `validateBody` strips it, and the restore
  // in `resetQueryState` receives nothing — a silent no-op rather than an
  // error. Same shape as a persisted event, so the same rule applies: no actor
  // fields, which a caller could otherwise use to write history in someone
  // else's name.
  auditEvents: z.array(auditEventSchema).optional(),
});
