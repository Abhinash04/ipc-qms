# Backend Architecture

Design rationale for the Express API. For the concrete route list, configuration reference and
degradation behaviour, see [backend/README.md](../../backend/README.md).

## Pattern

Per `.claude/backend-rules.md`, the backend follows a Controller → Service separation:

- **Routes** (`src/routes/`) map URL + method to a controller function, and declare the middleware
  chain for that route. `src/routes/index.js` is the single mount point, aggregated under
  `/api/v1` in `src/app.js`. Ten resource routers — health, auth, emails, mailbox, AI, attachments,
  NIC, audit, queries, pullback — carrying 36 route registrations in all.
- **Controllers** (`src/controllers/`) parse the request, call the appropriate service, and shape
  the HTTP response. Ten controllers, one per resource.
- **Services** (`src/services/`) hold business logic and data access, kept stateless. Six groups:
  `ai/`, `attachments/`, `audit/`, `auth/`, `email/`, `workflow/`.
- **Models** (`src/models/`) hold the Mongoose schemas — thirteen models across twelve files:
  `AuditEvent`, `EmailMessage`, `EmailThread`, `MailboxDecision`, `MailboxMessage` (which also
  exports the `Counter` backing message-id sequences), `Notification`, `QueryCase`, `QueryCounter`,
  `ResponseVersion`, `Review`, `User`, `WorkflowStep`.
- **Data** (`src/data/`) holds the IPC knowledge corpus and the retrieval layer that grounds AI
  answers. Not a data-*access* layer — it is domain content plus search.
- **Validators** (`src/validators/`) holds the Zod schemas — `mailboxSchemas.js`,
  `queryStateSchemas.js` and `pullbackSchemas.js` — applied by `middleware/validateBody.js`. The
  other routers still validate inline in their controllers. `src/utils/` is still empty.

## Middleware Chain

`src/app.js` assembles, in order:

1. `helmet()` — security headers.
2. `cors({ origin: env.CLIENT_URL, credentials: true })` — restricted to the configured frontend,
   with credentials enabled so the browser will attach the session cookie cross-origin.
3. `morgan()` — request logging (`dev` in development, `combined` in production, **disabled
   entirely when `NODE_ENV=test`**).
4. `express.json()` — body parsing.
5. `cookie-parser()` — required for the cookie-based session.
6. `/api/v1` routes.
7. `notFound` — 404 handler for unmatched routes.
8. `errorHandler` — centralized error formatter; hides stack traces outside development.

Authentication is applied **per route, never globally** — `src/routes/index.js` mounts the routers
without a blanket guard, and each route declares its own chain. This is deliberate: the three public
routes (`/health`, `/auth/login`, `/auth/logout`) are visible as exceptions in the route files
rather than buried in a bypass list.

The auth middleware:

- **`verifyToken`** — reads the JWT from `req.cookies[SESSION_COOKIE_NAME]`, verifies it, and puts
  the principal on `req.user`. 401 if absent or undecodable, with the two cases distinguished in the
  message but not in the status.
- **`verifyRole(...roles)`** — plain role gate; flattens its arguments so both varargs and an array
  work.
- **`verifyAction(action)`** — workflow-action gate via `constants/workflowActions.js`.
- **`authorizeAttachmentAccess`** — currently only re-asserts a session (see below).

Both role guards **fail closed with 401 when `req.user` is absent**, so a route mis-wired to omit
`verifyToken` breaks loudly instead of silently allowing access. Every refusal is recorded as an
`AUTHORIZATION_DENIED` audit event, fire-and-forget so auditing can never block the response.

Validation is the step after authorization in that per-route chain. `validateBody(schema)`
(`src/middleware/validateBody.js`) parses the body against a Zod schema from `src/validators/` and
**replaces `req.body` with the parsed result**, so a handler downstream can only ever see fields
the schema named — validating without replacing would leave the raw body in place for the next
careless `$set`. The schemas use `z.object`, which strips unknown keys rather than rejecting them:
a client on a newer build must not 400 a whole batch over one field the server has not learned,
but it must not be able to write that field either. A failure returns 400 with the offending field
*paths* only, never the values.

Rate limiting is still not implemented.

## Error Handling

`errorHandler` (`src/middleware/errorHandler.js`) maps a thrown error's `.status` to the HTTP
response code (defaulting to 500), and only includes `.stack` when `NODE_ENV=development`. It
spreads `err.details` onto the body, which is how `AttachmentUnavailableError` returns its
`unavailableAttachments` list alongside a 409. It logs the stack for ≥500 and a one-liner for 4xx,
and never prints request bodies or headers.

