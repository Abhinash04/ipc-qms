# NICeMail Browser Agent — Setup & CDP Runbook

How to set up the NICeMail browser agent on a fresh Windows development machine: a dedicated Chrome
session, the Chrome DevTools Protocol (CDP) on `localhost:9222`, a manual NICeMail sign-in, and
Playwright attaching to that session.

> **The browser agent never logs in to NICeMail.** You sign in by hand, MFA included, in a dedicated
> Chrome window. The agent only *attaches* to that already-authenticated session through CDP.

---

## 1. Overview

NICeMail is reachable by two unrelated mechanisms in this repo (see
[backend/README.md](../backend/README.md), "NICeMail"):

| # | Mechanism | Configured by | Used for |
|---|---|---|---|
| 1 | IMAP/SMTP | `NIC_EMAIL`, `NIC_IMAP_*`, `NIC_SMTP_*`, app password | the production mail path (`MAILBOX_SOURCE=nic`, `EMAIL_TRANSPORT=nic`) |
| 2 | **Browser agent over CDP** (this document) | `NIC_CDP_ENDPOINT`, `NIC_WEBMAIL_*`, `NIC_BROWSER_*` | attaching to a human-authenticated NICeMail web session |

The two share no code and no credentials.

**What the browser agent does:**

- Connects to a running Chrome through CDP (`playwright-core` → `chromium.connectOverCDP`).
- Finds the NICeMail tab among all open tabs and checks that it is signed in.
- Runs **read-only** DOM discovery (`npm run nic:browser:discover`): tabs, frames, accessibility
  nodes, and how many elements each of the agent's selectors matches.
