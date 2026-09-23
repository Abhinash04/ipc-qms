import HTTP_STATUS from '../constants/httpStatus.js';
import { isConnected } from '../config/db.js';
import * as audit from '../services/audit/auditService.js';
import * as workflow from '../services/workflow/finalApproval.js';
import * as caseMail from '../services/email/caseMail.js';
import { toPublic as publicOutbound } from '../services/email/outbox.js';
import { ACTOR_TYPES } from '../constants/roles.js';
import { isKnownAuditAction } from '../constants/auditActions.js';
import { caseScopeFor, scopeFilter } from '../services/authz/caseAccess.js';
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
} from '../models/index.js';

const toPlain = (doc) => {
  if (!doc) return null;
  const { _id, __v, ...rest } = doc.toObject ? doc.toObject() : doc;
  return rest;
};

const COUNTER_KEY = 'counters';

/** Outbound case emails only the server records — see persistTransition. */
const SERVER_RECORDED_EMAILS = new Set(Object.values(OUTBOUND_TYPES));

/** States only the server's dispatch may move a case into. */
const SERVER_OWNED_STATES = new Set(['DISPATCHED', 'CLOSED']);

/**
 * A ceiling on one hydration response.
 *
 * The client loads the whole workflow state in a single call, so there is no
 * pagination to fall back on — but an unbounded `find({})` is how a server runs
 * out of memory in year two. The cap is far above any realistic case load and
 * is reported to the caller when it bites, rather than silently truncating.
 */
const MAX_ROWS = 5000;

/**
 * The per-collection filters for one caller's hydration read.
 *
 * Pure, and exported, so the contract below can be asserted without a database
 * — the suite runs with DATABASE_URL blank.
 *
 * Two of these are deliberate exceptions, and both are load-bearing:
 *
 *  - `counters` is NOT here. The whole counter map rides on every response,
 *    scoped or not, because the client mints every id from it (`mintId` in
 *    frontend/src/store/useWorkflowStore.js). Hand a client a scoped or absent
 *    counter map and it falls back to a zeroed seed and re-mints ids that
 *    already exist: best case the createdAt collision guard below rejects every
 *    new case, worst case one replaces a live enquiry.
 *
 *  - Notifications scope on the RECIPIENT, as a union rather than an
 *    intersection with the visible case set. Intersecting would drop
 *    system-wide notifications, which carry no queryId at all. The cost is that
 *    a notification title can mention a case the reader cannot otherwise open;
 *    that is accepted, and preferable to silently losing the rest.
 */
export function buildScopedFilters(scope) {
  const byCase = scopeFilter(scope);

  const notifications = scope?.everything
    ? {}
    : { $or: [{ recipientUserId: scope.userId ?? null }, { recipientRole: scope.role ?? null }] };

  return {
    queries: byCase,
    workflowSteps: byCase,
    reviews: byCase,
    responseVersions: byCase,
    notifications,
    emailMessages: byCase,
    emailThreads: byCase,
    auditEvents: byCase,
    // The outbound ledger names each case's recipients and send errors: it
    // follows the case set like everything else keyed on queryId.
    outboundEmails: byCase,
  };
}

/**
 * The workflow store and the compliance trail describe the same events with
 * different field names: the client reads `{event, actor, at}` (see
 * `frontend/src/constants/pullbackRules.js` and `components/dashboard/
 * DashboardActivity.jsx`), while `models/AuditEvent.js` stores `{action,
 * actorRole, timestamp}` — `action` deliberately, because it is the name the
 * compliance record is queried by.
 *
 * Hydration previously returned the stored records unmapped, so every client
 * filter on `e.event` matched nothing and the activity feed and pullback stage
 * rules ran on an empty list. Translating here keeps one server-side source of
 * truth without asking the client to learn a second vocabulary.
 */
const toClientAuditEvent = (row) => ({
  /**
   * Always present, so the trail always has a stable key.
   *
   * Events the client originated carry their own `AUD-…`; events the server
   * wrote — intake, denials, transport failures — have none, and fall back to
   * the document id, which Mongo guarantees is unique and never changes.
   * Returning neither is what left `AuditHistoryCard` keying every row on
   * `undefined` the moment the store started hydrating the trail from here.
   */
  auditId: row.auditId ?? String(row._id),

  event: row.action,
  actor: row.actorRole ?? null,
  at: row.timestamp,
  queryId: row.queryId ?? null,
  details: row.details ?? null,
});

