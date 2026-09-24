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

**Case scope, on top of role.** A role allow-list naming every role denies nothing, so membership of
the case is the substance. `services/authz/caseAccess.js` answers which cases a principal is party
to — Front Office, Officer-in-Charge, Admin and Super Admin see everything, an Assigned Official and
a Reviewer only the cases they are on — and `GET /queries` is filtered by it.
`middleware/authorizeCaseDelta.js` guards `POST /queries/persist` against state as stored *before*
the delta, and `middleware/authorizeAttachmentAccess.js` resolves an attachment's owning case and
admits only a principal party to it. All three fail closed with **503** when there is no store,
because "cannot tell" must never widen to "allowed".

## 8.2 Authentication

**Implemented.** `POST /api/v1/auth/login` verifies credentials against the seeded directory
(bcrypt) and sets a JWT in an **httpOnly cookie** (`qms.session`, 8-hour default TTL);
`middleware/verifyToken.js` puts the principal on `req.user`. The cookie rather than an
`Authorization` header is what makes attachment preview work — `<img>`, `<iframe>` and
`<a download>` cannot carry a header.

The server refuses to start without `JWT_SECRET` (≥32 characters) and a credential for **every**
seeded account — resolved per account from `QMS_PASSWORDS_FILE` or `QMS_PASSWORD_<USER_ID>`, and the
boot failure names each account and the variable that would supply it. Sign-in answers with one
message for an unknown address and a wrong password alike, and runs the bcrypt compare even for an
unknown email, so neither the response nor its timing enumerates accounts.

**Remaining limitations**, all deliberate and documented:

- **Workflow-state authorization is half-enforced** — `verifyAction` covers the role half of
  `canPerform(role, action, state)`, not the state half.
- **No token revocation** — logout clears the cookie, but a copied token stays valid until expiry.
- **The user directory is a source-code constant** — each account has its own credential now, but
  `backend/src/constants/users.js` cannot be changed without a redeploy, and `models/User.js`'s
  `active` flag is not read by the auth path. See [docs/auth.md](../auth.md).
- **`POST /queries/reset` has no production refusal** — it deletes every case in the system, and
  `verifyRole(SUPER_ADMIN)` is the whole of its protection.

## 8.3 Data Protection

- No secrets committed to source control; `.env.example` files document required variables
  without real values.
- Backend responses must not leak stack traces or internal errors in production
  (`NODE_ENV=production` suppresses them — see `backend/src/middleware/errorHandler.js`).
- Query attachments and drafts are sensitive — access must be scoped to users with a
  legitimate role in that query's workflow. **This is enforced.**
  `middleware/authorizeAttachmentAccess.js` resolves an attachment's owning case — through the
  message it arrived on, when the attachment predates the case — and admits only a principal party
  to it; an attachment with no case yet is readable by its uploader and by the roles that see
  everything, and by nobody else. What remains unenforced is the workflow-state half of `canPerform`
  and token revocation, which is why the server still prints a warning on every boot and why this
  should not be exposed outside a trusted network.

## 8.4 Open Items

Multi-role users, cross-division assignment, and delegation are open — see
[14-open-questions-and-client-clarifications.md](./14-open-questions-and-client-clarifications.md#roles).
