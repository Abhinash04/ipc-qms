# QMS Handoff

Orientation for anyone picking up this repository — how to run it, what is real versus mock, what
is deliberately incomplete, and what to do next.

## Status at a Glance

The full query lifecycle runs end to end against a real backend: authenticated sign-in, Query Cases
persisted in MongoDB, a working email pipeline, a grounded LLM integration, attachments, an audit
trail, and an administration console. The remaining structural gap is **case-level authorization**.

Intake is **N:1 with a human gate**. Anyone may write to the Front Office mailbox from any address;
arriving mail is only *listed*. Nothing is registered until a Front Officer accepts it in the IPC
Mailbox — and only the Front Office mailbox is authenticated, because it is the one account the
system reads from and sends as. With `NIC_BROWSER_MAILBOX=true` a **second Front Office mailbox**,
NICeMail, is read and sent from through a Chrome session the operator signs in to by hand; its
selectors have never been calibrated against the live page, so that path is not yet usable — see
the NIC browser-agent row and [Known Gaps](#known-gaps).

| Area | Status | Notes |
|---|---|---|
| Frontend shell & routing | ✅ Done | Role-namespaced routes (`/<role-slug>/<section>`) generated from the RBAC grant table; nav derived from the same table. |
| Authentication | ✅ Done | `POST /auth/login` → JWT in an httpOnly cookie. `verifyToken` → `verifyRole`/`verifyAction` on the server; `ProtectedRoute` on the client. |
| Backend API | ✅ Done | 36 route registrations across ten routers: health, auth, emails, mailbox, AI, attachments, NIC, audit, queries, pullback. |
| Persistence — server | ✅ Done | MongoDB via Mongoose. **Required in production** — the server exits rather than start unable to store anything. Degrades to memory in development for the mailbox and audit trail only. |
| Persistence — cases | ✅ Done | 13 Mongoose models; the store syncs through `/api/v1/queries`. Cases are shared across users and browsers. |
| Request validation | ✅ Done | Zod schemas on `/queries/*`, `/queries/:id/pullback` and the mailbox decision/accept routes; unknown keys are stripped rather than written. |
| Workflow state-transition engine | ✅ Done | Single-writer `applyTransition` guarantees one audit event per transition; dynamic review levels. |
| Workflow validation | 🟡 Client-side | Role + state enforced centrally in the store. The server enforces the **role** half only — see [Known Gaps](#known-gaps). |
| Email integration | ✅ Done | Enquiry from any external sender → Front Office mailbox → acknowledgement → forward → response dispatched automatically on final approval, on one thread. Three transports selectable by `EMAIL_TRANSPORT`: mock, Gmail, NICeMail SMTP — plus the NICeMail browser transport, chosen per case for cases from the NICeMail mailbox. Only the Front Office mailbox is authenticated. |
| Final approval & dispatch | ✅ Done | **Granting final approval sends the response** — `POST /queries/:queryId/final-approval`, gated `verifyAction(FINAL_APPROVE)`, records the approval, emails the inquirer and closes the case (`FINAL_APPROVAL_GRANTED → RESPONSE_DISPATCHED → QUERY_CLOSED`). The server sends under the Front Office identity it already holds, so **no role gained `DISPATCH`**. The approval is written before any mail is attempted and the case closes only after a send that happened; a failed send stays at `READY_FOR_DISPATCH` with an `EMAIL_SEND_FAILED` row against the case, which the Front Office **Retry sending response** control recovers. A NICeMail send that was pressed but not confirmed is reported `unconfirmed`, and its audit row and Front Office notification say to check the NICeMail Sent folder before retrying. The Dispatch page is otherwise a status view. |
| Intake validation gate | ✅ Done | Arriving mail is listed, never registered. The Front Officer accepts (✓) or rejects (×) each message; reject creates nothing. **Accept is one server call** — `POST /mailbox/messages/:messageId/accept` mints the Case ID atomically, creates the case, records the decision, summarises the enquiry onto the case, acknowledges the sender **and forwards to the Officer-in-Charge**, landing at `PENDING_ASSIGNMENT`. Recorded in `MailboxDecision`; the first decision on a message wins. |
| Attachments | ✅ Done | Upload, preview, download; **fail-closed** forwarding refuses to send if any file cannot be read. |
| AI integration | ✅ Done | Pravah Gemma for summary/recommendation/drafting, grounded in an indexed IPC corpus, with a deterministic fallback the user is told about. The enquiry summary is generated once on accept and **stored** on the case with a `GENERATED` / `FALLBACK` / `FAILED` status, so the covering note and the case say the same thing. |
| Audit trail | ✅ Done | Server-side, queryable, backing the Admin console. The actor is taken from the session, not the request body. Degrades to a bounded in-memory buffer without Mongo. |
| Admin / Super Admin console | ✅ Done | Overview, audit trail, email activity, AI activity, roles; System Settings is Super-Admin-only. |
| Notifications | ✅ Done | Sonner toasts wired to committed outcomes, never to button clicks. |
| Case-level authorization | ❌ Not done | Role-level only. The records to check against now exist — this is unimplemented, no longer blocked. See [Known Gaps](#known-gaps). |
| NIC email — IMAP/SMTP | 🟡 Credential | Endpoints reachable, transport implemented and selectable. Awaiting an application-specific password — see [NIC_EMAIL_PHASE0.md](./NIC_EMAIL_PHASE0.md). |
| NIC email — browser agent | 🟡 Uncalibrated | Attaches to a Chrome session the operator signs in to by hand; lazily loaded, never blocks startup. With `NIC_BROWSER_MAILBOX=true` it is a **second Front Office mailbox**: a Front Office account (`USR-0014`) that signs in as `NIC_EMAIL` with `QMS_SEED_PASSWORD` (dev login refuses it) sees the NICeMail inbox, synced into MongoDB; each case records `sourceMailbox` at accept, server-side, and its acknowledgement, final response and their retries go out through the NICeMail tab, confined to the test recipient until `NIC_ALLOW_OUTBOUND=true`. **The selectors have never been run against the real NICeMail page**, so reading and sending cannot be relied on until `npm run nic:browser:discover` has been used to calibrate them. Open items: [Known Gaps](#known-gaps) 10; runbook [§17](./NIC_BROWSER_AGENT.md#17-two-front-office-mailboxes). |
| Transfer / pullback | 🟡 Gated off | Implemented in the store but disabled pending client answers — see below. |

**Tests:** backend 589 across 44 files, frontend 787 across 42 files, plus a Playwright end-to-end
suite in `frontend/e2e/`. Both unit suites lint-clean; the frontend build passes its bundle budget.

## Getting Started

Run both halves; the frontend needs the backend for sign-in, email, attachments and AI.

```bash
cd backend
npm install
cp .env.example .env
# set JWT_SECRET (>=32 chars) and QMS_SEED_PASSWORD — the server exits without them
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

**MongoDB.** Set `DATABASE_URL` and have a server reachable:

```bash
mongosh "$DATABASE_URL" --eval 'db.runCommand({ping:1})'
```

In development the backend still starts without it — the mailbox and audit trail fall back to memory
and are cleared on restart, which the UI reports rather than hiding. Query Cases have no such
fallback: `/api/v1/queries/*` answers `503` and the UI raises a toast saying changes were not saved.
In production an unset or unreachable `DATABASE_URL` is a startup failure.

**Starting from a clean database.** `cd backend && npm run db:reset` clears the workflow state —
cases, steps, reviews, versions, notifications, email records, the id counters and the audit trail —
and deliberately **keeps `users`**, which is re-seeded from `src/constants/users.js` on every
connect. It is a maintenance tool, not a seed: it inserts nothing, and the next accepted enquiry is
case `00001`. `--dry-run` reports what would go and changes nothing; `--force` is required under
`NODE_ENV=production`, where it otherwise refuses to run. The header **Reset** button does the same
through `POST /queries/reset` and is Super-Admin-only on both sides.

### External prerequisites

Things that must be configured outside this repository. None of them can be fixed in code:

| Prerequisite | Needed for | Symptom when missing |
|---|---|---|
| A reachable MongoDB at `DATABASE_URL` | everything case-related | `503` on `/queries/*`; refusal to start in production |
| A valid Gmail refresh token for the **Front Office mailbox** | `EMAIL_TRANSPORT=gmail` | the server refuses to start; `gmail:preflight` fails. No other role needs one — inquirers are external and nothing sends as the Officer-in-Charge |
| A NICeMail application-specific password | `EMAIL_TRANSPORT=nic`, `nic:verify` | IMAP `Invalid credentials`, SMTP `535`. A webmail password is rejected under MFA by design |
| Network reach to `*.mgovcloud.in:993/465` | NICeMail IMAP/SMTP | `nic:preflight` reports the endpoint as unreachable |
| `NIC_ALLOW_OUTBOUND=true` | NICeMail mail to anyone but the test recipient | the transport refuses the send and names the variable |
| A manually authenticated Chrome exposing CDP on `9222` | the NICeMail browser agent only | `nic:browser:discover` cannot connect; with `NIC_BROWSER_MAILBOX=true` the NICeMail Front Office's inbox shows **NICeMail could not be read**, and sends on NICeMail cases fail before anything is typed. **Never blocks the backend** |

Verify each with the commands in [Verification](#verification).

### Signing in

There is a real login screen. All seeded accounts share `QMS_SEED_PASSWORD` from `backend/.env`.

**[docs/auth.md](./auth.md) is the single source of truth** for the 13 development accounts, their
roles, landing dashboards and section access. One per role:

| Role | Email | Lands on |
|---|---|---|
| SUPER_ADMIN | `admin@ipc.example` | `/super-admin/dashboard` |
| ADMIN | `suresh.gupta@ipc.example` | `/admin/dashboard` |
| FRONT_OFFICE | `bhoomikamakker@gmail.com` | `/front-officer/dashboard` |
| OFFICER_IN_CHARGE | `rawatjatin436@gmail.com` | `/officer-in-charge/dashboard` |
| ASSIGNED_OFFICIAL | `neha.singh@ipc.example` | `/assigned-official/dashboard` |
| REVIEWER | `amit.mehta@ipc.example` | `/reviewer/dashboard` |
| INQUIRER | `abhinash.pritiraj@gmail.com` | `/inquirer/dashboard` |

Development identities only — not real IPC employees.

With `NIC_BROWSER_MAILBOX=true` there is a 14th account: a second `FRONT_OFFICE` (`USR-0014`) whose
sign-in address is the value of `NIC_EMAIL` and whose name is `NIC_FRONT_OFFICE_NAME`. It signs in
with `QMS_SEED_PASSWORD` like the rest, but **dev login refuses it** — its inbox is the live NICeMail
mailbox. See [auth.md](./auth.md).

## Verification

Every check below is safe to run repeatedly. None of them sends mail.

```bash
# Backend — starts clean, connects to MongoDB
cd backend && npm install && npm start

# Both unit suites. Neither touches the network or needs a database.
cd backend  && npm test && npm run lint     # 589 tests, 44 files
cd frontend && npm test && npm run lint     # 787 tests, 42 files

# Frontend production build + bundle budget
cd frontend && npm run build:check

# End-to-end, in a real browser. Unlike the unit suites this DOES need a
# database: a local MongoDB on 127.0.0.1:27017, which the suite uses through
# its own `qms_e2e` database and wipes between specs. One-off first:
#   cd frontend && npx playwright install chromium
# Specs live in frontend/e2e/, the config is frontend/playwright.config.js, and
# the backend settings come from backend/.env.e2e (credential-free and committed
# on purpose; JWT_SECRET and QMS_SEED_PASSWORD still come from backend/.env).
# Playwright starts both servers itself — stop a hand-started backend first, or
# it reuses that one along with whatever database and mail transport it holds.
cd frontend && npx playwright test           # or: npm run test:e2e

# IPC knowledge base — expect "412 chunks from 22 documents (238142 chars)".
# Deterministic: on an unchanged corpus the output file is byte-identical, so
# `git status` should stay clean afterwards.
cd backend && npm run ingest:ipc

# Email credentials. These REPORT; they do not repair.
cd backend
npm run gmail:preflight                     # composes and sends nothing
npm run nic:preflight                       # read-only reachability
npm run nic:preflight -- --email=you@gov.in # adds the authentication check
npm run nic:verify                          # sends one message, test recipient only
npm run nic:browser:discover                # read-only; clicks and types nothing
```

Interpret failures by category before changing anything. `invalid_grant`, `Invalid credentials`,
`535`, an unreachable endpoint and an absent Chrome session are **credential, network and operator
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
3. **The mailbox is a duck-typed seam** — mock, Mongo, Gmail-inbox and NICeMail IMAP implementations
   share one interface, selected at call time, so the same pipeline runs against a real inbox or a
   fake one; the NICeMail browser mailbox implements it too, and is chosen by who is signed in.
4. **AI answers are grounded** — enquiries are decomposed into questions, each matched against an
   indexed corpus of IPC guidance, and the model is given only that evidence; when it is unreachable
   a deterministic draft is produced and the user is told.
5. **Attachments fail closed** — every referenced file is verified (existence, bytes, SHA-256)
   before any outbound send, so a recipient never gets an apparently-complete message with documents
   silently missing.

## What's Real vs Mock

| Real | Mock / local |
|---|---|
| Authentication, sessions, RBAC (both sides) | The user directory (seeded from source, one shared password) |
| Query Cases, workflow steps, reviews, versions (MongoDB) | Divisions and categories (static constants) |
| The audit trail (`/audit`, MongoDB) | Reports page (KPIs are real; charts are not connected) |
| Email send/forward/acknowledge/ingest | `mockAiService` — now the *fallback*, not the primary |
| Gmail transport + inbox reader (when configured) | |
| NICeMail IMAP/SMTP transport (awaiting a credential) | |
| Pravah Gemma summary/recommendation/draft | |
| Attachment storage, preview, download | |

## Known Gaps

1. **Case-level authorization is not enforced.** Any authenticated user can read any attachment by
   id, and `GET /queries` returns every case to every role: `authorizeAttachmentAccess` checks only
   that a session exists. The case records needed to check ownership now exist, so this is
   unimplemented rather than blocked. The backend prints this warning on every boot. **Do not
   expose this server outside a trusted network.**
2. **Workflow-state authorization is half-enforced.** `verifyAction` enforces the role half of
   `canPerform(role, action, state)`. The state half is still evaluated on the client, so
   `POST /queries/persist` validates the *shape* of a transition, not whether the case was in a
   state that allowed it.
3. **Token revocation does not exist.** Logout clears the cookie, but a copied token stays valid
   until it expires (default 8h).
4. **All accounts share one seeded password.** A development mechanism, not a user store. The `User`
   collection is seeded on connect but is **not read for authentication** — `userDirectory.js` still
   answers from `src/constants/users.js`.
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
    - **Selectors are uncalibrated.** Nobody has run the agent against the real NICeMail page, so
      every selector in `selectors.js` is a guess until `npm run nic:browser:discover` has been run
      with the inbox open, a message open and a hand-opened compose window, and `selectors.js`
      adjusted. Until then: the reader may not wait for the clicked message before reading it, and a
      wrong read is stored permanently; the dedupe key is a DOM attribute of the inbox row, which may
      not be NICeMail's own message id; recipients typed into compose are committed with Enter
      (autocomplete) and not checked against the intended list; and the signed-in NICeMail account is
      not checked against `NIC_EMAIL`.
    - **Ingestion.** Each sync inspects at most `NIC_BROWSER_SYNC_MAX` rows and known rows count
      against that budget, so a larger backlog can be missed. Nothing is stored until the whole sync
      finishes. A message whose sender cannot be read is dropped without a trace, though its
      attachments are already in the attachment store, unreferenced. A failed attachment
      download is stored as a null id, and the forward refuses it permanently for that message.
    - **Mailbox isolation is inbox-only.** In Mongo mode the primary Front Office or `SUPER_ADMIN` can
      reach NICeMail messages by id with `?recipient=`, and the decision routes
      (`/mailbox/messages/:id/decision`, `/mailbox/decisions`) are not scoped to a mailbox.
    - **Tombstones.** A NICeMail message's "already handled" memory is its MongoDB row;
      `DELETE /api/v1/mailbox` (when the primary mailbox is the Mongo store), a hard delete or
      `npm run db:reset` removes it, and the next sync reads the message again.
    - **Duplicate acknowledgements.** Two concurrent accepts of the same NICeMail message can both
      pass the acknowledgement check before either records it — the browser queue makes that window
      long — and send two.
    - **Unconfirmed sends.** A send that was pressed but not confirmed cannot be recorded as sent, and
      the flag is not stored on the case. After an unconfirmed accept or approval, the case page's
      acknowledgement notice and the Dispatch page's retry still offer a plain retry; only the
      case's `EMAIL_SEND_FAILED` audit row says it may have gone out. (A retry that itself ends
      unconfirmed is reported as such: 504, with the Sent-folder warning.) There is no control to
      record a send the QMS did not see complete.
    - **Case content is editable by any role.** Any signed-in role can edit a case's inquirer and
      response text through `/queries/persist` — pre-existing (gap 2), but it now decides what an
      official mailbox sends.
    - **Dev login** still signs every other seeded account in without a password whenever
      `NODE_ENV=development` (the default when unset), and the server listens on all interfaces —
      including the primary Front Office, whose inbox may be a real Gmail account under
      `MAILBOX_SOURCE=gmail`. Pre-existing; only the NICeMail Front Office is refused.

## What's Next

- **Case-level authorization** — gaps 1 and 2. The records exist now; what is missing is the
  ownership check in `authorizeAttachmentAccess`, row scoping on `GET /queries`, and moving
  `ACTION_VALID_STATES` server-side. The shape is in
  [architecture/workflow-engine.md](./architecture/workflow-engine.md).
- **Decompose the `/queries` sync API** into per-resource routes — see
  [api/api-plan.md](./api/api-plan.md#still-planned). That is what makes row scoping natural rather
  than bolted on.
- **Per-user credentials** — replace the seeded shared-password directory
  (`backend/src/constants/users.js`) with a real user collection.
- **Client sign-off on the open questions** —
  [srs/14](./srs/14-open-questions-and-client-clarifications.md) still governs transfer/pullback
  rules and SLA definitions.
- **NIC Phase 0** — generate a NICeMail application-specific password and re-run
  `npm run nic:preflight` **from the deployment host**.
- **Calibrate the NICeMail browser selectors** — run `npm run nic:browser:discover` against the live
  mailbox (inbox, open message, hand-opened compose window) and adjust `selectors.js`; then run Test 2
  in [NIC_BROWSER_AGENT.md §17](./NIC_BROWSER_AGENT.md#testing-both-paths). The other open items in
  gap 10 follow from there.

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
