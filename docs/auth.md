# Development Authentication

**Development only.** This file documents the seeded development accounts and how to sign in
against a local backend. It contains **no passwords, tokens, API keys or NIC/Gmail credentials** —
the sign-in password is referenced by environment variable name only, so this file is safe to keep
in version control.

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
| `QMS_SEED_PASSWORD` | yes | the sign-in password for **every** seeded account below |
| `SESSION_TTL_SECONDS` | no | defaults to `28800` (8 hours) |
| `SESSION_COOKIE_NAME` | no | defaults to `qms.session` |
| `SESSION_COOKIE_SAMESITE` | no | `lax` (default), `strict`, or `none` for cross-site deployments |

> **The password for all accounts below is the value of `QMS_SEED_PASSWORD` in `backend/.env`.**
> It is deliberately not written here. If you need it, read it from your own `.env`; if you are
> setting the project up, choose one and put it there.

---

## Accounts

Source of truth: `backend/src/constants/users.js`. All 13 accounts share the one seed password — and
so does a 14th, which exists only when `NIC_BROWSER_MAILBOX=true` ([below](#the-nicemail-front-office)).

### One per role — the set to test with

| Role | Name | Email | Lands on |
|---|---|---|---|
| `SUPER_ADMIN` | System Administrator | `admin@ipc.example` | `/super-admin/dashboard` |
| `ADMIN` | Suresh Gupta | `suresh.gupta@ipc.example` | `/admin/dashboard` |
| `FRONT_OFFICE` | Bhumika Makker | `bhoomikamakker@gmail.com` | `/front-officer/dashboard` |
| `OFFICER_IN_CHARGE` | Jatin Rawat | `rawatjatin436@gmail.com` | `/officer-in-charge/dashboard` |
| `ASSIGNED_OFFICIAL` | Neha Singh | `neha.singh@ipc.example` | `/assigned-official/dashboard` |
| `REVIEWER` | Amit Mehta | `amit.mehta@ipc.example` | `/reviewer/dashboard` |
| `INQUIRER` | Abhinash Pritiraj | `abhinash.pritiraj@gmail.com` | `/inquirer/dashboard` |

> **An `INQUIRER` account is not required to submit a query.** Real inquirers are external senders:
> they email the Front Office mailbox from their own mail client, hold no account here and never
> sign in. The sender is read off the incoming `From` header and stored on the case. This seeded
> account exists only to exercise the in-app **Raise Enquiry** test harness.

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

It signs in through `POST /auth/login` with `QMS_SEED_PASSWORD`. **Dev login refuses it** with 403
(`This account reads a live NICeMail mailbox. Sign in with a password.`) and records the attempt as
`LOGIN_FAILED` with result `denied`: its inbox is a live government mailbox, and its session can make
the browser agent send. It is not in the login page's development account list.

---

## What each role can reach

Routes are generated per role from `frontend/src/constants/permissions.js`; a section a role does
not have simply has no route. `roleHome()` picks the landing dashboard.

| Role | Sections |
|---|---|
| `INQUIRER` | Dashboard, Raise Enquiry, Query detail |
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
# Replace with your own value, or read it from backend/.env — do not commit it.
curl -i -X POST http://localhost:5000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@ipc.example","password":"'"$QMS_SEED_PASSWORD"'"}'

# Then reuse the cookie it sets:
curl -s http://localhost:5000/api/v1/auth/me -b 'qms.session=<token from the response>'
```

---

## Known limitations

These are development-mechanism properties, not bugs to be surprised by later.

1. **One shared password.** Every account authenticates against a single bcrypt hash derived from
   `QMS_SEED_PASSWORD` (`backend/src/services/auth/userDirectory.js`). There are no per-user
   credentials. Marked `TODO(phase-2)` in both `users.js` and `userDirectory.js`.
2. **Users live in source, not a database.** `backend/src/constants/users.js` is the authority for
   authentication; there is no user collection, so accounts cannot be created, disabled or have
   their password changed at runtime.
3. **Authorization is role-level only.** Any signed-in user can read any attachment by id, because
   Query Case ownership is not yet checked server-side. The server prints this warning at boot. Do
   not expose this backend outside a trusted network.
4. **No password rotation or per-account lockout** on `/auth/login`. Failed sign-ins are
   rate-limited per client address — 10 per 15 minutes, outside tests (`app.js`).
5. **Dev login needs no password.** `POST /auth/dev-login` answers whenever `NODE_ENV=development` —
   the default when `NODE_ENV` is unset — and the server listens on all interfaces, so anyone who can
   reach the port can sign in as any seeded account. That includes the primary Front Office, whose
   inbox may be a real Gmail account under `MAILBOX_SOURCE=gmail`. Only the NICeMail Front Office is
   refused. Do not run a development-mode backend where untrusted hosts can reach it.

Because of (1)–(5), this is a development authentication mechanism. Production needs per-user
credentials, resource-level authorization, and per-account lockout.
