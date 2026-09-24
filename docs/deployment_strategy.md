# IPC-QMS — Deployment Strategy and Production-Readiness Audit

**System:** IPC Query Management System (IPC-QMS), including the NICeMail Browser Agent
**Scope:** Technical audit of the repository, and a production deployment strategy
**Code audited:** branch `abhi-agent`, commit `438997e` (2026-09-22)
**Revised:** 2026-09-23, against branch `abhi-clean` (commit `7e22bbb`), after the Gmail removal this report called for
**Method:** Read-only review of the source code, configuration templates, tests and documentation, plus the automated test suites and one controlled live end-to-end test run on 2026-09-22. No application code, configuration or environment file was changed for the original report.

---

## How to read this report

Every finding carries one of these tags:

| Tag | Meaning |
|---|---|
| **[Verified]** | Confirmed by reading the source code or configuration in the repository, or by running its test suites. |
| **[Live-tested]** | Observed during the controlled end-to-end test with the NICeMail test account on 2026-09-22. |
| **[Documented only]** | Stated in the project documentation but not provable from the code. |
| **[Unknown]** | Cannot be determined from the repository. It must be confirmed. |
| **[Recommendation]** | The auditor's proposal. It is not a statement about the current system. |
| **[Assumption]** | A working assumption used where no figure or decision exists. It must be confirmed or measured. |

A tag may carry a short qualifier in brackets (for example "[Live-tested, 2026-09-22, test account]").

File references (for example `backend/src/services/ai/gemmaService.js:170`) point to the evidence. Management readers can skip them. They are there so technical staff can check each claim.

### What changed since the 2026-09-22 audit

This report was written when Gmail was still the configured transport. Everything it says about
hardware, topology, NIC coordination and monitoring stands unchanged. What moved is the mail path, and
the sections below have been revised rather than re-dated: a claim revised on 2026-09-23 is marked
**[Verified, 2026-09-23]**.

| Original finding | Now | Where |
|---|---|---|
| The OIC forward always uses `EMAIL_TRANSPORT`, never the Browser Agent | **Superseded.** All three case emails follow the case's `sourceMailbox` | §2.1, §17 |
| "Gmail cannot be removed yet" — the report's single Critical risk | **Resolved.** Gmail is removed from code, dependencies and configuration | Short answer, §9.5, §17 |
| Gmail can reconcile an uncertain send against its Sent folder | **Superseded.** No channel can. Every `UNCERTAIN` send is now a human work item | §9.4, §9.5 |
| Case-level authorization is not implemented | **Superseded.** It is, on the workflow-sync route and on every attachment | §13, Appendix B |
| All accounts share `QMS_SEED_PASSWORD` outside production | **Narrowed.** Per-account credentials exist; the shared mode is an explicit opt-in that still defaults ON outside production when `QMS_SEED_PASSWORD` is set | §2.2 item 8, §13 item 5 |
| Three development accounts sign in with personal Gmail addresses | **Resolved.** Every seeded address is on the unroutable `@ipc.example` | §13 item 5, §16 Phase 0 |
| `POST /mailbox/receive` and `DELETE /mailbox` have no production guard | **Resolved** for those two (409 in production). `POST /queries/reset` still has none | §13 item 13 |
| An INQUIRER role signs in to raise enquiries in-app | **Superseded.** The role, the dashboard and the portal are removed; an inquirer is external and never signs in. §3 always described it correctly | §13 item 14, §16 Phase 0, §17.1 |

What this report asked for that is **still outstanding** is unchanged and listed in Section 19 item 7
and Appendix B.

---

**The short answer** (details in Sections 10 and 19):

> **IPC-QMS, including the NICeMail Browser Agent, runs on ordinary CPU servers. No component needs a GPU — as long as the AI stays with the external Pravah service.** All three AI features (case summary, officer recommendation, draft response) call an **external AI service over HTTPS**: the Pravah Gemma endpoint. No AI model runs inside IPC-QMS. The enquiry text therefore leaves IPC's network, and the production server needs outbound HTTPS and DNS to `pravahai.aicte-india.org`.
>
> The real constraint is not hardware. **The Browser Agent drives a real Chrome browser that a person must sign in to NICeMail** (with MFA/OTP if NIC requires it for this account [Unknown]), and sign in again whenever the session expires. So that server needs an interactive desktop session and an operator. It cannot run as an unattended background service **in the current implementation**.
>
> **Gmail has been removed** [Verified, 2026-09-23]. The original report's blocker — that the forward to the Officer-in-Charge could not go through the Browser Agent — was resolved by taking option (a) of Section 17.2: the forward now follows the case's own mailbox like the other two emails. Gmail's transport, inbox reader, OAuth configuration, `googleapis` dependency and pre-flight script are gone from the codebase. What that leaves is a **single-channel** design, and its consequences are the new top risks in Section 9.5 — most immediately that the forward is the one case email carrying attachments, through an attach control that is still uncalibrated.

---

## Table of contents

