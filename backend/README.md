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
   per-user credentials before production.

Until (1) and (2) land, do not expose this server outside a trusted network.
