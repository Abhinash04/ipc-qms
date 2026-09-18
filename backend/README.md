# QMS Backend

Node.js + Express 5 API for the Query Management System. **JavaScript only, ES Modules
throughout** (`"type": "module"`) — no TypeScript, no CommonJS.

## What is implemented

36 route registrations across ten resource routers: health, auth, emails, mailbox, AI, attachments,
NIC, audit, queries and pullback. Session authentication (JWT in an httpOnly cookie) with role-based
route guards and Zod request validation. MongoDB persistence for Query Cases, the workflow record,
the mailbox and the audit trail. Three email transports — mock, Gmail OAuth and NICeMail SMTP — plus,
with `NIC_BROWSER_MAILBOX=true`, a second Front Office mailbox in NICeMail, read and answered through
an operator-signed-in Chrome session (see [NICeMail](#2-browser-agent-over-cdp--the-web-session)). A
real LLM integration (Pravah Gemma) grounded in an indexed corpus of IPC guidance documents.
Disk-backed attachment storage with fail-closed resolution on every outbound send.

**Not implemented:** case-level authorization. Every route requires a session and most require a
role, but no route checks whether *this* user owns *this* case — any signed-in user can read any
attachment by id. The workflow-state half of `canPerform` is likewise still client-side: the server
validates the shape of a transition and who may attempt it, not whether the case was in a state that
allowed it. See [Security](#security-status-authenticated-but-not-yet-case-scoped).

## Setup

```bash
npm install
cp .env.example .env
```

Then set at minimum `JWT_SECRET` (≥32 characters) and `QMS_SEED_PASSWORD` — **the server refuses to
start without them.** Generate a secret with `openssl rand -base64 48`.

`npm install` after every pull that changes `package.json`. The app imports `compression`,
`mongoose`, `zod` and `express-rate-limit` at module load, so a stale `node_modules` fails at
startup with `ERR_MODULE_NOT_FOUND` rather than degrading. Use `npm ci` on a deployment host.

## Development

```bash
npm run dev      # nodemon, auto-restart
npm start        # plain node
npm test         # vitest, 44 test files / 589 tests
npm run lint     # eslint
```

Operational scripts:

| Script | Purpose |
|---|---|
| `npm run db:reset` | Clear the workflow state from MongoDB, keeping `users`. See [Resetting the workflow state](#resetting-the-workflow-state). |
| `npm run ingest:ipc` | Rebuild `src/data/ipcKnowledge.json` from `docs/markdown/`. See [AI grounding](#ai-grounding-layer). |
| `npm run gmail:preflight` | Per-identity Gmail OAuth check — verifies scopes and detects a disabled Gmail API. |
| `npm run nic:preflight` | Read-only NICeMail IMAP/SMTP reachability + auth probe. Never marks mail read. |
| `npm run nic:verify` | Live three-level NICeMail verification (read, send, receipt). Sends exactly one message, only to `NIC_TEST_RECIPIENT`. |
| `npm run nic:browser:discover` | Read-only DOM discovery against a NICeMail Chrome tab over CDP. |

Three further live-probe scripts have **no npm alias** and must be run directly:
`node src/scripts/testGemmaLive.js`, `testRecommendationLive.js`, `testDraftLive.js`. They call the
real Gemma endpoint.

## Structure

```
src/
  app.js          Express assembly: trust proxy, helmet, cors, compression, morgan, json(2mb),
                  cookie-parser, rate limits, /api/v1, notFound, errorHandler
  server.js       Boot: config assertions -> await connectDb() -> app.listen() -> signal handlers
  config/         env, authConfig, db, nicConfig, browserConfig, identities, officialsMetadata
  constants/      roles/actor types, workflowActions, auditActions, capabilities, httpStatus, users
  controllers/    one per resource (ai, attachment, audit, auth, email, health, mailbox, nic,
                  pullback, query)
  data/           IPC knowledge base + retrieval layer (see below)
  middleware/     verifyToken, verifyRole/verifyAction, validateBody, authorizeAttachmentAccess,
                  errorHandler, notFound
  models/         Mongoose schemas — AuditEvent, EmailMessage, EmailThread, MailboxMessage(+Counter),
                  Notification, QueryCase, QueryCounter, ResponseVersion, Review, User, WorkflowStep
  routes/         index.js mounts ten resource routers under /api/v1
  scripts/        operational + diagnostic CLIs
  services/
    ai/           gemmaService.js — summary, recommendation, draft, question decomposition
    attachments/  policy, disk store, fail-closed resolver, error type
    audit/        auditService.js — record/list/summary, Mongo-or-buffer
    auth/         tokenService.js (stateless JWT), userDirectory.js (seeded accounts)
    email/        emailService.js + transports/, mailbox/, nic/, templates/
  test/           37 *.test.js + setup.js + helpers/
  utils/          (empty — .gitkeep only)
  validators/     Zod schemas — queryStateSchemas.js, pullbackSchemas.js
scripts/
  ingestIpcDocs.mjs   build step for src/data/ipcKnowledge.json
storage/
  attachments/        attachment bytes + .json sidecars (gitignored)
```

## API

All routes are mounted under `/api/v1`. Authentication is applied **per route**, never globally.

**Public (3):** `GET /health`, `POST /auth/login`, `POST /auth/logout` — plus `POST /auth/dev-login`,
which answers 404 unless `NODE_ENV=development`. Everything else requires a valid session cookie.

### Auth
| Method | Path | Guards |
|---|---|---|
| POST | `/auth/login` | public |
| POST | `/auth/logout` | public — must still clear a cookie whose token already expired |
| POST | `/auth/dev-login` | public, but answers 404 unless `NODE_ENV=development` — signs in a seeded account by email with **no password**; refuses the NICeMail Front Office with 403 |
| GET | `/auth/me` | `verifyToken` |

`/auth/dev-login` refuses the NICeMail Front Office because that account's inbox is a live
government mailbox and its session can make the browser agent send; the refusal is audited as
`LOGIN_FAILED` / `denied`, and the account signs in through `/auth/login`. Every other seeded account
still signs in there without a password whenever `NODE_ENV=development` — see
[What is NOT enforced yet](#what-is-not-enforced-yet).

### Emails
| Method | Path | Guards |
|---|---|---|
| GET | `/emails/config` | `verifyToken` |
| POST | `/emails/enquiry` | `verifyRole(INQUIRER, SUPER_ADMIN)` |
| POST | `/emails/acknowledgement` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| POST | `/emails/forward` | `verifyAction(FORWARD)` |
| POST | `/emails/response` | `verifyAction(DISPATCH)` — the Front Office **retry** path; the normal send happens inside `POST /queries/:queryId/final-approval` |

`/emails/acknowledgement` and `/emails/response` are the case page's and Dispatch page's retry
buttons. Both send through the mailbox the case came from, read from the **stored** case by `queryId`
(`controllers/emailController.js`, `mailboxOf`) — never from the request body, which would let a
caller choose which mailbox sends. `/emails/response` takes an optional `queryId` for this, and the
client sends it. No `queryId`, no database, no such case, or a case without `sourceMailbox`: the
default `EMAIL_TRANSPORT`. The recipient and — for a response — the subject, body and attachments
still come from the request body. A NICeMail browser send that was pressed but not confirmed
answers **504** with the Sent-folder warning and `unconfirmed: true` — the one failure from these
endpoints that must not be retried blindly.

### Mailbox
| Method | Path | Guards |
|---|---|---|
| GET | `/mailbox/messages` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| POST | `/mailbox/messages/:messageId/accept` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` + `validateBody` |
| POST | `/mailbox/messages/:messageId/decision` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` + `validateBody` |
| GET | `/mailbox/decisions` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| POST | `/mailbox/messages/:messageId/ingested` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| DELETE | `/mailbox/messages/:messageId` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| POST | `/mailbox/receive` | `verifyRole(SUPER_ADMIN)` |
| DELETE | `/mailbox` | `verifyRole(SUPER_ADMIN)` |

The two `SUPER_ADMIN` routes are destructive/injection utilities — under `MAILBOX_SOURCE=gmail` they
operate on a real account.

**Which mailbox a request acts on is decided by who is signed in** (`resolveMailbox` in
`controllers/mailboxController.js`). With `NIC_BROWSER_MAILBOX=true`, the Front Office user whose
sign-in address is `NIC_EMAIL` always gets the NICeMail browser mailbox for `GET /messages`,
`/accept`, `/ingested` and `DELETE /messages/:id`, and `?recipient=` is ignored; everyone else gets
the `MAILBOX_SOURCE` mailbox, where `?recipient=` still selects the address. The decision routes are
keyed by message id alone and belong to neither. For that user `GET /messages` also carries a `sync`
field — `{ ok, at, stored, stage, error, running }`, the outcome of the last background read of the
live inbox — and answers 200 from what is stored even when that read failed. See
[NICeMail browser mailbox](#the-second-front-office-mailbox).

**`/accept` and `/decision` are the validation gate.** An incoming message becomes a Query Case only
because a Front Officer accepted it; rejecting records the judgement and creates nothing.

#### `POST /mailbox/messages/:messageId/accept`

The whole intake sequence in one request (`services/email/mailbox/acceptMessage.js`): mint the Case
ID, create the case, record the `ACCEPTED` `MailboxDecision`, summarise the enquiry onto the case,
send the acknowledgement to the real sender, **and forward to the Officer-in-Charge**. An accepted
case therefore lands at `PENDING_ASSIGNMENT`, not `FRONT_OFFICE_VERIFICATION`, and the audit trail
reads `QUERY_RECEIVED → QUERY_REGISTERED → AI_SUMMARY_GENERATED → ACKNOWLEDGEMENT_SENT →
QUERY_FORWARDED`, then `EMAIL_CLASSIFIED` when the controller records the decision.

The body is the message as the inbox saw it — `from`, `to`, `cc`, `bcc`, `subject`, `body`,
`receivedAt`, `providerMessageId`, `providerThreadId`, `attachments` (`validators/mailboxSchemas.js`).
The server does not re-fetch the message: under `MAILBOX_SOURCE=gmail` that would be a second round
trip for data the client already holds. The exception is the NICeMail browser mailbox, whose messages
are already stored server-side: the case is built from that record, the body is ignored, and an id
not in that mailbox is **404**. What the body may **not** carry is the actor, the Case ID, the
decision or the mailbox — those are the server's to determine. The controller passes the signed-in
user's mailbox as `sourceMailbox: { source, address }`, the accept stores it on the case (and keeps
it across a retry), and the acknowledgement and final response go out through it.

The response is
`{ queryId, created, alreadyDecided, acknowledged, forwarded, aiSummaryStatus, errors }`, at **HTTP
200 even when a step failed**. A case that exists but was not forwarded is a state an operator can
recover from; a 500 would hide it and lose the Case ID with it. A failed forward leaves the case at
`FRONT_OFFICE_VERIFICATION`, which is exactly the state the manual `POST /emails/forward` path acts
on — so that path survives as the recovery route, not as a required second step. An acknowledgement
sent through the NICeMail browser whose Send was pressed but not confirmed in time is reported as
`{ step: 'acknowledgement', unconfirmed: true, error }` and is not recorded: it may already be in
the inquirer's inbox, so the client tells the Front Officer to check the NICeMail Sent folder before
retrying. Any failed acknowledgement is audited as `EMAIL_SEND_FAILED` against the case; an
unconfirmed one says it may have been sent.

**The summary is generated here, once, and stored.** `forwardToOfficerInCharge` has always produced a
summary for its covering note and returned it, and every caller dropped it — so the summary was
computed, mailed to the Officer-in-Charge, audited, and never written to the case that paid for it:
`QueryCase.aiSummary` stayed `null` while the trail said a summary had been generated. The accept now
makes it before the acknowledgement, writes it to the case, and passes it into the forward through
the `aiSummary` parameter that function already took. One model call, and a covering note that agrees
with the case.

The stored object is
`{ text, keyPoints, topics, aiGenerated, fallback, status, generatedAt, error }`, with `status` one of:

| `status` | Means |
|---|---|
| `GENERATED` | The model answered. |
| `FALLBACK` | It did not — unset URL, timeout, non-2xx — and `generateSummary`'s deterministic stand-in was used. An ordinary outcome, recorded as a success with `fallback: true` in the audit `aiMetadata`, not an error. |
| `FAILED` | The call itself threw. Nothing usable; `result: failure` and the reason are audited, and the step is named in `errors`. |

There is deliberately no `aiSummaryStatus` or `aiSummaryGeneratedAt` field on the case — the
provenance rides inside the object it describes. Pressing ✓ again re-attempts **only** a `FAILED`
summary; `GENERATED` and `FALLBACK` are left as they stand. A failed summary costs nothing else: the
case, the Case ID, the acknowledgement and the forward all still happen, and since only a usable
summary is handed to the forward, the forward falls back to its own inline generation (audited with
`trigger: 'forward'`, and not written back to the case).

Why server-side: the browser used to orchestrate this step by step. A closed tab halfway through
left a case nobody had been told about, and the Case ID came from a counter the client held, so two
tabs could mint the same one. The id is now minted with
`QueryCounter.findOneAndUpdate({ key: 'counters' }, { $inc: { 'value.QRY': 1 } }, { new, upsert })`
and formatted `QRY-<year>-<5 digits>`; MongoDB serialises the update, so two concurrent accepts
receive different numbers.

**Safe to retry.** There are no cross-document transactions on a standalone MongoDB, so instead every
step checks for its own artefact before acting — the decision, the inbound `EmailMessage`, an
`ACKNOWLEDGEMENT` message, a `FORWARD` message. Pressing ✓ again re-attempts only what did not
complete: no second case, no second acknowledgement, no second forward. The guard is the *recorded*
send, so an unconfirmed acknowledgement — never recorded — is sent again. The case is written with a
real `create`, not an upsert, so a duplicate id is rejected by the unique index rather than silently
overwriting a live case; and `EmailMessage.sourceMessageId` carries a unique **partial** index, so
one incoming email can open exactly one case.

#### `POST /mailbox/messages/:messageId/decision`

Used from the UI for rejections; an accept records its own decision inside the accept call. The body
is `{ decision: ACCEPTED|REJECTED, queryId?, reason?, message? }` and the response is
`{ decision, alreadyDecided }`.

It is **idempotent by construction**: `mailboxMessageId` carries a unique index and the write is an
`$setOnInsert` upsert, so the first decision on a message wins and a repeat returns the stored one
with `alreadyDecided: true`. A double-click, a retried request, or two Front Officers looking at the
same inbox cannot produce two cases for one email. The actor is taken from the session and rejected
from the body, and both accept and reject are audited as `EMAIL_CLASSIFIED`.

### AI
| Method | Path | Guards |
|---|---|---|
| POST | `/ai/summary` | `verifyToken` only |
| POST | `/ai/recommend` | `verifyToken` only |
| POST | `/ai/draft` | `verifyToken` only |

Any signed-in role may call these; there is no role gate.

### Attachments
| Method | Path | Guards |
|---|---|---|
| POST | `/attachments` | `verifyToken`, `authorizeAttachmentAccess`, multer (memory storage) |
| GET | `/attachments/:id/meta` | `verifyToken`, `authorizeAttachmentAccess` |
| GET | `/attachments/:id` | `verifyToken`, `authorizeAttachmentAccess` |

### NIC
| Method | Path | Guards |
|---|---|---|
| GET | `/nic/status` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| POST | `/nic/read` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| POST | `/nic/send` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |

NIC endpoints return HTTP 200 even on failure, carrying `{ ok: false, stage, error }` so the caller
can tell *where* it failed (connect / authenticate / open_mailbox / fetch / submit).

### Audit
| Method | Path | Guards |
|---|---|---|
| GET | `/audit` | `verifyRole(ADMIN, SUPER_ADMIN)` |
| GET | `/audit/summary` | `verifyRole(ADMIN, SUPER_ADMIN)` |
| GET | `/audit/query/:queryId` | `verifyRole(ADMIN, SUPER_ADMIN)` |

`GET /audit/summary` passes a caller's `from`/`to` through to its `overall` half, so it can answer
for any time window; the `today` half always overrides `from`.

### Queries — the workflow-state sync API

| Method | Path | Guards |
|---|---|---|
| GET | `/queries` | `verifyToken` |
| GET | `/queries/is-empty` | `verifyToken` |
| POST | `/queries/persist` | `verifyToken` + `validateBody(persistTransitionSchema)` |
| POST | `/queries/:queryId/final-approval` | `verifyToken` + `verifyAction(FINAL_APPROVE)` + `validateBody(finalApprovalSchema)` |
| POST | `/queries/reset` | `verifyToken` + `verifyRole(SUPER_ADMIN)` + `validateBody(resetQueryStateSchema)` |

This is a delta-sync API, not a REST resource: the client hydrates the whole workflow store from
`GET /queries` and posts one delta per committed transition. Every signed-in role uses both, which
is why neither carries a role allow-list — the guard that belongs there is per-case ownership, and
that is not yet server-side.

`POST /queries/:queryId/final-approval` is the exception in this router: it is an *operation*, not a
state mirror, and it is described under [Final approval](#final-approval) below.

Five things are enforced:

- **`/queries/reset` is SUPER_ADMIN only.** It deletes every case, workflow step, review, response
  version, notification, email record and the id counter. It was previously reachable by any
  signed-in user, including `INQUIRER`. The UI's Reset button is now rendered for `SUPER_ADMIN`
  only, and clears local state only once the server has accepted — a refused reset used to empty the
  tab anyway and leave it working against a zeroed counter while the server still held the cases.
- **Bodies are schema-validated** (`validators/queryStateSchemas.js`). Zod strips keys the models
  never declared, so a caller cannot `$set` arbitrary fields into a document. The corollary is that
  a field the schema forgets is **lost in silence**, which is how three contract bugs survived: a
  review's `comments` never matched the `comment` the client writes, so every reviewer's words were
  dropped; `Review.stepId` was required, so the Officer-in-Charge returning a draft for revision
  from final approval — where no review step is open — 400ed the whole delta and took the case
  update and the audit event with it; and `ResponseVersion.status`, the final-approval lock
  `saveDraftVersion` reads, was declared nowhere, so it was stripped on every write and an approved
  response became editable again after a reload. The schemas mirror `src/models/*.js` field for
  field for exactly this reason.
- **The audit actor comes from the session.** `actorType`, `actorRole` and `actorId` are taken from
  `req.user` and are rejected from the request body — an audit trail whose actor the caller names is
  an audit trail the caller can forge.
- **`/queries/persist` answers 409 on a Case ID collision.** Every case write is an upsert keyed on
  `queryId`, so the unique index can never fire: a second case minted with the same id does not
  collide, it *replaces* the first and the original enquiry is gone. `createdAt` is the witness — a
  genuine update carries the one the case was created with, a collision from another tab carries its
  own — so a mismatch is refused and the stored case kept. The email path no longer mints
  client-side, but the in-app **Raise Enquiry** portal path still does, and this is the guard that
  protects it.
- **Counters merge with `$max`, never `$set`.** A client reports the counter it believes it holds,
  and that belief goes stale: a second tab, a reload against an empty read, a refused reset. A
  wholesale `$set` let a stale value overwrite the server's, and the next case then re-issued an id
  that already existed. `$max` per key makes the sequence monotonic, so a lagging client has no
  effect at all. This is also why `QueryCounter.value` is `Mixed` rather than `Object` — Mongoose's
  strict mode silently strips dotted updates like `{ $max: { 'value.QRY': n } }` under a plain
  `Object` path.

`GET /queries` caps each collection at 5,000 rows and names any it truncated in a `truncated` array.
It returns audit events in the client's vocabulary (`event`, `actor`, `at`) rather than the stored
compliance shape (`action`, `actorRole`, `timestamp`); the two are translated in
`queryController.js`, which is what makes the activity feed and the pullback stage rules see
anything at all. That translation also guarantees every row a key: `auditId: row.auditId ?? String(row._id)`.
`AuditEvent.auditId` is the client's own id for an event it originated (`AUD-00007`), optional and
**not unique** — the counter behind it lives in a browser, so two tabs can mint the same value and
rejecting the second would lose an audit record to protect a display detail. Events the server writes
itself have none, and fall back to the document id.

Every route answers `503` — not `500` — when MongoDB is not connected.

### Final approval

| Method | Path | Guards |
|---|---|---|
| POST | `/queries/:queryId/final-approval` | `verifyToken` + `verifyAction(FINAL_APPROVE)` + `validateBody(finalApprovalSchema)` |

One call that does both halves (`services/workflow/finalApproval.js`): record the
Officer-in-Charge's approval, email the approved response to the inquirer, close the case. The audit
trail reads `FINAL_APPROVAL_GRANTED → RESPONSE_DISPATCHED → QUERY_CLOSED`. The body carries at most
an optional `comment` (≤2000 characters); who approved, when, and which version are read from the
session and the stored case.

**Why the server sends, and why no role gained `DISPATCH`.** The browser used to record the approval
and then call `POST /emails/response` itself. That endpoint is gated on `DISPATCH`, a Front Office
permission, and the request carried the approving officer's session — so every approval ended in a
**403**, the case stranded at `READY_FOR_DISPATCH` and the inquirer never answered. The client had
been widened to allow an "actorless system dispatch"; the server never was, and could not be,
because the session travels on the request. The officer's session now authorises `FINAL_APPROVE`,
which is theirs, and the **server** performs the send under the Front Office identity it already
holds. The permission table is unchanged.

Response:
`{ queryId, approved, dispatched, alreadyDispatched, workflowState, recipient, errors }`, at **200
even when the send failed** — an approval recorded but not delivered is a real, recoverable state
and a 500 would hide it behind "something went wrong". `404` for an unknown case, `409` for a case
not in an approvable state or with no drafted response, `403` for a role without `FINAL_APPROVE`,
`503` without MongoDB.

Ordering is the point:

- **The approval is recorded before any mail is attempted.** A decision a person made must survive a
  mail server being down.
- **The case becomes `CLOSED` only after a send that actually happened.** A case reading `CLOSED`
  while the inquirer received nothing is the worst state this workflow can reach, because nobody
  goes looking for it.
- **A failed send leaves the case at `READY_FOR_DISPATCH`** — approved, response locked, inquirer
  not yet told — with an `EMAIL_SEND_FAILED` audit row **carrying the `queryId`**. The transport's
  own failure rows carry none, so they cannot be traced back to a case. That state is exactly what
  the Front Office **Retry sending response** control acts on: it passes a real actor whose role
  holds `DISPATCH` and was always correctly gated. No dispatch-failure state was invented.
- **An unconfirmed send gets opposite advice.** When the response goes through the NICeMail browser
  and Send was pressed but the compose form did not close within `NIC_BROWSER_TIMEOUT_MS`, the
  response may already be with the inquirer. The error is
  `{ step: 'dispatch', unconfirmed: true, error }`, the case still waits at `READY_FOR_DISPATCH`, and
  the `EMAIL_SEND_FAILED` row and the Front Office notification say it **may have been sent** and to
  check the NICeMail Sent folder before retrying — not "retry from the case".
- **The response goes out through the case's mailbox**: `sourceMailbox`, stored at accept. A NICeMail
  case is answered through the NICeMail browser session, every other case through `EMAIL_TRANSPORT`.
- **Retrying is safe.** The stored `OUTGOING_RESPONSE` message is the guard, so approving twice does
  not email the inquirer twice; a retry after a failed send completes the send without recording a
  second `FINAL_APPROVAL_GRANTED`.
- **The recipient is the case's stored `inquirer.email`** — the original sender, read off the `From`
  header at intake. Never a configured address.
- **A transport that silently degrades to the mock counts as a failure**, unless `EMAIL_TRANSPORT`
  is `mock`. `getTransport` falls back to the mock when a role holds no usable credential and the
  mock returns an ordinary success; without this check a missing or revoked Front Office credential
  would close cases having sent nothing.

### Pullback

| Method | Path | Guards |
|---|---|---|
| POST | `/queries/:queryId/pullback` | `verifyToken` + `verifyAction(PULLBACK)` + `validateBody(pullbackSchema)` |

Grants come from `ROLE_ACTIONS` (ADMIN and SUPER_ADMIN), so a refusal is audited like every other
`verifyAction` denial. The handler updates `workflowState` and writes a `QUERY_PULLED_BACK` audit
event; it previously returned a success envelope without writing anything.

> The UI does not call this endpoint yet — `PullbackQueryModal` goes through the store's
> `pullBackQuery`, which reaches Mongo via `POST /queries/persist` along with the richer client-side
> record. This endpoint is the server-authoritative path to adopt as workflow enforcement moves off
> the client. Its write is an idempotent upsert on `queryId`, so calling both does not corrupt the
> case.

## Database

**MongoDB via Mongoose.** There is no PostgreSQL client in this project — earlier documentation
saying "PostgreSQL-ready" is obsolete.

**Required in production, optional in development.** `server.js` awaits `connectDb()` and exits
non-zero if it throws. `connectDb` throws when `NODE_ENV=production` and `DATABASE_URL` is unset or
unreachable; otherwise it warns and returns `false`, and the process continues in degraded mode.

The distinction matters because the degradation is uneven:

| Subsystem | With Mongo | Without |
|---|---|---|
| **Query Cases + workflow** | 8 collections | **no fallback — `/queries/*` answers 503** |
| Mailbox | `MailboxMessage` collection | in-process `Map`, cleared on restart — except the NICeMail browser mailbox, which answers 503 |
| Audit trail | `auditevents` collection | bounded 5,000-event buffer, `durable: false` |
| Attachments | disk (unaffected) | disk (unaffected) |
| Sessions | stateless JWT (unaffected) | stateless JWT (unaffected) |

Nothing degrades silently: `mailbox.describe()` and `auditService.describe()` report their backend
and durability, the admin console surfaces "in-memory — not durable", and a failed write-through
raises a toast in the UI rather than a false success.

Connection options are set explicitly — `serverSelectionTimeoutMS: 3000`, `maxPoolSize: 20`,
`minPoolSize: 2`, `socketTimeoutMS: 45000` — and `disconnected` / `reconnected` / `error` are logged,
so an outage is visible rather than showing up as unexplained slowness.

**Indexes come from the schemas.** `connectDb()` calls `Model.syncIndexes()` on every model at
startup. `createCollection()` builds an index that does not exist yet but will **not** rebuild one
whose options have changed — which is how a unique index on `EmailMessage.sourceMessageId`, created
once without its filter, outlived the schema that said otherwise and made every outbound record
collide on `null`. `syncIndexes()` drops and recreates what has drifted, and also drops indexes
these model files do not declare. That is the intended contract: `src/models/` is where indexes are
defined.

Note that `EmailMessage.sourceMessageId` is a **partial** unique index
(`partialFilterExpression: { sourceMessageId: { $type: 'string' } }`), not `sparse: true`. Sparse
excludes documents where the field is *absent*, but the field has `default: null`, so Mongoose
writes an explicit null on every acknowledgement, forward and response — and sparse indexed all of
them. The partial filter is the constraint actually intended: unique among records that came from an
incoming message, ignored by those that did not.

**Models** (`src/models/`, 13 across 12 files):

| Model | Holds |
|---|---|
| `QueryCase` | the case: subject, inquirer, priority, `workflowState`, assignee, attachments, the stored `aiSummary`, and `sourceMailbox` — the mailbox the enquiry arrived in, set by the server at accept and stripped from every `/queries/persist` write |
| `WorkflowStep` | one step per review level; compound index on `{queryId, sequence}` |
| `Review` | a reviewer's decision: `comment` (singular — the plural was never populated), plus `responseId`/`version` tying it to the draft it judged. `stepId` and `reviewerId` are nullable, because a return-for-revision from final approval has no review step open |
| `ResponseVersion` | successive drafts, with AI provenance in `aiMetadata`, `source` and `aiGenerated`; `status` is the final-approval lock `saveDraftVersion` enforces, with `approvedAt` alongside it |
| `Notification` | per-role / per-user notifications |
| `EmailMessage`, `EmailThread` | the case's email record |
| `AuditEvent` | 14 fields, indexed on timestamp/actorType/actorId/auditId/action/queryId/messageId. `action` is deliberately *not* an enum so a new action never fails to record; `auditId` is indexed but **not unique**, because the counter behind it lives in a browser |
| `MailboxMessage` + `Counter` | the ingest mailbox and the numeric `MSG-00001` sequence. Also holds the NICeMail browser mailbox's messages: `source: 'nic-browser'`, a `providerMessageId` under a unique partial index, and `removedAt`, which hides a deleted message so the next sync cannot bring it back |
| `MailboxDecision` | the Front Officer's accept/reject on one incoming message |
| `User` | seeded directory; written on connect, **not yet read for authentication** |
| `QueryCounter` | the workflow store's id counters, held as an object |

> `QueryCounter` exists because `Counter.value` is a `Number` incremented with `$inc`, while the
> workflow store keeps a whole map (`{QRY, THREAD, MSG, …}`). Writing that object into the numeric
> field raised a `CastError` that failed the entire persist — the two counters share a name but not
> a shape, and now not a collection either.
>
> `MailboxDecision` is separate from `MailboxMessage` for a different reason: under
> `MAILBOX_SOURCE=gmail` the mailbox is a live, read-only view of a real Gmail account. There is no
> row to update and `MailboxMessage` is not even populated, so the decision has to survive
> independently of whichever store the mailbox is read from. It is keyed by the stable provider
> message id and carries a `from`/`subject`/`receivedAt` snapshot, so "what did she reject, and from
> whom?" still has an answer once the mail itself has been archived.

Timestamps are stored as ISO-8601 **strings**, not `Date`. That is deliberate: ISO-8601 compares
correctly as text, so the same `from`/`to` bounds work against Mongo and against the in-memory audit
buffer without a second code path.

### Resetting the workflow state

```bash
npm run db:reset              # clear the workflow state at DATABASE_URL
npm run db:reset -- --dry-run # report what would go, change nothing
npm run db:reset -- --force   # required when NODE_ENV=production
```

`scripts/resetWorkflowState.mjs` clears `querycases`, `workflowsteps`, `reviews`,
`responseversions`, `notifications`, `emailmessages`, `emailthreads`, `mailboxmessages`,
`mailboxdecisions`, `querycounters`, `counters` and `auditevents`.

It is a **maintenance tool, not a seed: it inserts nothing.** The point is to return a development
database to the state a fresh install would have, so the next real enquiry is case `00001` rather
than continuing somebody else's sequence.

`users` is deliberately untouched — it is re-seeded from `src/constants/users.js` on every connect,
and those accounts are the staff directory the application needs, not fixtures. The script refuses
to run under `NODE_ENV=production` without `--force`, exits if `DATABASE_URL` is unset, and redacts
credentials out of the connection string before printing it.

## Email pipeline

`services/email/mailbox/index.js` is a duck-typed swap seam: four implementations
(`mockIpcMailbox`, `mongoIpcMailbox`, `gmailInboxReader`, `nicInboxReader`) expose the same six
functions (`deliver`, `list`, `markIngested`, `remove`, `reset`, `stats`), and the facade picks one
at call time — forced override, then `MAILBOX_SOURCE=gmail`, then `MAILBOX_SOURCE=nic`, then Mongo
if connected, else in-memory. `supportsDelivery()` is false for both Gmail and NICeMail, because a
real inbox cannot be written into.

A fifth store, `nicBrowserMailbox`, is not chosen by `MAILBOX_SOURCE`: `mailbox.forUser(user)`
returns it only for the NICeMail Front Office (see
[the second Front Office mailbox](#the-second-front-office-mailbox)), and it is imported on demand.

`emailService.getTransport` is the second swap: mock, Gmail or NICeMail, resolved per sender
identity via dynamic `import()` so `googleapis` and `nodemailer` are never evaluated on the mock
path. A role missing its own Gmail refresh token falls back to the mock transport rather than
borrowing another account's credentials. External mail on a case — the acknowledgement and the
final response — is resolved one step earlier by `transportFor(sourceMailbox)`: a case whose
`sourceMailbox.source` is `nic-browser` sends through `transports/nicBrowserTransport.js`, from the
NICeMail Front Office (`senderFor`), and every other case falls through to `getTransport`. The
forward to the Officer-in-Charge is internal and always uses `getTransport`.

`gmailInboxReader` is read-only — `deliver()` and `reset()` deliberately throw, and `remove()` only
trashes. It uses RFC 2183 `Content-Disposition` to tell a real attachment from an inline signature
logo.

### Intake is N:1, and gated by a person

```
many external inquirers ──> one Front Office mailbox ──> Front Officer validates
                                                              │
                                                    ┌─────────┴─────────┐
                                                  accept              reject
                                                    │                   │
                                     ONE server call:              decision only
                                     Query Case + Case ID          (no case, no email)
                                     + acknowledgement
                                     + forward to the OIC
                                     → PENDING_ASSIGNMENT
```

With `NIC_BROWSER_MAILBOX=true` there are two such Front Office mailboxes, each with its own Front
Office account, feeding the same gate. Mail is routed by the mailbox it arrived in, never by sender.

The Gmail query is `in:inbox [is:unread] to:(<front office address>)` and carries **no sender
filter**. Anyone can write in: an enquiry from a member of the public the system has never seen
reaches the Front Officer exactly like any other.

It used to filter on a single configured inquirer address, on the reasoning that an unqualified
search over a real personal inbox would turn a friend's message or a receipt into a Query Case. That
reasoning was sound while arriving mail registered itself. It no longer applies — **nothing in the
read path creates a case**. A message only appears for the Front Officer to accept or reject, and
filtering by sender would instead mean a genuine enquiry was discarded before anyone saw it, which
is the worse of the two failures.

Arrival and registration are therefore two stages, and the acknowledgement belongs to the second:
it is sent when a message is accepted, never when it merely arrives, and never for a rejected one.
An advertisement must not be thanked for its enquiry.

The forward to the Officer-in-Charge belongs to that second stage too. It used to be a separate,
explicit click on the case page, but it is not a second judgement in practice — every accepted
enquiry goes to the Officer-in-Charge, and the gap between the two clicks was a case sitting in
`FRONT_OFFICE_VERIFICATION` that nobody had been told about. See
[`POST /mailbox/messages/:messageId/accept`](#post-mailboxmessagesmessageidaccept).

**Attachments fail closed.** `resolveAttachments` verifies every referenced id, its bytes and its
SHA-256 before any outbound send; an unknown, missing or corrupt attachment throws
`AttachmentUnavailableError` (409) naming every offender. Nothing is ever partially resolved, so a
recipient cannot receive an apparently-complete message with documents silently missing.

## NICeMail: two separate mechanisms

NICeMail appears twice in this codebase. They are different things, share no code, share no
credential, and must not be conflated.

### 1. IMAP/SMTP — the mail protocols

```
QMS ──IMAP──> imap.mgovcloud.in:993 ──> NICeMail mailbox
QMS ──SMTP──> smtp.mgovcloud.in:465
```

Configured by `NIC_EMAIL`, `NIC_APP_PASSWORD` (or `NIC_APP_PASSWORD_FILE`), the host/port/TLS
variables and `NIC_MAILBOX`. Code lives in `services/email/nic/{nicImap,nicSmtp,credentials,actions}.js`.

Three surfaces use it:

| Surface | Purpose | Recipient limit |
|---|---|---|
| `EMAIL_TRANSPORT=nic`, `MAILBOX_SOURCE=nic` | the production mail path (`transports/nicTransport.js`, `mailbox/nicInboxReader.js`) | confined to `NIC_TEST_RECIPIENT` **until `NIC_ALLOW_OUTBOUND=true`** |
| `POST /api/v1/nic/{read,send}` | operator diagnostics | always `NIC_TEST_RECIPIENT` only |
| `npm run nic:verify`, `npm run nic:preflight` | verification CLIs | always `NIC_TEST_RECIPIENT` only |

The two-key interlock on outbound mail is deliberate: selecting the transport must not, on its own,
be enough to start mailing the public from a `.gov.in` address.

**The mailbox address is not hardcoded anywhere.** Moving to production is a one-variable change:
set `NIC_EMAIL=lab.ipc@gov.in` (and `NIC_TEST_RECIPIENT` to match). `contact.ecoclubs-edu@gov.in`
appears in no executable source at all — only in `.env`, `.env.example` and one usage example in a
script's docblock.

> Grepping for `lab.ipc@gov.in` returns 18 hits inside `src/data/ipcKnowledge.json`. **Those are not
> configuration.** They are IPC letterhead and FAQ text carried verbatim out of the source corpus by
> `ingest:ipc` — genuine published guidance telling readers where to send monograph proposals, which
> the retrieval layer may legitimately surface in an answer. Editing them would falsify a quoted
> document.

Credentials are never logged. imapflow's and nodemailer's loggers are both disabled explicitly
because their defaults print the `LOGIN` / `AUTH` exchange, and every NIC error string passes
through `redact()` before it leaves the module.

Under MFA, the webmail login password is rejected for IMAP/SMTP by design. An
application-specific password is required (webmail → Security → App Passwords). That is a NICeMail
policy, not something this code can work around.

### 2. Browser agent over CDP — the web session

```
Operator ──manually signs in──> NICeMail in Chrome
                                      │
                       Chrome holds the authenticated session
                                      │
                    CDP on localhost:9222 exposes controlled access
                                      │
                         QMS browser agent attaches to the tab
```

Configured by `NIC_CDP_ENDPOINT` and the `NIC_WEBMAIL_*` / `NIC_BROWSER_*` variables. Code lives in
`services/email/nic/browser/` — `attach.js` (connect, find the signed-in tab, release), `session.js`
(one serialised unit of work), `selectors.js`, `readInbox.js` and `sendMail.js`. It is reached by
`npm run nic:browser:discover` and, with `NIC_BROWSER_MAILBOX=true`, by the NICeMail mailbox and
transport [below](#the-second-front-office-mailbox).

**The agent never signs in.** It only attaches over CDP — there is no `launch` anywhere — never
navigates to a login page, never types a credential, never touches an OTP field, and does not import
the credentials module. Reads and sends run in a new tab of the operator's signed-in browser context,
opened at the URL the operator's NICeMail tab is already on, and closed afterwards; the operator's
own tab is never driven. If the work tab lands on anything that looks like a sign-in step, the work
stops with `NICeMail session expired` before a field is touched. What it clicks and types is the inbox
and the one outgoing message it was handed — To, Cc, Subject, body and attachments. Authentication
is the operator's job, by hand, and stays that way.

It is **lazily loaded**: nothing on the boot path imports it, and `playwright-core` is evaluated only
when the NICeMail mailbox is first used or a NICeMail case first sends. A missing Chrome session
cannot stop the backend starting. With `NIC_BROWSER_MAILBOX=true` it is, however, in the request
path for that mailbox: an accept, a final approval or a retry on a NICeMail case waits for its send,
queued behind any other browser work (one read or send at a time).

Operator prerequisite:

```bash
chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\qms-chrome
# (a non-default user-data-dir is required on Chrome 136+; Chrome 144+ can
#  instead enable it from chrome://inspect/#remote-debugging)
```

then sign in to NICeMail in that window and run `npm run nic:browser:discover`. Full setup runbook:
[docs/NIC_BROWSER_AGENT.md](../docs/NIC_BROWSER_AGENT.md).

> The port must be free. Another Chromium browser — Brave, Edge, a second Chrome profile — holding
> 9222 will accept the TCP connection without speaking CDP, and Chrome cannot bind the port while it
> does. `nic:browser:discover` tells those two cases apart and names the process to close.

#### The second Front Office mailbox

`NIC_BROWSER_MAILBOX=true` (the exact string) turns the NICeMail mailbox into a second Front Office
mailbox, alongside whatever `MAILBOX_SOURCE` selects:

| Variable | Default | Effect |
|---|---|---|
| `NIC_BROWSER_MAILBOX` | off | enables everything in this section |
| `NIC_EMAIL` | — | **required** with the flag, and must differ from `FRONT_OFFICE_EMAIL` (boot-blocking). The mailbox's address and its Front Office's sign-in |
| `NIC_FRONT_OFFICE_NAME` | `NICeMail Front Office` | a display name, not an address — that user's name and the From-line name on its mail; empty falls back to the default |
| `NIC_BROWSER_TEST_RECIPIENT` | `NIC_TEST_RECIPIENT`, then `NIC_EMAIL` | the only address browser sends may reach until `NIC_ALLOW_OUTBOUND=true` |
| `NIC_BROWSER_SYNC_TTL_MS` | `30000` | minimum gap between inbox syncs |
| `NIC_BROWSER_SYNC_MAX` | `20` | inbox rows inspected per sync |
| `NIC_BROWSER_TIMEOUT_MS` | `20000` | every browser wait, including how long a send waits to be confirmed |

The IMAP settings are not needed. MongoDB is: the mailbox is stored in `MailboxMessage` and answers
503 without it.

- **A second Front Office account.** `nicFrontOfficeUser()` in `constants/users.js` adds `USR-0014`,
  role `FRONT_OFFICE`, email `NIC_EMAIL`, signing in with `QMS_SEED_PASSWORD`. Dev login refuses it.
- **Routing by mailbox, not sender.** `mailbox.forUser(user)` gives that user the NICeMail store and
  everyone else the primary one; the mailbox routes cannot be pointed elsewhere with `?recipient=`.
- **Reading.** Listing starts a background sync when the last one is older than
  `NIC_BROWSER_SYNC_TTL_MS`; the sync reads the newest rows through `readInbox.js` and stores anything
  new once, keyed on the row's id (`$setOnInsert` under a unique index), never resetting a message
  already ingested or removed. Listing always answers from MongoDB. A failed sync never throws — it
  is reported in the response's `sync` field and shown on the IPC Mailbox page.
- **Answering.** The accept stores `sourceMailbox: { source: 'nic-browser', address }` on the case.
  The acknowledgement, the final response and their retries then go out through
  `nicBrowserTransport.js` — typed into the signed-in NICeMail compose form — after the
  `NIC_ALLOW_OUTBOUND` interlock (`nic/outboundGuard.js`) has approved every recipient. The forward
  to the Officer-in-Charge stays on `EMAIL_TRANSPORT`.
- **Confirmation.** A send counts as sent only when the compose form closes, watched through the
  Send button captured before it was pressed. If it has not closed within `NIC_BROWSER_TIMEOUT_MS`
  the send throws with `unconfirmed: true` — the outcome is unknown, and a blind retry could reach the
  inquirer twice — and accept and final approval report it as such rather than as a plain failure.
  There is no sent-confirmation selector; one may be added only with a text match proven by
  `npm run nic:browser:discover`.

**Not yet usable against the live mailbox.** The selectors in `nic/browser/selectors.js` have never
been run against the real NICeMail page, and the mailbox has open items — ingestion limits,
isolation that covers only the NICeMail Front Office's own requests, tombstones that live only in
MongoDB, and unconfirmed sends the QMS cannot later record. Setup, calibration, troubleshooting and
the full list: [docs/NIC_BROWSER_AGENT.md §17](../docs/NIC_BROWSER_AGENT.md#17-two-front-office-mailboxes).

## AI grounding layer

`src/data/` is a retrieval layer that grounds every AI answer in real IPC source material:

```
docs/markdown/            IPC guidance & amendment documents  (GITIGNORED)
  |  npm run ingest:ipc  -> scripts/ingestIpcDocs.mjs
src/data/ipcKnowledge.json    22 documents, 412 chunks  (COMMITTED)
  |  retrieveContext() + selectContext()
gemmaService.gatherEvidence() -> per-question evidence -> grounded prompt
```

**Source of truth.** `src/data/ipcKnowledge.json` is the committed artefact of record and is what
the application reads at runtime. The source corpus `docs/markdown/` is deliberately **gitignored
and not in the repository**: the documents are IPC publications, redistributing them here is not
ours to decide, and the application never reads them directly. Consequences, stated plainly:

- A fresh clone runs with full grounding and **no build step** — nothing has to be generated before
  the backend starts.
- `npm run ingest:ipc` cannot be re-run until you obtain the corpus separately. It is a maintainer
  step, taken when the documents change. Source: `https://iponline.ipc.gov.in/jspui/`.
- Regenerating is safe to verify: ingestion is **deterministic**. Iteration follows the literal
  `IPC_DOCS` array in `src/data/ipcDocs.manifest.js` (no `readdir`, so no filesystem-order
  dependence), chunk ids are positional, ties break on `localeCompare`, and the payload embeds no
  timestamp or hash. Re-running on an unchanged corpus reproduces the file byte for byte.

**What ingestion skips, and why it is recorded rather than silent.** `EXCLUDED_DOCS` in the manifest
carries a written reason for every exclusion, and the run prints them:

| Document | Treatment | Reason |
|---|---|---|
| `File240.md` | excluded from retrieval | Amendment List-1 to IP 2014, a superseded edition, and 32 of its 91 headings are bare page numbers with the drug name orphaned into the previous block |
| `2. Notice on Use of Authentic IP…` | excluded from retrieval | byte duplicate of the unprefixed file |
| `EWG-list.md` | partially ingested | member rosters and Commission Members stripped as personal data with no inquiry value; group names retained |

Excluded documents are **not deleted** — they stay in the corpus for historical reference. Exclusion
is a retrieval decision, not an archival one. This is why the run reports `22 documents` and
`3 skipped` against a 24-file corpus: `EWG-list.md` is counted in both.

Retrieval is lexical TF-IDF (`src/data/ipcKnowledge.js`) with glossary query expansion, a ×1.75
title/section bonus, coverage damping and a manifest priority multiplier. There are no embeddings
and no vector store anywhere in this project.

`gemmaService` never throws. An unset `GEMMA_API_URL` short-circuits before any network call, and
`askGemma` returns `null` on non-2xx, timeout or network error — every path has a deterministic
fallback, and the frontend tells the user when a draft came from the fallback rather than the model.
Draft generation enforces a one-question-one-answer contract.

Because it degrades instead of failing, a caller cannot tell a model answer from a stand-in by the
return value alone — which is why `generateSummary`'s result is stored on the case with an explicit
`status` (`GENERATED` / `FALLBACK` / `FAILED`) rather than as bare text. **On the current deployment
the Gemma endpoint does not answer within `GEMMA_TIMEOUT_MS`**, so accept-time summaries are written
as `FALLBACK`: real summaries, deterministically derived from the enquiry, and recorded as such.

## Configuration

`.env.example` is the authoritative reference and lists **every** variable the code reads, in nine
groups: core, authentication, email transport, stakeholder identities, Gmail OAuth, NICeMail
IMAP/SMTP, NICeMail browser agent, Pravah Gemma, attachments.

**Boot-blocking** (`process.exit(1)`):

| Variable | Rule |
|---|---|
| `JWT_SECRET` | required, ≥32 characters |
| `QMS_SEED_PASSWORD` | required |
| `DATABASE_URL` | required, and must be reachable, **when `NODE_ENV=production`** |
| `EMAIL_TRANSPORT` | must be `mock`, `gmail` or `nic` |
| `MAILBOX_SOURCE` | must be `auto`, `gmail` or `nic` |
| `SESSION_COOKIE_SAMESITE` | must be `lax`, `strict` or `none` |
| `GMAIL_CLIENT_ID` / `_SECRET` | required **when** `EMAIL_TRANSPORT=gmail` |
| `GMAIL_REFRESH_TOKEN_FRONT_OFFICE` | required when `EMAIL_TRANSPORT=gmail` — it is the only authenticated mailbox |
| `NIC_EMAIL`, `NIC_IMAP_HOST`, `NIC_SMTP_HOST` | required when `EMAIL_TRANSPORT=nic` or `MAILBOX_SOURCE=nic` |
| `NIC_EMAIL` | required when `NIC_BROWSER_MAILBOX=true`, and must differ from `FRONT_OFFICE_EMAIL` |

**One mailbox is authenticated, and it is the Front Office's.** It is the only account the system
reads from and the only one it sends as: acknowledgements, the forward to the Officer-in-Charge and
the final dispatch all go out as the Front Officer, and inbox polling uses the same token. The
NICeMail browser mailbox (`NIC_BROWSER_MAILBOX=true`) holds no credential here at all — it reads and
sends through a Chrome session the operator signed in to by hand — and answers only the cases that
arrived in it.

There is deliberately no `GMAIL_REFRESH_TOKEN_INQUIRER` and no
`GMAIL_REFRESH_TOKEN_OFFICER_IN_CHARGE`. Inquirers are **external** — anyone can send an enquiry from
their own mail client, and they authenticate to nothing here. The Officer-in-Charge is a
**recipient**, addressed by `OFFICER_IN_CHARGE_EMAIL`; nothing in the codebase ever sends as that
role. `npm run gmail:preflight` fails only on the Front Office mailbox, and reports a stale token on
any other role as configured-but-unused.

NIC configuration is otherwise *not* asserted at boot — a deployment that only uses the diagnostic
`/nic/*` endpoints starts normally, and NIC errors surface per-request as a `stage: 'config'`
failure. The **browser agent** itself — Chrome, CDP, a signed-in tab — is never asserted at boot
under any configuration and cannot prevent the server starting; the only boot check it brings is the
`NIC_EMAIL` rule above, when `NIC_BROWSER_MAILBOX=true`.

`ATTACHMENT_DIR` is resolved against the **backend package root**, not `process.cwd()`, so a
relative value means the same directory however the process was launched.

`dotenv.config()` is called with no `path`, so it resolves `.env` relative to `process.cwd()`. Start
the backend **from `backend/`**, or pass the file explicitly — launching from the repository root
silently loads no `.env` at all. The `injected env (N) from .env` banner on startup is dotenv v17's
own notice, not an error; `N` should match the number of `KEY=` lines in your file.

## Production deployment

```bash
npm ci                 # exact versions from package-lock.json
export NODE_ENV=production
npm start
```

What `NODE_ENV=production` changes, beyond the usual:

| | Effect |
|---|---|
| `DATABASE_URL` | unset or unreachable is now a **startup failure**, not a degraded start |
| `trust proxy` | enabled (one hop), so `secure` cookies and rate-limit keys use the real client address |
| Error bodies | 5xx returns a generic message; stacks never leave the process |
| morgan | `combined` format rather than `dev` |
| Session cookie | `Secure` is set automatically — the deployment must therefore be HTTPS |

Also required:

- **`CLIENT_URL` must be the exact browser origin of the frontend** (scheme, host and port). CORS is
  built from this single value with credentials enabled, so it cannot be a wildcard — the browser
  rejects `*` alongside credentials. A mismatch here looks like a CORS failure in the console but is
  a configuration error.
- **`SESSION_COOKIE_SAMESITE`**: `lax` when the frontend and API share a registrable domain, `none`
  only for a genuinely cross-site deployment (and `none` forces `Secure`, so it cannot work over
  plain http).
- Run behind a reverse proxy terminating TLS. The process listens on `PORT` on all interfaces.
- `SIGTERM` and `SIGINT` are handled: the server stops accepting connections, lets in-flight
  requests finish, closes MongoDB, and exits — with a 10-second cap before it exits anyway. An
  orchestrator's rolling restart will not cut requests mid-flight.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ERR_MODULE_NOT_FOUND: Cannot find package '…'` at startup | `node_modules` is older than `package.json` | `npm install` (or `npm ci`) in `backend/` |
| `DATABASE_URL is required when NODE_ENV=production` | no database configured | set `DATABASE_URL`; the server will not start without it in production |
| `MongoDB is unreachable at DATABASE_URL` | server down, wrong host, firewall | `mongosh "$DATABASE_URL" --eval 'db.runCommand({ping:1})'` |
| `/queries/*` returns 503 | MongoDB not connected | as above. In development the rest of the API keeps working |
| Browser reports a CORS failure | `CLIENT_URL` does not match the frontend's actual origin | set it exactly; `http://localhost:5173` ≠ `http://127.0.0.1:5173` |
| 401 on every API call after sign-in | cookie not being sent | check `SESSION_COOKIE_SAMESITE`, and that the frontend uses `withCredentials` (it does by default) |
| `gmail:preflight` → `invalid_grant` | the refresh token expired or was revoked | re-authorise that account. Not a code defect |
| `nic:verify` → `Invalid credentials` / `535` | webmail password used instead of an app password | generate one at webmail → Security → App Passwords |
| `nic:preflight` → `mail.gov.in` times out | those endpoints are not reachable from outside NICNET | use the `mgovcloud.in` pair, which is what `.env.example` configures |
| `nic:browser:discover` → "not a Chrome DevTools endpoint" | another browser holds port 9222 | close it, or set `NIC_CDP_ENDPOINT` to a free port |
| IPC Mailbox shows **NICeMail could not be read** | the last NICeMail sync failed; `sync.stage` says where | fix what the stage names — [runbook §13](../docs/NIC_BROWSER_AGENT.md#13-troubleshooting) |
| A send "may have been sent but did not confirm it in time" | NICeMail Send was pressed; the form did not close within `NIC_BROWSER_TIMEOUT_MS` | check the NICeMail **Sent** folder before any retry — [runbook §13](../docs/NIC_BROWSER_AGENT.md#13-troubleshooting) |
| Backend refuses to start: `NIC_EMAIL must differ from FRONT_OFFICE_EMAIL …` / `NIC_EMAIL is required …` | `NIC_BROWSER_MAILBOX=true` with a missing or shared address | set `NIC_EMAIL` to the NICeMail mailbox, distinct from the Gmail Front Office |

## Tests

44 test files (589 tests) under `src/test/`, run with `npm test` (Vitest 4 + supertest,
`environment: 'node'`).

The harness is pinned so **nothing in the suite touches the network**: `GEMMA_API_URL=''`,
all Gmail and NIC credentials blank, `DATABASE_URL=''`, and `NIC_CDP_ENDPOINT` pointed at an
unroutable address on purpose. `setup.js` forces the in-memory mailbox and gives **each test file
its own temp attachment directory** — Vitest runs files concurrently across worker threads, and a
single shared `ATTACHMENT_DIR` caused real cross-file races.

It is also pinned so **the suite does not depend on your `.env`.** `env.js` loads `backend/.env`,
and dotenv only skips keys already set, so any key `vitest.config.mjs` does not pin comes from the
developer's own file. Every `NIC_BROWSER_*` variable, `NIC_FRONT_OFFICE_NAME`, the `NIC_WEBMAIL_*`
patterns and `NIC_ALLOW_OUTBOUND` are therefore pinned blank — the NICeMail mailbox off and the
outbound interlock closed — so enabling the feature locally cannot change what the suite sees. Tests
that exercise it switch it on themselves with `vi.stubEnv`.

`test/helpers/auth.js` mints session cookies directly rather than calling `POST /auth/login`, so a
test about forwarding does not depend on the login endpoint. It lives under `helpers/` so the
`*.test.js` glob never collects it.

## Health Check

```
GET /api/v1/health
```

Returns `200` with a small JSON payload confirming the service is up.

## Security status: authenticated, but not yet case-scoped

### What is enforced

Every endpoint except `GET /api/v1/health` and `POST /api/v1/auth/login` requires a session.
Sign-in posts credentials to `/auth/login`, which returns a JWT in an **httpOnly cookie**
(`qms.session`); `middleware/verifyToken.js` puts the principal on `req.user`, and
`middleware/verifyRole.js` gates each route by role — `verifyRole(...)` for plain role lists,
`verifyAction(...)` for workflow actions via `constants/workflowActions.js`.

The cookie, rather than an `Authorization` header, is what makes attachment preview and
download work: `attachmentUrl()` builds bare URLs for `<img>`, `<iframe>` and `<a download>`,
and those cannot carry a header.

Destructive routes are restricted to `SUPER_ADMIN`: `DELETE /api/v1/mailbox` and
`POST /mailbox/receive`, because under `MAILBOX_SOURCE=gmail` they operate on a real account, and
`POST /queries/reset`, because it deletes every case in the system.

Request bodies on `/queries/*` and `/queries/:id/pullback` are validated against Zod schemas by
`middleware/validateBody.js`, which **replaces** `req.body` with the parsed result — validating
without replacing would leave the raw body in place for the next careless `$set`. Audit actors are
taken from `req.user` and rejected from the body. A rejection answers **400** with the offending
**field paths** — `{ error: 'Request body failed validation', fields: ['auditEvent.event'] }` — and
never the values, because a `/queries` delta carries case content. The client shows those paths, so
a contract mismatch arrives as something a developer can act on from a screenshot rather than as an
unactionable "changes were not saved".

Rate limits (`express-rate-limit`, disabled under `NODE_ENV=test`): 10 failed sign-ins per 15
minutes per IP on `/auth/login` (successful ones are not counted, so a working session's reloads
never lock its owner out), and 600 requests per minute across `/api/v1`. Behind a reverse proxy set
`NODE_ENV=production` so `trust proxy` is enabled and the limiter keys on the real client address
rather than the proxy's.

Required configuration — the server refuses to start without them: `JWT_SECRET` (≥32 chars)
and `QMS_SEED_PASSWORD`, plus `DATABASE_URL` when `NODE_ENV=production`. See `.env.example`.

5xx responses carry a generic `Internal Server Error` outside development. The full message and
stack go to stderr; a Mongoose error naming a collection or a driver error carrying a connection
string is not something to hand a caller.

Both guards fail closed with **401** if `req.user` is absent, so a route mis-wired to omit
`verifyToken` breaks loudly rather than silently allowing access. Every refusal is recorded as an
`AUTHORIZATION_DENIED` audit event.

### What is NOT enforced yet

1. **Case-level authorization.** Any *authenticated* user can read any attachment by id, and
   `GET /queries` returns every case to every role. `authorizeAttachmentAccess` checks only that a
   session exists. The Query Case records needed to check ownership now exist — this is no longer
   blocked, only unimplemented. An Inquirer should reach only their own case and its attachments.
2. **Workflow-state authorization.** `verifyAction` enforces the role half of the frontend's
   `canPerform(role, action, state)`. The `ACTION_VALID_STATES` half is still client-side, so a
   permitted role is not blocked from acting on a case in the wrong state. `POST /queries/persist`
   validates the *shape* of a transition, not its legality.
3. **Token revocation.** Tokens are stateless; logout clears the cookie but a copied token
   stays valid until it expires (`SESSION_TTL_SECONDS`, default 8h).
4. **Real user provisioning.** Accounts are seeded from `src/constants/users.js` and all share
   `QMS_SEED_PASSWORD`. This is a development mechanism, not a user store — replace it with
   per-user credentials before production. See [`docs/auth.md`](../docs/auth.md).
5. **Password-less dev login.** `POST /auth/dev-login` answers whenever `NODE_ENV=development` — the
   default when `NODE_ENV` is unset — and the process listens on all interfaces, so anyone who can
   reach the port can sign in as any seeded account, including the primary Front Office, whose inbox
   may be a real Gmail account under `MAILBOX_SOURCE=gmail`. Only the NICeMail Front Office is
   refused (403, audited). Do not run a development-mode backend where untrusted hosts can reach it.
6. **Case content decides what a mailbox sends.** `POST /queries/persist` has no role or case check,
   so any signed-in role can edit a case's inquirer and response text — which, for a NICeMail case,
   is what the official `.gov.in` mailbox sends and to whom. Mailbox pinning, too, covers only the
   NICeMail Front Office's own requests; the decision routes and the primary mailbox's `?recipient=`
   are not scoped. See [docs/NIC_BROWSER_AGENT.md §17](../docs/NIC_BROWSER_AGENT.md#known-limitations--open).

Note also that `constants/capabilities.js` (NIC agent autonomy: read / prepare / send / destructive,
with a `HUMAN_ONLY` set) is covered by `rbac.test.js` but is **not wired into any route's middleware
chain** — it does not currently guard anything.

Until (1) and (2) land, do not expose this server outside a trusted network. The server prints this
same warning on every boot.