- With `NIC_BROWSER_MAILBOX=true`: **reads** the NICeMail inbox into a second Front Office inbox,
  and **sends** the acknowledgement and final response for cases that came from that mailbox. See
  [§17](#17-two-front-office-mailboxes).

There is no separate agent process to start. The backend runs the agent on demand, only when the
NICeMail Front Officer's inbox is polled or a case from that mailbox sends its acknowledgement or
final response — whoever triggers the send. `playwright-core` is loaded at that point, never at boot.
Browser work is serialised: one read or send at a time.

## 2. Architecture

```text
                    USER
                     │  manually starts browser
                     ↓
             Google Chrome
             dedicated profile (C:\qms-chrome)
                     │
                     │  CDP — Chrome listens on localhost:9222
                     ↓
             IPC-QMS browser agent (Node, playwright-core)
                     │  connectOverCDP → existing pages only
                     ↓
               NICeMail web UI (tab already open)
                     │  authenticated session (cookies in the Chrome profile)
                     ↓
              NICeMail mailbox
                     ↓
              IPC-QMS workflow (the second Front Office inbox — §17)
```

**Port 9222 belongs to Chrome, not to Node.** Chrome opens the DevTools endpoint. The Node process
is a *client* that connects to it for the duration of one command and then detaches.

Authentication boundary:

```text
User → manual NICeMail sign-in (+ MFA) → authenticated Chrome session → CDP → QMS browser agent
```

The browser agent is an **optional operational dependency**:

```text
Core QMS backend  (npm run dev / npm start)
   ├── MongoDB
   ├── AI services (Pravah Gemma)
   └── REST API
        ✗ does not load the browser agent at boot; playwright-core loads only on first use

Browser agent  (npm run nic:browser:discover, or on demand for the NICeMail Front Office)
   └── Chrome / CDP :9222 → NICeMail
```

If Chrome is not running or port 9222 is unavailable, the backend still starts and serves normally.
Only browser-agent work fails, and it is reported (see §17), not thrown at the whole API.

## 3. Prerequisites

| Requirement | Version / detail | Verify |
|---|---|---|
| Windows | 10 or 11 | — |
| Node.js | **≥ 20.19**. No `engines` field, but `mongoose@9` requires `>=20.19.0` and `playwright-core@1.63` requires `>=20`. Node 22 or 24 LTS is fine. | `node --version` |
| npm | ships with Node | `npm --version` |
| Git | any recent | `git --version` |
| Google Chrome | **≥ 136**, installed normally | see below |
| MongoDB | only for the backend, not for the agent itself | `Get-Service MongoDB` |
| Network | can reach NICeMail in a browser (`mail.gov.in` / `mgovcloud.in`) | open it in Chrome |
| NICeMail access | an authorised account and its MFA/OTP device | — |
| Port | `9222` free on localhost | see [Troubleshooting](#13-troubleshooting) |

Verify Chrome is installed and check its version:

```powershell
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
Test-Path $chrome                                  # True
(Get-Item $chrome).VersionInfo.ProductVersion      # e.g. 152.0.7977.83
```

If `Test-Path` is `False`, Chrome may be a per-user install at
`$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe`. Use that path in the commands below.

## 4. Project Setup

```text
ipc-qms/
├── frontend/                         React + Vite SPA
├── backend/
│   ├── .env.example                  authoritative env reference
│   ├── package.json                  scripts incl. nic:browser:discover
│   └── src/
│       ├── config/
│       │   └── browserConfig.js      NIC_CDP_* / NIC_WEBMAIL_* / NIC_BROWSER_* getters
│       ├── services/email/
│       │   ├── nic/browser/
│       │   │   ├── attach.js         connect, pick tab, check sign-in, release
│       │   │   ├── session.js        one serialised unit of work in a separate tab
│       │   │   ├── selectors.js      every NICeMail UI selector (uncalibrated — §17)
│       │   │   ├── readInbox.js      read the newest inbox rows
│       │   │   └── sendMail.js       fill and send one compose form
│       │   ├── nic/outboundGuard.js  the NIC_ALLOW_OUTBOUND interlock
│       │   ├── mailbox/nicBrowserMailbox.js       sync + store the NICeMail inbox in MongoDB
│       │   └── transports/nicBrowserTransport.js  per-case sends through the browser
│       ├── scripts/
│       │   └── nicBrowserDiscover.js read-only discovery CLI
│       └── test/
│           ├── nicBrowserAttach.test.js
│           ├── nicBrowserMailbox.test.js
│           └── nicBrowserSendMail.test.js
└── docs/
```

```powershell
git clone https://github.com/Abhinash04/ipc-qms.git
cd ipc-qms\backend
```

## 5. Dependencies

```powershell
cd backend
npm install          # use `npm ci` on a deployment host
```

The browser agent's only automation dependency is **`playwright-core`** (`^1.63.0`), already in
`backend/package.json`.

| Package | Used? | Notes |
|---|---|---|
| `playwright-core` | **yes** | Driver library only. Downloads no browsers. |
| `playwright` | no | Not a dependency. Do not add it. |
| Playwright-bundled Chromium | no | **Do not** run `npx playwright install`. The agent never launches a browser. |
| Locally installed Google Chrome | **yes** | The agent attaches to it over CDP. |

This is the "existing Chrome + CDP" architecture, not "Playwright launches its own Chromium". A
freshly launched browser would not be signed in, so it would be useless here.

## 6. Environment Configuration

```powershell
cd backend
Copy-Item .env.example .env     # skip if .env already exists
```

The backend itself also needs `JWT_SECRET` and `QMS_SEED_PASSWORD` to start (see
[backend/README.md](../backend/README.md)). The browser agent does not.

Browser-agent variables. All are optional, and the defaults come from
`src/config/browserConfig.js`:

| Variable | Default | Purpose | Read by code? |
|---|---|---|---|
| `NIC_CDP_ENDPOINT` | `http://localhost:9222` | Where Chrome exposes CDP | yes |
| `NIC_WEBMAIL_URL_PATTERNS` | `mail.gov.in,mgovcloud.in` | Comma-separated URL fragments that identify a NICeMail tab | yes |
| `NIC_WEBMAIL_TITLE_PATTERNS` | `mail,inbox,nic` | Comma-separated title fragments, a secondary signal | yes |
| `NIC_BROWSER_TIMEOUT_MS` | `20000` | The CDP connect, loading the work tab, and every wait inside a read or send — including how long a send waits for the compose form to close before it is reported **unconfirmed** (§17) | yes |
| `NIC_BROWSER_TEST_RECIPIENT` | falls back to `NIC_TEST_RECIPIENT`, then `NIC_EMAIL` | The only address browser sends may reach until `NIC_ALLOW_OUTBOUND=true` | yes |
| `NIC_BROWSER_MAILBOX` | `false` | `true` makes NICeMail a second Front Office mailbox (§17). Only the exact string `true` enables it | yes |
| `NIC_FRONT_OFFICE_NAME` | `NICeMail Front Office` | A display **name**, not an address: the second Front Office user's name and the name on the From line of its mail. Empty falls back to the default | yes |
| `NIC_BROWSER_SYNC_TTL_MS` | `30000` | Minimum gap between inbox syncs | yes |
| `NIC_BROWSER_SYNC_MAX` | `20` | Newest inbox rows inspected per sync. Rows already stored count against it (§17, open items) | yes |
| `NIC_BROWSER_ARTIFACT_DIR` | code: `storage/browser-artifacts` (`.env.example` sets `storage/nic-browser`) | Reserved for failure screenshots | **not yet** |

There is **no** password, token or cookie variable for the browser agent, and there must never be
one.

With `NIC_BROWSER_MAILBOX=true`, `NIC_EMAIL` is required and must differ from `FRONT_OFFICE_EMAIL`;
the backend refuses to start otherwise. `NIC_ALLOW_OUTBOUND` (the IMAP/SMTP block's interlock) also
governs browser sends.

The backend test suite does not read these from your `.env`: `backend/vitest.config.mjs` pins every
`NIC_BROWSER_*` variable, `NIC_FRONT_OFFICE_NAME`, the `NIC_WEBMAIL_*` patterns and
`NIC_ALLOW_OUTBOUND` to blank — the feature off, the interlock closed, code defaults for the rest —
and points `NIC_CDP_ENDPOINT` at an unroutable address. Enabling the feature locally therefore cannot
change what the suite sees; tests that exercise it switch it on themselves.

**Which mailbox?** The agent reads and sends as whichever account is signed in to the Chrome tab.
With `NIC_BROWSER_MAILBOX=true`, `NIC_EMAIL` is where the QMS files that mail — the mailbox its stored
messages belong to, the second Front Office's sign-in, the From address it records, and the last
fallback for the test recipient — but **nothing checks that the signed-in account is `NIC_EMAIL`**
(§17, open items). Sign in to the right account. `NIC_EMAIL` also configures the IMAP/SMTP side
(mechanism 1):

- current development/test mailbox: `contact.ecoclubs-edu@gov.in` (temporary)
- future production mailbox: `lab.ipc@gov.in`

Switching mailboxes is a configuration change (`NIC_EMAIL`) plus signing in to the other account in
the dedicated Chrome. No mailbox address is hard-coded in source.

## 7. Chrome Setup — Dedicated Profile

Always run the agent against a **dedicated Chrome profile** (`--user-data-dir=C:\qms-chrome`), never
your everyday profile:

- The NICeMail session persists between runs in that profile only.
- Automation stays isolated from personal browsing, cookies and extensions.
- Your normal Chrome profile is never exposed over CDP.
- CDP behaviour is predictable, and troubleshooting is simpler.
- **Chrome 136+ ignores `--remote-debugging-port` on the default profile.** A non-default
  `--user-data-dir` is required for the flag to work at all.

`C:\qms-chrome` is the path used throughout this repo. Any path outside the repository works, as
long as you use it consistently. Chrome creates the folder on first launch.

> Chrome 144+ can also enable remote debugging on an already-running instance via
> `chrome://inspect/#remote-debugging` (`browserConfig.js` mentions this). **Do not use it here.** It
> exposes whatever profile is running, usually your personal one.

## 8. CDP Configuration

### Start Chrome with CDP

**Close every other Chrome window that uses `C:\qms-chrome` first.** If an instance with that
profile is already running, Chrome hands the new window to it and ignores the debugging flag.

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="C:\qms-chrome"
```

Leave this Chrome window open for as long as you use the browser agent.

To use a different port, change both the flag and `NIC_CDP_ENDPOINT` (for example
`http://localhost:9333`).

### Verify CDP

```powershell
Invoke-RestMethod http://localhost:9222/json/version
# or
curl.exe http://localhost:9222/json/version
```

Success looks like this (values vary):

```text
Browser              : Chrome/152.0.7977.83
Protocol-Version     : 1.3
User-Agent           : Mozilla/5.0 ...
webSocketDebuggerUrl : ws://localhost:9222/devtools/browser/<id>
```

A connection error means Chrome is not listening. A **`404 (Not Found)`** means another program owns
the port (often Brave or Edge). See [Troubleshooting](#13-troubleshooting).

Chrome binds the debugging port to `127.0.0.1` by default. **Never** add
`--remote-debugging-address=0.0.0.0` or forward the port.

## 9. NICeMail Manual Authentication

In the dedicated Chrome window:

1. Open the NICeMail website.
2. Sign in manually with the authorised NICeMail account.
3. Complete MFA / OTP manually.
4. Confirm the inbox is visible.
5. Leave the tab open and signed in.
6. Do not close Chrome before running the browser agent.

The browser agent **never**:

- asks for, stores or reads the NICeMail password
- fills or submits the login form
- touches the OTP field or bypasses MFA
- launches a browser or creates its own authentication flow

When it reads or sends mail, it works in a **separate tab** in the same signed-in browser context,
pointed at the mailbox URL your tab is already on. It never drives your tab, and it closes its own
tab afterwards. If that tab lands on anything that looks like a sign-in step, the work stops with
`NICeMail session expired. Please authenticate again in Chrome.` before any field is touched. The only
things it types are the To/Cc/Subject/body of an outgoing case email.

## 10. How the Agent Connects (`attach.js`)

`attachToNicemail()`:

1. **Connect**: `chromium.connectOverCDP(NIC_CDP_ENDPOINT, { timeout: NIC_BROWSER_TIMEOUT_MS })`.
2. **Enumerate** every page in every browser context (not just the first tab).
3. **Score** each tab (`scoreTab`):
   - URL must contain one of `NIC_WEBMAIL_URL_PATTERNS`, otherwise the score is 0 and the tab is ignored → **10**
   - URL contains `inbox`, `mail`, `folder` or `message` → **+5**
   - title contains one of `NIC_WEBMAIL_TITLE_PATTERNS` → **+2**
   - URL contains a login marker (`/login`, `/signin`, `accounts.`, `oauth`, `otp`, `twofactor`,
     `2fa`) → **−8** (kept, so "not signed in" can be told apart from "no tab")
4. **Pick** the highest score. Ties go to the order Chrome reports.
5. **Check sign-in** (`isAuthenticated`): the tab counts as not authenticated if its URL has a login
   marker or an `input[type="password"]` is visible.
6. **Release**: `release()` detaches Playwright. It does **not** close your Chrome or your tabs.

Outcomes:

| Stage | Message | Meaning |
|---|---|---|
| `connect_browser` | `Chrome is not available for browser automation. Please open the supported Chrome session first.` | Nothing listening on the CDP endpoint (refused / timeout / DNS) |
| `connect_browser` | `Something is listening on the CDP port, but it is not a Chrome DevTools endpoint. …` | Another program holds the port |
| `find_tab` | `No NICeMail tab found. Please open NICeMail in Chrome.` | Connected, but no tab URL matches the patterns |
| `verify_session` | `NICeMail is open, but the session is not authenticated. Please complete the NICeMail login/OTP manually.` | Tab found, but it is on a sign-in step |
| `verify_session` (ok) | — | Attached to a signed-in NICeMail tab |

A connect failure is **not** an authentication failure. It says nothing about NICeMail.

## 11. Startup Commands

### Terminal layout

**Terminal 1 — MongoDB** (backend only; skip if the Windows service is already running)

```powershell
Get-Service MongoDB                 # Status should be Running
Start-Service MongoDB               # if stopped (elevated PowerShell)
mongosh "mongodb://127.0.0.1:27017/query_management_system" --eval "db.runCommand({ping:1})"
```

Use the `DATABASE_URL` from your `backend/.env` in the `mongosh` line.

**Terminal 2 — Backend**

```powershell
cd D:\Anuvadini\ipc-qms\backend
npm run dev          # nodemon; or `npm start` for plain node — http://localhost:5000
```

**Terminal 3 — Frontend** (optional, not needed by the browser agent)

```powershell
cd D:\Anuvadini\ipc-qms\frontend
npm run dev          # http://localhost:5173
```

**Terminal 4 — Dedicated Chrome with CDP**

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\qms-chrome"
```

**Terminal 5 — Browser agent / diagnostics**

```powershell
cd D:\Anuvadini\ipc-qms\backend
npm run nic:browser:discover
```

Order: terminals 1–3 and terminal 4 are independent, because the backend does not need Chrome and the
agent does not need the backend. Terminal 5 must come **after** Chrome is running and NICeMail is
signed in. The discover script loads `backend/.env` itself.

### Quick Start

1. **Start MongoDB**: `Get-Service MongoDB` shows Running (terminal 1).
2. **Start backend**: `cd backend; npm run dev` (terminal 2).
3. **Start frontend** if you need the UI: `cd frontend; npm run dev` (terminal 3).
4. **Start dedicated Chrome**: close any other `C:\qms-chrome` window, then run the launch command
   (terminal 4).
5. **Verify CDP**: `Invoke-RestMethod http://localhost:9222/json/version` returns `Browser: Chrome/…`.
6. **Open NICeMail** in that Chrome window.
7. **Authenticate manually**, including MFA/OTP.
8. **Verify the inbox** is visible. Keep the tab open.
9. **Run discovery**: `cd backend; npm run nic:browser:discover` (terminal 5).
10. **"Start the browser agent"**: today this *is* step 9. There is no separate agent process.
11. **Verify mailbox access**: discovery prints the NICeMail URL/title and ends with
    `Discovery complete. No page state was modified.`

## 12. Verification

### Successful discovery output (illustrative)

```text
NICeMail browser discovery — READ ONLY.
Nothing is clicked, typed, navigated or sent.

── Configuration
  CDP endpoint                      http://localhost:9222
  URL patterns                      mail.gov.in, mgovcloud.in
  Title patterns                    mail, inbox, nic

── Tabs Chrome is exposing
  [match(17)  ] Inbox - ...                                https://mail.mgovcloud.in/zm/#mail/folder/inbox
  [no match   ] New Tab                                    chrome://newtab/

── Attaching to the NICeMail tab
  URL                               https://mail.mgovcloud.in/zm/#mail/folder/inbox
  Title                             Inbox - ...

── Frames
  (main) https://mail.mgovcloud.in/...

── Accessibility tree (interesting nodes)
  - button "New Mail"
  - link "Inbox"
  ...

── Candidate compose / message controls
  compose button                    1 candidate(s) by role
  ...

Discovery complete. No page state was modified.
```

What to check:

- the NICeMail tab shows `match(n)` with n > 0
- the "Attaching" section prints a URL and title rather than an error
- the run ends with `Discovery complete.` and exit code 0 (`$LASTEXITCODE`)

### Checklist

**Environment**
- [ ] `node --version` ≥ 20.19, `npm --version` works
- [ ] `npm install` done in `backend/` (`playwright-core` in `node_modules`)
- [ ] Google Chrome ≥ 136 installed
- [ ] `backend/.env` exists (browser-agent variables optional; defaults shown above)

**Database** (backend only)
- [ ] MongoDB service running
- [ ] backend log shows it connected to MongoDB

**Browser**
- [ ] Chrome started with `--remote-debugging-port=9222 --user-data-dir="C:\qms-chrome"`
- [ ] `http://localhost:9222/json/version` responds

**NICeMail**
- [ ] NICeMail opened in the dedicated Chrome window
- [ ] signed in manually with MFA completed
- [ ] inbox visible for the **correct** account

**Browser agent**
- [ ] `npm run nic:browser:discover` lists the tab as `match(n)`
- [ ] attach succeeds (URL/title printed)
- [ ] accessibility nodes and candidate controls printed
- [ ] ends with `Discovery complete.`

## 13. Troubleshooting

### `Could not connect.` … `Nothing is listening on the CDP endpoint.`

(Attach-level message: `Chrome is not available for browser automation.`)

This means the Chrome/CDP session is unavailable. It is **not** a NICeMail login problem. Causes:

- Chrome was not started with `--remote-debugging-port=9222`.
- A Chrome window using `C:\qms-chrome` was already open, so the new launch was handed to it and the
  flag was ignored. Close **all** Chrome windows for that profile (check Task Manager) and relaunch.
- `--user-data-dir` was omitted, and Chrome 136+ ignores the flag on the default profile.
- `NIC_CDP_ENDPOINT` points at a different port than the one Chrome was started with.

Confirm with `Invoke-RestMethod http://localhost:9222/json/version`.

### `The port answered, but not as a Chrome DevTools endpoint.`

Typically shown with `Unexpected status 404 when connecting to http://localhost:9222/json/version/`.
Another program (Brave, Edge, a second Chrome profile, some other tool) holds port 9222, and Chrome
cannot bind it while that program runs. Find it:

```powershell
Get-NetTCPConnection -LocalPort 9222 -State Listen |
  ForEach-Object { Get-Process -Id $_.OwningProcess }
```

Close that program normally, then relaunch the dedicated Chrome. Alternatively, start Chrome on a
free port and set `NIC_CDP_ENDPOINT` to match. Do not kill processes you do not recognise.

### `No NICeMail tab found. Please open NICeMail in Chrome.`

1. Open NICeMail in the **dedicated** Chrome window (not your normal Chrome).
2. Complete sign-in.
3. Confirm the inbox is visible.
4. Keep the tab open.
5. Run discovery again.

If NICeMail is served from a host that contains neither `mail.gov.in` nor `mgovcloud.in`, add that
host to `NIC_WEBMAIL_URL_PATTERNS`.

### `NICeMail is open, but the session is not authenticated.`

The tab is on a sign-in/OTP page, or a password field is visible. Finish signing in by hand. The
agent does not and will not authenticate for you. If the session expired, sign in again in the same
window.

### Chrome closed unexpectedly

The CDP endpoint disappears with Chrome. Relaunch with the same command. Because the profile is
persistent, NICeMail may still be signed in; if not, sign in again.

### `Unexpected error: …`

Something failed after attaching, for example the page navigated mid-run. Re-run once. If it
persists, note the message and the NICeMail URL for whoever maintains `nicBrowserDiscover.js`.

The entries below apply with `NIC_BROWSER_MAILBOX=true`, when the backend reads and sends through the
agent (§17).

### `NICeMail could not be read — this list may be out of date` (IPC Mailbox page)

The last inbox sync failed. The inbox request still answers 200 with the mail already stored and
reports the failure in the response's `sync` field (`ok: false`, `stage`, `error`); the notice prints
both. Nothing new is stored until a sync succeeds.

| `stage` in the notice | Fix |
|---|---|
| `connect_browser` | Chrome/CDP is not reachable — the entries above |
| `find_tab` | open NICeMail in the dedicated Chrome |
| `verify_session` | sign in again by hand; the tab, or the agent's work tab, is on a sign-in step |
| `ui` | a selector matched nothing — calibrate (§17) |
| none | something else failed; the error text says what |

The notice goes once the page reloads the list after a successful sync (**Check IPC Mailbox**, or
Auto-refresh).

### `NICeMail UI element "<key>" was not found. Recalibrate browser/selectors.js.`

Stage `ui`: the selector `<key>` in `selectors.js` matched nothing on the live page. During a send
this is always raised **before** Send is pressed, so nothing went out and a retry is safe once the
selector is fixed. Calibrate (§17).

### `NICeMail may have sent this message but did not confirm it in time. Check the NICeMail Sent folder before retrying …`

Stage `confirm_send`, flagged `unconfirmed`. Send was pressed and the compose form did not close
within `NIC_BROWSER_TIMEOUT_MS`. The message may or may not have left, and the agent cannot tell.
Nothing was recorded, so any retry sends it again.

1. Open the **Sent** folder in the dedicated Chrome and look for the message.
2. If it is there, **do not retry** — the recipient has it. The QMS has no control to record a send
   it did not see complete: the acknowledgement stays unrecorded, or the case stays at
   `READY_FOR_DISPATCH`.
3. If it is not there, retry: ✓ again in the IPC Mailbox for an acknowledgement, **Retry sending
   response** on the Dispatch page for a final response. If the forward to the Officer-in-Charge also
   failed, use **Retry forwarding** on the case page instead of ✓ — ✓ re-attempts the
   acknowledgement too.

Where the warning appears:

- **Acknowledgement, at accept:** the accept toast, and an `EMAIL_SEND_FAILED` row in the case's
  audit history saying it may have been sent.
- **Final response, at approval:** the approval banner's error text, the Front Office notification,
  and an `EMAIL_SEND_FAILED` row.
- **A retry that itself ends unconfirmed:** the case page's **Retry sending** and the Dispatch page's
  **Retry sending response** answer HTTP **504** with this message and `unconfirmed: true`. The case
  page's notice then reads **Acknowledgement may already have been sent**; the Dispatch page shows
  the message in its error banner. Each such retry is audited as `EMAIL_SEND_FAILED`.

The flag is not stored on the case. After an unconfirmed accept or approval, the case page's
**Acknowledgement email not sent** notice and the Dispatch page's **Retry sending response** still
read "not sent" and offer a retry until one is attempted. Check the Sent folder before pressing
either; the case's audit history shows which failures were unconfirmed.

### `NICeMail browser transport refused to send to …`

The outbound interlock refused before the browser was touched; nothing was sent. Browser sends are
confined to `NIC_BROWSER_TEST_RECIPIENT` until `NIC_ALLOW_OUTBOUND=true`. Expected while testing
with any other inquirer address.

### `NICeMail session expired. Please authenticate again in Chrome.`

Stage `verify_session`: your tab looked signed in, but the agent's work tab landed on a sign-in step.
Sign in again by hand in the dedicated Chrome.

### `The NICeMail browser mailbox needs MongoDB, which is not connected.` (HTTP 503)

The NICeMail mailbox is stored in MongoDB and has no in-memory fallback. In development the backend
starts without MongoDB, but this mailbox does not work until it is connected (§11).

## 14. Security

- **Never commit credentials**: no NICeMail passwords, no application-specific passwords, no OAuth
  refresh tokens, no session cookies.
- **Never put secrets in Markdown** or any other tracked file. Secrets go in `backend/.env`, which is
  gitignored.
- The browser agent has **no** credential variable, by design.
- Use the **dedicated** profile only, never your normal Chrome profile.
- **Do not automate NICeMail authentication** and do not bypass MFA.
- **CDP is unauthenticated full control of the browser.** Anyone who can reach port 9222 can read
  every cookie, open any page and act as the signed-in NICeMail user. Therefore:
  - keep it bound to `localhost` (Chrome's default); never use `--remote-debugging-address=0.0.0.0`,
    port forwarding or firewall exceptions for 9222
  - do not browse unrelated or untrusted sites in the dedicated window
  - close the dedicated Chrome when you are done
- `C:\qms-chrome` holds live session cookies. Keep it outside the repository, do not copy or share
  it, and restrict it to your Windows account.

With `NIC_BROWSER_MAILBOX=true` a QMS account can read the live mailbox and make the agent send, so:

- **The NICeMail Front Office signs in with a password.** `POST /auth/dev-login` refuses that account
  with **403** (`This account reads a live NICeMail mailbox. Sign in with a password.`) and audits the
  attempt as `LOGIN_FAILED` / `denied`. It signs in through `POST /auth/login` with
  `QMS_SEED_PASSWORD`.
- **Dev login remains open for every other seeded account.** It answers whenever
  `NODE_ENV=development` — the default when `NODE_ENV` is unset — and the backend listens on all
  interfaces, so anyone who can reach the port can sign in without a password as any other seeded
  user. That includes the primary Front Office, whose inbox is a real Gmail account under
  `MAILBOX_SOURCE=gmail`. This development-mode exposure pre-dates the NICeMail mailbox and is not
  fixed: do not run a development-mode backend where untrusted hosts can reach it.
- **Outbound mail is confined** to `NIC_BROWSER_TEST_RECIPIENT` until `NIC_ALLOW_OUTBOUND=true` —
  the same two-key interlock as NIC SMTP.
- **What the official mailbox sends is not locked to the case.** `POST /queries/persist` has no role
  or case check, so any signed-in role can edit a case's inquirer and its response text — which, for
  a NICeMail case, decide what the `.gov.in` mailbox sends and to whom. The retry endpoints,
  `POST /emails/acknowledgement` and `POST /emails/response`, take the mailbox from the stored case
  but the recipient — and for a response, the subject, body and attachments — from the request body;
  they are limited to Front Office and Super Admin. Both pre-date the NICeMail mailbox.
- **Mailbox isolation covers the NICeMail Front Office's own requests only** — see §17, open items.

## 15. Production Considerations

- **Mailbox switch** (`contact.ecoclubs-edu@gov.in` → `lab.ipc@gov.in`): change `NIC_EMAIL` for the
  IMAP/SMTP side, then sign in to the new account in the dedicated Chrome. No code change is needed
  for either mechanism. With `NIC_BROWSER_MAILBOX=true`, `NIC_EMAIL` is also the second Front
  Office's sign-in and the mailbox its stored messages are filed under: after the switch that
  account signs in with the new address, messages stored under the old one are no longer listed, and
  open NICeMail cases are answered through whichever account is signed in to Chrome while the QMS
  records them as sent from the address stored on the case.
- The browser agent is **optional at boot**: its code is imported lazily, and the backend must keep
  starting without Chrome. With `NIC_BROWSER_MAILBOX=true` it is in the request path for the
  NICeMail mailbox — an accept, a final approval or a retry on a NICeMail case waits for the send,
  queued behind any other browser work — while inbox reads start a background sync and never wait
  for it.
- The IMAP/SMTP integration (mechanism 1) is the production mail path. The browser agent is a
  supervised, operator-attended tool.
- Run the dedicated Chrome under the operator's own Windows account, on the same machine as the agent,
  with CDP on localhost only.
- `NIC_BROWSER_ARTIFACT_DIR` is reserved for failure screenshots and read by no code yet. Its default
  disagrees between `.env.example` and code, so set it explicitly once it is used.

## 16. Quick Reference

| Task | Command (PowerShell) |
|---|---|
| Check Node / npm | `node --version; npm --version` |
| Install deps | `cd backend; npm install` |
| Create env file | `cd backend; Copy-Item .env.example .env` |
| Check MongoDB | `Get-Service MongoDB` |
| Start backend | `cd backend; npm run dev` |
| Start frontend | `cd frontend; npm run dev` |
| Start dedicated Chrome + CDP | `& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\qms-chrome"` |
| Verify CDP | `Invoke-RestMethod http://localhost:9222/json/version` |
| Who holds 9222 | `Get-NetTCPConnection -LocalPort 9222 -State Listen \| ForEach-Object { Get-Process -Id $_.OwningProcess }` |
| Run browser agent (discovery) | `cd backend; npm run nic:browser:discover` |
| Unit tests for attach logic | `cd backend; npx vitest run src/test/nicBrowserAttach.test.js` |
| Unit tests for the NICeMail mailbox | `cd backend; npx vitest run src/test/nicBrowserMailbox.test.js` |
| Unit tests for send confirmation | `cd backend; npx vitest run src/test/nicBrowserSendMail.test.js` |

## 17. Two Front Office Mailboxes

With `NIC_BROWSER_MAILBOX=true`, IPC-QMS runs two Front Office mailboxes at once. Both feed the
**same** workflow:

```text
Gmail mailbox (FRONT_OFFICE_EMAIL)            NICeMail mailbox (NIC_EMAIL)
   │ gmailInboxReader (MAILBOX_SOURCE)           │ browser agent → Playwright → CDP
   │                                             │ nicBrowserMailbox: stored in MongoDB, once
   ↓                                             ↓
 FRONT_OFFICE_* user's inbox                  NICeMail Front Office user's inbox
   └──────────────────────┬──────────────────────┘
                          ↓  ✓ Accept   (same endpoint, same acceptMessage.js)
      Case + Case ID → MongoDB → AI summary → ACK → forward to OIC → … → final response → CLOSED
```

| | Gmail case | NICeMail case |
|---|---|---|
| Inbox shown to | the `FRONT_OFFICE_EMAIL` user | the user who signs in as `NIC_EMAIL` |
| Inquirer | the incoming `From` | the incoming `From` |
| Case field `sourceMailbox` | `{ source: 'gmail', … }` | `{ source: 'nic-browser', address: NIC_EMAIL }` |
| Acknowledgement / final response | `EMAIL_TRANSPORT` (Gmail) | NICeMail browser session |
| Their retries from the case / Dispatch page | `EMAIL_TRANSPORT` | NICeMail browser session |
| Forward to Officer-in-Charge | `EMAIL_TRANSPORT` | `EMAIL_TRANSPORT` (internal, unchanged) |

- **Routing is by mailbox, not sender.** Whatever arrives in the NICeMail mailbox belongs to the
  user whose sign-in address is `NIC_EMAIL`, and that user cannot be pointed at another mailbox.
  Case lists stay shared, as before.
- **The case remembers its mailbox.** `sourceMailbox` is written by the server at accept, from the
  signed-in user's mailbox — never from the request — and `POST /queries/persist` cannot change or
  clear it. The acknowledgement, the final response and their retries (`POST /emails/acknowledgement`,
  and `POST /emails/response` with its optional `queryId`, which the client sends) all read it from
  the stored case, so a NICeMail case is answered from NICeMail whichever user triggers the send. A
  case with no `sourceMailbox` — portal-raised, or older than the field — uses `EMAIL_TRANSPORT`.
- **Division of work.** The agent only reads mail and hands back plain message data, or types and
  sends one message it is given. Validation, case creation, the Case ID, AI summary, the workflow
  and closure all stay in the QMS, unchanged.
- **No duplicates.** Each NICeMail message is stored under an id derived from the id the reader takes
  off its inbox row (the first of `data-msgid`, `data-entityid`, `data-id`, `id`, or a hash of the
  row's text when there is none), with a unique index and insert-only writes. However often the inbox
  is polled, a message is stored once. A message the Front Office already ingested or removed is never
  reset or brought back while its stored row exists. Accepting it twice reuses the same case, as for
  Gmail. Whether that row id is NICeMail's own message id is unverified — see the open items below.
- **When reading happens.** The NICeMail Front Officer's inbox poll (every 30 s) starts a background
  sync at most every `NIC_BROWSER_SYNC_TTL_MS`; nobody signed in as that user, no sync. A new message
  appears on the poll after the sync that found it. A failed sync (Chrome closed, signed out,
  selectors not matching) is reported in the inbox response's `sync` field
  (`{ ok, at, stored, stage, error, running }`), and the IPC Mailbox page shows it as **NICeMail could
  not be read — this list may be out of date** (§13). Stored mail still lists and the backend stays up.
- **Sending guard.** Browser sends are confined to `NIC_BROWSER_TEST_RECIPIENT` until
  `NIC_ALLOW_OUTBOUND=true`, the same two-key interlock as NIC SMTP. The transport refuses Bcc rather
  than dropping it. A send that fails before Send is pressed — a refused recipient, a selector not
  found — has sent nothing: the ACK stays unsent (✓ again, or the case page's retry) or the case stays
  at `READY_FOR_DISPATCH`, never falsely closed.
- **How a send is confirmed.** After pressing Send, the agent waits for the compose form to close,
  watching the Send button it pressed — the locator captured before the click. It never looks the
  button up again: a successful send removes it, so a fresh lookup would report the ordinary success
  as "`sendButton` was not found", nothing would be recorded, and the next retry would mail the
  inquirer again. The form closing is the **only** signal accepted as "sent". There is deliberately
  no `sentConfirmation` selector: a generic `[role=alert]` / `[role=status]` match is satisfied by
  error alerts and permanent status regions too, so it would record a failed send as sent and let
  final approval close the case on it. One may be added back only with a text match proven against
  the live mailbox by `npm run nic:browser:discover`.
- **Unconfirmed sends.** If Send was pressed but the form has not closed within
  `NIC_BROWSER_TIMEOUT_MS`, the send throws with `unconfirmed: true`: the message may or may not have
  left. Accept answers `errors: [{ step: 'acknowledgement', unconfirmed: true, … }]` and records
  no acknowledgement, writes an `EMAIL_SEND_FAILED` audit row saying it may have been sent, and its
  toast says to check the NICeMail Sent folder before retrying instead of "retry from the case
  page". The case page's and Dispatch page's retries answer **504** with the same warning and
  `unconfirmed: true`. Final approval answers
  `errors: [{ step: 'dispatch', unconfirmed: true, … }]`, keeps the case at `READY_FOR_DISPATCH`,
  and writes an `EMAIL_SEND_FAILED` audit row and a Front Office notification that say to check the
  Sent folder before retrying. What to do: §13.

### Calibrating the selectors — do this first

**The selectors are uncalibrated.** Nobody has yet run the agent against the real NICeMail page.
Every element it clicks, reads or types into is listed in
[`backend/src/services/email/nic/browser/selectors.js`](../backend/src/services/email/nic/browser/selectors.js)
as a role- and label-based guess, and stays a guess until the steps below have been done. Test 2
cannot work before this.

1. Start Chrome with CDP (§8) and sign in to NICeMail (§9).
2. Run `npm run nic:browser:discover` with the **inbox** open, then again with a **message** open,
   then again with a **compose window** open (opened by hand; discovery never opens one).
3. Read the `Agent selectors` section. Every reading selector needs matches on the inbox/message
   views, and every compose selector on the compose view. `First message rows` should show a stable
   id attribute. If it shows `(no id attribute …)`, a content hash is used instead, which is weaker.
4. Edit only `selectors.js` until they match, re-running discovery each time.

An element that matches nothing fails loudly, in the inbox `sync` status or, for a send, before Send
is pressed: `NICeMail UI element "<key>" was not found. Recalibrate browser/selectors.js.` An
element that matches the **wrong** thing fails silently: the agent reads, clicks or types there.
Calibration is what rules that out; the open items below list what depends on it.

### Configuration

```env
NIC_BROWSER_MAILBOX=true
NIC_EMAIL=contact.ecoclubs-edu@gov.in       # the mailbox, and the second Front Office's sign-in
NIC_FRONT_OFFICE_NAME=Eco-Clubs Front Office
NIC_BROWSER_TEST_RECIPIENT=<your test inquirer address>
NIC_ALLOW_OUTBOUND=false                    # true only when real inquirers may be answered
```

`NIC_EMAIL` must differ from `FRONT_OFFICE_EMAIL` (the backend refuses to start otherwise), and
MongoDB must be running. Moving to the IPC mailbox is `NIC_EMAIL=lab.ipc@gov.in` plus signing in to
that account in the dedicated Chrome — see §15 for what else follows `NIC_EMAIL`.

### Testing both paths

**Test 1 — Gmail.** From an external address, mail `FRONT_OFFICE_EMAIL`. Sign in as the
`FRONT_OFFICE_EMAIL` user. The mail is in their inbox and **not** in the NICeMail Front Office's.
Accept → case, AI summary, ACK from Gmail, forward to OIC → continue the workflow to closure. The
final response goes from Gmail.

**Test 2 — NICeMail.** Cannot pass until the selectors are calibrated (above).
1. Close Brave or any other program on port 9222. Start the dedicated Chrome and sign in to NICeMail.
2. From the test inquirer address (`NIC_BROWSER_TEST_RECIPIENT`), mail `NIC_EMAIL`.
3. Sign in to IPC-QMS as `NIC_EMAIL` with `QMS_SEED_PASSWORD` (dev login refuses this account). Within
   about a minute the message appears. Reloading repeatedly shows it once. If the page shows **NICeMail
   could not be read**, fix what its stage names (§13) before going on.
4. Accept → one case with `sourceMailbox.source = 'nic-browser'`. The ACK appears in NICeMail's
   **Sent** folder, addressed to the inquirer. The forward to the OIC goes out as before.
5. Continue the workflow to final approval. The final response is sent from NICeMail and the case
   closes.
6. The mail never appears in the Gmail Front Office's inbox.

If a toast, banner or notification says a send **may already have been sent**, the send is
unconfirmed: check NICeMail's **Sent** folder before any retry (§13). A blind retry of a message that
did go out reaches the inquirer twice.

### Known limitations — open

None of these is fixed. Each is a way the NICeMail mailbox can go wrong in operation.

**Depend on calibration** — until `selectors.js` is calibrated against the live page:

- **The reader may read the wrong message.** After clicking a row it waits for the reading pane to be
  visible, and a pane already showing the previous message satisfies that at once. A wrong read is
  stored permanently: stored rows are never rewritten.
- **The dedupe key may not be NICeMail's message id.** It is a DOM attribute of the inbox row, or a
  hash of the row's text; if that is not stable, the same message can be stored twice or a new one
  skipped as known.
- **Recipients are not verified.** Each address typed into compose is committed with Enter, which
  can pick an autocomplete suggestion instead, and the chips are not checked against the intended
  list before Send.
- **The signed-in account is not checked against `NIC_EMAIL`.** Whatever account the Chrome tab is
  signed in to is read and sent from.

**Ingestion:**

- Each sync inspects at most `NIC_BROWSER_SYNC_MAX` rows from the top, and rows already stored count
  against that budget. A backlog larger than that — Chrome closed for a busy morning — can be missed
  for good.
- Nothing is stored until the whole sync finishes; a failure partway stores nothing from that sync.
- A message whose sender cannot be read is dropped without a trace — not stored, not logged. Its
  attachments are downloaded before that check, so they still land in the attachment store,
  referenced by nothing.
- A failed attachment download is stored with a null `attachmentId`, and the fail-closed forward
  refuses it — permanently, for that message.

**Isolation and state:**

- **Mailbox isolation is inbox-only.** Only the NICeMail Front Office's own requests are pinned to
  its mailbox. In Mongo mode (`MAILBOX_SOURCE=auto` with MongoDB connected) the primary Front Office
  or `SUPER_ADMIN` can list, mark ingested or hard-delete NICeMail messages by passing `?recipient=`
  set to `NIC_EMAIL`. In any mode they can accept a NICeMail message by its id: the primary
  mailbox's accept takes the message from the request body and records a non-NICeMail
  `sourceMailbox`, so that case is answered through `EMAIL_TRANSPORT`.
  `POST /mailbox/messages/:id/decision` and `GET /mailbox/decisions` are not scoped to a mailbox at
  all.
- **The "already handled" memory is the MongoDB row.** A removed message is hidden, not deleted, and
  that row is all that stops the next sync storing it again. `DELETE /api/v1/mailbox` (while the
  primary mailbox is the Mongo store), a hard delete through the route above, or `npm run db:reset`
  removes it, and the next sync that reaches the message stores it again — after `db:reset`, which
  also clears the decisions, as a new, undecided message.
- **Two concurrent accepts can acknowledge twice.** Both can pass the "already acknowledged?" check
  before either records one — the browser queue makes that window long — and both send.
- **Any signed-in role can edit a case's inquirer and response text** through `/queries/persist`.
  Pre-existing, but for a NICeMail case it decides what the official mailbox sends (§14).
- **An unconfirmed send cannot be recorded as sent**, and the flag is not stored on the case. After
  an unconfirmed accept or approval, the case page and Dispatch page still offer a plain retry; only
  the audit history says the send may have gone out (§13).
