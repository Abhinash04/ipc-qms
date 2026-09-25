# Environment Configuration

This is the single reference for configuration. It covers every environment variable the backend and
frontend read, which env file supplies them, and what differs between a developer machine and
production. It contains **no secret values**: secrets are named here, never shown. Other documents
link here instead of repeating these tables.

Checked against the code on 2026-09-25: `backend/src/config/env.js`, `authConfig.js`, `nicConfig.js`,
`browserConfig.js`, `identities.js`, `db.js`, `backend/src/services/auth/credentials.js`,
`frontend/src/services/api/axiosClient.js` and `frontend/src/pages/auth/LoginPage.jsx`.

1. [How the backend loads configuration](#1-how-the-backend-loads-configuration)
2. [Files](#2-files)
3. [Backend variables](#3-backend-variables)
4. [Frontend variables](#4-frontend-variables)
5. [Profiles (local)](#5-profiles-local)
6. [Production](#6-production)
7. [Checking a configuration without a server](#7-checking-a-configuration-without-a-server)

## At a glance

| | Backend | Frontend |
|---|---|---|
| **Secret.** Never in a tracked file, a chat, a ticket or a screenshot | `DATABASE_URL`, `JWT_SECRET`, `QMS_SEED_PASSWORD`, every `QMS_PASSWORD_<USER_ID>`, `NIC_APP_PASSWORD`, and the **contents** of the files that `QMS_PASSWORDS_FILE` and `NIC_APP_PASSWORD_FILE` name | none: every `VITE_` value is public, because it is compiled into the bundle |
| **Local only.** Never on the VM | `QMS_SEED_PASSWORD`, `NIC_BROWSER_VIEWER`, `NODE_ENV=development`, `EMAIL_TRANSPORT=mock` | `VITE_NIC_FRONT_OFFICE_EMAIL` |
| **Production values.** Different from, or absent on, a developer machine | `NODE_ENV=production`, `CLIENT_URL` (the Render origin), a separate-cluster `DATABASE_URL`, `QMS_PASSWORDS_FILE`, `QMS_ALLOW_SHARED_PASSWORD=false`, `EMAIL_TRANSPORT=nic`, real `FRONT_OFFICE_*` and `OFFICER_IN_CHARGE_*`, `NIC_EMAIL=lab.ipc@gov.in`, `NIC_IMAP_HOST` and `NIC_SMTP_HOST`, an absolute `ATTACHMENT_DIR` | `VITE_API_BASE_URL=/api/v1`, set on Render |

---

## 1. How the backend loads configuration

The backend reads its settings from `process.env`. Before anything else runs,
`backend/src/config/env.js` fills `process.env` from **exactly one** env file. It **never overrides a
variable that is already set** in the real environment, even when that variable is set to an empty
value. Every file name is resolved against `backend/`, whatever the working directory. The file is
chosen in this order:

1. **`ENV_FILE`**, if it is set in the real environment. That file is loaded and nothing else. A
   relative name is resolved against `backend/`; an absolute path is used as it is. If the file does
   not exist, the process stops with `Could not load the env file <path>`. Written *inside* an env file,
   `ENV_FILE` does nothing.
2. **`.env.production`**, when `NODE_ENV=production` is set in the real environment. If that file is
   missing, no file is loaded; the loader never falls back to `.env.local` here.
3. Otherwise, the first of these that exists: **`.env.local`**, then the legacy **`.env`**. Loading
   `.env` prints `[qms] backend/.env is deprecated; rename it to backend/.env.local`.
4. If none of them exists, no file is loaded and the code defaults apply.

`.env.production` is **never loaded outside production**, so a template of it on a developer machine
does nothing. The `NODE_ENV=production` line inside `.env.production` does not select the file. It
only takes effect when `ENV_FILE` names the file.

**Which file was loaded.** At start, dotenv prints its own line:

```text
◇ injected env (28) from .env.local // tip: …
```

- The path is shown relative to the working directory.
- `N` counts only the keys taken from the file. A key already set in the environment is not counted.
- If the configuration is refused, the error ends with `(env file: <absolute path>)`, or with
  `(env file: none)` when no file was loaded. On the VM, `none` means `NODE_ENV=production` did not
  reach the process.

**Every entry point uses this loader.** That covers:
- `npm start` and `npm run dev`;
- `db:provision`, `db:reset` and `mailbox:purge`;
- `nic:verify`, `nic:browser:discover` and `nic:browser:calibrate`;
- `draft:trace`, `draft:eval` and `triage:eval`;
- `node src/scripts/testGemmaLive.js` and `testRecommendationLive.js`.

The exceptions are `npm run nic:preflight`, a standalone reachability probe that loads no file and
reads `NIC_EMAIL` (or `--email=`) and `NIC_APP_PASSWORD_FILE` from the real environment only, and
`npm run ingest:ipc`, which reads no configuration.

`npm test` in `backend/` sets its own values in `backend/vitest.config.mjs`: `NODE_ENV=test`, a test
`JWT_SECRET`, the fixture passwords file and blank `NIC_*` keys. Those win over any file. The loader
still runs, so a developer's `.env.local` fills in only the keys the suite leaves unset.

**Relative paths.** Different variables resolve against different directories:

| Resolved against | Variables |
|---|---|
| `backend/` | `ENV_FILE`, the automatically chosen files, `ATTACHMENT_DIR` |
| the working directory | `QMS_PASSWORDS_FILE`, `NIC_APP_PASSWORD_FILE`, `NIC_BROWSER_ARTIFACT_DIR` |

So `ENV_FILE=.env.e2e` works from any directory. `ENV_FILE=backend/.env.e2e` typed at the repository
root looks for `backend/backend/.env.e2e`, and the process stops. On the VM, give the three
working-directory paths as absolute paths, and start the backend from `backend\`.

---

## 2. Files

| File | Tracked | Loaded by | Holds |
|---|---|---|---|
| `backend/.env.example` | yes | nobody; it is the template for `.env.local` | The variables a deployment normally sets, with no comments and no working secret. `JWT_SECRET` is empty, so a fresh copy refuses to start until you fill it. Keys left out on purpose: [§3.11](#311-advanced-code-defaults-not-in-envexample) |
| `backend/.env.local` | no | a developer's backend and scripts | The local profile ([§5](#5-profiles-local)) |
| `backend/.env` | no | legacy: loaded only when there is no `.env.local`, with a warning | Rename it to `.env.local` |
| `backend/.env.production` | no | the production VM's backend, selected by `NODE_ENV=production` in the real environment (or named by `ENV_FILE`) | The production values ([§6.1](#61-vm-backend-backendenvproduction)). On a developer machine this is at most a template with the secrets empty, and it is never loaded there. The filled file exists only on the VM |
| `backend/.env.e2e` | yes | the Playwright suite, which starts the backend with `ENV_FILE=.env.e2e` | A self-contained, credential-free test configuration: its own test-only `JWT_SECRET` and the local `qms_e2e` database. Nothing is inherited from a developer's env file. Playwright points `QMS_PASSWORDS_FILE` at `backend/src/test/fixtures/passwords.json` |
| `frontend/.env.example` | yes | nobody; it is the template for `frontend/.env.local` | `VITE_API_BASE_URL` and an empty `VITE_NIC_FRONT_OFFICE_EMAIL` |
| `frontend/.env.local` | no | the Vite dev server, and any `vite build` run on that machine | [§4](#4-frontend-variables) |
| Render dashboard | — | the production frontend build | `VITE_API_BASE_URL=/api/v1` and `NODE_VERSION=22`. Nothing secret ([§6.2](#62-render-static-site)) |

The root `.gitignore` ignores `.env` and every `.env.*`, except the `.env.example` files and
`backend/.env.e2e`; `frontend/.gitignore` also ignores `*.local`. Never commit any of these:
- a real env file;
- a passwords file or an app-password file;
- a database URI that contains a password.

---

## 3. Backend variables

**How to read the tables:**
- **Required:**
  - **both**: needed on developer machines and in production.
  - **production**: needed, or needs a production-specific value, when `NODE_ENV=production`.
  - **local**: developer machines only, never on the VM.
  - **optional**: the default is right; set it only to change it.
  - **advanced**: also optional, and deliberately left out of `backend/.env.example` ([§3.11](#311-advanced-code-defaults-not-in-envexample)).
- **Secret: yes** means the value never goes in a tracked file, a chat, a ticket or a screenshot.
- **Default** is the code's value when the variable is unset.

**Switches.** Only `true` turns on `NIC_BROWSER_MAILBOX`, `NIC_BROWSER_VIEWER`, `NIC_ALLOW_OUTBOUND` and
`NIC_ALLOW_INTERNAL_FORWARD`; anything else leaves them off. `MAILBOX_SYNC_ENABLED` and
`MAILBOX_RETENTION_ENABLED` work the other way round: only `false` turns them off.

### 3.1 Server and database

| Variable | Required | Secret | Default | Purpose |
|---|---|---|---|---|
| `NODE_ENV` | both: `development` locally, `production` on the VM | no | `development` | `production` switches on every production rule: the boot refusals in [§6.3](#63-boot-refusals), a `Secure` session cookie, `trust proxy` (one hop), a required `DATABASE_URL`, a full index sync even on a shared database, and generic 5xx bodies. It also refuses `POST /mailbox/receive` and the destructive routes. **Unset means `development`**, which answers password-less dev login for every seeded account except the NICeMail Front Office. On the VM it must be in the real environment, because that is what selects `.env.production` ([§1](#1-how-the-backend-loads-configuration)). The backend unit tests (Vitest) set `test`; the Playwright backend runs as `development` from `.env.e2e` |
| `PORT` | optional | no | `5000` | The listen port, on all interfaces; there is no bind-address setting. On the VM only the reverse proxy may reach it, as `http://127.0.0.1:5000`. Firewall it from the network |
| `CLIENT_URL` | production | no | `http://localhost:5173` | The one origin CORS allows, with credentials. Production: the Render site origin `https://<render-site>`, exactly (scheme and host, no trailing slash). Not checked at boot. Behind the same-origin rewrite a wrong value is not load-bearing, but set it anyway |
| `DATABASE_URL` | production; locally in practice | **yes** | empty | The MongoDB URI. Its path must name the database, or startup stops. **Local:** the shared development Atlas database (`query_management_system`, one Atlas user per developer) or a local MongoDB. Left empty, the mailbox and audit trail run in memory and Query Cases answer 503. **Production:** a **separate Atlas cluster** with its own project, its own database user and an IP access list holding only the VM, and the database `qms_production`. Never point it at the development database: production startup syncs indexes (dropping undeclared ones) and always runs retention. A `mongodb+srv://` URI, or any host other than loopback, counts as *shared*: outside production, startup only adds indexes, and resets and wipes are refused. If the database is unreachable within 15 s, startup stops |

### 3.2 Auth and session

| Variable | Required | Secret | Default | Purpose |
|---|---|---|---|---|
| `JWT_SECRET` | both | **yes** | empty | Signs the session token. Required in every environment, at least 32 characters. Generate one with `openssl rand -base64 48`. Use a different value in production; never reuse a development one |
| `QMS_PASSWORDS_FILE` | production (local: optional) | path no; **contents yes** | empty | The path to a JSON object of user id → password, for example `{ "USR-0003": "…" }`. It is read relative to the **working directory**, so use an absolute path on the VM, kept outside the checkout. In production it must cover USR-0003 through USR-0014. If the file is set but unreadable, not JSON, or not an object, startup stops |
| `QMS_PASSWORD_<USER_ID>` | optional (instead of the file) | **yes** | — | One account's own password. The key is `QMS_PASSWORD_` plus the user id with each non-alphanumeric character turned into `_`, in upper case: `QMS_PASSWORD_USR_0003` through `QMS_PASSWORD_USR_0013`, plus `QMS_PASSWORD_USR_0014` when the NICeMail Front Office exists |
| `QMS_SEED_PASSWORD` | local | **yes** | empty | The shared development password. In auto mode (next row) it is the password of every account that has no credential of its own, outside production only. Never on the VM |
| `QMS_ALLOW_SHARED_PASSWORD` | production (`false`) | no | empty, meaning auto | `true`: the seed password opens every account without its own credential, `SUPER_ADMIN` included, **even in production**. `false`: shared mode is off everywhere. Unset, or any other value: shared mode is on outside production whenever `QMS_SEED_PASSWORD` is set. Leave it unset locally, and set `false` in production. `true` with an empty `QMS_SEED_PASSWORD` stops boot |
| `SESSION_TTL_SECONDS` | optional | no | `28800` (8 h) | Session lifetime. It must be positive |
| `SESSION_COOKIE_NAME` | advanced | no | `qms.session` | The session cookie's name |
| `SESSION_COOKIE_SAMESITE` | optional | no | `lax` | `lax`, `strict` or `none`; anything else stops boot. **Keep `lax`**: production is same-origin through the Render rewrite. `none` forces `Secure` and is only for a cross-site deployment, which is not supported: there, text and PDF attachment previews break, and browsers that block third-party cookies fail outright |

**Which accounts need a credential:**
- USR-0003 through USR-0013, the 11 accounts in `backend/src/constants/users.js`.
- USR-0014, the NICeMail Front Office, whenever `NIC_BROWSER_MAILBOX=true` and `NIC_EMAIL` is set.

If any account has no credential, boot stops and names each such account with the variable that would
supply it. For each account the backend looks first in the passwords file, then at
`QMS_PASSWORD_<USER_ID>`, then at the shared seed password when shared mode is on. Dev login refuses
USR-0014, so that account always signs in with a password. Accounts and roles are listed in
[auth.md](./auth.md).

### 3.3 Mail channel and identities

`FRONT_OFFICE_*` and `OFFICER_IN_CHARGE_*` are read as `<ROLE>_NAME` and `<ROLE>_EMAIL` for the two
roles in `backend/src/config/identities.js`. Their defaults are placeholder `@example.com` identities,
which production rejects.

| Variable | Required | Secret | Default | Purpose |
|---|---|---|---|---|
| `EMAIL_TRANSPORT` | production (`nic`) | no | `mock` | `mock` or `nic`; anything else stops boot. It is the channel for mail on cases that did **not** arrive through the browser agent. NICeMail cases always go out through the agent, whatever this says. `mock` records mail as sent without sending it, and is the local value. **Production refuses `mock`, even with `NIC_BROWSER_MAILBOX=true`, so production must set `nic`.** `nic` then requires `NIC_EMAIL`, `NIC_IMAP_HOST` and `NIC_SMTP_HOST` at boot ([§3.5](#35-nicemail-imapsmtp-dormant)) |
| `MAILBOX_SOURCE` | optional (keep `auto`) | no | `auto` | Where the **primary** Front Office inbox (the one `SUPER_ADMIN` sees) is read from. `auto`: MongoDB, or memory when there is no database. `nic`: a live, read-only IMAP view of `NIC_EMAIL`. That needs the app password, which has not been issued, and it brings in the [§3.5](#35-nicemail-imapsmtp-dormant) boot checks. Keep `auto` everywhere. The agent's NICeMail inbox is separate and always stored in MongoDB |
| `FRONT_OFFICE_EMAIL` | production | no | `front-office-unconfigured@example.com` | The primary Front Office identity. It is the primary inbox address and the sender on non-agent cases. The admin screens show it (`ipcQueryEmail` on `/emails/config`), and it is printed as `Query recipient` at start. **Production:** a real address (not empty, not `@example.com`) that **differs from `NIC_EMAIL`** and **never mails the NICeMail inbox**: it is on the triage loop list, so mail from it is junked. Locally, leave it unset |
| `FRONT_OFFICE_NAME` | production (display) | no | `Front Officer (unconfigured)` | The display name paired with it. It is never validated: left empty, it shows as "(unconfigured)" |
| `OFFICER_IN_CHARGE_EMAIL` | production; local with `NIC_ALLOW_INTERNAL_FORWARD=true` | no | `officer-in-charge-unconfigured@example.com` | The recipient of the internal forward on **every** case, NICeMail cases included. It is also the one extra address that `NIC_ALLOW_INTERNAL_FORWARD` opens. It must be a real address in production. It is on the loop list too |
| `OFFICER_IN_CHARGE_NAME` | production (display) | no | `Officer-in-Charge (unconfigured)` | Display only, in the participant directory. The Officer-in-Charge is EduTR Zairza: set this name and that account's mailbox in `OFFICER_IN_CHARGE_EMAIL`, in the env file only |

### 3.4 NICeMail browser agent

The agent drives a headed Chrome that a person signed in to by hand. It holds no credential. Setup is
in [NIC_BROWSER_AGENT.md](./NIC_BROWSER_AGENT.md).

Turning the agent on (`NIC_BROWSER_MAILBOX=true`) adds the account USR-0014 and three boot rules:
- `NIC_EMAIL` must be set;
- `NIC_EMAIL` must differ from `FRONT_OFFICE_EMAIL`;
- a test recipient is required while outbound is closed.

The agent and IMAP/SMTP are
[two unrelated mechanisms](../backend/README.md#nicemail-two-separate-mechanisms).

| Variable | Required | Secret | Default | Purpose |
|---|---|---|---|---|
| `NIC_BROWSER_MAILBOX` | production (`true`); local on the mailbox host and on teammates | no | off | `true` turns on the second Front Office mailbox: the agent reads and sends as `NIC_EMAIL` through the signed-in Chrome |
| `NIC_BROWSER_VIEWER` | local (teammates only) | no | off | `true`: this backend lists the mail the mailbox host stored in the shared database, but never reads NICeMail (no sync, no Sync now). It refuses NICeMail sends before touching Chrome, so the email is recorded as failed; the host re-sends it by opening the case (Retry acknowledgement / Retry forwarding) or, for a final response, from the Dispatch page. It runs no retention sweep on a shared development database. Never set it in production |
| `NIC_EMAIL` | production (`lab.ipc@gov.in`); local with the agent | no | empty | The NICeMail address the agent reads and sends as, and USR-0014's sign-in email. Locally, the team's test account. Required whenever the agent is on or either `EMAIL_TRANSPORT` or `MAILBOX_SOURCE` is `nic` |
| `NIC_FRONT_OFFICE_NAME` | optional | no | `NICeMail Front Office` | USR-0014's display name, and the sender name recorded on NICeMail cases |
| `NIC_CDP_ENDPOINT` | optional | no | `http://localhost:9222` | Chrome's DevTools endpoint. **Never remote**: always a Chrome on the backend's own host, on localhost. CDP has no authentication, so whoever reaches it controls the signed-in government mailbox, and attachments are handed to Chrome by local file path. No tunnel, no port forward, no `--remote-debugging-address=0.0.0.0` |
| `NIC_BROWSER_TEST_RECIPIENT` | both, when the agent is on and `NIC_ALLOW_OUTBOUND` is not `true` | no | empty | The only address agent sends may reach while the interlock is closed. When the agent is on and outbound is not `true`, boot requires this or `NIC_TEST_RECIPIENT`. Use an address you read: your own on a developer machine, the agreed test inbox in production |
| `NIC_ALLOW_OUTBOUND` | production (`false` until go-live) | no | closed | `true` releases real sends to any recipient, for the agent and for SMTP. Anything else confines them to the test recipient, and a send to anyone else is refused before it is attempted. Set `true` only at go-live, under change control |
| `NIC_ALLOW_INTERNAL_FORWARD` | production (`true` during controlled testing) | no | closed | `true` opens one more address for agent sends while outbound is closed: `OFFICER_IN_CHARGE_EMAIL`, for the forward only. The address is re-derived on the server, never taken from a request. It requires a real `OFFICER_IN_CHARGE_EMAIL`. Without it, intake of a NICeMail case stops at the forward while the interlock is closed |
| `NIC_WEBMAIL_APP_URL` | optional | no | `https://mail.mgovcloud.in/zm/` | The NICeMail web-app URL the agent opens in its own tab |
| `NIC_BROWSER_TIMEOUT_MS` | optional | no | `20000` | The timeout for each CDP step and page wait during reads and sends |
| `NIC_BROWSER_SYNC_TTL_MS` | optional | no | `15000` | The minimum gap between two inbox syncs |
| `NIC_BROWSER_SYNC_MAX` | optional | no | `20` | The most messages read in one sync. A value that is not a positive whole number means 20 |
| `NIC_WEBMAIL_URL_PATTERNS` | advanced | no | `mail.gov.in,mgovcloud.in` | A comma-separated list of host fragments that mark a Chrome tab as NICeMail when the agent attaches |
| `NIC_WEBMAIL_TITLE_PATTERNS` | advanced | no | `mail,inbox,nic` | A comma-separated list of title words that add to that match |
| `NIC_BROWSER_ARTIFACT_DIR` | advanced (scripts only) | no | `storage/nic-browser` | Where `nic:browser:discover` and `nic:browser:calibrate` write their reports, relative to the working directory. The server never reads it |

### 3.5 NICeMail IMAP/SMTP (dormant)

IMAP/SMTP needs an application-specific password that NIC has not issued yet
([NIC_EMAIL_PHASE0.md](./NIC_EMAIL_PHASE0.md)). The browser agent uses **none** of these variables. They
are read by:
- `EMAIL_TRANSPORT=nic`, for cases that did not arrive through the agent;
- `MAILBOX_SOURCE=nic`;
- the `/api/v1/nic/*` diagnostics;
- `npm run nic:verify`.

**Why production still needs `NIC_IMAP_HOST` and `NIC_SMTP_HOST`.** Production refuses
`EMAIL_TRANSPORT=mock`, so it must run `nic`. `nic` makes boot check the NIC settings:
- `NIC_EMAIL`, `NIC_IMAP_HOST` and `NIC_SMTP_HOST` must be non-empty;
- both ports must be positive;
- `NIC_MAILBOX` must not be empty.

Nothing connects to the two hosts at boot, and no app password is needed. In an agent-only production
nothing feeds the primary inbox, because the development intake route is refused. So the SMTP path is
not expected to be reached.

| Variable | Required | Secret | Default | Purpose |
|---|---|---|---|---|
| `NIC_IMAP_HOST` | production | no | empty | `imap.mgovcloud.in`. Required at production boot, for the reason above. Connected to only by IMAP reads, `nic:verify` and `/nic/*`. `backend/.env.example` fills it in |
| `NIC_SMTP_HOST` | production | no | empty | `smtp.mgovcloud.in`. Same as `NIC_IMAP_HOST` |
| `NIC_IMAP_PORT` | advanced | no | `993` | Must be positive when NIC is selected |
| `NIC_IMAP_SECURE` | advanced | no | `true` | Only `false` turns TLS off |
| `NIC_SMTP_PORT` | advanced | no | `465` | Must be positive when NIC is selected |
| `NIC_SMTP_SECURE` | advanced | no | `true` | Only `false` turns TLS off |
| `NIC_MAILBOX` | advanced | no | `INBOX` | The IMAP folder. It must not be empty when NIC is selected |
| `NIC_TIMEOUT_MS` | advanced | no | `20000` | The IMAP/SMTP connection, greeting and socket timeout |
| `NIC_APP_PASSWORD_FILE` | advanced; only once NIC issues the app password | path no; **contents yes** | empty | The path to a file that holds the app password. This is the preferred form, and it wins over `NIC_APP_PASSWORD`. It is read on first use, not at boot, relative to the working directory. `nic:preflight` reads it too |
| `NIC_APP_PASSWORD` | advanced; not issued | **yes** | empty | The app password inline. It is never checked at boot. Prefer the file form |
| `NIC_TEST_RECIPIENT` | advanced | no | falls back to `NIC_EMAIL` | The one address SMTP sends may reach while `NIC_ALLOW_OUTBOUND` is not `true`. It is also the agent's fallback test recipient |

### 3.6 AI

| Variable | Required | Secret | Default | Purpose |
|---|---|---|---|---|
| `GEMMA_API_URL` | optional | no | `https://pravahai.aicte-india.org/llm/api/gemma` | The Pravah Gemma endpoint; no key is used. Enquiry text is sent to it, which is external data sharing. **An empty value turns AI off.** Summaries, recommendations and drafts then fall back to deterministic text, and junk triage runs on the rules alone. Leave the variable out rather than blank it, unless you mean to turn AI off |
| `GEMMA_TIMEOUT_MS` | optional | no | `12000` | The timeout per call. A recommendation gets 3× (36 s) and a draft 2× (24 s) |

### 3.7 Sync

The background sync copies the NICeMail inbox into MongoDB. It only does anything on a backend where:
- the agent is on;
- `NIC_EMAIL` is set;
- the database is connected.

A viewer never reads NICeMail. The sync never runs under `NODE_ENV=test`.

| Variable | Required | Secret | Default | Purpose |
|---|---|---|---|---|
| `MAILBOX_SYNC_ENABLED` | optional | no | `true` | Only `false` turns the sync off. Teammates set `false` |
| `MAILBOX_SYNC_INTERVAL_MS` | optional | no | `15000` | The tick interval, a whole number of at least 1000. Any other value stops boot; an empty one means the default. After failures it backs off to 2×, 4× and then 20× the interval |

### 3.8 Retention

**42 hours for junk and rejected mail, 14 days (336 hours) for anything still unregistered.** Purging
strips the body, the HTML and the attachments, and deletes the attachment bytes from `ATTACHMENT_DIR`.
It keeps a stub and writes an `EMAIL_PURGED` audit row; nothing else is deleted. Registered and rescued
mail are exempt. The full rules are in
[backend/README.md](../backend/README.md#junk-triage-and-retention).

**Where the sweep runs:**
- In **production**: always, when it is enabled.
- On a **shared development database**: only on the mailbox host, meaning `NIC_BROWSER_MAILBOX=true`
  and `NIC_BROWSER_VIEWER` not `true`.
- On a **local database**: on any backend where it is enabled.
- Under `NODE_ENV=test`: never.

**Timing.** The first pass runs 5 minutes after start, then the sweep runs hourly. Nothing is purged in
the first two hours after start. `npm run mailbox:purge` runs the same sweep by hand, with the same
values.

| Variable | Required | Secret | Default | Purpose |
|---|---|---|---|---|
| `MAILBOX_RETENTION_ENABLED` | optional | no | `true` | Only `false` turns the sweep off. Teammates set `false` |
| `MAILBOX_RETENTION_HOURS` | optional | no | `42` | Junk whose verdict reaches the confidence floor, and rejected mail, are purged this long after the verdict or decision. The value must be positive. **An empty value reads as 0 and stops boot** |
| `MAILBOX_UNREGISTERED_RETENTION_HOURS` | optional | no | `336` (14 days) | Anything still unregistered, whatever its verdict, is purged after this long. It must be positive and not shorter than `MAILBOX_RETENTION_HOURS` |
| `MAILBOX_JUNK_CONFIDENCE` | optional | no | `0.9` | The minimum model confidence for the junk tier. It must be 0 or more. **An empty value reads as 0, passes validation, and makes every junk verdict purgeable**, so never blank it |
| `MAILBOX_TRIAGE_BATCH` | optional | no | `25` | The number of messages the model classifies per sweep |
| `MAILBOX_PURGE_BATCH` | optional | no | `50` | The most purge candidates taken from each tier in one sweep |

### 3.9 Attachments

| Variable | Required | Secret | Default | Purpose |
|---|---|---|---|---|
| `ATTACHMENT_DIR` | production (absolute) | no | `storage/attachments`, under `backend/` | Where attachment bytes are stored. A relative value is resolved against `backend/`; an absolute one is used as it is. In production the agent writes the NICeMail attachments here and forwards read them back. Use an absolute path on a backed-up data disk, and back it up together with MongoDB, which only references the files. The bytes stay on the machine that stored them: on a shared development database, a teammate sees the attachment listed but cannot open it |
| `ATTACHMENT_MAX_FILE_MB` | optional | no | `10` | The per-file size cap, for uploads and for the attachments the agent reads |
| `ATTACHMENT_MAX_TOTAL_MB` | optional | no | `15` | The combined size cap for one upload |
| `ATTACHMENT_MAX_FILES` | optional | no | `10` | The most files in one upload |

### 3.10 Loader and tooling

| Variable | Required | Secret | Default | Purpose |
|---|---|---|---|---|
| `ENV_FILE` | optional (Playwright sets it) | no | unset | Names the one env file to load ([§1](#1-how-the-backend-loads-configuration)). It is resolved against `backend/`, and it is exclusive: a missing file stops the process. It works only from the real environment. Useful on the VM to keep the file outside the checkout |
| `DOTENV_CONFIG_QUIET` | optional | no | unset | Read by dotenv itself: `true` hides the `injected env` line. Leave it unset, because that line is how you see which file was loaded |
| `CI` | tooling | no | unset | Read by `frontend/playwright.config.js`, not by the backend: it forbids `.only` and stops a running Vite server from being reused |

### 3.11 Advanced: code defaults, not in `.env.example`

These keys are left out of `backend/.env.example` on purpose. The code default is right, and a copied
line would freeze that default in every developer's file. Set one only to change it.

- **IMAP/SMTP extras** ([§3.5](#35-nicemail-imapsmtp-dormant)): `NIC_IMAP_PORT`, `NIC_SMTP_PORT`,
  `NIC_IMAP_SECURE`, `NIC_SMTP_SECURE`, `NIC_MAILBOX`, `NIC_TIMEOUT_MS`, `NIC_TEST_RECIPIENT`.
- **App password** ([§3.5](#35-nicemail-imapsmtp-dormant)): `NIC_APP_PASSWORD` and
  `NIC_APP_PASSWORD_FILE`. A secret is never seeded from a template.
- **Agent** ([§3.4](#34-nicemail-browser-agent)): `NIC_WEBMAIL_URL_PATTERNS` and
  `NIC_WEBMAIL_TITLE_PATTERNS` for tab matching, and `NIC_BROWSER_ARTIFACT_DIR`, which only the scripts
  read.
- **Session** ([§3.2](#32-auth-and-session)): `SESSION_COOKIE_NAME`.
- **Loader** ([§3.10](#310-loader-and-tooling)): `ENV_FILE`. It does nothing inside a file.
- **Credentials** ([§3.2](#32-auth-and-session)): the dynamic `QMS_PASSWORD_<USER_ID>` keys. Boot names
  each missing one.
- **Shared password** ([§3.2](#32-auth-and-session)): `QMS_ALLOW_SHARED_PASSWORD`. Unset means auto;
  production sets `false`.

Older env files may still hold `IPC_QUERY_EMAIL`, `IPC_ACK_FROM_EMAIL`, `IPC_ACK_FROM_NAME`,
`ATLAS_DATABASE_URL`, or Gmail-era `GMAIL_*` and `GOOGLE_*` keys. Nothing reads them any more, so delete
them.

---

## 4. Frontend variables

| Variable | Required | Secret | Default | Purpose |
|---|---|---|---|---|
| `VITE_API_BASE_URL` | both | no; it is public, compiled into the bundle | `http://localhost:5000/api/v1` | The base URL of every API call, sent with cookies. **Local:** `http://localhost:5000/api/v1`, in `frontend/.env.local`. **Render:** `/api/v1`, a relative URL, so the browser calls the Render origin and the `/api/*` rewrite forwards to the VM. If it is missing at build time, the bundle silently calls `localhost:5000` |
| `VITE_NIC_FRONT_OFFICE_EMAIL` | local only | no | empty | Adds the NICeMail Front Office to the "Dev quick login" menu. Choosing it fills in the email, and you still type the password. It sits inside the `import.meta.env.DEV` block, so production builds compile it out. Set it to the same address as the backend's `NIC_EMAIL`. Never set it on Render |

**How Vite reads env files:**
- It reads `.env`, `.env.local`, `.env.[mode]` and `.env.[mode].local` from `frontend/`; a later file
  wins over an earlier one.
- A variable set in the real environment wins over every file.
- A leftover `frontend/.env` is still read, below `.env.local`. Delete it once `.env.local` exists.

**Local production builds.** `vite build` also reads `.env.local`, so a local production build picks up
the localhost URL unless you pass the value in the environment. In Git Bash, MSYS can rewrite
`VITE_API_BASE_URL=/api/v1` into a Windows path, so run that build from PowerShell:

```powershell
$env:VITE_API_BASE_URL='/api/v1'; npm run build; Remove-Item Env:VITE_API_BASE_URL
```

Render has no `.env.local`, because the file is gitignored, so the dashboard value applies there.

**No secret in the bundle.** Only `VITE_`-prefixed names reach the bundle, and everything in the bundle
is public. Never give a secret a `VITE_` prefix. No backend variable has one, and Vite reads env files
from `frontend/` only.

---

## 5. Profiles (local)

**Starting from the example:**

```bash
cd backend  && cp .env.example .env.local
cd ../frontend && cp .env.example .env.local
```

Then fill in `backend/.env.local`:
1. Set `JWT_SECRET` (`openssl rand -base64 48`).
2. Set a credential for every account. Locally, `QMS_SEED_PASSWORD` is enough.
3. Replace or empty the placeholder `DATABASE_URL`. As copied it names no real cluster, and startup
   stops.

That boots a backend with the mock transport and no NICeMail. The two profiles below add the agent,
for a team that shares the development Atlas database. On one shared database, **exactly one machine is
the mailbox host**. It runs the signed-in Chrome, syncs NICeMail into the database and runs retention.
Everyone else is a **teammate**, whose backend lists what the host stored and never touches NICeMail.

The mailbox-host column below is the full key list of the host's `backend/.env.local`.

| `backend/.env.local` | Mailbox host | Teammate |
|---|---|---|
| `PORT` | `5000` | `5000` |
| `NODE_ENV` | `development` | `development` |
| `CLIENT_URL` | `http://localhost:5173` | `http://localhost:5173` |
| `DATABASE_URL` (**secret**) | the shared development Atlas URI, with your own Atlas user | the same cluster **and the same database name**, `/query_management_system`, with your own Atlas user |
| `JWT_SECRET` (**secret**) | your own, at least 32 characters | your own |
| `QMS_SEED_PASSWORD` (**secret**) | your own local sign-in password | your own; it only unlocks your own backend |
| `EMAIL_TRANSPORT` | `mock` | `mock` |
| `MAILBOX_SOURCE` | `auto` | `auto` |
| `OFFICER_IN_CHARGE_NAME`, `OFFICER_IN_CHARGE_EMAIL` | a test identity whose inbox you read, needed for `NIC_ALLOW_INTERNAL_FORWARD=true` | not needed |
| `NIC_BROWSER_MAILBOX` | `true` | `true` only to open the NICeMail inbox as the NICeMail Front Office — and never without `NIC_BROWSER_VIEWER=true`, or this backend becomes a second mailbox host (sync attempts and retention sweeps) |
| `NIC_BROWSER_VIEWER` | not set | `true`, even if you never open the NICeMail inbox: it is the flag that refuses NICeMail sends on this backend |
| `NIC_EMAIL` | the team's test NICeMail account | exactly the host's address; any other address shows an empty NICeMail inbox |
| `NIC_FRONT_OFFICE_NAME` | the display name the team uses | the same |
| `NIC_CDP_ENDPOINT` | `http://localhost:9222` | not needed |
| `NIC_BROWSER_SYNC_TTL_MS` | only to change the 15000 default | not needed |
| `NIC_BROWSER_TEST_RECIPIENT` | the host's test address | your own address |
| `NIC_ALLOW_OUTBOUND` | as agreed for the test; otherwise `false` | `false` |
| `NIC_ALLOW_INTERNAL_FORWARD` | `true` to exercise the forward to the test Officer-in-Charge | not needed |
| `GEMMA_API_URL`, `GEMMA_TIMEOUT_MS` | the Pravah URL, `12000` | the same |
| `MAILBOX_SYNC_ENABLED` | `true` | `false` |
| `MAILBOX_SYNC_INTERVAL_MS` | `15000` | not needed |
| `MAILBOX_RETENTION_ENABLED` | `true` | `false` |
| `MAILBOX_RETENTION_HOURS`, `MAILBOX_UNREGISTERED_RETENTION_HOURS` | `42`, `336` | not needed |
| `MAILBOX_JUNK_CONFIDENCE`, `MAILBOX_TRIAGE_BATCH`, `MAILBOX_PURGE_BATCH` | `0.9`, `25`, `50` | not needed |

**Left unset in both profiles:**
- `FRONT_OFFICE_*`: the placeholder identity is fine outside production, and differs from `NIC_EMAIL`.
- `QMS_ALLOW_SHARED_PASSWORD`: auto mode.
- `QMS_PASSWORDS_FILE`.
- The IMAP/SMTP keys. Without them, `npm run nic:verify` and `/api/v1/nic/*` report a configuration
  error, which is expected while there is no app password.
- `SESSION_*` and `ATTACHMENT_*`: the defaults are right.

**Signing in as USR-0014.** That account needs a credential like every other one; in auto mode the
shared seed password covers it. Dev login refuses it, so it signs in with a password.

**The frontend.** `frontend/.env.local` holds `VITE_API_BASE_URL=http://localhost:5000/api/v1` and,
optionally, `VITE_NIC_FRONT_OFFICE_EMAIL` set to the same `NIC_EMAIL`.

**Check the database name.** Startup refuses a URI with no database name, but a misspelled name is
accepted and silently opens a separate, empty database (startup even seeds the users into it). Read
the boot line: it must end in `/query_management_system (shared: …)`.

**How a teammate sees the host's changes.** Every backend reads the shared database on each request;
nothing is cached per backend, and there is no server push. The browser reloads the shared case data
when its tab gains focus, becomes visible or changes route, and after each of your own writes; the
mailbox list polls every 15 s. A tab left idle in front of you does **not** refresh — click into it or
move to another page. New NICeMail mail appears after the host's next sync (about 15 s) plus your
next mailbox poll. Details: [frontend/README.md](../frontend/README.md).

The shared-database rules (no destructive operations, where sends happen, attachment bytes) are in the
[root README](../README.md#shared-development-database-mongodb-atlas).

---

## 6. Production

The production topology:
- The frontend is a **Render Static Site**.
- The backend and the agent's signed-in, headed Chrome run on **one VM** behind HTTPS.
- The browser only ever sees the Render origin. Render rewrites `/api/*` to the VM, so the session
  cookie is first-party and `SameSite=lax` is right.

The topology diagram, the cookie model, the first-deploy checklist and the accepted risks are in
[deployment_strategy.md §11.5](./deployment_strategy.md#115-hosting-decision-render-static-site--application-vm).
This section lists the values.

### 6.1 VM backend (`backend/.env.production`)

| Key | Production value | Secret |
|---|---|---|
| `NODE_ENV` | `production` | no |
| `PORT` | `5000`, reached only by the VM's reverse proxy | no |
| `CLIENT_URL` | `https://<render-site>`, the Render site origin | no |
| `DATABASE_URL` | `mongodb+srv://<prod-user>:<prod-password>@<prod-cluster>.mongodb.net/qms_production?retryWrites=true&w=majority`, on a **separate Atlas cluster** whose access list holds only the VM | **yes** |
| `JWT_SECRET` | at least 32 random characters, never reused from development | **yes** |
| `QMS_PASSWORDS_FILE` | an absolute path outside the checkout, for example `C:/qms-secrets/qms-passwords.json`, with entries USR-0003 through USR-0014 | path no; **contents yes** |
| `QMS_ALLOW_SHARED_PASSWORD` | `false` | no |
| `EMAIL_TRANSPORT` | `nic` | no |
| `MAILBOX_SOURCE` | `auto` | no |
| `FRONT_OFFICE_NAME`, `FRONT_OFFICE_EMAIL` | real. The email is not `lab.ipc@gov.in` and never mails that inbox | no |
| `OFFICER_IN_CHARGE_NAME`, `OFFICER_IN_CHARGE_EMAIL` | real | no |
| `NIC_BROWSER_MAILBOX` | `true` | no |
| `NIC_EMAIL` | `lab.ipc@gov.in` | no |
| `NIC_FRONT_OFFICE_NAME` | the name IPC chooses, for example `IPC Front Office` | no |
| `NIC_CDP_ENDPOINT` | `http://localhost:9222` | no |
| `NIC_IMAP_HOST`, `NIC_SMTP_HOST` | `imap.mgovcloud.in`, `smtp.mgovcloud.in`. A boot requirement only, never connected to, with no app password ([§3.5](#35-nicemail-imapsmtp-dormant)) | no |
| `NIC_ALLOW_OUTBOUND` | `false` until go-live | no |
| `NIC_ALLOW_INTERNAL_FORWARD` | `true` | no |
| `NIC_BROWSER_TEST_RECIPIENT` | the agreed controlled-testing inbox | no |
| `GEMMA_API_URL`, `GEMMA_TIMEOUT_MS` | the Pravah URL, `12000` | no |
| `MAILBOX_SYNC_ENABLED`, `MAILBOX_SYNC_INTERVAL_MS` | `true`, `15000` | no |
| `MAILBOX_RETENTION_ENABLED`, `MAILBOX_RETENTION_HOURS`, `MAILBOX_UNREGISTERED_RETENTION_HOURS` | `true`, `42`, `336` | no |
| `MAILBOX_JUNK_CONFIDENCE`, `MAILBOX_TRIAGE_BATCH`, `MAILBOX_PURGE_BATCH` | `0.9`, `25`, `50` | no |
| `ATTACHMENT_DIR` | an absolute path on a backed-up data disk, for example `D:/qms-data/attachments` | no |

**Never in this file:**
- `QMS_SEED_PASSWORD`;
- `NIC_BROWSER_VIEWER`;
- `NIC_BROWSER_ARTIFACT_DIR`;
- `NIC_APP_PASSWORD` or `NIC_APP_PASSWORD_FILE`, until NIC issues the app password and SMTP is
  deliberately enabled;
- `SESSION_*`: `lax` is right for the same-origin rewrite, the cookie is `Secure` automatically in
  production, and the 8-hour TTL is the default;
- `ENV_FILE`, which does nothing inside a file.

**Starting the backend:**
- **Set `NODE_ENV=production` machine-wide** as a system environment variable, so every shell and
  operator command on the VM has it (`npm run mailbox:purge`, `npm run db:provision`,
  `npm run nic:browser:discover`). It is what makes the loader choose `.env.production`, and it also
  makes `npm ci` skip devDependencies, which the backend does not need. Also set it in the service
  definition (NSSM `AppEnvironmentExtra`, or pm2 `env`). A Windows service may not see a newly added
  system variable until the machine restarts.
- The alternative is `ENV_FILE=<absolute path>` in the service environment, for example to keep the
  file outside the checkout. The file's own `NODE_ENV=production` line then applies. Operator shells
  need the same `ENV_FILE`.
- **Never put a `backend/.env.local`, or a legacy `backend/.env`, on the VM.** If `NODE_ENV` were ever
  missing, the loader would load that file instead. Its `NODE_ENV=development` would open dev login and
  switch off every production check.
- Restrict the env file and the passwords file to the service account and administrators. The working
  directory is `backend\`.
- Check the start-up output. It should include `injected env (N) from .env.production` (or the
  `ENV_FILE` path), and a banner showing `(production)`, the agent on and the outbound guard closed.

**Not configurable by environment.**
- `trust proxy` is fixed at one hop in production. Behind Render plus the VM proxy there are two, so the
  rate limiters may key on Render's address. This is a first-deploy check in §11.5, and the follow-up
  is a code change.
- Restrict inbound 443 on the VM to Render's published outbound IP ranges, and keep ports 5000 and 9222
  unreachable from the network.

### 6.2 Render static site

These settings live in the Render dashboard only. There is no `render.yaml`, which keeps the VM host
name out of the repository. **Nothing secret is set on Render.**

| Setting | Value |
|---|---|
| Service type | Static Site |
| Root directory | `frontend` |
| Build command | `npm ci && npm run build` |
| Publish directory | `dist` |
| Environment | `VITE_API_BASE_URL=/api/v1`, `NODE_VERSION=22` |
| Not set | `NODE_ENV`: `vite` is a devDependency, and `npm ci` would skip it under `production`, so the build would fail. `VITE_NIC_FRONT_OFFICE_EMAIL`. Any secret |
| Redirects and rewrites, in this order | 1. `/api/*` → `https://<vm-api-host>/api/*`, action **Rewrite**<br>2. `/*` → `/index.html`, action **Rewrite**, the SPA fallback |
| Pull-request previews | Off; a preview would be proxied to the production API |

### 6.3 Boot refusals

At start the server checks, in order:
1. **The env file.** A missing `ENV_FILE` stops it before anything else.
2. **The mail configuration.**
3. **The auth configuration.**
4. **The database connection.**

When step 2 or step 3 fails, the server prints every problem in that group, then `(env file: …)`, and
exits with code 1. The mail checks report first, so fix them and run again; the
[§7](#7-checking-a-configuration-without-a-server) check shows both groups at once.

| Variable | Refused when | Applies |
|---|---|---|
| `ENV_FILE` | it names a file that does not exist | always |
| `JWT_SECRET` | empty, or shorter than 32 characters | always |
| every account | it has no credential from `QMS_PASSWORDS_FILE`, `QMS_PASSWORD_<USER_ID>` or shared mode | always |
| `QMS_PASSWORDS_FILE` | set, but unreadable, not JSON, or not a JSON object | always |
| `QMS_ALLOW_SHARED_PASSWORD=true` | `QMS_SEED_PASSWORD` is empty | always |
| `SESSION_TTL_SECONDS` | not a positive number | always |
| `SESSION_COOKIE_SAMESITE` | not `lax`, `strict` or `none` | always |
| `EMAIL_TRANSPORT` | not `mock` or `nic` | always |
| `MAILBOX_SOURCE` | not `auto` or `nic` | always |
| `NIC_EMAIL`, `NIC_IMAP_HOST`, `NIC_SMTP_HOST` | any of them is empty; also a non-positive `NIC_IMAP_PORT` or `NIC_SMTP_PORT`, or an empty `NIC_MAILBOX` | when `EMAIL_TRANSPORT=nic` or `MAILBOX_SOURCE=nic`, so always in production |
| `NIC_EMAIL` | empty, or equal to `FRONT_OFFICE_EMAIL` (ignoring case) | when `NIC_BROWSER_MAILBOX=true` |
| `NIC_BROWSER_TEST_RECIPIENT` | empty, and `NIC_TEST_RECIPIENT` is empty too | when `NIC_BROWSER_MAILBOX=true` and `NIC_ALLOW_OUTBOUND` is not `true` |
| `NIC_ALLOW_INTERNAL_FORWARD=true` | `OFFICER_IN_CHARGE_EMAIL` is empty or ends in `@example.com` | always |
| `MAILBOX_RETENTION_HOURS` | not a positive number; an empty value reads as 0 | always |
| `MAILBOX_UNREGISTERED_RETENTION_HOURS` | not a positive number, or shorter than `MAILBOX_RETENTION_HOURS` | always |
| `MAILBOX_SYNC_INTERVAL_MS` | not a whole number of at least 1000 | always |
| `MAILBOX_JUNK_CONFIDENCE` | negative, or not a number | always |
| `FRONT_OFFICE_EMAIL`, `OFFICER_IN_CHARGE_EMAIL` | empty, or ending in `@example.com` | production |
| the mail channel | **production requires `EMAIL_TRANSPORT=nic`: `mock` is refused even with `NIC_BROWSER_MAILBOX=true`** | production |
| `DATABASE_URL` | empty | production |
| `DATABASE_URL` | set, but it names no database or is unreachable within 15 s | always |

The "real address" test rejects only empty values and `@example.com`. It cannot tell a real mailbox
from a typo.

**Not checked at boot:**
- `CLIENT_URL` and `PORT`;
- the display names;
- the NIC app password;
- Chrome and CDP: a missing Chrome never stops the server, and syncs and sends fail per request
  instead;
- whether `NIC_ALLOW_OUTBOUND` ought to be open.

---

## 7. Checking a configuration without a server

Run this from `backend/`. It loads the env file exactly as the server would, runs both validators and
prints the result. It does not start a server, and it connects to nothing: not the database, not Chrome,
not NICeMail.

```bash
node --input-type=module -e "
const { default: env, ENV_SOURCE, validateEmailConfig } = await import('./src/config/env.js');
const { validateAuthConfig, cookieOptions } = await import('./src/config/authConfig.js');
const { databaseTarget } = await import('./src/config/db.js');
let auth;
try { auth = validateAuthConfig(); } catch (error) { auth = [error.message.split(' (')[0]]; }
console.log({ file: ENV_SOURCE, NODE_ENV: env.NODE_ENV, transport: env.EMAIL_TRANSPORT, source: env.MAILBOX_SOURCE, database: databaseTarget()?.name ?? null, secureCookie: cookieOptions().secure, sameSite: cookieOptions().sameSite, email: validateEmailConfig(), auth });
"
```

The command contains no `$` and no backtick, so it works as written in Git Bash and in PowerShell 7.

**What it prints.** It prints no secret:
- the loaded file's path and the modes;
- the database **name** only, parsed from the URI, never the host or the credentials;
- the validators' messages, which name variables and may quote an address, but never print a secret
  value.

The passwords-file error is cut before its detail, because a JSON parse error can quote the file's
contents.

**Expected results:**
- **A developer machine:** `file` ends in `.env.local`, with `NODE_ENV: 'development'`,
  `transport: 'mock'`, `source: 'auto'`, `email: []` and `auth: []`.
- **The VM**, with `NODE_ENV=production` set machine-wide: `file` ends in `.env.production`, with
  `NODE_ENV: 'production'`, `transport: 'nic'`, `source: 'auto'`, `database: 'qms_production'`,
  `secureCookie: true`, `sameSite: 'lax'`, `email: []` and `auth: []`.
- **The unfilled template, on a developer machine.** Prefix the command with `NODE_ENV=production` in
  Git Bash; in PowerShell, run `$env:NODE_ENV='production'` first and `Remove-Item Env:NODE_ENV`
  afterwards. The template must **fail closed**:
  - `email` names `FRONT_OFFICE_EMAIL`, `OFFICER_IN_CHARGE_EMAIL`, `NIC_BROWSER_TEST_RECIPIENT` and the
    internal-forward rule;
  - `auth` is `['QMS_PASSWORDS_FILE could not be read as JSON']` until the passwords file exists, and
    it reports the empty `JWT_SECRET` once the file does.

Passing both validators does not prove that the database is reachable, that Chrome is signed in, or
that Render reaches the VM. The server checks the database at start. The rest is the first-deploy
checklist in
[deployment_strategy.md §11.5](./deployment_strategy.md#115-hosting-decision-render-static-site--application-vm).
