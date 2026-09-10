# NIC eMail — Phase 0 Verification

**This is a gate, not a formality.** No NIC integration code gets written until this
passes. The plan's viability rests on one question that documentation cannot answer for
a specific account:

> Can a **headless server** authenticate to `contact.ecoclubs-edu@gov.in` over IMAP/SMTP?

If the mailbox still requires a rotating OTP (legacy `email.gov.in` + Kavach), the answer
is **no** and no amount of code fixes it — the account must be migrated or granted a
policy exception first.

---

## What we already know empirically

Run of `npm run nic:preflight` from a developer machine on 2026-09-09:

| Endpoint | Result |
|---|---|
| `imap.mgovcloud.in:993` | ✅ `* OK svwall.zoho.com IMAP4 Server (Zoho Mail IMAP4rev1 Server)` |
| `smtp.mgovcloud.in:465` | ✅ `220 mx.mgovcloud.in SMTP Server ready` |
| `imap.mail.gov.in:993` | ✗ `ECONNRESET` |
| `smtp.mail.gov.in:465` | ✗ timed out |

Two things follow:

1. **NICeMail is confirmed Zoho-backed.** The greeting says so outright. That matters
   because the Zoho platform is the one that supports **application-specific passwords**
   — the credential model a backend can actually use.
2. **Reachability is host-dependent.** `mail.gov.in` refused this machine while
   `mgovcloud.in` answered. That is the classic signature of IP/NICNET restriction, and
   it is exactly why **Step 4 must be repeated on the deployment host**. A pass here
   says nothing about the server.

---

## Step 1 — Identify which platform hosts the mailbox

Sign in at <https://mail.gov.in> and observe the login sequence.

| What you see | Platform | Verdict |
|---|---|---|
| Prompts for **Kavach** OTP; branding says `email.gov.in` | Legacy + Kavach | ⛔ **Stop.** IMAP needs `password + rotating OTP`. A server cannot supply it. Escalate to NIC for migration or exception. |
| Prompts **SMS OTP**, then offers **Gov OneAuth** enrolment; settings look like NICeMail | NICeMail (Zoho) | ✅ Proceed to Step 2. |

## Step 2 — Enable IMAP on the account

Webmail → **Settings → Mail Accounts → IMAP Access** → enable.

If the option is missing or greyed out, the organisation's baseline policy is blocking
it. NIC's own documentation is explicit:

> *"By default, accounts are given access over web only (https://mail.gov.in), and if
> users want access over POP/IMAP, they must send requests to support@gov.in."*

> *"As per the Baseline policy, IMAP access is restricted to all Governement
> Organisations. You need to get the approval from the NIC Email Division…"*

Use the request template at the bottom of this file.

## Step 3 — Generate an application-specific password

Webmail → **Security → App Passwords** → generate one named e.g. `ipc-qms-backend`.

- This is **not** your webmail login password. Under MFA the login password will be
  rejected by IMAP/SMTP — that rejection is expected, not a misconfiguration.
- Note it once; it is typically not shown again.
- **Do not paste it into chat, a ticket, source code, `.env.example`, or a commit.**

## Step 4 — Run the preflight, from the deployment host

```bash
cd backend

# Reachability only — no credentials involved
npm run nic:preflight

# With authentication — prompts for the app password, input hidden
npm run nic:preflight -- --email=contact.ecoclubs-edu@gov.in

# Non-interactive (CI / service host): pass a file PATH, never the value
NIC_EMAIL=contact.ecoclubs-edu@gov.in \
NIC_APP_PASSWORD_FILE=/run/secrets/nic_app_password \
  npm run nic:preflight
```

The script is **read-only**: it uses IMAP `EXAMINE` rather than `SELECT`, so it cannot
even mark a message as read, and it issues no `MAIL FROM`/`RCPT TO`/`DATA`, so nothing
is ever sent. The password is never written to disk, never placed in `argv` (which
leaks to shell history and `ps`), and is redacted from any server error it prints.

### Reading the verdict

| Output | Meaning | Next step |
|---|---|---|
| `PREFLIGHT PASSED` | Unattended IMAP+SMTP works. Records the winning endpoint pair and `UIDVALIDITY`. | Gate met — remaining items below, then Phase 1. |
| `BLOCKED` | Server wants a rotating OTP (Kavach). | **Project blocked.** Migration or exception required. |
| `NOT ENABLED` | IMAP/SMTP off, or barred by org policy. | Step 2, then the NIC request. |
| `CREDENTIAL REJECTED` | Usually the webmail password was used instead of an app password. | Step 3. |
| No endpoint reachable | Firewall, or IMAP/SMTP restricted to NICNET. | Ask NIC to allowlist the host's public IP. |

