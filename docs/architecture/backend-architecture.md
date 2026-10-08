# Backend Architecture

Design rationale for the Express API. For the concrete route list, configuration reference and
degradation behaviour, see [backend/README.md](../../backend/README.md).

## Pattern

Per `.claude/backend-rules.md`, the backend follows a Controller → Service separation:

- **Routes** (`src/routes/`) map URL + method to a controller function, and declare the middleware
  chain for that route. `src/routes/index.js` is the single mount point, aggregated under
  `/api/v1` in `src/app.js`. Ten resource routers — health, auth, emails, mailbox, AI, attachments,
  NIC, audit, queries, pullback — carrying 41 route registrations in all.
- **Controllers** (`src/controllers/`) parse the request, call the appropriate service, and shape
  the HTTP response. Ten controllers, one per resource.
- **Services** (`src/services/`) hold business logic and data access, kept stateless. Seven groups:
  `ai/`, `attachments/`, `audit/`, `auth/`, `authz/`, `email/`, `workflow/`.
- **Models** (`src/models/`) hold the Mongoose schemas — fourteen models across thirteen files:
  `AuditEvent`, `EmailMessage`, `EmailThread`, `MailboxDecision`, `MailboxMessage` (which also
  exports the `Counter` backing message-id sequences), `Notification`, `OutboundEmail`, `QueryCase`,
  `QueryCounter`, `ResponseVersion`, `Review`, `User`, `WorkflowStep`.
- **Data** (`src/data/`) holds the IPC knowledge corpus and the retrieval layer that grounds AI
  answers. Not a data-*access* layer — it is domain content plus search.
- **Validators** (`src/validators/`) holds the Zod schemas — `mailboxSchemas.js`,
  `queryStateSchemas.js` and `pullbackSchemas.js` — applied by `middleware/validateBody.js`. The
  other routers still validate inline in their controllers. `src/utils/` is still empty.

## Middleware Chain

`src/app.js` assembles, in order:

0. `app.set('trust proxy', 1)` — **only** under `NODE_ENV=production`, so `secure` cookies and
   rate-limit keys use the real client address rather than the proxy's.
1. `helmet()` — security headers.
2. `cors({ origin: env.CLIENT_URL, credentials: true })` — restricted to the configured frontend,
   with credentials enabled so the browser will attach the session cookie cross-origin.
3. `compression()`.
4. `morgan()` — request logging (`dev` in development, `combined` in production, **disabled
   entirely when `NODE_ENV=test`**).
5. `express.json({ limit: '2mb' })` — body parsing.
6. `cookie-parser()` — required for the cookie-based session.
7. Two `express-rate-limit` instances: 10 requests per 15 minutes on `/api/v1/auth/login` with
   `skipSuccessfulRequests`, and 600 per minute across `/api/v1`. Both are skipped under
   `NODE_ENV=test`, because a suite makes hundreds of requests in seconds and would trip the limiter
   rather than assert what it came to assert.
8. `/api/v1` routes.
9. `notFound` — 404 handler for unmatched routes.
10. `errorHandler` — centralized error formatter; hides stack traces outside development.

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
- **`authorizeCaseDelta`** — case-membership gate on `POST /queries/persist`, checked against state
  as stored *before* the delta (see below).
- **`authorizeAttachmentAccess`** — resolves an attachment's owning case and admits only a principal
  party to it (see below).

Both role guards **fail closed with 401 when `req.user` is absent**, so a route mis-wired to omit
`verifyToken` breaks loudly instead of silently allowing access. Every refusal is recorded as an
`AUTHORIZATION_DENIED` audit event, fire-and-forget so auditing can never block the response.

**Case scope sits on top of role**, because a role allow-list naming every role denies nothing and
every role legitimately writes through `/queries/persist`. `services/authz/caseAccess.js` answers one
question — which cases is this principal party to — and `GET /queries` is filtered by it: Front
Office, Officer-in-Charge, Admin and Super Admin see everything, an Assigned Official and a Reviewer
only the cases they are on. `authorizeCaseDelta` checks both the protected values a role may set and
membership of every case a delta touches, *including* cases reached through a stored row rather than
named — which is what stops a foreign workflow step being re-homed onto a case you are entitled to.
Membership is never read from the body, because the body writes the very fields membership is derived
from. `authorizeAttachmentAccess` resolves an attachment's owning case, through the message it
arrived on when the attachment predates the case, and an attachment with no case yet is readable by
its uploader and by the roles that see everything. All three fail closed with **503** when there is
no store: "cannot tell" must never widen to "allowed".

