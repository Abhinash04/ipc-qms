import HTTP_STATUS from "../constants/httpStatus.js";
import { isConnected } from "../config/db.js";
import * as audit from "../services/audit/auditService.js";
import * as workflow from "../services/workflow/finalApproval.js";
import * as caseMail from "../services/email/caseMail.js";
import { toPublic as publicOutbound } from "../services/email/outbox.js";
import { ACTOR_TYPES } from "../constants/roles.js";
import { isKnownAuditAction } from "../constants/auditActions.js";
import { caseScopeFor, scopeFilter } from "../services/authz/caseAccess.js";
import {
  QueryCase,
  WorkflowStep,
  Review,
  ResponseVersion,
  Notification,
  EmailMessage,
  EmailThread,
  AuditEvent,
  QueryCounter,
  OutboundEmail,
  OUTBOUND_TYPES,
} from "../models/index.js";

const toPlain = (doc) => {
  if (!doc) return null;
  const { _id, __v, ...rest } = doc.toObject ? doc.toObject() : doc;
  return rest;
};

const COUNTER_KEY = "counters";
const SERVER_RECORDED_EMAILS = new Set(Object.values(OUTBOUND_TYPES));
const SERVER_OWNED_STATES = new Set(["DISPATCHED", "CLOSED"]);
const MAX_ROWS = 5000;
export function buildScopedFilters(scope) {
  const byCase = scopeFilter(scope);

  const notifications = scope?.everything
    ? {}
    : {
        $or: [
          { recipientUserId: scope.userId ?? null },
          { recipientRole: scope.role ?? null },
        ],
      };

  return {
    queries: byCase,
    workflowSteps: byCase,
    reviews: byCase,
    responseVersions: byCase,
    notifications,
    emailMessages: byCase,
    emailThreads: byCase,
    auditEvents: byCase,
    outboundEmails: byCase,
  };
}
const toClientAuditEvent = (row) => ({
  auditId: row.auditId ?? String(row._id),
  event: row.action,
  actor: row.actorRole ?? null,
  at: row.timestamp,
  queryId: row.queryId ?? null,
  details: row.details ?? null,
});

const fromClientAuditEvent = (event) => ({
  auditId: event.auditId ?? null,
  action: event.event,
  timestamp: event.at || new Date().toISOString(),
  queryId: event.queryId ?? null,
  actorType: ACTOR_TYPES.HUMAN,
  actorRole: event.actor ?? null,
  details: event.details ?? null,
});

async function alreadyRecorded(auditEvent) {
  if (!auditEvent.auditId) return false;
  const existing = await AuditEvent.exists({
    auditId: auditEvent.auditId,
    queryId: auditEvent.queryId || null,
    action: auditEvent.event,
  });

  return Boolean(existing);
}
function requireDb(next) {
  if (isConnected()) return true;
  next(
    Object.assign(new Error("Query storage is unavailable"), {
      status: HTTP_STATUS.SERVICE_UNAVAILABLE,
    }),
  );
  return false;
}

async function loadAllQueries(req, res, next) {
  if (!requireDb(next)) return;

  try {
    const scope = await caseScopeFor(req);
    const f = buildScopedFilters(scope);

    const [
      queries,
      workflowSteps,
      reviews,
      responseVersions,
      notifications,
      emailMessages,
      emailThreads,
      auditEvents,
      counterDoc,
      outboundEmails,
    ] = await Promise.all([
      QueryCase.find(f.queries).limit(MAX_ROWS).lean(),
      WorkflowStep.find(f.workflowSteps).limit(MAX_ROWS).lean(),
      Review.find(f.reviews).limit(MAX_ROWS).lean(),
      ResponseVersion.find(f.responseVersions).limit(MAX_ROWS).lean(),
      Notification.find(f.notifications).limit(MAX_ROWS).lean(),
      EmailMessage.find(f.emailMessages).limit(MAX_ROWS).lean(),
      EmailThread.find(f.emailThreads).limit(MAX_ROWS).lean(),
      AuditEvent.find(f.auditEvents)
        .sort({ timestamp: 1 })
        .limit(MAX_ROWS)
        .lean(),
      QueryCounter.findOne({ key: COUNTER_KEY }).lean(),
      OutboundEmail.find(f.outboundEmails).limit(MAX_ROWS).lean(),
    ]);

    const stripId = (rows) => (rows || []).map(toPlain);

    const collections = {
      queries: stripId(queries),
      workflowSteps: stripId(workflowSteps),
      reviews: stripId(reviews),
      responseVersions: stripId(responseVersions),
      notifications: stripId(notifications),
      emailMessages: stripId(emailMessages),
      emailThreads: stripId(emailThreads),
      auditEvents: (auditEvents || []).map(toClientAuditEvent),
      outboundEmails: (outboundEmails || []).map(publicOutbound),
    };

    const truncated = Object.entries(collections)
      .filter(([, rows]) => rows.length >= MAX_ROWS)
      .map(([name]) => name);

    if (truncated.length) {
      console.warn(
        `[qms] GET /queries truncated at ${MAX_ROWS} rows: ${truncated.join(", ")}`,
      );
    }

    res.status(HTTP_STATUS.OK).json({
      ...collections,
      counters: counterDoc?.value || null,
      ...(truncated.length ? { truncated } : {}),
    });
  } catch (error) {
    next(error);
  }
}

