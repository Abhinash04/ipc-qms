# API

The REST surface, split into what exists today and what is still planned. All routes are versioned
under `/api/v1`. For middleware chains, request shapes and error semantics, see
[backend/README.md](../../backend/README.md#api) — that is the authoritative reference; this page is
the planning view.

## Implemented today

26 routes across eight resources. Only three are public (`GET /health`, `POST /auth/login`,
`POST /auth/logout`); everything else requires a session cookie.

| Resource | Routes | Notes |
|---|---|---|
| `/health` | `GET` | Service liveness. Public. |
| `/auth` | `POST /login`, `POST /logout`, `GET /me` | JWT in an httpOnly cookie (`qms.session`). |
| `/emails` | `GET /config`, `POST /enquiry`, `POST /acknowledgement`, `POST /forward`, `POST /response` | Forward and response are gated by `verifyAction(FORWARD\|DISPATCH)`. Forward returns **409** naming any attachment it could not resolve. |
| `/mailbox` | `GET /messages`, `POST /messages/:id/ingested`, `DELETE /messages/:id`, `POST /receive`, `DELETE /` | Front Office + Super Admin; the last two are Super-Admin-only destructive/seeding utilities. |
| `/ai` | `POST /summary`, `POST /recommend`, `POST /draft` | Any signed-in role. Grounded in the IPC corpus; never throws — falls back deterministically. |
| `/attachments` | `POST /`, `GET /:id/meta`, `GET /:id` | **Top-level, not nested under a query** — see below. |
| `/nic` | `GET /status`, `POST /read`, `POST /send` | Returns HTTP 200 with `{ ok:false, stage, error }` on failure so the caller can tell *where* it failed. |
| `/audit` | `GET /`, `GET /summary`, `GET /query/:queryId` | Admin + Super Admin only. `GET /summary` honours caller `from`/`to` on its `overall` half. |

### Where the shape differs from the original plan

- **Attachments are top-level** (`POST /attachments`, `GET /attachments/:id`), not
  `/queries/:id/attachments`. They have to be addressable by id alone because `attachmentUrl()`
  builds bare URLs for `<img>`, `<iframe>` and `<a download>`, which cannot carry an auth header —
  hence also the cookie rather than a bearer token.
- **Audit is top-level** (`GET /audit`, `/audit/summary`, `/audit/query/:queryId`), not
  `/queries/:id/audit`, because the trail is queried across all cases by the admin console.
- **`/emails` and `/mailbox` were not in the original plan at all** — the email pipeline was
  designed after it was written.

## Still planned

None of these exist: no route, controller, service or collection.

| Resource | Method(s) | Purpose |
|---|---|---|
| `/queries` | `GET`, `POST` | List/search queries, register a new query. |
| `/queries/:id` | `GET`, `PATCH` | Query detail / update. |
| `/queries/:id/assign` | `POST` | Assign a query (AI recommendation + human decision). |
| `/queries/:id/transfer` | `POST` | Transfer to another official. Rules **still open** — see [workflow/workflow-rules.md](../workflow/workflow-rules.md). |
| `/queries/:id/pullback` | `POST` | Pull the query back a stage. Rules **still open**. |
| `/queries/:id/workflow` | `GET`, `POST` | Read/advance the dynamic `WorkflowStep[]` — see [architecture/workflow-engine.md](../architecture/workflow-engine.md). |
| `/queries/:id/reviews` | `GET`, `POST` | Read review steps; submit a review decision. |
| `/queries/:id/responses` | `GET`, `POST` | Read/create response versions. |
| `/users` | `GET`, `POST`, `PATCH /:id` | User management. The directory is currently a source-code constant. |
| `/roles` | `GET` | Role / permission reference. |
| `/divisions` | `GET`, `POST`, `PATCH /:id` | Division management. |
| `/notifications` | `GET` | Notifications for the current user. In-app notifications are browser-local today. |
| `/dashboard` | `GET` | Role-specific aggregates. |

### Why `/queries` does not exist yet

Query Cases are held in the browser's IndexedDB via Dexie, not on the server. That is the single
largest architectural gap in the project, and it is what blocks:

- **case-level authorization** — `authorizeAttachmentAccess` cannot check ownership against records
  the server does not have;
- **workflow-state authorization** — `verifyAction` can enforce the role half of
  `canPerform(role, action, state)` but not the state half;
- **cross-user visibility** — two users do not see the same cases.

Implementing `/queries` and the `WorkflowStep[]` model is the change that unblocks all three.

## Conventions

- All routes are versioned under `/api/v1`.
- Status codes are centralised in `backend/src/constants/httpStatus.js`: `200` GET success, `201`
  POST success, `400` validation failure, `401` missing/invalid session, `403` role refusal, `404`
  missing resource, `409` unresolvable attachment, `500` unexpected failure.
- Errors are shaped by `middleware/errorHandler.js` as `{ error, ...details }`, with a stack only
  when `NODE_ENV=development`.
- Request validation is currently inline in controllers — `backend/src/validators/` remains empty,
  and no schema library (Zod/Joi) is installed on the backend.
- Server-side mutations record an audit event via `services/audit/auditService.js`; every
  authorization refusal is recorded as `AUTHORIZATION_DENIED`.
