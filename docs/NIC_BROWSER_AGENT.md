# NICeMail Browser Agent — Setup & CDP Runbook

How to set up the NICeMail browser agent on a fresh Windows development machine: a dedicated Chrome
session, the Chrome DevTools Protocol (CDP) on `localhost:9222`, a manual NICeMail sign-in, and
the agent's own CDP client attaching to that session.

> **The browser agent never logs in to NICeMail.** You sign in by hand, MFA included, in a dedicated
> Chrome window. The agent only *attaches* to that already-authenticated session through CDP.

---

## 1. Overview

NICeMail is reachable by two unrelated mechanisms in this repo (see
[backend/README.md](../backend/README.md), "NICeMail"):

| #   | Mechanism                                  | Configured by                                         | Used for                                                               |
| -----| --------------------------------------------| -------------------------------------------------------| ------------------------------------------------------------------------|
| 1   | IMAP/SMTP                                  | `NIC_EMAIL`, `NIC_IMAP_*`, `NIC_SMTP_*`, app password | the production mail path (`MAILBOX_SOURCE=nic`, `EMAIL_TRANSPORT=nic`) |
| 2   | **Browser agent over CDP** (this document) | `NIC_CDP_ENDPOINT`, `NIC_WEBMAIL_*`, `NIC_BROWSER_*`  | attaching to a human-authenticated NICeMail web session                |

The two share no code and no credentials.

**What the browser agent does:**

- Connects to a running Chrome through CDP with its own DevTools Protocol client
  (`browser/cdp.js`). There is no Playwright anywhere in the agent.
- Finds the NICeMail tab among all open tabs and checks that it is signed in.
- Runs a **read-only** inspection (`npm run nic:browser:discover`): the targets Chrome exposes,
  which document holds the mailbox, its accessibility tree, how every entry in the selector
  registry resolves, the mail rows as the agent sees them, and a diagnosis (§12).