Validation is the step after authorization in that per-route chain. `validateBody(schema)`
(`src/middleware/validateBody.js`) parses the body against a Zod schema from `src/validators/` and
**replaces `req.body` with the parsed result**, so a handler downstream can only ever see fields
the schema named — validating without replacing would leave the raw body in place for the next
careless `$set`. The schemas use `z.object`, which strips unknown keys rather than rejecting them:
a client on a newer build must not 400 a whole batch over one field the server has not learned,
but it must not be able to write that field either. A failure returns 400 with the offending field
*paths* only, never the values.

Rate limiting is in place: `express-rate-limit` gives `/api/v1/auth/login` 10 requests per 15
minutes with `skipSuccessfulRequests` — so a working session's reloads cannot lock its owner out —
and all of `/api/v1` 600 per minute. Both are in-memory, which suits the single instance the
deployment runs, and both are disabled under `NODE_ENV=test`.

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
`QUERY_RECEIVED → QUERY_REGISTERED → CASE_ASSOCIATED → AI_SUMMARY_GENERATED → ACKNOWLEDGEMENT_SENT →
QUERY_FORWARDED`, with `EMAIL_CLASSIFIED` written last by the controller when it records the decision.
`CASE_ASSOCIATED` ties the mailbox message to the case it became and is written only by the accept
whose insert created the case, so it appears once however many accepts race.

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
- **Idempotent by two atomic writes, not by a check.** The approval itself is a
  `findOneAndUpdate` out of the approvable states into `READY_FOR_DISPATCH`, so exactly one request
  writes `FINAL_APPROVAL_GRANTED` and every other is told the decision was already taken. The send
  then goes through the dispatch ledger (below), whose unique key means the second request is
  answered `ALREADY_SENT` rather than sending. The previous design read "does an `OUTGOING_RESPONSE`
  exist?" and then sent, which is a check with a window: four Approve clicks during one
  twenty-two-second send all read "no" and all proceeded, and the inquirer received three copies.
- **A degraded transport is a failure, not a delivery.** `getTransport` falls back to the mock when
  a role holds no usable credential and the mock returns an ordinary success. Under
  `EMAIL_TRANSPORT=nic` a mock result therefore means the Front Office credential is missing or
  revoked, and the case is not closed on it. Under `EMAIL_TRANSPORT=mock` it is delivery, because
  that is what the deployment asked for.
- **A failed send is reported, not thrown.** The response is
  `{ queryId, approved, dispatched, alreadyDispatched, workflowState, recipient, errors }` at HTTP
  200; 404 for an unknown case, 409 for one not in an approvable state, 403 for a role without
  `FINAL_APPROVE`. The failure is audited as `EMAIL_SEND_FAILED` **carrying the `queryId`** — the
  transport's own failure rows carry none and so cannot be traced back to a case — and the case
  waits at `READY_FOR_DISPATCH`, which is exactly the state the Front Office **Retry sending
  response** control operates on. No dispatch-failure state was invented.
- **An unconfirmed send gets opposite advice.** When the mailbox was asked to send and never
  confirmed it, the response may already be with the inquirer. The dispatch is recorded `UNCERTAIN`,
  which **blocks** the retry; the case still waits at `READY_FOR_DISPATCH`, and the
  `EMAIL_SEND_FAILED` row and the Front Office notification say to check the Sent folder. The
  Dispatch page then offers *It was sent* / *It was not sent* in place of a retry.
- **The response goes out through the case's mailbox** — `transportFor(query.sourceMailbox)`, below.

## One email per case

`services/email/caseMail.js` sends every outbound case email — acknowledgement, forward, final
response — and `services/email/outbox.js` decides whether it may. Intake, final approval and the
three retry endpoints all come through here, so there is **one guard per email rather than one per
path**, which is what made the previous per-path checks so easy to get past.

Three properties, in the order they matter:

