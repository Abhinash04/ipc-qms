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
