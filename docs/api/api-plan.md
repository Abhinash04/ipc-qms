# API

The REST surface, split into what exists today and what is still planned. All routes are versioned
under `/api/v1`. For middleware chains, request shapes and error semantics, see
[backend/README.md](../../backend/README.md#api) — that is the authoritative reference; this page is
the planning view.

## Implemented today

36 route registrations across ten resource routers. Only three are public (`GET /health`,
`POST /auth/login`, `POST /auth/logout`); everything else requires a session cookie — except
`POST /auth/dev-login`, which needs none but answers 404 unless `NODE_ENV=development`.

| Resource | Routes | Notes |
|---|---|---|
| `/health` | `GET` | Service liveness. Public. |
| `/auth` | `POST /login`, `POST /logout`, `POST /dev-login`, `GET /me` | JWT in an httpOnly cookie (`qms.session`). `dev-login` signs in a seeded account by email with no password, development only; it refuses the NICeMail Front Office with **403** and audits the attempt as `LOGIN_FAILED` / `denied`. |
| `/emails` | `GET /config`, `POST /enquiry`, `POST /acknowledgement`, `POST /forward`, `POST /response` | Forward and response are gated by `verifyAction(FORWARD\|DISPATCH)`. Forward returns **409** naming any attachment it could not resolve. `POST /response` is now only the Front Office *retry* path — the normal send happens inside final approval, below. Acknowledgement and response send through the mailbox the case came from, read from the **stored** case by `queryId` — never from the body; `/response` accepts an optional `queryId` for this, which the client sends. No `queryId`, no database, no such case, or a case without `sourceMailbox`: `EMAIL_TRANSPORT`. A NICeMail browser send that was pressed but not confirmed answers **504** with the Sent-folder warning and `unconfirmed: true`. |
| `/mailbox` | `GET /messages`, `POST /messages/:id/ingested`, `POST /messages/:id/accept`, `POST /messages/:id/decision`, `GET /decisions`, `DELETE /messages/:id`, `POST /receive`, `DELETE /` | Front Office + Super Admin; the last two are Super-Admin-only destructive/injection utilities. `accept` plus the decision routes are the intake validation gate — see below. For the NICeMail Front Office the message routes act on the NICeMail mailbox — see *The NICeMail mailbox* below. |
| `/ai` | `POST /summary`, `POST /recommend`, `POST /draft` | Any signed-in role. Grounded in the IPC corpus; never throws — falls back deterministically. |
| `/attachments` | `POST /`, `GET /:id/meta`, `GET /:id` | **Top-level, not nested under a query** — see below. |
| `/nic` | `GET /status`, `POST /read`, `POST /send` | Returns HTTP 200 with `{ ok:false, stage, error }` on failure so the caller can tell *where* it failed. |
| `/audit` | `GET /`, `GET /summary`, `GET /query/:queryId` | Admin + Super Admin only. `GET /summary` honours caller `from`/`to` on its `overall` half. |
| `/queries` | `GET /`, `GET /is-empty`, `POST /persist`, `POST /:id/final-approval`, `POST /reset` | The workflow-state sync API — see below — plus one operation that is not a state mirror: final approval, which sends the response and closes the case. `POST /reset` is **Super-Admin-only**; it deletes every case in the system. Bodies are Zod-validated. |
| `/queries/:id/pullback` | `POST` | `verifyAction(PULLBACK)` → Admin + Super Admin. Persists `workflowState` and writes a `QUERY_PULLED_BACK` audit event. |

### Where the shape differs from the original plan

- **Attachments are top-level** (`POST /attachments`, `GET /attachments/:id`), not
  `/queries/:id/attachments`. They have to be addressable by id alone because `attachmentUrl()`
  builds bare URLs for `<img>`, `<iframe>` and `<a download>`, which cannot carry an auth header —
  hence also the cookie rather than a bearer token.
- **Audit is top-level** (`GET /audit`, `/audit/summary`, `/audit/query/:queryId`), not
  `/queries/:id/audit`, because the trail is queried across all cases by the admin console.
- **`/emails` and `/mailbox` were not in the original plan at all** — the email pipeline was
  designed after it was written.
- **`/queries` is a delta-sync API, not a REST resource.** The plan below assumed a conventional
  `GET /queries`, `PATCH /queries/:id`, `POST /queries/:id/assign` surface. What shipped is one
  hydration endpoint and one delta endpoint, because the client already owns a complete workflow
  state machine and commits transitions atomically through it. The REST decomposition is still the
  right destination — see *Still planned*.

### The mailbox validation gate

Arriving mail is listed, never registered. A Query Case exists only because a Front Officer accepted
the message, and these routes are where that judgement is made durable.

| Route | Guards | Purpose |
|---|---|---|
| `POST /mailbox/messages/:messageId/accept` | `verifyToken` + `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` + `validateBody` | The whole intake sequence in one call — see below. |
| `POST /mailbox/messages/:messageId/decision` | `verifyToken` + `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` + schema | Record an `ACCEPTED` or `REJECTED` decision, with the `queryId` on accept, an optional `reason`, and a `from`/`subject`/`receivedAt` snapshot of the message. Now used from the UI for rejections; an accept records its own decision inside the accept call. |
| `GET /mailbox/decisions` | `verifyToken` + `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` | Every decision taken, newest first, so the inbox can show what was accepted or rejected. |

**Accept is one call, and it forwards.** `POST …/accept` mints the Case ID, creates the case,
records the `ACCEPTED` `MailboxDecision`, summarises the enquiry onto `QueryCase.aiSummary`, sends
the acknowledgement to the real sender **and
forwards to the Officer-in-Charge**, so the case lands at `PENDING_ASSIGNMENT`. The body is the
message as the inbox saw it (`from`, `to`, `cc`, `bcc`, `subject`, `body`, `receivedAt`,
`providerMessageId`, `providerThreadId`, `attachments`) — the server does not re-fetch it from the
provider. The exception is the NICeMail mailbox: there the message is already stored server-side, so
the case is built from that record, the body is ignored, and an id not in that mailbox is **404**.
What the body may **not** carry is the actor, the Case ID, the decision or the case's mailbox: those
are the server's to determine. The accept stores `sourceMailbox` — `{ source, address }` of the
signed-in user's mailbox — on the case, and the acknowledgement and final response go out through
it.

The response is
`{ queryId, created, alreadyDecided, acknowledged, forwarded, aiSummaryStatus, errors }`, and it is
**200 even when a step failed**. A case that exists but was not forwarded is a recoverable state; a
500 would hide it and lose the Case ID with it. The client reads `errors` and says which step needs
retrying. An acknowledgement sent through the NICeMail browser whose Send was pressed but not
confirmed is reported as `{ step: 'acknowledgement', unconfirmed: true, error }` and records no
acknowledgement: it may already be in the inquirer's inbox, so the client says to check the NICeMail
Sent folder before retrying rather than to retry. Every failed acknowledgement is also audited as
`EMAIL_SEND_FAILED` against the case, and an unconfirmed one says it may have been sent.

`aiSummaryStatus` is `GENERATED`, `FALLBACK` or `FAILED`, mirroring the `status` inside the stored
`aiSummary` object — a status rather than a boolean, because the model answering and the
deterministic stand-in being used after a timeout are different facts. The summary is written to the
case before the acknowledgement and handed to the forward, so one model call serves both the case and
the covering note; it used to be made inside the forward and thrown away, leaving `aiSummary: null`
on a case whose audit trail said a summary had been generated. Only a `FAILED` summary is
re-attempted on retry, and the audit order is
`QUERY_RECEIVED → QUERY_REGISTERED → AI_SUMMARY_GENERATED → ACKNOWLEDGEMENT_SENT → QUERY_FORWARDED`,
then `EMAIL_CLASSIFIED`.

**Retrying is safe.** There are no cross-document transactions on a standalone MongoDB, so every
step instead checks for its own artefact — the decision, the inbound `EmailMessage`, an
`ACKNOWLEDGEMENT` message, a `FORWARD` message — before acting. Pressing ✓ again finishes what did
not complete and repeats nothing: no second case, no second acknowledgement, no second forward. The
guard is the *recorded* send, so an unconfirmed acknowledgement — never recorded — is sent again by
the next ✓.

**Case IDs are minted server-side and atomically.**
`QueryCounter.findOneAndUpdate({ key: 'counters' }, { $inc: { 'value.QRY': 1 } }, { new, upsert })`,
formatted `QRY-<year>-<5 digits>`. MongoDB serialises the update, so two concurrent accepts get
different numbers. The browser no longer mints ids on this path.

**The first decision on a message wins.** `POST …/decision` is idempotent by construction: the unique
index on `mailboxMessageId` plus `$setOnInsert` makes the first write the only write, so a
double-click, a retried request or two Front Officers looking at the same inbox cannot produce two
cases for one email. The response is `{ decision, alreadyDecided }` — a repeat returns the *stored*
decision with `alreadyDecided: true` rather than deciding again.

Both are recorded as `EMAIL_CLASSIFIED`, with the actor taken from the session and never from the
body — a rejection is as much a handling decision as an acceptance. Both answer **503** when MongoDB
is unreachable: decisions have no in-memory equivalent.

### The NICeMail mailbox

With `NIC_BROWSER_MAILBOX=true` the Front Office user who signs in as `NIC_EMAIL` has the NICeMail
mailbox, read by the browser agent and stored in MongoDB. For that user `GET /mailbox/messages`,
`accept`, `ingested` and `DELETE /messages/:id` act on that mailbox only, and `?recipient=` is
ignored; every other user keeps the `MAILBOX_SOURCE` mailbox. The decision routes are keyed by message
id alone and are **not** scoped to either mailbox.

`GET /mailbox/messages` for that user starts a background sync when one is due and answers from what
is stored, **200 even when the sync failed**. The failure is in a `sync` field that no other
mailbox's response carries:

```text
{ recipient, backend: 'nic-browser', persistence, sync: { ok, at, stored, stage, error, running }, messages }
```

`ok` is `null` before the first sync, `false` after a failed one — `stage` and `error` say where and
why — and the IPC Mailbox page shows a warning when it is `false`. `DELETE /messages/:id` hides a
NICeMail message rather than deleting it, so the next sync cannot bring it back. Without MongoDB these
routes answer **503**. Setup, stages and open items:
[NIC_BROWSER_AGENT.md](../NIC_BROWSER_AGENT.md#17-two-front-office-mailboxes).

### The `/queries` sync API

| Route | Guards | Purpose |
|---|---|---|
| `GET /queries` | `verifyToken` | Hydrate the whole workflow store. Capped at 5,000 rows per collection; names anything it truncated. |
| `GET /queries/is-empty` | `verifyToken` | Has the system any cases at all. |
| `POST /queries/persist` | `verifyToken` + schema | One delta per committed transition. Answers **409** on a Case ID collision — see below. |
| `POST /queries/:queryId/final-approval` | `verifyToken` + `verifyAction(FINAL_APPROVE)` + schema | **Not part of the sync API.** Records the approval, sends the response and closes the case — see below. |
| `POST /queries/reset` | `verifyToken` + `verifyRole(SUPER_ADMIN)` + schema | Deletes every case, step, review, version, notification, email record and the id counter, then inserts whatever the body carries. The UI sends `buildSeedState()`, which is empty, so in practice it inserts nothing. |

Neither read nor `persist` carries a role allow-list, because every signed-in role uses both. The
guard that belongs there is per-case ownership, which is not yet server-side. What *is* enforced:
bodies are validated against Zod schemas that strip undeclared keys, so a caller cannot `$set`
arbitrary fields; and the audit actor is taken from the session and rejected from the request body.

**MongoDB is the system of record, not a mirror of a tab's beliefs.** Two rules on `persist` enforce
that:

- **409 on a Case ID collision.** Every case write is an upsert keyed on `queryId`, so the unique
  index can never fire — a second case minted with the same id would *replace* the first and the
  original enquiry would be gone. `createdAt` is the witness: a genuine update carries the one the
  case was created with, a collision from another tab carries its own. When they differ the request
  is refused with `{ error, queryId }` and the stored case is kept. The email path no longer mints
  client-side, but the in-app **Raise Enquiry** portal path still does, and this guard is what
  protects it.
- **Counters merge with `$max`, never `$set`.** A client reports the counter it believes it holds,
  and that belief goes stale — a second tab, a reload against an empty read, a refused reset. A
  wholesale `$set` let a stale value overwrite the server's and the next case re-issued an id that
  already existed. `$max` per key makes the sequence monotonic, so a lagging client simply has no
  effect.

All five answer **503** — not 500 — when MongoDB is unreachable.

### Final approval, and the response that follows it

`POST /queries/:queryId/final-approval` is one call that does both halves: it records the
Officer-in-Charge's approval, emails the approved response to the inquirer, and closes the case,
writing `FINAL_APPROVAL_GRANTED → RESPONSE_DISPATCHED → QUERY_CLOSED`. The body carries at most an
optional `comment`; who approved, when, and which version are read from the session and the stored
case, never from the caller.

**Why it is a server endpoint rather than two client calls.** The browser used to record the
approval and then call `POST /emails/response` itself. That endpoint is gated on `DISPATCH`, which
belongs to Front Office, and the request carried the approving officer's session — so every approval
ended in a **403**, the case stranded at `READY_FOR_DISPATCH` and the inquirer never answered. The
officer's session authorises `FINAL_APPROVE`, which is theirs; the **server** performs the send under
the Front Office identity it already holds. **No role gained `DISPATCH`** — the permission table is
unchanged.

The response is
`{ queryId, approved, dispatched, alreadyDispatched, workflowState, recipient, errors }`, at **200
even when the send failed**, because an approval that was recorded but not delivered is a real,
recoverable state and a 500 would hide it. **404** for an unknown case, **409** for a case not in an
approvable state, **403** for a role without `FINAL_APPROVE`.

- **The approval is recorded before any mail is attempted**, so a decision a person made survives a
  mail server being down — and the case becomes `CLOSED` only **after** a send that actually
  happened, so it can never read closed while the inquirer heard nothing.
- **A failed send leaves the case at `READY_FOR_DISPATCH`** with an `EMAIL_SEND_FAILED` audit row
  carrying the `queryId` — the transport's own failure rows carry none, so they cannot be traced to
  a case. The Front Office **Retry sending response** control acts on exactly that state; no
  dispatch-failure state was invented.
- **An unconfirmed send is reported as one.** When the response goes through the NICeMail browser
  and Send was pressed but not confirmed in time, the error is
  `{ step: 'dispatch', unconfirmed: true, error }`. The case still stays at `READY_FOR_DISPATCH` —
  `CLOSED` is reserved for a send known to have happened — but the audit row and the Front Office
  notification say the response **may already have gone out** and to check the NICeMail Sent folder
  before retrying, instead of "retry from the case".
- **The response goes out through the case's mailbox** — `sourceMailbox` on the stored case, set at
  accept. A NICeMail case is answered through the NICeMail browser session; every other case through
  `EMAIL_TRANSPORT`.
- **Retrying is safe.** The stored `OUTGOING_RESPONSE` message is the guard: approving twice does
  not email the inquirer twice, and a retry after a failed send completes the send without recording
  a second approval.
- **The recipient is the case's stored `inquirer.email`** — the original sender, read off the `From`
  header at intake. There is no configured recipient anywhere on this path.
- **A transport that silently degrades to the mock is a failure, not a delivery**, unless
  `EMAIL_TRANSPORT=mock` is what the deployment configured; otherwise a missing Front Office
  credential would close cases having sent nothing.

## Still planned

None of these exist: no route, controller, service or collection.

| Resource | Method(s) | Purpose |
|---|---|---|
| `/queries/:id` | `GET`, `PATCH` | Query detail / update as a REST resource, replacing the delta-sync API. |
| `/queries/:id/assign` | `POST` | Assign a query (AI recommendation + human decision). |
| `/queries/:id/transfer` | `POST` | Transfer to another official. Rules **still open** — see [workflow/workflow-rules.md](../workflow/workflow-rules.md). |
| `/queries/:id/workflow` | `GET`, `POST` | Read/advance the dynamic `WorkflowStep[]` — see [architecture/workflow-engine.md](../architecture/workflow-engine.md). |
| `/queries/:id/reviews` | `GET`, `POST` | Read review steps; submit a review decision. |
| `/queries/:id/responses` | `GET`, `POST` | Read/create response versions. |
| `/users` | `GET`, `POST`, `PATCH /:id` | User management. The directory is currently a source-code constant. |
| `/roles` | `GET` | Role / permission reference. |
| `/divisions` | `GET`, `POST`, `PATCH /:id` | Division management. |
| `/notifications` | `GET` | Notifications for the current user, scoped to them rather than delivered in the hydration payload. |
| `/dashboard` | `GET` | Role-specific aggregates, computed server-side instead of from a full hydration. |

### What server-side cases unblocked, and what they did not

Query Cases now persist to MongoDB, so two users see the same cases and the records needed for
ownership checks exist. Two gaps remain, and they are now *unimplemented* rather than *blocked*:

- **case-level authorization** — `authorizeAttachmentAccess` still checks only that a session
  exists, and `GET /queries` still returns every case to every role;
- **workflow-state authorization** — `verifyAction` enforces the role half of
  `canPerform(role, action, state)`; the state half is still evaluated on the client, so
  `POST /queries/persist` validates the shape of a transition rather than its legality.

Decomposing the sync API into the per-resource routes above is what closes both.

## Conventions

- All routes are versioned under `/api/v1`.
- Status codes are centralised in `backend/src/constants/httpStatus.js`: `200` GET success, `201`
  POST success, `400` validation failure, `401` missing/invalid session, `403` role refusal, `404`
  missing resource, `409` unresolvable attachment or a Case ID that already belongs to a different
  case, `500` unexpected failure, `503` MongoDB unreachable.
- Errors are shaped by `middleware/errorHandler.js` as `{ error, ...details }`, with a stack only
  when `NODE_ENV=development`. A `validateBody` rejection puts the offending **field paths** in
  `details` — `{ error, fields: ['auditEvent.event'] }` — and never the values, since a `/queries`
  delta carries case content.
- Request validation is a mix: Zod schemas in `backend/src/validators/` (`mailboxSchemas.js`,
  `queryStateSchemas.js`, `pullbackSchemas.js`) applied through the `validateBody` middleware on the
  mailbox, `/queries` and pullback routes; the remaining controllers still validate inline.
- Server-side mutations record an audit event via `services/audit/auditService.js`; every
  authorization refusal is recorded as `AUTHORIZATION_DENIED`.