1. **Nothing about the email comes from the request.** Recipients, subject and body are read from
   the stored case: `inquirer.email` (set at intake from the `From` header, and `$setOnInsert` so a
   later delta cannot change it), the configured Officer-in-Charge, the `FINAL_APPROVED`
   `ResponseVersion`. `POST /emails/{acknowledgement,forward,response}` take `{ queryId }` and
   ignore a body `to`. A caller names *which case*; never who is written to.
2. **The claim is a unique insert, not a check.** `dispatchOnce` inserts an `OutboundEmail` keyed on
   `"${emailType}:${queryId}"`. The winner sends; everyone else is answered from the row —
   `ALREADY_SENT`, `IN_PROGRESS` while a 3-minute lease is live, or `UNCERTAIN` for a lease that
   expired mid-send. A `FAILED` row is re-claimable by an atomic `FAILED → SENDING` flip.
3. **A failure is classified before anything is decided about it.**
   `services/email/delivery.js` sorts errors into `NOT_SENT` — DNS, `ECONNREFUSED`,
   `EHOSTUNREACH`, TLS, any HTTP 4xx, a NICeMail failure before Send — and `UNCERTAIN` — HTTP 5xx,
   `ECONNRESET`, `ETIMEDOUT`, a client timeout, a NICeMail send pressed but unconfirmed. Only
   `NOT_SENT` is retried, and only the transient network cases get one automatic quick retry inside
   the same request. **`UNCERTAIN` is never retried automatically**, because a retry can deliver a
   second copy.

**No `UNCERTAIN` send settles itself.** `emailService.reconcileDelivery` asks the case's channel on
every uncertain send and every channel answers `UNKNOWN`: the legacy Gmail transport's Sent-folder
search — `in:sent rfc822msgid:<id>`, falling back to a recipient-and-date search compared on the exact
`Subject` and `Message-ID`, with a 60-second settle window before it would say `NOT_SENT` — was the
only implementation of `reconcile` that ever existed, and it went with Gmail. Neither NICeMail path
can be asked and the mock has nothing to say. The seam is kept, because a transport that could verify
its own Sent folder would slot straight in, but today **a person** settles it:
`POST /queries/:queryId/outbound/resolve` records `SENT` (bookkeeping runs as though it had sent; a
final response closes the case) or `NOT_SENT` (unlocks the retry), audited as
`EMAIL_DELIVERY_CONFIRMED` / `EMAIL_DELIVERY_DENIED`. Neither sends anything, and nothing escalates an
uncertain dispatch on its own.

Bookkeeping is separated from delivery and is idempotent: the `EmailMessage` ids are deterministic
(`MSG-ACK-`/`MSG-FWD-`/`MSG-RESP-` + `queryId`), so a crash between sending and recording self-heals
rather than duplicating, and a bookkeeping error never turns a sent email into a reported failure.

The client is prevented from writing any of it: `POST /queries/persist` refuses (409) a delta that
moves a case to `DISPATCHED`/`CLOSED` or that writes an outbound `ACKNOWLEDGEMENT`, `FORWARD` or
`OUTGOING_RESPONSE` `EmailMessage`. Those rows exist only where the email is actually sent.

## Surviving a provider outage

`services/email/mailbox/health.js` holds one piece of state — whether the mailbox is currently
readable — and that turns a stream of identical failures into an outage with a start and an end.
The first failure logs once and audits `SYNC_FAILED`; repeats are counted and logged at most once
every five minutes; recovery logs and audits `SYNC_RECOVERED` with the duration and the attempt
count. `GET /mailbox/messages` answers **503** `{ error, retryable: true, sync }` with
`Retry-After: 30` for a transient failure and **502** for an authentication failure, rather than a
bare 500, and the same state appears on `GET /health`.

The read path is also kept cheap enough to fail safely. For the browser mailbox a poll triggers a sync
at most once every `NIC_BROWSER_SYNC_TTL_MS` and opens at most `NIC_BROWSER_SYNC_MAX` new messages,
because every message read is a real page interaction in somebody's live mailbox and all of them queue
behind the one serialised session. The lesson came from the Gmail reader that preceded it, whose poll
was one list plus up to 25 parallel gets with no timeout — during a DNS outage, 26 separate
ten-second lookups per poll.

