# Backend Architecture

## Pattern

Per `.claude/backend-rules.md`, the backend follows a Controller → Service separation:

- **Routes** (`src/routes/`) map URL + method to a controller function. `src/routes/index.js`
  is the single mount point, aggregated under `/api/v1` in `src/app.js`.
- **Controllers** (`src/controllers/`) parse the request, will call the appropriate service,
  and shape the HTTP response. Today only `healthController.js` exists.
- **Services** (`src/services/`) will hold business logic and database access, kept stateless.
  Empty in this phase — reserved for query/assignment/workflow logic once persistence exists.
- **Models** (`src/models/`) will hold the PostgreSQL data-access layer once a query builder
  or ORM is chosen. Empty in this phase.
- **Validators** (`src/validators/`) will hold Zod/Joi request-body schemas. Empty in this
  phase.

## Middleware Chain

`src/app.js` assembles, in order:

1. `helmet()` — security headers.
2. `cors({ origin: env.CLIENT_URL })` — restrict cross-origin access to the configured
   frontend URL.
3. `morgan()` — request logging (`dev` format in development, `combined` in production).
4. `express.json()` — body parsing.
5. `/api/v1` routes.
6. `notFound` — 404 handler for unmatched routes.
7. `errorHandler` — centralized error formatter; hides stack traces outside development.

Future middleware (not yet added, per `backend-rules.md`'s intended chain): rate limiting,
`verifyToken` (JWT from httpOnly cookie), `verifyRole` (RBAC check against the route's
permitted roles), then per-route Zod/Joi validation — inserted between CORS/security and the
controller.

## Error Handling

`errorHandler` (`src/middleware/errorHandler.js`) maps a thrown error's `.status` to the HTTP
response code (defaulting to 500), and only includes `.stack` when `NODE_ENV=development`.
Controllers/services should throw `Error` objects with a `.status` property rather than
crafting response JSON themselves, once business logic exists.

## Status Codes

Per `backend-rules.md` §4: `200` GET/PUT success, `201` POST success, `400` validation
failure, `401` missing/invalid auth, `403` RBAC violation, `404` missing resource, `500`
unexpected failure. Centralized in `src/constants/httpStatus.js`.

## PostgreSQL Readiness

No database client or ORM is installed yet — `DATABASE_URL` is defined in
`.env.example`/`src/config/env.js` as an unused placeholder. `models/` and `services/` are
structured so a future query-builder (e.g. `pg`, Knex, or Prisma without TypeScript) can be
introduced without restructuring the app.
