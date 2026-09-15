# Query Management System (QMS)

## Purpose

QMS manages incoming query emails for an IPC client, end to end: receipt, Front Office
verification, AI-assisted assignment, AI-assisted drafting, dynamic multi-level review, final
Officer-in-Charge approval, response dispatch, and closure — with a complete audit trail
throughout.

## Current State

The full query lifecycle runs end to end. Implemented and working:

- **Authentication** — sign-in against seeded accounts, JWT in an httpOnly cookie, role-based route
  guards on both halves of the app.
- **Email pipeline** — enquiry → IPC mailbox → ingestion → acknowledgement → forward to the
  Officer-in-Charge → dispatched response, on one thread. Mock and real-Gmail transports.
- **AI** — Pravah Gemma for summary, assignee recommendation and drafting, grounded in an indexed
  corpus of IPC guidance documents, with a deterministic fallback when the model is unreachable.
- **Attachments** — upload, preview, download, and fail-closed forwarding that refuses to send if
  any referenced file cannot be read.
- **Workflow engine** — dynamic review levels, validated centrally, with one audit event per
  transition guaranteed by a single-writer store.
- **Audit trail** — server-side, queryable, backing an Admin / Super Admin console.
- **Notifications** — toasts wired to committed outcomes, not to button clicks.

**The main gap:** Query Cases are not yet stored server-side. Case state lives in the browser's
IndexedDB, which is why there is no `/queries` endpoint and why authorization is role-level rather
than case-level. See [docs/HANDOFF.md](docs/HANDOFF.md) for the full status table and known gaps.

Where a client decision is genuinely still open — transfer/pullback rules, SLA definitions — it
remains recorded in
[docs/srs/14-open-questions-and-client-clarifications.md](docs/srs/14-open-questions-and-client-clarifications.md).

## Technology Stack

**Frontend**: React 19, Vite 8, JavaScript/JSX, Tailwind CSS v4, React Router 7, Zustand, Dexie
(IndexedDB), TanStack Query, Axios, Sonner, Lucide React, Framer Motion.

**Backend**: Node.js, Express 5, **MongoDB via Mongoose** (optional — the API runs degraded without
it), jsonwebtoken, bcryptjs, cookie-parser, googleapis, multer, nodemailer, imapflow, helmet, cors,
morgan.

**Testing**: Vitest on both sides — 446 backend tests (supertest), 729 frontend tests (Testing
Library + fake-indexeddb).

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
cp .env.example .env
# set JWT_SECRET (>=32 chars) and QMS_SEED_PASSWORD — the server will not start without them
npm run dev        # http://localhost:5000
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev        # http://localhost:5173
```

Sign in with any seeded account — every role shares `QMS_SEED_PASSWORD`. The accounts, their roles
and their landing dashboards are listed in [docs/auth.md](docs/auth.md):

| Role | Email |
|---|---|
| SUPER_ADMIN | `admin@ipc.example` |
| ADMIN | `suresh.gupta@ipc.example` |
| FRONT_OFFICE | `bhoomikamakker@gmail.com` |
| OFFICER_IN_CHARGE | `rawatjatin436@gmail.com` |
| ASSIGNED_OFFICIAL | `neha.singh@ipc.example` |
| REVIEWER | `amit.mehta@ipc.example` |
| INQUIRER | `abhinash.pritiraj@gmail.com` |

MongoDB is optional for development — without it the mailbox and audit trail run in memory and are
cleared on restart, which the UI reports rather than hiding.

## Environment Variables

**`frontend/.env.example`** — one variable:

```env
VITE_API_BASE_URL=http://localhost:5000/api/v1
```

**`backend/.env.example`** — 42 variables in seven groups. The file is heavily commented and is the
authoritative reference; the groups are:

| Group | Contains |
|---|---|
| Core | `PORT`, `NODE_ENV`, `CLIENT_URL`, `DATABASE_URL` |
| Authentication | `JWT_SECRET`, `QMS_SEED_PASSWORD`, `SESSION_TTL_SECONDS`, `SESSION_COOKIE_NAME`, `SESSION_COOKIE_SAMESITE` |
| Email transport | `EMAIL_TRANSPORT` (`mock`\|`gmail`), `MAILBOX_SOURCE` (`auto`\|`gmail`) |
| Stakeholder identities | inquirer / front-office / officer-in-charge names and addresses, IPC query + acknowledgement addresses |
| Gmail OAuth | client id/secret, redirect URI, one refresh token per role |
| NICeMail | IMAP/SMTP hosts and ports, mailbox, app-password (or a file path to it), test recipient |
| Pravah Gemma | `GEMMA_API_URL`, `GEMMA_TIMEOUT_MS` |
| Attachments | `ATTACHMENT_DIR` and the size/count caps |

`JWT_SECRET` (≥32 characters) and `QMS_SEED_PASSWORD` are **required — the server exits without
them.** Real `.env` files are gitignored and must never be committed; neither must NIC or Gmail
credentials.

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
- **Operational guides** — [`docs/EMAIL_MANUAL_TEST.md`](docs/EMAIL_MANUAL_TEST.md) (real-Gmail
  verification) and [`docs/NIC_EMAIL_PHASE0.md`](docs/NIC_EMAIL_PHASE0.md) (NIC government email
  feasibility gate).

`docs/markdown/` is the IPC source corpus that grounds the AI. It is **gitignored** and not part of
the repository — see [backend/README.md](backend/README.md#ai-grounding-layer).
