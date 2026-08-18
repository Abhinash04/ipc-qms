# 8. Security and Access Control

## 8.1 RBAC Model

Access is governed by the roles defined in
[03-stakeholders-and-roles.md](./03-stakeholders-and-roles.md). Each role maps to a set of
allowed route prefixes / actions — see
[workflow/role-permission-matrix.md](../workflow/role-permission-matrix.md). Role hierarchy
(Super Admin → Admin → the operational roles) reflects configuration seniority only; it does
not implicitly grant workflow actions.

**Current phase**: the frontend implements this as a display-only gate (mock session, no real
tokens) — see `frontend/src/store/useAuthStore.js`, `frontend/src/constants/permissions.js`,
and `frontend/src/routes/ProtectedRoute.jsx`. This is not a security boundary; it only shapes
the prototype UI. Real authorization must be enforced server-side once the backend exists.

## 8.2 Authentication (Future)

Not implemented in this phase. `backend-rules.md` anticipates a JWT-in-httpOnly-cookie
approach with a `verifyToken` → `verifyRole` middleware chain (see
[architecture/backend-architecture.md](../architecture/backend-architecture.md)); the exact
provider/flow is to be confirmed with the client.

## 8.3 Data Protection

- No secrets committed to source control; `.env.example` files document required variables
  without real values.
- Backend responses must not leak stack traces or internal errors in production
  (`NODE_ENV=production` suppresses them — see `backend/src/middleware/errorHandler.js`).
- Query attachments and drafts are sensitive — access must be scoped to users with a
  legitimate role in that query's workflow once real authorization exists.

## 8.4 Open Items

Multi-role users, cross-division assignment, and delegation are open — see
[14-open-questions-and-client-clarifications.md](./14-open-questions-and-client-clarifications.md#roles).