- With `NIC_BROWSER_MAILBOX=true`: **reads** the NICeMail inbox into a second Front Office inbox,
  and **sends** all three emails of a case that came from that mailbox — the acknowledgement, the
  forward to the Officer-in-Charge and the final response. A send counts only once it is proven: the
  compose form has closed and the message is in NICeMail's Sent folder. See
  [§17](#17-two-front-office-mailboxes).

There is no separate agent process to start. The backend runs the agent on demand, only when the
NICeMail Front Officer's inbox is polled or a case from that mailbox sends one of its emails —
whoever triggers the send. The agent's modules are imported at that point, never at boot. Browser
work is serialised: one read or send at a time.

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
             IPC-QMS browser agent (Node, raw CDP client — cdp.js)
                     │  attaches; opens a background tab of its own at NIC_WEBMAIL_APP_URL
                     ↓
               NICeMail web UI (mail.mgovcloud.in/zm, a top-level document in that tab)
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
        ✗ does not load the browser agent at boot; its modules load only on first use

Browser agent  (npm run nic:browser:discover, or on demand for the NICeMail Front Office)
   └── Chrome / CDP :9222 → NICeMail
```

If Chrome is not running or port 9222 is unavailable, the backend still starts and serves normally.
Only browser-agent work fails, and it is reported (see §17), not thrown at the whole API.

## 3. Prerequisites

| Requirement | Version / detail | Verify |
|---|---|---|
| Windows | 10 or 11 | — |
| Node.js | **≥ 22** for the browser agent: `cdp.js` speaks CDP over Node's global `WebSocket`, which Node enables by default from 22. The backend alone needs ≥ 20.19 (`mongoose@9`). No `engines` field. Node 22 or 24 LTS is fine. | `node --version` |
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
│   ├── .env.example                  env template (reference: docs/ENVIRONMENT.md)
│   ├── package.json                  scripts incl. nic:browser:discover, nic:browser:calibrate
│   └── src/
│       ├── config/
│       │   └── browserConfig.js      NIC_CDP_* / NIC_WEBMAIL_* / NIC_BROWSER_* getters
│       ├── services/email/
│       │   ├── nic/browser/
│       │   │   ├── cdp.js            the raw DevTools Protocol client (no Playwright)
│       │   │   ├── attach.js         connect, pick tab, check sign-in, release
│       │   │   ├── session.js        one serialised unit of work in the agent's own tab
│       │   │   ├── selectors.js      the selector registry (reading and compose calibrated;
│       │   │   │                     ccToggle and the attachment keys still in UNCALIBRATED — §17)
│       │   │   ├── pageKit.js        page-side resolver: role/name, visibility, uniqueness
│       │   │   ├── inspect.js        the read-only inspector behind nic:browser:discover
│       │   │   ├── readInbox.js      semantic inbox view; open and extract new messages
│       │   │   └── sendMail.js       composeEmail: fill one compose form, send, find it in Sent
│       │   ├── nic/outboundGuard.js  the NIC_ALLOW_OUTBOUND interlock
│       │   ├── mailbox/nicBrowserMailbox.js       sync + store the NICeMail inbox in MongoDB
│       │   ├── mailbox/messageView.js             the API view: status, read state, linked case
│       │   └── transports/nicBrowserTransport.js  per-case sends through the browser
│       ├── scripts/
│       │   └── nicBrowserDiscover.js read-only inspector CLI (over browser/inspect.js)
│       └── test/
│           ├── mailboxIngestion.test.js
│           ├── mailboxMessageApi.test.js
│           ├── nicBrowserAttach.test.js
│           ├── nicBrowserCdp.test.js
│           ├── nicBrowserInspect.test.js
│           ├── nicBrowserMailbox.test.js
│           ├── nicBrowserPage.test.js
│           ├── nicBrowserReadInbox.test.js
│           ├── nicBrowserSelectors.test.js
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

The browser agent has **no** automation dependency. It speaks the DevTools Protocol itself
(`browser/cdp.js`) over Node's global `WebSocket`. `playwright-core` has been removed from
`backend/package.json` and `package-lock.json`.

| Package | Used? | Notes |
|---|---|---|
| `playwright-core`, `playwright` | no | Removed. Do not add either back. |
| Playwright-bundled Chromium | no | Not for the agent: it never launches a browser. (The frontend's end-to-end suite installs its own, which is unrelated.) |
| `jsdom` | tests only | A backend **devDependency**, used only by `src/test/nicBrowserPage.test.js` to run the page-side resolver against a real DOM. Nothing at runtime loads it. |
| Locally installed Google Chrome | **yes** | The agent attaches to it over CDP. |

This is the "existing Chrome + CDP" architecture, not "an automation library launches its own
Chromium". A freshly launched browser would not be signed in, so it would be useless here.

## 6. Environment Configuration

```powershell
cd backend
Copy-Item .env.example .env.local     # skip if .env.local already exists
```

The backend itself also needs `JWT_SECRET` and a credential for every account — its entry in
`QMS_PASSWORDS_FILE`, a `QMS_PASSWORD_<USER_ID>`, or, outside production, the shared
`QMS_SEED_PASSWORD` (auto mode; never in production, see [backend/README.md](../backend/README.md))
— to start. The browser agent does not.

The browser-agent variables — `NIC_CDP_ENDPOINT`, the `NIC_WEBMAIL_*` tab settings, the
`NIC_BROWSER_*` switches, timeouts and sync limits, and `NIC_FRONT_OFFICE_NAME` — take their defaults
from `src/config/browserConfig.js`, and `NIC_ALLOW_INTERNAL_FORWARD` is read by
`src/services/email/nic/outboundGuard.js`; the only ones the backend insists on are named below.
Each one, with its default and purpose, is described in [ENVIRONMENT.md](ENVIRONMENT.md), under the
NICeMail browser agent.

There is **no** password, token or cookie variable for the browser agent, and there must never be
one.

With `NIC_BROWSER_MAILBOX=true`, `NIC_EMAIL` is required and must differ from `FRONT_OFFICE_EMAIL`,
and while `NIC_ALLOW_OUTBOUND` is not `true` a test recipient (`NIC_BROWSER_TEST_RECIPIENT`, or
`NIC_TEST_RECIPIENT`) is required too; the backend refuses to start otherwise.
`NIC_ALLOW_OUTBOUND` (the IMAP/SMTP block's interlock) also governs browser sends, and
`NIC_ALLOW_INTERNAL_FORWARD` is the one allowance inside it — without it, intake of a NICeMail case
stops at the forward while the interlock is closed.

That allowance exists on the **browser channel only**. `transports/nicTransport.js` runs its own
recipient check against `NIC_TEST_RECIPIENT` alone and never consults
`NIC_ALLOW_INTERNAL_FORWARD`, so under `EMAIL_TRANSPORT=nic` with the interlock closed the forward is
refused whatever that variable says.

The backend test suite does not read these from your `.env.local`: `backend/vitest.config.mjs` pins
every `NIC_BROWSER_*` variable, `NIC_FRONT_OFFICE_NAME`, the `NIC_WEBMAIL_*` patterns and
`NIC_ALLOW_OUTBOUND` to blank — the feature off, the interlock closed, code defaults for the rest —
and points `NIC_CDP_ENDPOINT` at an unroutable address. Enabling the feature locally therefore cannot
change what the suite sees; tests that exercise it switch it on themselves.

**Which mailbox?** The agent reads and sends as whichever account is signed in to the Chrome tab.
With `NIC_BROWSER_MAILBOX=true`, `NIC_EMAIL` is where the QMS files that mail — the mailbox its stored
messages belong to, the second Front Office's sign-in, the From address it records, and the last
fallback for the test recipient. **A send checks it**: the compose form's From must be `NIC_EMAIL`, or
nothing is sent. **A read does not** (§17, open items). Sign in to the right account;
`nic:browser:discover` shows the signed-in address, masked, in the tab title. `NIC_EMAIL` also configures the IMAP/SMTP side
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

When it reads or sends mail, it works in a **background tab of its own** in the same signed-in
browser profile, pointed at `NIC_WEBMAIL_APP_URL`. It never drives your tab, and it closes its own
tab afterwards. Reading a message marks it read in Zoho, so every message that was unread before the
agent opened it is marked unread again before the tab closes. If that tab lands on anything that looks like a sign-in step, the work stops with
`NICeMail session expired. Please authenticate again in Chrome.` before any field is touched. The only
things it types are the To/Cc/Subject/body of an outgoing case email.

### The agent tab's lifecycle, and why it is tracked

One tab per unit of work, opened at `about:blank`, navigated to the app URL, and closed again. It is
not pooled: a fresh tab is a clean slate, and a half-filled compose form left over from a failed send
is how the wrong text would go out.

Closing it is best effort — it talks to a browser that may already be gone — so "we closed it" and
"it is closed" are different facts, and the difference is held in a registry of target ids
(`session.js`). Three things follow from that:

- **A tab that would not close is closed before the next unit**, not left for the operator. The
  sweep runs at the start of each unit, which is the one moment the agent is certainly connected and
  certainly not mid-operation.
- **A `Target.createTarget` that times out is adopted.** The request is bounded like every other and a
  late answer is dropped, but Chrome may have made the tab anyway — so the target list is diffed
  around the call and the id recovered. Before this it was lost, and the tab stayed open for the rest
  of the session, once per failed sync.
- **The agent's own tabs are excluded when it looks for your signed-in one.** A leaked agent tab sits
  on the mail app's own host and scores *identically* to the operator's real tab: both earn the host
  and title points, and neither earns the path bonus, because both put the mailbox route in the URL
  hash. A tie breaks on Chrome's enumeration order, so without the exclusion the agent could take a
  leaked — possibly discarded — tab as the proof of session and read its browser context.

That last one is what made the final response fail while the acknowledgement and the forward
succeeded. Chrome discards hidden background tabs, and a discarded tab answers CDP exactly as a
healthy one does until an evaluate silently never returns. The response is simply the last of a case's
three sends and ran against the most-degraded browser. Symptom:

```
RESPONSE RESULT  stage="open_browser_tab"
    error="CDP Runtime.evaluate did not answer within 19719ms"
```

A value *below* `NIC_BROWSER_TIMEOUT_MS` and not a round number is the signature of a `waitFor`: it
computes one deadline and gives each poll what is left of it, so `19719` means the page answered one
poll quickly and then stopped answering for the whole remainder.

**Recovery.** A tab that never renders the mailbox is discarded and the unit gets **one** fresh tab.
That retry covers the setup only — opening a tab and loading the mailbox, which sends nothing. It is
gated on whether the work had been entered, so a send that failed halfway is never attempted twice:
from `click_send` onwards the message may already have gone.

**A sync gives way to a send.** One sync of `NIC_BROWSER_SYNC_MAX` messages was measured at 91 s
against the live mailbox, and it holds the single serialised session throughout. A sync will not start
while browser work is pending, and one already running stops between messages; `remaining` reports
what it left, and the next poll continues. A send is a person waiting.

## 10. How the Agent Connects (`attach.js`)

`attachToNicemail()`:

1. **Connect**: the raw DevTools Protocol over `NIC_CDP_ENDPOINT` (`browser/cdp.js`), every request
   bounded by `NIC_BROWSER_TIMEOUT_MS`. Playwright's `connectOverCDP` is deliberately not used: its
   connect waits on *every* page target in the browser, so one tab sitting on its initial empty
   document stalls the whole attach, and its driver keeps the Node process alive afterwards.
2. **Enumerate** every page **and iframe** target (not just the first tab): on the workplace front
   door the mailbox is an iframe with a target of its own.
3. **Score** each tab (`scoreTab`):
   - URL must contain one of `NIC_WEBMAIL_URL_PATTERNS`, otherwise the score is 0 and the tab is ignored → **10**
   - URL contains `inbox`, `mail`, `folder` or `message` → **+5**
   - title contains one of `NIC_WEBMAIL_TITLE_PATTERNS` → **+2**
   - URL contains a login marker (`/login`, `/signin`, `accounts.`, `oauth`, `otp`, `twofactor`,
     `2fa`) → **−8** (kept, so "not signed in" can be told apart from "no tab")
4. **Pick** the highest score. Ties go to the order Chrome reports.
5. **Check sign-in** (`isAuthenticated`): the tab counts as not authenticated if its URL has a login
   marker or an `input[type="password"]` is visible.
6. **Release**: `release()` closes the agent's own CDP socket. It does **not** close your Chrome or
   your tabs.

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

**Terminal 1 — MongoDB** (backend only, and a local MongoDB only: skip it on the team's shared Atlas
database, or if the Windows service is already running)

```powershell
Get-Service MongoDB                 # Status should be Running
Start-Service MongoDB               # if stopped (elevated PowerShell)
mongosh "mongodb://127.0.0.1:27017/query_management_system" --eval "db.runCommand({ping:1})"
```

Use the `DATABASE_URL` from your `backend/.env.local` in the `mongosh` line.

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
signed in. The discover script loads the backend's env file (`backend/.env.local`) through the same
loader as the server.

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
11. **Verify mailbox access**: discovery shows a document with `Mail list / rows  present / N`, ends
    its **Diagnosis** with `Verdict: OK` (or `WARN`), and prints
    `Discovery complete. No page state was modified.`

## 12. Verification

### The inspector: `npm run nic:browser:discover`

A read-only inspection of the signed-in session (`browser/inspect.js`; the script is a thin CLI over
it). Against your tabs it uses only `Browser.getVersion`, `Target.getTargets`,
`Target.getBrowserContexts`, `Target.attachToTarget`/`detachFromTarget`, `Runtime.evaluate` of
read-only functions, `Page.getFrameTree` and `Accessibility.getFullAXTree`: no navigation, no input,
no `*.enable`, no auto-attach, nothing injected. Addresses are masked and URL query values stripped
by default, because these reports get pasted into chats and a query string can carry a session id.

| Flag (after `--`) | Effect |
|---|---|
| none | inspect every NICeMail page and iframe target Chrome exposes |
| `--json` | also write the full report to `NIC_BROWSER_ARTIFACT_DIR` (default `backend/storage/nic-browser/nic-inspect-<timestamp>.json`, gitignored) |
| `--rows=N` | show N mail rows (default 5) |
| `--show-addresses` | do not mask addresses; query values are still stripped |
| `--agent-tab` | also open the agent's own background tab at `NIC_WEBMAIL_APP_URL`, inspect it and close it, exactly as a sync does. The only flag that opens anything |

For each candidate document the report gives its frame tree, element, shadow-root and frame counts,
the cross-origin frames it could not search, `document.hidden`, a role and landmark census, the named
controls in the accessibility tree, an inventory of interactive elements (the cells of mail rows
collapsed to one line with a count, their text left out), and a census of build-hashed class names.
Where the mail list is present it adds the registry resolution of every key in `selectors.js`, the
first mail rows (id, unread, list date, size, sender, subject) and, when a message is open, what was
extracted from it plus a probe of attachment-like elements.

### Sample output (live, abridged)

From the operator's Chrome, signed in on the Workplace front door, 2026-09-22, with a compose form
opened by hand (**New Mail**, nothing typed). Addresses are masked as the tool masks them; message ids,
senders and subjects are placeholders.

```text
NICeMail browser discovery — READ ONLY.
Nothing in your tabs is clicked, typed, navigated, opened or sent.

── CDP
  Endpoint                          http://localhost:9222/
  Browser                           Chrome/152.0.7977.83 (protocol 1.3)
  Browser contexts                  default <id>, +0 other

── Pages and iframes Chrome exposes
  [match(17) ] page    6C4C38FF https://workplace.mgovcloud.in/#mail_app/compose
  [match(17) ] iframe  7B2EE154 https://mail.mgovcloud.in/zm/?fromService&wpVersion&canAddOACHeader&frameorigin&  in 6C4C38FF
  [match(10) ] iframe  52ABA1B1 https://nrc2-wms.mgovcloud.in/v2/wmsconnector.html?tabid&wmsid&nocache&frameorig  in 6C4C38FF
  …
  Other targets: 1 service_worker, 1 worker, 2 browser_ui

── Document 6C4C38FF (page)
  URL                               https://workplace.mgovcloud.in/#mail_app/compose
  Ready / hidden                    complete / hidden
  Elements                          130 (0 shadow roots, 1 same-origin frames)
  Cross-origin frames               https://mail.mgovcloud.in/zm?fromService&wpVersion&canAddOACHeader&frameorigin&wpLibraryIn
  Mail list / rows                  absent / 0
  Generated classes                 60 hashed (e.g. zmbtn__rhuj3, zmbtn--mbtn__rhuj3, zmbtn--filled__rhuj3), 5 legacy zm*
  …

── Document 7B2EE154 (iframe)
  URL                               https://mail.mgovcloud.in/zm/#compose
  Title                             New Mail - Mail (c***@gov.in)
  Ready / hidden                    complete / hidden
  Elements                          6011 (0 shadow roots, 3 same-origin frames)
  Mail list / rows                  present / 179
  Roles                             button 741, checkbox 180, option 179, treeitem 20, group 10, …
  Row-like elements                 179 option in listbox "Email listing"
  Accessibility tree                691 nodes
      button "New Mail"
      tab "No Subject"
      treeitem "Inbox"
      …
  Interactive elements (120 kinds, first 60):
      ×1  button "New Mail" testid=new-btn-opt
      ×1  treeitem "Sent" testid=lhs-tree-node
      …
  Registry (browser/selectors.js):
      listRow                         #0 → 179
      listRowSender                   #0 → 179
      listRowSubject                  #0 → 179
      listRowAttachment               #0 → 1          UNCALIBRATED
      previewMessage                  none (raw 0)    MISSING
      attachmentEntry                 #3 → 1          FALLBACK UNCALIBRATED
      composeButton                   #0 → 1
      toInput                         #0 → 1
      ccInput                         #0 → 1
      ccToggle                        none (raw 3)    HIDDEN UNCALIBRATED
      subjectInput                    #0 → 1
      bodyEditor                      #0 → 1
      fileInput                       #0 → 1
      sendButton                      #0 → 1
      discardButton                   #0 → 1
      fromAddress                     #0 → 1
      recipientChip                   none (raw 0)    MISSING
      composeAttachmentRow            none (raw 0)    MISSING
      folderSent                      #0 → 1
      folderDrafts                    #0 → 1
      …
  Mail rows (inbox, 179 loaded):
      1790000000000000001  unread  11:21 AM   3 KB    e***@example.org               <subject>
      …

── Diagnosis
  ✓ Connected to Chrome/152.0.7977.83 at http://localhost:9222/
  ✓ NICeMail tab: https://workplace.mgovcloud.in/#mail_app/compose
  ✓ Signed in (no sign-in step or password field on any NICeMail document)
  i The mailbox is a cross-origin iframe with a CDP target of its own (https://mail.mgovcloud.in/zm/#compose), inside https://workplace.mgovcloud.in/#mail_app/compose, whose own document shows 0 mail rows. Anything that reads the tab's main page sees only that shell. The agent is unaffected: it opens https://mail.mgovcloud.in/zm/ as a top-level document of its own.
  ✓ No shadow DOM in the mail document.
  i The document is hidden (a background tab): the agent dispatches DOM events, not mouse input.
  ✓ Mail list rendered: 179 row(s) loaded.
  ✓ Compose form open: all 8 of its controls resolve.
  ✓ 26 of 41 calibrated entries resolve here; 3 are uncalibrated.

  Verdict: OK

Discovery complete. No page state was modified.
```

A registry line reads `#<strategy> → <count>` — which strategy of the entry matched, counted from 0,
and how many elements passed its checks — or `none (raw N)` with the count before the checks.
`MISSING` on the open-message keys (`previewMessage`, `senderAddr`, `body`, …) is expected with no
message open, and on the compose keys with no compose form open; what must resolve on the Inbox is the
folder tree, the list, the row cells and the preview pane. With a form open, its eight controls
(`fromAddress`, `toInput`, `ccInput`, `subjectInput`, `bodyEditor`, `fileInput`, `sendButton`,
`discardButton`) must all resolve. `recipientChip` and `composeAttachmentRow` stay `MISSING` on an
empty form — there is no recipient or attachment yet. `ccToggle` is hidden whenever Cc is already
shown, as it is by default. `listRowAttachment` and `attachmentEntry` (by its last, CSS strategy —
the same selector) each match one element, and what that element is has not been established:
exactly why they are still `UNCALIBRATED`.

| Registry warning | Meaning |
|---|---|
| `MISSING` | nothing matched, by any strategy, even before the checks |
| `FALLBACK` | resolved, but not by the first (most semantic) strategy |
| `HIDDEN` | matched only elements that are not visible |
| `NAME_MISMATCH` | matched visible elements whose accessible name is not the one expected |
| `AMBIGUOUS` | more than one match where the entry demands `unique` |
| `UNCALIBRATED` | a marker, not a warning: the key is in `UNCALIBRATED` and the agent will not use it (§17) |

| Diagnosis | Status | Meaning |
|---|---|---|
| `NO_CDP` | FAIL | the CDP connection failed: nothing answers on `NIC_CDP_ENDPOINT`, or something that is not Chrome's DevTools endpoint does — the bracketed error says which (§8, §13) |
| `NO_TAB` | FAIL | no page or iframe target matches `NIC_WEBMAIL_URL_PATTERNS` |
| `NOT_SIGNED_IN` | FAIL | a sign-in step or a password field on a NICeMail document; sign in by hand |
| `NO_MAILBOX` | FAIL | no NICeMail document shows the mail list; open the Inbox and let it render |
| `INSPECTION` | FAIL | the inspection itself stopped; the message says where |
| `MAILBOX_IN_OOPIF` | info | the mailbox is a cross-origin iframe inside the Workplace shell; the agent is unaffected (§13) |
| `SHADOW_DOM` | ok / info, or FAIL | shadow roots are searched by the resolver; FAIL only when the mail list itself sits inside one, where the reader's page code does not look |
| `HIDDEN_DOCUMENT` | info | a background tab: the agent dispatches DOM events, not mouse input |
| `SELECTORS_DRIFTED` | FAIL | the list shows rows and none matches `listRow`, a key expected on the Inbox found nothing, or a compose form is open and one of its eight controls found nothing |
| `COMPOSE` | ok / info | ok: a compose form is open and all eight of its controls resolve; info: no form is open, so they were not checked |
| `REGISTRY` | WARN | a calibrated entry carries a warning other than `MISSING` (`FALLBACK`, `HIDDEN`, `NAME_MISMATCH`, `AMBIGUOUS`), or `composeButton` does not resolve |

The terminal prints each check as its message behind a mark — `✓` ok, `i` info, `!` warning, `✗`
failure — as in the sample above; the codes are in the `--json` report, under `diagnosis.checks`.
The verdict is `OK` when there is nothing worse than information, `WARN` with a warning, `FAIL` with a
failure; the exit code is 1 only on `FAIL`.

What to check:

- a NICeMail target shows `match(n)` with n > 0
- one document shows `Mail list / rows  present / N`, and the row, sender and subject counts in the
  registry are equal
- `composeButton` resolves by strategy `#0` (`button "New Mail"`)
- with a compose form opened by hand (**New Mail**, nothing typed), the diagnosis reads
  `Compose form open: all 8 of its controls resolve.`, each of them by strategy `#0`. Close the form
  by hand afterwards without sending
- no `✗` line in the diagnosis, and the run ends with `Verdict: OK`, `Discovery complete.` and exit code 0
  (`$LASTEXITCODE`)
- run `npm run nic:browser:discover -- --agent-tab` once: the agent's own tab is one top-level
  document with the list present and the same registry resolving, and exactly one tab is opened and
  closed

### Checklist

**Environment**
- [ ] `node --version` ≥ 22 (the agent's CDP client needs Node's global `WebSocket`), `npm --version` works
- [ ] `npm install` done in `backend/` (no browser-automation package is needed)
- [ ] Google Chrome ≥ 136 installed
- [ ] `backend/.env.local` exists (browser-agent variables optional; defaults in [ENVIRONMENT.md](ENVIRONMENT.md))

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
- [ ] "The tab the agent would attach to" prints a URL and title rather than an error
- [ ] a document shows the mail list present, with its rows and the registry resolution
- [ ] ends with `Verdict: OK` (or `WARN`) and `Discovery complete.`

## 13. Troubleshooting

### Why an agent cannot see the NICeMail elements

**Symptom.** A tool or agent attached to the operator's NICeMail tab finds no mail rows, no
**New Mail** button, a handful of controls and class names such as `zmbtn__rhuj3`, and
`[role="option"]` matches nothing.

**Cause, measured live** (Chrome 152, 2026-09-21). The operator's tab is the **Zoho Workplace
shell**, `workplace.mgovcloud.in/#mail_app/…`. The mailbox is not in that document: it is a
**cross-origin, out-of-process iframe** (`mail.mgovcloud.in/zm/…`) with a **CDP target of its own**.
Anything that evaluates in, or locates on, the tab's main page sees only the shell: about 120
elements, a strip of app tabs, generated CSS-module classes (`zmbtn__<hash>`) that change on every
Zoho deploy, and zero mail rows. Script in the shell cannot read a cross-origin frame, and a CDP
session on the page target cannot evaluate in the iframe's target. It is **not** shadow DOM: both
documents have 0 shadow roots. The mail frame is also `document.hidden`, so mouse input sent to
coordinates does nothing there; the agent dispatches DOM events instead.

**The QMS agent is unaffected.** It never reads the operator's tab. It opens `NIC_WEBMAIL_APP_URL`
(`https://mail.mgovcloud.in/zm/`) as a top-level document in a background tab of its own, where the
mailbox is the whole page (§9, §10).

**How the inspector reports it.** `npm run nic:browser:discover` lists the iframe target with its
parent (`iframe 1A6D58D6 https://mail.mgovcloud.in/zm/… in 6C4C38FF`), inspects each target as its
own document — the shell shows `Mail list / rows  absent / 0`, the frame `present / 400` — and the
diagnosis reports `MAILBOX_IN_OOPIF` as information, not a failure (§12):

```text
  i The mailbox is a cross-origin iframe with a CDP target of its own (https://mail.mgovcloud.in/zm/#mail/folder/inbox), inside https://workplace.mgovcloud.in/#mail_app/mail/folder/inbox, whose own document shows 0 mail rows. …
```

`npm run nic:browser:discover -- --agent-tab` shows the agent's own view: one top-level document with
the list and the registry. Any other tool has two options: attach to the iframe target
(`mail.mgovcloud.in/zm/…`) rather than the page, or open `https://mail.mgovcloud.in/zm/` in a tab of
its own. Either way, match by role and accessible name, `aria-label`, `data-testid` and
`data-action`, never by the hashed classes.

### `Chrome is not available for browser automation.` … `(fetch failed: ECONNREFUSED)`

The inspector's diagnosis is `NO_CDP`, with the raw error in brackets and on the `CDP` section's
`Error` line; a refused connection or a timeout there means nothing is listening. The agent's own
attach reports the same sentence.

This means the Chrome/CDP session is unavailable. It is **not** a NICeMail login problem. Causes:

- Chrome was not started with `--remote-debugging-port=9222`.
- A Chrome window using `C:\qms-chrome` was already open, so the new launch was handed to it and the
  flag was ignored. Close **all** Chrome windows for that profile (check Task Manager) and relaunch.
- `--user-data-dir` was omitted, and Chrome 136+ ignores the flag on the default profile.
- `NIC_CDP_ENDPOINT` points at a different port than the one Chrome was started with.

Confirm with `Invoke-RestMethod http://localhost:9222/json/version`. If that succeeds and the bracket
says `WebSocket is not defined`, Node is older than 22 (§3).

### `Chrome is not available for browser automation.` … `(CDP endpoint answered HTTP 404)`

The inspector prints the same sentence as above (diagnosis `NO_CDP`), but the bracket shows that
something did answer on the port. The agent's own attach reports this as `Something is listening on
the CDP port, but it is not a Chrome DevTools endpoint. …`. Another program (Brave, Edge, a second Chrome profile, some other tool) holds port 9222, and Chrome
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

The CLI failed outside the inspection, for example while writing the `--json` report. Re-run once. If
it persists, note the message and the NICeMail URL for whoever maintains `browser/inspect.js`.
Failures inside the inspection do not end up here: a part that fails on one document — a page that
navigated mid-run, say — is printed as `(could not read …)` under that document, and an inspection
that stops altogether is the diagnosis `INSPECTION`.

The entries below apply with `NIC_BROWSER_MAILBOX=true`, when the backend reads and sends through the
agent (§17).

### `The mailbox could not be read — this list may be out of date` (IPC Mailbox page)

The last inbox sync failed. The inbox request still answers 200 with the mail already stored and
reports the failure in the response's `sync` field (`ok: false`, `stage`, `error`); the notice prints
both. Messages the failed sync read before it stopped are kept (`stored` counts them); nothing more
is stored until a sync succeeds.

| `stage` in the notice | Fix |
|---|---|
| `connect_browser` | Chrome/CDP is not reachable — the entries above |
| `find_tab` | open NICeMail in the dedicated Chrome |
| `verify_session` | sign in again by hand; the tab, or the agent's work tab, is on a sign-in step |
| `ui` | a selector matched nothing, the list shows rows that no row selector matches, or every message opened failed — run `nic:browser:discover` and calibrate (§17) |
| none | something else failed — including a failure to store in MongoDB; the error text says what |

A message that could not be read is not a failed sync: it is counted in `sync.failed`, listed in
`sync.failedMessages` and tried again next time (§17, *How a sync reads the inbox*).

The notice goes once the page reloads the list after a successful sync (**Check IPC Mailbox**, or
Auto-refresh).

### `NICeMail UI element "<key>" was not found. Recalibrate browser/selectors.js.`

Stage `ui`: the selector `<key>` in `selectors.js` matched nothing on the live page — or matched only
elements that failed its checks (hidden, the wrong accessible name, more than one where one is
required). `details.tried` gives the counts per strategy. When the message adds
`N cross-origin frame(s) could not be searched`, the element may be inside one (see the first entry
of this section). During a send this is always raised **before** Send is pressed, so nothing went
out and a retry is safe once the selector is fixed. Calibrate (§17).

### `NICeMail UI element "<key>" has never been calibrated against the live NICeMail mailbox, so the agent will not use it.`

Stage `ui`, flagged `uncalibrated: true`. The key is in `UNCALIBRATED` and the agent refuses it before
the page is asked anything about it, so nothing was sent. Since the compose form was calibrated
(2026-09-22, §17 runbook C) the set is `ccToggle`, `attachmentEntry` and `listRowAttachment`. A send
meets it only when a message has Cc recipients and the Cc line is hidden, which it is not by default.
It is not a fault to retry: calibrate the key (§17) first.

### `NICeMail may have sent this message but did not confirm it in time. Check the NICeMail Sent folder before retrying …`

Stage `confirm_send`, flagged `unconfirmed`. Send was pressed and the message did not appear in the
Sent folder within `NIC_BROWSER_TIMEOUT_MS`. Either the compose form never closed, or it closed and
the message still did not show up (the message then reads *…the compose form closed, but the message
did not appear in the Sent folder in time.*). The message may or may not have left, and the agent
cannot tell.

The bracket at the end of the error says which step and what the page showed. For example,
`[stage: await_compose_close; cause: Timeout …; seen: dialog open: "…"; Send button still visible]`
means the form stayed open with a dialog over it. The backend log has the full
`ACK VERIFICATION {"step":"compose_not_closed", …}` snapshot (§17, *Every send is logged*).

The dispatch is recorded `UNCERTAIN` in `outboundemails`, and that state **blocks the retry**: a
retry could put a second copy in the recipient's inbox, which is the one outcome worse than the
email not arriving. No channel here can search its own Sent folder for a message it may have sent,
so the answer has to come from a person.

1. Open the **Sent** folder in the dedicated Chrome and look for the message.
2. **If it is there**, press **It was sent**. The QMS records the email exactly as a successful send
   would — the acknowledgement appears on the case, a final response closes it — and **sends
   nothing**. The answer is audited as `EMAIL_DELIVERY_CONFIRMED` against your account.
3. **If it is not there**, press **It was not sent — send it**. That marks the dispatch `FAILED`
   (audited `EMAIL_DELIVERY_DENIED`), which unlocks the retry, and sends it once.

Where the warning appears:

- **Acknowledgement, at accept:** the accept toast, and an `EMAIL_SEND_FAILED` row in the case's
  audit history saying it may have been sent.
- **Final response, at approval:** the approval banner's error text, the Front Office notification,
  and an `EMAIL_SEND_FAILED` row.
- **A retry that itself ends unconfirmed:** the case page's **Retry sending** and the Dispatch page's
  **Retry sending response** answer HTTP **504** with this message and `unconfirmed: true`. The case
  page's notice then reads **Acknowledgement may already have been sent**; the Dispatch page shows
  the message in its error banner. Each such retry is audited as `EMAIL_SEND_FAILED`.

**The state is stored on the case, not remembered from the click.** It is a row in
`outboundemails`, so it survives a reload and is still there hours later — which matters, because
the person who has to look in the Sent folder is often not the one who pressed the button. Both
pages read it: the case page's notice reads **Acknowledgement may already have been sent** with the
two answers beneath it, and the Dispatch page replaces **Retry sending response** with the same
pair. Neither offers a plain retry while the dispatch is `UNCERTAIN`.

### `NICeMail browser transport refused to send to …`

The outbound interlock refused before the browser was touched; nothing was sent. Browser sends are
confined to `NIC_BROWSER_TEST_RECIPIENT` until `NIC_ALLOW_OUTBOUND=true`. Expected while testing
with any other inquirer address.

The forward to the Officer-in-Charge is refused the same way, and the error names the allowance: set
`NIC_ALLOW_INTERNAL_FORWARD=true` to open exactly `OFFICER_IN_CHARGE_EMAIL` alongside the test
recipient. A refused forward leaves the case at `FRONT_OFFICE_VERIFICATION`, which is what
`POST /emails/forward` acts on once the variable is set.

### `NICeMail session expired. Please authenticate again in Chrome.`

Stage `verify_session`: your tab looked signed in, but the agent's work tab landed on a sign-in step.
Sign in again by hand in the dedicated Chrome.

### `The NICeMail browser mailbox needs MongoDB, which is not connected.` (HTTP 503)

The NICeMail mailbox is stored in MongoDB and has no in-memory fallback. In development the backend
starts without MongoDB, but this mailbox does not work until it is connected (§11).

## 14. Security

- **Never commit credentials**: no NICeMail passwords, no application-specific passwords, no OAuth
  refresh tokens, no session cookies.
- **Never put secrets in Markdown** or any other tracked file. Secrets go in `backend/.env.local`,
  which is gitignored.
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
  attempt as `LOGIN_FAILED` / `denied`. It signs in through `POST /auth/login` with its own
  credential — its entry in `QMS_PASSWORDS_FILE`, or `QMS_PASSWORD_USR_0014`.
- **Dev login remains open for every other seeded account.** It answers whenever
  `NODE_ENV=development` — the default when `NODE_ENV` is unset — and the backend listens on all
  interfaces, so anyone who can reach the port can sign in without a password as any other seeded
  user. That includes `SUPER_ADMIN`, which reads the primary mailbox, whatever `MAILBOX_SOURCE`
  selects — a real mailbox, read over IMAP, under `MAILBOX_SOURCE=nic`. This development-mode exposure
  pre-dates the NICeMail mailbox and is not fixed: do not run a development-mode backend where
  untrusted hosts can reach it.
- **Outbound mail is confined** to `NIC_BROWSER_TEST_RECIPIENT` until `NIC_ALLOW_OUTBOUND=true` —
  the same two-key interlock as NIC SMTP, with `NIC_ALLOW_INTERNAL_FORWARD` the one allowance inside
  it, for the forward to the Officer-in-Charge alone.
- **What the official mailbox sends is not locked to the case.** `POST /queries/persist` is guarded by
  `middleware/authorizeCaseDelta.js`, but that bounds *which* cases a principal reaches, not what it
  may write inside one — and for the Front Office, Officer-in-Charge, Admin and Super Admin it bounds
  nothing at all, because those four see every case. So any of them, and any scoped role party to the
  case, can edit its inquirer and its response text, which for a NICeMail case decide what the
  `.gov.in` mailbox sends and to whom.
- **The retry endpoints take the body only when MongoDB is down.** With a database connected,
  `POST /emails/acknowledgement` and `POST /emails/response` pass straight to `caseMail` and read
  nothing from the request but `queryId` — recipient, subject, body and attachments all come from the
  stored case, and the send goes through the at-most-once ledger. Without a database they fall back to
  a path that does take the recipient, subject, body and attachments from the request and has no
  ledger behind it. That fallback cannot apply to a NICeMail case, which needs the stored
  `sourceMailbox` to route at all, but it is why the endpoints are limited to Front Office and Super
  Admin.
- **Mailbox isolation does not cover accept or the decision routes** — see §17, open items.

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
- `NIC_BROWSER_ARTIFACT_DIR` (default `storage/nic-browser`, under the gitignored `backend/storage/`)
  is where `nic:browser:discover -- --json` writes its reports. They are masked unless
  `--show-addresses` was given, but they still describe a live government mailbox: keep them out of
  the repository.

## 16. Quick Reference

| Task | Command (PowerShell) |
|---|---|
| Check Node / npm | `node --version; npm --version` |
| Install deps | `cd backend; npm install` |
| Create env file | `cd backend; Copy-Item .env.example .env.local` |
| Check MongoDB | `Get-Service MongoDB` |
| Start backend | `cd backend; npm run dev` |
| Start frontend | `cd frontend; npm run dev` |
| Start dedicated Chrome + CDP | `& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\qms-chrome"` |
| Verify CDP | `Invoke-RestMethod http://localhost:9222/json/version` |
| Who holds 9222 | `Get-NetTCPConnection -LocalPort 9222 -State Listen \| ForEach-Object { Get-Process -Id $_.OwningProcess }` |
| Inspect the session (read-only) | `cd backend; npm run nic:browser:discover` |
| … and save the report | `cd backend; npm run nic:browser:discover -- --json` |
| … and the agent's own tab | `cd backend; npm run nic:browser:discover -- --agent-tab` |
| Calibrate the compose form (types into one draft, discards it, never sends) | `cd backend; npm run nic:browser:calibrate` (`-- --attach` also attaches a small PDF) |
| Unit tests for attach logic | `cd backend; npx vitest run src/test/nicBrowserAttach.test.js` |
| Unit tests for the resolver and the registry | `cd backend; npx vitest run src/test/nicBrowserPage.test.js src/test/nicBrowserSelectors.test.js` |
| Unit tests for the inspector | `cd backend; npx vitest run src/test/nicBrowserInspect.test.js` |
| Unit tests for reading and syncing | `cd backend; npx vitest run src/test/nicBrowserReadInbox.test.js src/test/mailboxIngestion.test.js` |
| Unit tests for the NICeMail mailbox | `cd backend; npx vitest run src/test/nicBrowserMailbox.test.js` |
| Unit tests for composing and send confirmation | `cd backend; npx vitest run src/test/nicBrowserSendMail.test.js` |

## 17. Two Front Office Mailboxes

With `NIC_BROWSER_MAILBOX=true`, IPC-QMS runs two Front Office mailboxes at once. Both feed the
**same** workflow:

```text
Primary mailbox (FRONT_OFFICE_EMAIL)          NICeMail mailbox (NIC_EMAIL)
   │ MAILBOX_SOURCE: auto (Mongo) or nic (IMAP)  │ browser agent → raw CDP (cdp.js)
   │                                             │ nicBrowserMailbox: stored in MongoDB, once
   ↓                                             ↓
 FRONT_OFFICE_* user's inbox                  NICeMail Front Office user's inbox
   └──────────────────────┬──────────────────────┘
                          ↓  ✓ Accept   (same endpoint, same acceptMessage.js)
      Case + Case ID → MongoDB → AI summary → ACK → forward to OIC → … → final response → CLOSED
```

| | Primary-mailbox case | NICeMail case |
|---|---|---|
| Inbox shown to | the `FRONT_OFFICE_EMAIL` user | the user who signs in as `NIC_EMAIL` |
| Inquirer | the incoming `From` | the incoming `From` |
| Case field `sourceMailbox` | `{ source: 'mongo' / 'in-memory' / 'nic', … }` | `{ source: 'nic-browser', address: NIC_EMAIL }` |
| Acknowledgement / final response | `EMAIL_TRANSPORT` | NICeMail browser session |
| Their retries from the case / Dispatch page | `EMAIL_TRANSPORT` | NICeMail browser session |
| Forward to Officer-in-Charge | `EMAIL_TRANSPORT` | NICeMail browser session |

- **Routing is by mailbox, not sender.** Whatever arrives in the NICeMail mailbox belongs to the
  user whose sign-in address is `NIC_EMAIL`, and that user cannot be pointed at another mailbox.
  Case lists stay shared, as before.
- **The case remembers its mailbox.** `sourceMailbox` is written by the server at accept, from the
  signed-in user's mailbox — never from the request — and `POST /queries/persist` cannot change or
  clear it. All three of a case's emails read it from the stored case, retries included
  (`POST /emails/acknowledgement`, and `POST /emails/response` with its optional `queryId`, which the
  client sends), so a NICeMail case is answered from NICeMail whichever user triggers the send. A
  case with no `sourceMailbox` — older than the field — uses `EMAIL_TRANSPORT`. The rule itself is
  in [backend/README.md, *Which channel a case's mail goes out through*](../backend/README.md#which-channel-a-cases-mail-goes-out-through).
- **Division of work.** The agent only reads mail and hands back plain message data, or types and
  sends one message it is given. Validation, case creation, the Case ID, AI summary, the workflow
  and closure all stay in the QMS, unchanged.
- **No duplicates.** Each NICeMail message is stored under an id derived from its inbox row's `id`:
  Zoho's own message id, the one its route (`#mail/folder/inbox/p/<id>`) and the open message's
  container (`zm_Container_m<id>`) carry, measured live. A row whose id is not such an id is skipped,
  never hashed. The index is unique and the writes insert-only. However often the inbox is polled, a
  message is stored once. A message the Front Office already ingested or removed is never reset or
  brought back while its stored row exists. Accepting it twice reuses the same case, as it does for
  the primary mailbox.
- **When reading happens.** The server asks for a sync every `MAILBOX_SYNC_INTERVAL_MS` (15 s) on its
  own timer whenever Chrome's CDP endpoint answers, so mail arrives with nobody signed in;
  `MAILBOX_SYNC_ENABLED=false` returns to browser-driven ingestion. The Front Officer's inbox poll
  still asks too. Either way a sync starts at most every `NIC_BROWSER_SYNC_TTL_MS`, measured from the
  end of the previous one, and never while browser work is queued — so the interval is a floor and a
  waiting send always goes first. Consecutive failures back the timer off to 2x, 4x then 20x the
  interval and recover on the first success. **Sync now**
  on the IPC Mailbox page (`POST /mailbox/sync`) starts one at once, unless one is running or the
  last ended less than 15 s ago. A new message appears on the poll after the sync that found it. A
  failed sync (Chrome closed, signed out, selectors not matching) is reported in the inbox response's
  `sync` field (*How a sync reads the inbox*, below), and the IPC Mailbox page shows it as **NICeMail
  could not be read — this list may be out of date** (§13). Stored mail still lists and the backend
  stays up.
- **Viewer mode.** On a shared database only one backend, the mailbox host, reads NICeMail; every
  other backend sets `NIC_BROWSER_VIEWER=true`. A viewer still lists the mail the host stored, but
  every sync path returns before touching Chrome — `POST /mailbox/sync` answers `started: false` —
  and the IPC Mailbox page hides **Sync now** and says NICeMail is read by the mailbox host. A
  NICeMail send from a viewer is refused before any browser work, so the email is recorded as failed
  and retried from the host: do real NICeMail accepts on the host. Profiles and rules:
  [README.md, *Shared development database*](../README.md#shared-development-database-mongodb-atlas).
- **In the dashboard.** The IPC Mailbox lists the stored messages with search, an All / Awaiting
  validation filter, pages of 50, a snippet of each body, and an unread dot for a message nobody has
  opened in the QMS. Opening one (`/front-officer/inbox/:messageId`) shows its headers, the body as
  plain text or — when there is HTML — a **Formatted** view inside `<iframe sandbox="">` with a
  `default-src 'none'` CSP, its attachments with a download scoped to the message, and the case it
  became with that case's status. Opening it marks it read **in the QMS only**; NICeMail's own read
  state is never touched.
- **Sending guard.** Browser sends are confined to `NIC_BROWSER_TEST_RECIPIENT` until
  `NIC_ALLOW_OUTBOUND=true`, the same two-key interlock as NIC SMTP; `NIC_ALLOW_INTERNAL_FORWARD=true`
  opens exactly `OFFICER_IN_CHARGE_EMAIL` inside it, for the forward alone. The transport refuses Bcc
  rather than dropping it. A send that fails before Send is pressed — a refused recipient, an uncalibrated
  control, a selector not found — has sent nothing: the ACK stays unsent (✓ again, or the case
  page's retry) or the case stays at `READY_FOR_DISPATCH`, never falsely closed.
- **What is checked before Send** (`composeEmail`, `browser/sendMail.js`). Before a tab is opened:
  there is a recipient, every address is well-formed, and an attachment is only sent through a
  calibrated attach control. In the form, each of these must hold, or the draft is discarded and
  nothing is sent:
  - the From address is `NIC_EMAIL`;
  - the To (and Cc) line holds exactly the intended recipients, read back from its chips — an
    autocomplete that picked someone else, or a leftover chip, stops the send;
  - the subject field holds the subject;
  - the editor holds the body (read back for up to 2 s while the editor lays it out);
  - each attachment is listed with its upload and virus scan finished;
  - **no dialog is open over the form** (below).
- **The survey pop-up, and other dialogs.** Every newly opened NICeMail tab shows, within a second or
  so, a dialog: *Email Satisfaction Survey for the new NICeMail Services. Participate now!*, with the
  buttons **Close** and **Participate now!**. Left open, it sits over the whole compose flow and can
  take the focus while the body is typed (one early acknowledgement lost its body that way). So the
  agent closes it:
  - as soon as the mailbox has loaded (it waits up to 5 s for it), and again just before Send if it
    has reappeared, after which the recipients, subject and body are checked again;
  - with its own **Close** button only (`surveyCloseButton`: a button inside a `role=dialog`, exact
    name "Close", visible and unique), and only when the survey is the one dialog open;
  - **"Participate now!" is never pressed.**

  Any other visible dialog stops the send before Send is pressed: the draft is discarded and the
  error names the dialog. What it asks is unknown, and a click on Send might answer it instead. The
  dialogs are listed once more straight before Send, after the survey is closed. A dialog that holds
  the compose form itself (its To field) is the form, not a pop-up, and does not count. Closing
  the survey in the agent's tab may also dismiss it for the operator's own tab.
- **The follow-up reminder prompt, after Send.** When the body reads like it expects a reply — the
  acknowledgement's "as soon as possible" does — Zoho answers Send with *Add follow-up reminder? You
  can add follow-up reminder, as your message has below text …* and the buttons **Close**,
  **10 minutes**, **Add Reminder and Send** and **Skip and Send**. **The message is held until one is
  pressed**; Close leaves it unsent. This, not the survey, is why every acknowledgement through
  Accept on 2026-09-22 ended *may have been sent* while nothing reached Sent. When that prompt is the
  one dialog open, the agent presses **Skip and Send** (`followUpSkipButton`: exact name, unique,
  inside a dialog) — once — so the message goes as written with no reminder added, and then looks for
  it in Sent as for any send. With any other dialog beside it, nothing is pressed and the send is
  reported unconfirmed, naming both.
- **How a send is confirmed.** Pressing Send is never taken as sending. What proves it is the Sent
  folder:
  1. **The form closing.** The agent watches the Send button it pressed — the locator captured
     before the click — until it is gone. It never looks the button up again: a successful send
     removes it, so a fresh lookup would report the ordinary success as "`sendButton` was not found",
     nothing would be recorded, and the next retry would mail the inquirer again. If the form has not
     closed within `NIC_BROWSER_TIMEOUT_MS`, the agent records what the page shows (dialogs, the
     Send button, notices) and **still looks in Sent**: a form that stayed open does not prove the
     message stayed with it.
  2. **The message is in Sent.** The agent opens the Sent folder and polls it until
     `NIC_BROWSER_TIMEOUT_MS` for a row with the exact subject, the recipient on it, and an id newer
     than the press of Send. Zoho's message ids start with the send time in milliseconds, so an older
     message with the same subject can never confirm this one. The agent then goes back to the Inbox.

  Found in Sent means sent, and the Sent row's id is returned as `providerMessageId` and stored on the
  outbound record. **From the press of Send on, every failure is unconfirmed** — the click itself
  failing, the form not closing, the Sent folder not answering — because each could follow a message
  that did go out. The only exception is a click that found no Send button at all, which dispatched
  nothing. There is
  deliberately no `sentConfirmation` selector: a generic `[role=alert]` / `[role=status]` match is
  satisfied by error alerts and permanent status regions too, so it would record a failed send as
  sent and let final approval close the case on it. One may be added back only with a text match
  proven against the live mailbox by `npm run nic:browser:discover`.
- **Every send is logged, step by step.** One line per stage, from the Accept or retry down to the
  Sent folder, in the backend's console. The tag is `ACK`, `RESPONSE` or `FORWARD`:

  ```text
  ACK START {"caseId":"QRY-…","inquirerEmail":"…","recipients":["…"],"subject":"…","transport":"nic-browser"}
  ACK RESOLUTION {"caseId":"QRY-…","recipient":["…"],"provider":"nic-browser","guard":"test-recipient"}
  ACK NIC BROWSER {"caseId":"QRY-…","step":"outbound_guard","result":"allowed","mode":"test-recipient"}
  ACK NIC BROWSER {"caseId":"QRY-…","step":"compose_started" | "browser_ready" | "survey_closed" | "survey_absent" | "compose_opened" | "from_verified" | "recipient_entered" | "recipients_verified" | "subject_verified" | "body_verified" | "pre_send_clear" | "send_clicked"}
  ACK VERIFICATION {"caseId":"QRY-…","step":"compose_closed" | "compose_not_closed" (with a page snapshot) | "sent_found" (with providerMessageId) | "sent_not_found"}
  ACK RESULT {"caseId":"QRY-…","status":"SENT","ledgerStatus":"SENT","attempts":1,"providerMessageId":"…","stage":null,"error":null}
  ```

  A repeat of a send that already went logs only `START` and `RESULT {"status":"ALREADY_SENT"}`: the
  browser is not touched. A failure before Send logs `NIC BROWSER {"step":"failed", …}` with a page
  snapshot (visible dialogs and their buttons, the Send button's state, notices, the focused element,
  and the body's length, never its text). Addresses and subjects are logged; credentials never are.
- **A failure names its step.** The error carries the step the agent stopped at, what that step ran
  into, and what the page showed, e.g. `… [stage: await_compose_close; cause: Timeout 20000ms …;
  seen: dialog open: "…"; Send button still visible]`. That one line is the outbound record's
  `lastError`, the audit row, and the `error` of the HTTP answer (which also carries `stage`), and the
  case page and the Accept toast show it.
- **Unconfirmed sends.** If Send was pressed and the message has not appeared in Sent within
  `NIC_BROWSER_TIMEOUT_MS` (whether or not the form closed), the send throws with
  `unconfirmed: true`: the message may or may not have left. The dispatch is recorded **`UNCERTAIN`** in `outboundemails`, which is a stored state on the
  case rather than a flag on one response. Accept answers
  `errors: [{ step: 'acknowledgement', outcome: 'UNCERTAIN', unconfirmed: true, … }]` and records no
  acknowledgement; final approval answers the same for `step: 'dispatch'` and keeps the case at
  `READY_FOR_DISPATCH`. Both write an `EMAIL_SEND_FAILED` audit row saying the message may have been
  sent, and the retry endpoints answer **409** — not 504 — for a dispatch that is already
  `UNCERTAIN`, because retrying is exactly what must not happen next. The case page and the Dispatch
  page replace their retry buttons with **It was sent** / **It was not sent — send it**, which
  settle the dispatch through `POST /queries/:queryId/outbound/resolve` and are audited as
  `EMAIL_DELIVERY_CONFIRMED` / `EMAIL_DELIVERY_DENIED`. What to do: §13.
- **No `UNCERTAIN` dispatch settles itself.** The outbox asks the case's channel on every uncertain
  send (`emailService.reconcileDelivery`) and every channel answers `UNKNOWN`: the legacy Gmail
  transport's Sent-folder search was the only implementation of `reconcile` that ever existed. The
  agent looks in Sent once, straight after pressing Send; once a dispatch is `UNCERTAIN` nothing
  looks again, so the human answer is the mechanism, not a fallback.

### How a sync reads the inbox

A sync — `nicBrowserMailbox.sync`, the Mail Ingestion Service — opens one agent tab, reads what the
inbox is showing as data (`inboxView`: the page, the folder, and each loaded row by its message id,
with its unread state, list date, size, sender and subject), decides which rows are new, and opens
each one by its route (`openMessage(id)`), waiting for **that** message's container rather than for
any open pane.

- **Which rows.** The list is newest first, and the deepest row still loaded that is either stored or
  waiting to be tried again (it failed before) is the cut-off: only rows above it that are not stored
  yet are new. They are opened **oldest first**, rows not tried yet before rows that failed before, at
  most `NIC_BROWSER_SYNC_MAX` per sync; the rest are counted in `remaining` and stay above the cut-off
  for the next sync. On the first sync, with nothing stored, the newest `NIC_BROWSER_SYNC_MAX` are
  taken, also oldest first — so a first read cut short leaves what it did not reach above what it
  stored. The backlog below the cut-off — what was already in the mailbox before the first sync — is
  never opened.
- **What is kept.** From, To (the labelled To row, else every recipient on the message), Cc, Bcc
  (shown only on mail this mailbox sent), the subject from the list row, the body as text and as
  HTML (`bodyHtml`, dropped rather than cut when it is over 1,000,000 characters), whether Zoho showed
  it unread before the agent opened it, and `receivedAt` — the message's own timestamp
  (`receivedAtSource: 'message'`) or, when that cannot be parsed, the time it was read (`'sync'`).
  `providerThreadId` stays null until runbook B below.
- **Attachments.** Name, type and the size the message shows are kept whether or not the file can
  be fetched. The type and the shown size are checked against the attachment policy **before** any
  download; a download whose `Content-Length` is over the limit is refused before its body is read;
  a file that could not be saved is kept with `attachmentId: null` and a `materializeError`, which
  the dashboard shows as *Unavailable: <reason>*. One failed attachment never fails its message.
- **Stored as read.** Each message is written as soon as it is read, before the next one is opened —
  insert-only, so a later read never rewrites it.
- **Failures.** A message that cannot be read — including one with no readable sender address
  (`no_sender`, checked before any attachment is downloaded) — is recorded, and the read goes on. It
  is tried again by the next sync, after the rows not tried yet, so it cannot hold up newer mail;
  after 3 failures in this process it is quarantined, and skipped until the backend restarts. Only a
  read that completed counts a failure: a read that stopped may be the page's fault, and must not
  quarantine good mail. The read stops when the first 3 messages opened all fail and one more,
  taken from the other end of the batch, fails too; when every message opened fails; when the
  session is lost; or when storing fails. What was stored before it stopped is kept, and the unread
  restore still runs.
- **Status.** The inbox response's `sync` field is
  `{ ok, at, stored, stage, error, running, failed, failedMessages, quarantined, remaining }`;
  `failedMessages` lists at most five `{ providerMessageId, stage, error }`.
- **Audit.** `SYNC_FAILED` when a run of failed syncs begins (and for every failed manual sync),
  `SYNC_RECOVERED` when it ends, and `SYNC_COMPLETED` — with the stored provider ids and the failed,
  quarantined and remaining counts — only when something was stored or failed, or the sync was
  manual. A manual start writes `SYNC_STARTED` with the person who asked for it. There is no row per
  message and none for a quiet poll.

**No scrolling.** A fresh agent tab loads only the newest ~50 rows, and the agent does not scroll the
list to load more. After a long downtime, mail that arrived beyond that window is never ingested.
Scrolling in a background tab is deferred until it has been proven live.

### Calibrating the selectors

**Reading and composing are calibrated and verified live.** Every element the agent reads — the
folder tree, the list rows and their cells, the open message, the read/unread control — was matched
and counted against the live NICeMail mailbox. Every control it composes with was driven in the
agent's own tab and proven by a real test send (runbook C).
[`backend/src/services/email/nic/browser/selectors.js`](../backend/src/services/email/nic/browser/selectors.js)
records what each one resolved to. Still to do: the attachment keys for reading (no received message
with an attachment has been seen yet), `ccToggle` (hidden while Cc is shown, as it is by default, so
never pressed live) and the thread id.

**The registry.** `selectors.js` is the one place the agent's view of the page is described. A spec
is one of:

- a CSS string, or an array of CSS strings tried in order — the structural keys the reader's page
  code queries directly;
- an `(id) => string` builder, called with a message id (`rowById`, `previewMessageById`, …);
- a literal that is compared or navigated to rather than queried (`folderRoute`, `messageRoute`, …);
- an **element entry**, `element([...strategies], { name, visible, unique })`, for every control the
  agent clicks or types into.

An element entry lists its strategies most semantic first, and they are tried in the order listed:
role and accessible name (`{ role: 'button', name: 'New Mail' }`), `aria-label`, `title`, a stable
attribute (`data-testid`, another `data-*`, `id`), visible text, and CSS last. The first strategy
whose matches pass the entry's checks wins; the checks, each set per entry, are that the element is
visible, carries the expected accessible name, and is the only match. There is no visual or coordinate fallback: the agent's tab is never composited, so there
is nothing to look at. `pageKit.js` resolves entries inside the page, searching open shadow roots and
same-origin iframes and reporting the cross-origin frames it could not search.

**The interlock.** A key in `UNCALIBRATED` is never used: `requireElement` refuses it before the page
is asked anything, and `locate` returns null for its spec. Today that set is `ccToggle`,
`attachmentEntry` and `listRowAttachment` (§13). The checks exist because of what happened before
them: `composeButton` used to name `tpbr-snd-nw-btn`, the hidden toolbar button *Send selected email
conversations in outbox immediately*, and because it existed it counted as found. It is now
`button "New Mail"` (`data-testid="new-btn-opt"`), name-checked, visible and unique. A key leaves
`UNCALIBRATED` only after a live calibration, and the test pinning the set
(`nicBrowserSelectors.test.js`) makes each removal a deliberate change.

The two attachment keys are refused as controls, but the reader's page code queries them directly,
so attachments are looked for with them today — an entry with neither a file name nor a link is
dropped. Runbook A is what makes that reliable.

Each runbook uses the real mailbox; run it only with the go-ahead of whoever owns it.

**Runbook A — attachments.**
1. From the test-inquirer address (`NIC_BROWSER_TEST_RECIPIENT`), mail `NIC_EMAIL` one message with a
   PDF, a JPG and an `.xml` file.
2. The operator opens that message by hand in the dedicated Chrome.
3. Run `npm run nic:browser:discover -- --json`. The document holding the open message reports what
   was extracted from it and a probe of the attachment-like elements in it (tag, classes, attribute
   names, link, text); the JSON report in `NIC_BROWSER_ARTIFACT_DIR` has them in full.
4. Set `attachmentEntry` (and any name, size or link keys it needs) and `listRowAttachment` in
   `selectors.js` from that report — roles and stable attributes, never a build-hashed class — and
   remove both from `UNCALIBRATED`.
5. Verify with `npm run nic:browser:discover -- --agent-tab --json` (in the report the message's row
   has `hasAttachment: true`, and `listRowAttachment` resolves with no warning; the agent's tab has no
   message open, so `attachmentEntry` is checked by re-running step 3 and must resolve there with no
   warning), then with one sync at `NIC_BROWSER_SYNC_MAX=1`: the stored
   message has the PDF and the JPG saved, and the `.xml`, a type the policy refuses, kept as metadata
   with a `materializeError`.

**Runbook B — thread id.**
1. Reply once, by hand, to the runbook-A message — to the test-inquirer address only — so that it
   becomes a conversation.
2. With that conversation's row loaded and one of its messages open, run
   `npm run nic:browser:discover -- --json`.
3. Record the attributes of the row and of the open message's container, and find the one that names
   the conversation rather than the message. The report's registry samples give only each element's
   `id`, `data-testid`, `data-action` and names; read the full attribute list in Chrome DevTools
   (Elements) on the operator's tab, without changing anything. That becomes `providerThreadId`, which the reader sets
   to null today.

**Runbook C — compose.** Done 2026-09-22; repeat it when a Zoho release moves the form (discovery
reports `SELECTORS_DRIFTED` with a compose form open, or a send fails with *was not found*).
1. The operator opens a compose form by hand (**New Mail**) and types nothing into it.
2. Run `npm run nic:browser:discover -- --json`. The registry section shows how each compose key
   resolves on the live form; the accessibility tree and the interactive inventory list the form's
   fields and buttons by role, name and test id. Set the entries from it — role and accessible name
   first, with the `name`, `visible` and `unique` checks — and close the form by hand without
   sending.
3. Run `npm run nic:browser:calibrate -- --attach`. In the agent's own background tab it opens a
   form, checks From, types `NIC_BROWSER_TEST_RECIPIENT` into To by each candidate method and
   records which one makes a recipient chip, writes a marker subject and body, attaches a small
   generated PDF through the file chooser, then presses **Discard Draft** and checks that no draft
   was left. It **never presses Send**. The report (addresses masked) is written to
   `NIC_BROWSER_ARTIFACT_DIR`.
4. With `NIC_ALLOW_OUTBOUND=false`, send one message to `NIC_BROWSER_TEST_RECIPIENT` through the
   transport, with a subject such as `IPC-QMS calibration test <time>`. It must return a
   `providerMessageId`, and the message in **Sent**, opened by hand, must show exactly that recipient,
   the subject and the body.
5. Only keys proven by steps 3 and 4 leave `UNCALIBRATED`. Re-run step 2 with a form open: the
   diagnosis must read `Compose form open: all 8 of its controls resolve.`

What was verified on the live form (2026-09-22). Compose opens as an app tab (hash `#compose`, panel
`#jstab-Cmp<N>`) in the same document as the inbox, with no shadow DOM:

| Key | Element | Strategies, most semantic first |
|---|---|---|
| `composeButton` | `<button data-testid="new-btn-opt">New Mail</button>` | `button "New Mail"`, testid `new-btn-opt` |
| `fromAddress` | `button[data-testid=com_cur_from_address]`, named `From <address>` | testid `com_cur_from_address`, name prefix `From` |
| `toInput` | `input` role `combobox`, `To Recipients`, testid `com_To_field` | `combobox "To Recipients"`, testid |
| `ccInput` | the same, `CC Recipients`, `com_Cc_field`; shown by default | `combobox "CC Recipients"`, testid |
| `ccToggle` | `role=button` `Add Cc recipients`, hidden while Cc is shown | `button "Add Cc recipients"` (still `UNCALIBRATED`) |
| `subjectInput` | `input` placeholder `Subject` in `[data-testid=com_subject_field]`; its `id` is React-generated and not used | `textbox "Subject"`, CSS in the testid |
| `bodyEditor` | `<body class="ze_body" contenteditable="true" aria-label="Rich text editor area">` in a same-origin iframe | `textbox "Rich text editor area"`, CSS |
| `fileInput` | there is no `<input type=file>`: `button "Attach from my computer"` opens a file chooser | `button "Attach from my computer"` |
| `sendButton` | `button[data-testid=com_send]` `Send`, beside `Send Later` (`com_send_later`), which the exact name excludes | `button "Send"`, testid `com_send` |
| `discardButton` | `button "Discard Draft"`, testid `com_DiscardDraft_Icon`; closes the form with no confirmation | `button "Discard Draft"`, testid |
| `recipientChip` | `div[role=option].zmCB` with `aria-label=<address>`, in the input's `.zmCRow` | CSS |
| `composeAttachmentRow` | `[role=row][aria-label=<file name>]` under `.zmCRAtt` | CSS |
| `sentFolderRoute` / `folderSent` | `#mail/folder/sent`; `treeitem "Sent"` | literal; `treeitem "Sent"` |

How each step is done, as the calibration proved it:
- **Recipients:** the address goes in through the input's native value setter with an `input`
  event, then Enter is dispatched; the form turns it into a chip within moments.
- **Subject:** the same native setter with `input` and `change` events (`fillIn`). A plain
  `.value =` is taken by React as its own write and the field would be sent empty.
- **Body:** the editor's body is focused and the text inserted with CDP `Input.insertText`, so line
  breaks become the editor's own paragraphs and nothing in the text is read as markup.
- **Attachments:** `Page.setInterceptFileChooserDialog`, click **Attach from my computer**, and on
  `Page.fileChooserOpened` hand the staged files to `DOM.setFileInputFiles`. Upload and virus scan
  took about 3 s for a small PDF.
- **Discard:** one click and the form closes, once any upload has finished scanning.

The live test send (2026-09-22) went through `nicBrowserTransport.send()` with
`NIC_ALLOW_OUTBOUND=false`. It returned the Sent row's id in 4.7 s. Opened in Sent, the message showed
From `NIC_EMAIL`, To the test recipient alone, no Cc or Bcc, and the body exactly as sent.

Every new agent tab also shows an *Email Satisfaction Survey* dialog (**Close** /
**Participate now!**). The agent closes it with **Close** before composing, and never presses
**Participate now!**. See *The survey pop-up, and other dialogs* above.

An element that matches nothing fails loudly, in the inbox `sync` status or, for a send, before Send
is pressed: `NICeMail UI element "<key>" was not found. Recalibrate browser/selectors.js.` An
element entry that matches the wrong thing — hidden, wrongly named, one of several — does not resolve
at all, which is what its checks are for. A plain CSS key has no such checks: a structural read
selector that matched the wrong element would read there, and `nic:browser:discover` is how that is
ruled out.

### Configuration

In `backend/.env.local` on the mailbox host:

```env
NIC_BROWSER_MAILBOX=true
NIC_EMAIL=contact.ecoclubs-edu@gov.in       # the mailbox, and the second Front Office's sign-in
NIC_FRONT_OFFICE_NAME=Eco-Clubs Front Office
NIC_BROWSER_TEST_RECIPIENT=<your test inquirer address>
NIC_ALLOW_OUTBOUND=false                    # true only when real inquirers may be answered
NIC_ALLOW_INTERNAL_FORWARD=false            # true also allows the forward to OFFICER_IN_CHARGE_EMAIL
```

`NIC_EMAIL` must differ from `FRONT_OFFICE_EMAIL` (the backend refuses to start otherwise), and
MongoDB must be running. Moving to the IPC mailbox is `NIC_EMAIL=lab.ipc@gov.in` plus signing in to
that account in the dedicated Chrome — see §15 for what else follows `NIC_EMAIL`. In production the
backend also needs `EMAIL_TRANSPORT=nic`, and with it `NIC_IMAP_HOST` and `NIC_SMTP_HOST` set, though
it never connects to them for NICeMail cases; the production values are in
[ENVIRONMENT.md](ENVIRONMENT.md).

### Testing both paths

**Test 1 — the primary mailbox.** From an external address, mail `FRONT_OFFICE_EMAIL`. Sign in as
the `FRONT_OFFICE_EMAIL` user. The mail is in their inbox and **not** in the NICeMail Front Office's.
Accept → case, AI summary, ACK through `EMAIL_TRANSPORT`, forward to OIC → continue the workflow to
closure. The final response goes out the same way.

**Test 2 — NICeMail.** Keep `NIC_ALLOW_OUTBOUND=false` for this test, so the acknowledgement can
only go to the test inquirer. A backend started before compose was calibrated still refuses the
acknowledgement with the *never been calibrated* error (§13); restart it.
1. Close Brave or any other program on port 9222. Start the dedicated Chrome and sign in to NICeMail.
2. From the test inquirer address (`NIC_BROWSER_TEST_RECIPIENT`), mail `NIC_EMAIL`.
3. Sign in to IPC-QMS as `NIC_EMAIL` with that account's own credential (dev login refuses it). Within
   about a minute the message appears, or shortly after **Sync now**. Reloading repeatedly shows it
   once. If the page shows **The mailbox could not be read**, fix what its stage names (§13) before going
   on.
4. Accept → one case with `sourceMailbox.source = 'nic-browser'`. The ACK appears in NICeMail's
   **Sent** folder, addressed to the inquirer, and its `outboundemails` record is `SENT` with that
   Sent row's id as `providerMessageId`. Accepting again sends nothing. The forward to the OIC goes
   out through the same NICeMail session, so with `NIC_ALLOW_OUTBOUND=false` it needs
   `NIC_ALLOW_INTERNAL_FORWARD=true`.
5. Continue the workflow to final approval. The final response is sent from NICeMail and the case
   closes.
6. The mail never appears in the primary mailbox.

If a toast, banner or notification says a send **may already have been sent**, the send is
unconfirmed: check NICeMail's **Sent** folder before any retry (§13). A blind retry of a message that
did go out reaches the inquirer twice.

### Known limitations — open

None of these is fixed. Each is a way the NICeMail mailbox can go wrong in operation.

**Depend on calibration** — until the runbooks above are done:

- **Attachments are uncalibrated for reading.** No received message with an attachment has been
  seen live, so an attachment may be missed until runbook A is done. (Sending attachments is
  calibrated.)
- **Threads are not recorded.** `providerThreadId` is stored as null until runbook B.
- **Cc behind a hidden Cc line is refused.** `ccToggle` has never been pressed live. The Cc line is
  shown by default, so this only matters if Zoho starts hiding it.
- **Reading does not check the signed-in account against `NIC_EMAIL`.** Whatever account the Chrome
  tab is signed in to is read from. Sending does check it: the compose form's From must be
  `NIC_EMAIL`. `nic:browser:discover` shows the account, masked, in the tab title.

**Ingestion:**

- **Only the loaded rows are seen.** A fresh agent tab loads the newest ~50 rows and nothing scrolls,
  so after a long downtime mail beyond that window is never ingested (*How a sync reads the inbox*).
- **Quarantine is per process.** A message that failed 3 times is skipped until the backend
  restarts; after a restart it is tried again if it is still above the cut-off.
- A failed attachment download is stored with a null `attachmentId`, and the fail-closed forward
  refuses it — permanently, for that message.

**Isolation and state:**

- **Mailbox isolation covers the mailbox routes, not accept or decisions.** The NICeMail Front
  Office's requests are pinned to its mailbox, and the primary mailbox's MongoDB store no longer
  lists, marks, deletes or clears NICeMail rows, whatever `?recipient=` says. But in any mode the
  `SUPER_ADMIN` can accept a NICeMail message by its id: the primary
  mailbox's accept takes the message from the request body and records a non-NICeMail
  `sourceMailbox`, so that case is answered through `EMAIL_TRANSPORT`.
  `POST /mailbox/messages/:id/decision` and `GET /mailbox/decisions` are not scoped to a mailbox at
  all.
- **The "already handled" memory is the MongoDB row.** A removed message is hidden, not deleted, and
  that row is all that stops the next sync storing it again. `npm run db:reset` removes it, and the
  next sync that reaches the message stores it again — as a new, undecided message, since the reset
  also clears the decisions.
- **Two concurrent accepts can acknowledge twice.** Both can pass the "already acknowledged?" check
  before either records one — the browser queue makes that window long — and both send.
- **Any role party to a case can edit its inquirer and response text** through `/queries/persist`.
  `authorizeCaseDelta` bounds *which* cases a principal reaches, not what it may write inside one.
  Pre-existing, but for a NICeMail case it decides what the official mailbox sends (§14).
- **An unconfirmed send is a standing human work item.** Nothing settles it: the dispatch sits
  `UNCERTAIN` in `outboundemails` until somebody looks in the Sent folder and answers through
  `POST /queries/:queryId/outbound/resolve`, and nothing escalates it on its own (§13).
