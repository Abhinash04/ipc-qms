# QMS Handoff

Orientation for anyone picking up this repository — how to run it, what is real versus mock, what
is deliberately incomplete, and what to do next.

## Status at a Glance

The full query lifecycle runs end to end against a real backend: authenticated sign-in, Query Cases
persisted in MongoDB, a working email pipeline, a grounded LLM integration, attachments, an audit
trail, and an administration console. Case-level authorization is enforced server-side; the
remaining structural gap is **workflow-state authorization** — the server does not yet check the
state a case was in when somebody acted on it.

Intake is **N:1 with a human gate**. Anyone may write to the Front Office mailbox from any address;
arriving mail is only *listed*. Nothing is registered until a Front Officer accepts it in the IPC
Mailbox — and only the Front Office mailbox is authenticated, because it is the one account the
system reads from and sends as. With `NIC_BROWSER_MAILBOX=true` a **second Front Office mailbox**,
NICeMail, is read and sent from through a Chrome session the operator signs in to by hand. Reading
and composing are calibrated and verified against the live mailbox, and a send counts only once the
message is found in NICeMail's Sent folder — see the NIC browser-agent row and
[Known Gaps](#known-gaps).

| Area | Status | Notes |
|---|---|---|
| Frontend shell & routing | ✅ Done | Role-namespaced routes (`/<role-slug>/<section>`) generated from the RBAC grant table; nav derived from the same table. |
| Authentication | ✅ Done | `POST /auth/login` → JWT in an httpOnly cookie. `verifyToken` → `verifyRole`/`verifyAction` on the server; `ProtectedRoute` on the client. |
| Backend API | ✅ Done | 41 route registrations across ten routers: health, auth, emails, mailbox, AI, attachments, NIC, audit, queries, pullback. |
| Persistence — server | ✅ Done | MongoDB via Mongoose. **Required in production** — the server exits rather than start unable to store anything. A `DATABASE_URL` that is set must name its database and be reachable in every environment. Only with it empty, in development, do the mailbox and audit trail degrade to memory. |
| Persistence — cases | ✅ Done | 14 Mongoose models; the store syncs through `/api/v1/queries`. Cases are shared across users and browsers. The `inquirer` on a case is write-once, and closure and outbound mail records are server-owned: a client delta that writes them is refused with 409. |
| Request validation | ✅ Done | Zod schemas on `/queries/*`, `/queries/:id/pullback` and the mailbox decision/accept routes; unknown keys are stripped rather than written. |
| Workflow state-transition engine | ✅ Done | Single-writer `applyTransition` guarantees one audit event per transition; dynamic review levels. |
| Workflow validation | 🟡 Client-side | Role + state enforced centrally in the store. The server enforces the **role** half and per-case membership; the **state** half is still the client's — see [Known Gaps](#known-gaps). |
| Email integration | ✅ Done | Enquiry from any external sender → Front Office mailbox → acknowledgement → forward → response dispatched automatically on final approval, on one thread. Two transports selectable by `EMAIL_TRANSPORT`: mock and NICeMail SMTP — plus the NICeMail browser transport, chosen per case for cases from the NICeMail mailbox, which carries all three of that case's emails. Only the Front Office mailbox is authenticated. |
| Final approval & dispatch | ✅ Done | **Granting final approval sends the response** — `POST /queries/:queryId/final-approval`, gated `verifyAction(FINAL_APPROVE)`, records the approval, emails the inquirer and closes the case (`FINAL_APPROVAL_GRANTED → RESPONSE_DISPATCHED → QUERY_CLOSED`). The server sends under the Front Office identity it already holds, so **no role gained `DISPATCH`**. The approval is an atomic state flip, so exactly one request records the decision; the send goes through the dispatch ledger, so exactly one email leaves. The approval is written before any mail is attempted and the case closes only after a send that happened; a failed send stays at `READY_FOR_DISPATCH` with an `EMAIL_SEND_FAILED` row, which **Retry sending response** recovers. An unconfirmed send is recorded `UNCERTAIN` and **blocks** the retry in favour of *It was sent* / *It was not sent*. |
| Intake validation gate | ✅ Done | Arriving mail is listed, never registered. The Front Officer accepts (✓) or rejects (×) each message; reject creates nothing. **Accept is one server call** — `POST /mailbox/messages/:messageId/accept` mints the Case ID atomically, creates the case, records the decision, summarises the enquiry onto the case, acknowledges the sender **and forwards to the Officer-in-Charge**, landing at `PENDING_ASSIGNMENT`. Recorded in `MailboxDecision`; the first decision on a message wins. |
| Attachments | ✅ Done | Upload, preview, download; **fail-closed** forwarding refuses to send if any file cannot be read. |
| AI integration | ✅ Done | Pravah Gemma for summary/recommendation/drafting, grounded in an indexed IPC corpus, with a deterministic fallback the user is told about. The enquiry summary is generated once on accept and **stored** on the case with a `GENERATED` / `FALLBACK` / `FAILED` status, so the covering note and the case say the same thing. |
| Audit trail | ✅ Done | Server-side, queryable, backing the Admin console. The actor is taken from the session, not the request body. Degrades to a bounded in-memory buffer when `DATABASE_URL` is empty. |
| Admin / Super Admin console | ✅ Done | Overview, audit trail, email activity, AI activity, roles; System Settings is Super-Admin-only. |
| Notifications | ✅ Done | Sonner toasts wired to committed outcomes, never to button clicks. A provider outage produces **one** standing banner and one toast, not one per poll, and the poll backs off 1 → 2 → 5 minutes while it lasts. |
| Outbound email idempotency | ✅ Done | Every case email — acknowledgement, forward, final response — is claimed in the `outboundemails` ledger under a unique `"${emailType}:${queryId}"` key before it is attempted, from intake, final approval and the retry buttons alike. A failure is classified `NOT_SENT` (safe to retry; one quick automatic retry for transient network errors) or `UNCERTAIN` (never retried automatically). Nothing settles an `UNCERTAIN` send automatically — every channel answers `UNKNOWN` — so a person answers it through `POST /queries/:queryId/outbound/resolve`, audited either way. |
| Case-level authorization | ✅ Done | `services/authz/caseAccess.js` resolves which cases a principal is party to; `GET /queries` is filtered by it, `middleware/authorizeCaseDelta.js` guards `POST /queries/persist` against state as stored **before** the delta, and `middleware/authorizeAttachmentAccess.js` resolves an attachment's owning case and admits only a principal party to it. All three fail closed — no store means 503, not a pass. What is still absent is a server-side workflow state machine: see [Known Gaps](#known-gaps). |
| NIC email — IMAP/SMTP | 🟡 Credential | Endpoints reachable, transport implemented and selectable. Awaiting an application-specific password — see [NIC_EMAIL_PHASE0.md](./NIC_EMAIL_PHASE0.md). |
| NIC email — browser agent | 🟡 Attachments & threads uncalibrated | Attaches over raw CDP to a Chrome session the operator signs in to by hand, and works in a background tab of its own; lazily loaded, never blocks startup. With `NIC_BROWSER_MAILBOX=true` it is a **second Front Office mailbox**: a Front Office account (`USR-0014`) that signs in as `NIC_EMAIL` with a credential of its own (dev login refuses it) sees the NICeMail inbox, synced into MongoDB a message at a time, with search, paging, a message page (sandboxed HTML, attachments, linked case), QMS-local read state and **Sync now**; each case records `sourceMailbox` at accept, server-side, and its acknowledgement, forward to the Officer-in-Charge, final response and their retries all go out through the NICeMail session, confined to the test recipient until `NIC_ALLOW_OUTBOUND=true`. **Reading is calibrated and verified live** with the read-only inspector `npm run nic:browser:discover`. **Composing is calibrated and verified live** (`npm run nic:browser:calibrate` plus one real test send, 2026-09-22). `composeEmail` checks the From account, the recipient chips, the subject and the body before Send. It counts a send only when the form has closed and the message is in the Sent folder. The attachment-reading keys and `ccToggle` stay in `UNCALIBRATED`, which the agent will not use until a live calibration takes them out. Open items: [Known Gaps](#known-gaps) 10; runbooks [§17](./NIC_BROWSER_AGENT.md#17-two-front-office-mailboxes). |
| Transfer / pullback | 🟡 Gated off | Implemented in the store but disabled pending client answers — see below. |

**Tests:** backend 660 across 50 files, frontend 804 across 44 files, plus a Playwright end-to-end
suite in `frontend/e2e/` — `lifecycle`, `mailboxAccept`, `twoInquirers` (two external inquirers
carried through one mailbox, interleaved, to separate closures) and `dispatchIdempotency` (a held
approval request, three concurrent API approvals, and a blocked delivery with its retry). Both unit
suites lint-clean; the frontend build passes its bundle budget.

## Getting Started

Run both halves; the frontend needs the backend for sign-in, email, attachments and AI.

```bash
cd backend
npm install
cp .env.example .env
# set JWT_SECRET (>=32 chars) and a sign-in credential for every account — the server
# exits without them
npm run dev        # http://localhost:5000
```

```bash
cd frontend
npm install
cp .env.example .env
npm run dev        # http://localhost:5173
```

Run `npm install` after every pull that touches `package.json`. The backend imports `compression`,
`mongoose`, `zod` and `express-rate-limit` at module load, so a stale `node_modules` fails at
startup with `ERR_MODULE_NOT_FOUND` rather than degrading. Use `npm ci` on a deployment host.

**MongoDB.** Set `DATABASE_URL` and have a server reachable. The team shares one Atlas database —
connection string, seeding, the mailbox-host and teammate profiles and the rules are in
[README.md, *Shared development database*](../README.md#shared-development-database-mongodb-atlas):

```bash
mongosh "$DATABASE_URL" --eval 'db.runCommand({ping:1})'
```

A `DATABASE_URL` that is set must name its database and be reachable, in every environment, or the
backend exits at startup. Only with it empty, in development, does the backend start without one —
the mailbox and audit trail fall back to memory and are cleared on restart, which the UI reports
rather than hiding. Query Cases have no such fallback: `/api/v1/queries/*` answers `503` and the UI
raises a toast saying changes were not saved. In production an empty `DATABASE_URL` is a startup
failure too.

**Starting from a clean database.** `cd backend && npm run db:reset` clears the workflow state —
cases, steps, reviews, versions, notifications, email records, the id counters and the audit trail —
and deliberately **keeps `users`**, which is re-seeded from `src/constants/users.js` on every
connect. It is a maintenance tool, not a seed: it inserts nothing, and the next accepted enquiry is
case `00001`. `--dry-run` reports what would go and changes nothing; `--force` is required under
`NODE_ENV=production`, and to delete from a shared database, where it otherwise refuses. The header
**Reset** button does the same through `POST /queries/reset` and is Super-Admin-only on both sides;
it answers 409 under `NODE_ENV=production` or on a shared database. **Neither is for the team's
shared database** — start clean on a local MongoDB.

### External prerequisites

Things that must be configured outside this repository. None of them can be fixed in code:

| Prerequisite | Needed for | Symptom when missing |
|---|---|---|
| A reachable MongoDB at `DATABASE_URL`, named in the URI | everything case-related | refusal to start when it is set but unnamed or unreachable, or empty in production; with it empty in development, `503` on `/queries/*` |
| A NICeMail application-specific password | `EMAIL_TRANSPORT=nic`, `nic:verify` | IMAP `Invalid credentials`, SMTP `535`. A webmail password is rejected under MFA by design |
| Network reach to `*.mgovcloud.in:993/465` | NICeMail IMAP/SMTP | `nic:preflight` reports the endpoint as unreachable |
| `NIC_ALLOW_OUTBOUND=true` | NICeMail mail to anyone but the test recipient | the transport refuses the send and names the variable |
| A manually authenticated Chrome exposing CDP on `9222` | the NICeMail browser agent only | `nic:browser:discover` cannot connect; with `NIC_BROWSER_MAILBOX=true` the NICeMail Front Office's inbox shows **The mailbox could not be read**, and sends on NICeMail cases fail before anything is typed. **Never blocks the backend** |

Verify each with the commands in [Verification](#verification).

### Signing in

There is a real login screen. Every account has its **own** password, from `QMS_PASSWORDS_FILE` or
`QMS_PASSWORD_<USER_ID>`; outside production one `QMS_SEED_PASSWORD` still opens all of them unless
`QMS_ALLOW_SHARED_PASSWORD=false`.

**[docs/auth.md](./auth.md) is the single source of truth** for the 12 seeded development accounts,
their roles, landing dashboards and section access. One per role:

| Role | Email | Lands on |
|---|---|---|
| SUPER_ADMIN | `admin@ipc.example` | `/super-admin/dashboard` |
| ADMIN | `suresh.gupta@ipc.example` | `/admin/dashboard` |
| FRONT_OFFICE | `bhumika.makker@ipc.example` | `/front-officer/dashboard` |
| OFFICER_IN_CHARGE | `jatin.rawat@ipc.example` | `/officer-in-charge/dashboard` |
| ASSIGNED_OFFICIAL | `neha.singh@ipc.example` | `/assigned-official/dashboard` |
| REVIEWER | `amit.mehta@ipc.example` | `/reviewer/dashboard` |

Development identities only — not real IPC employees. There is **no `INQUIRER` role**: an inquirer is
a member of the public who emails the Front Office mailbox, is read off the `From` header at intake,
holds no account here and never signs in.

With `NIC_BROWSER_MAILBOX=true` there is a 13th account: a second `FRONT_OFFICE` (`USR-0014`) whose
sign-in address is the value of `NIC_EMAIL` and whose name is `NIC_FRONT_OFFICE_NAME`. It needs a
credential of its own like every other account, but **dev login refuses it** — its inbox is the live
NICeMail mailbox. See [auth.md](./auth.md).

## Verification

Every check below is safe to run repeatedly. None of them sends mail.

```bash
# Backend — starts clean, connects to MongoDB
cd backend && npm install && npm start

# Both unit suites. Neither touches the network or needs a database.
cd backend  && npm test && npm run lint     # 912 tests, 59 files
cd frontend && npm test && npm run lint     # 760 tests, 42 files

# Frontend production build + bundle budget
cd frontend && npm run build:check

# End-to-end, in a real browser. Unlike the unit suites this DOES need a
# database: a local MongoDB on 127.0.0.1:27017, which the suite uses through
# its own `qms_e2e` database and wipes between specs. One-off first:
#   cd frontend && npx playwright install chromium
# Specs live in frontend/e2e/, the config is frontend/playwright.config.js, and
# the backend settings come from backend/.env.e2e (credential-free and committed
# on purpose; sign-in uses the committed per-account fixture it names, and only
# JWT_SECRET is inherited from backend/.env).
# Playwright starts both servers itself and refuses to adopt one it did not
# start: a backend already on :5000 fails the run. Stop it first — that server
# is usually pointed at the real database and a real mailbox. The config also
# refuses to start unless backend/.env.e2e exists and its DATABASE_URL is
# exactly mongodb://127.0.0.1:27017/qms_e2e.
cd frontend && npx playwright test           # or: npm run test:e2e

# IPC knowledge base — expect "412 chunks from 22 documents (238142 chars)".
# Deterministic: on an unchanged corpus the output file is byte-identical, so
# `git status` should stay clean afterwards.
cd backend && npm run ingest:ipc

# Email credentials. These REPORT; they do not repair.
cd backend
npm run nic:preflight                       # read-only reachability
npm run nic:preflight -- --email=you@gov.in # adds the authentication check
npm run nic:verify                          # sends one message, test recipient only
npm run nic:browser:discover                # read-only; clicks and types nothing
```

Interpret failures by category before changing anything. `Invalid credentials`, `535`, an
unreachable endpoint and an absent Chrome session are **credential, network and operator
prerequisites** — the code is not at fault and must not be edited to make the check pass.

## Repository Map

```
frontend/    React 19 + Vite 8 SPA         — frontend/README.md
backend/     Node.js + Express 5 API       — backend/README.md
docs/        This file, plus SRS, architecture, workflow, API — docs/README.md
```

## Architecture in Five Sentences

1. **Routes are generated from the permission table** — a section a role does not hold has no route
   at all, on either side of the app.
2. **`applyTransition` in `useWorkflowStore` is the single writer** for every client-side workflow
   state change, and it always appends exactly one audit event — which is why the audit trail is
   complete and why toasts can be wired to it rather than to buttons; the one path that bypasses it
   is accepting a mailbox message, which runs entirely server-side and is read back with
   `refreshFromServer()`.
3. **The mailbox is a duck-typed seam** — the mock, Mongo and NICeMail IMAP implementations
   share one interface, selected at call time, so the same pipeline runs against a real inbox or a
   fake one; the NICeMail browser mailbox implements it too, and is chosen by who is signed in.
   Going the other way, **every outbound case email is claimed in a ledger before it is sent** — a
   unique key per case and email type — so however many tabs, officers or retries ask for it, the
   inquirer is written to once.
4. **AI answers are grounded** — enquiries are decomposed into questions, each matched against an
   indexed corpus of IPC guidance, and the model is given only that evidence; when it is unreachable
   a deterministic draft is produced and the user is told.
5. **Attachments fail closed** — every referenced file is verified (existence, bytes, SHA-256)
   before any outbound send, so a recipient never gets an apparently-complete message with documents
   silently missing.

## What's Real vs Mock

| Real | Mock / local |
|---|---|
| Authentication, sessions, RBAC (both sides) | The user directory — seeded from a source constant on every connect, so it cannot be changed without a redeploy. Per-account credentials are real, and there *is* a `User` collection, but `$setOnInsert` means an existing row is never refreshed and the `active` flag is not read by the auth path (see gap 4) |
| Query Cases, workflow steps, reviews, versions (MongoDB) | Divisions and categories (static constants) |
| The audit trail (`/audit`, MongoDB) | Reports page (KPIs are real; charts are not connected) |
| Email send/forward/acknowledge/ingest | `mockAiService` — now the *fallback*, not the primary |
| NICeMail IMAP/SMTP transport (awaiting a credential) | |
| Pravah Gemma summary/recommendation/draft | |
| Attachment storage, preview, download | |

## Known Gaps

1. **Case access is enforced, but nothing bounds what a member may write.** Reads are scoped by
   `caseAccess.js`, `/queries/persist` is guarded by `authorizeCaseDelta` and attachments resolve
   their owning case — but a principal party to a case may write any field on it, and the four roles
   whose scope is *everything* (Front Office, Officer-in-Charge, Admin, Super Admin) reach every
   case. The backend prints this warning on every boot. **Do not expose this server outside a
   trusted network.**
2. **Workflow-state authorization is half-enforced.** `verifyAction` enforces the role half of
   `canPerform(role, action, state)`. The state half is still evaluated on the client, so
   `POST /queries/persist` validates the *shape* of a transition, not whether the case was in a
   state that allowed it.
3. **Token revocation does not exist.** Logout clears the cookie, but a copied token stays valid
   until it expires (default 8h).
4. **The user directory lives in source.** Each account has its own credential
   (`QMS_PASSWORDS_FILE` or `QMS_PASSWORD_<USER_ID>`; `QMS_ALLOW_SHARED_PASSWORD=true` restores the
   old one-secret mode, and left unset that mode is on outside production whenever
   `QMS_SEED_PASSWORD` is set) — but the directory itself is a constant. The `User` collection is
   seeded on connect and is **not read for authentication**: `userDirectory.js` answers from
   `src/constants/users.js`, so no account can be added or deactivated without a redeploy.
5. **Transfer and pullback are implemented but gated off.** `transferQuery` and `pullBackQuery`
   exist in the store, but `canPerform` returns `false` for anything listed in
   `CLARIFICATION_REQUIRED_ACTIONS` — they stay disabled until the client answers the questions in
   [srs/14](./srs/14-open-questions-and-client-clarifications.md).
6. **`constants/capabilities.js` is not wired.** The NIC agent capability table is tested but guards
   no route today.
7. **NICeMail authentication has not succeeded.** The `mgovcloud.in` endpoints are reachable and the
   transport is implemented and selectable, but IMAP and SMTP both reject the configured credential.
   Under MFA a webmail password is rejected for IMAP/SMTP by design; an application-specific
   password is required. This is a credential prerequisite, not a defect. See
   [NIC_EMAIL_PHASE0.md](./NIC_EMAIL_PHASE0.md).
8. **The AI corpus source is not in the repo.** `backend/src/data/ipcKnowledge.json` is committed so
   grounding works on a fresh clone with no build step, but `docs/markdown/` — the source it is
   built from — is gitignored by design. `npm run ingest:ipc` is a maintainer step and cannot be
   re-run without obtaining those files separately.
9. **Some dormant code remains**, listed in
   [frontend/README.md](../frontend/README.md#known-dead-code) — `adminService.fetchAuditForQuery`
   and 16 unreferenced shadcn scaffold files.
10. **The NICeMail browser mailbox has open items.** None is fixed; details in
    [NIC_BROWSER_AGENT.md §17](./NIC_BROWSER_AGENT.md#known-limitations--open).
    - **Attachments (reading) and threads are uncalibrated.** Reading the folder tree, the list rows,
      the open message and the read/unread control is calibrated and verified against the live page.
      So is the compose form: runbook C was done on 2026-09-22. The attachment-reading keys and
      `ccToggle` are in `UNCALIBRATED`, and no received attachment has been seen live yet.
      `providerThreadId` is stored as null. Each has a live runbook in §17 (A attachments, B thread
      id). Also open: a read does not check the signed-in NICeMail account against `NIC_EMAIL`
      (a send does).
    - **Ingestion.** A fresh agent tab loads only the newest ~50 rows and nothing scrolls, so mail
      beyond that window after a long downtime is never ingested. A message that fails three times is
      quarantined until the backend restarts. A failed attachment download is stored as a null id,
      and the forward refuses it permanently for that message.
    - **Mailbox isolation does not cover accept or decisions.** The primary Front Office or
      `SUPER_ADMIN` can accept a NICeMail message by id through the primary mailbox, and the decision
      routes (`/mailbox/messages/:id/decision`, `/mailbox/decisions`) are not scoped to a mailbox.
      (`?recipient=` no longer reaches NICeMail rows: the Mongo primary store excludes them.)
    - **Tombstones.** A NICeMail message's "already handled" memory is its MongoDB row;
      `npm run db:reset` removes it, and the next sync reads the message again.
    - ~~**Duplicate acknowledgements.**~~ **Closed.** Two concurrent accepts of the same message
      cannot produce two of anything. The case is guarded by a unique partial index on
      `sourceMailboxMessageId`, so both requests converge on one `queryId`; the acknowledgement and
      the forward are then each claimed once in the `outboundemails` ledger by `dispatchKey`, and the
      loser is answered `ALREADY_SENT` rather than sending. Verified 2026-09-23 against a live
      database: a second accept returned the same Case ID with `created: false` and
      `acknowledgement.outcome: ALREADY_SENT`, leaving one case, one acknowledgement, one forward and
      two ledger rows.
    - **Unconfirmed sends need a person, and nothing chases them.** A send that was pressed but not
      confirmed is recorded `UNCERTAIN` in the ledger, and **no channel can settle it** — the Gmail
      transport's Sent-folder search was the only implementation of `reconcile` that ever existed.
      `POST /queries/:queryId/outbound/resolve` is the control that records the answer, and the case
      page and the Dispatch page both offer it, so "there is no control" is no longer the gap. What
      remains is that nothing escalates: a case whose final response is `UNCERTAIN` sits at
      `READY_FOR_DISPATCH` indefinitely with no alert and no ageing report. It needs an owner and a
      target time to settle.
    - **Case content is editable by anyone party to the case.** The inquirer is write-once and an
      approved version is locked, but the response text is not: any principal the case admits can
      still edit it through `/queries/persist` — pre-existing (gaps 1 and 2), but it now decides what
      an official mailbox sends.
    - **Dev login** still signs every other seeded account in without a password whenever
      `NODE_ENV=development` (the default when unset), and the server listens on all interfaces —
      including the primary Front Office, whose inbox may be a real NICeMail mailbox under
      `MAILBOX_SOURCE=nic`. Pre-existing; only the NICeMail Front Office is refused.

## What's Next

- **Workflow-state enforcement** — gaps 1 and 2. Case scope, the persist guard and attachment
  ownership have landed; what is missing is moving `ACTION_VALID_STATES` server-side, so a permitted
  role cannot act on a case in a state that never allowed it. The shape is in
  [architecture/workflow-engine.md](./architecture/workflow-engine.md).
- **Decompose the `/queries` sync API** into per-resource routes — see
  [api/api-plan.md](./api/api-plan.md#still-planned). That is what makes row scoping natural rather
  than bolted on.
- **A mutable user directory** — replace the source-constant directory
  (`backend/src/constants/users.js`) with a real user collection, so accounts can be added and
  deactivated without a redeploy. Per-account credentials already landed.
- **Client sign-off on the open questions** —
  [srs/14](./srs/14-open-questions-and-client-clarifications.md) still governs transfer/pullback
  rules and SLA definitions.
- **NIC Phase 0** — generate a NICeMail application-specific password and re-run
  `npm run nic:preflight` **from the deployment host**.
- **Finish calibrating the NICeMail browser agent** — the live runbooks in
  [NIC_BROWSER_AGENT.md §17](./NIC_BROWSER_AGENT.md#calibrating-the-selectors):
  A (a test mail with a PDF, a JPG and an `.xml`, for the attachment keys) and B (one reply, for the
  thread id). C (compose) is done. Run Test 2 in [§17](./NIC_BROWSER_AGENT.md#testing-both-paths)
  end to end. The other open items in gap 10 follow
  from there.

## Project History

Condensed, so past decisions are not rediscovered:

1. **Initial Architecture & Foundation** — frontend shell, role-namespaced routing generated from
   the RBAC table, the design system, the documentation set, and a backend health endpoint. The
   backend was migrated from CommonJS to ES Modules so both halves share one module system.
2. **Workflow engine & lifecycle** — the Zustand store with the single-writer `applyTransition`,
   dynamic review levels, and the full email → case → verify → assign → draft → review → approve →
   dispatch → close lifecycle.
3. **Email integration** — mock and Gmail transports, the mailbox facade, the Gmail inbox reader,
   acknowledgement templates, and thread continuity.
4. **AI integration** — Pravah Gemma with per-question decomposition, the IPC knowledge corpus and
   retrieval layer, and deterministic fallbacks on every path.
5. **Attachments** — disk-backed storage with SHA-256 sidecars, the picker/viewer UI, Gmail MIME
   handling, and fail-closed forwarding. A later fix stopped inline signature images being ingested
   as real documents.
6. **Backend authentication & authorization** (Phase 1) — JWT cookie sessions, `verifyToken` /
   `verifyRole` / `verifyAction`, the seeded user directory, and the full frontend auth migration.
7. **Audit trail & administration console** — server-side audit with Mongo-or-buffer degradation,
   the `/audit` API, and the Admin / Super Admin console built strictly on persisted data.
8. **Notifications** — Sonner wired to committed transitions rather than to clicks.

9. **Server-side Query Cases** — the Mongoose models, the `/queries` sync API, and the migration of
   the workflow store off browser-local Dexie/IndexedDB onto the server.
10. **Server-side intake** — the accept sequence moved out of the browser into one call
    (`POST /mailbox/messages/:messageId/accept`), Case IDs minted atomically from `QueryCounter`
    instead of a client-held counter, the forward folded into the accept, and MongoDB made
    authoritative for indexes (`syncIndexes`) and for the id sequence (`$max`, and a 409 on a case
    that already belongs to someone else).
11. **Persistence contracts made honest** — the enquiry summary is generated once on accept and
    written to `QueryCase.aiSummary` with its provenance, instead of being made inside the forward
    and discarded while the audit trail claimed otherwise; `Review.comments` renamed to the
    `comment` the client actually writes, with `responseId`/`version` and nullable
    `stepId`/`reviewerId`; `ResponseVersion` given the `status` lock it was already being checked
    for; `AuditEvent.auditId` added so every event has a stable key; and a 400 from
    `/queries/persist` now names the offending field instead of reading as "Request failed with
    status code 400". The theme throughout: a Zod schema that forgets a field does not reject the
    write, it silently drops the field.

This document is rewritten whenever the implementation moves, and describes the system as it stands
today. Two earlier states it no longer describes, noted so an old screenshot or branch is not
mistaken for the current design: a mock-only prototype with a health-only backend and no
authentication, and the browser-local phase in which Query Cases lived in each user's IndexedDB.