async function checkIsEmpty(req, res, next) {
  if (!requireDb(next)) return;

  try {
    const count = await QueryCase.countDocuments();
    res.status(HTTP_STATUS.OK).json({ isEmpty: count === 0 });
  } catch (error) {
    next(error);
  }
}

async function persistTransition(req, res, next) {
  if (!requireDb(next)) return;

  try {
    const body = req.body || {};
    const { query, auditEvent, notification, counters } = body;
    const upsertSteps = body.upsertSteps ?? [];
    const deleteStepIds = body.deleteStepIds ?? [];
    const addReviews = body.addReviews ?? [];
    const addVersions = body.addVersions ?? [];
    const upsertVersions = body.upsertVersions ?? [];
    const addMessages = body.addMessages ?? [];
    const addThreads = body.addThreads ?? [];
    const ops = [];
    const serverRecorded = addMessages.find(
      (msg) =>
        msg?.direction === "OUTBOUND" &&
        SERVER_RECORDED_EMAILS.has(msg?.emailType),
    );
    if (serverRecorded) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        error:
          "Acknowledgements, forwards and responses are recorded by the server when they are sent.",
        messageId: serverRecorded.messageId ?? null,
      });
    }

    if (query?.queryId) {
      const existing = await QueryCase.findOne({ queryId: query.queryId })
        .select("createdAt workflowState businessStatus")
        .lean();

      if (
        existing?.createdAt &&
        query.createdAt &&
        existing.createdAt !== query.createdAt
      ) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          error: "Query case id already belongs to a different case",
          queryId: query.queryId,
        });
      }

      const closing =
        (SERVER_OWNED_STATES.has(query.workflowState) &&
          existing?.workflowState !== query.workflowState) ||
        (query.businessStatus === "CLOSED" &&
          existing?.businessStatus !== "CLOSED");
      if (closing) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          error:
            "A case is dispatched and closed by the server once its response has been sent.",
          queryId: query.queryId,
        });
      }

      const {
        sourceMailbox,
        inquirer: submittedInquirer,
        ...clientQuery
      } = query;
      const inquirer = submittedInquirer;
      const update = { $set: clientQuery };
      if (inquirer !== undefined) update.$setOnInsert = { inquirer };

      ops.push(
        QueryCase.findOneAndUpdate({ queryId: query.queryId }, update, {
          upsert: true,
          returnDocument: "after",
        }),
      );
    }

    if (notification?.notificationId) {
      ops.push(
        Notification.findOneAndUpdate(
          { notificationId: notification.notificationId },
          { $set: notification },
          { upsert: true },
        ),
      );
    }

    for (const step of upsertSteps) {
      ops.push(
        WorkflowStep.findOneAndUpdate(
          { stepId: step.stepId },
          { $set: step },
          { upsert: true },
        ),
      );
    }

    for (const stepId of deleteStepIds) {
      ops.push(WorkflowStep.findOneAndDelete({ stepId }));
    }

    for (const review of addReviews) {
      ops.push(
        Review.findOneAndUpdate(
          { reviewId: review.reviewId },
          { $set: review },
          { upsert: true },
        ),
      );
    }

    for (const version of [...addVersions, ...upsertVersions]) {
      ops.push(
        ResponseVersion.findOneAndUpdate(
          { responseId: version.responseId },
          { $set: version },
          { upsert: true },
        ),
      );
    }

    for (const msg of addMessages) {
      ops.push(
        EmailMessage.findOneAndUpdate(
          { messageId: msg.messageId },
          { $set: msg },
          { upsert: true },
        ),
      );
    }

    for (const thread of addThreads) {
      ops.push(
        EmailThread.findOneAndUpdate(
          { threadId: thread.threadId },
          { $set: thread },
          { upsert: true },
        ),
      );
    }

    if (counters) {
      const bumps = Object.fromEntries(
        Object.entries(counters).map(([prefix, value]) => [
          `value.${prefix}`,
          value,
        ]),
      );
      ops.push(
        QueryCounter.findOneAndUpdate(
          { key: COUNTER_KEY },
          { $max: bumps },
          { upsert: true },
        ),
      );
    }

    await Promise.all(ops);

    if (auditEvent?.event && !isKnownAuditAction(auditEvent.event)) {
      console.warn(
        `[qms] refusing an audit event with an unknown action: ${auditEvent.event}`,
      );
    } else if (auditEvent?.event && !(await alreadyRecorded(auditEvent))) {
      await audit.record({
        action: auditEvent.event,
        auditId: auditEvent.auditId || null,
        timestamp: new Date().toISOString(),
        queryId: auditEvent.queryId || null,
        actorType: ACTOR_TYPES.HUMAN,
        actorId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
        details: auditEvent.details || null,
      });
    }

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
}