Controllers and services throw `Error` objects with a `.status` property rather than crafting
response JSON themselves.

## Status Codes

Per `backend-rules.md` §4: `200` GET/PUT success, `201` POST success, `400` validation
failure, `401` missing/invalid auth, `403` RBAC violation, `404` missing resource, `500`
unexpected failure. Centralized in `src/constants/httpStatus.js`. Added since: `409` for an
attachment that cannot be resolved, and for a Case ID whose stored `createdAt` says it already
belongs to a different case.

Two deliberate exceptions: `POST /mailbox/messages/:messageId/accept` and
`POST /queries/:queryId/final-approval` answer **200 even when a step inside them failed**, reporting
per-step outcomes in their bodies. See *Server-side intake* and *Server-side final approval* below.

## Persistence

**MongoDB via Mongoose.** (Earlier revisions of this document described PostgreSQL readiness; no
PostgreSQL client was ever installed, and Mongo was adopted instead.)

The database is **required in production**: `connectDb()` throws a `DatabaseUnavailableError` when
`NODE_ENV=production` and `DATABASE_URL` is unset or unreachable, and `server.js` awaits that call
and exits 1 rather than listening. It used to be `connectDb().finally(() => app.listen())`, which
in production meant every request was served by an instance that could store nothing while
reporting success.

Outside production it still degrades, but only in part. The mailbox falls back to an in-process map
(except the NICeMail browser mailbox, which answers 503 without MongoDB) and the audit trail to a
bounded 5,000-event buffer; both report their own state —
`mailbox.describe()` and `auditService.describe()` return the active backend and a `durable` flag,
which the admin console surfaces as "in-memory — not durable". Query Cases have **no fallback at
all**: `/queries/*` answers 503 rather than accepting a write nobody will ever read back.
Degrading loudly rather than silently is the point.

`services/audit/auditService.record()` **never throws**: a failed write is buffered and reported as
`persisted: false`, so a failure to audit can never roll back the action that already happened.

**The database, not the client, is the system of record.** Three rules hold that line:

- `connectDb()` calls `Model.syncIndexes()` on every model at startup. `createCollection()` builds a
  missing index but will not rebuild one whose *options* changed — which is how a unique
  `EmailMessage.sourceMessageId` index created without its partial filter survived a schema that
  said otherwise, and made every outbound record collide on `null`. `syncIndexes()` drops and
  recreates what has drifted, and drops what the schemas no longer declare.
- `persistTransition` merges a client's reported id counters with `$max` per key, never `$set`, so a
  stale tab cannot regress the sequence.
- `persistTransition` answers 409 rather than overwriting a stored case whose `createdAt` differs
  from the incoming one. Case writes are upserts keyed on `queryId`, so without this check a
  colliding id would replace a live case instead of raising a duplicate-key error.

## Server-side intake

`services/email/mailbox/acceptMessage.js` is the whole accept sequence in one place: mint the Case
ID, create the case, record the `ACCEPTED` decision, summarise the enquiry, acknowledge the sender,
forward to the Officer-in-Charge. The browser used to orchestrate this step by step; a closed tab
halfway through left a case nobody had been told about, and the Case ID came from a counter the
client held, so two tabs could mint the same one. The audit trail reads
`QUERY_RECEIVED → QUERY_REGISTERED → AI_SUMMARY_GENERATED → ACKNOWLEDGEMENT_SENT → QUERY_FORWARDED`,
with `EMAIL_CLASSIFIED` written last by the controller when it records the decision.

- **The Case ID is minted atomically** —
  `QueryCounter.findOneAndUpdate({ key: 'counters' }, { $inc: { 'value.QRY': 1 } }, { new, upsert })`,
  formatted `QRY-<year>-<5 digits>`. The `$inc` under a unique key is the whole guarantee: MongoDB
  serialises the update, so two concurrent accepts receive different numbers. The year is a label on
  the id, not part of the sequence.
- **Idempotent by artefact check, not by transaction.** There are no cross-document transactions on
  a standalone MongoDB, so each step looks for its own output — the decision, the inbound
  `EmailMessage`, an `ACKNOWLEDGEMENT` message, a `FORWARD` message — before acting. Retrying
  resumes rather than repeats: no second case, no second acknowledgement, no second forward.
