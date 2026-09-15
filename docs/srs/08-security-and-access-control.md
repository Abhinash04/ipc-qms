# 8. Security and Access Control

## 8.1 RBAC Model

Access is governed by the roles defined in
[03-stakeholders-and-roles.md](./03-stakeholders-and-roles.md). Each role maps to a set of
allowed route prefixes / actions — see
[workflow/role-permission-matrix.md](../workflow/role-permission-matrix.md). Role hierarchy
(Super Admin → Admin → the operational roles) reflects configuration seniority only; it does
not implicitly grant workflow actions.

**Enforced on both sides.** The frontend gate (`frontend/src/routes/ProtectedRoute.jsx`,
`constants/permissions.js`) shapes navigation and refuses another role's URL namespace, but it is
**not** the security boundary. The backend enforces its own per-route chain — `verifyToken` →
`verifyRole`/`verifyAction` — and both guards fail closed with 401 if no principal is present, so a
route mis-wired to omit authentication breaks loudly rather than silently allowing access.

## 8.2 Authentication

**Implemented.** `POST /api/v1/auth/login` verifies credentials against the seeded directory
(bcrypt) and sets a JWT in an **httpOnly cookie** (`qms.session`, 8-hour default TTL);
`middleware/verifyToken.js` puts the principal on `req.user`. The cookie rather than an
`Authorization` header is what makes attachment preview work — `<img>`, `<iframe>` and
`<a download>` cannot carry a header.

The server refuses to start without `JWT_SECRET` (≥32 characters) and `QMS_SEED_PASSWORD`.
Sign-in answers with one message for an unknown address and a wrong password alike, and runs the
bcrypt compare even for an unknown email, so neither the response nor its timing enumerates
accounts.

**Remaining limitations**, all deliberate and documented:

- **Case-level authorization is absent** — any authenticated user can read any attachment by id,
  because the server holds no Query Case records to check ownership against.
- **Workflow-state authorization is half-enforced** — `verifyAction` covers the role half of
  `canPerform(role, action, state)`, not the state half.
- **No token revocation** — logout clears the cookie, but a copied token stays valid until expiry.
- **No per-user credentials** — accounts are seeded from source and share one development password.
  See [docs/auth.md](../auth.md).

## 8.3 Data Protection

- No secrets committed to source control; `.env.example` files document required variables
  without real values.
- Backend responses must not leak stack traces or internal errors in production
  (`NODE_ENV=production` suppresses them — see `backend/src/middleware/errorHandler.js`).
- Query attachments and drafts are sensitive — access must be scoped to users with a
  legitimate role in that query's workflow. **This is not yet enforced**: attachment routes require
  a session and a role, but not a relationship to the case (`middleware/authorizeAttachmentAccess.js`
  carries the TODO, and the server prints the warning on every boot). Until it lands, do not expose
  the backend outside a trusted network.

## 8.4 Open Items

Multi-role users, cross-division assignment, and delegation are open — see
[14-open-questions-and-client-clarifications.md](./14-open-questions-and-client-clarifications.md#roles).
