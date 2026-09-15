# Backend Architecture

Design rationale for the Express API. For the concrete route list, configuration reference and
degradation behaviour, see [backend/README.md](../../backend/README.md).

## Pattern

Per `.claude/backend-rules.md`, the backend follows a Controller → Service separation:

- **Routes** (`src/routes/`) map URL + method to a controller function, and declare the middleware
  chain for that route. `src/routes/index.js` is the single mount point, aggregated under
  `/api/v1` in `src/app.js`. Eight resource routers: health, auth, email, mailbox, ai, attachment,
  nic, audit.
- **Controllers** (`src/controllers/`) parse the request, call the appropriate service, and shape
  the HTTP response. Eight controllers, one per resource.
- **Services** (`src/services/`) hold business logic and data access, kept stateless. Five groups:
  `ai/`, `attachments/`, `audit/`, `auth/`, `email/`.
- **Models** (`src/models/`) hold the Mongoose schemas — `AuditEvent.js` and `MailboxMessage.js`
  (plus a `Counter` model backing message-id sequences).
- **Data** (`src/data/`) holds the IPC knowledge corpus and the retrieval layer that grounds AI
  answers. Not a data-*access* layer — it is domain content plus search.
- **Validators** (`src/validators/`) is still **empty**. Request validation is currently inline in
  controllers, and no schema library is installed on the backend. `src/utils/` is likewise empty.

## Middleware Chain

`src/app.js` assembles, in order:

1. `helmet()` — security headers.
2. `cors({ origin: env.CLIENT_URL, credentials: true })` — restricted to the configured frontend,
   with credentials enabled so the browser will attach the session cookie cross-origin.
3. `morgan()` — request logging (`dev` in development, `combined` in production, **disabled
   entirely when `NODE_ENV=test`**).
4. `express.json()` — body parsing.
5. `cookie-parser()` — required for the cookie-based session.
6. `/api/v1` routes.
7. `notFound` — 404 handler for unmatched routes.
8. `errorHandler` — centralized error formatter; hides stack traces outside development.

Authentication is applied **per route, never globally** — `src/routes/index.js` mounts the routers
without a blanket guard, and each route declares its own chain. This is deliberate: the three public
routes (`/health`, `/auth/login`, `/auth/logout`) are visible as exceptions in the route files
rather than buried in a bypass list.

The auth middleware:

- **`verifyToken`** — reads the JWT from `req.cookies[SESSION_COOKIE_NAME]`, verifies it, and puts
  the principal on `req.user`. 401 if absent or undecodable, with the two cases distinguished in the
  message but not in the status.
- **`verifyRole(...roles)`** — plain role gate; flattens its arguments so both varargs and an array
  work.
- **`verifyAction(action)`** — workflow-action gate via `constants/workflowActions.js`.
- **`authorizeAttachmentAccess`** — currently only re-asserts a session (see below).

Both role guards **fail closed with 401 when `req.user` is absent**, so a route mis-wired to omit
`verifyToken` breaks loudly instead of silently allowing access. Every refusal is recorded as an
`AUTHORIZATION_DENIED` audit event, fire-and-forget so auditing can never block the response.

Rate limiting is still not implemented.

## Error Handling

`errorHandler` (`src/middleware/errorHandler.js`) maps a thrown error's `.status` to the HTTP
response code (defaulting to 500), and only includes `.stack` when `NODE_ENV=development`. It
spreads `err.details` onto the body, which is how `AttachmentUnavailableError` returns its
`unavailableAttachments` list alongside a 409. It logs the stack for ≥500 and a one-liner for 4xx,
and never prints request bodies or headers.

Controllers and services throw `Error` objects with a `.status` property rather than crafting
response JSON themselves.

## Status Codes

Per `backend-rules.md` §4: `200` GET/PUT success, `201` POST success, `400` validation
failure, `401` missing/invalid auth, `403` RBAC violation, `404` missing resource, `500`
unexpected failure. Centralized in `src/constants/httpStatus.js`. Added since: `409` for an
attachment that cannot be resolved.

## Persistence

**MongoDB via Mongoose.** (Earlier revisions of this document described PostgreSQL readiness; no
PostgreSQL client was ever installed, and Mongo was adopted instead.)

The database is **optional by design**: `server.js` calls `connectDb().finally(() => app.listen())`,
so the API starts whether or not Mongo is reachable, and `connectDb` returns `false` rather than
throwing. Without it the mailbox falls back to an in-process map and the audit trail to a bounded
5,000-event buffer. Both report their own state — `mailbox.describe()` and `auditService.describe()`
return the active backend and a `durable` flag, which the admin console surfaces as
"in-memory — not durable". Degrading loudly rather than silently is the point.

`services/audit/auditService.record()` **never throws**: a failed write is buffered and reported as
`persisted: false`, so a failure to audit can never roll back the action that already happened.

## Swap seams

Two places are deliberately polymorphic:

- **`services/email/mailbox/index.js`** — three implementations (in-memory, Mongo, Gmail inbox)
  expose the same six functions; the facade selects one at call time (forced override →
  `MAILBOX_SOURCE=gmail` → Mongo if connected → in-memory). `supportsDelivery()` is false for Gmail
  because a real inbox cannot be written into.
- **`emailService.getTransport`** — mock vs Gmail, resolved per sender identity through a dynamic
  `import()` so `googleapis` is never evaluated on the mock path.

The NIC and Gmail modules additionally accept optional `client` / `createClient` /
`createTransport` / `connect` factory parameters as test-only injection seams, which is how the
suite exercises them without network access.

## Known limitations

Documented here because they are architectural, not incidental:

1. **Case-level authorization is absent.** `authorizeAttachmentAccess` checks only that a session
   exists, because the server holds no Query Case records to check ownership against. Any
   authenticated user can read any attachment by id. The server prints this warning at boot.
2. **Workflow-state authorization is half-enforced** — `verifyAction` covers the role half of
   `canPerform(role, action, state)`; the state half needs server-side case state.
3. **Sessions are stateless** — logout clears the cookie, but a copied token remains valid until it
   expires.
4. **`constants/capabilities.js`** (NIC agent autonomy) is tested but wired into no route.

All four resolve on the same dependency: server-side Query Cases. See
[workflow-engine.md](./workflow-engine.md) for the model the backend should implement.