/**
 * The inverse, for history a caller seeds through `/queries/reset`.
 *
 * `actorType` has to be one the model's enum accepts. Writing a value outside
 * it is the original bug both branches set out to fix: the old code wrote
 * `'USER'`, validation rejected it, a swallowed `catch` hid the rejection, and
 * every workflow event vanished without a trace.
 */
const fromClientAuditEvent = (event) => ({
  auditId: event.auditId ?? null,
  action: event.event,
  timestamp: event.at || new Date().toISOString(),
  queryId: event.queryId ?? null,
  actorType: ACTOR_TYPES.HUMAN,
  actorRole: event.actor ?? null,
  details: event.details ?? null,
});

/**
 * Has this exact event already been written? A retried delta must not add a
 * second row for the same transition.
 *
 * Idea taken from Aakash's `WorkflowAuditEvent` (origin/aakash, 5539f7b), which
 * upserted on `auditId` alone. That is not safe here: the id is minted by a
 * browser's counter, so two tabs can issue the same `AUD-00007` for different
 * events, and an upsert on it would silently replace one event with the other —
 * the same overwrite the `queryId` 409 guard below exists to stop.
 *
 * So the match is the event's whole identity. A retry of the same delta carries
 * identical values and is skipped; a colliding id from another tab differs in
 * its action or timestamp and is recorded, as it must be.
 */
async function alreadyRecorded(auditEvent) {
  if (!auditEvent.auditId) return false;

  /**
   * Keyed on the client's own event id, NOT on the timestamp.
   *
   * The timestamp used to be part of this key, which worked only because the
   * caller's `at` was stored verbatim. It is now stamped server-side (see
   * persistTransition), so matching on it would never hit and a re-sent delta
   * would append a second copy of the same event.
   */
  const existing = await AuditEvent.exists({
    auditId: auditEvent.auditId,
    queryId: auditEvent.queryId || null,
    action: auditEvent.event,
  });

  return Boolean(existing);
}

/**
 * `/queries/*` writes straight to Mongo with no in-memory equivalent. Without a
 * connection Mongoose buffers the operation and then rejects on a timeout,
 * which surfaces as a 500 — a server fault for what is really an unavailable
 * dependency. Say so directly instead.
 */
