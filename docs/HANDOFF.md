# QMS Handoff

Orientation doc for anyone picking up this repository — how to run it, what's real vs.
mock, what's broken, and what to do next. Written at the end of the **Initial Architecture &
Foundation** phase (see root [README.md](../README.md)).

## Status at a Glance

The application is a fully-navigable, fully-styled frontend running entirely on mock data,
talking to a backend that currently does nothing but answer a health check. No real
authentication, persistence, or workflow logic exists yet — by design, per the project's
initial-foundation scope (see [docs/srs/01-introduction.md](./srs/01-introduction.md)).

| Area | Status | Notes |
| --- | --- | --- |
| Frontend shell & routing | ✅ Done | 23 routes, role-gated nav, all render — see §Repository Map. |
| Design system | ✅ Done | DM Sans + "MiniMax Bold" identity, see §Design System below. |
| Mock data & RBAC (display-only) | ✅ Done | 8 mock users, 6 roles, 1 canonical mock query (`QRY-2026-00427`). |
| Backend health endpoint | ✅ Done | `GET /api/v1/health`. |
| Backend actually runnable | ❌ **Broken** | See §Known Issues — fix before anything else backend-related. |
| Real authentication | ❌ Not started | App boots into a hardcoded mock session. |
| Database (PostgreSQL) | ❌ Not started | `backend/src/models/` and `services/` are empty by design. |
| Workflow state-transition engine | ❌ Not started | All "action" buttons in the UI are disabled placeholders. |
| AI integration (assignment/drafting) | ❌ Not started | UI shows the SRS example content as static mock only. |
| Email integration | ❌ Not started | No ingestion or dispatch wired to anything real. |

## Getting Started

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev        # http://localhost:5173
```

### Backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev         # intended: http://localhost:5000 — see Known Issues, currently crashes
```

### Mock login

There is no real login. The app boots straight into a hardcoded session as **Neha Singh
(`USR-0004`, Assigned Official)** — see `frontend/src/store/useAuthStore.js`. To test as a
different role during development, edit that file's `findUserById('USR-0004')` call to any
other ID below, or call `useAuthStore.getState().login('USR-000X')` from the browser console.

| ID | Name | Role | Email |
| --- | --- | --- | --- |
| USR-0001 | Rajesh Kumar | INQUIRER (external, no app access) | rajesh.kumar@example.com |
| USR-0002 | Priya Sharma | FRONT_OFFICE | priya.sharma@ipc.example |
| USR-0003 | Anil Verma | OFFICER_IN_CHARGE | anil.verma@ipc.example |
| USR-0004 | Neha Singh | ASSIGNED_OFFICIAL (**default boot user**) | neha.singh@ipc.example |
| USR-0005 | Amit Mehta | REVIEWER | amit.mehta@ipc.example |
| USR-0006 | Kavita Rao | REVIEWER | kavita.rao@ipc.example |
| USR-0007 | Suresh Gupta | ADMIN | suresh.gupta@ipc.example |
| USR-0008 | System Administrator | SUPER_ADMIN | admin@ipc.example |

All fictional development identities — not real IPC employees.

## Repository Map

```
frontend/    React 19 + Vite 8 + JavaScript SPA — see docs/architecture/frontend-architecture.md
backend/     Node.js + Express 5 JavaScript API — see docs/architecture/backend-architecture.md
docs/        This file, plus the full SRS, architecture, workflow, and API-plan set
README.md    Project overview, tech stack, setup
```

`docs/` in full: 14 files under `srs/` (requirements, workflow/state-machine, AI/security/audit
requirements, data model, open client questions), 4 under `architecture/` (system, frontend,
backend, workflow-engine), 3 under `workflow/` (query lifecycle walkthrough, role/permission
matrix, transfer/pullback rules), 1 under `api/` (planned REST surface). Index: [docs/README.md](./README.md).

## Design System

`frontend/DESIGN.md` (generated via `getdesign`, a MiniMax marketing-site brand analysis) is
the source reference. It was **adapted, not copied**, into an enterprise/government identity
dubbed "MiniMax Bold": near-black solid pill (`rounded-full`) primary buttons, DM Sans
throughout (self-hosted via `@fontsource/dm-sans`, no external font CDN), blue reserved for
links/focus rings/the "info" status color, and an 8-color status-badge system (green/amber/
blue/indigo/purple/orange/red/gray) mapped centrally in `frontend/src/constants/statusStyles.js`.

`frontend/src/components/ui/` originally had 34 shadcn/ui scaffold files dumped into it by a
background tool outside this project's control. Only a subset is actually wired up and used:
`badge`, `button`, `card`, `table`, `pagination`, `input`, `select`, `tabs`, `skeleton`,
`avatar`, `separator`, `tooltip`, `textarea`, `label`. The other ~20 (accordion, dialog,
calendar, date-picker, command, sheet, popover, dropdown-menu, checkbox, radio-group, sonner,
scroll-area, bar-list, input-group*, etc.) remain present but **dormant/unreferenced** — safe
to ignore or adopt later, not currently imported anywhere.

## Known Issues (fix before next phase)

1. **Backend cannot currently start.** `backend/src/server.js` uses ESM `import` syntax
   (`import app from './app.js'`), but `backend/src/app.js` uses CommonJS (`require`/
   `module.exports`), and `backend/package.json` has `"type": "commonjs"`. Running
   `npm start` or `npm run dev` in `backend/` throws `SyntaxError: Cannot use import statement
   outside a module` immediately. This was introduced by tooling outside this project's
   control, not by any change described in this repo's history, and was out of scope to fix
   during the frontend design pass. **Fix**: either change `server.js` back to
   `const app = require('./app'); const env = require('./config/env');`, or convert the whole
   backend to `"type": "module"` in `package.json` and rewrite `app.js` (and any future
   backend files) to ESM `import`/`export` consistently. Pick one, not a mix.
2. **`frontend/README.md` is still the unedited stock Vite template** — it was never updated
   with QMS-specific content, unlike the root and `backend/README.md` (both accurate). Low
   priority, but worth replacing so `frontend/` doesn't mislead a reader who opens it directly.

## Git Status Caveat

This repo has exactly **one commit** ("first commit," the raw `create-vite` scaffold before
any QMS-specific work). Everything else — all of `backend/src/`, all of `docs/`, nearly all of
`frontend/src/`, `frontend/DESIGN.md`, both `.env.example` files — is currently **uncommitted,
working-tree-only**. Do not assume the visible file tree is safely version-controlled. Commit
deliberately, in reviewable chunks, before doing anything that could lose working-tree state
(branch switches, resets, clean operations).

## What's Next

- **Client sign-off required first**: [docs/srs/14-open-questions-and-client-clarifications.md](./srs/14-open-questions-and-client-clarifications.md)
  lists every open question (email ingestion method, transfer/pullback permission rules, AI
  provider choice, SLA definitions, etc.) that should be resolved before building the real
  workflow engine, AI integration, or email integration — building ahead of these risks
  rework.
- **Planned API surface**: [docs/api/api-plan.md](./api/api-plan.md) — only `GET /api/v1/health`
  exists today; everything else is a documented plan, not a promise of shape.
- **Workflow engine model**: [docs/architecture/workflow-engine.md](./architecture/workflow-engine.md)
  describes the dynamic `WorkflowStep[]` shape the real backend should implement — critical to
  get right early since it's the foundation the dynamic review-level requirement depends on.