async function finalApproval(req, res, next) {
  if (!requireDb(next)) return;

  try {
    const result = await workflow.grantFinalApproval({
      queryId: req.params.queryId,
      actor: { id: req.user?.id ?? null, role: req.user?.role ?? null },
      comment: req.body?.comment ?? "",
    });

    return res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    return next(error);
  }
}

async function resetQueryState(req, res, next) {
  if (!requireDb(next)) return;

  try {
    const seed = req.body || {};

    await Promise.all([
      QueryCase.deleteMany({}),
      WorkflowStep.deleteMany({}),
      Review.deleteMany({}),
      ResponseVersion.deleteMany({}),
      Notification.deleteMany({}),
      EmailMessage.deleteMany({}),
      EmailThread.deleteMany({}),
      QueryCounter.deleteOne({ key: COUNTER_KEY }),
      OutboundEmail.deleteMany({}),
      AuditEvent.deleteMany({ queryId: { $ne: null } }),
    ]);

    await Promise.all([
      seed.queries?.length ? QueryCase.insertMany(seed.queries) : null,
      seed.workflowSteps?.length
        ? WorkflowStep.insertMany(seed.workflowSteps)
        : null,
      seed.reviews?.length ? Review.insertMany(seed.reviews) : null,
      seed.responseVersions?.length
        ? ResponseVersion.insertMany(seed.responseVersions)
        : null,
      seed.notifications?.length
        ? Notification.insertMany(seed.notifications)
        : null,
      seed.emailMessages?.length
        ? EmailMessage.insertMany(seed.emailMessages)
        : null,
      seed.emailThreads?.length
        ? EmailThread.insertMany(seed.emailThreads)
        : null,
      seed.counters
        ? QueryCounter.create({ key: COUNTER_KEY, value: seed.counters })
        : null,
      seed.auditEvents?.length
        ? AuditEvent.insertMany(seed.auditEvents.map(fromClientAuditEvent))
        : null,
    ]);

    await audit.record({
      action: "QUERY_STATE_RESET",
      actorType: ACTOR_TYPES.HUMAN,
      actorId: req.user?.id ?? null,
      actorRole: req.user?.role ?? null,
      details: { seededQueries: seed.queries?.length || 0 },
    });

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
}

async function resolveOutbound(req, res, next) {
  if (!requireDb(next)) return;

  try {
    const { emailType, outcome } = req.body;
    const result = await caseMail.resolve({
      queryId: req.params.queryId,
      emailType,
      outcome,
      actor: { id: req.user?.id ?? null, role: req.user?.role ?? null },
    });
    return res
      .status(HTTP_STATUS.OK)
      .json({ queryId: req.params.queryId, emailType, ...result });
  } catch (error) {
    return next(error);
  }
}

export {
  loadAllQueries,
  checkIsEmpty,
  persistTransition,
  resetQueryState,
  finalApproval,
  resolveOutbound,
};