- **The case is a real `create`, not an upsert**, so a duplicate id is rejected by the unique index
  instead of silently overwriting a live case.
- **The summary is generated once and stored on the case.** `forwardToOfficerInCharge` has always
  produced a summary for its covering note and returned it, and every caller dropped it — so the
  summary was computed, mailed to the Officer-in-Charge, audited, and never written to the case that
  paid for it, which kept `aiSummary: null` while the trail said otherwise. The accept now generates
  it before the acknowledgement, writes it to `QueryCase.aiSummary` and passes it into the forward
  through the `aiSummary` parameter that function already accepted: one model call, and a covering
  note that matches the case. Provenance rides inside the stored object as
  `status: GENERATED | FALLBACK | FAILED` — `FALLBACK` is the deterministic stand-in `generateSummary`
  returns when the model does not answer, which is an outcome to report rather than an error to hide.
  A `FAILED` summary is the only one a retry re-attempts, and it costs nothing else: the case, the id,
  the acknowledgement and the forward all still happen.
- **A failed step is reported, not thrown.** The response is
  `{ queryId, created, alreadyDecided, acknowledged, forwarded, aiSummaryStatus, errors }` at HTTP
  200 — `aiSummaryStatus` is a status rather than a boolean because "the model answered" and "we fell
  back because it timed out" are different facts. A case that exists but was not forwarded is a
  state an operator can recover from; answering 500 would hide it
  and lose the Case ID with it. A failed forward leaves the case at `FRONT_OFFICE_VERIFICATION`,
  which is exactly the state the manual **Forward to Officer-in-Charge** action operates on.
- **The case records the mailbox it came from.** The controller resolves the signed-in user's
  mailbox and passes `sourceMailbox: { source, address }` into the accept, which stores it on the
  case — never from the request body, and kept across a retry. For the NICeMail browser mailbox the
  message itself also comes from the stored record rather than the body, and an id not in that
  mailbox is a 404.
- **An unconfirmed acknowledgement is flagged, not recorded.** An acknowledgement sent through the
  NICeMail browser whose Send was pressed but whose compose form did not close in time is reported
  as `{ step: 'acknowledgement', unconfirmed: true }`. Nothing is recorded, so the next retry sends
  again — the flag is what lets the client say "check the Sent folder" instead of "retry". The
  failure is audited as `EMAIL_SEND_FAILED`, like a failed dispatch, and the retry endpoints answer
  a later unconfirmed send with **504** and the same flag.

## Server-side final approval

`services/workflow/finalApproval.js` is the other half of the same idea: the Officer-in-Charge
grants final approval and the response goes out, in one call —
`POST /queries/:queryId/final-approval`, guarded `verifyToken` +
`verifyAction(FINAL_APPROVE)` + `validateBody(finalApprovalSchema)`. It records the approval, sends
the response to the inquirer and closes the case, writing
`FINAL_APPROVAL_GRANTED → RESPONSE_DISPATCHED → QUERY_CLOSED`.

- **Why it is on the server at all.** The browser used to record the approval and then call
  `POST /emails/response` itself. That endpoint is gated on `DISPATCH`, a Front Office permission,
  and the request carried the approving officer's session — so every approval ended in a 403 with
  the case stranded at `READY_FOR_DISPATCH` and the inquirer never answered. The client had been
  widened to allow an "actorless system dispatch"; the server never was, and could not be, because
  the session is on the request. Moving the send here is what makes it legitimate rather than a
  permission the client wished it had: the officer's session authorises `FINAL_APPROVE`, which is
  theirs, and the server sends under the Front Office identity it already holds. **No role gained
  `DISPATCH`.**
- **Two orderings, both deliberate.** The approval is written *before* any mail is attempted — a
  decision a person made has to survive a mail server being down. The case becomes `CLOSED` only
  *after* a send that actually happened — a case reading `CLOSED` while the inquirer received
  nothing is the worst state this workflow can reach, because nobody goes looking for it.
- **Idempotent by artefact check**, like the accept: the stored `OUTGOING_RESPONSE` message is the
  guard, so a double click, a retry or a second officer cannot email the inquirer twice, and the
  approval row is skipped on a retry so one decision is recorded once.
