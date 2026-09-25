# QMS Backend

Node.js + Express 5 API for the Query Management System. **JavaScript only, ES Modules
throughout** (`"type": "module"`) — no TypeScript, no CommonJS.

## What is implemented

41 route registrations across ten resource routers: health, auth, emails, mailbox, AI, attachments,
NIC, audit, queries and pullback. Session authentication (JWT in an httpOnly cookie) with role-based
route guards and Zod request validation. MongoDB persistence for Query Cases, the workflow record,
the mailbox and the audit trail. Two email transports — mock and NICeMail SMTP — plus, with `NIC_BROWSER_MAILBOX=true`, a second
Front Office mailbox in NICeMail, read and answered through an operator-signed-in Chrome session
(see [NICeMail](#2-browser-agent-over-cdp--the-web-session)). Case-level authorization on the
workflow-sync route and on every attachment. A real LLM integration (Pravah Gemma) grounded in an
indexed corpus of IPC guidance documents. Disk-backed attachment storage with fail-closed resolution
on every outbound send.

**Not implemented:** the workflow-state half of `canPerform` is still client-side — the server
validates the shape of a transition, who may attempt it, and that the caller is party to the case,
but not whether the case was in a state that allowed it. See
[Security](#security-status-authenticated-and-case-scoped).

## Setup

```bash
npm install
cp .env.example .env.local
```

Then set `JWT_SECRET` (≥32 characters) and a sign-in credential for every account —
`QMS_PASSWORDS_FILE`, `QMS_PASSWORD_<USER_ID>`, or outside production the shared
`QMS_SEED_PASSWORD` — **the server refuses to start without them**, so a fresh copy of the example
does not boot until they are set. Generate a secret with `openssl rand -base64 48`. Set
`DATABASE_URL` too (see [Database](#database)). Every variable is described in
[docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md).

`npm install` after every pull that changes `package.json`. The app imports `compression`,
`mongoose`, `zod` and `express-rate-limit` at module load, so a stale `node_modules` fails at
startup with `ERR_MODULE_NOT_FOUND` rather than degrading. Use `npm ci` on a deployment host.

## Development

```bash
npm run dev      # nodemon, auto-restart
npm start        # plain node
npm test         # vitest, 59 test files / 912 tests
npm run lint     # eslint
```

Operational scripts:

| Script | Purpose |
|---|---|
| `npm run db:provision` | Create the collections and indexes at `DATABASE_URL` (or `--uri`) and insert the development identities; writes no cases, and is safe to repeat. `--dry-run` reports only; `--truncate` also clears workflow data and needs `--force` on a shared database. See [Shared development database](../README.md#shared-development-database-mongodb-atlas). |
| `npm run db:reset` | Clear the workflow state from MongoDB, keeping `users`. Refuses a shared database without `--force`. See [Resetting the workflow state](#resetting-the-workflow-state). |
| `npm run mailbox:purge` | Triage inbound mail and strip the content of junk past the retention window. `--dry-run` first — it destroys content. Refuses a shared database without `--force`. See [Junk triage and retention](#junk-triage-and-retention). |
| `npm run triage:eval` | Score the triage prompt against a fixture set on the live Gemma endpoint. Fails if any genuine fixture is judged destroyable. Not part of `npm test`. |
| `npm run ingest:ipc` | Rebuild `src/data/ipcKnowledge.json` from `docs/markdown/`. See [AI grounding](#ai-grounding-layer). |
| `npm run nic:preflight` | Read-only NICeMail IMAP/SMTP reachability + auth probe. Never marks mail read. |
| `npm run nic:verify` | Live three-level NICeMail verification (read, send, receipt). Sends exactly one message, only to `NIC_TEST_RECIPIENT`. |
| `npm run nic:browser:discover` | Read-only inspection of the NICeMail session over CDP: which document holds the mailbox, how the selector registry resolves, the mail rows, and a diagnosis. Flags after `--`: `--json`, `--rows=N`, `--show-addresses`, `--agent-tab`. |
| `npm run nic:browser:calibrate` | Calibrates the NICeMail compose form in the agent's own background tab. It opens one draft, checks From, tries recipient, subject and body entry, visits Sent and Drafts, then discards the draft. **It never presses Send.** Flags after `--`: `--attach` (also attaches a small generated PDF), `--show-addresses`. |

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
  middleware/     verifyToken, verifyRole/verifyAction, validateBody, validateQuery,
                  authorizeAttachmentAccess, errorHandler, notFound
  models/         Mongoose schemas — AuditEvent, EmailMessage, EmailThread, MailboxMessage(+Counter),
                  Notification, OutboundEmail, QueryCase, QueryCounter, ResponseVersion, Review,
                  User, WorkflowStep
  routes/         index.js mounts ten resource routers under /api/v1
  scripts/        operational + diagnostic CLIs
  services/
    ai/           gemmaService.js — summary, recommendation, draft, question decomposition
    attachments/  policy, disk store, fail-closed resolver, error type
    audit/        auditService.js — record/list/summary, Mongo-or-buffer
    auth/         tokenService.js (stateless JWT), userDirectory.js (seeded accounts)
    email/        emailService.js, caseMail.js, outbox.js, delivery.js
                  + transports/, mailbox/ (incl. health.js), nic/, templates/
  test/           50 *.test.js + setup.js + helpers/ + support/memoryDb.js
  utils/          (empty — .gitkeep only)
  validators/     Zod schemas — queryStateSchemas.js, pullbackSchemas.js
scripts/
  ingestIpcDocs.mjs   build step for src/data/ipcKnowledge.json
storage/
  attachments/        attachment bytes + .json sidecars (gitignored)
  nic-browser/        nic:browser:discover --json reports (gitignored)
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
| GET | `/mailbox/messages` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` + `validateQuery` |
| GET | `/mailbox/messages/:messageId` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| GET | `/mailbox/messages/:messageId/attachments/:attachmentId` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| POST | `/mailbox/messages/:messageId/read` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| POST | `/mailbox/sync` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| POST | `/mailbox/messages/:messageId/accept` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` + `validateBody` |
| POST | `/mailbox/messages/:messageId/decision` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` + `validateBody` |
| GET | `/mailbox/decisions` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| POST | `/mailbox/messages/:messageId/ingested` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| DELETE | `/mailbox/messages/:messageId` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| POST | `/mailbox/receive` | `verifyRole(SUPER_ADMIN)` |
| DELETE | `/mailbox` | `verifyRole(SUPER_ADMIN)` + `refuseDestructive` |

The two `SUPER_ADMIN` routes are destructive/injection utilities, and both refuse outright (409) when
`NODE_ENV=production`; `DELETE /mailbox` also refuses when `DATABASE_URL` points at a shared
database. They exist for tests; against a live NICeMail mailbox they would act on somebody's real
mail.

**Which mailbox a request acts on is decided by who is signed in** (`resolveMailbox` in
`controllers/mailboxController.js`). With `NIC_BROWSER_MAILBOX=true`, the Front Office user whose
sign-in address is `NIC_EMAIL` always gets the NICeMail browser mailbox for `GET /messages`, the
message routes below, `/accept`, `/ingested` and `DELETE /messages/:id`, and `?recipient=` is
ignored; everyone else gets the `MAILBOX_SOURCE` mailbox, where `?recipient=` still selects the
address — but never a NICeMail row, which the Mongo primary store does not list, change or delete.
The decision routes are keyed by message id alone and belong to neither. For that user
`GET /messages` also carries a `sync` field —
`{ ok, at, stored, stage, error, running, failed, failedMessages, quarantined, remaining }`, the
outcome of the last background read of the live inbox — and answers 200 from what is stored even
when that read failed. See [NICeMail browser mailbox](#the-second-front-office-mailbox).

**Reading messages.** `GET /messages` takes `unreadOnly`, `recipient`, `q` (at most 200 characters,
regex-escaped, searching `from`, `subject` and `body`), `limit` (1–200) and `offset`, validated by
`validateQuery` into `req.validatedQuery` (400 naming the fields otherwise). Without `limit` the whole
list comes back, as before; with it, one page plus `total`, `limit` and `offset`. Each message is the
stored document without `bodyHtml`, plus `toAddresses`, `isRead` (`null` for a mailbox with no read
state), `status` (`NEW` / `READ` / `ACCEPTED` / `REJECTED`, derived in
`services/email/mailbox/messageView.js`, never stored), `linkedCase`
(`{ queryId, workflowState, businessStatus }` or `null`) and `createdAt`. `unreadOnly` still means
"not yet handled" (`ingested: false`), **not** "not read" — that is `isRead`.

- `GET /messages/:messageId` — the same view plus `bodyHtml`; 404 `{ error, messageId }`.
- `GET /messages/:messageId/attachments/:attachmentId[?download=1]` — the attachment only if it is on
  that message in the caller's mailbox, else 404; served by the same `sendAttachment` as
  `/attachments/:id` and audited `ATTACHMENT_DOWNLOADED` with the `messageId`.
- `POST /messages/:messageId/read` — QMS-local read state (`readAt`, `readByUserId`); NICeMail's own
  is never touched. Idempotent, `EMAIL_MARKED_READ` on the first call only; 409 for a mailbox that
  keeps no read state.
- `POST /sync` — NICeMail: 202 `{ supported: true, started, sync }`, `started: false` while a sync
  runs or within 15 s of the last, `SYNC_STARTED` audited on a real start. Any other mailbox: 200
  `{ supported: false, started: false, sync }`. 503 without MongoDB.

**`/accept` and `/decision` are the validation gate.** An incoming message becomes a Query Case only
because a Front Officer accepted it; rejecting records the judgement and creates nothing.

#### `POST /mailbox/messages/:messageId/accept`

The whole intake sequence in one request (`services/email/mailbox/acceptMessage.js`): mint the Case
ID, create the case, record the `ACCEPTED` `MailboxDecision`, summarise the enquiry onto the case,
send the acknowledgement to the real sender, **and forward to the Officer-in-Charge**. An accepted
case therefore lands at `PENDING_ASSIGNMENT`, not `FRONT_OFFICE_VERIFICATION`, and the audit trail
reads `QUERY_RECEIVED → QUERY_REGISTERED → CASE_ASSOCIATED → AI_SUMMARY_GENERATED →
ACKNOWLEDGEMENT_SENT → QUERY_FORWARDED`, then `EMAIL_CLASSIFIED` when the controller records the
decision. `CASE_ASSOCIATED` carries the mailbox message's id and the `queryId`, and is written only by
the request whose insert created the case, so it appears once however many accepts race.

The body is the message as the inbox saw it — `from`, `to`, `cc`, `bcc`, `subject`, `body`,
`receivedAt`, `providerMessageId`, `providerThreadId`, `attachments` (`validators/mailboxSchemas.js`).
The server does not re-fetch the message: for a live mailbox that would be a second round
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
| POST | `/queries/reset` | `verifyToken` + `verifyRole(SUPER_ADMIN)` + `refuseDestructive` + `validateBody(resetQueryStateSchema)` |

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
  `middleware/refuseDestructive.js` answers 409 with the reason when `NODE_ENV=production` or
  `DATABASE_URL` points at a shared database, and the UI shows that reason.
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
- **`/queries/persist` refuses a stale or colliding write with 409 and a `code`**
  (`{ code, error, queryId }`).
  - `STALE_CASE`: every case carries a server-owned `revision` (a case stored before the field
    existed counts as 0). The client sends the revision its change was built on as a top-level
    `baseRevision`, 0 for a new case. The case write is a conditional update on that revision, run
    before anything else, so a mismatch writes nothing — no step, review, notification, message,
    counter or audit row. A client write moves `revision` on by one, and so do the server's own case
    writes: pullback, final approval, the forward, dispatch and close, and mailbox accept.
  - `ID_COLLISION`: a step, review, response version, message, thread or notification id in the delta
    is already stored under another case, or the Case ID belongs to a different case (`createdAt` is
    the witness — a genuine update carries the one the case was created with). Every sub-record
    upsert is keyed on its `queryId` as well as its id, so a collision that slips past the checks hits
    the unique index and is answered with this 409 instead of re-homing another case's row.
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
non-zero if it throws. `connectDb` throws, in every environment, when `DATABASE_URL` is set but names
no database or cannot be reached, and when it is unset under `NODE_ENV=production`. Only an unset
`DATABASE_URL` in development makes it warn and return `false`, and the process continues in degraded
mode. Error text passes through a redaction that drops the credentials from any connection string.

The distinction matters because the degradation is uneven ("Without" means `DATABASE_URL` is
unset):

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

Connection options are set explicitly — `serverSelectionTimeoutMS: 15000`, `maxPoolSize: 20`,
`minPoolSize: 2`, `socketTimeoutMS: 45000` — and `disconnected` / `reconnected` / `error` are logged,
so an outage is visible rather than showing up as unexplained slowness. 15 s covers an Atlas SRV
lookup and TLS handshake, and a typical primary election: while a configured database reconnects,
the `requireDb` routes answer 503 at once, and the mailbox, audit trail and email ledger wait for the
driver rather than switching to memory or sending without the ledger. The connect line names the
host and database, never the URI, and says when the database is shared (a `mongodb+srv://` URI or
any non-loopback host).

**Indexes come from the schemas.** `connectDb()` calls `Model.syncIndexes()` on every model at
startup — except on a shared development database, where it calls `Model.createIndexes()`, which
only adds and never drops an index another branch declares. `npm run db:provision` remains the
explicit sync there. `createCollection()` builds an index that does not exist yet but will **not**
rebuild one whose options have changed — which is how a unique index on `EmailMessage.sourceMessageId`, created
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

**Models** (`src/models/`, 14 across 13 files):

| Model | Holds |
|---|---|
| `QueryCase` | the case: subject, inquirer, priority, `workflowState`, assignee, attachments, the stored `aiSummary`, and `sourceMailbox` — the mailbox the enquiry arrived in, set by the server at accept and stripped from every `/queries/persist` write |
| `WorkflowStep` | one step per review level; compound index on `{queryId, sequence}` |
| `Review` | a reviewer's decision: `comment` (singular — the plural was never populated), plus `responseId`/`version` tying it to the draft it judged. `stepId` and `reviewerId` are nullable, because a return-for-revision from final approval has no review step open |
| `ResponseVersion` | successive drafts, with AI provenance in `aiMetadata`, `source` and `aiGenerated`; `status` is the final-approval lock `saveDraftVersion` enforces, with `approvedAt` alongside it |
| `Notification` | per-role / per-user notifications |
| `EmailMessage`, `EmailThread` | the case's email record |
| `AuditEvent` | 14 fields, indexed on timestamp/actorType/actorId/auditId/action/queryId/messageId. `action` is deliberately *not* an enum so a new action never fails to record; `auditId` is indexed but **not unique**, because the counter behind it lives in a browser |
| `MailboxMessage` + `Counter` | the ingest mailbox and the numeric `MSG-00001` sequence. Also holds the NICeMail browser mailbox's messages: `source: 'nic-browser'`, a `providerMessageId` under a unique partial index, and `removedAt`, which hides a deleted message so the next sync cannot bring it back. Additive, insert-only and not backfilled: `toAddresses` (the To header; `to` stays the mailbox), `providerThreadId`, `bodyHtml` (null over 1,000,000 chars), `providerUnread`, `receivedAtSource` (`message`/`sync`), the QMS read state `readAt`/`readByUserId`, and `createdAt`. Compound index `{to, source, removedAt, receivedAt: -1, mailboxMessageId: -1}` for the inbox list |
| `MailboxDecision` | the Front Officer's accept/reject on one incoming message |
| `MailboxTriage` | the machine's verdict on one incoming message — `GENUINE`/`JUNK`, a confidence, which rule or the model decided, and `classifiedAt`, which is the retention clock. Also `rescuedAt` (a person said "not junk": terminal) and `purgedAt`, the sweep's watermark |
| `OutboundEmail` | one row per case email — `dispatchKey` = `"${emailType}:${queryId}"`, **unique**. `status` is `SENDING`/`SENT`/`FAILED`/`UNCERTAIN`, with `claimToken`, `leaseExpiresAt`, `attempts`, `recipients`, `rfcMessageId`, `lastError`, `resolvedBy` and a capped `history`. The unique key is the idempotency guard: see *One email per case* below |
| `User` | seeded directory; written on connect, **not yet read for authentication** |
| `QueryCounter` | the workflow store's id counters, held as an object |

> `QueryCounter` exists because `Counter.value` is a `Number` incremented with `$inc`, while the
> workflow store keeps a whole map (`{QRY, THREAD, MSG, …}`). Writing that object into the numeric
> field raised a `CastError` that failed the entire persist — the two counters share a name but not
> a shape, and now not a collection either.
>
> `MailboxDecision` is separate from `MailboxMessage` for a different reason: when the mailbox is a
> live NICeMail account it is a read-only view. There is no row to update and `MailboxMessage` is not
> even populated, so the decision has to survive independently of whichever store the mailbox is read
> from. It is keyed by the stable provider message id and carries a `from`/`subject`/`receivedAt`
> snapshot, so "what was rejected, and from whom?" still has an answer once its owner has archived or
> deleted the mail.

Timestamps are stored as ISO-8601 **strings**, not `Date`. That is deliberate: ISO-8601 compares
correctly as text, so the same `from`/`to` bounds work against Mongo and against the in-memory audit
buffer without a second code path.

### Junk triage and retention

The Front Office mailbox takes mail from anyone, so it also takes bounces, out-of-office replies,
marketing, and this system's own acknowledgements looping back. All of it used to be stored whole,
at up to 1,000,000 characters of `bodyHtml` each, on a 512MB cluster.

Triage runs in two stages. **Deterministic rules** run on the intake path
(`services/email/mailbox/triageRules.js`): a message sent from one of our own configured addresses,
a delivery-status notification, or a `mailer-daemon`/`postmaster` sender is `hard` junk — provably
machine-generated, and purgeable. Anything a person might plausibly have sent — a `no-reply` sender,
an out-of-office subject, a bulk header, an empty body — is `soft`: recorded as junk so it sorts,
but sent on to the model, which decides. **One Gemma call** then settles the soft cases, from inside
the hourly sweep rather than on intake: a 12-second call per message inside a 30-second sync loop
would wreck the inbox, and there it is rate-limited to one small batch an hour.

**Nothing is deleted.** The sweep strips `body`, `bodyHtml` and `attachments`, unlinks the
attachment bytes from disk, and sets `purgedAt` — leaving the id stub, because that stub is what
stops the next sync re-ingesting the message. This is also why a MongoDB TTL index cannot do the
job: a TTL index can only remove a whole document.

Five things make a wrong verdict survivable:

- **GENUINE is the default** that evidence has to overcome. A sender filter was removed from the
  inbound reader once already, and the reason was recorded — "an enquiry from an unknown member of
  the public was silently discarded before anyone saw it — the worse of the two failures" — and this feature is
  built to respect that. ESP bounce-domain matching was considered for the rule set and rejected on
  the same reasoning.
- **Junk stays whole and visible for `MAILBOX_RETENTION_HOURS`** (42 by default) in the Junk filter,
  with a `purgesAt` countdown. `POST /mailbox/messages/:id/triage/rescue` clears the verdict
  permanently, without minting the Query Case that accepting it would.
- **Every failure degrades to genuine, structurally.** Every failure path in `classifyMail` returns
  GENUINE at confidence 0, and the junk tier's candidate query requires `confidence >= 0.9`. A Gemma
  outage can only reduce purging on that tier; it cannot cause a wrong one. No code enforces that —
  the filter shape does.
- **A second, much longer tier is what actually bounds the collection.**
  `MAILBOX_UNREGISTERED_RETENTION_HOURS` (336, two weeks) takes anything still unregistered
  whatever its verdict, because the tier above can never reach a genuine enquiry — GENUINE is pinned
  at confidence 0 by construction, so without this a message nobody ever Ticks would be kept whole
  forever. The trade is explicit: this tier offers no outage protection, and the long window is the
  margin instead. It refuses to be configured shorter than the junk window, since the age rule would
  then fire first and the confidence floor would never be consulted. Registered and rescued mail are
  exempt from both tiers.
- **Absolute vetoes**, re-checked immediately before each update: an `ACCEPTED` decision, or a
  `QueryCase` linked to the message. The re-check closes a race against `acceptMessage`, which
  copies the body onto the case.
- **A permanent audit row.** Every purge writes `EMAIL_PURGED` with the sender, subject and
  received time, so once the body is gone "what was thrown away, and who sent it?" still has an
  answer.

> **The prompt is evaluated, not assumed.** `npm run triage:eval` scores the classifier against a
> fixture set on the live endpoint and fails the run if any *genuine* fixture comes back purgeable
> even once. It was written because the first version of this prompt destroyed real mail: a CDSCO
> circular from a `noreply@` address came back JUNK at 0.95 three times out of three, a relayed
> ticket once in three, and a "please see attached" enquiry three times out of three.
>
> Two changes fixed it, and both are load-bearing. The arrival signals are now presented under
> "HOW THIS MESSAGE ARRIVED (circumstance, NOT evidence of junk)" with two sentences saying so —
> under the old neutral heading the model read them as a verdict to ratify. And the attachment list
> is now in the prompt: without it an enquiry whose content is entirely in a PDF arrived as a blank
> message. `classifyMail` takes `attachments`, and the sweep's projection selects it.
>
> After: **0/5 purgeable on all six genuine fixtures, 5/5 caught on all three junk fixtures.**
> Re-run the eval after any change to the prompt — `mailboxTriageGemma.test.js` pins the wording,
> but only the eval shows what the model does with it.

The sweep runs hourly from `server.js`, unref'd, off under `NODE_ENV=test`, when
`MAILBOX_RETENTION_ENABLED=false`, and on a shared development database unless this backend is the
mailbox host (`NIC_BROWSER_MAILBOX=true`, `NIC_BROWSER_VIEWER` off), and purges nothing in the
first two hours after boot — the retention window is wall-clock, but the rescue window only exists while somebody can see the inbox,
so a server back from a long outage must not purge its backlog before anyone has looked at it.

```bash
npm run mailbox:purge -- --dry-run     # what it would destroy, destroying nothing
npm run mailbox:purge -- --backfill    # judge rows stored before triage existed
npm run mailbox:purge -- --hours=72    # a wider window, to drain a backlog
npm run mailbox:purge -- --indexes     # the triage indexes, which no test can see
npm run triage:eval                   # score the classifier on the live endpoint
npm run triage:eval -- --runs 5 --fixture circular-noreply
```

Rows stored before this existed have no verdict, so they are not purgeable and **no migration is
required**. `--backfill` judges them on the rules alone and stamps `classifiedAt` as *now*, not the
message's own `receivedAt`, so every backfilled row gets a full fresh window however old the mail is.

> Only the NICeMail browser mailbox stores rows, so it is the only purgeable source
> (`PURGEABLE_SOURCES`). Under `MAILBOX_SOURCE=nic` the inbox is a live, read-only IMAP view of a
> remote account and nothing is stored in Mongo at all.

### Resetting the workflow state

```bash
npm run db:reset              # clear the workflow state at DATABASE_URL
npm run db:reset -- --dry-run # report what would go, change nothing
npm run db:reset -- --force   # required when NODE_ENV=production or the database is shared
```

`scripts/resetWorkflowState.mjs` clears `querycases`, `workflowsteps`, `reviews`,
`responseversions`, `notifications`, `emailmessages`, `emailthreads`, `mailboxmessages`,
`mailboxdecisions`, `mailboxtriages`, `querycounters`, `counters` and `auditevents`.

It is a **maintenance tool, not a seed: it inserts nothing.** The point is to return a development
database to the state a fresh install would have, so the next real enquiry is case `00001` rather
than continuing somebody else's sequence.

`users` is deliberately untouched — it is re-seeded from `src/constants/users.js` on every connect,
and those accounts are the staff directory the application needs, not fixtures. The script refuses
to run under `NODE_ENV=production` without `--force`, and to delete from a shared database (a
`mongodb+srv://` URI or any non-loopback host) without it — do not pass it against the team's shared
database. It exits if `DATABASE_URL` is unset, and prints the target, with credentials redacted, and
whether it is shared before connecting.

## Email pipeline

`services/email/mailbox/index.js` is a duck-typed swap seam: three implementations
(`mockIpcMailbox`, `mongoIpcMailbox`, `nicInboxReader`) expose the same six functions (`deliver`,
`list`, `markIngested`, `remove`, `reset`, `stats`), and the facade picks one at call time — forced
override, then `MAILBOX_SOURCE=nic`, then Mongo if connected or `DATABASE_URL` is set, else
in-memory. `supportsDelivery()` is false for NICeMail, because a real inbox cannot be written into. The facade's
`get(recipient, id)` uses a store's own lookup, or finds the message in its list. `mongoIpcMailbox`
shares its collection with the NICeMail browser mailbox and never lists, changes, deletes or clears
a `source: 'nic-browser'` row.

A fourth store, `nicBrowserMailbox`, is not chosen by `MAILBOX_SOURCE`: `mailbox.forUser(user)`
returns it only for the NICeMail Front Office (see
[the second Front Office mailbox](#the-second-front-office-mailbox)), and it is imported on demand.

`nicInboxReader` is read-only: `nicImap` opens the folder with `readOnly: true`, so `deliver()` and
`reset()` deliberately throw and nothing can even set `\Seen`. `mailbox/index.js` exposes
`supportsDelivery()` so a caller checks before depositing.

### Which channel a case's mail goes out through

One rule, and it is the case's, not the deployment's.

A case remembers the mailbox its enquiry **arrived** in — `sourceMailbox`, `{ source, address }`,
written by the server at intake and never by a client. `emailService.transportFor(sourceMailbox)`
reads it:

| `sourceMailbox.source` | Channel | Sender |
|---|---|---|
| `nic-browser` | `transports/nicBrowserTransport.js` — the operator's signed-in Chrome session | the NICeMail Front Office (`senderFor`) |
| anything else, or null | `getTransport(EMAIL_TRANSPORT)` — `nic` or `mock` | `FRONT_OFFICE_*` |

**All three** of a case's emails follow that rule: the acknowledgement, the final response **and the
forward to the Officer-in-Charge**. The forward used to stay on `EMAIL_TRANSPORT` regardless,
because that is where the legacy Gmail transport was. Once Gmail was removed, a NICeMail case that
answered its inquirer through the browser but told the Officer-in-Charge through `EMAIL_TRANSPORT`
would have been two channels — and the second one has no credential. Worse, while the browser
interlock was closed, that forward escaped it entirely.

`getTransport` resolves through dynamic `import()`, so `nodemailer` is never evaluated on the mock
path, and an unknown transport name degrades to the mock rather than half-configuring a send.

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

A mailbox read is filtered by **recipient only** — the Front Office address — and carries **no
sender filter**. Anyone can write in: an enquiry from a member of the public the system has never
seen reaches the Front Officer exactly like any other.

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

### One email per case

Every outbound case email — acknowledgement, forward, final response — is sent by
`services/email/caseMail.js` through `services/email/outbox.js`, from **intake, final approval and
the retry buttons alike**. One guard per email, not one per path.

Two rules, and everything else follows from them.

**Nothing about the email comes from the request.** `caseMail` builds each send from the stored
case: the acknowledgement and the final response go to `inquirer.email`, set at intake from the
`From` header and write-once thereafter; the forward goes to the configured Officer-in-Charge; the
body of a response is the `FINAL_APPROVED` `ResponseVersion`; the route is `transportFor
(sourceMailbox)`. A caller names *which case* — never who is written to or what they are told. The
three `/emails/*` endpoints therefore take `{ queryId }` and ignore a body `to`.

**The claim is atomic.** `outbox.dispatchOnce` inserts an `OutboundEmail` row keyed on a unique
`dispatchKey` (`"${emailType}:${queryId}"`). Whoever inserts it sends; everyone else is answered
from the row — `ALREADY_SENT` (200), `IN_PROGRESS` while a three-minute lease is live (409), or, for
a lease that expired mid-send, `UNCERTAIN`. A `FAILED` row can be re-claimed with an atomic
`FAILED → SENDING` flip. There is no read-then-send window, which is what the previous guard had:
four Approve clicks during one twenty-two-second send all read "no response yet" and all proceeded.

`services/email/delivery.js` then classifies any failure as:

- **`NOT_SENT`** — provably never reached the provider (DNS, `ECONNREFUSED`, `EHOSTUNREACH`, TLS,
  any HTTP 4xx, a NICeMail failure before Send). Safe to retry, and one quick retry (~2 s) happens
  automatically for the transient network cases.
- **`UNCERTAIN`** — may have been delivered (HTTP 5xx, `ECONNRESET`, `ETIMEDOUT`, a client timeout,
  a NICeMail send pressed but unconfirmed). **Never retried automatically.**

**No `UNCERTAIN` send settles itself.** `emailService.reconcileDelivery` asks the case's channel and
every channel answers `UNKNOWN`: the legacy Gmail transport's Sent-folder search was the only
implementation of `reconcile` that ever existed, neither NICeMail path can be asked, and the mock has
nothing to say. The seam is kept — the outbox calls it on every uncertain send, and a transport that
could verify its own Sent folder would slot straight in — but today a person answers:
`POST /queries/:queryId/outbound/resolve` records `SENT` (bookkeeping runs as if it had sent; a
final response closes the case) or `NOT_SENT` (unlocks the retry), audited as
`EMAIL_DELIVERY_CONFIRMED` / `EMAIL_DELIVERY_DENIED`. Neither sends anything.

That makes every `UNCERTAIN` dispatch a standing human work item. A case whose final response is
`UNCERTAIN` sits at `READY_FOR_DISPATCH` until somebody looks in the Sent folder and says which it
was, and nothing escalates it on its own.

The `EmailMessage` ids are deterministic (`MSG-ACK-`/`MSG-FWD-`/`MSG-RESP-` + `queryId`), so a crash
between sending and recording self-heals on the next attempt instead of duplicating, and a
bookkeeping failure never turns a sent email into a reported failure. A case that predates the
ledger but already has an outbound message of that type gets a `SENT` row written on first contact,
so old cases are never re-sent.

`npm run db:reset` and `scripts/resetWorkflowState.mjs` clear `outboundemails` along with
everything else — Case IDs restart after a reset, so a stale ledger row would silently suppress the
first email of a new case.

### When the mailbox cannot be read

A provider outage is an outage, not a stream of events. `services/email/mailbox/health.js` holds the
state: the first failure logs once and audits `SYNC_FAILED`, repeats are counted and logged at most
once every five minutes, and recovery logs and audits `SYNC_RECOVERED` with the duration and the
number of attempts. `GET /mailbox/messages` answers **503** with `{ error, retryable: true, sync }`
and `Retry-After: 30` for a transient failure, **502** for an authentication failure, and the state
is repeated on `GET /health`. The UI shows one standing banner rather than one permanent toast per
poll.

For the browser mailbox, a poll triggers a sync at most once every `NIC_BROWSER_SYNC_TTL_MS` and
opens at most `NIC_BROWSER_SYNC_MAX` new messages, because every message read is a real page
interaction in somebody's live mailbox and all of them queue behind the one serialised session.

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
appears in no executable source at all — only in a developer's own `backend/.env.local`, one test
and the docs.

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
`services/email/nic/browser/` — `cdp.js` (the raw DevTools Protocol client; there is no Playwright),
`attach.js` (connect, find the signed-in tab, release), `session.js` (one serialised unit of work),
`selectors.js` (the selector registry), `pageKit.js` (the page-side resolver), `readInbox.js`,
`sendMail.js` and `inspect.js` (the read-only inspector). It is reached by
`npm run nic:browser:discover` and, with `NIC_BROWSER_MAILBOX=true`, by the NICeMail mailbox and
transport [below](#the-second-front-office-mailbox).

**The agent never signs in.** It only attaches over CDP — there is no `launch` anywhere — never
navigates to a login page, never types a credential, never touches an OTP field, and does not import
the credentials module. Reads and sends run in a new background tab of the operator's signed-in
browser context, opened at `NIC_WEBMAIL_APP_URL` (`https://mail.mgovcloud.in/zm/`), and closed
afterwards; the operator's own tab is never driven. That URL matters: on the Workplace front door the
mailbox is a cross-origin iframe with a CDP target of its own, so anything reading the operator's tab
sees only the Workplace shell; opened directly it is one top-level document. If the work tab lands on
anything that looks like a sign-in step, the work stops with `NICeMail session expired` before a field
is touched. What it clicks and types is the inbox and the one outgoing message it was handed — To,
Cc, Subject, body and attachments. Authentication is the operator's job, by hand, and stays that way.

**Selectors live in one registry**, `selectors.js`. Controls the agent clicks or types into are
element entries: strategies tried most semantic first — role and accessible name, `aria-label`,
`title`, `data-testid` / other `data-*` / `id`, text, CSS last — each match checked for visibility,
the expected accessible name and uniqueness, with no visual fallback. Keys in `UNCALIBRATED` are
refused before the page is touched; today that is `ccToggle` and the two attachment-reading keys. The
reading keys and the compose form are calibrated and verified against the live mailbox (the compose
form by `npm run nic:browser:calibrate` and a real test send, 2026-09-22).

It is **lazily loaded**: nothing on the boot path imports it; its modules are evaluated only when the
NICeMail mailbox is first used or a NICeMail case first sends. It needs no automation package — it
speaks CDP over Node's global `WebSocket`, on by default from Node 22 — and `jsdom` is a
devDependency used only by `src/test/nicBrowserPage.test.js`. A missing Chrome session cannot stop the
backend starting. With `NIC_BROWSER_MAILBOX=true` it is, however, in the request
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
> does. `nic:browser:discover` tells those two cases apart by the raw error it prints
> (`ECONNREFUSED` for nothing listening, `CDP endpoint answered HTTP 404` for another program).

#### The second Front Office mailbox

`NIC_BROWSER_MAILBOX=true` (the exact string) turns the NICeMail mailbox into a second Front Office
mailbox, alongside whatever `MAILBOX_SOURCE` selects. It requires `NIC_EMAIL`, distinct from
`FRONT_OFFICE_EMAIL`, and a test recipient while `NIC_ALLOW_OUTBOUND` is closed.
`NIC_BROWSER_VIEWER=true` makes a backend a **viewer** of the mail the mailbox host stored in a
shared database: it lists that mail but never syncs (`sync.viewer: true`, no Sync now), and refuses
NICeMail sends before touching Chrome, so the email is recorded as failed and retried from the host.
These and the other agent variables, with their defaults, are described in
[docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md), under the NICeMail browser agent.

The IMAP settings are not needed. MongoDB is: the mailbox is stored in `MailboxMessage` and answers
503 without it.

- **The Front Office account.** `nicFrontOfficeUser()` in `constants/users.js` adds `USR-0014`,
  role `FRONT_OFFICE`, email `NIC_EMAIL`, signing in with its own credential
  (`QMS_PASSWORD_USR_0014` or its `QMS_PASSWORDS_FILE` entry; outside production the shared
  `QMS_SEED_PASSWORD` also works unless `QMS_ALLOW_SHARED_PASSWORD=false`). Dev login refuses it.
- **Routing by mailbox, not sender.** `mailbox.forUser(user)` gives that user the NICeMail store and
  everyone else the primary one; the mailbox routes cannot be pointed elsewhere with `?recipient=`.
- **Reading.** The server's own timer asks every `MAILBOX_SYNC_INTERVAL_MS` (15 s), so ingestion no
  longer depends on anyone being signed in; listing also starts one when the last is older than
  `NIC_BROWSER_SYNC_TTL_MS`, and `POST /mailbox/sync` starts one on demand. All three go through
  `syncIfDue`, which will not start a sync while an acknowledgement, forward or response is queued —
  a person outranks a timer. The sync
  (`nicBrowserMailbox.sync`) takes as new only the unstored rows above the deepest stored row still
  loaded, opens them oldest first through `readInbox.js`, at most `NIC_BROWSER_SYNC_MAX`, and stores
  each as soon as it is read, keyed on Zoho's message id (`$setOnInsert` under a unique index), never
  resetting a message already ingested or removed. The first sync takes the newest
  `NIC_BROWSER_SYNC_MAX`; the backlog below the cut-off is never opened. A message that cannot be
  read is recorded and retried, and quarantined in this process after three failures; a store error
  stops the read. Listing always answers from MongoDB. A failed sync never throws — it is reported in
  the response's `sync` field and shown on the IPC Mailbox page. Audit rows are written on the edges
  (`SYNC_FAILED`, `SYNC_RECOVERED`) and `SYNC_COMPLETED` only when something happened or the sync was
  manual.
- **Answering.** The accept stores `sourceMailbox: { source: 'nic-browser', address }` on the case.
  All three of its emails — the acknowledgement, the forward to the Officer-in-Charge, the final
  response — and their retries then go out through `nicBrowserTransport.js`, typed into the signed-in
  NICeMail compose form, after the `NIC_ALLOW_OUTBOUND` interlock (`nic/outboundGuard.js`) has
  approved every recipient. `NIC_ALLOW_INTERNAL_FORWARD=true` is what lets the forward through while
  that interlock is closed: it opens exactly `OFFICER_IN_CHARGE_EMAIL`, for the forward alone. See
  [which channel a case's mail goes out through](#which-channel-a-cases-mail-goes-out-through).
- **Checks before Send.** `composeEmail` (`nic/browser/sendMail.js`) refuses, and discards the draft,
  unless the form's From is `NIC_EMAIL`, the To/Cc chips are exactly the intended recipients, and the
  subject, body and every attachment (uploaded and scanned) are held by the form.
- **Confirmation.** A send counts as sent only when the compose form has closed — watched through the
  Send button captured before it was pressed — **and** the message is in the Sent folder: exact
  subject, the recipient on it, an id newer than the press of Send. That Sent row's id is returned as
  `providerMessageId`. If either does not happen within `NIC_BROWSER_TIMEOUT_MS` the send throws with
  `unconfirmed: true` — the outcome is unknown, and a blind retry could reach the inquirer twice — and
  accept and final approval report it as such rather than as a plain failure. There is no
  sent-confirmation selector; one may be added only with a text match proven by
  `npm run nic:browser:discover`.

**Reading and sending work against the live mailbox.** The reading selectors and the compose form in
`nic/browser/selectors.js` are calibrated and verified live. The attachment-reading keys and
`ccToggle` are still in `UNCALIBRATED`, and `providerThreadId` is stored as null. The mailbox has other open items — no scrolling beyond the
~50 rows a fresh agent tab loads, isolation that does not cover accept or the decision routes,
tombstones that live only in MongoDB, and unconfirmed sends the QMS cannot later record. Setup, the
calibration runbooks, troubleshooting and the full list:
[docs/NIC_BROWSER_AGENT.md §17](../docs/NIC_BROWSER_AGENT.md#17-two-front-office-mailboxes).

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

The reference is **[docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md)**: every variable the code reads,
where it is required, its default, and the full table of configurations the server refuses to start
with. A refusal names the variable, and ends with the env file that was loaded.

**Nothing here is a mailbox password.** The NICeMail browser mailbox
(`NIC_BROWSER_MAILBOX=true`) holds no credential at all — it reads and sends through a Chrome
session the operator signed in to by hand, and answers only the cases that arrived in it. The SMTP
path takes an app password, by file for preference. Inquirers are **external**: anyone can send an
enquiry from their own mail client, and they authenticate to nothing here. The Officer-in-Charge is a
**recipient**, addressed by `OFFICER_IN_CHARGE_EMAIL`; nothing ever sends as that role.

**The outbound interlock.** `NIC_ALLOW_OUTBOUND` is a second key on a real government mailbox:
until it is the exact string `true`, every real send is confined to one test recipient and a send to
anyone else is refused before it is attempted — as a configuration error, so it is never retried.
`NIC_ALLOW_INTERNAL_FORWARD=true` opens exactly one more address, `OFFICER_IN_CHARGE_EMAIL`, for the
forward alone, re-derived server-side and never taken from a request. Without it, intake of a
NICeMail case stops at the forward while the interlock is closed. It is a recipient allowance, not a
second channel.

With `EMAIL_TRANSPORT=nic` or `MAILBOX_SOURCE=nic` — and so always in production, where `nic` is the
only transport accepted — boot requires `NIC_EMAIL`, `NIC_IMAP_HOST` and `NIC_SMTP_HOST` (nothing
connects to them at boot, and boot needs no app password). NIC configuration is otherwise *not*
asserted at boot — a deployment that only uses the diagnostic `/nic/*` endpoints starts normally,
and NIC errors surface per-request as a `stage: 'config'` failure. The **browser agent** itself — Chrome, CDP, a signed-in tab — is never asserted at boot
under any configuration and cannot prevent the server starting; the only boot checks it brings are
the `NIC_EMAIL` and test-recipient rules, when `NIC_BROWSER_MAILBOX=true`.

`ATTACHMENT_DIR` is resolved against the **backend package root**, not `process.cwd()`, so a
relative value means the same directory however the process was launched.

`config/env.js` loads **exactly one** env file, resolved against `backend/` rather than
`process.cwd()`, so the choice is the same however the process was launched:

1. `ENV_FILE`, when it is set in the real environment — written inside a file it does nothing. It
   is the only file loaded, and one that does not exist stops the backend.
2. `.env.production`, when `NODE_ENV=production` is set in the real environment. It is never loaded
   otherwise.
3. `.env.local`, the developer's file.
4. A legacy `.env`, which still works but prints
   `[qms] backend/.env is deprecated; rename it to backend/.env.local`.

The file never overrides a variable already set in the environment. Every npm script that reads
configuration, and the live Gemma checks in `src/scripts/`, load through the same module;
`nic:preflight` reads no file. Relative paths *inside* the file are another matter:
`ATTACHMENT_DIR` resolves against `backend/`, but `QMS_PASSWORDS_FILE`, `NIC_APP_PASSWORD_FILE` and
`NIC_BROWSER_ARTIFACT_DIR` resolve against the working directory, so use absolute paths on a server.

The `injected env (N) from .env.local` banner on startup is dotenv v17's own notice, not an error:
it names the file that was loaded, and `N` counts the keys the file supplied — a key already set in
the environment is not counted. When the configuration is refused, the error ends with
`(env file: <path>)`, or `(env file: none)` when no file was found.

## Production deployment

```bash
npm ci                 # exact versions from package-lock.json
export NODE_ENV=production   # in the real environment: this is what selects backend/.env.production
npm start
```

On the production VM, set `NODE_ENV=production` machine-wide rather than per shell, so the service
and the operator scripts (`db:*`, `mailbox:purge`) all select `backend/.env.production` — the
`NODE_ENV` line inside that file cannot select it. Keep that file readable only by the service
account, and never put a `.env.local` on the VM: a process started without `NODE_ENV` would load it.
The hosting layout — the frontend as a Render Static Site that rewrites `/api/*` to this VM — is in
[deployment_strategy.md §11.5](../docs/deployment_strategy.md); the production values are in
[docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md).

What `NODE_ENV=production` changes, beyond the usual:

| | Effect |
|---|---|
| `DATABASE_URL` | unset is now a **startup failure**, not a degraded start (unreachable already is in every environment) |
| `trust proxy` | enabled (one hop), so `secure` cookies and rate-limit keys use the real client address. Behind Render's rewrite **and** the VM's own proxy there are two hops, and one hop keys the rate limiters on a Render address shared by every user — check `req.ip` at first deploy; the follow-up is `app.set('trust proxy', 2)` |
| Error bodies | 5xx returns a generic message; stacks never leave the process |
| morgan | `combined` format rather than `dev` |
| Session cookie | `Secure` is set automatically — the deployment must therefore be HTTPS |

Also required:

- **`CLIENT_URL` must be the exact browser origin of the frontend** (scheme, host and port) — in
  production, the Render site's origin, `https://<render-site>`. CORS is built from this single
  value with credentials enabled, so it cannot be a wildcard — the browser rejects `*` alongside
  credentials. A mismatch here looks like a CORS failure in the console but is a configuration
  error.
- **`SESSION_COOKIE_SAMESITE`**: leave it at `lax`. The frontend reaches the API same-origin, through
  the Render `/api/*` rewrite, so the session cookie is first-party. `none` is only for a genuinely
  cross-site deployment: it forces `Secure`, so it cannot work over plain http, and it breaks the
  text and PDF attachment previews.
- Run behind a reverse proxy terminating TLS. The process listens on `PORT` on all interfaces.
- `SIGTERM` and `SIGINT` are handled: the server stops accepting connections, lets in-flight
  requests finish, closes MongoDB, and exits — with a 10-second cap before it exits anyway. An
  orchestrator's rolling restart will not cut requests mid-flight.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ERR_MODULE_NOT_FOUND: Cannot find package '…'` at startup | `node_modules` is older than `package.json` | `npm install` (or `npm ci`) in `backend/` |
| `DATABASE_URL is required when NODE_ENV=production` | no database configured | set `DATABASE_URL`; the server will not start without it in production |
| `MongoDB is unreachable at DATABASE_URL` | server down, wrong host or password, firewall; on Atlas, this machine's IP missing from the access list. The `MongoDB connection lost — retrying` line before it is not a retry: startup stops | `npm run db:check` names the failing step; on Atlas, check your database user and add your IP |
| `MongoDB is unreachable at DATABASE_URL: querySrv ECONNREFUSED _mongodb._tcp.…` (or `ETIMEOUT`) | the DNS SRV lookup failed on this machine: Node's DNS servers (VPN, DNS filter, router, placeholder IPv6 DNS) refuse it. Atlas never saw a connection | set the adapter DNS to `1.1.1.1`/`8.8.8.8` and `ipconfig /flushdns`, or use the standard `mongodb://` string `npm run db:check` prints |
| `DATABASE_URL must be a mongodb:// or mongodb+srv:// URI that names its database` | the URI has no `/<database>` path | add `/query_management_system` before the `?` |
| `/queries/*` returns 503 | MongoDB not connected: `DATABASE_URL` unset in development, or the connection lost mid-run | set it and restart. A loss mid-run (an Atlas primary election) recovers by itself |
| Reset or `DELETE /mailbox` answers 409 `… refused when DATABASE_URL points at a shared database` | intended: destructive routes are refused on a shared database | use a local MongoDB to start clean |
| Browser reports a CORS failure | `CLIENT_URL` does not match the frontend's actual origin | set it exactly; `http://localhost:5173` ≠ `http://127.0.0.1:5173` |
| 401 on every API call after sign-in | cookie not being sent | check `SESSION_COOKIE_SAMESITE`, and that the frontend uses `withCredentials` (it does by default) |
| `nic:verify` → `Invalid credentials` / `535` | webmail password used instead of an app password | generate one at webmail → Security → App Passwords |
| `nic:preflight` → `mail.gov.in` times out | those endpoints are not reachable from outside NICNET | use the `mgovcloud.in` pair, which is what `.env.example` configures |
| `nic:browser:discover` → `Chrome is not available … (CDP endpoint answered HTTP 404)` (diagnosis `NO_CDP`); a sync → "not a Chrome DevTools endpoint" | another browser holds port 9222 | close it, or set `NIC_CDP_ENDPOINT` to a free port |
| An agent or tool attached to the operator's NICeMail tab sees no mail rows, only `zmbtn__<hash>`-style classes | that tab is the Zoho Workplace shell; the mailbox is a cross-origin iframe with its own CDP target. `nic:browser:discover` reports it as `MAILBOX_IN_OOPIF` | nothing to fix for the QMS agent, which opens `NIC_WEBMAIL_APP_URL` in a tab of its own — [runbook §13](../docs/NIC_BROWSER_AGENT.md#why-an-agent-cannot-see-the-nicemail-elements) |
| A NICeMail acknowledgement or response fails (HTTP 503/504, or the case page's notice) | the error ends in `[stage: <step>; cause: …; seen: …]`: the step the browser agent stopped at, what it ran into, and what the page showed. The backend log has every step as `ACK …` / `RESPONSE …` lines | a failure before `click_send` sent nothing and can be retried once the cause is fixed; from `click_send` on it is unconfirmed — check the NICeMail Sent folder first — [§13](../docs/NIC_BROWSER_AGENT.md#13-troubleshooting), [§17](../docs/NIC_BROWSER_AGENT.md#17-two-front-office-mailboxes) |
| A NICeMail case's acknowledgement or response fails with `… has never been calibrated against the live NICeMail …` | the key it names is in `UNCALIBRATED`; the agent refuses it before touching the page, and nothing is sent. A backend started before 2026-09-22 still has every compose key there | restart the backend; for a key still uncalibrated, calibrate it live — [§17](../docs/NIC_BROWSER_AGENT.md#calibrating-the-selectors) |
| IPC Mailbox shows **The mailbox could not be read** | the last sync failed; `sync.stage` or `sync.error` says why | fix what the stage names — [runbook §13](../docs/NIC_BROWSER_AGENT.md#13-troubleshooting). For a name-resolution failure, see the DNS row below |
| A send "may have been sent but did not confirm it in time" | the mailbox was asked to send and never confirmed; the dispatch is recorded `UNCERTAIN` | check the sending mailbox's **Sent** folder, then answer *It was sent* / *It was not sent* on the case or Dispatch page. **Do not retry first** — that is how a second copy reaches the inquirer |
| `getaddrinfo ENOTFOUND <mail host>` in the log, poll answers 503 | the machine's DNS resolver is failing intermittently — environmental, not a code defect | `nslookup` that host and `ping 8.8.8.8`. The app keeps the last listing on screen, backs off, and audits one `SYNC_FAILED` plus a `SYNC_RECOVERED` when it clears. A send that failed this way is classified `NOT_SENT` and is safe to retry |
| Gemma falls back to the deterministic draft | `GEMMA_API_URL` empty (intended in tests and E2E), or the host unreachable | `GET /health` reports `ai: { configured, lastSuccessAt, lastFailureAt, lastError }`; the log names the real cause (`fetch failed (ENOTFOUND …)`), not a silent fallback |
| Backend refuses to start: `NIC_EMAIL must differ from FRONT_OFFICE_EMAIL …` / `NIC_EMAIL is required …` | `NIC_BROWSER_MAILBOX=true` with a missing or shared address | set `NIC_EMAIL` to the NICeMail mailbox, distinct from `FRONT_OFFICE_EMAIL` |
| Backend refuses to start: `No sign-in credential configured for: …` | an account has neither an entry in `QMS_PASSWORDS_FILE` nor a `QMS_PASSWORD_<ID>` | add it. The message names every account and the variable that would supply it |
| A NICeMail send is refused with a message about the allowed recipient | the outbound interlock is closed and the address is not the test recipient | intended. For the forward to the Officer-in-Charge, set `NIC_ALLOW_INTERNAL_FORWARD=true`; to mail anyone, `NIC_ALLOW_OUTBOUND=true` |

## Tests

59 test files (912 tests) under `src/test/`, run with `npm test` (Vitest 4 + supertest,
`environment: 'node'`).

`support/memoryDb.js` is an in-memory stand-in for the Mongoose models a test replaces. It is not a
convenience: it enforces the **unique and partial-unique indexes** the correctness of this system
rests on — one case per incoming message, one ledger row per case email — and raises a real E11000
on a collision, so the code paths that exist only to handle that error are actually exercised.
Tests that need concurrency (two accepts at once, three approvals at once) run against it.

The harness is pinned so **nothing in the suite touches the network**: `GEMMA_API_URL=''`,
every NIC credential and host blank, `DATABASE_URL=''`, and `NIC_CDP_ENDPOINT` pointed at an
unroutable address on purpose. `setup.js` forces the in-memory mailbox and gives **each test file
its own temp attachment directory** — Vitest runs files concurrently across worker threads, and a
single shared `ATTACHMENT_DIR` caused real cross-file races.

It is also pinned so **the suite does not depend on your `.env.local`.** Under `NODE_ENV=test` the
loader still loads the developer's `backend/.env.local` (or a legacy `.env`), and dotenv only skips
keys already set, so any key `vitest.config.mjs` does not pin comes from the developer's own file.
Every `NIC_BROWSER_*` variable, `NIC_FRONT_OFFICE_NAME`, the `NIC_WEBMAIL_*` patterns and
`NIC_ALLOW_OUTBOUND` are therefore pinned blank — the NICeMail mailbox off and the
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

## Security status: authenticated and case-scoped

### What is enforced

Every endpoint except `GET /api/v1/health` and `POST /api/v1/auth/login` requires a session.
Sign-in posts credentials to `/auth/login`, which returns a JWT in an **httpOnly cookie**
(`qms.session`); `middleware/verifyToken.js` puts the principal on `req.user`, and
`middleware/verifyRole.js` gates each route by role — `verifyRole(...)` for plain role lists,
`verifyAction(...)` for workflow actions via `constants/workflowActions.js`.

The cookie, rather than an `Authorization` header, is what makes attachment preview and
download work: `attachmentUrl()` builds bare URLs for `<img>`, `<iframe>` and `<a download>`,
and those cannot carry a header.

**Case scope, on top of role.** A role allow-list naming every role denies nothing, and every role
legitimately writes through `/queries/persist`, so the substance is per-case membership:

- `services/authz/caseAccess.js` answers one question — which cases is this principal party to.
  Front Office, Officer-in-Charge, Admin and Super Admin see everything; an Assigned Official and a
  Reviewer see only the cases they are on; any other role sees none. `GET /queries` is filtered by
  it.
- `middleware/authorizeCaseDelta.js` guards `POST /queries/persist`, always against state as
  **stored before** the delta. It answers **409** `STALE_CASE` when `baseRevision` is not the case's
  stored `revision`, checks the protected values a role may set, and answers **409** `ID_COLLISION`
  when a row id in the delta is stored under a case the delta does not name, which is what stops a
  foreign row being re-homed onto a case you are entitled to. Both 409s come before the scope check,
  so a stale or colliding write gets a conflict the client reloads on rather than a 403. Only then
  is membership checked for every case the delta touches, including cases reached through a stored
  row rather than named. Membership is never read from the body, because the body writes the very
  fields membership is derived from.
- `middleware/authorizeAttachmentAccess.js` resolves an attachment's owning case — through the
  message it arrived on, when the attachment predates the case — and admits only a principal party to
  it. An attachment with no case yet is readable by its uploader and by the roles that see
  everything, and by nobody else.

All three fail closed: no store means **503**, not a pass, because "cannot tell" must never widen to
"allowed".

Destructive routes are restricted to `SUPER_ADMIN`: `DELETE /api/v1/mailbox` and
`POST /mailbox/receive`, because against a live mailbox they act on somebody's real mail, and
`POST /queries/reset`, because it deletes every case in the system. All three additionally refuse
with **409** when `NODE_ENV=production`, and `DELETE /mailbox` and `POST /queries/reset` also when
`DATABASE_URL` points at a shared database — see [what is not enforced yet](#what-is-not-enforced-yet).

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

Required configuration — the server refuses to start without it: `JWT_SECRET` (≥32 chars), a
credential for every seeded account, and `DATABASE_URL` when `NODE_ENV=production`. The full list is
the boot-refusal table in [docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md).

5xx responses carry a generic `Internal Server Error` outside development. The full message and
stack go to stderr; a Mongoose error naming a collection or a driver error carrying a connection
string is not something to hand a caller.

Both guards fail closed with **401** if `req.user` is absent, so a route mis-wired to omit
`verifyToken` breaks loudly rather than silently allowing access. Every refusal is recorded as an
`AUTHORIZATION_DENIED` audit event.

### What is NOT enforced yet

1. **Workflow-state authorization.** `verifyAction` enforces the role half of the frontend's
   `canPerform(role, action, state)`. The `ACTION_VALID_STATES` half is still client-side, so a
   permitted role is not blocked from acting on a case in the wrong state. `POST /queries/persist`
   validates the *shape* of a transition, not its legality.
2. **Token revocation.** Tokens are stateless; logout clears the cookie but a copied token
   stays valid until it expires (`SESSION_TTL_SECONDS`, default 8h).
3. **Real user provisioning.** Accounts are seeded from `src/constants/users.js`. Each has its own
   credential now, but the directory itself is a constant in source — there is no way to add or
   deactivate an account without a redeploy, and `models/User.js`'s `active` flag is not read by the
   auth path. See [`docs/auth.md`](../docs/auth.md).
4. **Password-less dev login.** `POST /auth/dev-login` answers whenever `NODE_ENV=development` — the
   default when `NODE_ENV` is unset — and the process listens on all interfaces, so anyone who can
   reach the port can sign in as any seeded account. Only the NICeMail Front Office is refused (403,
   audited). Do not run a development-mode backend where untrusted hosts can reach it.
5. **`POST /queries/reset` on a local database.** It deletes every case in the system. It is refused
   under `NODE_ENV=production` and on a shared database; elsewhere `SUPER_ADMIN`-only is the whole of
   its protection.
6. **Mailbox pinning is not complete.** The primary mailbox's `?recipient=` no longer reaches
   NICeMail rows, but its accept still takes a message by id from the request body, and the decision
   routes are not scoped. See
   [docs/NIC_BROWSER_AGENT.md §17](../docs/NIC_BROWSER_AGENT.md#known-limitations--open).

Note also that `constants/capabilities.js` (NIC agent autonomy: read / prepare / send / destructive,
with a `HUMAN_ONLY` set) is covered by `rbac.test.js` but is **not wired into any route's middleware
chain** — it does not currently guard anything.

Until (1) and (2) land, do not expose this server outside a trusted network. The server prints this
same warning on every boot.