---

## Exit criteria

Phase 0 is complete only when **all** hold:

- [ ] IMAP `LOGIN` succeeds with an application-specific password
- [ ] SMTP `AUTH` succeeds with the same credential
- [ ] Both verified **from the production/deployment host**, not only a laptop
- [ ] NIC has confirmed **in writing** that unattended server-application access is permitted
- [ ] Sending, recipient, rate and attachment limits are known
- [ ] The `contact.ecoclubs-edu@gov.in` vs IPC account-ownership question is settled

Only then does Phase 1 (backend authN/authZ — itself a hard blocker) begin.

---

## Credential storage — before anything reaches a server

Ranked, per the plan §7:

1. **Preferred** — OS/platform secret manager: systemd `LoadCredential=`, Windows
   DPAPI/Credential Manager, or the cloud provider's secret manager.
2. **Acceptable** — Vault / KMS-encrypted secret fetched at boot, held only in memory.
3. **Minimum viable** — root-owned `0600` file **outside the repo**, referenced by
   `NIC_APP_PASSWORD_FILE`. Config stores the *path*, never the value.
4. **Prohibited** — source, committed `.env`, `.env.example`, frontend code, Docker image
   layers, CI logs, shell commands, screenshots, or this repository in any form.

Also note: **NICeMail passwords expire every 90 days**, and on Zoho-based platforms a
password reset generally invalidates existing app passwords. Sync will fail silently at
that boundary — the rotation runbook is a deliverable, not an afterthought.

---

## Request template — NIC Email Division

Send to `support@gov.in`, copying your Delegated Administrator.

> **Subject:** IMAP/SMTP access request for `contact.ecoclubs-edu@gov.in` — departmental application integration
>
> Respected Sir/Madam,
>
> We are integrating the official mailbox `contact.ecoclubs-edu@gov.in` with an internal
> departmental application (IPC Query Management System) so that official correspondence
> is handled through NIC eMail rather than a third-party provider, in line with the
> E-mail Policy of the Government of India.
>
> **Primary question:** Is IMAP access and authenticated SMTP access enabled for
> `contact.ecoclubs-edu@gov.in` for use by a backend application/server, and if not, what
> approval, IP whitelisting, application-specific password, or organisational policy
> change is required?
>
> We would be grateful for confirmation on the following:
>
> 1. Is this mailbox on the legacy `email.gov.in` (Kavach) platform, or migrated to
>    `mail.gov.in` / NICeMail (Gov OneAuth)?
> 2. Is IMAP/POP permitted under our organisation's baseline policy, and is it enabled on
>    this account?
> 3. Which endpoints apply — `imap.mail.gov.in` / `smtp.mail.gov.in`, or
>    `imap.mgovcloud.in` / `smtp.mgovcloud.in`?
> 4. Can application-specific passwords be generated on this account, and do they survive
>    the 90-day password expiry?
> 5. **Is unattended access by a departmental server application permitted**, or is
>    IMAP/SMTP restricted to interactive desktop clients?
> 6. Are there IP allowlisting or NICNET-origin requirements? If so, what is the process
>    to allowlist our application server?
> 7. What are the sending limits (messages/day, recipients/message, rate) and the maximum
>    attachment size?
> 8. Is SMTP submission restricted to the authenticated account's own `From:` address?
> 9. Is a **functional/service mailbox** the appropriate vehicle for an application,
>    rather than a person-linked account?
> 10. Does NIC offer an official email API (e.g. via NAPIX) that we should prefer over
>     IMAP/SMTP?
> 11. Are there audit or retention obligations we must satisfy when storing official
>     correspondence within a departmental application?
>
> For clarity on scope: the application reads the mailbox to register incoming queries,
> and sends acknowledgements, forwards and replies. **All outgoing mail is reviewed and
> approved by a human officer before dispatch** — no autonomous sending. Attachments are
> stored against the corresponding case record with access restricted by role.
>
> With regards,
> [Name, Designation, Organisation, Contact]

---

## Related

- Full assessment and architecture: the approved NIC integration plan.
- Existing Gmail equivalent: `npm run gmail:preflight`, `docs/EMAIL_MANUAL_TEST.md`.
- Current security posture: `backend/README.md` § "Security status: NOT production-ready".
