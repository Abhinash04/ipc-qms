# QMS Backend

Node.js + Express 5 API for the Query Management System. **JavaScript only, ES Modules
throughout** (`"type": "module"`) — no TypeScript, no CommonJS.

## What is implemented

26 routes across eight resources: health, auth, emails, mailbox, AI, attachments, NIC and audit.
Session authentication (JWT in an httpOnly cookie) with role-based route guards. MongoDB
persistence for the mailbox and the audit trail, with a working degraded mode when Mongo is absent.
A real LLM integration (Pravah Gemma) grounded in an indexed corpus of IPC guidance documents.
Disk-backed attachment storage with fail-closed resolution on every outbound send.

**Not implemented:** server-side Query Cases. Case state still lives in the browser's IndexedDB,
which is why there is no `/queries` endpoint and why authorization is role-level rather than
case-level (see [Security](#security-status-authenticated-but-not-yet-case-scoped)).

## Setup

```bash
npm install
cp .env.example .env
```

Then set at minimum `JWT_SECRET` (≥32 characters) and `QMS_SEED_PASSWORD` — **the server refuses to
start without them.** Generate a secret with `openssl rand -base64 48`.

## Development

```bash
npm run dev      # nodemon, auto-restart
npm start        # plain node
npm test         # vitest, 33 test files
npm run lint     # eslint
```

Operational scripts:

| Script | Purpose |
|---|---|
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
  app.js          Express assembly: helmet, cors, morgan, json, cookie-parser, /api/v1, notFound, errorHandler
  server.js       Boot: config assertions -> connectDb() -> app.listen()
  config/         env, authConfig, db, nicConfig, browserConfig, identities, officialsMetadata
  constants/      roles/actor types, workflowActions, auditActions, capabilities, httpStatus, users
  controllers/    one per resource (ai, attachment, audit, auth, email, health, mailbox, nic)
  data/           IPC knowledge base + retrieval layer (see below)
  middleware/     verifyToken, verifyRole/verifyAction, authorizeAttachmentAccess, errorHandler, notFound
  models/         Mongoose schemas — AuditEvent.js, MailboxMessage.js
  routes/         index.js mounts eight resource routers under /api/v1
  scripts/        operational + diagnostic CLIs
  services/
    ai/           gemmaService.js — summary, recommendation, draft, question decomposition
    attachments/  policy, disk store, fail-closed resolver, error type
    audit/        auditService.js — record/list/summary, Mongo-or-buffer
    auth/         tokenService.js (stateless JWT), userDirectory.js (seeded accounts)
    email/        emailService.js + transports/, mailbox/, nic/, templates/
  test/           33 *.test.js + setup.js + helpers/
  utils/          (empty — .gitkeep only)
  validators/     (empty — .gitkeep only; request validation is inline in controllers today)
scripts/
  ingestIpcDocs.mjs   build step for src/data/ipcKnowledge.json
storage/
  attachments/        attachment bytes + .json sidecars (gitignored)
```

## API

All routes are mounted under `/api/v1`. Authentication is applied **per route**, never globally.

**Public (3):** `GET /health`, `POST /auth/login`, `POST /auth/logout`. Everything else requires a
valid session cookie.

### Auth
| Method | Path | Guards |
|---|---|---|
| POST | `/auth/login` | public |
| POST | `/auth/logout` | public — must still clear a cookie whose token already expired |
| GET | `/auth/me` | `verifyToken` |

### Emails
| Method | Path | Guards |
|---|---|---|
| GET | `/emails/config` | `verifyToken` |
| POST | `/emails/enquiry` | `verifyRole(INQUIRER, SUPER_ADMIN)` |
| POST | `/emails/acknowledgement` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| POST | `/emails/forward` | `verifyAction(FORWARD)` |
| POST | `/emails/response` | `verifyAction(DISPATCH)` |

### Mailbox
| Method | Path | Guards |
|---|---|---|
| GET | `/mailbox/messages` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| POST | `/mailbox/messages/:messageId/ingested` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| DELETE | `/mailbox/messages/:messageId` | `verifyRole(FRONT_OFFICE, SUPER_ADMIN)` |
| POST | `/mailbox/receive` | `verifyRole(SUPER_ADMIN)` |
| DELETE | `/mailbox` | `verifyRole(SUPER_ADMIN)` |

The two `SUPER_ADMIN` routes are destructive/seeding utilities — under `MAILBOX_SOURCE=gmail` they
operate on a real account.

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

## Database

**MongoDB via Mongoose.** There is no PostgreSQL client in this project — earlier documentation
saying "PostgreSQL-ready" is obsolete.

**The database is optional by design.** `server.js` calls `connectDb().finally(() => app.listen())`,
so the API starts whether or not Mongo is reachable, and `connectDb` returns `false` rather than
throwing. What degrades:

| Subsystem | With Mongo | Without |
|---|---|---|
| Mailbox | `MailboxMessage` collection | in-process `Map`, cleared on restart |
| Audit trail | `auditevents` collection | bounded 5,000-event buffer, `durable: false` |
| Attachments | disk (unaffected) | disk (unaffected) |
| Sessions | stateless JWT (unaffected) | stateless JWT (unaffected) |

Both degraded modes are reported honestly: `mailbox.describe()` and `auditService.describe()` return
their backend and durability, and the admin console surfaces "in-memory — not durable".

**Models:** `AuditEvent` (13 fields, indexed on timestamp/actorType/actorId/action/queryId/messageId;
`action` is deliberately *not* an enum so a new action never fails to record) and `MailboxMessage`
(+ a `Counter` model driving the `MSG-00001` sequence).

## Email pipeline

`services/email/mailbox/index.js` is a duck-typed swap seam: three implementations
(`mockIpcMailbox`, `mongoIpcMailbox`, `gmailInboxReader`) expose the same six functions
(`deliver`, `list`, `markIngested`, `remove`, `reset`, `stats`), and the facade picks one at call
time — forced override, then `MAILBOX_SOURCE=gmail`, then Mongo if connected, else in-memory.
`supportsDelivery()` is false for Gmail, because a real inbox cannot be written into.

`emailService.getTransport` is the second swap: mock vs Gmail, resolved per sender identity via
dynamic `import()` so `googleapis` is never evaluated on the mock path. A role missing its own
refresh token falls back to the mock transport rather than borrowing another account's credentials.

`gmailInboxReader` is read-only — `deliver()` and `reset()` deliberately throw, and `remove()` only
trashes. It constrains the Gmail query to known senders so private mail never becomes a case, and
uses RFC 2183 `Content-Disposition` to tell a real attachment from an inline signature logo.

**Attachments fail closed.** `resolveAttachments` verifies every referenced id, its bytes and its
SHA-256 before any outbound send; an unknown, missing or corrupt attachment throws
`AttachmentUnavailableError` (409) naming every offender. Nothing is ever partially resolved, so a
recipient cannot receive an apparently-complete message with documents silently missing.

## AI grounding layer

`src/data/` is a retrieval layer that grounds every AI answer in real IPC source material:

```
docs/markdown/            IPC guidance & amendment documents  (GITIGNORED)
  |  npm run ingest:ipc  -> scripts/ingestIpcDocs.mjs
src/data/ipcKnowledge.json    22 documents, 412 chunks  (COMMITTED)
  |  retrieveContext() + selectContext()
gemmaService.gatherEvidence() -> per-question evidence -> grounded prompt
```

> **Important for a fresh clone:** `ipcKnowledge.json` is committed, so grounding works out of the
> box. But its source corpus `docs/markdown/` is **gitignored and not in the repository**, so
> `npm run ingest:ipc` cannot be re-run until you obtain those files separately. Source repository:
> `https://iponline.ipc.gov.in/jspui/`.

`gemmaService` never throws. An unset `GEMMA_API_URL` short-circuits before any network call, and
`askGemma` returns `null` on non-2xx, timeout or network error — every path has a deterministic
fallback, and the frontend tells the user when a draft came from the fallback rather than the model.
Draft generation enforces a one-question-one-answer contract.

## Configuration

`.env.example` documents **42 variables** in seven groups: core, authentication, email transport,
stakeholder identities, Gmail OAuth, NICeMail, Pravah Gemma, attachments.

**Boot-blocking** (`process.exit(1)`):

| Variable | Rule |
|---|---|
| `JWT_SECRET` | required, ≥32 characters |
| `QMS_SEED_PASSWORD` | required |
| `EMAIL_TRANSPORT` | must be `mock` or `gmail` |
| `MAILBOX_SOURCE` | must be `auto` or `gmail` |
| `SESSION_COOKIE_SAMESITE` | must be `lax`, `strict` or `none` |
| `GMAIL_CLIENT_ID` / `_SECRET` | required **when** `EMAIL_TRANSPORT=gmail` |
| `GMAIL_REFRESH_TOKEN_*` | at least one required when `EMAIL_TRANSPORT=gmail` |

NIC configuration is *not* asserted at boot — a NIC-less deployment starts normally and NIC errors
surface per-request as a `stage: 'config'` failure.

`ATTACHMENT_DIR` is resolved against the **backend package root**, not `process.cwd()`, so a
relative value means the same directory however the process was launched.

Eight variables are read by code but **not listed in `.env.example`**: `NIC_IMAP_SECURE`,
`NIC_SMTP_SECURE`, `NIC_CDP_ENDPOINT`, `NIC_WEBMAIL_URL_PATTERNS`, `NIC_WEBMAIL_TITLE_PATTERNS`,
`NIC_BROWSER_TEST_RECIPIENT`, `NIC_BROWSER_TIMEOUT_MS`, `NIC_BROWSER_ARTIFACT_DIR`.

## Tests

33 test files under `src/test/`, run with `npm test` (Vitest 4 + supertest, `environment: 'node'`).

The harness is pinned so **nothing in the suite touches the network**: `GEMMA_API_URL=''`,
all Gmail and NIC credentials blank, `DATABASE_URL=''`, and `NIC_CDP_ENDPOINT` pointed at an
unroutable address on purpose. `setup.js` forces the in-memory mailbox and gives **each test file
its own temp attachment directory** — Vitest runs files concurrently across worker threads, and a
single shared `ATTACHMENT_DIR` caused real cross-file races.

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

Destructive mailbox routes (`DELETE /api/v1/mailbox`, `POST /mailbox/receive`) are restricted
to `SUPER_ADMIN`, because under `MAILBOX_SOURCE=gmail` they operate on a real account.

Required configuration — the server refuses to start without them: `JWT_SECRET` (≥32 chars)
and `QMS_SEED_PASSWORD`. See `.env.example`.

Both guards fail closed with **401** if `req.user` is absent, so a route mis-wired to omit
`verifyToken` breaks loudly rather than silently allowing access. Every refusal is recorded as an
`AUTHORIZATION_DENIED` audit event.

### What is NOT enforced yet

1. **Case-level authorization.** Any *authenticated* user can read any attachment by id.
   `authorizeAttachmentAccess` checks only that a session exists, because the server has no
   Query Case records to check ownership against — case state lives in the browser's
   IndexedDB until Phase 2. An Inquirer should reach only their own case's attachments.
2. **Workflow-state authorization.** `verifyAction` enforces the role half of the frontend's
   `canPerform(role, action, state)`. The `ACTION_VALID_STATES` half needs server-side case
   state, so a permitted role is not currently blocked from acting on a case in the wrong
   state.
3. **Token revocation.** Tokens are stateless; logout clears the cookie but a copied token
   stays valid until it expires (`SESSION_TTL_SECONDS`, default 8h).
4. **Real user provisioning.** Accounts are seeded from `src/constants/users.js` and all share
   `QMS_SEED_PASSWORD`. This is a development mechanism, not a user store — replace it with
   per-user credentials before production. See [`docs/auth.md`](../docs/auth.md).

Note also that `constants/capabilities.js` (NIC agent autonomy: read / prepare / send / destructive,
with a `HUMAN_ONLY` set) is covered by `rbac.test.js` but is **not wired into any route's middleware
chain** — it does not currently guard anything.

Until (1) and (2) land, do not expose this server outside a trusted network. The server prints this
same warning on every boot.