- **A degraded transport is a failure, not a delivery.** `getTransport` falls back to the mock when
  a role holds no usable credential and the mock returns an ordinary success. Under
  `EMAIL_TRANSPORT=gmail` or `nic` a mock result therefore means the Front Office credential is
  missing or revoked, and the case is not closed on it. Under `EMAIL_TRANSPORT=mock` it is delivery,
  because that is what the deployment asked for.
- **A failed send is reported, not thrown.** The response is
  `{ queryId, approved, dispatched, alreadyDispatched, workflowState, recipient, errors }` at HTTP
  200; 404 for an unknown case, 409 for one not in an approvable state, 403 for a role without
  `FINAL_APPROVE`. The failure is audited as `EMAIL_SEND_FAILED` **carrying the `queryId`** — the
  transport's own failure rows carry none and so cannot be traced back to a case — and the case
  waits at `READY_FOR_DISPATCH`, which is exactly the state the Front Office **Retry sending
  response** control operates on. No dispatch-failure state was invented.
- **An unconfirmed send gets opposite advice.** When the NICeMail browser pressed Send but saw no
  confirmation in time, the response may already be with the inquirer. The error carries
  `unconfirmed: true`, the case still waits at `READY_FOR_DISPATCH`, and the `EMAIL_SEND_FAILED` row
  and the Front Office notification say to check the NICeMail Sent folder before retrying rather
  than to retry.
- **The response goes out through the case's mailbox** — `transportFor(query.sourceMailbox)`, below.

## Swap seams

Two places are deliberately polymorphic:

- **`services/email/mailbox/index.js`** — four implementations (in-memory, Mongo, Gmail inbox,
  NICeMail over IMAP) expose the same six functions; the facade selects one at call time (forced
  override → `MAILBOX_SOURCE=gmail` → `MAILBOX_SOURCE=nic` → Mongo if connected → in-memory).
  `supportsDelivery()` is false for Gmail and NICeMail because a real inbox cannot be written into.
  A fifth, `nicBrowserMailbox.js` — the NICeMail inbox read by the browser agent and stored in
  MongoDB — is not selected by `MAILBOX_SOURCE`: with `NIC_BROWSER_MAILBOX=true`, `forUser(user)`
  returns it for the Front Office user whose sign-in address is `NIC_EMAIL`, and
  `mailboxController` gives every other user the facade's choice. It is imported on demand, so
  `playwright-core` never loads on the boot path.
- **`emailService.getTransport`** — mock, Gmail or NICeMail SMTP, resolved per sender identity
  through a dynamic `import()` so `googleapis` and `nodemailer` are never evaluated on the mock path.
  External mail on a case — the acknowledgement and the final response — goes through
  `transportFor(sourceMailbox)` first: a case whose `sourceMailbox.source` is `nic-browser` sends
  through `transports/nicBrowserTransport.js` (the signed-in NICeMail tab, behind the
  `NIC_ALLOW_OUTBOUND` interlock), and every other case falls through to `getTransport`. The
  forward to the Officer-in-Charge is internal and always uses `getTransport`.

The NIC and Gmail modules additionally accept optional `client` / `createClient` /
`createTransport` / `connect` factory parameters as test-only injection seams, which is how the
suite exercises them without network access.

## Known limitations

Documented here because they are architectural, not incidental:

1. **Case-level authorization is absent.** `authorizeAttachmentAccess` checks only that a session
   exists, so any authenticated user can read any attachment by id, and `GET /queries` returns
   every case to every role. The Query Case records now exist server-side; what is missing is the
   ownership check against them. The server prints this warning at boot.
2. **Workflow-state authorization is half-enforced** — `verifyAction` covers the role half of
   `canPerform(role, action, state)`; the state half is still decided in the client store.
3. **Sessions are stateless** — logout clears the cookie, but a copied token remains valid until it
   expires.
4. **`constants/capabilities.js`** (NIC agent autonomy) is tested but wired into no route.
5. **The NICeMail browser mailbox is uncalibrated and only partly isolated.** Its UI selectors have
   never been run against the real NICeMail page; mailbox pinning covers the NICeMail Front Office's
   own requests, not the decision routes or the primary mailbox's `?recipient=`; and an unconfirmed
   send cannot be recorded as sent. The full list of open items is in
   [NIC_BROWSER_AGENT.md §17](../NIC_BROWSER_AGENT.md#known-limitations--open).

Server-side Query Cases were the blocking dependency for 1 and 2, and they have landed; what is
left is enforcing against them. See [workflow-engine.md](./workflow-engine.md) for the model.
