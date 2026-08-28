# QMS Backend

Node.js + Express API for the Query Management System. JavaScript only (no TypeScript).

## Current Phase

Initial architecture & foundation — health endpoint only. No database, auth, or business
workflow endpoints are implemented yet. The structure is PostgreSQL-ready for future
integration (see `src/models/`, `src/services/`).

## Structure

```
src/
  config/        environment configuration
  controllers/   parse request, call services, return response
  middleware/    security, error handling
  models/        (empty — reserved for future PostgreSQL data-access layer)
  routes/        route definitions, mounted under /api/v1
  services/      (empty — reserved for business logic / DB access)
  validators/    (empty — reserved for Zod/Joi request schemas)
  utils/         (empty — reserved for shared helpers)
  constants/     shared constants (HTTP status codes, etc.)
  app.js         Express app assembly (middleware + routes)
  server.js      process entry point
```

## Setup

```bash
npm install
cp .env.example .env
```

## Development

```bash
npm run dev     # nodemon, auto-restart
npm start       # plain node
```

## Health Check

```
GET /api/v1/health
```

Returns `200` with a small JSON payload confirming the service is up.

## Security status: NOT production-ready

This backend has **no authentication mechanism of any kind** — no JWT, no session, no
`req.user`, no middleware on any route. Every endpoint under `/api/v1`, including the
attachment endpoints below, is reachable by anyone who can send it an HTTP request. RBAC
(`frontend/src/constants/workflowRules.js`, `frontend/src/routes/ProtectedRoute.jsx`) is
enforced only in the browser; it is a usability boundary for the app's own UI, not a security
control, and does not stop a direct API call.

**Attachment endpoints in particular** (`POST /api/v1/attachments`, `GET
/api/v1/attachments/:id`, `GET /api/v1/attachments/:id/meta`) let anyone who can reach this
server upload or read any stored document — attachment ids are unguessable, but that is
obscurity, not authorization. `src/middleware/authorizeAttachmentAccess.js` is a deliberate
pass-through seam left in the request chain for exactly this gap; it is a `TODO`, not an
implementation.

**Before any production deployment:**
1. Add real authentication to the API (JWT/session, `req.user`).
2. Implement `authorizeAttachmentAccess`: an Inquirer may read only their own case's
   attachments; Front Officer, Officer-in-Charge, and the assigned official per the roles in
   `workflowRules.js`.
3. Do the same for every other existing route (`DELETE /mailbox` and friends are equally open
   today) — this is a pre-existing gap the attachment feature inherits, not one it introduces.
