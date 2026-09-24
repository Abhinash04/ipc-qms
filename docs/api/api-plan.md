# API

The REST surface, split into what exists today and what is still planned. All routes are versioned
under `/api/v1`. For middleware chains, request shapes and error semantics, see
[backend/README.md](../../backend/README.md#api) — that is the authoritative reference; this page is
the planning view.

## Implemented today

41 route registrations across ten resource routers. Only three are public (`GET /health`,
`POST /auth/login`, `POST /auth/logout`); everything else requires a session cookie — except
`POST /auth/dev-login`, which needs none but answers 404 unless `NODE_ENV=development`.

| Resource | Routes | Notes |
|---|---|---|
| `/health` | `GET` | Service liveness. Public. |
| `/auth` | `POST /login`, `POST /logout`, `POST /dev-login`, `GET /me` | JWT in an httpOnly cookie (`qms.session`). `dev-login` signs in a seeded account by email with no password, development only; it refuses the NICeMail Front Office with **403** and audits the attempt as `LOGIN_FAILED` / `denied`. |
| `/emails` | `GET /config`, `POST /acknowledgement`, `POST /forward`, `POST /response` | Forward and response are gated by `verifyAction(FORWARD\|DISPATCH)`. There is no `POST /enquiry`: the in-app Raise Enquiry portal it served is gone, and email is the only intake channel. The three case emails take **`{ queryId }` and nothing else**: recipient, subject and body are read from the stored case, and a `to` in the body is ignored — see *One email per case* below. Each answers with an `outcome`: **201** `SENT`, **200** `ALREADY_SENT`, **409** `IN_PROGRESS` or blocked-uncertain, **503** `FAILED` (`retryable: true`), **504** `UNCERTAIN` (`unconfirmed: true`). Forward returns **409** naming any attachment it could not resolve. Without MongoDB they keep the old direct-send path, which is documented as a development convenience — production requires MongoDB. |
| `/mailbox` | `GET /messages`, `GET /messages/:id`, `GET /messages/:id/attachments/:attachmentId`, `POST /messages/:id/read`, `POST /sync`, `POST /messages/:id/ingested`, `POST /messages/:id/accept`, `POST /messages/:id/decision`, `GET /decisions`, `DELETE /messages/:id`, `POST /receive`, `DELETE /` | Front Office + Super Admin; the last two are Super-Admin-only destructive/injection utilities. `accept` plus the decision routes are the intake validation gate — see below. Reading a message, its attachments, its read state and a manual sync are *The message API* below. For the NICeMail Front Office the message routes act on the NICeMail mailbox — see *The NICeMail mailbox* below. |
| `/ai` | `POST /summary`, `POST /recommend`, `POST /draft` | Any signed-in role. Grounded in the IPC corpus; never throws — falls back deterministically. |
| `/attachments` | `POST /`, `GET /:id/meta`, `GET /:id` | **Top-level, not nested under a query** — see below. |
| `/nic` | `GET /status`, `POST /read`, `POST /send` | Returns HTTP 200 with `{ ok:false, stage, error }` on failure so the caller can tell *where* it failed. |
| `/audit` | `GET /`, `GET /summary`, `GET /query/:queryId` | Admin + Super Admin only. `GET /summary` honours caller `from`/`to` on its `overall` half. |
| `/queries` | `GET /`, `GET /is-empty`, `POST /persist`, `POST /:id/final-approval`, `POST /:id/outbound/resolve`, `POST /reset` | The workflow-state sync API — see below — plus two operations that are not state mirrors: final approval, which sends the response and closes the case, and `outbound/resolve`, which records what the Sent folder actually contained for a send nobody could confirm. `POST /reset` is **Super-Admin-only**; it deletes every case in the system, the outbound ledger included. Bodies are Zod-validated. |
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
signed-in user's mailbox — on the case, and **all three** of the case's emails go out through it:
the acknowledgement, the forward to the Officer-in-Charge and the final response. The rule is stated
normatively in
[backend/README.md](../../backend/README.md#which-channel-a-cases-mail-goes-out-through).

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
`QUERY_RECEIVED → QUERY_REGISTERED → CASE_ASSOCIATED → AI_SUMMARY_GENERATED → ACKNOWLEDGEMENT_SENT →
QUERY_FORWARDED`, then `EMAIL_CLASSIFIED`. `CASE_ASSOCIATED` is the one row that ties the mailbox
message (`messageId`) to the case it became (`queryId`); it is written only by the accept that
created the case, so it appears once even when two accepts race.

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
the message API below, `accept`, `ingested` and `DELETE /messages/:id` act on that mailbox only, and
`?recipient=` is ignored; every other user keeps the `MAILBOX_SOURCE` mailbox. The MongoDB primary
store never lists, changes or deletes a NICeMail row (`source: 'nic-browser'`), so `?recipient=` set
to `NIC_EMAIL` no longer reaches them either. The decision routes are keyed by message id alone and
are **not** scoped to either mailbox.

`GET /mailbox/messages` for that user starts a background sync when one is due and answers from what
is stored, **200 even when the sync failed**. The failure is in a `sync` field that no other
mailbox's response carries:

```text
{ recipient, backend: 'nic-browser', persistence,
  sync: { ok, at, stored, stage, error, running, failed, failedMessages, quarantined, remaining },
  messages }
```

`ok` is `null` before the first sync, `false` after a failed one — `stage` and `error` say where and
why, and `stored` how many messages it kept before it stopped — and the IPC Mailbox page shows a
warning when it is `false`. `failed` counts messages that could not be read (at most five are listed
in `failedMessages`), `quarantined` those given up on after three failures, and `remaining` the new
rows left for the next sync. `DELETE /messages/:id` hides a NICeMail message rather than deleting it,
so the next sync cannot bring it back. Without MongoDB these routes answer **503**. Setup, stages and
open items: [NIC_BROWSER_AGENT.md](../NIC_BROWSER_AGENT.md#17-two-front-office-mailboxes).

### The message API

Reading the inbox a message at a time. All under `/api/v1`, `verifyToken` +
`verifyRole(FRONT_OFFICE, SUPER_ADMIN)`, and always on the caller's own mailbox (`resolveMailbox`):
the NICeMail mailbox for its Front Officer, the `MAILBOX_SOURCE` mailbox for everyone else.

| Route | Behaviour |
|---|---|
| `GET /mailbox/messages?unreadOnly&recipient&q&limit&offset` | **List.** The envelope is unchanged; `total`, `limit` and `offset` are added only when `limit` is given, so a request without one still gets everything. `q` (at most 200 characters, regex-escaped) searches `from`, `subject` and `body`, case-insensitively. `limit` is 1–200. An invalid query string is **400** naming the fields. Each message is the stored document **without** `bodyHtml`, plus `toAddresses` (falling back to `[to]`), `isRead` (`true`/`false`, or `null` for a mailbox that keeps no read state), `status` (`NEW` / `READ` / `ACCEPTED` / `REJECTED`, derived, never stored), `linkedCase` (`{ queryId, workflowState, businessStatus }` or `null`) and `createdAt` (or `null`). |
| `GET /mailbox/messages/:id` | **Detail.** The same view plus `bodyHtml`. **404** `{ error, messageId }` when it is not in the caller's mailbox. |
| `GET /mailbox/messages/:id/attachments/:attachmentId[?download=1]` | **Download, scoped to the message.** The attachment must be on that message, in the caller's mailbox, before a byte is read — otherwise **404**. Same headers as `GET /attachments/:id`; audited `ATTACHMENT_DOWNLOADED` with the `messageId`. |
| `POST /mailbox/messages/:id/read` | **Mark read.** QMS state only: NICeMail's own read state is never touched. **200** with the view; idempotent, and only the first call writes `EMAIL_MARKED_READ`. **409** for a mailbox that keeps no read state (every one but NICeMail's), **404** for an unknown id. |
| `POST /mailbox/sync` | **Manual sync.** For the NICeMail mailbox, **202** `{ supported: true, started, sync }`, with `started: false` while a sync is running or within 15 s of the last one; a start is audited `SYNC_STARTED` with the person who asked. For every other mailbox, **200** `{ supported: false, started: false, sync }` — its polls already read the provider. **503** without MongoDB. |

**`unreadOnly` is not `isRead`.** `?unreadOnly=true` keeps its old meaning — messages the Front
Office has not yet handled (`ingested: false`), which the IPC Mailbox shows as **Awaiting
validation** — and has nothing to do with whether anyone has opened the message. `isRead` is that:
set by `POST …/read`, kept only by the NICeMail mailbox, and `null` elsewhere, meaning unknown rather
than unread. Filtering on one to mean the other shows the wrong messages.

### The `/queries` sync API

| Route | Guards | Purpose |
|---|---|---|
| `GET /queries` | `verifyToken` | Hydrate the whole workflow store. Capped at 5,000 rows per collection; names anything it truncated. |
| `GET /queries/is-empty` | `verifyToken` | Has the system any cases at all. |
| `POST /queries/persist` | `verifyToken` + schema | One delta per committed transition. Answers **409** on a Case ID collision — see below. |
| `POST /queries/:queryId/final-approval` | `verifyToken` + `verifyAction(FINAL_APPROVE)` + schema | **Not part of the sync API.** Records the approval, sends the response and closes the case — see below. |
| `POST /queries/:queryId/outbound/resolve` | `verifyToken` + `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` + schema | **Not part of the sync API.** Body `{ emailType, outcome }` where `outcome` is `SENT` or `NOT_SENT`. Records what a person found in the sending mailbox's Sent folder for an `UNCERTAIN` send. **Sends nothing.** |
| `POST /queries/reset` | `verifyToken` + `verifyRole(SUPER_ADMIN)` + schema | Deletes every case, step, review, version, notification, email record and the id counter, then inserts whatever the body carries. The UI sends `buildSeedState()`, which is empty, so in practice it inserts nothing. |

Neither read nor `persist` carries a role allow-list, because every signed-in role uses both — an
allow-list naming every role denies nothing. The guard that belongs there is per-case ownership, and
it **is** server-side: `GET /queries` is filtered by `services/authz/caseAccess.js`, and
`POST /queries/persist` runs `middleware/authorizeCaseDelta.js`, which checks both the protected
values the role may set and membership of every case the delta touches — against state as stored
*before* the delta, never from the body, because the body writes the very fields membership is derived
from. Four roles see every case (Front Office, Officer-in-Charge, Admin, Super Admin); the Assigned
Official and the Reviewer see only the cases they are party to; any other role sees none. With no
store reachable both fail closed with 503.

Also enforced: bodies are validated against Zod schemas that strip undeclared keys, so a caller cannot
`$set` arbitrary fields; and the audit actor is taken from the session and rejected from the request
body.

**MongoDB is the system of record, not a mirror of a tab's beliefs.** Four rules on `persist` enforce
that:

- **409 on a Case ID collision.** Every case write is an upsert keyed on `queryId`, so the unique
  index can never fire — a second case minted with the same id would *replace* the first and the
  original enquiry would be gone. `createdAt` is the witness: a genuine update carries the one the
  case was created with, a collision from another tab carries its own. When they differ the request
  is refused with `{ error, queryId }` and the stored case is kept. Nothing mints a Case ID
  client-side any more — intake is one server call, and the in-app Raise Enquiry portal that was the
  other channel is gone — so this is now a backstop. It is kept because the failure it prevents is a
  silently lost enquiry.
- **Counters merge with `$max`, never `$set`.** A client reports the counter it believes it holds,
  and that belief goes stale — a second tab, a reload against an empty read, a refused reset. A
  wholesale `$set` let a stale value overwrite the server's and the next case re-issued an id that
  already existed. `$max` per key makes the sequence monotonic, so a lagging client simply has no
  effect.
- **The inquirer is write-once.** `inquirer` is written with `$setOnInsert`, so the address read off
  the `From` header at intake cannot be replaced by a later delta. It is the address every
  acknowledgement and every final response goes to; a client able to change it is a client able to
  send one inquirer's answer to another.
- **Closure and outbound mail are server-owned.** A delta that moves a case to `DISPATCHED` or
  `CLOSED`, or that writes an outbound `ACKNOWLEDGEMENT`, `FORWARD` or `OUTGOING_RESPONSE`
  `EmailMessage`, is refused with **409**. Those rows exist only where the email is actually sent.
  A browser that closed a case on a send it made itself is how a case came to read `CLOSED` while
  the inquirer had received nothing.

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
- **An unconfirmed send is reported as one.** When the mailbox was asked to send and never confirmed
  it, the error is `{ step: 'dispatch', outcome: 'UNCERTAIN', unconfirmed: true, error }` and the
  dispatch is recorded `UNCERTAIN`. The case still stays at `READY_FOR_DISPATCH` — `CLOSED` is
  reserved for a send known to have happened — and the Dispatch page replaces "retry" with the two
  answers a look in the Sent folder produces. Nothing makes that check for you; see *One email per
  case* below.
- **The response goes out through the case's mailbox** — `sourceMailbox` on the stored case, set at
  accept. A NICeMail case is answered through the NICeMail browser session; every other case through
  `EMAIL_TRANSPORT`.
- **Approving twice cannot answer twice.** Two things make that true, and both are needed. The
  approval itself is an atomic `findOneAndUpdate` out of the approvable states, so exactly one
  request writes `FINAL_APPROVAL_GRANTED`; and the send goes through the dispatch ledger, whose
  unique key means the second request is told `ALREADY_SENT` rather than sending. A retry after a
  failed send completes the send without recording a second approval. The previous guard — reading
  whether an `OUTGOING_RESPONSE` existed, and then sending — had a window between the two, and four
  clicks during one slow send all passed through it.
- **The recipient is the case's stored `inquirer.email`** — the original sender, read off the `From`
  header at intake. There is no configured recipient anywhere on this path.
- **A transport that silently degrades to the mock is a failure, not a delivery**, unless
  `EMAIL_TRANSPORT=mock` is what the deployment configured; otherwise a missing Front Office
  credential would close cases having sent nothing.

### One email per case: the outbound dispatch ledger

Every outbound case email — acknowledgement, forward, final response — goes through one place,
`services/email/outbox.js`, and is recorded in the `outboundemails` collection before it is
attempted. The key is unique: `dispatchKey = "${emailType}:${queryId}"`. That uniqueness **is** the
guard; there is no read-then-send window for a second request to slip through.

A request either **claims** the dispatch or is answered from the record:

| Record | Answer | HTTP |
|---|---|---|
| none, or `FAILED` | claimed — this request sends | `201` / `503` on the result |
| `SENT` | `ALREADY_SENT` | **200** |
| `SENDING`, lease live (3 min) | `IN_PROGRESS` | **409** |
| `SENDING`, lease expired | promoted to `UNCERTAIN`, then as below | — |
| `UNCERTAIN` | reconciled; if still unknown, `BLOCKED_UNCERTAIN` | **409** |

**A failure is classified, not merely reported.** `services/email/delivery.js` sorts every error into
`NOT_SENT` or `UNCERTAIN`:

- **`NOT_SENT`** — the request provably never reached the provider: DNS (`ENOTFOUND`, `EAI_AGAIN`),
  `ECONNREFUSED`, `EHOSTUNREACH`, `ENETUNREACH`, TLS failures, any HTTP **4xx**, a NICeMail failure
  before Send was pressed. Retrying is safe, and one quick retry (~2 s) happens automatically inside
  the same request for the transient network cases.
- **`UNCERTAIN`** — the request may have been delivered and the answer was lost: HTTP **5xx**,
  `ECONNRESET`, `ETIMEDOUT`, a client timeout, a NICeMail send pressed but not confirmed. **No
  automatic retry**, because a retry can put a second copy in the inquirer's inbox.

**No uncertain send settles itself.** `emailService.reconcileDelivery` asks the case's channel on
every uncertain send, and every channel answers `UNKNOWN`. The legacy Gmail transport's Sent-folder
search — `in:sent rfc822msgid:<id>`, falling back to `in:sent to:<recipient> after:<epoch>` with an
exact `Subject` and `Message-ID` comparison, and a 60-second settle window before it would say
`NOT_SENT` — was the only implementation of `reconcile` that ever existed, and it went with Gmail.
Neither NICeMail path can be asked and the mock has nothing to say. The seam is kept because a
transport able to verify its own Sent folder would slot straight in.

**Every uncertain send is therefore settled by a person.** An `UNCERTAIN` dispatch blocks the retry and
the UI asks instead for the Sent folder to be checked, offering two answers:
`POST /queries/:queryId/outbound/resolve` with `outcome: "SENT"` records it exactly as a successful
send would — for a final response, that closes the case — and `outcome: "NOT_SENT"` marks it
`FAILED`, which unlocks the retry. Either is audited (`EMAIL_DELIVERY_CONFIRMED` /
`EMAIL_DELIVERY_DENIED`) with the actor who answered. **Neither sends anything.**

Two further properties:

- **Bookkeeping is idempotent and separate from delivery.** The `EmailMessage` ids are deterministic
  (`MSG-ACK-`, `MSG-FWD-`, `MSG-RESP-` + `queryId`), so re-running them after a crash between send
  and record self-heals rather than duplicating. A bookkeeping error never turns a sent email into
  a failure.
- **Cases that predate the ledger are never re-sent.** A case with an existing outbound
  `EmailMessage` of that type but no ledger row gets one written as `SENT` on first contact.

### Polling the mailbox through an outage

`GET /mailbox/messages` no longer answers **500** when the provider cannot be reached. A transient
network failure, a 5xx or a 429 answers **503** with
`{ error, retryable: true, sync: { ok: false, since, failures } }` and a `Retry-After: 30` header; a
rejected credential is different in kind — retrying will not fix it — so it answers **502** with
`retryable: false` and says what to re-authenticate. The outage itself is tracked in
`services/email/mailbox/health.js`: the **first** failure logs once and writes one `SYNC_FAILED` audit
row, repeats are counted and logged at most once every five minutes, and recovery logs and writes
`SYNC_RECOVERED` with the duration and the number of attempts. The state is exposed as `sync` on the
listing and on `GET /health`.

The read path is kept cheap enough to fail safely. For the NICeMail browser mailbox a poll triggers a
sync at most once every `NIC_BROWSER_SYNC_TTL_MS` and opens at most `NIC_BROWSER_SYNC_MAX` new
messages, because every message read is a real page interaction in somebody's live mailbox and all of
them queue behind the one serialised session. The lesson came from the Gmail reader that preceded it,
whose poll was one list plus up to 25 parallel gets with no timeout — during a DNS outage, 26 separate
ten-second lookups per poll.

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

Query Cases persist to MongoDB, so two users see the same cases and the records needed for ownership
checks exist. **Case-level authorization has landed on top of them**: `services/authz/caseAccess.js`
filters `GET /queries` to the cases a principal is party to, `middleware/authorizeCaseDelta.js` guards
`POST /queries/persist` against state as stored before the delta, and
`middleware/authorizeAttachmentAccess.js` resolves an attachment's owning case. All three fail closed
with 503 rather than passing when they cannot tell.

One gap remains, *unimplemented* rather than *blocked*:

- **workflow-state authorization** — `verifyAction` enforces the role half of
  `canPerform(role, action, state)`; the state half is still evaluated on the client, so
  `POST /queries/persist` validates the shape of a transition rather than its legality, and a
  principal party to a case may write any field on it.

Decomposing the sync API into the per-resource routes above is what closes it.

## Conventions

- All routes are versioned under `/api/v1`.
- Status codes are centralised in `backend/src/constants/httpStatus.js`: `200` GET success, `201`
  POST success, `202` a background mailbox sync accepted, `400` validation failure, `401`
  missing/invalid session, `403` role refusal, `404` missing resource, `409` unresolvable attachment,
  a Case ID that already belongs to a different case, or a read mark on a mailbox that keeps no read
  state, `500` unexpected failure, `503` MongoDB unreachable.
- Errors are shaped by `middleware/errorHandler.js` as `{ error, ...details }`, with a stack only
  when `NODE_ENV=development`. A `validateBody` rejection puts the offending **field paths** in
  `details` — `{ error, fields: ['auditEvent.event'] }` — and never the values, since a `/queries`
  delta carries case content.
- Request validation is a mix: Zod schemas in `backend/src/validators/` (`mailboxSchemas.js`,
  `queryStateSchemas.js`, `pullbackSchemas.js`) applied through the `validateBody` middleware on the
  mailbox, `/queries` and pullback routes, and through `validateQuery` on the query string of
  `GET /mailbox/messages` — it writes `req.validatedQuery`, because `req.query` is a read-only getter
  in Express 5; the remaining controllers still validate inline.
- Server-side mutations record an audit event via `services/audit/auditService.js`; every
  authorization refusal is recorded as `AUTHORIZATION_DENIED`.