function requireDb(next) {
  if (isConnected()) return true;
  next(
    Object.assign(new Error('Query storage is unavailable'), {
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
      AuditEvent.find(f.auditEvents).sort({ timestamp: 1 }).limit(MAX_ROWS).lean(),
      // NOT scoped, deliberately — see buildScopedFilters.
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
      // Whether each case email is sent, being sent, failed or uncertain — what
      // the retry controls read. The claim token never leaves the server.
      outboundEmails: (outboundEmails || []).map(publicOutbound),
    };

    const truncated = Object.entries(collections)
      .filter(([, rows]) => rows.length >= MAX_ROWS)
      .map(([name]) => name);

    if (truncated.length) {
      console.warn(`[qms] GET /queries truncated at ${MAX_ROWS} rows: ${truncated.join(', ')}`);
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
    // `?? []` rather than a destructuring default: the store sends an explicit
    // `null` for slots a transition does not touch, and a default only fires on
    // `undefined`.
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

    /**
     * The acknowledgement, the forward and the final response are recorded by
     * the server, when — and only when — each is known to have been sent
     * (services/email/caseMail.js). A client that wrote one would be claiming a
     * send nobody made, and the record is what the outbox reads as "already
     * sent", so it would also stop the real one going out.
     */
    const serverRecorded = addMessages.find(
      (msg) => msg?.direction === 'OUTBOUND' && SERVER_RECORDED_EMAILS.has(msg?.emailType),
    );
    if (serverRecorded) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        error: 'Acknowledgements, forwards and responses are recorded by the server when they are sent.',
        messageId: serverRecorded.messageId ?? null,
      });
    }

    if (query?.queryId) {
      /**
       * Refuse to overwrite a different case that happens to share this id.
       *
       * Every case write here is an upsert keyed on `queryId`, so the unique
       * index can never fire: a second case minted with the same id does not
       * collide, it *replaces* the first one and the original enquiry is gone.
       * The email path no longer mints client-side (see
       * services/email/mailbox/acceptMessage.js), but the portal still does,
       * and two tabs hydrated at the same counter mint the same number.
       *
       * `createdAt` is the witness: a genuine update to a case carries the same
       * one it was created with, a collision from another tab carries its own.
       * Answering 409 keeps the stored case and tells the client, rather than
       * accepting the write and losing an enquiry silently.
       */
      const existing = await QueryCase.findOne({ queryId: query.queryId })
        .select('createdAt workflowState businessStatus')
        .lean();

      if (existing?.createdAt && query.createdAt && existing.createdAt !== query.createdAt) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          error: 'Query case id already belongs to a different case',
          queryId: query.queryId,
        });
      }

      /**
       * A case is dispatched and closed by the server, once the outbox has
       * recorded its response as sent — never by a client write. The Dispatch
       * page's retry used to close the case here itself, after a send it had
       * made; a client that can do that can also close a case nobody answered.
       * A case already in that state may still be written (a pullback moves it
       * back out); it just cannot be moved into it.
       */
      const closing =
        (SERVER_OWNED_STATES.has(query.workflowState) && existing?.workflowState !== query.workflowState) ||
        (query.businessStatus === 'CLOSED' && existing?.businessStatus !== 'CLOSED');
      if (closing) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          error: 'A case is dispatched and closed by the server once its response has been sent.',
          queryId: query.queryId,
        });
      }

      // `sourceMailbox` is set by the server at intake and decides which mailbox
      // answers the inquirer; a client write can neither change nor clear it.
      //
      // `inquirer` is written once, when the case is created — for an email it
      // is whoever sent the enquiry, and it is where every reply goes. A stale
      // or careless client write must not be able to redirect the answer.
      const { sourceMailbox, inquirer: submittedInquirer, ...clientQuery } = query;

      /**
       * The inquirer is who the final response gets mailed to.
       *
       * `services/workflow/finalApproval.js` reads `query.inquirer.email` to
       * address the dispatch, so a client-writable inquirer is a redirect of
       * outbound government mail.
       *
       * The inquirer is whoever the enquiry arrived from: intake writes it from
       * the message's From header, and it goes in `$setOnInsert` alone —
       * written when the case is created, never after. (In `$set` as well,
       * MongoDB refuses the update — one path under two operators.)
       */
      const inquirer = submittedInquirer;
      const update = { $set: clientQuery };
      if (inquirer !== undefined) update.$setOnInsert = { inquirer };

      ops.push(
        QueryCase.findOneAndUpdate(
          { queryId: query.queryId },
          update,
          { upsert: true, returnDocument: 'after' },
        ),
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
        WorkflowStep.findOneAndUpdate({ stepId: step.stepId }, { $set: step }, { upsert: true }),
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
      // `$max` per key, not `$set` of the whole map.
      //
      // A client reports the counter it believes it holds, and that belief goes
      // stale: a second tab, a reload against an empty read, or a refused reset
      // all leave a browser thinking the sequence is lower than it is. A
      // wholesale `$set` let that stale value overwrite the server's, and the
      // next case then re-issued an id that already existed. `$max` makes the
      // counter monotonic — a lagging client simply has no effect.
      const bumps = Object.fromEntries(
        Object.entries(counters).map(([prefix, value]) => [`value.${prefix}`, value]),
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

    // Written after the batch lands, and with the actor taken from the session
    // rather than the request body — an actor a caller can name is an actor a
    // caller can impersonate. `audit.record` never throws and reports its own
    // failures, so the transition is not rolled back by a failed audit write.
    /**
     * The action name is checked against the known vocabulary, and the
     * timestamp comes from the server clock.
     *
     * Both used to be taken verbatim from the request body, so any signed-in
     * account could append rows under invented names at arbitrary dates — and
     * because auditService sorts and pages on the stored timestamp, a far-future
     * row pinned itself to the head of every administrator's first page. The
     * actor fields were always server-derived and still are, so this was
     * pollution and ordering rather than forged attribution; it is still not
     * something a compliance record should accept.
     */
    if (auditEvent?.event && !isKnownAuditAction(auditEvent.event)) {
      console.warn(`[qms] refusing an audit event with an unknown action: ${auditEvent.event}`);
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

/**
 * The Officer-in-Charge grants final approval; the server answers the inquirer.
 *
 * Reports what each half did rather than collapsing to success or failure. An
 * approval that was recorded but whose response could not be sent is a real,
 * recoverable state — the case waits at READY_FOR_DISPATCH and the Front Office
 * retry acts on it — and a 500 would hide that behind "something went wrong".
 */
async function finalApproval(req, res, next) {
  if (!requireDb(next)) return;

  try {
    const result = await workflow.grantFinalApproval({
      queryId: req.params.queryId,
      // From the session. The audit trail records who decided, and an actor a
      // caller can name is an actor a caller can impersonate.
      actor: { id: req.user?.id ?? null, role: req.user?.role ?? null },
      comment: req.body?.comment ?? '',
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
      // Case IDs restart after a reset. A ledger row left behind would say the
      // next QRY-…-00001 had already been answered, and its response would
      // never be sent.
      OutboundEmail.deleteMany({}),

      /**
       * The history of the cases being deleted goes with them — they would
       * otherwise be audit rows pointing at cases that no longer exist. From
       * Aakash's branch (5539f7b), which cleared his workflow-history
       * collection on reset.
       *
       * Scoped to rows that belong to a case. Everything with no `queryId` is
       * the compliance trail — sign-ins, authorization denials, transport
       * failures — and a reset of workflow data is not a reason to erase who
       * did what to the system. His collection held case history only, so he
       * never had that distinction to draw; here it is one collection, so it
       * has to be drawn explicitly.
       */
      AuditEvent.deleteMany({ queryId: { $ne: null } }),
    ]);

    await Promise.all([
      seed.queries?.length ? QueryCase.insertMany(seed.queries) : null,
      seed.workflowSteps?.length ? WorkflowStep.insertMany(seed.workflowSteps) : null,
      seed.reviews?.length ? Review.insertMany(seed.reviews) : null,
      seed.responseVersions?.length ? ResponseVersion.insertMany(seed.responseVersions) : null,
      seed.notifications?.length ? Notification.insertMany(seed.notifications) : null,
      seed.emailMessages?.length ? EmailMessage.insertMany(seed.emailMessages) : null,
      seed.emailThreads?.length ? EmailThread.insertMany(seed.emailThreads) : null,
      seed.counters ? QueryCounter.create({ key: COUNTER_KEY, value: seed.counters }) : null,
      // Seeded history arrives in the client's vocabulary (`event`, `at`) and
      // is stored in the compliance model's (`action`, `timestamp`) — the
      // inverse of `toClientAuditEvent` above. Also from Aakash's branch.
      seed.auditEvents?.length
        ? AuditEvent.insertMany(seed.auditEvents.map(fromClientAuditEvent))
        : null,
    ]);

    // Destroying every case is the single most consequential thing this API
    // does. It is recorded whether or not it succeeded quietly.
    await audit.record({
      action: 'QUERY_STATE_RESET',
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

/**
 * A person has checked the sending mailbox's Sent folder and records what
 * happened to an email whose send was UNCERTAIN.
 *
 * The only way out of UNCERTAIN for a transport the server cannot ask (both
 * NICeMail paths; Gmail is checked automatically before any retry). `SENT`
 * records the email as a successful send would — a final response also closes
 * the case. `NOT_SENT` turns it into an ordinary failure the retry buttons can
 * send again.
 */
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
    return res.status(HTTP_STATUS.OK).json({ queryId: req.params.queryId, emailType, ...result });
  } catch (error) {
    return next(error);
  }
}

export { loadAllQueries, checkIsEmpty, persistTransition, resetQueryState, finalApproval, resolveOutbound };
