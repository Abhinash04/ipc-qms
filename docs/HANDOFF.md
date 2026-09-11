# QMS Handoff

Orientation for anyone picking up this repository — how to run it, what is real versus mock, what
is deliberately incomplete, and what to do next.

## Status at a Glance

The full query lifecycle runs end to end against a real backend: authenticated sign-in, a working
email pipeline, a grounded LLM integration, attachments, an audit trail, and an administration
console. The one structural gap is that **Query Cases are not yet stored server-side**.

| Area | Status | Notes |
|---|---|---|
| Frontend shell & routing | ✅ Done | Role-namespaced routes (`/<role-slug>/<section>`) generated from the RBAC grant table; nav derived from the same table. |
| Authentication | ✅ Done | `POST /auth/login` → JWT in an httpOnly cookie. `verifyToken` → `verifyRole`/`verifyAction` on the server; `ProtectedRoute` on the client. |
| Backend API | ✅ Done | 26 routes: health, auth, emails, mailbox, AI, attachments, NIC, audit. |
| Persistence — server | ✅ Done | MongoDB via Mongoose for the mailbox and audit trail. **Optional** — the API runs degraded without it. |
| Persistence — cases | 🟡 Browser-only | Dexie/IndexedDB. No `/queries` endpoint, no Case model. See [Known Gaps](#known-gaps). |
| Workflow state-transition engine | ✅ Done | Single-writer `applyTransition` guarantees one audit event per transition; dynamic review levels. |
| Workflow validation | ✅ Done | Enforced centrally in the store (role + state); the UI gate is presentation only. |
| Email integration | ✅ Done | Enquiry → mailbox → ingestion → acknowledgement → forward → dispatched response, on one thread. Mock and real-Gmail transports. |
| Attachments | ✅ Done | Upload, preview, download; **fail-closed** forwarding refuses to send if any file cannot be read. |
| AI integration | ✅ Done | Pravah Gemma for summary/recommendation/drafting, grounded in an indexed IPC corpus, with a deterministic fallback the user is told about. |
| Audit trail | ✅ Done | Server-side, queryable, backing the Admin console. Degrades to a bounded in-memory buffer without Mongo. |
| Admin / Super Admin console | ✅ Done | Overview, audit trail, email activity, AI activity, roles; System Settings is Super-Admin-only. |
| Notifications | ✅ Done | Sonner toasts wired to committed outcomes, never to button clicks. |
| Case-level authorization | ❌ Not done | Role-level only — see [Known Gaps](#known-gaps). |
| NIC government email | 🟡 Blocked | Phase 0 not passed; see [NIC_EMAIL_PHASE0.md](./NIC_EMAIL_PHASE0.md). |
| Transfer / pullback | 🟡 Gated off | Implemented in the store but disabled pending client answers — see below. |

**Tests:** backend 446, frontend 729. Both lint-clean; the frontend build passes.

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

MongoDB is optional for development. Without it the mailbox and audit trail run in memory and are
cleared on restart — the UI says so rather than hiding it.

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

## Repository Map

```
frontend/    React 19 + Vite 8 SPA         — frontend/README.md
backend/     Node.js + Express 5 API       — backend/README.md
docs/        This file, plus SRS, architecture, workflow, API — docs/README.md
```

## Architecture in Five Sentences

1. **Routes are generated from the permission table** — a section a role does not hold has no route
   at all, on either side of the app.
2. **`applyTransition` in `useWorkflowStore` is the single writer** for every workflow state change,
   and it always appends exactly one audit event — which is why the audit trail is complete and why
   toasts can be wired to it rather than to buttons.
3. **The mailbox is a duck-typed seam** — mock, Mongo and Gmail-inbox implementations share one
   interface, selected at call time, so the same pipeline runs against a real inbox or a fake one.
4. **AI answers are grounded** — enquiries are decomposed into questions, each matched against an
   indexed corpus of IPC guidance, and the model is given only that evidence; when it is unreachable
   a deterministic draft is produced and the user is told.
5. **Attachments fail closed** — every referenced file is verified (existence, bytes, SHA-256)
   before any outbound send, so a recipient never gets an apparently-complete message with documents
   silently missing.

## What's Real vs Mock

| Real | Mock / local |
|---|---|
| Authentication, sessions, RBAC (both sides) | Query Cases (browser IndexedDB) |
| The audit trail (`/audit`, MongoDB) | The user directory (seeded from source, one shared password) |
| Email send/forward/acknowledge/ingest | Divisions and categories (static constants) |
| Gmail transport + inbox reader (when configured) | Reports page (KPIs are real; charts are not connected) |
| Pravah Gemma summary/recommendation/draft | `mockAiService` — now the *fallback*, not the primary |
| Attachment storage, preview, download | |

## Known Gaps

1. **Case-level authorization is not enforced.** Any authenticated user can read any attachment by
   id: `authorizeAttachmentAccess` checks only that a session exists, because the server has no case
   records to check ownership against. The backend prints this warning on every boot. **Do not
   expose this server outside a trusted network.**
2. **Workflow-state authorization is half-enforced.** `verifyAction` enforces the role half of
   `canPerform(role, action, state)`; the state half needs server-side case state.
3. **Query Cases are browser-local.** Cases, steps, reviews, draft versions and in-app notifications
   live in the current browser profile only. Two users do not see each other's cases. The admin
   console labels these figures "This browser only".
4. **Token revocation does not exist.** Logout clears the cookie, but a copied token stays valid
   until it expires (default 8h).
5. **All accounts share one seeded password.** A development mechanism, not a user store.
6. **Transfer and pullback are implemented but gated off.** `transferQuery` and `pullBackQuery`
   exist in the store, but `canPerform` returns `false` for anything listed in
   `CLARIFICATION_REQUIRED_ACTIONS` — they stay disabled until the client answers the questions in
   [srs/14](./srs/14-open-questions-and-client-clarifications.md).
7. **`constants/capabilities.js` is not wired.** The NIC agent capability table is tested but guards
   no route today.
8. **NIC email is blocked at Phase 0** — authentication to `contact.ecoclubs-edu@gov.in` has not
   succeeded from the deployment host. See [NIC_EMAIL_PHASE0.md](./NIC_EMAIL_PHASE0.md).
9. **The AI corpus source is not in the repo.** `backend/src/data/ipcKnowledge.json` is committed so
   grounding works on a fresh clone, but `docs/markdown/` — the source it is built from — is
   gitignored. `npm run ingest:ipc` cannot be re-run without obtaining those files separately.
10. **Some dead code remains**, listed in [frontend/README.md](../frontend/README.md#known-dead-code)
    — a few unreferenced components/hooks, 17 dormant shadcn scaffold files, and three declared but
    unused dependencies.

## What's Next

- **Server-side Query Cases** — the single change that unblocks gaps 1, 2 and 3. The shape the
  backend should implement is in
  [architecture/workflow-engine.md](./architecture/workflow-engine.md).
- **Per-user credentials** — replace the seeded shared-password directory
  (`backend/src/constants/users.js`) with a real user collection.
- **Client sign-off on the open questions** —
  [srs/14](./srs/14-open-questions-and-client-clarifications.md) still governs transfer/pullback
  rules and SLA definitions.
- **NIC Phase 0** — generate a NICeMail application-specific password and re-run
  `npm run nic:preflight` **from the deployment host**.

## Project History

Condensed, so past decisions are not rediscovered:

1. **Initial Architecture & Foundation** — frontend shell, role-namespaced routing generated from
   the RBAC table, the design system, the documentation set, and a backend health endpoint. The
   backend was migrated from CommonJS to ES Modules so both halves share one module system.
2. **Workflow engine & lifecycle** — the Zustand + Dexie store with the single-writer
   `applyTransition`, dynamic review levels, and the full email → case → verify → assign → draft →
   review → approve → dispatch → close lifecycle.
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

Earlier revisions of this document described a mock-only prototype with a health-only backend, eight
fictional users and no authentication. All of that is obsolete; this file and the two READMEs now
describe the implementation as it stands.
