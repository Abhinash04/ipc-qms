import HTTP_STATUS from '../constants/httpStatus.js';
import {
  QueryCase,
  WorkflowStep,
  Review,
  ResponseVersion,
  Notification,
  EmailMessage,
  EmailThread,
  AuditEvent,
  Counter,
} from '../models/index.js';

const toPlain = (doc) => {
  if (!doc) return null;
  const { _id, __v, ...rest } = doc.toObject ? doc.toObject() : doc;
  return rest;
};

const COUNTER_KEY = 'counters';

async function loadAllQueries(req, res, next) {
  try {
    const [
      queries,
      workflowSteps,
      reviews,
      responseVersions,
      auditEvents,
      notifications,
      emailMessages,
      emailThreads,
      counterDoc,
    ] = await Promise.all([
      QueryCase.find({}).lean(),
      WorkflowStep.find({}).lean(),
      Review.find({}).lean(),
      ResponseVersion.find({}).lean(),
      AuditEvent.find({}).lean(),
      Notification.find({}).lean(),
      EmailMessage.find({}).lean(),
      EmailThread.find({}).lean(),
      Counter.findOne({ key: COUNTER_KEY }).lean(),
    ]);

    const stripId = (rows) => (rows || []).map(toPlain);

    res.status(HTTP_STATUS.OK).json({
      queries: stripId(queries),
      workflowSteps: stripId(workflowSteps),
      reviews: stripId(reviews),
      responseVersions: stripId(responseVersions),
      auditEvents: stripId(auditEvents),
      notifications: stripId(notifications),
      emailMessages: stripId(emailMessages),
      emailThreads: stripId(emailThreads),
      counters: counterDoc?.value || null,
    });
  } catch (error) {
    next(error);
  }
}

async function checkIsEmpty(req, res, next) {
  try {
    const count = await QueryCase.countDocuments();
    res.status(HTTP_STATUS.OK).json({ isEmpty: count === 0 });
  } catch (error) {
    next(error);
  }
}

async function persistTransition(req, res, next) {
  try {
    const {
      query,
      auditEvent,
      notification,
      counters,
      upsertSteps = [],
      deleteStepIds = [],
      addReviews = [],
      addVersions = [],
      upsertVersions = [],
      addMessages = [],
      addThreads = [],
    } = req.body || {};

    const ops = [];

    if (query?.queryId) {
      ops.push(
        QueryCase.findOneAndUpdate(
          { queryId: query.queryId },
          { $set: query },
          { upsert: true, new: true },
        ),
      );
    }

    if (auditEvent && auditEvent.event) {
      const eventRecord = {
        action: auditEvent.event,
        timestamp: auditEvent.at || new Date().toISOString(),
        queryId: auditEvent.queryId || null,
        actorType: 'USER',
        actorRole: auditEvent.actor || null,
        details: auditEvent.details || null,
      };
      ops.push(AuditEvent.create(eventRecord).catch(() => {}));
    }

    if (notification && notification.notificationId) {
      ops.push(
        Notification.findOneAndUpdate(
          { notificationId: notification.notificationId },
          { $set: notification },
          { upsert: true },
        ),
      );
    }

    for (const step of upsertSteps) {
      if (step.stepId) {
        ops.push(
          WorkflowStep.findOneAndUpdate(
            { stepId: step.stepId },
            { $set: step },
            { upsert: true },
          ),
        );
      }
    }

    for (const stepId of deleteStepIds) {
      ops.push(WorkflowStep.findOneAndDelete({ stepId }));
    }

    for (const review of addReviews) {
      if (review.reviewId) {
        ops.push(
          Review.findOneAndUpdate(
            { reviewId: review.reviewId },
            { $set: review },
            { upsert: true },
          ),
        );
      }
    }

    for (const version of [...addVersions, ...upsertVersions]) {
      if (version.responseId) {
        ops.push(
          ResponseVersion.findOneAndUpdate(
            { responseId: version.responseId },
            { $set: version },
            { upsert: true },
          ),
        );
      }
    }

    for (const msg of addMessages) {
      if (msg.messageId) {
        ops.push(
          EmailMessage.findOneAndUpdate(
            { messageId: msg.messageId },
            { $set: msg },
            { upsert: true },
          ),
        );
      }
    }

    for (const thread of addThreads) {
      if (thread.threadId) {
        ops.push(
          EmailThread.findOneAndUpdate(
            { threadId: thread.threadId },
            { $set: thread },
            { upsert: true },
          ),
        );
      }
    }

    if (counters) {
      ops.push(
        Counter.findOneAndUpdate(
          { key: COUNTER_KEY },
          { $set: { value: counters } },
          { upsert: true },
        ),
      );
    }

    await Promise.all(ops);

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
}

async function resetQueryState(req, res, next) {
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
      Counter.deleteOne({ key: COUNTER_KEY }),
    ]);

    if (seed.queries && Array.isArray(seed.queries)) {
      await Promise.all([
        seed.queries.length ? QueryCase.insertMany(seed.queries) : null,
        seed.workflowSteps?.length ? WorkflowStep.insertMany(seed.workflowSteps) : null,
        seed.reviews?.length ? Review.insertMany(seed.reviews) : null,
        seed.responseVersions?.length ? ResponseVersion.insertMany(seed.responseVersions) : null,
        seed.notifications?.length ? Notification.insertMany(seed.notifications) : null,
        seed.emailMessages?.length ? EmailMessage.insertMany(seed.emailMessages) : null,
        seed.emailThreads?.length ? EmailThread.insertMany(seed.emailThreads) : null,
        seed.counters ? Counter.create({ key: COUNTER_KEY, value: seed.counters }) : null,
      ]);
    }

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
}

export { loadAllQueries, checkIsEmpty, persistTransition, resetQueryState };