1. [Primary objective and answer](#1-primary-objective-and-answer)
2. [Production direction: NICeMail replaces Gmail; account change to lab.ipc@gov.in](#2-production-direction)
3. [Workflow step 1–2: Inquirer and NICeMail mailbox ingestion](#3-inquirer-and-nicemail-mailbox-ingestion)
4. [Front Officer workflow (Accept)](#4-front-officer-workflow)
5. [OIC workflow (AI recommendation and assignment)](#5-oic-workflow)
6. [Assigned Officer workflow (AI draft)](#6-assigned-officer-workflow)
7. [Reviewer workflow (approve / request changes)](#7-reviewer-workflow)
8. [OIC final approval and NICeMail dispatch](#8-oic-final-approval-and-dispatch)
9. [NICeMail Browser Agent — production audit](#9-nicemail-browser-agent--production-audit)
10. [CPU vs GPU assessment](#10-cpu-vs-gpu-assessment)
11. [Production server architecture](#11-production-server-architecture)
12. [NICeMail authentication strategy](#12-nicemail-authentication-strategy)
13. [Security audit](#13-security-audit)
14. [Scalability](#14-scalability)
15. [Monitoring and operations](#15-monitoring-and-operations)
16. [Phased deployment strategy](#16-phased-deployment-strategy)
17. [Gmail removal — completed](#17-gmail-removal--completed)
18. [Production readiness checklist](#18-production-readiness-checklist)
19. [Management summary](#19-management-summary)
20. [Appendix A — Evidence index](#appendix-a--evidence-index) · [Appendix B — Documentation that disagreed with the code](#appendix-b--documentation-that-disagreed-with-the-code)

---

## 1. Primary objective and answer

**Question:** Can the complete IPC-QMS, including the NICeMail Browser Agent, be deployed on CPU-based servers, or are GPU servers required?

**Answer: CPU servers are sufficient. No GPU is required by any part of IPC-QMS, as long as the AI model stays with the external Pravah service.** [Verified] (an on-premise model would need its own GPU server — see the qualifications below and Section 19, item 8)

| What was checked | Finding |
|---|---|
| Where AI inference happens | Every AI feature (summary, officer recommendation, draft, and the question split used by the draft) is an HTTPS `POST` to one external endpoint, `GEMMA_API_URL`. It defaults to `https://pravahai.aicte-india.org/llm/api/gemma`. No model is loaded or run inside IPC-QMS. [Verified] (`backend/src/services/ai/gemmaService.js:170, 315, 440`; `backend/src/config/env.js:47-48`) |
| Local ML, CUDA, ONNX, TensorFlow, PyTorch, embeddings, vector DB, OCR | None in either `package.json` or either lockfile, and none in the source code. [Verified] (dependency and source scan of `backend/` and `frontend/`) |
| The "knowledge grounding" used by the AI draft | Plain JavaScript word matching over a 0.46 MB JSON index shipped in the repository (412 text chunks). No embeddings, no vectors, no native code. [Verified] (`backend/src/data/ipcKnowledge.js`, `backend/src/data/ipcKnowledge.json`) |
| PDF / document / image processing | Attachments are only type-checked, size-checked, checksummed and stored. They are never parsed, OCR'd or sent to the AI. [Verified] (`backend/src/services/attachments/attachmentPolicy.js`, `attachmentStore.js`) |
| Background workers | Two in-process timers, both `unref`'d, started in `server.js` and stopped first on shutdown, both silent under `NODE_ENV=test`: the **mailbox sync** every `MAILBOX_SYNC_INTERVAL_MS` (15 s, off when `MAILBOX_SYNC_ENABLED=false`) and the **junk-retention sweep** hourly (off when `MAILBOX_RETENTION_ENABLED=false`). `services/email/mailbox/syncScheduler.js`, `retention.js`. No job queue, cron, `worker_threads` or `child_process`. [Verified, 2026-09-24] |
| The Browser Agent | Uses a normal Chrome browser through the Chrome DevTools Protocol (CDP). IPC-QMS asks Chrome for nothing graphical: it drives the page with DOM events from page scripts, plus CDP text and key input (`Input.insertText`, `Input.dispatchKeyEvent`), tab control (`Target.createTarget`, `Page.navigate`) and file-chooser interception for attachments (`DOM.setFileInputFiles`). No screenshots, WebGL or GPU flags. [Verified] (`backend/src/services/email/nic/browser/selectors.js:368-408, 494-501`; `sendMail.js:430, 440-462`; `session.js:58-64`). Note the limit of this evidence: IPC-QMS never launches Chrome, so how Chrome itself renders (GPU compositing, or software rendering on a GPU-less VM) is set by the operator's launch, and its CPU cost was not measured — see the qualification below. |

**Three important qualifications:**

1. **The AI model itself runs on external infrastructure (Pravah).** That infrastructure almost certainly uses GPUs, but it is outside this project. [Unknown] The project documentation lists "external API vs on-premise model" as an open client question (`docs/srs/14-open-questions-and-client-clarifications.md`, `docs/srs/07-ai-requirements.md`). [Documented only] **If IPC requires an on-premise model instead of Pravah, a separate GPU-equipped model server would be needed.** IPC-QMS itself would still not need a GPU.
2. **The Browser Agent is CPU-only but not "server-style".** It attaches to an **already running, signed-in Chrome**, which should run on the **same machine** as the backend (Section 9.2), and a person must perform the NICeMail sign-in in that browser (including MFA/OTP if required [Unknown]). This is an operational constraint, covered in Sections 9, 11 and 12. It is not a hardware constraint.
3. **"No GPU" is a statement about what IPC-QMS asks for, not a measurement of Chrome's cost.** On a virtual machine without a GPU, Chrome renders in software. That is normal and supported, but its CPU and memory cost on the target VM was **not measured** in this audit. [Unknown] Make it a Phase 7 acceptance criterion: measure Chrome's CPU and memory while the NICeMail web app is loaded, and size the VM from that (Section 11.4).

---

<a id="2-production-direction"></a>
## 2. Production direction: NICeMail has replaced Gmail; account change to lab.ipc@gov.in

### 2.1 How mail flows today [Verified]

The system has **two** Front Office mailboxes:

| Mailbox | Used for | Selected by |
|---|---|---|
| **Primary mailbox** | the original Front Office inbox | `MAILBOX_SOURCE` = `nic` (IMAP) / `auto` (default: MongoDB if connected, otherwise in memory). `gmail` is no longer an accepted value and is refused at boot [Verified, 2026-09-23] — `backend/src/config/env.js`; `services/email/mailbox/index.js` |
| **NICeMail Browser Agent mailbox** | a *second* Front Office inbox, read through the browser | `NIC_BROWSER_MAILBOX=true`; the address is `NIC_EMAIL` — `backend/src/config/browserConfig.js:90-100` |

And three kinds of outbound email per case:

| Email | Recipient | Transport used |
|---|---|---|
| Acknowledgement | the inquirer | **Browser Agent**, if the case came from the NICeMail mailbox; otherwise `EMAIL_TRANSPORT` |
| Forward to Officer-in-Charge (OIC) | the configured OIC address | **Browser Agent**, if the case came from the NICeMail mailbox; otherwise `EMAIL_TRANSPORT`. Revised 2026-09-23 — it used to be `EMAIL_TRANSPORT` unconditionally |
| Final response | the inquirer | **Browser Agent**, if the case came from the NICeMail mailbox; otherwise `EMAIL_TRANSPORT` |

Evidence: `backend/src/services/email/emailService.js` (`isNicBrowser` / `transportFor`); `backend/src/services/email/caseMail.js` (the ledger and trace labels). `EMAIL_TRANSPORT` now accepts only `nic` and `mock`. The rule is documented normatively in [`backend/README.md`](../backend/README.md#which-channel-a-cases-mail-goes-out-through).

**Consequence for the production plan** [Verified, 2026-09-23]: "all production email through the NICeMail Browser Agent" **is** now what the code does, for every case that arrived in that mailbox — all three emails, the forward included. `EMAIL_TRANSPORT` governs only cases that did not, and there is no longer a portal through which a case can be raised at all.

That makes it a **single-channel** design for NICeMail cases, which is what Section 17.2 warned about when it recommended the SMTP route first. The two consequences are now live and are ranked in Section 9.5: one session outage stops all three emails together, and the forward — the only case email that carries attachments — depends on the agent's attach path.

### 2.2 Changing the NICeMail account (test account → lab.ipc@gov.in)

The Browser Agent is currently exercised with a test account (`contact.ecoclubs-edu@gov.in`). The address is **configuration, not code**. Production will use **`lab.ipc@gov.in`**. Everything that depends on the account:

| # | Item | What it controls | Action for production | Evidence |
|---|---|---|---|---|
| 1 | `NIC_EMAIL` | The mailbox address. The sign-in email of the NICeMail Front Office user (`USR-0014`). The **expected "From" address** checked before every send. The address stored messages are filed under. | Set to `lab.ipc@gov.in` | `browserConfig.js:50-52`; `constants/users.js:19-28`; `nic/browser/sendMail.js:358-368`; `mailbox/nicBrowserMailbox.js:68` |
| 2 | Boot rule | `NIC_EMAIL` must differ from `FRONT_OFFICE_EMAIL` or the backend refuses to start | Set `FRONT_OFFICE_EMAIL` to a real address that is not `lab.ipc@gov.in` and never mails that inbox (it is on the triage loop list). The production values are in [docs/ENVIRONMENT.md](ENVIRONMENT.md) | `config/env.js:114-120`; `mailbox/triageRules.js:38-47` |
| 3 | Chrome sign-in | Reads use whatever account the Chrome window is signed into: sync has **no account check** and files what it reads under the current `NIC_EMAIL`. Sends are refused unless the compose From contains `NIC_EMAIL`. If `NIC_EMAIL` and the Chrome sign-in are switched at different times, one account's mail is filed under the other address. | Sign in to `lab.ipc@gov.in` in the dedicated Chrome profile (MFA/OTP if NIC requires it [Unknown]). **Switch `NIC_EMAIL` and the Chrome sign-in together, with the backend stopped.** | `nic/browser/attach.js:4-15`; `session.js:43-75`; `sendMail.js:358-368`; `nicBrowserMailbox.js:68, 145` |
| 4 | `NIC_ALLOW_OUTBOUND` | Outbound safety interlock. Until it is `true`, NICeMail sends only go to the test recipient. `NIC_ALLOW_INTERNAL_FORWARD=true` additionally opens exactly `OFFICER_IN_CHARGE_EMAIL`, for the forward alone — a recipient allowance, not a second channel [Verified, 2026-09-23] | Set `NIC_ALLOW_OUTBOUND=true` **only** at go-live, deliberately. Build the production configuration (`backend/.env.production`) from [docs/ENVIRONMENT.md](ENVIRONMENT.md), never from a development `.env.local`. Start with `NIC_ALLOW_OUTBOUND=false`, and use `NIC_ALLOW_INTERNAL_FORWARD=true` so intake completes end to end while it is closed. | `nic/outboundGuard.js`; `config/env.js` |
| 5 | `NIC_BROWSER_TEST_RECIPIENT` | The only allowed recipient while the interlock is closed; also used by the calibration tool. If unset, it falls back to `NIC_TEST_RECIPIENT`. One of the two is **required at boot** while the agent is on and `NIC_ALLOW_OUTBOUND` is not `true`; only the standalone scripts still fall back to `NIC_EMAIL`. | Set explicitly to an IPC-controlled test inbox | `browserConfig.js:25-32`; `config/env.js:121-127` |
| 6 | `NIC_FRONT_OFFICE_NAME` | Display name inside IPC-QMS only. The name recipients see comes from the NICeMail account profile. | Set an IPC name; check the NICeMail profile display name | `emailService.js:75-78`; `transports/nicBrowserTransport.js` |
| 7 | `NIC_WEBMAIL_APP_URL`, `NIC_WEBMAIL_URL_PATTERNS`, `NIC_WEBMAIL_TITLE_PATTERNS` | Which web address the agent opens, and which browser tab it recognises as NICeMail | Confirm `lab.ipc@gov.in` is on the same NICeMail (Zoho / mgovcloud) platform and URLs [Unknown] | `browserConfig.js:6-23` |
| 8 | Password for `USR-0014` | The boot check runs in every mode, but **outside production an unset `QMS_ALLOW_SHARED_PASSWORD` still switches the shared mode ON whenever `QMS_SEED_PASSWORD` is non-empty** — so a successful start in development or staging proves nothing about the production credential set. In production each of the 13 accounts, plus the NICeMail Front Office, needs its own credential. The `USR-0014` id itself comes from the hard-coded directory and changes when that directory is replaced. | Set `QMS_PASSWORD_USR_0014` (or add it to `QMS_PASSWORDS_FILE`), set `QMS_ALLOW_SHARED_PASSWORD=false` explicitly rather than leaving it unset, and test the production credential set with `NODE_ENV=production` | `config/authConfig.js`; `services/auth/credentials.js:73-78`; `constants/users.js` |
| 9 | UI calibration | Selectors were calibrated against the test account's NICeMail interface | Run `npm run nic:browser:discover` and `npm run nic:browser:calibrate` after signing in to `lab.ipc@gov.in` | `scripts/nicBrowserDiscover.js`, `scripts/nicBrowserCalibrate.js` |

**Side effects of the switch** [Verified]. These must be planned and communicated:

- **Messages stored under the old address stop appearing** in the Front Office inbox. The list is filtered by the current `NIC_EMAIL`. They are hidden, not deleted (`nicBrowserMailbox.js:254`).
- **Mail already in lab.ipc@gov.in's inbox will appear in the Front Office inbox.** If the database already holds messages from the test account, none of their ids occur in the new inbox, so every row the new inbox loads (about 50 per the documentation [Documented only]; the code says "the newest few dozen") is stored as a **pending Front Office inbox message**, 20 per sync. With an empty database, only the newest 20 are stored and older mail is skipped without notice. These are un-accepted inbox items, not cases; no case exists until the Front Office accepts one (`nic/browser/readInbox.js:616-648`; `nicBrowserMailbox.js:87, 152-153`). **Recommendation:** have the Front Office review and reject the unwanted ones.
- **Existing cases keep the old address in their `sourceMailbox` record.** Their later mail is actually sent from `lab.ipc@gov.in` (the compose From is checked against the current `NIC_EMAIL`, `sendMail.js:358-368`), but IPC-QMS records it as sent from the old address (`emailService.js:75-78`).
- **Active sessions of the NICeMail Front Office user** issued before the switch are routed to the wrong mailbox until they expire (`SESSION_TTL_SECONDS`, 8 hours by default). Sessions are stateless tokens and a restart does not end them: have that user log out, or rotate `JWT_SECRET` (which signs everyone out) (`services/auth/tokenService.js:5-21`, `mailbox/index.js:165-166`).
- The IPC knowledge corpus quotes `lab.ipc@gov.in` as guidance text. That is content, not configuration, and must **not** be changed as part of the switch (`backend/README.md:716-720`).

---

## Workflow overview (Sections 3–8)

```text
Inquirer (any email account, e.g. Gmail)
   │  sends query to the NICeMail mailbox (production: lab.ipc@gov.in)
   ▼
NICeMail (Zoho/mgovcloud, run by NIC)
   │  Browser Agent reads the inbox through a signed-in Chrome (CDP, localhost:9222)
   ▼
IPC-QMS backend (Node.js) ──► MongoDB (MailboxMessage)
   │
   ▼
Front Officer ✓ Accept ──► Case + Case ID ──► AI summary (Pravah API)
   │                     ├─► Acknowledgement to inquirer  (Browser Agent → NICeMail → Sent-folder check)
   │                     └─► Forward to OIC               (Browser Agent for NICeMail cases, otherwise EMAIL_TRANSPORT)
   ▼
OIC ──► AI officer recommendation (Pravah API) ──► assigns Assigned Officer
   ▼
Assigned Officer ──► AI draft (Pravah API + local knowledge index) ──► edits ──► selects reviewer(s) ──► submits
   ▼
Reviewer ──► Approve ─────────────────────────────┐
   │        └─► Request changes ──► back to Officer (loop, no limit)
   ▼                                              │
OIC Final Approval ◄──────────────────────────────┘
   │        └─► Return for revision / Reject ──► back to Officer (review restarts)
   ▼
Final response ──► Browser Agent ──► compose → verify From / recipient / subject / body → Send
                                     → Sent-folder verification → provider message id → ledger SENT → case CLOSED
```

### Step table — who, what, and what each step needs

MongoDB is required by **every** step. If it is down, the retry endpoints in rows 2b, 2c and 6r do not fail: they switch to an older path that sends through `EMAIL_TRANSPORT` with no outbound ledger and no at-most-once guarantee, taking the subject, body and attachments (and, for the response, the recipient) from the request — the acknowledgement path takes only the recipient, `queryId` and timestamp (`controllers/emailController.js:131-200`). **Block them or make them fail closed before production.** "Server" means the server decides and enforces the step. "Client" means the browser decides, and the server checks only the role and the case scope.

| # | Step | API endpoint(s) | Role | External AI | Browser Agent | `EMAIL_TRANSPORT` (non-agent cases) | Authority |
|---|---|---|---|---|---|---|---|
| 1 | NICeMail inbox sync | `GET /mailbox/messages` (triggers background sync), `POST /mailbox/sync` | NICeMail Front Officer | – | **Yes (read)** | – | Triggered by the client; stored by the server |
| 2a | Accept: case, Case ID, summary | `POST /mailbox/messages/:id/accept` | Front Office | Optional (fallback if down) | – | – | Server |
| 2b | Acknowledgement | inside Accept; retry `POST /emails/acknowledgement` | Front Office | – | **Yes** (NICeMail cases) | Yes (other cases) | Server |
| 2c | Forward to OIC | inside Accept; retry `POST /emails/forward` | Front Office | the stored summary (a timed-out summary is stored as `FALLBACK` and is still used); a second Pravah call only when the case holds no usable summary | **Yes** (NICeMail cases) | Yes (other cases) | Server |
| 3 | Assignment | `POST /ai/recommend`, `POST /queries/persist` | OIC | Optional | – | – | Client |
| 4 | Draft, reviewers, submit | `POST /ai/draft`, `POST /queries/persist` | Assigned Officer | Optional | – | – | Client |
| 5 | Review loop | `POST /queries/persist` | Reviewer | – | – | – | Client |
| 5r | OIC return for revision / reject | `POST /queries/persist` | OIC | – | – | – | Client |
| 6 | Final approval and dispatch | `POST /queries/:id/final-approval` | OIC (or Super Admin) | – | **Yes** (NICeMail cases) | Yes (other cases) | Server |
| 6r | Retry, or resolve an uncertain send | `POST /emails/response`, `POST /queries/:id/outbound/resolve` | Front Office / Super Admin | – | Yes (retry) | Yes (other cases) | Server |

Evidence: `backend/src/routes/mailboxRoutes.js`, `routes/queryRoutes.js`, `routes/emailRoutes.js`, `routes/aiRoutes.js`; `services/email/mailbox/acceptMessage.js`; `services/workflow/finalApproval.js`; `services/email/emailService.js:237-265`; `frontend/src/store/useWorkflowStore.js:1236-1296`; `frontend/src/pages/approvals/ApprovalDetailPage.jsx:38-44`.

On the summary in row 2c: `generateSummary` does not throw for a timeout, an unreachable model or a non-2xx reply — those are stored as `FALLBACK`, which the forward treats as usable (`acceptMessage.js:124-148`; `caseMail.js:133, 195`). Only a summary stored as `FAILED` makes the forward call Pravah again (`emailService.js:237-265`). So **intake** sends the enquiry text to Pravah once: the forward does not make a second call. Later steps send case text again — the officer recommendation (Section 5) and the draft, which makes two calls (Section 6).

Under `EMAIL_TRANSPORT=mock` (the default when the variable is unset, `config/env.js:43`), the forward is recorded as sent and the case moves to `PENDING_ASSIGNMENT` although no email went out; the OIC then relies only on the in-app notification (`caseMail.js:78-87`).

---

<a id="3-inquirer-and-nicemail-mailbox-ingestion"></a>
## 3. Inquirer and NICeMail mailbox ingestion

**What happens** [Verified]
1. The inquirer emails the NICeMail mailbox. For the production mailbox (`lab.ipc@gov.in`), no inquirer-side setup is needed.
2. Ingestion is **triggered by the browser, not the server**:
   - While the NICeMail Front Officer has IPC-QMS open, the page polls the inbox: every 30 s app-wide, every 15 s on the inbox page, and every 3 s while a sync runs. While the mailbox cannot be reached, the poll backs off to 1, 2 and then 5 minutes (`frontend/src/components/workflow/MailboxAutoSync.jsx:7, 16, 85`; `pages/frontOffice/MailboxInboxPage.jsx:59-61`).
   - The backend starts a background sync when the last one *ended* more than `NIC_BROWSER_SYNC_TTL_MS` (default 15 s) ago (`mailbox/nicBrowserMailbox.js:192-196, 217-219`). The server-side timer asks for one every `MAILBOX_SYNC_INTERVAL_MS` (default 15 s) while `MAILBOX_SYNC_ENABLED` is not `false`, so mail is read even when nobody has the inbox open (`mailbox/syncScheduler.js`). A **"Sync now"** button requests one (`POST /mailbox/sync`); it is ignored while a sync is running or if the last one ended less than 15 s ago (`nicBrowserMailbox.js:252-259`).
   - **Ingestion now has a server-side scheduler**, so mail arrives with nobody signed in. `services/email/mailbox/syncScheduler.js` asks for a sync every `MAILBOX_SYNC_INTERVAL_MS` (15 s) whenever Chrome's CDP endpoint answers, and `MAILBOX_SYNC_ENABLED=false` returns the deployment to browser-driven ingestion. Cron and a job queue are still absent. [Verified, 2026-09-24]
   - **The interval is a floor, not a period.** Every tick goes through `syncIfDue`, which keeps its single-flight, its `NIC_BROWSER_SYNC_TTL_MS` gap measured from the *end* of the previous sync, and its refusal to start while any browser work is queued. A full twenty-message sync was measured at 91 s, so ticks landing inside one are absorbed and the real cadence is whichever is longer. An acknowledgement or a final response always goes before a sync. [Verified, 2026-09-24]
   - **A closed Chrome is not hammered.** Consecutive sync failures move the next tick out to 2x, 4x then 20x the interval, recovering the moment one succeeds. `SYNC_FAILED` is still audited on the edge only, so an outage writes one row rather than one per tick. [Verified, 2026-09-24]
3. A sync opens its **own background tab** in the signed-in Chrome, loads the NICeMail web app, reads the newest inbox rows, and opens up to `NIC_BROWSER_SYNC_MAX` (default 20) new messages per sync (`nic/browser/session.js:58-64`; `config/browserConfig.js:112-117`; `readInbox.js`).
   - Browser work is **serialised**: sends and inbox syncs share one queue, so an acknowledgement or final-response send can wait behind a sync that opens up to 20 messages (`session.js:23-27, 96-100`).
4. For each message it extracts sender, recipients, subject, date, body (text and HTML) and downloadable attachments (type and size checked), then stores it once in MongoDB (`MailboxMessage`). Duplicates are prevented by the NICeMail message id. A message that fails to read three times is quarantined until the backend restarts (`nicBrowserMailbox.js:34-111`).
5. The Front Officer sees the messages in the **IPC Mailbox** page and can open a single message, with its sandboxed HTML body and attachments, on its own page.

**Production requirements for this step**

| Requirement | Detail | Status |
|---|---|---|
| Chrome / Chromium | Google Chrome, started by an operator with `--remote-debugging-port=9222 --user-data-dir=<dedicated profile>`. The **code enforces no minimum version**; the project documentation asks for **Chrome ≥ 136** (`docs/NIC_BROWSER_AGENT.md:97, 594`), and records that Chrome 136+ ignores the debugging flag on the *default* profile — which is why a dedicated profile is required. The agent never starts Chrome itself. | [Verified] the agent only attaches and checks no version (`attach.js:4-15`); the ≥ 136 requirement and the profile behaviour are [Documented only] |
| CDP | `NIC_CDP_ENDPOINT`, default `http://localhost:9222`, plain WebSocket, **no authentication** | [Verified] `browserConfig.js:23-25`, `cdp.js:77-100` |
| Signed-in NICeMail tab | An operator's NICeMail tab, on an `https` host matching `NIC_WEBMAIL_URL_PATTERNS`, must be open and signed in; the agent refuses otherwise (`NO_TAB`, `NOT_AUTHENTICATED`). After Chrome restarts, the operator must **reopen a NICeMail tab**, not only restart Chrome. | [Verified] `attach.js:70-101, 248-268` |
| Browser profile | A dedicated profile directory holds the session cookies. It must persist across restarts and be access-restricted. | [Documented only] `docs/NIC_BROWSER_AGENT.md` |
| Headed vs headless | The code does not require a headed browser: the agent works in a hidden background tab. What rules out headless operation is the **manual sign-in**, which needs a person at an interactive browser. Headless operation is **untested**. | [Verified] no automated login, background tab (`session.js:58-61`); [Unknown] headless |
| Server display | An interactive desktop session: a Windows logon session, or X11 / virtual display plus VNC on Linux (untested) | [Unknown] no server runbook exists; docs cover a Windows 10/11 workstation |
| Session recovery | Manual re-sign-in by the operator. The agent reports `SESSION_EXPIRED` (a password field in its own tab) or `NOT_AUTHENTICATED` (a login-marker URL or visible password field in the operator's tab). Any other sign-in or OTP page shows only as a generic readiness timeout (Section 9.3). | [Verified] `session.js:66-73`; `attach.js:260-267`; `cdp.js:340-343` |
| Browser crash / restart | The agent reports `NO_CHROME` or a lost session. The backend keeps running, because the agent is loaded lazily. The operator restarts Chrome and signs in. | [Verified] `attach.js:19-47`, `mailbox/index.js:160-169` |
| Network | Outbound HTTPS from the agent's host to the NICeMail web app. Code defaults: app URL `https://mail.mgovcloud.in/zm/`; tab patterns `mail.gov.in`, `mgovcloud.in`. The sign-in hosts used by the account (the docs mention `workplace.mgovcloud.in` as the operator's front door) must also be allowed. | [Verified] defaults `browserConfig.js:32-38, 50-52`; [Unknown] sign-in hosts and production firewall |
| NICeMail availability | Ingestion stops while NICeMail is down. The NICeMail Front Officer's inbox shows the sync status. The audit rows (`SYNC_FAILED` when a run of failures begins and for every failed manual sync, `SYNC_RECOVERED` on recovery, `SYNC_COMPLETED` for every sync that stored or failed a message, and for every manual sync) are visible to Admin and Super Admin. | [Verified] `nicBrowserMailbox.js:187-224`; `routes/auditRoutes.js:13-17` |

**Known limitations** (tagged per item)
- Only the rows the web app loads are visible ("the newest few dozen" in the code; about 50 per the documentation [Documented only]), and the agent does not scroll. Mail beyond that window is **never ingested and nothing raises an alert**; after long downtime it must be found and handled by hand in NICeMail (`readInbox.js:616-647`; `docs/NIC_BROWSER_AGENT.md`).
- Reading **attachments of received mail** uses selectors that are still marked uncalibrated (`selectors.js:315-322`). A miss silently stores the message **with no attachments** (`readInbox.js:180-213`).
- The agent does **not** check which account the browser is signed into when *reading*. It does check before *sending* (`session.js:43-75`; `sendMail.js:358-368`).

---

<a id="4-front-officer-workflow"></a>
## 4. Front Officer workflow (✓ Accept)

One server call, `POST /mailbox/messages/:id/accept`, performs the whole intake (`acceptMessage.js`; the decision record in step 7 is written by `controllers/mailboxController.js:389-407`). [Verified]

| Step | What the code does | Infrastructure | CPU / external |
|---|---|---|---|
| 1. Register the query | Re-reads the stored message (never the request body, for NICeMail), and refuses a second case for the same message (unique index) | MongoDB | CPU |
| 2. Create the case | `QueryCase` with state `RECEIVED`; email thread and inbound message records; audit rows `QUERY_RECEIVED`, `QUERY_REGISTERED`, `CASE_ASSOCIATED`; then `FRONT_OFFICE_VERIFICATION` | MongoDB | CPU |
| 3. Case ID | Atomic counter gives `QRY-YYYY-NNNNN`; the sequence does not restart yearly | MongoDB | CPU |
| 4. AI summary | One call to the Pravah endpoint, timeout 12 s (`GEMMA_TIMEOUT_MS`). A timeout, an unreachable model or a non-2xx reply stores a deterministic fallback with status `FALLBACK`, which later steps still use; only an unexpected error stores `FAILED` (`acceptMessage.js:145-170`). Accept never fails because of AI. | Outbound HTTPS to Pravah | **External AI** |
| 5. Acknowledgement | Through the outbound ledger, **once per case**. For NICeMail cases it goes through the Browser Agent: compose, verify, send, Sent-folder check (Section 8). | Browser Agent + NICeMail | CPU + NICeMail |
| 6. Forward to OIC | Through the case's own mailbox — the Browser Agent for NICeMail cases, otherwise `EMAIL_TRANSPORT` — carrying the stored AI summary and the message's attachments. Before sending, every attachment is checked; if one is missing (a received attachment refused by policy or not downloaded is stored with `attachmentId: null`), the **whole forward is refused**, every retry fails the same way, and the case stays at `FRONT_OFFICE_VERIFICATION`. On success: case → `PENDING_ASSIGNMENT`, audit `QUERY_FORWARDED`, in-app notification to the OIC role. | Browser Agent + NICeMail / NIC SMTP | CPU + external mail |
| 7. Decision record | `MailboxDecision` ACCEPTED (first decision wins); audit `EMAIL_CLASSIFIED` | MongoDB | CPU |

**Result shown to the Front Officer:** HTTP 200 with a per-step report: `acknowledged`, `acknowledgement.outcome` / `providerMessageId`, `forwarded`, `aiSummaryStatus`, and `errors[]` naming the step and stage that failed. The toast shows the acknowledgement's error reason; a failed forward shows only "not forwarded to the Officer-in-Charge", and its reason is on the case page. [Verified] (`acceptMessage.js:103-121, 368-387`; `MailboxInboxPage.jsx:131-150`; evidence for the attachment rule in step 6: `readInbox.js:383-423`, `emailService.js:225`, `services/attachments/resolveAttachments.js:26-60`)

**Retries and idempotency** [Verified] [Live-tested]
- A repeated Accept re-runs only the failed steps **at the API level**. In the UI, `ACCEPTED` is recorded even when the acknowledgement or forward fails, and the inbox then hides ✓ for a decided message, so recovery is through the **case page's retry buttons** (`/emails/acknowledgement`, `/emails/forward`) (`mailboxController.js:389-401`; `MailboxInboxPage.jsx:150, 471`; `WorkflowActionsCard.jsx:184-248`).
- The outbound ledger (`outboundemails`, unique key `emailType:queryId`) guarantees the acknowledgement and the forward are sent **at most once**. A repeat returns `ALREADY_SENT` with the original provider message id.
- **Reject:** `POST /mailbox/messages/:id/decision` records the decision. No case is created and no email is sent. **However, the server does not stop a later Accept of a rejected message:** a direct `POST …/accept` creates the case and sends both emails, while the stored decision still says `REJECTED`. Only the UI hides the buttons (`acceptMessage.js:187-193`; `decisions.js:35-36`; `MailboxInboxPage.jsx:471`).

**Timing:** Accept waits for the AI summary (≤ 12 s), the NICeMail acknowledgement, and the forward, one after another. **There is no upper bound:** a send can wait behind a running sync, then run several 20 s NICeMail step timeouts. Accept (and final approval) can therefore run well past 60 s, so any reverse proxy needs a longer read timeout (Section 11.3). In the live test on 2026-09-22:
- NICeMail sends (acknowledgement or final response) took about 4.7–6.1 seconds each;
- a complete Accept took about 18 seconds on a run whose AI call timed out at 12 s (the figures are indicative single observations, not a measured decomposition; the Gmail forward was not timed separately);
- earlier attempts took up to 54 seconds, while a since-fixed NICeMail prompt caused send timeouts. [Live-tested]

---

<a id="5-oic-workflow"></a>
## 5. OIC workflow (AI recommendation and assignment)

| Operation | Implementation | Needs | CPU / external |
|---|---|---|---|
| Review case | Case page, loaded from `GET /queries` (scoped per role) | MongoDB | CPU |
| AI officer recommendation | `POST /ai/recommend`: sends subject, description and summary to Pravah (timeout 36 s). The model ranks officials from a **hard-coded list of 6 development officials** (`@ipc.example`) in the prompt. Fallback: keyword scoring. | Pravah API | **External AI** |
| Assignment | The browser decides, then writes through `POST /queries/persist`. The server checks the role's permission for the target state (`ASSIGNED`) and case scope, not the source state. | MongoDB | CPU |
| Notification | In-app notification to the Assigned-Official **role** (not to the named officer); no email | MongoDB | CPU |

Evidence: `gemmaService.js:254-367`; `backend/src/config/officialsMetadata.js`; `frontend/src/components/ai/AiRecommendationCard.jsx`; `frontend/src/store/useWorkflowStore.js:771-824`; `backend/src/middleware/authorizeCaseDelta.js:103-111`.

**Findings to fix before production** [Verified]
1. **The officials directory is development data, in three places.** The 6 development officials with placeholder addresses are in `officialsMetadata.js` **and** typed directly into the prompt text (`gemmaService.js:264-270`). The frontend's hard-coded `MOCK_USERS` list (`frontend/src/constants/mockUsers.js`) drives the local recommendation, the reviewer list, name lookups and the OIC id. All three must be replaced together with IPC's real officers and divisions.
2. **The audit trail can mislabel AI output.** The assignment audit records the *browser's local* recommendation, not the Pravah one shown on screen. A fallback recommendation is recorded as model-generated (`aiController.js:20, 34-35, 70`; `useWorkflowStore.js:771-777`).

---

<a id="6-assigned-officer-workflow"></a>
## 6. Assigned Officer workflow (AI draft)

| Operation | Implementation | Needs | CPU / external |
|---|---|---|---|
| Review case, original query, AI summary | Case page | MongoDB | CPU |
| **AI Draft** | `POST /ai/draft`:<br>1. The enquiry is split into questions (rules, then one Pravah call).<br>2. For each question, supporting passages are retrieved from the **local knowledge index** (JS word matching).<br>3. One grounded Pravah call writes the draft.<br>4. The server enforces one answer per question.<br>Timeouts 12 s + 60 s, so up to ~72 s. Fallback: every answer "not established", plus a warning to the officer. | Pravah API + local JSON index | **External AI** + light CPU |
| Edit draft | Each save creates a new `ResponseVersion` (DRAFT) | MongoDB | CPU |
| Select reviewer(s) | Adds REVIEW steps; reviewer candidates come from the hard-coded frontend `MOCK_USERS` list, filtered to 2 development reviewers with `@ipc.example` addresses (`AddReviewLevelField.jsx:15`). Must be replaced for production. | MongoDB | CPU |
| Submit to reviewer | Case → `UNDER_REVIEW`; in-app notification to the Reviewer role | MongoDB | CPU |

Evidence: `gemmaService.js:495-559, 724-794`; `backend/src/data/ipcKnowledge.js`; `useWorkflowStore.js:826-1009`.

**Dependencies and deployment notes for the AI Draft**
- **No local model.** The only AI dependency is outbound HTTPS to `GEMMA_API_URL`. [Verified]
- The knowledge index (`backend/src/data/ipcKnowledge.json`, 0.46 MB) ships with the code. Rebuilding it (`npm run ingest:ipc`) needs source documents under `docs/markdown/`. These are **not in the repository** (git-ignored), so a new environment cannot rebuild the index. [Verified]
- A fallback draft is still tagged "AI generated" in the saved version. That is a labelling issue to fix before production reporting relies on it (`useWorkflowStore.js:877-882`). [Verified]
- The SRS lists attachments as a draft input. This is **not implemented**: the AI never sees attachments. [Verified]

---

<a id="7-reviewer-workflow"></a>
## 7. Reviewer workflow (approve / request changes)

```text
Officer submits ──► UNDER_REVIEW ──► Reviewer
                                       ├── Approve ──► next review level (UNDER_REVIEW) … ──► PENDING_FINAL_APPROVAL ──► OIC
                                       └── Request changes (comment required)
                                              ──► RETURNED_FOR_REVISION ──► all review steps reset
                                              ──► Officer edits / regenerates ──► resubmits ──► UNDER_REVIEW  (repeat)
```

- **Approve:** records a `Review` (APPROVED). If more levels remain, the case moves to the next review level and the Reviewer role is notified in-app; after the last level it moves to `PENDING_FINAL_APPROVAL` and the OIC role is notified. [Verified] (`useWorkflowStore.js:1067-1128`, notification at `1097-1100`)
- **Request changes:** a comment is required. The case moves to `RETURNED_FOR_REVISION`, the whole review cycle resets, and the officer revises and resubmits. **There is no limit on the number of cycles.** [Verified] (`useWorkflowStore.js:1130-1179`)
- **Infrastructure:** MongoDB only; no AI or email in this step. CPU-only. [Verified]
- **Authority:** these transitions are decided **in the browser**. The server checks that the caller's role may move a case *into* the target state, and that the caller is party to the case. It does not check that the move is legal *from the current state*, or that the reviewer owns the step. The server lets the Assigned Official role set `PENDING_FINAL_APPROVAL` directly, and final approval accepts that state, so **review can be skipped entirely on the server**; the "at least one review level" rule exists only in the browser. The server prints this warning itself at start-up: "there is no workflow state machine yet". [Verified] (`authorizeCaseDelta.js:103-111`; `constants/protectedFields.js:37-39`; `constants/workflowStates.js:71`; `useWorkflowStore.js:940-944`; `backend/src/server.js:118-123`)

---

<a id="8-oic-final-approval-and-dispatch"></a>
## 8. OIC final approval and NICeMail dispatch

**Final approval is server-authoritative.** `POST /queries/:queryId/final-approval` requires the `FINAL_APPROVE` permission (OIC, or Super Admin). [Verified] (`services/workflow/finalApproval.js:62-185`)

1. The case must be in `PENDING_FINAL_APPROVAL` or `APPROVED`. `READY_FOR_DISPATCH`, `DISPATCHED` and `CLOSED` are also accepted: they skip the approval and re-attempt the dispatch. Any other state, or a case with no response version, is refused (409) (`finalApproval.js:70-88`; `workflowStates.js:71-76`).
2. An atomic update records the approval exactly once and moves the case to `READY_FOR_DISPATCH`. The **latest** response version (by creation time, not necessarily the one the reviewers approved) is marked `FINAL_APPROVED`, and `FINAL_APPROVAL_GRANTED` is audited. **The mark is only a status value:** `POST /queries/persist` can still change that version's content, so anyone party to the case could alter the approved text before a retry sends it (`finalApproval.js:82-84, 127-130`; `queryController.js:423-431`; `authorizeCaseDelta.js:134-135`).
3. The response is dispatched through the outbound ledger (**at most once**) to the inquirer address stored on the case. The request cannot redirect it. Final responses never carry attachments (`caseMail.js:319-330`).

The OIC approval screen shows the subject, the lifecycle timeline, the reviewers' decisions and the latest draft (`ApprovalDetailPage.jsx:59-130`). The case, response versions, reviews and audit events are stored (`QueryCase`, `ResponseVersion`, `Review`, `AuditEvent`). The Pravah recommendation is **not** stored; only the browser's local recommendation is audited (`useWorkflowStore.js:781-792`). [Verified]

### The dispatch pipeline, as implemented [Verified] [Live-tested]

```text
OIC Final Approval ─► READY_FOR_DISPATCH ─► ledger claim (OutboundEmail, key OUTGOING_RESPONSE:<caseId>)
  ─► Outbound guard (test recipient only, unless NIC_ALLOW_OUTBOUND=true)
  ─► Browser Agent opens its own tab in the signed-in Chrome
  ─► closes the NICeMail "satisfaction survey" pop-up if present (its own "Close" button only)
  ─► New Mail ─► check the From field contains NIC_EMAIL (otherwise stop, nothing sent)
  ─► enter recipient ─► read back recipient chips = exactly the inquirer (otherwise stop, draft discarded)
  ─► subject ─► read back exactly
  ─► body ─► read back from the editor
  ─► refuse to press Send while any unknown dialog is open
  ─► Send ─► answer NICeMail's "Add follow-up reminder?" prompt with "Skip and Send" (if shown)
  ─► wait for the compose form to close
  ─► open the Sent folder ─► find the message (same subject + recipient + sent no earlier than 10 s before the click)
  ─► Sent-folder id = provider message id
  ─► ledger SENT (+ provider message id, time) ─► case DISPATCHED ─► CLOSED ─► audit + Front Office notification
```

Evidence: `nic/browser/sendMail.js:559-706`; `transports/nicBrowserTransport.js`; `services/email/outbox.js`; `services/email/caseMail.js:282-394`.

**Outcomes** [Verified]

| Outcome | Meaning | What the user sees / does |
|---|---|---|
| **SENT** | Found in the NICeMail Sent folder | Case closes; provider message id stored |
| **NOT_SENT** (FAILED) | Failed **before** Send was pressed; the draft is discarded (best effort: skipped silently if the Discard control is not found) | The error names the stage (e.g. `stage: outbound_guard`, `verify_from`). Safe to retry. A transient network failure gets one automatic retry. (`sendMail.js:507-515, 693`; `outbox.js:58, 359-366`) |
| **UNCERTAIN** | Send was pressed but the message could not be confirmed in Sent | **Never retried automatically.** "It was sent" / "It was not sent — send it" is offered on the Dispatch page for responses, and on the case page for acknowledgements (`WorkflowActionsCard.jsx:317-325`). A person checks the NICeMail Sent folder. |
| **BLOCKED_UNCERTAIN** | Any later attempt after an UNCERTAIN | Nothing is sent until a person resolves the UNCERTAIN row. NICeMail has no automatic Sent-folder check, unlike Gmail (`emailService.js:339-348`). |
| **IN_PROGRESS** | Another attempt holds the claim (3-minute lease) | Nothing is sent by this attempt |
| **ALREADY_SENT** | A repeat request for a message already sent | Nothing is sent again |

Every stage is written to the backend log as a structured line (`ACK …` / `FORWARD …` / `RESPONSE …`: START → RESOLUTION → NIC BROWSER steps → VERIFICATION → RESULT) (`services/email/sendTrace.js`). These lines include inquirer addresses and subjects, so the logs need an access and retention policy (`caseMail.js:403-421`). [Verified]

**Live evidence** [Live-tested, 2026-09-22, test account] for five cases (four to the test inquirer, one to a real inquirer with the outbound interlock open):
- acknowledgements and final responses were composed, sent, found in the NICeMail Sent folder, and recorded with provider message ids;
- repeats returned `ALREADY_SENT` without sending again.

Delivery into the recipients' own inboxes was not independently checked by the audit.

---

<a id="9-nicemail-browser-agent--production-audit"></a>
## 9. NICeMail Browser Agent — production audit

**Verdict:** The Browser Agent is **functionally working and CPU-deployable**. It was verified live on 2026-09-22. As built, it is **an operator-attended component, not an unattended service**. It is suitable for a **supervised pilot** on a dedicated VM with an interactive Windows session — a configuration that still has to be proved, because the agent has only been run on a Windows 10/11 workstation (Sections 9.2 and 18). It is **not yet ready for unattended 24×7 production** without the operational controls and code changes listed below.

### 9.1 How it is built [Verified]

| Aspect | Implementation | Evidence |
|---|---|---|
| Automation technology | Its own minimal Chrome DevTools Protocol client over Node's built-in WebSocket. No Playwright, no Selenium, no browser download. | `nic/browser/cdp.js` |
| Browser | Attaches to an **existing** Chrome. Never launches Chrome, never holds a credential. | `attach.js:4-15`, `browserConfig.js:8-11` |
| Work model | Each read or send opens **its own background tab** at `NIC_WEBMAIL_APP_URL`, does its work, and closes the tab. The operator's tab is not touched. | `session.js:44-92` |
| Concurrency | **One browser job at a time per backend process.** Reads and sends share one queue; a send waits behind a running sync. | `session.js:27, 96-101` |
| Clicking | Clicks and field values use DOM events from page scripts, because the background tab is never drawn on screen. Recipients and subject are written as input values with synthetic events; only the body is inserted through CDP `Input.insertText`. | `selectors.js:368-432`; `sendMail.js:107-120, 406, 430` |
| Page understanding | A central selector registry: accessibility role and name first, CSS last; visibility, name and uniqueness checks. Uncalibrated selectors are refused. | `selectors.js`; `pageKit.js` |
| Node.js | Needs a Node version with a global `WebSocket` (Node 22+). There is no `engines` field to enforce it. | `cdp.js:99`; `backend/package.json` |

### 9.2 Browser requirements

| Requirement | Finding | Status |
|---|---|---|
| Chrome / Chromium | Google Chrome, launched manually with `--remote-debugging-port=9222 --user-data-dir=<dedicated>`. Chrome 136+ requires a non-default profile directory for remote debugging. | [Documented only] (`docs/NIC_BROWSER_AGENT.md` §7) |
| Version compatibility | The project notes measurements against Chrome 152 on Windows (2026-09-21) | [Documented only] `docs/NIC_BROWSER_AGENT.md:624` |
| CDP | `localhost:9222` by default. No authentication, no TLS. The code does not enforce localhost. | [Verified] |
| Browser profile | Holds the NICeMail session cookies, so it **is the credential**. It must persist and be locked down. | [Documented only] |
| Persistent session | Relies on NICeMail keeping the session alive. Session lifetime is unknown. | [Unknown] |
| Headed / headless | No code requires a headed browser (the agent works in a hidden background tab); the **manual sign-in** does. Headless operation is **untested**, and it is unknown whether NICeMail treats a headless browser differently. | [Verified] no code requirement; [Unknown] headless |
| Display | An interactive desktop session is needed on the host: a Windows logon that stays open after RDP disconnect, or X11/Xvfb + VNC on Linux. No server runbook exists. | [Unknown] |
| Process management | **None in the code.** Nothing starts, watches or restarts Chrome. | [Verified] |
| Restart / recovery | After a Chrome crash, the operator restarts Chrome with the same flags and profile **and reopens a NICeMail tab** (without one the agent fails with `NO_TAB`). If the session survived in the profile, work resumes; otherwise the operator signs in again. | [Verified] error reporting (`attach.js:70-101, 248-257`); [Unknown] cookie survival |
| Same host as the backend | **Strongly recommended; not enforced by the code.** The endpoint is configurable (`NIC_CDP_ENDPOINT`), and localhost binding is Chrome's default, not something the code checks. CDP must never leave the host (Section 13). The local-file-path attachment hand-off would also need the same host, but no current dispatch sends attachments through the agent (the acknowledgement has none; the response is sent without them). | [Verified] `browserConfig.js:23-25`; `sendMail.js:439-462`; `caseMail.js:321-330` |
| Memory saver | Chrome's memory saver can discard the hidden agent tab mid-task, which is reported as a lost session | [Verified] `cdp.js:277-282` |

### 9.3 NICeMail requirements

| Area | Finding | Status |
|---|---|---|
| Authenticated session | Required. Expiry is named `NOT_AUTHENTICATED` (the operator's tab shows a login-marker URL or a visible password field) or `SESSION_EXPIRED` (a password field in the agent's own tab). Any other sign-in or OTP page shows as a generic "NICeMail did not become ready within 20000ms" error with stage `ui`, so alerts must match that too. | [Verified] `attach.js:50, 124-135`; `session.js:36-41, 66-73`; `cdp.js:340-343` |
| MFA / OTP | Manual only, by a person, in the visible browser. **No automated login exists, and none should be added.** | [Verified] |
| Session expiry | Unknown lifetime; expiry stops all reads and sends until someone signs in again | [Unknown] |
| UI (DOM) dependency | High. The agent reads NICeMail's (Zoho's) web page. A UI change can break reads or sends. | [Verified] |
| Selector calibration | Compose and send controls calibrated 2026-09-22. Three keys (Cc toggle, received-mail attachment rows) still uncalibrated. | [Verified] `selectors.js:315-322` |
| Iframes | The Workplace portal shows the mailbox in a cross-origin iframe. The agent avoids that by opening the mail app directly as a top-level page. Same-origin iframes (the compose editor) are searched. | [Verified] |
| Dynamic pop-ups | The "Email Satisfaction Survey" pop-up is closed with its own Close button before Send. The "Add follow-up reminder?" prompt shown after Send is answered with "Skip and Send". **Any other dialog before Send stops the send (NOT_SENT).** Both are matched by **English text**. A changed survey stops the send before Send (NOT_SENT). A changed follow-up prompt leaves the message held after Send, reported **UNCERTAIN**. | [Verified] `selectors.js:276-305`; `sendMail.js:291-348, 487-505, 636-676` |
| UI language | Every compose and read control must also pass an English accessible-name check ('New Mail', 'To Recipients', 'Send', 'Inbox', 'Sent', 'Email listing'). **The whole agent needs NICeMail's English UI**; the `lab.ipc@gov.in` account's language must stay English. | [Verified] `selectors.js:38, 45, 182-235, 250`; `pageKit.js:210-212, 237` |
| Compose / send | From, recipient, subject and body are verified before Send; Bcc is refused | [Verified] |
| Sent-folder verification | A send counts as sent only when found in Sent (exact subject + recipient + a message-id timestamp no earlier than 10 s before the click). The Sent id becomes the provider message id. | [Verified] [Live-tested] |
| Clock dependency | The Sent-folder match allows 10 seconds of clock difference (`since = click time − 10 s`), matching subject, a recipient substring and a message-id timestamp ≥ `since`. **If the server clock runs more than about 10 s ahead of NICeMail's, every successful send is reported UNCERTAIN.** If it runs well *behind*, the window widens, and an older Sent message with the same subject and recipient could confirm a Send that delivered nothing (for example after a reset restarts the case IDs). **NTP is mandatory, in both directions.** | [Verified] `sendMail.js:49-57, 532-537, 637` |

### 9.4 Reliability audit

| Scenario | Current behaviour | Risk |
|---|---|---|
| Chrome not running / crashed | Clear error (`NO_CHROME`, lost session). Sends fail **before** Send (NOT_SENT, safe to retry). Ingestion pauses. The backend stays up. | Medium: needs detection and a person |
| Network failure to NICeMail | Page load or wait times out; stage-named error; NOT_SENT if before Send | Medium |
| NICeMail downtime | As above. The NICeMail Front Officer's inbox shows the sync status. `SYNC_FAILED` (start of a failure run, and every failed manual sync) and `SYNC_RECOVERED` audit rows are visible to Admin and Super Admin. | Medium |
| Session expired | `SESSION_EXPIRED` / `NOT_AUTHENTICATED`, or a generic readiness timeout if another sign-in page appears (Section 9.3). Nothing sent. Everything waits for manual sign-in. | **High**: no alert exists |
| NICeMail UI change | Reads fail with "recalibrate" errors. Sends stop before Send (NOT_SENT), or after Send if the change affects the post-Send prompt (UNCERTAIN). | Medium-High |
| Send timeout after Send pressed | UNCERTAIN; never auto-retried; a person must check Sent and resolve it | Medium: needs an operator |
| Duplicate sends | Prevented by the outbound ledger's unique claim per email per case; repeats return `ALREADY_SENT` | Low [Verified] [Live-tested] |
| Backend restart mid-send | The ledger row stays `SENDING` until its 3-minute lease expires and another attempt finds it. It then becomes UNCERTAIN and a person resolves it. There is no automatic sweeper. | Medium |
| Two backend instances | Each has its own queue, so two instances would drive the same NICeMail session at once. **Run exactly one backend instance.** The discover and calibrate tools also run as separate processes with their own queue, so run calibrate only with the backend idle or stopped. | Medium: operational rule |
| Long sync blocking a send | A sync (up to 20 messages) can hold the queue for minutes, and a send waiting behind it can outlive its 3-minute lease | Medium |
| Mail beyond the loaded window (~50 rows [Documented only]; "few dozen" in the code) | Never ingested (no scrolling), and nothing raises an alert. A first sync on an empty store takes only the newest `NIC_BROWSER_SYNC_MAX` (20) and never ingests the older rows (`readInbox.js:616-635`). | Medium after downtime |
| Quarantine state | Kept in memory; reset on restart | Low |

**Idempotency and the outbound ledger** [Verified]: every case email is claimed in `outboundemails` (unique `dispatchKey`) before it is attempted. The outcomes are `SENT`, `ALREADY_SENT`, `IN_PROGRESS`, `FAILED` (retryable), `UNCERTAIN` and `BLOCKED_UNCERTAIN`.

**No channel can settle an `UNCERTAIN` send automatically** [Verified, 2026-09-23]. The Gmail transport's Sent-folder search was the only implementation of `reconcile` that ever existed; `reconcileDelivery` is still called on every uncertain send and every channel now answers `UNKNOWN`. So an `UNCERTAIN` send is always a person's work item, and a case whose final response is uncertain sits at `READY_FOR_DISPATCH` until somebody checks the Sent folder and records the answer. **Nothing escalates it.** That needs a named owner and a target time to settle, or a case can wait indefinitely with no alert (`outbox.js`; `emailService.js`, `reconcileDelivery`).

### 9.5 Browser Agent production risks (ranked)

Revised 2026-09-23. The original risk #1 — that the forward could not go through the agent — is
resolved, and risks #1 and #2 below are the consequences of how it was resolved.

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | **Critical** | The forward is now a **third serialised browser job, and the only case email that carries attachments** — through an attach control still listed in `UNCALIBRATED`, which the agent refuses before it touches the page. **Every accept of a case with an attachment therefore fails at the forward until calibration has been run** [Verified, 2026-09-23] (`nic/browser/selectors.js`, `UNCALIBRATED`: `ccToggle`, `attachmentEntry`, `listRowAttachment`) | Run `npm run nic:browser:calibrate -- --attach` against the production account and take the three keys out of `UNCALIBRATED`, **before** go-live. Until then, treat an attachment-bearing enquiry as a known failure, not a surprise |
| 2 | **Critical** | **Single channel.** One NICeMail session outage now stops the acknowledgement, the forward and the response together — the forward no longer has a channel independent of the browser. `NIC_ALLOW_INTERNAL_FORWARD` does not help: it is a recipient allowance, not a second channel | The monitoring in Section 15 stops being optional. Keeping `EMAIL_TRANSPORT=nic` configured with a working app password gives cases that did *not* arrive through the agent a second path, but not NICeMail cases |
| 3 | High | **No `UNCERTAIN` send settles itself** (§9.4). Every one is a standing human work item, and a case can sit at `READY_FOR_DISPATCH` indefinitely with nothing raising it | A named owner, a daily review of the uncertain queue, and a target time to settle. A lease sweeper and an ageing alert are the code fixes |
| 4 | High | Single point of failure: one manually signed-in, visible Chrome on the backend host; no auto-restart; no alert on session expiry | Operator runbook, a health check and alerts (Section 15); a named account owner |
| 5 | High | CDP has no authentication. Anyone who can reach port 9222 controls the signed-in official mailbox. | Localhost only, host firewall, restricted logons (Section 13) |
| 6 | High | Account switch side effects: old rows hidden, existing lab.ipc mail stored as pending inbox messages, stale sessions misrouted, mail misfiled if `NIC_EMAIL` and the Chrome sign-in change at different times | Switch procedure (Section 2.2) |
| 7 | Medium-High | Reads do not check that the browser is signed in to `NIC_EMAIL` (sends do) | Operational check; small code change |
| 8 | Medium | Crashed sends need a retry to surface; the ledger has no sweeper for a lease that expired mid-send | Lease sweeper (code) |
| 9 | Medium | Server clock ahead of NICeMail by > 10 s makes every send UNCERTAIN; a clock well behind could confirm a send against an older Sent message | NTP, both directions |
| 10 | Medium | NICeMail UI changes (English text literals and accessible names, 3 uncalibrated keys); a UI language change stops all reads and sends | Keep the account's UI in English; scheduled `nic:browser:discover`; recalibration procedure |
| 11 | Low-Medium | **Resolved for the sign-in dependency**: the server syncs on its own timer, so ingestion no longer needs anyone signed in to IPC-QMS. It still needs the dedicated Chrome running and the NICeMail session live. Limited loaded window remains (~50 rows [Documented only]) | Monitor `sync.ok` and the Browser Agent's session; keep the Chrome profile signed in |
| 12 | Medium | Three serialised browser jobs per case now, not two, all inside HTTP requests and sharing one queue with syncs | Accept at low volume; a dedicated worker is the future step, and matters more now than it did |
| 13 | Medium-Low | Production refuses `EMAIL_TRANSPORT=mock` unconditionally, so a NICeMail-agent-only deployment must still name `nic` — which boots without an app password and then fails at the first non-agent send [Verified, 2026-09-23] (`config/env.js`) | Obtain the app password and configure SMTP properly, which is wanted anyway as the second channel for non-agent cases. Not a defect; a configuration trap worth knowing |

---

<a id="10-cpu-vs-gpu-assessment"></a>
## 10. CPU vs GPU assessment

Every component, classified from the code:

| Component | CPU required | GPU required | External service | Evidence and notes |
|---|---|---|---|---|
| React frontend (Vite static build) | Yes (build only; served as static files) | **No** | No | `frontend/package.json`; runs in users' browsers |
| Node.js backend (Express 5) | Yes | **No** | No | `backend/package.json`; pure JavaScript dependencies |
| Database: **MongoDB** (not PostgreSQL) | Yes | **No** | No | `backend/src/config/db.js`; required in production |
| File storage (attachments) | Yes (disk) | **No** | No | `attachmentStore.js`; local disk `ATTACHMENT_DIR` |
| Chrome for the Browser Agent | Yes | **No** | No | DOM events plus CDP text/key input and file-chooser interception; no WebGL, screenshots or GPU flags in the code. On a GPU-less VM Chrome renders in software; that CPU cost is unmeasured (Section 1, qualification 3) |
| NICeMail web application | – (hosted by NIC) | **No** | **NICeMail (NIC)** | Accessed over HTTPS through the browser |
| AI Summary | Yes (HTTP call) | **No** (in IPC-QMS) | **Pravah Gemma API** | `gemmaService.js:170`; 12 s timeout; deterministic fallback |
| AI Officer Recommendation | Yes (HTTP call + keyword fallback) | **No** | **Pravah Gemma API** | `gemmaService.js:315`; 36 s timeout |
| AI Draft | Yes (HTTP call + local text retrieval) | **No** | **Pravah Gemma API** | `gemmaService.js:440`; up to ~72 s |
| Knowledge retrieval / "grounding" | Yes (light, in-process JS) | **No** | No | `ipcKnowledge.js`; 0.46 MB JSON; no embeddings or vectors |
| Embeddings / vector search | Not present | – | – | Dependency and source scan: none |
| OCR / PDF / image processing | Not present | – | – | Attachments stored only, never parsed |
| Background workers | 15 s mailbox sync + hourly junk-retention sweep, both in process | Sync is browser-bound, not CPU-bound | Negligible | Both `unref`'d and env-disableable; no cron, queue or worker threads |
| NIC SMTP / IMAP (optional path) | Yes | **No** | NIC mail servers | App password pending [Documented only] |
| The AI model itself (Gemma, at Pravah) | – | Almost certainly (outside IPC) | Pravah | [Unknown]: hosted by Pravah/AICTE, not by IPC-QMS |

**Hardware recommendation** [Recommendation]: standard CPU virtual machines, with no GPU and no special hardware, **but** the application VM must provide an interactive desktop session for the agent's Chrome, and that Chrome should run on the backend's host (Sections 9.2 and 11). The resource drivers are:
- **Chrome with the NICeMail web app loaded**: the largest memory consumer on the application host.
- **MongoDB**: grows with cases, the audit trail and stored mailbox messages (including HTML bodies of up to 1 MB each) (`nicBrowserMailbox.js:50, 75-76`).
- **Attachment disk (`ATTACHMENT_DIR`) on the application host**: grows with attachments, which are files on disk, not in MongoDB; it must be persistent and backed up (`attachmentStore.js:5-15, 95-96`; `env.js:59`).
- **Node.js**: modest.

Other infrastructure needs that are not hardware: outbound HTTPS and DNS to `pravahai.aicte-india.org`; and a separate static web server or reverse proxy for the frontend, because the backend does not serve the built frontend (no `express.static` in `app.js`).

Section 11 gives starting sizes, labelled as assumptions to be validated in the pilot.

**Only exception:** if IPC decides the AI must run **on-premise** instead of through Pravah, a separate GPU-equipped model server would be required, with its own sizing and cost. That is a policy decision (Section 19, item 8). The current code would then only need `GEMMA_API_URL` pointed at the new server, provided it speaks the same request and response format (`{prompt}` in, `answer`/`response`/`text` out) **and accepts unauthenticated POSTs**: the code sends only a `Content-Type` header, so a server that requires authentication would need a code change. [Verified] (`gemmaService.js:170-187, 315-320, 440-445`)

---

<a id="11-production-server-architecture"></a>
## 11. Production server architecture

### 11.1 Recommended topology (first production release) [Recommendation]

The static frontend is served by Render (§11.5); the VM proxy serves `/api` only.

```text
                         Users (IPC staff) — HTTPS
                                   │
                    ┌──────────────▼──────────────┐
                    │ Render Static Site (§11.5)  │  the only component users reach;
                    │  • /api/* → rewrite to VM   │  nothing secret is set on Render
                    │  • /* → /index.html         │
                    └──────────────┬──────────────┘
                                   │ HTTPS; inbound 443 from Render's outbound IP ranges only
                    ┌──────────────▼──────────────┐
                    │ Reverse proxy (TLS)         │  IIS / nginx on the application VM
                    │  • /api → 127.0.0.1:5000    │
                    └──────────────┬──────────────┘
                                   │ (same host)
┌──────────────────────────────────▼───────────────────────────────────────┐
│ APPLICATION VM  (Windows Server with Desktop Experience, or Windows      │
│                  10/11 Enterprise — tested only on a 10/11 workstation)  │
│  • Node.js 22 LTS — IPC-QMS backend, EXACTLY ONE instance, NODE_ENV=prod │
│  • Google Chrome (headed) — dedicated profile, --remote-debugging-port   │
│      bound to localhost:9222, signed in to lab.ipc@gov.in by its owner   │
│  • Interactive logon session for the agent account (kept alive)          │
│  • Attachment storage (ATTACHMENT_DIR) on a data disk                    │
│  • Host firewall: 9222 and 5000 NOT reachable from the network           │
│  • NTP time sync (mandatory — Section 9.3)                               │
└───────┬───────────────────────────┬───────────────────────┬──────────────┘
        │ MongoDB (TLS, auth)       │ HTTPS                 │ HTTPS
┌───────▼─────────┐       ┌─────────▼──────────┐   ┌────────▼──────────────┐
│ MongoDB Atlas   │       │ NICeMail (NIC)     │   │ Pravah Gemma AI API   │
│ separate        │       │ mail.mgovcloud.in  │   │ pravahai.aicte-india  │
│ production      │       │ + sign-in hosts    │   │ .org  (external)      │
│ cluster         │       └────────────────────┘   └───────────────────────┘
└─────────────────┘
```

### 11.2 Where the Browser Agent should run

| Option | Possible with current code? | Assessment |
|---|---|---|
| **Same server as the backend** | **Yes** | CDP stays on `localhost` and the agent is in-process with the backend. The local-file-path attachment hand-off also *requires* this host, although no dispatch has ever exercised it. **Recommended for release 1.** [Verified] co-location requirement; [Unknown] whether the attachment path works in practice |
| Dedicated browser server | Technically yes (`NIC_CDP_ENDPOINT` is configurable) | **Not recommended.** CDP has no authentication, so it would expose the signed-in mailbox over the network (a severe risk, Section 13). Any future attachment send through the agent would also break, because files are handed over by local path. |
| Separate worker / service | No (future) | The right long-term design: a browser-agent worker that takes send and sync jobs from a queue (for example in MongoDB), with the backend no longer waiting in-request. Requires development. |
| Container | Not recommended now | Headed Chrome, a persistent profile and manual MFA inside a container (via VNC) is possible in principle but untested, and adds complexity to the sign-in process. |
| **Virtual machine** | **Yes** | Recommended. A dedicated VM gives an interactive desktop for sign-in, a protected profile, and isolation from other workloads. |

### 11.3 Component-by-component

| Component | Recommendation | Basis |
|---|---|---|
| Frontend | Render Static Site (§11.5): built with `VITE_API_BASE_URL=/api/v1` (it is fixed at build time), `/api/*` rewritten to the VM, SPA fallback to `index.html`. | [Verified] `frontend/.env.example`; `axiosClient.js:5` falls back to `http://localhost:5000/api/v1` if unset |
| Backend | `node src/server.js` under a process manager (for example NSSM as a Windows service, or pm2) with automatic restart. **Exactly one instance.** `NODE_ENV=production`, set machine-wide on the VM: it is what selects `backend/.env.production` (or `ENV_FILE` names the file), and a relative env-file name is resolved against `backend\`, whatever the working directory. There is no bind-address setting: the server listens on all interfaces, so only the host firewall keeps port 5000 private. Keep the service's **working directory at `backend\`**, and give `QMS_PASSWORDS_FILE` an absolute path, because it is resolved against the working directory. Set `CLIENT_URL` to the Render site origin (CORS allows exactly one origin). | [Verified] `server.js:63`; `config/env.js:7-32`; `credentials.js:9-20`; `app.js:20` |
| Chrome | Headed, dedicated profile, localhost CDP. Started at logon by a scheduled task or startup script with the same flags. The profile folder is ACL-restricted to the agent account. | [Recommendation]; nothing in the repo manages Chrome |
| Process accounts | Run Chrome and the backend under the **same dedicated Windows account**, so CDP stays local and any attachment the backend stages in its `os.tmpdir()` is readable by Chrome (otherwise every agent send with an attachment would fail). | [Recommendation]; `sendMail.js:440-462`; to validate |
| Database | A **separate MongoDB Atlas cluster** for production, with its own project, database user and database name (`qms_production`), **with authentication and TLS**; its IP access list holds only the application VM. Never point production at the shared development database: at every start the backend recreates the indexes declared in code and **drops any index a DBA added manually**, and in production the retention sweep always runs. | [Verified] `db.js:83`; `retention.js:420`; [Unknown] production cluster tier and region |
| File storage | `ATTACHMENT_DIR` on a dedicated, backed-up data disk. Files are never deleted by the application (no retention policy). | [Verified] `attachmentStore.js`, `env.js:59` |
| AI | Allow outbound HTTPS from the application VM to the Pravah endpoint. Obtain approval to send enquiry text to it; no authentication is used today. | [Verified] `gemmaService.js:170-172` |
| Reverse proxy / HTTPS | TLS terminates at the proxy; the app speaks plain HTTP on localhost. The app trusts one proxy hop only when `NODE_ENV=production`; behind Render's rewrite there are two (Render, then the VM proxy), a first-deploy check in §11.5. **Raise the proxy read timeout to at least 5 minutes:** sends run inside the HTTP request, can wait behind a sync and then run 20 s step timeouts and a Sent-folder poll, so a proxy default (of the order of 60–120 s for nginx and IIS ARR — check your own product's default) returns a 504 to the user while the send carries on. Render's rewrite timeout is a first-deploy check too. Also keep `/api/v1/health` off the host Render proxies to (Section 13 #12). | [Verified] one proxy hop in production: `app.js:15-17`; sends run in-request: `finalApproval.js:155`, `acceptMessage.js:356-364`. [Unknown] proxy defaults (not in the repository) |
| Logging | Capture stdout/stderr to rotating log files (the app writes only to the console). Logs contain personal data (inquirer addresses, subjects), so restrict access and set retention. | [Verified] `sendTrace.js`; morgan |
| Monitoring | See Section 15. | – |
| Network segmentation | Users reach only the Render site. The VM proxy accepts inbound 443 only from Render's published outbound IP ranges (§11.5). The Atlas cluster accepts connections only from the app VM. Outbound allow-list: NICeMail hosts, Pravah, NTP, the Atlas cluster, and NIC SMTP once enabled. Remote desktop to the app VM only from an admin jump host, for the named operators. | [Recommendation] |
| Secrets and configuration | `backend/.env.production` on the VM only, ACL-restricted, selected by `NODE_ENV=production` in the machine environment (or named by `ENV_FILE`); never a `.env.local` on the VM. Per-account passwords via `QMS_PASSWORDS_FILE` (a protected file) or `QMS_PASSWORD_<ID>`. Strong unique `JWT_SECRET`. No secrets in the repository, and nothing secret on Render. Every variable: [docs/ENVIRONMENT.md](ENVIRONMENT.md). | [Verified] `config/env.js`, `credentials.js`, `authConfig.js` |
| Backup | **MongoDB and `ATTACHMENT_DIR` together**, because MongoDB only references the attachment files. **The repository contains no backup tooling.** The Chrome profile should be **protected, not backed up**: after a rebuild, sign in again. | [Verified] |
| Disaster recovery | Rebuild the app VM from a documented runbook, restore MongoDB and attachments, start Chrome, reopen a NICeMail tab, and have the account owner sign in. The SRS does not define RTO or RPO; it lists availability and backup frequency/retention as "to be confirmed", and wrongly says one database backup covers the whole system (Appendix B #11). | [Documented only] `docs/srs/06-non-functional-requirements.md:7, 15` |

### 11.4 Indicative starting sizes [Recommendation] [Assumption — validate in the pilot]

The code and documentation contain no volume figures. These are conservative starting points for a low-to-moderate office workload, **not measured requirements**:

| VM | vCPU | RAM | Disk | Reasoning |
|---|---|---|---|---|
| Application VM (backend + Chrome + proxy) | 4 | 16 GB | 100 GB system + separate attachment disk sized to retention policy | Chrome with the NICeMail web app is the heaviest process; Node is modest. The frontend is on Render (§11.5) |
| MongoDB Atlas (separate production cluster) | – (Atlas tier) | – (Atlas tier) | Storage sized for data growth; Atlas backups | Managed, so there is no database VM to size. Text records are small; attachments live on the app VM, not in MongoDB |

**No GPU on the VM, and none for the database.** Measure CPU, memory and disk during the pilot (Phase 7) — in particular Chrome's CPU and memory with the NICeMail web app loaded and rendering in software — and adjust.

### 11.5 Hosting decision: Render Static Site + application VM

Added 2026-09-25. The frontend is a **Render Static Site**. The backend and the agent's signed-in,
headed Chrome run together on **one application VM** behind HTTPS, and the database is a separate
MongoDB Atlas cluster (§11.3). The backend cannot move to Render: the Browser Agent needs a Chrome
that a person signed in to, on the backend's own host, with CDP on `localhost` and attachments handed
over by local path (Sections 9.2 and 11.2).

```text
Browser (IPC staff)
   │  HTTPS: https://<render-site>, the only origin the browser ever sees
   ▼
Render Static Site ──► dist/ (hashed assets); /* → /index.html (SPA fallback)
   │  /api/* → https://<vm-api-host>/api/*   (Render rewrite)
   ▼
Application VM: reverse proxy (TLS, /api only, inbound 443 from Render's outbound IP ranges only)
   │  http://127.0.0.1:5000
   ▼
IPC-QMS backend (NODE_ENV=production, exactly one instance) ──► MongoDB Atlas (separate production cluster)
   │  CDP http://localhost:9222 (never leaves the VM)
   ▼
Headed Chrome, dedicated profile, signed in to lab.ipc@gov.in by its owner ──► NICeMail (HTTPS)
```

**Render settings.** They live in the Render dashboard only. No `render.yaml` is added: it would put
the VM host name in the repository, and the dashboard stays the single source of truth.

| Setting | Value | Why |
|---|---|---|
| Service type | Static Site | The build output is static files, and the backend does not serve them (no `express.static` in `app.js`) |
| Root directory | `frontend` | |
| Build command | `npm ci && npm run build` | `npm run build:check` also enforces the bundle budget, if that should gate deploys (`frontend/package.json:8-9`) |
| Publish directory | `dist` | Relative to the root directory. If Render does not find it, use `frontend/dist` [Unknown] |
| Environment | `VITE_API_BASE_URL=/api/v1`, `NODE_VERSION=22` | The API base is fixed at build time and is relative, so every call goes to the Render origin. Unset, it silently falls back to `http://localhost:5000/api/v1` (`axiosClient.js:5`) |
| Not set | `NODE_ENV`, `VITE_NIC_FRONT_OFFICE_EMAIL` | `vite` is a devDependency (`frontend/package.json:50`), and `npm ci` skips devDependencies under `NODE_ENV=production`. The second is a development quick-login shortcut, compiled out of builds |
| Redirects / rewrites, in this order | 1. `/api/*` → `https://<vm-api-host>/api/*`, action **Rewrite**<br>2. `/*` → `/index.html`, action **Rewrite** | The API rule must come first. The app uses `BrowserRouter` (`App.jsx:2, 41`), and `frontend/public` has no `_redirects` file |
| Pull-request previews | Off | A preview would be proxied to the production API |

Nothing secret is set on Render. Every `VITE_*` value ends up in the public bundle, and no backend
secret has a `VITE_` name.

**The VM environment** [Recommendation]. Every variable, which values are secret, the production
values and the boot-refusal table are in [docs/ENVIRONMENT.md](ENVIRONMENT.md). The rules below are
about the host, not about any one variable:

- **Set `NODE_ENV=production` machine-wide**, not only on the service. The backend loads exactly one
  env file, and `NODE_ENV=production` in the real environment is what selects `backend/.env.production`;
  operator commands run from a shell (`npm run mailbox:purge`, `npm run db:provision`,
  `npm run nic:browser:discover`) then load the same file. Without it the backend never loads
  `.env.production`: it refuses to start with `(env file: none)` at the end of the error, or, worse,
  starts as development from a stray `.env.local` [Verified] (`config/env.js:12-32`; `server.js:13-19`).
- `ENV_FILE=<path>` in the service environment names the file instead, for example to keep it outside
  the checkout. It is exclusive: nothing else is loaded, and a missing file stops the start. A relative
  name is resolved against `backend\`.
- The env file is ACL-restricted to the service account and administrators. **Never put a `.env.local`
  on the VM.**
- The real environment always wins over the file. At start, dotenv's line
  `injected env (N) from <file>` names the file that was loaded.
- Use absolute paths. `QMS_PASSWORDS_FILE`, `NIC_APP_PASSWORD_FILE` and `NIC_BROWSER_ARTIFACT_DIR` are
  resolved against the working directory. `ATTACHMENT_DIR` is resolved against `backend\`; give it an
  absolute path on the backed-up data disk.

**Same-origin cookie model** [Verified, 2026-09-25]:

- The browser only ever talks to `https://<render-site>`. API calls go to `/api/v1` on that origin, and
  Render forwards them. The session cookie `qms.session` is therefore a first-party, host-only cookie
  on the Render host: HttpOnly, Secure in production, SameSite `lax` (`authConfig.js:7-24`). Leave
  `SESSION_COOKIE_SAMESITE` at its default.
- Attachment URLs are built from the same relative base (`attachmentService.js:4`;
  `mailboxService.js:46`). So the text preview's plain `fetch` sends the cookie, and the PDF preview's
  iframe passes Helmet's default `frame-ancestors 'self'` (`AttachmentViewerDialog.jsx:34, 81`;
  `app.js:19`).
- Serving the frontend and the API from two origins is **not supported**. It needs `SameSite=None`,
  breaks both previews, and fails outright in browsers that block third-party cookies (Safari).
- The browser makes no CORS check on same-origin requests, so `CLIENT_URL` is not load-bearing behind
  the rewrite. Set it to the Render origin anyway (`app.js:20`).

**First-deploy checklist.** These can only be verified on the real deployment:

1. The Render settings match the table above. The build log shows Node 22 and `vite build`, and
   `NODE_ENV` is unset.
2. `curl -sI https://<render-site>/some/deep/route` returns 200 `text/html`. A hashed `/assets/*.js`
   file returns a JavaScript content type, not `index.html`.
3. `curl -s https://<render-site>/api/v1/auth/me` returns 401 (`Authentication required`) from the VM,
   which proves the rewrite reaches the backend.
4. **Set-Cookie passes through.** Signing in sets `qms.session` (HttpOnly; Secure; SameSite=Lax) on the
   Render host, and `/auth/me` returns 200 after a reload.
5. Query strings and bodies survive the rewrite: `?download=1` on an attachment gives
   `Content-Disposition: attachment`, audit filters work, and POSTs succeed.
6. Text and PDF attachment previews render.
7. **Rewrite timeout for long sends.** An Accept or final approval that takes more than 60 s completes
   without a 502 or 504. Record the observed limit: Render does not document one [Unknown], and after a
   gateway timeout the send carries on in the backend (Section 4, Timing).
8. **No caching of `/api`.** The backend sets no `Cache-Control`, so the VM proxy adds
   `Cache-Control: no-store` on `/api/*`. Confirm the header arrives, and that two users each get their
   own `/auth/me`.
9. **`trust proxy` hop count.** The backend trusts one hop (`app.js:15-17`), but Render plus the VM
   proxy is two. Check the address the VM's request log records for a sign-in (morgan's `combined`
   format logs `req.ip`). If it is a Render address, every user shares the login limit (10 failures per
   15 minutes) and the API limit (600 per minute). The follow-up is a code change to
   `app.set('trust proxy', 2)` once the `X-Forwarded-For` chain is confirmed.
10. `POST /api/v1/auth/dev-login` returns 404, and the start-up banner shows `(production)`, the agent
    on and the guard closed.
11. `/api/v1/health` is not served on the host Render proxies to, only on an internal vhost or port
    (Section 13 #12).
12. **Inbound 443 on the VM accepts only Render's published outbound IP ranges**, and ports 5000 and
    9222 are unreachable from any other machine.
13. Pull-request previews are off.

**Accepted risks** [Recommendation]:

- **The API host is reachable from the internet.** The VM's API vhost must accept HTTPS from Render with
  a publicly trusted certificate, yet the server's own start-up warning says not to expose it outside a
  trusted network, because there is no server-side workflow state machine (`server.js:73-78`;
  Section 13 #15). Limiting inbound 443 to Render's outbound ranges narrows who can connect, but every
  Render customer shares those ranges, so it is not authentication. Accepted for the first release,
  together with the rate limits and the `/api/v1/health` rule.
- **Staff traffic passes through Render.** Every API request and response, including enquiry text and
  the session cookie, crosses Render's proxy. Whether that meets IPC's data-protection and residency
  rules must be confirmed [Unknown].
- **Until the hop count is confirmed,** the rate limiters may key on Render's address and be shared by
  all staff (checklist item 9).
- **Render's rewrite timeout is undocumented** [Unknown]. A long send can end in a gateway error for the
  user while it completes on the VM (checklist item 7).

---

<a id="12-nicemail-authentication-strategy"></a>
## 12. NICeMail authentication strategy (lab.ipc@gov.in)

**Principle:** The Browser Agent must **never** hold NICeMail credentials, automate the login, or bypass MFA/OTP. The code already follows this: it has no credential variable and no login automation, and it refuses to work on a signed-out session. [Verified] (`browserConfig.js:8-11`; `attach.js:4-11`; `session.js:19-22`)

### 12.1 Compliant operating model [Recommendation]

| Stage | Procedure |
|---|---|
| **Account ownership** | `lab.ipc@gov.in` has a named **account owner** (IPC) who holds the MFA/OTP device, plus at least one named deputy. Only they may sign the agent's browser in. |
| **Initial authentication** | The owner logs on to the application VM (from the admin jump host), opens the dedicated Chrome (already started with the agent flags), signs in to NICeMail **by hand** including any MFA/OTP step, and leaves the NICeMail tab open. Then runs `npm run nic:browser:discover` from `backend\` (read-only check; the scripts load the same env file as the backend, `backend/.env.production` on the VM). **Calibrate only on first setup or after a NICeMail UI change**, with the backend stopped or idle: `npm run nic:browser:calibrate` types a draft into the live mailbox and discards it (nothing is sent), and runs in its own process with its own queue (`scripts/nicBrowserCalibrate.js:23-25`; `session.js:27`). |
| **Persistent profile** | The dedicated profile directory keeps the session across Chrome restarts, **if NICeMail's session cookies allow it** [Unknown]. The directory is readable only by the agent account and administrators; it holds a live session, so it is as sensitive as the password. |
| **Session expiry** | Expiry is detected as `SESSION_EXPIRED` / `NOT_AUTHENTICATED`, or as a generic readiness timeout if NICeMail shows some other sign-in page (Section 9.3). All sends fail safely before Send and ingestion pauses. The owner signs in again — but note that **no dependable expiry alert exists today** (Section 15.2): the scheduled discover check both false-alarms and can miss, so until the readiness endpoint is built, treat a run of failed sends or syncs as the signal. |
| **Re-authentication** | Sign in by hand, then run `nic:browser:discover`. No calibration is needed for a routine sign-in. Afterwards, check the IPC Mailbox sync status and any `FAILED` / `UNCERTAIN` sends on the Dispatch and case pages. |
| **Browser restart** | Chrome is restarted with the same flags and profile, and a NICeMail tab is reopened. If the session did not survive, re-authenticate. |
| **Credential handling** | The NICeMail account password and OTP device are **never** stored on the server, in `.env`, or in IPC-QMS. If NIC SMTP is adopted for the OIC forward (Section 17.2), its application-specific password is kept only in a protected `NIC_APP_PASSWORD_FILE` (`services/email/nic/credentials.js:42-62`). |
| **Access restrictions** | Interactive logon to the app VM is limited to the owner, the deputy and administrators. CDP (9222) is never reachable from the network. The VM screen is locked when unattended, and the logon session stays signed in. |
| **Auditability** | IPC-QMS records every send with the acting user, case, outcome and provider message id (audit trail plus outbound ledger). The NICeMail Sent folder is the external record. Sign-ins should be recorded in an operations log (who, when, why). NICeMail's own sign-in logs are held by NIC [Unknown]. |

### 12.2 Must be confirmed with NIC / IT administration before production

1. **Policy permission:** Is automated, browser-driven use of a NICeMail account (a program sending and reading mail through a human-authenticated session) permitted under NIC's acceptable-use and security policy for government mailboxes?
2. **Platform:** Is `lab.ipc@gov.in` hosted on the same NICeMail (Zoho / mgovcloud) platform and web addresses as the test account?
3. **MFA method and session lifetime:** Whether MFA applies to `lab.ipc@gov.in` at all (the repository cannot show this [Unknown]), which method (OTP to a phone, app, token), how long a web session lasts, and whether "remember this device" is allowed on a server-hosted browser.
4. **Service-account model:** Can a shared departmental mailbox be operated by a named owner plus deputy, and who is accountable?
5. **Rate and volume limits:** Any sending limits or abuse detection on NICeMail web sending.
6. **Network access:** Firewall permission from the application VM to the NICeMail web hosts.
7. **Alternative channel:** Status of the NICeMail application-specific password (IMAP/SMTP) that the project documentation lists as pending. This affects the OIC forward (Section 17).
8. **Display name and signature:** How the account's sender name appears to inquirers.
9. **UI language:** The account's NICeMail interface must stay in English; the agent recognises controls by their English names (Section 9.3).

---

<a id="13-security-audit"></a>
## 13. Security audit

| # | Area | Finding | Severity | Recommendation |
|---|---|---|---|---|
| 1 | **CDP (port 9222)** | No authentication, no TLS. Whoever reaches it gets **full control of the signed-in browser**: every cookie of the lab.ipc session (which bypasses MFA), reading and sending as the official mailbox, and any other site in that profile. Defaults to localhost, but the code does not enforce that. [Verified] `browserConfig.js:24`, `cdp.js:77-100` | **Critical** if exposed | **Never expose CDP.** Localhost only; host firewall blocks 9222 inbound; no port forwarding; the app VM is not shared with other users or workloads; the endpoint must stay `http://localhost:9222`. |
| 2 | Chrome profile directory | Contains the live session (equivalent to a signed-in password). Note that Chrome 144+ can turn remote debugging on for an **already-running instance, including the default profile**, from `chrome://inspect` — which would expose that whole profile over the unauthenticated CDP port. [Documented only] (a code comment, `browserConfig.js:16-21`; confirm against Chrome's own documentation) | High | ACL to the agent account only; disk encryption; exclude from general backups; not on shared drives; **only the dedicated profile may ever have remote debugging enabled**, and no personal browsing in it |
| 3 | `NODE_ENV` default | Defaults to **development**, which means:<br>• dev-login signs into any account (except the NICeMail Front Office) without a password<br>• the session cookie is not `Secure`<br>• error responses include stack traces<br>• the database becomes optional<br>• the shared seed-password mode is on whenever `QMS_SEED_PASSWORD` is set<br>[Verified] `env.js:39`, `authController.js:117-155`, `authConfig.js:35, 46-51`, `credentials.js:73-78`, `errorHandler.js:41`, `db.js:13` | **High** if not set | Set `NODE_ENV=production`, and verify dev-login returns 404 |
| 4 | Network binding | The server listens on all interfaces | Medium | Firewall 5000; expose only the reverse proxy |
| 5 | Passwords and accounts | In production every account needs its own credential (bcrypt). The shared seed-password mode is off in production, but **outside production it is on by default whenever `QMS_SEED_PASSWORD` is non-empty** (`credentials.js:73-78`), so set it to `false` explicitly. The user list is **13 hard-coded accounts** in code (plus the NICeMail Front Office); every address is on the unroutable `@ipc.example` domain, so none of them can receive mail [Verified, 2026-09-23]. It is mirrored in `frontend/src/constants/mockUsers.js` (which must stay in step), seeded into the MongoDB `users` collection on every connect with `$setOnInsert` — so rows already seeded are **never refreshed**, and replacing the directory needs a data step on any environment that has booted — and the `active` flag is not read by authentication: disabling an account needs a code change and redeploy, and existing sessions stay valid until they expire. [Verified] `credentials.js`, `constants/users.js:12-19`, `config/db.js:73-92` | High | Replace the development account list (backend and frontend) with real IPC staff accounts before production; unique strong passwords; keep `QMS_ALLOW_SHARED_PASSWORD` unset or `false` |
| 6 | Sessions | JWT in an httpOnly cookie, 8 h default; **no revocation** (a stolen cookie stays valid until expiry) [Verified] | Medium | Keep the TTL short; rotate `JWT_SECRET` to revoke all sessions if needed |
| 7 | Secrets management | Plain env file (`backend/.env.production` on the VM); no secret manager. Every `.env` and `.env.*` file except `.env.example` and `backend/.env.e2e` is git-ignored, and nothing secret is set on Render. | Medium | ACL-restricted `backend/.env.production`; passwords file; no secrets in logs or tickets |
| 8 | Database credentials | The example URL is an Atlas placeholder; production uses a separate Atlas cluster (Section 11.3) with its own user, TLS and IP access list, none of which the repo configures [Unknown] | High | MongoDB authentication, TLS, network restriction |
| 9 | AI API | Enquiry text (possibly containing personal data) is sent to Pravah **with no authentication header**. The `/ai/summary`, `/ai/recommend` and `/ai/draft` routes only check that the user is signed in, so any signed-in staff role can send arbitrary text to Pravah through IPC-QMS. [Verified] `gemmaService.js:170-172`; `routes/aiRoutes.js:7-11`. **Changed 2026-09-24:** mail triage now sends the sender, subject and plain body of every message the deterministic rules could not settle to the same endpoint **automatically**, once an hour, with no person in the loop — so unsolicited mail from the public, not just text a member of staff chose to submit, now leaves the deployment. `GEMMA_API_URL=` blank disables it and triage falls back to GENUINE. [Verified, 2026-09-24] `retention.js#classifyPending`; `gemmaService.js#classifyMail` | Medium | Data-sharing approval; confirm endpoint access controls with Pravah/AICTE; restrict the AI routes to staff roles (code change) |
| 10 | Email addresses and PII | Inquirer addresses, subjects and bodies are stored in MongoDB. Addresses and subjects **appear in application logs**. Retention now covers **all unregistered mail, in two tiers**: body, HTML and attachment bytes are stripped after `MAILBOX_RETENTION_HOURS` (42) for mail judged junk or rejected by a person, and after `MAILBOX_UNREGISTERED_RETENTION_HOURS` (336, two weeks) for anything else nobody registered. An id stub is kept so the message cannot be re-ingested. Every purge writes an `EMAIL_PURGED` audit row naming the sender and subject — so the audit trail deliberately retains the PII the message body loses, and that row is now the long-lived copy. Mail that became a case, and the logs, still have **no retention policy**. [Verified, 2026-09-24] | Medium | Restrict log access; define retention for accepted mail and for logs; include logs and the `EMAIL_PURGED` rows in the data-protection assessment |
| 11 | Attachments | Type, size and checksum checks. Files stored unencrypted on disk; never deleted. Case-scoped access control. [Verified] | Medium | Disk encryption; retention policy; backup |
| 12 | `/api/v1/health` endpoint | Public. Reveals mailbox and AI error text; **always answers "healthy"** even with the database down. It never reports the Browser Agent's sync or session state, so it is **unusable for monitoring the Browser Agent**. [Verified] `healthController.js:15-24` | Low-Medium | Restrict to internal monitoring with an explicit **reverse-proxy rule that refuses `/api/v1/health` from the staff network** (the app has no auth on it, and §11.1 otherwise proxies all of `/api`); do not rely on it as a readiness probe |
| 13 | Destructive and test endpoints | Revised 2026-09-23 — the three are **no longer equivalent**:<br>• `POST /mailbox/receive` and `DELETE /mailbox` now **refuse with 409 when `NODE_ENV=production`** (`controllers/mailboxController.js`, `refuseInProduction`). Both are test fixtures and neither can run against a production deployment.<br>• **`POST /queries/reset` still has no production guard**, and it is the most destructive of the three: it deletes all cases and case audit rows, **the outbound ledger and all email messages** — removing the at-most-once protection — then inserts cases and history supplied by the caller (`queryRoutes.js`; `queryController.js`). Super Admin is the whole of its protection.<br>[Verified, 2026-09-23] | High | Production-guard `POST /queries/reset` before go-live (code change); restrict Super Admin accounts |
| 14 | Access control | Role checks on the workflow, mailbox, NIC, audit and admin routes (fail-closed and audited). The AI routes are open to every signed-in user (#9). Case routes (`GET /queries`, `/queries/persist`) and every attachment route are **case-scoped**: the Assigned Official and the Reviewer see only the cases they are party to, four roles see everything, and any other role sees none. All three guards answer 503 rather than passing when the store is unreachable. [Verified, 2026-09-23] `verifyRole.js`, `caseAccess.js`, `authorizeCaseDelta.js`, `authorizeAttachmentAccess.js` | – (in place, with the #9 gap) | Keep; close the AI-route gap |
| 15 | Workflow integrity | Apart from final approval and dispatch (which check the stored state and return 409), the persist route checks only that the role may cause the *target* state. It does not check the source state or reviewer step ownership, so review can be skipped (Section 7). The server's own start-up warning says not to expose it outside a trusted network. [Verified] `authorizeCaseDelta.js:103-111`; `finalApproval.js`; `caseMail.js:291` | Medium | Internal network only until a server-side state machine is added |
| 16 | Upload authorization | The attachment access check runs before the multipart body is parsed, so the `queryId` check is skipped for uploads, and the controller then saves the parsed `queryId`. A scoped user can attach a file to another case (write-only; no read exposure). [Verified] `attachmentRoutes.js:9`; `authorizeAttachmentAccess.js:78-83`; `attachmentController.js:73` | Low | Fix in code |
| 17 | Audit logs | Server-side audit trail in MongoDB; actor taken from the session; action names validated. **Not tamper-proof**: the reset operations delete audit rows. [Verified] | Medium | Back up audit data; consider append-only export |
| 18 | Outbound safety | Two-key interlock: NICeMail sends only reach the test recipient until `NIC_ALLOW_OUTBOUND=true`. The state is shown in the start-up banner. [Verified] | – (in place) | Keep `false` until go-live; change control for flipping it |
| 19 | Rate limiting / headers | `helmet` defaults; login limit (10 failures / 15 min) and API limit (600 / min), both in memory [Verified] `app.js` | – (in place) | Adequate for a single instance |
| 20 | Email endpoints while MongoDB is down | The three endpoints fall back to sending without the ledger and without any at-most-once guarantee. `/emails/forward` and `/emails/response` take the subject, body and attachments (and, for the response, the recipient and Cc) **from the request**; `/emails/acknowledgement` takes only the recipient, `queryId` and timestamp and composes the rest server-side. [Verified] `emailController.js:131-200` | Medium | Make them fail closed in production (code change) |

---

<a id="14-scalability"></a>
## 14. Scalability

**No production volumes are recorded in the repository or documentation** [Unknown]: daily incoming emails, number of Front Officers, OICs, officers, reviewers, and peak concurrency. The table below states the architectural limits found in the code and the assumptions to confirm.

| Dimension | What the code imposes | Assessment |
|---|---|---|
| Incoming email | One sync at a time; at most 20 new messages per sync, with at least `NIC_BROWSER_SYNC_TTL_MS` (default 15 s) between the end of one poll-driven sync and the start of the next (15 s for a manual "Sync now", `nicBrowserMailbox.js:252-259`). Throughput is therefore 20 messages per (sync duration + `NIC_BROWSER_SYNC_TTL_MS`) — a formula, not a figure, because sync duration was never measured. Syncs are requested both by the Front Officer's inbox polling and by the server-side timer (`MAILBOX_SYNC_ENABLED`, `MAILBOX_SYNC_INTERVAL_MS`; `mailbox/syncScheduler.js`), so mail is read even when nobody is signed in [Verified] (`nicBrowserMailbox.js:192-196, 217-219`). Only the rows the web app loads are visible (about 50 [Documented only]). | Expected to be adequate for tens of messages per hour [Assumption] — this cannot be stated as a capacity figure until **sync duration is measured** in the pilot (the live test timed only sends, 4.7–6.1 s). Mail beyond the loaded window (about 50 rows) is **never ingested by the agent and nothing raises an alert**; after a burst or a long outage it must be found and handled by hand in NICeMail. |
| Browser Agent concurrency | **Strictly serial**, one job at a time per process. Sends observed at **~4.7–6.1 s** each in testing; a sync can hold the queue for minutes. [Verified] [Live-tested] | One agent handles low-to-moderate volumes. Sends queue behind syncs, and users wait because sends run inside the request. |
| Backend instances | **Must be one.** The browser queue, quarantine state and rate limits live in process memory; a second instance would drive the same NICeMail session concurrently [Verified] | No horizontal scaling without code changes |
| NICeMail rate limits | Not known [Unknown] | Confirm with NIC (Section 12.2) |
| AI concurrency | No cap and no retries. Each call waits up to 12 s (summary), 36 s (recommendation) or ~72 s (draft) [Verified]. Pravah capacity is unknown [Unknown]. | Fine for a small user base; confirm Pravah's limits for peak use |
| Users | Standard Express/MongoDB request handling; pool of 2–20 DB connections; 600 requests/min/IP API limit. Front Office pages poll every 15–30 s, every 3 s during a sync, backing off to 5 min during an outage. [Verified] (`MailboxAutoSync.jsx:7, 16, 85`; `MailboxInboxPage.jsx:61, 881-885`) | Not a constraint at departmental scale [Assumption] |
| Database | Text documents plus audit rows; indexes declared in code; no retention [Verified] | Growth is slow; plan disk for attachments separately |
| Attachments | 10 MB per file, 15 MB per upload, 10 files; buffered in memory during upload [Verified] | Fine for one instance; keep the limits |
| Queue / outbox | The outbound ledger provides at-most-once sending, but **not** queued or asynchronous delivery [Verified] | A background worker with a queue is the recommended next step if volumes grow |

**Is one Browser Agent instance sufficient?** [Recommendation] Yes, for the first release, provided that:
- volumes are low to moderate;
- a Front Officer keeps the NICeMail inbox open during office hours;
- users accept that Accept and final approval wait for the send (typically seconds).

**Plan a dedicated browser-agent worker** (a separate process consuming a job queue, with a server-side sync schedule) if any of these hold:
- incoming volume exceeds what 20 messages per (sync duration + `NIC_BROWSER_SYNC_TTL_MS`) can absorb;
- sends must not block the user interface;
- ingestion must run without a Front Officer signed in.

---

<a id="15-monitoring-and-operations"></a>
## 15. Monitoring and operations

### 15.1 What exists today [Verified]

| Signal | Where |
|---|---|
| Request log (morgan) | stdout |
| Per-send stage log: `ACK / FORWARD / RESPONSE` START → RESOLUTION → NIC BROWSER steps → VERIFICATION → RESULT (status, stage, provider message id, error) | stdout (`sendTrace.js`) |
| Primary mailbox (IMAP) outage begin, end and 5-minute reminders | stdout; audit rows `SYNC_FAILED`, `SYNC_RECOVERED` (`mailbox/health.js:52-75`, fed when a mailbox list call throws) |
| NICeMail browser sync | **Audit rows only** (`details.source='nic-browser'`): `SYNC_FAILED` when a failure run begins and on every failed manual sync, `SYNC_RECOVERED` on recovery, `SYNC_COMPLETED` for every sync that stored or failed a message and for every manual sync — plus the `sync` field of the inbox API. **No stdout line and no reminders.** The browser sync never throws and its list reads MongoDB, so a Chrome or session failure is recorded as a mailbox *success* in the health snapshot (`nicBrowserMailbox.js:137-139, 187-224`). |
| Ledger state per case email (`SENT`, `FAILED`, `UNCERTAIN`, attempts, last error with stage) | MongoDB `outboundemails`; shown on the case and Dispatch pages |
| `GET /api/v1/health` | database connected flag, primary-mailbox health, AI last success, failure and error. **Always HTTP 200 "healthy"; never checks Chrome, CDP or the NICeMail browser sync.** |
| Start-up banner | transport, mailbox, NICeMail agent status, outbound guard state, process id |
| Diagnostics tools | `npm run nic:browser:discover` (read-only; exit code 1 on failure), `npm run nic:browser:calibrate` (compose dry run, never sends) |

**Missing:** metrics, alerting, log files and rotation, a real readiness probe, and a Browser Agent or CDP health check. The server-side sync scheduler now exists (`syncScheduler.js`), though its state is visible only through the `sync` field on a mailbox list response.

### 15.2 Recommended monitoring and alerts [Recommendation]

| Monitor | How (with the current code) | Alert when |
|---|---|---|
| Backend up | HTTP check on `/api/v1/health` via the proxy (internal only) | Unreachable for 2 minutes |
| Database | `/api/v1/health` → `database.connected`, plus MongoDB's own monitoring | `false`, or MongoDB alerts |
| Chrome process | OS process check for the dedicated Chrome | Process missing |
| CDP reachable | Local check of `http://localhost:9222/json/version` from the VM | Not answering |
| NICeMail session | Scheduled read-only `npm run nic:browser:discover`, run from `backend\` **without** `--agent-tab` (a non-zero exit code means failure: signed out, no tab, UI drift). Expect false alarms when the operator's tab is not showing a mail list, and note that a WARN verdict exits 0. Run calibrate only in a maintenance window with the backend idle or stopped. | Non-zero exit |
| Mailbox sync health | `SYNC_FAILED` / `SYNC_RECOVERED` audit rows with `details.source='nic-browser'`, plus the scheduled discover check. **`/api/v1/health` does not reflect the NICeMail sync** (it reports the primary store only). | `SYNC_FAILED` with no `SYNC_RECOVERED` for more than 10 minutes during office hours |
| Failed sends | `outboundemails` with status `FAILED` | Any, older than 15 minutes |
| **UNCERTAIN sends** | `outboundemails` with status `UNCERTAIN` | **Any** (needs a person the same day) |
| Stuck sends | `outboundemails` with status `SENDING` older than 5 minutes (a crash mid-send) | Any |
| Outbox backlog | Cases in `READY_FOR_DISPATCH` older than 1 hour | Any |
| AI failures and latency | `/api/v1/health` → `ai.lastFailureAt` / `ai.lastError`, and the `[Gemma AI]` log lines. Audit `aiMetadata.fallback` misses **recommendation** fallbacks (they carry no fallback flag and are recorded as model-generated) until the labelling is fixed (`gemmaService.js:206-252`; `aiController.js:20, 34-35`). | Fallback rate high; latency near the timeouts |
| Host resources | CPU, memory (Chrome), disk (attachments, logs, MongoDB) | Standard thresholds |
| Time sync | NTP offset | More than 2 s (sends need less than 10 s) |
| Session expiry | **Partially covered only.** The discover check above is the only signal, and it both false-alarms (operator tab not on a mail list) and can miss (a WARN verdict exits 0; an unrecognised sign-in page surfaces as a generic readiness timeout, Section 9.3). A dependable alert needs the readiness endpoint from Phase 0 item 5 (code change). | Notify the account owner immediately; treat a run of failed sends or syncs as the backstop |

**Operational logs:** keep application logs (rotated, access-restricted, retention agreed); an **operator log** of NICeMail sign-ins and recalibrations; and a daily review of `UNCERTAIN` / `FAILED` sends (read from the `outboundemails` collection and the Dispatch and case pages). **None of these needs a code change:** they only read existing logs, database collections, pages or scripts.

---

<a id="16-phased-deployment-strategy"></a>
## 16. Phased deployment strategy

### Phase 0 — Decisions and required changes (items 2, 3, 4 and 6 before any production deployment; item 5 as far as the pilot needs it)

Revised 2026-09-23. The original item 1 — decide and build the OIC-forward channel — is **done**: the
forward follows the case mailbox, and Gmail is removed. It is replaced by the calibration it made
load-bearing.

1. **Calibrate the attach control** (`npm run nic:browser:calibrate -- --attach` against the production
   account, then remove `ccToggle`, `attachmentEntry` and `listRowAttachment` from `UNCALIBRATED`).
   The forward now carries attachments through the agent, so until this is done every accept of an
   enquiry with an attachment fails at the forward. **Blocker for go-live, not just for a pilot.**
2. Decide the **primary-mailbox model**: with NICeMail as the only external channel, what
   `FRONT_OFFICE_EMAIL` / `MAILBOX_SOURCE` mean. The code requires `NIC_EMAIL ≠ FRONT_OFFICE_EMAIL`.
   Note that production also refuses `EMAIL_TRANSPORT=mock`, so a real value must be chosen for the
   cases that do not arrive through the agent.
3. Replace development data:
   - the hard-coded user directory (13 accounts) **together with its frontend mirror**
     `frontend/src/constants/mockUsers.js`. No personal addresses remain — every seeded address is on
     `@ipc.example` and cannot receive mail — but they are still **not real staff accounts**. The dev
     users are seeded into the MongoDB `users` collection on every connect with `$setOnInsert`
     (`config/db.js`), so **existing rows are never updated**: an environment that has already booted
     needs a data clean-up as well as the code change. Nothing enforces that the backend and frontend
     directories agree; keep them in step by hand.
   - the 6 development officials, in `officialsMetadata.js` **and** in the prompt text
     (`gemmaService.js`).
4. Production-guard or remove **`POST /queries/reset`** — `DELETE /mailbox` and `POST /mailbox/receive`
   are now guarded (§13 item 13); make the email retry endpoints fail closed when MongoDB is down; fix
   the AI audit labelling (recommendation fallbacks and "AI generated" fallback drafts); restrict the
   AI routes to staff roles.
5. Code hardening:
   - **a real readiness endpoint that exposes the Browser Agent's session and sync state** — needed before go-live if session expiry is to be alerted dependably (Section 15.2); the rest of this list is recommended, not required;
   - an account check on reads;
   - a sweeper for stuck `SENDING` rows;
   - a health endpoint that reports the Browser Agent's sync state;
   - Node version pinned (`engines`).
6. Obtain the NIC/IT confirmations in Section 12.2, and the AI data-sharing approval.

### Phase 1 — Infrastructure preparation
- Provision the **application VM** (Windows, desktop experience), a **separate production MongoDB Atlas cluster**, and the **Render Static Site** (§11.5). No GPU.
- Network:
  - allow outbound to the NICeMail hosts, Pravah, NTP and the Atlas cluster; NIC SMTP only once the app password is issued;
  - allow inbound 443 on the VM API host from Render's published outbound IP ranges only;
  - block inbound 9222 and 5000;
  - reverse proxy with a publicly trusted TLS certificate, a read timeout of at least 5 minutes, `Cache-Control: no-store` on `/api`, and `/api/v1/health` served only on an internal vhost or port, not on the host Render proxies to;
  - admin jump host for remote desktop.
- MongoDB with authentication and TLS; a backup job for **MongoDB + attachment directory**; a restore test.
- NTP on all servers.

### Phase 2 — Browser Agent server setup
- Install Google Chrome. Create the dedicated agent Windows account and the profile directory, ACL-restricted. Plan to run the backend under the **same** account (Section 11.3).
- A startup task that launches Chrome with `--remote-debugging-port=9222 --user-data-dir=<profile>`.
- Keep the interactive session alive (screen lock, not sign-out). Disable Chrome memory saver for the agent.
- Verify `http://localhost:9222/json/version` locally, and that it is **not** reachable from another machine.

### Phase 3 — NICeMail production account setup
- The account owner signs in to `lab.ipc@gov.in` by hand (MFA).
- Run `nic:browser:discover` and then `nic:browser:calibrate` (from `backend\`). Confirm the platform and URLs, the compose controls, the survey and follow-up prompts, and the Sent folder. Calibrate only **writes a report**: any difference on `lab.ipc@gov.in` requires a `selectors.js` change, a test run and a redeploy before Phase 4 (`scripts/nicBrowserCalibrate.js:443-450`; `selectors.js:26-27, 586-596`).
- Decide how to handle mail already in the inbox (Section 2.2).

### Phase 4 — Application deployment
- Node.js 22 LTS. Backend with `NODE_ENV=production`, per-account passwords, a strong `JWT_SECRET`, `CLIENT_URL`, and `ATTACHMENT_DIR` on the data disk. Set **every** one of these explicitly, because the defaults are wrong for production:
  - `NIC_BROWSER_MAILBOX=true` — without it the agent is off (`browserConfig.js:42-44`; `server.js:71`);
  - `NIC_EMAIL=lab.ipc@gov.in`;
  - **`NIC_ALLOW_OUTBOUND=false`** and `NIC_BROWSER_TEST_RECIPIENT` set to an IPC test inbox;
  - `EMAIL_TRANSPORT=nic` — it defaults to `mock`, which production refuses even with the agent on; `nic` then requires `NIC_IMAP_HOST` and `NIC_SMTP_HOST` to be non-empty, although nothing connects to them at boot and no app password is needed (`env.js:43, 78-106`; `nicConfig.js:39-44`). Keep `MAILBOX_SOURCE=auto`: `nic` would read the primary inbox over IMAP, which needs the app password;
  - `OFFICER_IN_CHARGE_EMAIL` and `FRONT_OFFICE_EMAIL` — they default to `@example.com` placeholders (`config/identities.js:6-15`);
  - the NICeMail Front Office credential `QMS_PASSWORD_USR_0014` (or the passwords file) — boot fails without it (`authConfig.js:42-52`; `constants/users.js:19-33`).
- The full variable list, with the production values: [docs/ENVIRONMENT.md](ENVIRONMENT.md).
- Frontend: Render Static Site, built with `VITE_API_BASE_URL=/api/v1` and `/api/*` rewritten to the VM (§11.5). Run the §11.5 first-deploy checklist.
- Process manager with auto-restart, **working directory `backend\`**, `NODE_ENV=production` set in the machine environment so that the backend and operator scripts load `backend/.env.production` (§11.5), running under the agent's Windows account (or with read access to the backend's temp folder, Section 11.3); log capture and rotation. Check the start-up banner: agent on, guard **closed**.

### Phase 5 — AI service validation
- Confirm the Pravah endpoint is reachable from the VM, its latency, and its behaviour under the timeouts (summary 12 s, recommendation 36 s, draft ~72 s). Check fallback behaviour when unreachable.
- Confirm data-sharing approval. If an on-premise model is required, this phase becomes a separate project needing a GPU server.

### Phase 6 — Controlled testing (interlock closed)
- End-to-end with the test inquirer only: sync, Accept (acknowledgement, forward, summary), recommendation, assignment, draft, review loop, final approval, dispatch.
- **Note the interlock's reach:** both NICeMail transports (Browser Agent and NIC SMTP) use the same single-recipient interlock (`outboundGuard.js:14, 24-34`; `nicTransport.js:27, 39-51`). Once the OIC forward moves to either, it is refused unless the OIC address is the test recipient, so set the OIC address to the test recipient during this phase.
- Check each run for:
  - `ACK` / `RESPONSE` `RESULT SENT` in the log;
  - the Sent-folder id recorded;
  - a repeat returning `ALREADY_SENT`.
- Fault drills:
  - close Chrome;
  - sign out of NICeMail;
  - block NICeMail;
  - block Pravah;
  - restart the backend during a send.

  Confirm the documented recovery for each.
- Backup and restore drill. Security checks: CDP not reachable remotely; dev-login returns 404.

### Phase 7 — Pilot production
- Open the interlock (`NIC_ALLOW_OUTBOUND=true`) under change control, for a limited period. It is all-or-nothing for external recipients — one test recipient, or any recipient — so a **subset** of real enquiries can only be enforced procedurally (`outboundGuard.js`). Before that point, `NIC_ALLOW_INTERNAL_FORWARD=true` lets the whole workflow run with only the Officer-in-Charge additionally reachable, which is the right posture for controlled testing.
- Daily review of `UNCERTAIN` / `FAILED` sends; measure volumes, resource use (Chrome CPU and memory in particular), sync duration, AI latency and session lifetime. Treat the Section 11.4 sizes as confirmed only once these are measured.
- There is no longer a migration fallback to a second provider (Section 17). A failure in the pilot means stopping and fixing, not switching back.

### Phase 8 — Full production rollout
- All Front Office intake through `lab.ipc@gov.in`. Gmail is already removed (Section 17); what this phase gates is the switch of `NIC_EMAIL` and the Chrome sign-in to the production account, together, with the backend stopped (Section 2.2).
- Staff training: Front Office (UNCERTAIN resolution — now the only way an uncertain send is ever settled), account owner (re-authentication), administrators.

### Phase 9 — Monitoring and support
- Alerts in Section 15 in place and routed to named people.
- Runbooks: re-authentication, Chrome restart, recalibration after NICeMail UI changes, resolving UNCERTAIN sends, backup and restore.
- Periodic `discover` / `calibrate` checks, especially after NICeMail announcements.

---

## 17. Gmail removal — completed

Revised 2026-09-23. This section was a plan. It is now a record: the original Section 17 described
where Gmail was used, what had to change before it could go, and the risks of removing it. All of
that was carried out on branch `abhi-clean` between 2026-09-22 and 2026-09-23.

### 17.1 What was removed [Verified, 2026-09-23]

| Removed | Was |
|---|---|
| `transports/gmailTransport.js` | the outbound transport, and the only Sent-folder reconciliation of uncertain sends |
| `mailbox/gmailInboxReader.js` | the primary-mailbox reader under `MAILBOX_SOURCE=gmail` |
| `scripts/gmailPreflight.js`, `npm run gmail:preflight` | the per-identity OAuth check |
| `googleapis` | the dependency, from `package.json` and the lockfile |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, `GMAIL_REFRESH_TOKEN_*` | configuration, from `.env.example` and `.env` |
| `gmail` as a value of `EMAIL_TRANSPORT` and `MAILBOX_SOURCE` | now refused at boot, by name |
| `POST /emails/enquiry`, the Inquirer dashboard, the compose page, the `INQUIRER` role | the in-app enquiry portal, in both packages |
| Three personal Gmail addresses | in the seeded directory, its frontend mirror, and `.env.e2e` |

### 17.2 How the blocker was resolved

The original report gave two options for the forward to the Officer-in-Charge and recommended (b),
NIC SMTP, as the first step. **Option (a) was taken instead**: `forwardToOfficerInCharge` now receives
the case's `sourceMailbox` and routes on it exactly as the other two emails do, so a NICeMail case's
forward goes through the browser session.

The report's stated drawbacks of (a) were correct and are now live risks rather than hypotheses. They
are ranked #1 and #2 in Section 9.5:

- the forward is the **one case email that carries attachments**, so the agent's attach path is on the
  critical path of every case with a document — and it is still uncalibrated;
- one NICeMail session outage stops all three emails together, where before the forward had an
  independent channel.

Option (b) remains worth completing for a different reason: `EMAIL_TRANSPORT=nic` is what serves cases
that did **not** arrive through the agent, and production refuses `mock`. The application password is
still outstanding (Section 12.2).

A new interlock key was added with the change. `NIC_ALLOW_INTERNAL_FORWARD=true` opens exactly
`OFFICER_IN_CHARGE_EMAIL` while `NIC_ALLOW_OUTBOUND` is closed, for the forward alone, with the
address re-derived server-side. Without it, moving the forward onto the browser would have made intake
stop at the forward during every controlled test — the forward used to escape the interlock entirely,
which was itself a defect.

### 17.3 The one residual action, for an operator

**Revoke the Gmail refresh token.** Deleting the line from `.env` does not invalidate it: the value
was in plaintext on a developer's disk and in shell history. Revoke it at
`myaccount.google.com/permissions`, and delete the OAuth client in Google Cloud Console if it was
created for this project.

`git log --all -S` confirms the token was **never committed** to this repository, so no history rewrite
is needed [Verified, 2026-09-23].

<a id="18-production-readiness-checklist"></a>
## 18. Production readiness checklist

Statuses are based **only** on what the repository and the controlled live test show:

| Status | Meaning |
|---|---|
| **READY** | Evidence in the code, tests or live test that it works as production needs |
| **PARTIALLY READY** | Exists, but with gaps listed |
| **REQUIRES VALIDATION** | Present or configurable; must be confirmed in the target environment |
| **BLOCKED** | Missing, or needs a code change or decision, before production |
| **UNKNOWN** | Cannot be determined from the repository |

| Area | Item | Status | Evidence / gap |
|---|---|---|---|
| Infrastructure | No GPU required anywhere in IPC-QMS | **READY** | Section 10; dependency and source scan |
| Infrastructure | Application and database servers provisioned | **UNKNOWN** | Nothing in the repository |
| Infrastructure | Deployment automation (Docker, IaC, service definitions) | **BLOCKED** | None in the repository; to be created or documented |
| Infrastructure | Reverse proxy + TLS | **UNKNOWN** | Expected by the app (plain HTTP, trusts the proxy in production); not provided |
| Infrastructure | Time synchronisation (NTP) | **REQUIRES VALIDATION** | Mandatory for send confirmation (Section 9.3) |
| Browser | Chrome launch procedure | **PARTIALLY READY** | Workstation runbook exists (`docs/NIC_BROWSER_AGENT.md`); no server runbook |
| Browser | Chrome supervision and auto-restart | **BLOCKED** | Nothing starts, watches or restarts Chrome |
| Browser | Interactive desktop session on the server | **REQUIRES VALIDATION** | Only tested on a Windows workstation |
| Browser | Unattended / headless operation | **BLOCKED** | Requires a person to sign in interactively (hence a desktop session); no code requires a headed browser |
| NICeMail account | `lab.ipc@gov.in` configuration (`NIC_EMAIL` etc.) | **REQUIRES VALIDATION** | Configuration-only change; not yet done (Section 2.2) |
| NICeMail account | Same platform / URLs as the test account | **UNKNOWN** | Confirm with NIC; verify with `nic:browser:discover` |
| NICeMail account | Compose / send controls calibrated | **READY** (test account) · **REQUIRES VALIDATION** (lab.ipc) | Calibrated and live-tested 2026-09-22 on the test account |
| NICeMail account | Reading attachments of received mail; Cc toggle | **PARTIALLY READY** | 3 selector keys uncalibrated (`selectors.js:315-322`). The reader uses them directly: a miss silently stores the message with **no attachments**, and an attachment that fails policy or download is stored as `attachmentId: null`, which makes the OIC forward for that case fail permanently (`readInbox.js:180-213, 383-422`; `resolveAttachments.js:26-37`) |
| Authentication | No automated login; MFA by a person | **READY** | By design (`attach.js`, `browserConfig.js`) |
| Authentication | Session lifetime and re-authentication process | **UNKNOWN** | NICeMail session lifetime not known; process proposed in Section 12 |
| Authentication | Named account owner and deputy | **UNKNOWN** | Organisational decision |
| Authentication | NIC policy approval for automated browser use | **UNKNOWN** | Must be confirmed (Section 12.2 #1) |
| CDP | Bound to localhost | **REQUIRES VALIDATION** | `browserConfig.js:24` is only the *client's* default endpoint. What CDP binds to depends on Chrome's launch flags (no `--remote-debugging-address`) and the host firewall |
| CDP | Not reachable from the network (firewall) | **REQUIRES VALIDATION** | The code does not enforce or check localhost; host firewall needed |
| Backend | Automated tests (990) and lint | **READY** | Run and passing at `438997e`, and at each of the 16 commits from `f07fac5` through `438997e` inclusive (`git log f07fac5^..438997e`) |
| Backend | Production mode (`NODE_ENV=production`, dev-login off, secure cookies) | **REQUIRES VALIDATION** | Defaults to development (Section 13 #3) |
| Backend | Production user accounts and passwords | **BLOCKED** | User directory is development data (13 hard-coded accounts, some on personal Gmail) |
| Backend | Single-instance operation | **PARTIALLY READY** | Required by the design (in-memory queue); must be enforced operationally |
| Backend | Destructive and test endpoints guarded (`POST /queries/reset`, `DELETE /mailbox`, `POST /mailbox/receive`) | **BLOCKED** | No production guard (code change). Reset also deletes the outbound ledger, removing at-most-once protection |
| Backend | Health / readiness check | **PARTIALLY READY** | `/api/v1/health` exists but always returns "healthy" and never checks Chrome, CDP or the NICeMail sync |
| Backend | Email endpoints fail closed without MongoDB | **BLOCKED** | The retry endpoints fall back to unguarded sends (`emailController.js:131-200`) |
| Frontend | Automated tests (839), lint, production build | **READY** | All passing at `438997e` |
| Frontend | Production API URL (`VITE_API_BASE_URL`) | **REQUIRES VALIDATION** | `/api/v1`, set in the Render build environment and reached through the Render `/api/*` rewrite (§11.5); confirm at first deploy |
| Frontend | Hosting with SPA fallback | **REQUIRES VALIDATION** | Render Static Site with the `/* → /index.html` rewrite (§11.5); the settings live in the Render dashboard, not the repository |
| Database | MongoDB integration, indexes, idempotency keys | **READY** | `db.js`; unique ledger and message keys |
| Database | Production MongoDB with authentication and TLS | **UNKNOWN** | Not in the repository |
| AI services | Integration with timeouts and deterministic fallbacks | **READY** | `gemmaService.js`; never *fails* Accept (Accept does wait up to 12 s for the summary) |
| AI services | AI routes restricted to staff roles | **BLOCKED** | `/ai/*` accepts any signed-in user, including Inquirer (`routes/aiRoutes.js:7-11`) |
| AI services | Pravah reachable from the production network | **UNKNOWN** | Validate in Phase 5 |
| AI services | Approval to send enquiry text to Pravah | **UNKNOWN** | Policy decision |
| AI services | Production officials directory in the recommendation | **BLOCKED** | 6 hard-coded development officials |
| AI services | Accurate AI audit labels | **PARTIALLY READY** | Fallbacks labelled as model output (Sections 5–6) |
| Security | Role-based access and case-level scoping | **READY** | `verifyRole.js`, `caseAccess.js`, `authorizeCaseDelta.js` |
| Security | Server-side workflow state machine | **PARTIALLY READY** | Destination-state and scope checks only. The scope half is now real per-case membership on the persist route and on every attachment (§13 item 14); the source-state half is still client-side |
| Security | Secrets management | **PARTIALLY READY** | `backend/.env.production` only; must be protected on the VM. Nothing secret is set on Render |
| Security | Personal data in logs: access and retention | **REQUIRES VALIDATION** | Logs contain addresses and subjects |
| Monitoring | Logs and stage traces | **PARTIALLY READY** | stdout only; no files or rotation |
| Monitoring | Alerting (session expiry, UNCERTAIN sends, Chrome down) | **BLOCKED** | None exists (Section 15.2) |
| Backup | MongoDB + attachments backup and restore | **BLOCKED** | No backup tooling in the repository |
| Recovery | Error handling on Chrome / NICeMail / AI failure | **READY** | Stage-named errors; nothing sent on pre-Send failure |
| Recovery | Disaster-recovery runbook, RTO/RPO | **UNKNOWN** | Not defined: the SRS never mentions RTO or RPO, and leaves availability and backup frequency/retention "to be confirmed" |
| Email sending | Acknowledgement and final response via NICeMail, with Sent-folder verification | **READY** (test account) · **REQUIRES VALIDATION** (lab.ipc) | Live-tested 2026-09-22 on the test account (4 test-inquirer cases and 1 real-inquirer case); delivery into recipients' inboxes was not independently checked, and the selectors must be re-confirmed on `lab.ipc@gov.in` (Phase 3) |
| Email sending | OIC forward without Gmail | **READY** (test account) · **REQUIRES VALIDATION** (attachments) | Routed through the Browser Agent with the other two emails (Section 17.2). **The attach control is uncalibrated**, so a forward carrying a document fails until `nic:browser:calibrate -- --attach` has been run — a go-live blocker in its own right |
| Email sending | Outbound for cases that did not arrive through the agent | **BLOCKED** | Uses `EMAIL_TRANSPORT`, and production refuses `mock`, so this needs `nic` and the application password (Section 12.2) |
| Email sending | Outbound safety interlock | **READY** | `outboundGuard.js`; shown in the start-up banner |
| Idempotency | At-most-once per email per case | **READY** | Outbound ledger; repeats return `ALREADY_SENT` (live-tested) |
| Idempotency | Resolution of UNCERTAIN sends | **PARTIALLY READY** | Manual resolve on the Dispatch and case pages. **No channel checks its own Sent folder** any more, so every uncertain send waits for a person and nothing raises one that has been waiting — needs an owner and a target time before go-live |
| Idempotency | Recovery of sends interrupted by a crash | **PARTIALLY READY** | Surfaces only when retried after lease expiry; no sweeper |
| Testing | Controlled live end-to-end with the test account | **READY** | 2026-09-22 |
| Testing | Browser E2E suite (Playwright) | **READY** | `backend/.env.e2e` rewritten to mock mail, unroutable addresses and every NIC_* variable pinned blank so nothing is inherited from a developer's `.env`. 11 tests across 4 specs pass [Verified, 2026-09-23] |
| Testing | CI | **PARTIALLY READY** | Lint + unit tests on pull requests and pushes to `main` (`.github/workflows/test.yml:19-22`); no E2E or build check |
| UAT | User acceptance testing with IPC roles | **REQUIRES VALIDATION** | Not started (Phases 6–7) |
| Production configuration | Configuration reference ([docs/ENVIRONMENT.md](ENVIRONMENT.md), with `backend/.env.example` as the template) | **READY** | Every variable the code reads is documented in the reference, together with the production values for the VM and the boot-refusal table. `.env.example` ships an empty `JWT_SECRET`, so a copied example refuses to boot |
| Production configuration | NICeMail account-switch procedure | **PARTIALLY READY** | Defined in Section 2.2; to be rehearsed |
| Rollback | Code rollback (redeploy the previous commit) | **REQUIRES VALIDATION** | Clean commit history; no data migrations. Indexes are re-synced from code at start-up: `syncIndexes` **drops indexes not declared in the code**, and a failed build only logs a warning while start-up continues, so check index state after a rollback (`db.js:64-70`) |
---

<a id="19-management-summary"></a>
## 19. Management summary

**1. Can IPC-QMS run on CPU servers?**
**Yes.** Every part of IPC-QMS runs on standard CPU virtual machines: the web frontend, the Node.js backend, MongoDB and the NICeMail Browser Agent.

**2. Does the Browser Agent require a GPU?**
**No.** It drives an ordinary Chrome browser without any graphics or GPU features. It does require **a person to sign in interactively** (and so a desktop session on the server). No code requires a visible browser; the manual sign-in does.

**3. Does any AI component require a GPU?**
**Not within IPC-QMS.** The summary, officer recommendation and draft are calls to an external AI service (Pravah Gemma), whose hardware is outside this project. A GPU server would be needed **only if** IPC decides the model must run on-premise.

**4. Which components depend on external services?**
- **Pravah Gemma API:** AI summary, recommendation and draft. Every call has a fallback if it is unavailable.
- **NICeMail (NIC):** mailbox reading and **all three** case emails — acknowledgement, forward and response — for cases that arrived in that mailbox.
- **NIC SMTP:** for cases that did *not* arrive through the agent. Production refuses the `mock` transport, so this needs the application password (Section 12.2).

**5. What infrastructure is required?**
- one **application VM** (Windows with desktop, hosting the backend, the agent's Chrome and the reverse proxy);
- a **Render Static Site** serving the frontend and rewriting `/api/*` to the VM (Section 11.5);
- a **separate production MongoDB Atlas cluster** (`qms_production`, with authentication and TLS), reachable only from the application VM;
- a TLS certificate;
- firewall rules (CDP never exposed);
- outbound access to NICeMail and Pravah;
- NTP;
- backup storage;
- monitoring and alerts.

No GPU.

**6. What are the major production risks?** Revised 2026-09-23 — (a) is resolved and is replaced by the two consequences of how it was resolved.
- **(a)** The forward now carries attachments through the Browser Agent, and the attach control is **not yet calibrated**: until it is, every accept of an enquiry with a document fails at the forward.
- **(b)** One channel for everything. A single NICeMail session outage stops acknowledgements, forwards and responses together.
- **(c)** The Browser Agent is a single point of failure that needs a signed-in browser and a person on session expiry.
- **(d)** An exposed CDP port would hand over the official mailbox.
- **(e)** Changes to the NICeMail user interface.
- **(f)** **No uncertain send settles itself any more.** Each one waits for a person, and nothing raises a case that has been waiting.
- **(g)** No backups, alerting or process supervision exist yet.
- **(h)** The development user and officials data are not production data.
- **(i)** `POST /queries/reset` deletes every case and has no production guard.

**7. What must be completed before production?**

*Before go-live:*
- **Calibrate the attach control** (`nic:browser:calibrate -- --attach`) and take the three keys out of `UNCALIBRATED`. Newly a go-live blocker, because the forward carries attachments now.
- An owner and a target time for settling `UNCERTAIN` sends, since nothing settles them automatically.
- Production user accounts (backend and frontend lists, plus a data clean-up where an environment has already booted) and the officials directory.
- The `FRONT_OFFICE_EMAIL` / `MAILBOX_SOURCE` decision (Phase 0 item 2).
- Restricting the AI routes to staff roles, and correcting the AI audit labels.
- A readiness endpoint exposing the agent's session state, if session expiry is to be alerted dependably.
- A production guard on `POST /queries/reset` — the mailbox-wipe and fake-mail endpoints now refuse in production — and on the email endpoints when MongoDB is down.
- `NODE_ENV=production` configuration.
- Backup and restore.
- Alerting and Chrome supervision.
- The `lab.ipc@gov.in` sign-in and calibration.
- The NIC/IT confirmations.
- The controlled test and the pilot.

*Already done, and listed here because the original report made them go-live conditions:*
- The OIC-forward path without Gmail (Section 17.2), Gmail's removal from code and configuration, case-level authorization, per-account credentials, and the removal of personal addresses from the repository.

**8. What must be coordinated with NIC/IT administration?**
- permission for automated browser use of the mailbox;
- that `lab.ipc@gov.in` is on the same platform;
- the MFA method and session lifetime;
- account ownership;
- sending limits;
- firewall access;
- the IMAP/SMTP app password status;
- the sender display name;
- keeping the mailbox's web interface in English.

Separately, with AICTE/Pravah and IPC policy: data-sharing approval for the AI service, and whether an external AI service is acceptable at all.

**9. What is the recommended deployment topology?**
A **single application VM**: the deployment must keep the backend and the agent's Chrome on the same host, so that the CDP port never leaves it (the code allows a remote endpoint but nothing protects it — Sections 9.2 and 13). One backend instance, a signed-in Chrome with a dedicated profile. Plus a **separate MongoDB Atlas cluster**, the frontend on a **Render Static Site** (Section 11.5), and TLS at a reverse proxy. A dedicated browser-agent worker is the recommended future step if volumes grow or sends must not block users.

**10. What is the migration strategy from Gmail to NICeMail?**
**Completed** (Section 17). Gmail is gone from code, dependencies and configuration; the forward
follows the case mailbox. What remains is operational, not a migration:
- **Revoke the Gmail refresh token** (Section 17.3). It is the one action the code change cannot do.
- Complete NIC SMTP (`EMAIL_TRANSPORT=nic`) once NIC issues the application password. Not a fallback for NICeMail cases — a channel for cases that did not arrive through the agent, and production refuses `mock`.
- Calibrate the attach control before go-live.
- There is no longer a second provider to fall back to. That is the intended design, and it is why the monitoring in Section 15 is now a go-live condition rather than a recommendation.

### Verified facts from the repository
- All AI inference is remote (Pravah) with deterministic fallbacks. There is no local model, ML library, embedding, OCR or GPU usage.
- The Browser Agent attaches to an existing, manually signed-in Chrome over localhost CDP. It never logs in or launches Chrome, and it runs one job at a time.
- Sends are verified before Send and confirmed in the NICeMail Sent folder. Each email is sent at most once per case (outbound ledger). Uncertain sends are never retried automatically.
- All three case emails of a NICeMail case use the Browser Agent, the forward included. `EMAIL_TRANSPORT` governs only cases that arrived elsewhere, and there is no portal through which a case can be raised. [Revised 2026-09-23]
- MongoDB is required in production. Attachments are stored on local disk. There is no backup tooling, alerting, container or process-manager configuration in the repository.
- `NODE_ENV` defaults to development, and `EMAIL_TRANSPORT` defaults to `mock`, which records emails as sent while sending nothing.
- Every account needs its own configured password. `QMS_ALLOW_SHARED_PASSWORD` re-enables one-secret-opens-everything, and **leaving it unset is not the same as `false`**: unset, it is ON outside production whenever `QMS_SEED_PASSWORD` is non-empty. Set it to `false`. The user and officials directories are development data, in the backend **and** the frontend, though no personal address remains in either.
- 990 backend and 839 frontend automated tests were run and passed at commit `438997e` (a test run, not a reading of the repository). Acknowledgement and final-response sending was live-tested on 2026-09-22 against the test account only.

### Deployment recommendations
- Windows application VM with desktop, plus a separate Atlas cluster and a Render Static Site; no GPU.
- CDP on localhost only, behind a host firewall; ACL-restricted Chrome profile; NTP.
- One backend instance under a process manager; `NODE_ENV=production`.
- Monitoring and alerts for session expiry, Chrome down, and FAILED / UNCERTAIN / stuck sends.
- A named NICeMail account owner and deputy; an operator runbook.
- Keep the Browser Agent as the only channel for NICeMail cases; add NIC SMTP (configuration, once the application password exists) as the channel for other cases.
- Phased rollout with the outbound interlock closed until the pilot.

### Assumptions
- Volumes are low to moderate (none are documented). The starting VM sizes in Section 11.4 are estimates to be measured in the pilot.
- NICeMail sessions last long enough that re-authentication is occasional. **Unverified.**
- A Windows server with an interactive session is acceptable to IPC IT.

### Items requiring confirmation from NIC / IT
Listed in Section 12.2. In addition:
- the production MongoDB hosting;
- backup retention and RTO/RPO;
- the TLS certificate and domain;
- outbound firewall rules to NICeMail and Pravah.

### Production risks
Ranked in Section 9.5 (Browser Agent) and Section 13 (security). The top five:
1. One channel for every NICeMail case email: a session outage stops the acknowledgement, the forward and the response together (§9.5 #2).
2. Single attended browser session with no alerting.
3. CDP exposure.
4. NICeMail UI changes.
5. No backups or monitoring yet.

---

<a id="appendix-a--evidence-index"></a>
## Appendix A — Evidence index

| Topic | Primary files (under `backend/src/` unless noted) |
|---|---|
| AI calls, timeouts, fallbacks | `services/ai/gemmaService.js`; `config/env.js:47-48`; `controllers/aiController.js`; `routes/aiRoutes.js` |
| Knowledge retrieval | `data/ipcKnowledge.js`, `data/ipcKnowledge.json`, `data/ipcContextBrain.js`, `data/evidenceQualification.js`; `backend/scripts/ingestIpcDocs.mjs` |
| Browser Agent core | `services/email/nic/browser/cdp.js`, `attach.js`, `session.js`, `selectors.js`, `pageKit.js`, `readInbox.js`, `sendMail.js`, `inspect.js`; `config/browserConfig.js` |
| Browser Agent tools | `scripts/nicBrowserDiscover.js`, `scripts/nicBrowserCalibrate.js` |
| NICeMail mailbox | `services/email/mailbox/nicBrowserMailbox.js`, `mailbox/index.js`, `models/MailboxMessage.js` |
| Outbound ledger and idempotency | `services/email/outbox.js`, `caseMail.js`, `delivery.js`, `models/OutboundEmail.js`; `services/email/sendTrace.js` |
| Transports | `services/email/emailService.js`; `transports/nicBrowserTransport.js`, `nicTransport.js`, `mockTransport.js`; `services/email/nic/outboundGuard.js` |
| Intake | `services/email/mailbox/acceptMessage.js`; `controllers/mailboxController.js`; `routes/mailboxRoutes.js` |
| Final approval and dispatch | `services/workflow/finalApproval.js`; `routes/queryRoutes.js`; `frontend/src/pages/dispatch/DispatchDetailPage.jsx` |
| Workflow (client) | `frontend/src/store/useWorkflowStore.js`; `frontend/src/constants/workflowRules.js` |
| Authorization | `middleware/verifyRole.js`, `authorizeCaseDelta.js`, `authorizeAttachmentAccess.js`; `services/authz/caseAccess.js`; `constants/protectedFields.js` |
| Authentication | `config/authConfig.js`; `services/auth/credentials.js`, `userDirectory.js`, `tokenService.js`; `constants/users.js`; `frontend/src/constants/mockUsers.js` |
| AI officials and mail identities | `config/officialsMetadata.js`; `config/identities.js` |
| Mailbox health and Front Office pages | `services/email/mailbox/health.js`; `frontend/src/components/workflow/MailboxAutoSync.jsx`; `frontend/src/pages/frontOffice/MailboxInboxPage.jsx` |
| Platform | `server.js`, `app.js`, `config/db.js`, `config/env.js`; `controllers/healthController.js`; `frontend/src/services/api/axiosClient.js` |
| Attachments | `services/attachments/attachmentPolicy.js`, `attachmentStore.js`, `resolveAttachments.js` |
| Configuration reference | `docs/ENVIRONMENT.md`; `backend/.env.example`, `frontend/.env.example`, `backend/.env.e2e`; the loader in `config/env.js` |
| CI and tests | `.github/workflows/test.yml`; `backend/src/test/*`; `frontend/src/test/*`; `frontend/e2e/*` |

---

## Appendix B — Documentation that disagreed with the code

Closed on 2026-09-23, except where noted. Each line carries the check that proves it.

| # | Was | Now |
|---|---|---|
| 1 | `docs/NIC_BROWSER_AGENT.md` and `nicTransport.js` described IMAP/SMTP as the production mail path and the Browser Agent as a supervised tool | **Closed.** §17 of the runbook states the agent as the production path for cases that arrive in its mailbox, and SMTP as the channel for the rest |
| 2 | `docs/NIC_BROWSER_AGENT.md` and `.env.example` said the NICeMail Front Office signs in with `QMS_SEED_PASSWORD` | **Closed.** `docs/NIC_BROWSER_AGENT.md` describes per-account credentials, and `docs/ENVIRONMENT.md` spells out all three states of `QMS_ALLOW_SHARED_PASSWORD` |
| 3 | `docs/HANDOFF.md` and the Admin settings page said case-level authorization is not implemented | **Closed.** Both corrected; `backend/README.md` documents the three guards. Check: `grep -rn "case-level" docs/ backend/README.md` |
| 4 | `.env.example` said AI drafts use 3× the timeout; the code uses 5× | **Closed.** Check: `grep -n "TIMEOUT_FACTOR" backend/src/services/ai/gemmaService.js` |
| 5 | `docs/HANDOFF.md` listed a duplicate-acknowledgement race and "no control to record an uncertain send" | **Closed.** Both are addressed in code (the outbound ledger; `POST /queries/:queryId/outbound/resolve`) and the document says so |
| 6 | `config/env.js` comments said the e2e configuration uses mock mail and that the Browser Agent is not in the request path | **Closed**, and both are now true rather than merely reworded: `.env.e2e` pins `EMAIL_TRANSPORT=mock`, and the comment states that the agent carries all three emails of a NICeMail case |
| 7 | `selectors.js` said compose was uncalibrated | **Closed.** The header now names the three keys that genuinely remain in `UNCALIBRATED`: `ccToggle`, `attachmentEntry`, `listRowAttachment` |
| 8 | Test counts in `README.md`, `docs/HANDOFF.md` and `backend/README.md` were out of date — and so were this appendix's own figures | **Closed.** All refreshed from one run in a single commit, so no two documents can disagree. The figures in the original of this appendix (63/990 and 46/839) were themselves wrong |
| 9 | `README.md` listed `playwright-core` as a backend dependency | **Closed.** Check: `grep -n playwright backend/package.json` (nothing) |
| 10 | `frontend/e2e/helpers/workflow.js` said the Gemma URL is empty under `.env.e2e`; it had been set | **Closed** by the `.env.e2e` rewrite, which pins `GEMMA_API_URL=` blank again. The comment is true as written |
| 11 | `docs/srs/06-non-functional-requirements.md` said one database backup covers the whole system | **Closed as a documentation defect; the underlying gap is open.** NFR-010 now records that attachment bytes are files on disk and that recovery needs the database **and** the attachment directory restored to a consistent point. Nothing in the repository performs either backup — that remains **BLOCKED** in §18, and the frequency and retention still need the client |

The gate this revision was verified against — a file list, not a pass/fail count, because the right
answer is not zero:

```bash
git ls-files '*.md' | xargs grep -EIl \
  'gmail:preflight|GMAIL_|googleapis|gmailInboxReader|gmailTransport|INQUIRER_EMAIL|/inquirer/|Raise Enquiry|MAILBOX_SOURCE=gmail|EMAIL_TRANSPORT=gmail'
```

Baseline before this work: **73 matches across 17 files**. After it: **18 matches across 11 files**,
and every one was read and kept on purpose. They fall into three kinds, and the test is that a hit is
never present-tense:

| Kind | Where |
|---|---|
| The record of the removal itself, which has to name what was removed | this file's §17, `srs/12` on the OAuth block, `srs/14`'s resolved entries |
| A superseded requirement, kept under the document's own convention | `srs/14` "Seven roles" (narrowed, with the client's sign-off flagged), `srs/14` "Which email provider" (struck through and re-resolved) |
| Past-tense prose explaining why something looks as it does, or a "do not add this back" note | `NIC_BROWSER_AGENT.md` on `playwright-core`, `NIC_EMAIL_PHASE0.md` as a dated report, `srs/01`, `srs/03`, `api-plan`, `frontend-architecture`, `query-lifecycle`, `role-permission-matrix` |

Surviving mentions of Gmail in the **code** are deliberate too, and should **not** be removed:
five assertions that it is refused (`EMAIL_TRANSPORT=gmail` and `MAILBOX_SOURCE=gmail` must fail at
boot, `getTransport('gmail')` must degrade to the mock, and neither `/emails/config` nor
`/emails/participants` may ever echo a `GMAIL_*` value), and past-tense comments explaining why code
looks the way it does. Gmail has not been erased from the history, and should not be — a claim that
it has been "completely removed" would be false.

---

*Prepared from a read-only audit of the IPC-QMS repository (commit `438997e`, 2026-09-22), and revised
2026-09-23 against `abhi-clean` after the Gmail removal it called for. Claims marked [Unknown] or
listed for NIC/IT confirmation must be resolved before the production go-live decision. A finding
marked [Verified, 2026-09-23] was re-checked against the code on that date; every other [Verified]
finding is as of 2026-09-22 and was not re-checked unless this revision touches it.*
