# Query Management System (QMS)

## Purpose

QMS manages incoming query emails for an IPC client, end to end: receipt, Front Office
validation, AI-assisted assignment, AI-assisted drafting, dynamic multi-level review, final
Officer-in-Charge approval, response dispatch, and closure — with a complete audit trail
throughout.

Intake is **many-to-one**: any member of the public can email the Front Office mailbox from their
own mail client, holding no account here. Arriving mail is listed, not registered — a Front Officer
accepts or rejects each message, and only an accepted one becomes a Query Case.

Optionally (`NIC_BROWSER_MAILBOX=true`) a NICeMail mailbox, read by the browser agent, is a second
Front Office mailbox with its own Front Officer. Each Front Officer sees only their own mailbox, and
all three of a case's emails — the acknowledgement, the forward to the Officer-in-Charge and the
final response — go out through the mailbox it arrived in. See
[which channel a case's mail goes out through](backend/README.md#which-channel-a-cases-mail-goes-out-through).

```
many external inquirers ──> the Front Office mailbox ──> Front Officer validates
                                                              │
                                                    ┌─────────┴─────────┐
                                                  accept              reject
                                                    │                   │
                                       ONE server call:            decision only
                                       Case + Case ID           (no case, no email)
                                       + acknowledgement
                                       + forward to the OIC
                                                    │
                                                    └──────> AI recommendation
                                                        ──> assignment
                                                        ──> review
                                                        ──> final approval
                                                              │
                                                    ONE server call:
                                                    approval recorded
                                                    + response emailed
                                                    + case CLOSED
```

Accepting is a single click and a single request: the server mints the Case ID, creates the case,
summarises the enquiry onto it, acknowledges whoever wrote in and forwards the enquiry — with that
same summary in the covering note — to the Officer-in-Charge, leaving the case at
`PENDING_ASSIGNMENT`.

Closing is the same shape at the other end. Granting final approval is one request: the server
records the Officer-in-Charge's decision, emails the approved response to whoever wrote in, and
closes the case. Nobody presses send — the Front Office Dispatch page is a status view with a retry
for the send that did not complete.

## Current State

The full query lifecycle runs end to end, with Query Cases persisted server-side in MongoDB.
Implemented and working:

- **Authentication** — sign-in against seeded accounts, JWT in an httpOnly cookie, role-based route
  guards on both halves of the app.
- **Query Case storage** — cases, workflow steps, reviews, response versions, notifications and the
  email record persist to MongoDB through `/api/v1/queries`. Case state is shared across browsers
  and users, not per-device.
- **Email pipeline** — enquiry → IPC mailbox → **Front Office accepts or rejects** → acknowledgement
  and forward to the Officer-in-Charge, both in the accept → response dispatched automatically on
  final approval, on one thread. Two transports: mock and NICeMail SMTP — plus, for cases
  from the optional NICeMail browser mailbox, that mailbox's signed-in browser session. Only Front
  Office mailboxes are authenticated; nothing sends as an inquirer or the Officer-in-Charge. Case IDs are minted server-side and atomically, so two tabs cannot
  produce the same one.
- **AI** — Pravah Gemma for summary, assignee recommendation and drafting, grounded in an indexed
  corpus of IPC guidance documents, with a deterministic fallback when the model is unreachable.
- **Attachments** — upload, preview, download, and fail-closed forwarding that refuses to send if
  any referenced file cannot be read.
- **Workflow engine** — dynamic review levels, validated centrally, with one audit event per
  transition guaranteed by a single-writer store.
- **Audit trail** — server-side, queryable, with the actor taken from the session rather than the
  request body, backing an Admin / Super Admin console.
- **Notifications** — toasts wired to committed outcomes, not to button clicks.

**Case-level authorization is server-side.** `GET /queries` is filtered to the cases a principal may
see, `POST /queries/persist` is guarded by `authorizeCaseDelta`, and an attachment is admitted only
against the case it belongs to. The scope depends on the role: the Front Office, Officer-in-Charge,
Admin and Super Admin see every case, because the job requires it; an Assigned Official and a Reviewer
see only the cases they are party to; any other role sees none. All three guards answer 503 rather
than passing when the store is unreachable.

**The remaining gap:** the workflow *state* half of `canPerform` is still enforced on the client —
the server validates the shape of a transition, who may attempt it and that the caller is party to
the case, but not whether the case was in a state that allowed it. See
[docs/HANDOFF.md](docs/HANDOFF.md) for the full status table.

Where a client decision is genuinely still open — transfer/pullback rules, SLA definitions — it
remains recorded in
[docs/srs/14-open-questions-and-client-clarifications.md](docs/srs/14-open-questions-and-client-clarifications.md).

## Technology Stack

**Frontend**: React 19, Vite 8, JavaScript/JSX, Tailwind CSS v4, React Router 7, Zustand,
TanStack Query, Axios, Sonner, Lucide React, Framer Motion.

**Backend**: Node.js, Express 5, **MongoDB via Mongoose**, Zod (request validation),
express-rate-limit, jsonwebtoken, bcryptjs, cookie-parser, multer, nodemailer, imapflow, mailparser,
helmet, cors, compression, morgan, dotenv. The NICeMail browser agent needs no automation package —
it speaks the Chrome DevTools Protocol over Node's global `WebSocket`.

**Testing**: Vitest on both sides — 589 backend tests across 44 files (supertest), 787 frontend
tests across 42 files (Testing Library). Neither suite touches the network or requires a database.
Playwright drives the end-to-end suite in `frontend/e2e/`, which does need a local MongoDB — see
[docs/HANDOFF.md](docs/HANDOFF.md#verification).

JavaScript only — no TypeScript anywhere in this repository.

## Repository Structure

```
ipc-qms/
├── frontend/    React + Vite SPA          — see frontend/README.md
├── backend/     Express API               — see backend/README.md
├── docs/        SRS, architecture, workflow, API, handoff — see docs/README.md
└── README.md
```

## Setup

Run both halves. The frontend needs the backend for sign-in, email, attachments and AI.

### Backend

```bash
cd backend
npm install
cp .env.example .env.local
# set JWT_SECRET (>=32 chars) and a sign-in credential for every account — the server
# will not start without them — and DATABASE_URL (see "Shared development database").
# Every variable is described in docs/ENVIRONMENT.md
npm run dev        # http://localhost:5000
```

> `npm install` is not optional after pulling. The backend imports `compression`, `mongoose`, `zod`
> and `express-rate-limit`; a stale `node_modules` fails at startup with
> `ERR_MODULE_NOT_FOUND`. On a deployment host prefer `npm ci`, which installs exactly what
> `package-lock.json` pins.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev        # http://localhost:5173
```

Sign in with any seeded account. Each account has its **own** password, from `QMS_PASSWORDS_FILE`
or `QMS_PASSWORD_<USER_ID>`; outside production one `QMS_SEED_PASSWORD` still opens all of them
unless `QMS_ALLOW_SHARED_PASSWORD=false`. The accounts, their roles and their landing dashboards are
listed in [docs/auth.md](docs/auth.md):

| Role | Email |
|---|---|
| SUPER_ADMIN | `admin@ipc.example` |
| ADMIN | `suresh.gupta@ipc.example` |
| FRONT_OFFICE | `front.office@ipc.example` |
| OFFICER_IN_CHARGE | `jatin.rawat@ipc.example` |
| ASSIGNED_OFFICIAL | `neha.singh@ipc.example` |
| REVIEWER | `amit.mehta@ipc.example` |

> **An inquirer has no account, and there is no `INQUIRER` role.** Inquirers are external: a member
> of the public emails the Front Office mailbox from their own mail client, is read off the `From`
> header at intake, holds no account here and never signs in.

### MongoDB

Required. Set `DATABASE_URL` and have a reachable server — the team's shared Atlas database (next
section), or a local one such as `mongodb://127.0.0.1:27017/query_management_system`:

```bash
mongosh "$DATABASE_URL" --eval 'db.runCommand({ping:1})'   # should print { ok: 1 }
```

- **A `DATABASE_URL` that is set must name its database and be reachable, in every environment.**
  Otherwise the server exits at startup with the reason (credentials redacted) instead of running
  on in memory.
- **Only an empty `DATABASE_URL` in development** starts without a database: the mailbox and audit
  trail fall back to memory. Query Cases do **not** — `/api/v1/queries/*` answers `503`, and the UI
  raises a toast saying changes were not saved rather than pretending they were.
- **In production** (`NODE_ENV=production`) an empty `DATABASE_URL` is a startup failure too. The
  server exits with a non-zero code instead of serving requests it cannot persist.

### Shared development database (MongoDB Atlas)

The team develops against **one** MongoDB Atlas database, so every developer's backend reads and
writes the same cases, mailbox, dashboards and audit trail. Each developer still runs their own
backend and frontend; the database is the single source of truth.

**Connection string** — in `backend/.env.local` only:

```env
DATABASE_URL=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/query_management_system?retryWrites=true&w=majority
```

- The path must name the database, `/query_management_system`. A URI without one is refused at
  startup; otherwise every collection would land in `test`. URL-encode special characters in the
  password.
- The first connect waits up to 15 s (DNS SRV lookup and TLS). A wrong password, or a machine not on
  the Atlas IP access list, stops the backend with a redacted error.
- A `mongodb+srv://` URI or any host other than `localhost`/`127.0.0.1`/`::1` counts as **shared**.
  On a shared database, startup only adds missing indexes (`createIndexes`) and never drops one.

**Seeding** — once, when the database is new:

```bash
cd backend
npm run db:provision -- --dry-run   # what it would create; writes nothing
npm run db:provision                # the DATABASE_URL in backend/.env.local (or --uri "...")
```

It is idempotent: it creates the collections and indexes and inserts the 12 `@ipc.example`
development identities from `src/constants/users.js` (`$setOnInsert`, so an existing account is left
alone), and it writes **no cases**. A second run reports `0 newly inserted`. It syncs indexes to the
models of the branch it runs from, so run it from this branch.

**Two profiles.** Exactly one machine is the **mailbox host**: it runs the signed-in NICeMail Chrome
session, syncs the inbox into the database and runs the retention sweep. Everyone else is a
**teammate**, whose backend lists what the host stored and never touches NICeMail.

The `backend/.env.local` settings for each profile are listed in
[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md), under the local profiles; a teammate's backend runs as a
viewer (`NIC_BROWSER_VIEWER=true`) with sync and retention off. Set the viewer flag on every teammate
backend, even one that never opens the NICeMail inbox: it is what refuses NICeMail sends there, and
`NIC_BROWSER_MAILBOX=true` without it turns that backend into a second mailbox host. To see the
NICeMail inbox a teammate also needs `NIC_BROWSER_MAILBOX=true` and exactly the host's `NIC_EMAIL`, and
signs in as the NICeMail Front Office; every other Front Office inbox shows no NICeMail mail.

**How teammates see each other's changes.** Every backend reads the shared database on each request,
and nothing is cached per backend. There is no server push: a browser tab reloads the shared data when
it gains focus, becomes visible or changes route, and after each of its own writes, and the mailbox
list polls every 15 s. A tab left idle in front of someone does not refresh until they click into it or
change page. No extra synchronisation, polling or cache invalidation is needed for correctness.

The NICeMail Front Office (`USR-0014`) needs a credential like every other account — in auto mode
the shared `QMS_SEED_PASSWORD` covers it; dev login refuses it. On a shared database the retention sweep starts only on the mailbox host.

**Sends happen on the machine that clicks.** The acknowledgement and forward (on accept), a retry,
and the final response (on final approval) go out from the backend of whoever pressed the button,
under that backend's own configuration. A teammate's backend refuses a NICeMail send before touching
Chrome: the case is saved, the email is recorded as failed, and the host re-sends it from the case page
(Retry acknowledgement / Retry forwarding) or, for a final response, the Dispatch page. **Do the real
NICeMail accept on the host.**

**Verify the target** before doing anything else. The backend prints

```
[qms] MongoDB connected — <cluster-host>/query_management_system (shared: resets and mailbox wipes are refused)
```

and `GET /api/v1/health` answers `database: { connected: true }`. A teammate's backend also prints
`NICeMail agent:  viewer — …`. Check the database name in that line: a URI with no name is refused,
but a misspelled name silently opens a separate, empty database.

**Rules:**

- **No destructive operations.** The header **Reset** and `DELETE /api/v1/mailbox` answer 409 on a
  shared database; `npm run db:reset`, `npm run mailbox:purge` and `npm run db:provision -- --truncate`
  refuse without `--force`. Never pass `--force` here — use a local MongoDB to start clean.
- **Pull before joining.** The mailbox host commits and pushes first; teammates then pull this branch
  (at least the commit "feat(config): load exactly one env file, chosen from backend/") and run
  `npm install` before pointing a backend at the shared database. Older code ignores `.env.local`.
- **Never point an old branch at it** — `main`, `develop`, `Rawat`, `bhumika`, `aakash`,
  `abhi-agent`. They lack these guards and the per-case revision check, and their startup drops
  indexes this branch declares.
- **One Atlas database user per developer**, with the `readWrite` role on `query_management_system`
  only (not `atlasAdmin`), and each developer adds their own IP to the Atlas access list. If your
  public IP changes, Atlas refuses the connection: a running backend keeps running but its database
  calls fail. Add the new IP and restart.
- **Credentials live only in `backend/.env.local`** — never in `.env.example`, a commit, a chat or a
  screenshot.
- **Real citizen mail lives here.** Treat everything in it as personal data.
- **Attachment bytes stay on the disk of the machine that stored them** — for NICeMail mail, the
  host's. Elsewhere the attachment is listed but cannot be opened or forwarded.
- **The e2e suite stays on the local `qms_e2e` database.** Playwright refuses to start otherwise.
- **Keep development backends off shared networks.** A development backend answers password-less
  dev login for every seeded account and listens on all interfaces, so anyone who can reach its port
  can read and change the team's cases.
- **Production must use a separate cluster and separate credentials**, never this database.

## Environment Variables

The full reference — every variable, where it is required, its default and whether it is a secret —
is **[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)**. This section only says which file is used where.

| File | Tracked | Used by |
|---|---|---|
| `backend/.env.example` | yes | the template: the variables a deployment sets, without comments or working secrets — `JWT_SECRET` is empty, so a fresh copy refuses to start until it is set |
| `backend/.env.local` | no | a developer's backend, mailbox host or teammate |
| `backend/.env.production` | no | the production VM's backend, selected only when `NODE_ENV=production` is set in the real environment |
| `backend/.env.e2e` | yes | the Playwright suite, which loads it alone through `ENV_FILE`; credential-free, with its own test-only `JWT_SECRET` |
| `frontend/.env.example` | yes | the frontend template |
| `frontend/.env.local` | no | a developer's Vite server |
| Render dashboard | — | the production frontend build: `VITE_API_BASE_URL=/api/v1` and `NODE_VERSION=22`, nothing secret |

**The backend loads exactly one file**, resolved against `backend/` whatever the working directory:
`ENV_FILE` if it is set (a missing file stops the backend), otherwise `.env.production` when
`NODE_ENV=production` is set in the real environment, otherwise `.env.local`, otherwise a legacy
`backend/.env`, with a warning to rename it. The server and every npm script that reads configuration
go through this loader, except `nic:preflight`, which reads no file. A variable already set in the
real environment always wins over the file, and `ENV_FILE` only works there — written inside a file
it does nothing.
dotenv's startup line `injected env (N) from <file>` names the file that was loaded.

**The frontend** reads two variables, both public because Vite bakes them into the bundle:
`VITE_API_BASE_URL` (`http://localhost:5000/api/v1` locally, `/api/v1` on Render, which rewrites
`/api/*` to the backend) and `VITE_NIC_FRONT_OFFICE_EMAIL`, used only by the development quick-login
panel.

The NICeMail browser agent and the NICeMail IMAP/SMTP settings configure **two unrelated
mechanisms** and must not be conflated — see [backend/README.md](backend/README.md) for the split.

`JWT_SECRET` (≥32 characters) and a sign-in credential for every seeded account are **required —
the server exits without them**, as is `DATABASE_URL` under `NODE_ENV=production`; a `DATABASE_URL`
that is set must name its database and be reachable. A credential is an entry in `QMS_PASSWORDS_FILE`
(a JSON file of `userId` → password) or a `QMS_PASSWORD_<USER_ID>` variable — `QMS_PASSWORD_USR_0008`
for `USR-0008` — which `.env.example` does not list, because the names follow the accounts. Outside
production one `QMS_SEED_PASSWORD` also opens every account unless `QMS_ALLOW_SHARED_PASSWORD=false`.
Real `.env` files — `.env` and every `.env.*` except the `.env.example` files and
`backend/.env.e2e` — are gitignored and must never be committed; neither must NICeMail credentials
or a database URI with a password in it.

## Documentation

Start with **[docs/HANDOFF.md](docs/HANDOFF.md)** — status at a glance, how to run it, what is real
versus mock, known gaps, and what to do next.

The full set lives under [`docs/`](docs/README.md):

- **[docs/auth.md](docs/auth.md)** — development accounts, roles, dashboards, RBAC verification.
- **SRS** (`docs/srs/`) — functional and non-functional requirements, the workflow state machine,
  the AI-assistance model, the data model, and the open client-clarification register.
- **Architecture** (`docs/architecture/`) — system, frontend, backend, and the dynamic
  workflow-engine model.
- **Workflow** (`docs/workflow/`) — the query lifecycle walkthrough, the role/permission matrix,
  transfer/pullback rules, and the production email/AI generation flows.
- **API** (`docs/api/api-plan.md`) — the implemented REST surface and what remains planned.
- **Operational guides** — [`docs/MAIL_MANUAL_TEST.md`](docs/MAIL_MANUAL_TEST.md) (what has to be
  checked by hand, across the mock, browser-agent and SMTP postures),
  [`docs/NIC_BROWSER_AGENT.md`](docs/NIC_BROWSER_AGENT.md) (the browser agent runbook) and
  [`docs/NIC_EMAIL_PHASE0.md`](docs/NIC_EMAIL_PHASE0.md) (NIC government email feasibility gate).

`docs/markdown/` is the IPC source corpus that grounds the AI. It is **gitignored** and not part of
the repository — see [backend/README.md](backend/README.md#ai-grounding-layer).
