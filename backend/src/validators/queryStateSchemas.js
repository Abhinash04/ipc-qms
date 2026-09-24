import { z } from 'zod';

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

const reviewSchema = z.object({
  reviewId: str,
  queryId: str,
  stepId: nullableStr,
  reviewerId: nullableStr,
  decision: optStr,
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

const countersSchema = z.record(z.string(), z.number());
const auditEventSchema = z.object({
  auditId: nullableStr,
  event: str,
  at: optStr,
  queryId: nullableStr,
  details: z.union([z.string(), z.record(z.string(), z.unknown())]).nullable().optional(),
});

export const persistTransitionSchema = z.object({
  query: queryCaseSchema.nullable().optional(),
  baseRevision: z.number().int().nonnegative().nullable().optional(),
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

export const finalApprovalSchema = z.object({
  comment: z.string().max(2000).optional(),
});

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
  auditEvents: z.array(auditEventSchema).optional(),
});
