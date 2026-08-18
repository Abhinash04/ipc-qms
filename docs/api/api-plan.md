# API Plan

This is a **planning document** — a preliminary REST resource shape for the future backend.
**Only `GET /api/v1/health` is implemented today.** Everything else below is not built and
must not be assumed to exist.

| Resource | Method(s) | Purpose |
| --- | --- | --- |
| `/api/v1/health` | `GET` | Service liveness check. **Implemented.** |
| `/api/v1/auth` | `POST /login`, `POST /logout` | Authentication. Mechanism to be confirmed — see [srs/08-security-and-access-control.md](../srs/08-security-and-access-control.md). |
| `/api/v1/users` | `GET`, `POST`, `PATCH /:id` | User management (admin). |
| `/api/v1/roles` | `GET` | Role list / role-permission reference. |
| `/api/v1/divisions` | `GET`, `POST`, `PATCH /:id` | Division management (admin). |
| `/api/v1/queries` | `GET`, `POST` | List/search queries, register a new query. |
| `/api/v1/queries/:id` | `GET`, `PATCH` | Query detail / update. |
| `/api/v1/queries/:id/assign` | `POST` | Assign a query (AI recommendation + human decision, per [srs/07-ai-requirements.md](../srs/07-ai-requirements.md)). |
| `/api/v1/queries/:id/transfer` | `POST` | Transfer to another official. Rules TO BE CONFIRMED — see [workflow/workflow-rules.md](../workflow/workflow-rules.md). |
| `/api/v1/queries/:id/pullback` | `POST` | Pull the query back a stage. Rules TO BE CONFIRMED. |
| `/api/v1/queries/:id/workflow` | `GET`, `POST` | Read/advance the query's dynamic `WorkflowStep[]` (see [architecture/workflow-engine.md](../architecture/workflow-engine.md)). |
| `/api/v1/queries/:id/reviews` | `GET`, `POST` | Read review steps; submit a review decision (approve/return). |
| `/api/v1/queries/:id/responses` | `GET`, `POST` | Read/create response versions (draft generation + edits). |
| `/api/v1/queries/:id/attachments` | `GET`, `POST` | Read/upload attachments. |
| `/api/v1/queries/:id/audit` | `GET` | Read the query's audit trail. |
| `/api/v1/notifications` | `GET` | List notifications for the current user. |
| `/api/v1/dashboard` | `GET` | Role-specific dashboard aggregates. |

## Conventions (once implemented)

- All routes are versioned under `/api/v1`.
- Status codes follow [backend-architecture.md](../architecture/backend-architecture.md#status-codes).
- Request bodies validated with Zod/Joi in `backend/src/validators/` before reaching a
  controller.
- Mutating endpoints (`POST`/`PATCH` on `/queries/:id/*`) are expected to append at least one
  audit event — see [srs/09-audit-and-compliance.md](../srs/09-audit-and-compliance.md).

## Explicitly Not Implemented This Phase

Every resource above except `/health` is planning-only. No route, controller, service, or
database table exists for them yet (per project instruction §29, "Do Not Over-Implement").