## Swap seams

Two places are deliberately polymorphic:

- **`services/email/mailbox/index.js`** — three implementations (in-memory, Mongo, NICeMail over
  IMAP) expose the same six functions; the facade selects one at call time (forced override →
  `MAILBOX_SOURCE=nic` → Mongo if connected → in-memory). `MAILBOX_SOURCE` accepts only `auto` and
  `nic`. `supportsDelivery()` is false for NICeMail because a real inbox cannot be written into.
  A fourth, `nicBrowserMailbox.js` — the NICeMail inbox read by the browser agent and stored in
  MongoDB — is not selected by `MAILBOX_SOURCE`: with `NIC_BROWSER_MAILBOX=true`, `forUser(user)`
  returns it for the Front Office user whose sign-in address is `NIC_EMAIL`, and
  `mailboxController` gives every other user the facade's choice. It is imported on demand, so
  nothing in it loads on the boot path — and it needs no automation package, speaking CDP over
  Node's global `WebSocket`.
- **`emailService.getTransport`** — mock or NICeMail SMTP, selected by transport NAME through a
  dynamic `import()` so `nodemailer` is never evaluated on the mock path. There is no per-role
  credential and so no per-identity resolution: NICeMail is one mailbox, not one account per role. `EMAIL_TRANSPORT` accepts
  only those two. A case's mail goes through `transportFor(sourceMailbox)` first: a case whose
  `sourceMailbox.source` is `nic-browser` sends through `transports/nicBrowserTransport.js` (the
  signed-in NICeMail tab, behind the `NIC_ALLOW_OUTBOUND` interlock), and every other case falls
  through to `getTransport`. **All three** of a case's emails follow that rule — acknowledgement,
  final response *and* the forward to the Officer-in-Charge. The forward used to stay on
  `EMAIL_TRANSPORT` regardless, because that is where the legacy Gmail transport was; once Gmail
  went, a NICeMail case forwarding through `EMAIL_TRANSPORT` would have been a second channel with
  no credential, and while the browser interlock was closed that forward escaped it entirely. The
  normative statement is in
  [backend/README.md](../../backend/README.md#which-channel-a-cases-mail-goes-out-through).

`NIC_ALLOW_INTERNAL_FORWARD=true` opens exactly one more recipient for the forward alone —
`OFFICER_IN_CHARGE_EMAIL`, re-derived server-side and never taken from a request. It is a recipient
allowance, not a second channel.

The NIC modules additionally accept optional `client` / `createClient` / `createTransport` /
`connect` factory parameters as test-only injection seams, which is how the suite exercises them
without network access.

## Known limitations

Documented here because they are architectural, not incidental:

1. **Workflow-state authorization is half-enforced** — `verifyAction` covers the role half of
   `canPerform(role, action, state)`; the state half is still decided in the client store, so a
   principal party to a case may write any field on it. The server prints this warning at boot.
2. **Sessions are stateless** — logout clears the cookie, but a copied token remains valid until it
   expires.
3. **The user directory is a source-code constant** — accounts cannot be added or deactivated
   without a redeploy, and `models/User.js`'s `active` flag is not read by the auth path.
4. **`POST /queries/reset` has no production refusal**, unlike the two mailbox fixtures, and it is
   the most destructive of the three. `verifyRole(SUPER_ADMIN)` is the whole of its protection.
5. **`constants/capabilities.js`** (NIC agent autonomy) is tested but wired into no route.
6. **The NICeMail browser mailbox is only partly isolated.** Mailbox pinning covers the NICeMail
   Front Office's own requests, not the decision routes; there is no scrolling beyond the rows a
   fresh agent tab loads; the attachment-reading selectors and `ccToggle` are still uncalibrated; and
   an unconfirmed send cannot later be recorded as sent. The full list of open items is in
   [NIC_BROWSER_AGENT.md §17](../NIC_BROWSER_AGENT.md#known-limitations--open).

Case-level authorization was the item server-side Query Cases blocked, and it has landed — reads are
scoped by `caseAccess.js`, writes by `authorizeCaseDelta`, attachments by their owning case. What is
left is the state machine in (1). See [workflow-engine.md](./workflow-engine.md) for the model.
