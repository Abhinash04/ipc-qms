# Development Authentication

**Development only.** This file documents the seeded development accounts and how to sign in
against a local backend. It contains **no passwords, tokens, API keys or NICeMail credentials** —
every credential is referenced by environment variable name only, so this file is safe to keep in
version control.

Do not use these accounts, or this mechanism, in production. See
[Known limitations](#known-limitations).

---

## How sign-in works

`POST /api/v1/auth/login` with `{ email, password }` returns the public user record and sets an
**httpOnly session cookie** (default name `qms.session`, 8-hour TTL). The browser attaches that
cookie automatically, which is what lets attachment previews work — an `<img src>`, `<iframe src>`
or `<a download>` cannot send an `Authorization` header, but it does send the cookie.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/v1/auth/login` | public | obtain a session |
| `POST /api/v1/auth/logout` | public | clear the cookie, even if the token already expired |
| `POST /api/v1/auth/dev-login` | public, **development only** | sign in as a seeded account by `email` alone, **no password**. Answers 404 unless `NODE_ENV=development`. Refuses the NICeMail Front Office with 403 — see below |
| `GET /api/v1/auth/me` | cookie | who am I — used by the frontend on boot |

The frontend never stores the session: `useAuthStore` calls `/auth/me` at startup rather than
mirroring anything into `localStorage`.

### Required environment (backend/.env)

The server **refuses to boot** without these — see `validateAuthConfig()` in
`backend/src/config/authConfig.js`.

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | yes | at least 32 characters; generate with `openssl rand -base64 48` |
| `QMS_PASSWORDS_FILE` | one per account | a path to a JSON file of `userId` -> password, kept **outside** the repository. The production form: config then holds a path, not a set of secrets |
| `QMS_PASSWORD_<USER_ID>` | one per account | one account's own password, e.g. `QMS_PASSWORD_USR_0008`. Simpler for development; the value lives in gitignored `backend/.env` |
| `QMS_ALLOW_SHARED_PASSWORD` | no | `true` restores the legacy mode in which one `QMS_SEED_PASSWORD` opens **every** account, `SUPER_ADMIN` included. Left unset it is **on outside production** whenever `QMS_SEED_PASSWORD` is non-empty; `false` is the only value that cannot change meaning |
| `QMS_SEED_PASSWORD` | with the above | the one secret that mode falls back to |
| `SESSION_TTL_SECONDS` | no | defaults to `28800` (8 hours) |
| `SESSION_COOKIE_NAME` | no | defaults to `qms.session` |
| `SESSION_COOKIE_SAMESITE` | no | `lax` (default), `strict`, or `none` for cross-site deployments |

> **Each account below has its own password**, resolved per account by
> `backend/src/services/auth/credentials.js` — the file first, then the account's own variable, then
> the shared secret if that mode is on. The server refuses to start if any account has none, naming
> the account and the variable that would supply it. No value is written here: read them from your own
> `.env` or passwords file, and if you are setting the project up, choose them and put them there.

---

## Accounts

Source of truth: `backend/src/constants/users.js` — 12 accounts, each with a credential of its own,
and a 13th that exists only when `NIC_BROWSER_MAILBOX=true`
([below](#the-nicemail-front-office)).

### One per role — the set to test with

| Role | Name | Email | Lands on |
|---|---|---|---|
| `SUPER_ADMIN` | System Administrator | `admin@ipc.example` | `/super-admin/dashboard` |
| `ADMIN` | Suresh Gupta | `suresh.gupta@ipc.example` | `/admin/dashboard` |
| `FRONT_OFFICE` | Bhumika Makker | `bhumika.makker@ipc.example` | `/front-officer/dashboard` |
| `OFFICER_IN_CHARGE` | Jatin Rawat | `jatin.rawat@ipc.example` | `/officer-in-charge/dashboard` |
| `ASSIGNED_OFFICIAL` | Neha Singh | `neha.singh@ipc.example` | `/assigned-official/dashboard` |
| `REVIEWER` | Amit Mehta | `amit.mehta@ipc.example` | `/reviewer/dashboard` |

Every address is on `@ipc.example`, which RFC 2606 reserves and which cannot receive mail: a sign-in
identity is not somebody's inbox. Where mail actually goes is deployment configuration —
`FRONT_OFFICE_EMAIL`, `OFFICER_IN_CHARGE_EMAIL`, `NIC_EMAIL`.

> **There is no `INQUIRER` role, and an inquirer holds no account.** An inquirer is external: a member
> of the public emails the Front Office mailbox from their own mail client, and the sender is read off
> the incoming `From` header and stored on the case. They never sign in, and nothing in the
> application asks them to.

### The remaining accounts

Extra officials and a second reviewer, used to exercise assignment and multi-level review.

| Role | Name | Email | Division |
|---|---|---|---|
| `ASSIGNED_OFFICIAL` | Rawat Jatin | `rawat.jatin@ipc.example` | DIV-003 |
| `ASSIGNED_OFFICIAL` | Meera Iyer | `meera.iyer@ipc.example` | DIV-006 |
| `ASSIGNED_OFFICIAL` | Arjun Nair | `arjun.nair@ipc.example` | DIV-007 |
| `ASSIGNED_OFFICIAL` | Sana Qureshi | `sana.qureshi@ipc.example` | DIV-008 |
| `ASSIGNED_OFFICIAL` | Vikram Desai | `vikram.desai@ipc.example` | DIV-009 |
| `REVIEWER` | Kavita Rao | `kavita.rao@ipc.example` | DIV-002 |

### The NICeMail Front Office

Present only when `NIC_BROWSER_MAILBOX=true`, and built from configuration rather than listed in
`users.js` (`nicFrontOfficeUser()`), so it has no fixed address:

| Id | Role | Name | Email | Division |
|---|---|---|---|---|
| `USR-0014` | `FRONT_OFFICE` | the value of `NIC_FRONT_OFFICE_NAME` (default `NICeMail Front Office`) | the value of `NIC_EMAIL` | DIV-004 |

It is a Front Office user in every respect but one, its mailbox: listing, accepting, marking and
deleting messages always act on the NICeMail mailbox read by the browser agent (see
[NIC_BROWSER_AGENT.md §17](./NIC_BROWSER_AGENT.md#17-two-front-office-mailboxes)), and `?recipient=`
cannot point them anywhere else. It lands on `/front-officer/dashboard` and shares every case list.

It signs in through `POST /auth/login` with a credential of its own — `QMS_PASSWORD_USR_0014`, or a
`USR-0014` entry in the passwords file — like every other account. **Dev login refuses it** with 403
(`This account reads a live NICeMail mailbox. Sign in with a password.`) and records the attempt as
`LOGIN_FAILED` with result `denied`: its inbox is a live government mailbox, and its session can make
the browser agent send. It is not in the login page's development account list.

---

## What each role can reach

Routes are generated per role from `frontend/src/constants/permissions.js`; a section a role does
not have simply has no route. `roleHome()` picks the landing dashboard.

| Role | Sections |
|---|---|
| `FRONT_OFFICE` | Dashboard, IPC Mailbox, Queries, Query detail, Dispatch, Notifications |
| `OFFICER_IN_CHARGE` | Dashboard, Queries, Assignments, Approvals, Notifications, Reports |
| `ASSIGNED_OFFICIAL` | Dashboard, Queries, My Work, Drafting, Notifications |
| `REVIEWER` | Dashboard, Queries, My Work, Reviews, Notifications |
| `ADMIN` | Dashboard, Queries, Notifications, Reports, **Administration console** (Audit Trail, Email Activity, AI Agent, Users, Roles, Divisions, Workflows, Categories) |
| `SUPER_ADMIN` | Everything ADMIN has, **plus System Settings** and every operational section |

`SUPER_ADMIN` is a strict superset of `ADMIN`; the difference is `ADMIN_SETTINGS`
(`/super-admin/administration/settings`), which `ADMIN` has no route to at all.

---

## Verification

Run against a local backend on port 5000 (`cd backend && npm start`).

> The result below is left exactly as it was recorded on the day. Two things have changed since:
> accounts no longer share one password, each authenticating against its own credential, and the
> `INQUIRER` role and its account are gone. Its row is what was observed then, not a role the system
> still has.

### Result — 2026-09-10

Every account authenticated, `GET /auth/me` returned the expected role, and the session cookie was
set in all cases.

| Role | `POST /auth/login` | Cookie set | `GET /auth/me` role | `GET /audit` |
|---|---|---|---|---|
| `SUPER_ADMIN` | 200 | yes | `SUPER_ADMIN` | **200** |
| `ADMIN` | 200 | yes | `ADMIN` | **200** |
| `FRONT_OFFICE` | 200 | yes | `FRONT_OFFICE` | 403 |
| `OFFICER_IN_CHARGE` | 200 | yes | `OFFICER_IN_CHARGE` | 403 |
| `ASSIGNED_OFFICIAL` | 200 | yes | `ASSIGNED_OFFICIAL` | 403 |
| `REVIEWER` | 200 | yes | `REVIEWER` | 403 |
| `INQUIRER` | 200 | yes | `INQUIRER` | 403 |

The six additional accounts (`rawat.jatin`, `meera.iyer`, `arjun.nair`, `sana.qureshi`,
`vikram.desai`, `kavita.rao`) also returned 200 with their expected roles.

A deliberately wrong password returned **401 `Invalid email or password`** — the same message an
unknown address gets, so a failed sign-in cannot be used to enumerate accounts.

`GET /audit` is the RBAC probe: it is gated `verifyToken` → `verifyRole([ADMIN, SUPER_ADMIN])`, and
the 403s above confirm the operational roles are refused at the **backend**, not only in the UI.

### Reproducing it

```bash
# Each account has its OWN password. Read this one from wherever you configured it:
# its entry in QMS_PASSWORDS_FILE, or QMS_PASSWORD_USR_0008. Do not commit it.
# QMS_SEED_PASSWORD opens this account only while the shared-password mode is on,
# which it must not be in production.
curl -i -X POST http://localhost:5000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@ipc.example","password":"'"$QMS_PASSWORD_USR_0008"'"}'

# Then reuse the cookie it sets:
curl -s http://localhost:5000/api/v1/auth/me -b 'qms.session=<token from the response>'
```

---

## Known limitations

These are development-mechanism properties, not bugs to be surprised by later.

1. **The shared-password mode still exists.** Each account authenticates against its own bcrypt
   hash (`backend/src/services/auth/credentials.js`), but `QMS_ALLOW_SHARED_PASSWORD=true` restores
   the mode in which one `QMS_SEED_PASSWORD` opens every account, `SUPER_ADMIN` included — and left
   unset, that mode is on outside production whenever `QMS_SEED_PASSWORD` is non-empty. Set it to
   `false` once every account has a credential of its own.
2. **Users live in source, not a database.** `backend/src/constants/users.js` is the authority for
   authentication; the `User` collection is seeded on connect but is **not read for** it, and
   `models/User.js`'s `active` flag is not read at all — so accounts cannot be created, disabled or
   have their password changed at runtime. Marked `TODO(phase-2)` in both `users.js` and
   `userDirectory.js`.
3. **Authorization bounds which cases, not what may be written.** Case-level access *is* enforced
   server-side — `services/authz/caseAccess.js` scopes reads, `middleware/authorizeCaseDelta.js`
   guards `POST /queries/persist`, and `middleware/authorizeAttachmentAccess.js` admits an attachment
   only to a principal party to its case. What is missing behind them is a workflow state machine: a
   principal party to a case may write any field on it, and Front Office, Officer-in-Charge, Admin and
   Super Admin reach every case. The server prints this warning at boot. Do not expose this backend
   outside a trusted network.
4. **No password rotation or per-account lockout** on `/auth/login`. Failed sign-ins are
   rate-limited per client address — 10 per 15 minutes, outside tests (`app.js`).
5. **Dev login needs no password.** `POST /auth/dev-login` answers whenever `NODE_ENV=development` —
   the default when `NODE_ENV` is unset — and the server listens on all interfaces, so anyone who can
   reach the port can sign in as any seeded account. That includes the primary Front Office, whose
   inbox may be a real NICeMail mailbox under `MAILBOX_SOURCE=nic`. Only the NICeMail Front Office is
   refused. Do not run a development-mode backend where untrusted hosts can reach it.

Because of (1)–(5), this is a development authentication mechanism. Production needs a real user
directory, the shared-password mode off, workflow-state enforcement, token revocation and
per-account lockout.
