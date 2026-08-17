# Backend Architecture & Development Rules

These rules apply strictly to developers and AI working in the `/backend` directory.

## 1. Controller-Service Pattern

To enforce separation of concerns, always split request handling from business logic:
- **Routes (`src/routes/`)**: Map endpoint URL strings to controller functions, injecting validation and auth middlewares.
- **Controllers (`src/controllers/`)**: Parse query strings/body parameters, execute Zod/Joi schema validation, call the appropriate service method, and respond with HTTP status codes.
- **Services (`src/services/`)**: Contain database operations, calculation engines, external integration pipelines, and event dispatch logic. Keep services stateless where possible.

## 2. Middleware Chain Standards

Configure routes to pass through this sequential pipeline:
1. **Security**: Helmet, CORS configs, Rate Limiting.
2. **Authentication**: `verifyToken` (extracts JWT from HTTP-only cookie, decodes user identity).
3. **Authorization**: `verifyRole` (checks claims against the permitted roles for the target route).
4. **Validation**: Validate request body/params using Zod/Joi schema middleware.
5. **Controller Handler**: Core execution route.
6. **Global Error Handler**: Catches throwing errors, formats JSON outputs, and blocks detailed trace leakage in production.

## 3. Real-Time Operations (Socket.IO)

- **Connection Hub**: Initialize Socket.IO within `server.js` and export standard event handlers.
- **Room Organization**: Scopes socket events into channels based on case IDs or user roles (e.g., `joinCaseRoom(caseId)`).
- **Authentication**: Bind connection auth checks to verify JWTs before acknowledging handshake events.

## 4. API Integrity

- **Status Code Mapping**: Use precise HTTP statuses:
  - `200 OK` (GET/PUT success).
  - `201 Created` (POST success).
  - `400 Bad Request` (payload verification failure).
  - `401 Unauthorized` (missing/invalid JWT).
  - `403 Forbidden` (RBAC violation).
  - `404 Not Found` (missing resource record).
  - `500 Internal Server Error` (unexpected server crashes).
