# Query Management System (QMS)

## Purpose

QMS manages incoming query emails for an IPC client, end to end: receipt, Front Office
verification, AI-assisted assignment, AI-assisted drafting, dynamic multi-level review, final
Officer-in-Charge approval, response dispatch, and closure — with a complete audit trail
throughout.

## Current Phase

**Initial Architecture & Foundation.** This repository currently contains the frontend/backend
scaffolding, routing skeleton, mock authentication/RBAC, mock data, and the full requirements
documentation set. Real authentication, email ingestion, AI integration, PostgreSQL
persistence, and the workflow state-transition engine are **not** implemented yet — see
[docs/srs/14-open-questions-and-client-clarifications.md](docs/srs/14-open-questions-and-client-clarifications.md)
for what needs client sign-off before that work begins.

## Technology Stack

**Frontend**: React 19, Vite 8, JavaScript/JSX, Tailwind CSS v4, React Router 7, Axios,
Zustand, TanStack Query, React Hook Form, Zod, Lucide React.

**Backend**: Node.js, Express 5, JavaScript, PostgreSQL-ready (not yet integrated), dotenv,
cors, helmet, morgan, nodemon.

JavaScript only — no TypeScript anywhere in this repository.

## Repository Structure

```
query-management-system/
├── frontend/    React + Vite + JavaScript SPA
├── backend/     Node.js + Express JavaScript API
├── docs/        SRS, architecture, workflow, and API planning documentation
└── README.md
```

See [docs/README.md](docs/README.md) for the full documentation index, and
[docs/architecture/frontend-architecture.md](docs/architecture/frontend-architecture.md) for
the detailed frontend folder layout and route plan.

## Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env
npm run dev       # http://localhost:5173
```

Other commands: `npm run build`, `npm run lint`, `npm run preview`.

The app boots with a mock authenticated session (Neha Singh, Assigned Official) — there is no
working login flow yet.

## Backend Setup

```bash
cd backend
npm install
cp .env.example .env
npm run dev        # http://localhost:5000, nodemon auto-restart
```

Other commands: `npm start` (plain node).

Health check: `GET http://localhost:5000/api/v1/health`.

## Environment Variables

**`frontend/.env.example`**
```env
VITE_API_BASE_URL=http://localhost:5000/api/v1
```

**`backend/.env.example`**
```env
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:5173
DATABASE_URL=
```

Real `.env` files are gitignored and must never be committed.

## Documentation

Full requirements, architecture, workflow, and API planning docs live under
[`docs/`](docs/README.md), including:

- The full SRS (`docs/srs/`), with functional/non-functional requirements, the workflow
  state-machine diagram, the AI-assistance model, and the open client-clarification list.
- Architecture docs (`docs/architecture/`) covering the frontend, backend, and the dynamic
  workflow-engine data model.
- The role/permission matrix and transfer/pullback rules (`docs/workflow/`).
- The planned REST API surface (`docs/api/api-plan.md`) — only `GET /api/v1/health` is
  implemented today.
