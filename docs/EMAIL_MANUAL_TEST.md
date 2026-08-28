# Manual Email Test Procedure — four real Gmail accounts

Two things cannot be proven by the automated suite, and this document is how you prove them:

1. **Real Gmail sends from four different accounts** — tests never touch Gmail and never require a
   credential.
2. **The end-to-end workflow in a browser** — the suite drives the engine directly.

---

## Who is real, who is mock

| Role              | Person               | Address                     | Sends real mail |
| ----------------- | -------------------- | --------------------------- | --------------- |
| Inquirer          | Abhinash Pritiraj    | abhinash.pritiraj@gmail.com | yes             |
| Front Office      | Bhumika Makker       | bhoomikamakker@gmail.com    | yes             |
| Officer-in-Charge | Jatin Rawat          | rawatjatin436@gmail.com     | yes             |
| Assigned Official | Neha Singh           | neha.singh@ipc.example      | no — mock       |
| Assigned Official | Rawat Jatin          | rawat.jatin@ipc.example     | no — mock       |
| Assigned Official | Meera Iyer           | meera.iyer@ipc.example      | no — mock       |
| Assigned Official | Arjun Nair           | arjun.nair@ipc.example      | no — mock       |
| Assigned Official | Sana Qureshi         | sana.qureshi@ipc.example    | no — mock       |
| Assigned Official | Vikram Desai         | vikram.desai@ipc.example    | no — mock       |
| Reviewer I        | Amit Mehta           | amit.mehta@ipc.example      | no — mock       |
| Reviewer II       | Kavita Rao           | kavita.rao@ipc.example      | no — mock       |
| Admin             | Suresh Gupta         | suresh.gupta@ipc.example    | no — mock       |
| Super Admin       | System Administrator | admin@ipc.example           | no — mock       |

Mock login password for every user: **`ipc@1234`**. The login page lists them all with a
**Use Credentials** button.

> **Two similar names, two different people.** _Jatin Rawat_ `rawatjatin436@gmail.com` is the
> Officer-in-Charge; _Rawat Jatin_ `rawat.jatin@ipc.example` is an Assigned Official. They are
> separate user records with separate roles — the id and the address tell them apart, never the
> display name.
>
> **Three real accounts, not four.** The Assigned Official briefly had a real Gmail identity; it
> was removed, and the role is now six mock officials spread across the technical divisions, each
> with declared expertise. Whether a message is really sent is decided by the acting user's own
> address, so an Assigned Official's actions are never sent from somebody else's Gmail account.

### The Assigned Official roster and their divisions

| Official     | Division                       | Expertise                                                    |
| ------------ | ------------------------------ | ------------------------------------------------------------ |
| Neha Singh   | Analytical & Quality Control   | assay, dissolution, impurity, method validation, chromatography |
| Rawat Jatin  | Technical Operations           | instrumentation, calibration, laboratory operations, equipment |
| Meera Iyer   | Pharmacopoeial Standards       | monograph, reference standard, pharmacopoeia, specification   |
| Arjun Nair   | Microbiology                   | sterility, endotoxin, microbial limits, bioburden, contamination |
| Sana Qureshi | Pharmaceutical Chemistry       | synthesis, degradation, stability, excipient, formulation     |
| Vikram Desai | Regulatory Affairs & Compliance| submission, documentation, regulatory, guideline, compliance  |

The assignment recommendation scores an enquiry against these expertise words and the official's
division, plus current workload. It is **advisory only** — the OIC assigns whoever they choose,
and the case records whether the recommendation was accepted.

---

## Why each account needs its own authorisation

A Gmail refresh token authenticates **exactly one account**, and the Gmail API sends as the
authenticated account **regardless of the `From:` header**. There is no header trick that makes
Abhinash's token send as Bhumika — the recipient would still see Abhinash.

So each of the three people must authorise their own account. A role with no token falls back to
the mock transport; **no other account is ever used on its behalf**, so the sender the QMS records
is always the sender Gmail actually used.

`npm run gmail:preflight` enforces this: it fails if any token authenticates as an address other
than the one configured for that role.

---

## Part 0 — one-time setup (per account)

For **each** of the four people, with that person signed in to Gmail:

1. Open <https://developers.google.com/oauthplayground>.
2. Gear icon → tick **Use your own OAuth credentials**, paste the shared `GMAIL_CLIENT_ID` and
   `GMAIL_CLIENT_SECRET`.
3. Authorise these scopes:
   - everyone: `https://www.googleapis.com/auth/gmail.send`
   - **Bhumika only, additionally**: `https://www.googleapis.com/auth/gmail.modify`
4. Exchange the authorisation code for tokens, copy the **refresh token**.
5. Paste it into `backend/.env`:

```env
GMAIL_REFRESH_TOKEN_INQUIRER=...
GMAIL_REFRESH_TOKEN_FRONT_OFFICE=...
GMAIL_REFRESH_TOKEN_OFFICER_IN_CHARGE=...
```

> **Privacy — read before authorising Bhumika's account.** `gmail.modify` lets the QMS **read her
> entire inbox**, not only IPC correspondence, and mark messages as read. That access is what makes
> "the query case is created from the email that actually arrived" true. It is a real grant on a
> real personal account and needs her informed agreement. If that is not acceptable, leave
> `MAILBOX_SOURCE=auto`: sends stay real, but enquiries are registered from the local mailbox
> instead of from her inbox.

`backend/.env` is gitignored. Never commit a token, a client secret, or a password.

### Verify the credentials without sending anything

```bash
cd backend && npm run gmail:preflight
```

Every configured role must report **"Authenticated as … — matches the configured address"**. An
`IDENTITY MISMATCH` is a hard failure: it means that token belongs to a different account, and mail
the QMS attributes to one person would arrive from another.

---

## Part 1 — the three-inbox walkthrough

```bash
cd backend  && npm start      # must print "listening on port 5000"
cd frontend && npm run dev    # http://localhost:5173
```

For real sends set both, then restart the backend:

```env
EMAIL_TRANSPORT=gmail
MAILBOX_SOURCE=gmail
```

To start clean: **Reset demo data** in the header clears the QMS workflow domain. With
`MAILBOX_SOURCE=gmail` there is no mailbox to reset — Gmail's own read/unread state _is_ the
mailbox, so mark the test mail unread in Bhumika's inbox to make it registerable again.

| #   | Sign in as                      | Do this                                           | Gmail should show                                                                                                                               | QMS should show                                                                                                                                                                                                      |
| --- | ------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Abhinash                        | **Raise Enquiry** → subject + message → Send      | **Abhinash → Sent**: the enquiry, addressed to bhoomikamakker@gmail.com. **Bhumika → Inbox**: it arrives.                                       | "Enquiry sent" with the Gmail message id                                                                                                                                                                             |
| 2   | Bhumika                         | **IPC Mailbox** → Check IPC mailbox               | —                                                                                                                                               | `QRY-2026-00001` created; the row shows the Query ID beside the message                                                                                                                                              |
| 3   | Bhumika                         | (all automatic — the same button press as step 2) | **Bhumika → Sent**: acknowledgement _and_ `Fwd: … [QRY-2026-00001]`. **Abhinash → Inbox**: the acknowledgement. **Jatin → Inbox**: the forward. | Thread shows _Original enquiry → Acknowledgement → Forwarded to Officer-in-Charge_; state `PENDING_ASSIGNMENT`; audit: QUERY RECEIVED, AI SUMMARY GENERATED, ACKNOWLEDGEMENT SENT, QUERY REGISTERED, QUERY FORWARDED |
| 4   | Jatin                           | **Assignments** → open the case                   | —                                                                                                                                               | Original enquiry, acknowledgement, forward, AI summary, audit trail, current state                                                                                                                                   |
| 5   | Jatin                           | Accept or override the AI recommendation          | —                                                                                                                                               | State `ASSIGNED`; still `QRY-2026-00001`                                                                                                                                                                             |
| 6   | Neha (mock) **or** Rawat (real) | **Drafting** → Start drafting → edit → Save       | nothing for Neha (no token). Rawat sends real mail only once he has authorised.                                                                 | v1 and v2 both retained                                                                                                                                                                                              |
| 7   | Neha                            | Add two review levels → Submit for review         | —                                                                                                                                               | State `UNDER_REVIEW`                                                                                                                                                                                                 |
| 8   | Amit, then Kavita               | **Reviews** → Approve each                        | —                                                                                                                                               | State `PENDING_FINAL_APPROVAL`                                                                                                                                                                                       |
| 9   | Jatin                           | **Approvals** → Grant final approval              | —                                                                                                                                               | State `READY_FOR_DISPATCH`; approved version locked                                                                                                                                                                  |
| 10  | Bhumika                         | **Dispatch** → Dispatch response                  | **Bhumika → Sent**: the response. **Abhinash → Inbox**: he receives it.                                                                         | State `DISPATCHED` → `CLOSED`                                                                                                                                                                                        |

### What to compare at the end

Open the case and check this against the three inboxes:

```
QRY-2026-00001            ← one id, from step 2 through step 10
├── Original Query        Abhinash → Bhumika
├── Acknowledgement       Bhumika  → Abhinash
├── Forward               Bhumika  → Jatin
└── Final Response        Bhumika  → Abhinash
```

All four messages carry the **same Thread ID**. The audit trail names Bhumika and Jatin by their
real names, and the mock users for the drafting and review steps.

### Things worth trying deliberately

- **Press "Check IPC mailbox" twice.** The second press must report the mail as already registered.
  No `QRY-2026-00002`.
- **Have Abhinash reply to the acknowledgement.** It lands in Bhumika's inbox on the same Gmail
  thread. Registering it must attach the reply to `QRY-2026-00001`, not create a second case.
- **Open another role's URL** (e.g. `/officer-in-charge/dashboard` while signed in as Abhinash) →
  "Access restricted", not a page.
- **Refresh mid-workflow.** Session and case both survive; the Query ID does not change.

---

## Known limitations

- **Only mail from a known inquirer is polled.** The Gmail search is
  `in:inbox is:unread from:(abhinash.pritiraj@gmail.com)`, and anything slipping past it is dropped
  after fetch. Bhumika's personal mail can never become a Query Case. Add another inquirer to the
  identity directory to widen it.
- **The whole Front Office stage is automatic.** One press of _Check IPC mailbox_ registers,
  acknowledges, verifies and forwards. Verification is still recorded with Bhumika as the actor —
  it is the click that disappeared, not the checkpoint. The manual **Forward to Officer-in-Charge**
  button remains for retries.
- **Attachments** now carry real bytes end to end: upload on the enquiry form, real MIME
  parts on outbound Gmail sends, downloaded bytes for inbound Gmail attachments, and full
  files on the Front Officer's forward to the Officer-in-Charge. See the checklist below.
  The attachment endpoints have no authentication — see `backend/README.md` "Security
  status".
- **The QMS case lives in the browser that registered it.** Query state is held in that browser's
  IndexedDB, so opening the QMS in another browser or profile shows no cases. Abhinash's device
  genuinely does not matter — ingestion is server-side and the inquirer comes from the `From`
  header — but Bhumika should stay in one browser profile for a test run.

- **Only Bhumika's inbox is polled.** Jatin's is deliberately not read — the forwarded mail sitting
  there belongs to a case that already exists, and registering it would create a duplicate.
- **The mocked tail sends nothing.** Drafting and review steps are recorded in the QMS only; there
  is no Gmail trace for Neha, Amit or Kavita. Intended for this phase.
- **Gmail decides threading.** A reply Gmail places on a new thread (for instance after a heavily
  edited subject) is treated as a new enquiry.

## Live-Gmail attachment checklist

With `EMAIL_TRANSPORT=gmail`, `MAILBOX_SOURCE=gmail`, and `npm run gmail:preflight` clean:

1. Sign in as Abhinash → **Raise Enquiry** → attach a PDF, a PNG, and an XLSX → Send.
2. **Abhinash → Sent** contains the enquiry with all 3 attachments; open each from Gmail.
3. **Bhumika → Inbox** receives the mail with all 3 attachments intact.
4. Bhumika → **Check IPC mailbox** → open the case → Attachments tab shows all 3; the PDF and
   PNG preview in-app, the XLSX offers Download.
5. Bhumika → **Forward to Officer-in-Charge**.
6. **Jatin → Inbox** receives the forward with all 3 original files, each downloadable and
   openable, byte-identical to what Abhinash sent.
7. Deliberately delete one attachment's file on disk (`backend/storage/attachments/<id>.bin`)
   and press **Forward** again (or **Retry forwarding** if already forwarded once) — the UI
   must show an error naming the missing file, the query must stay un-forwarded, and Jatin's
   inbox must receive nothing for that attempt.
- `ipc-query-mock@example.com` remains the mock-mode address and **can never receive mail**:
  `example.com` is reserved by RFC 2606 with a null MX, so anything sent there bounces. That is
  deliberate — the mock address must never reach a real mailbox.

## Switching back

Set `EMAIL_TRANSPORT=mock` and `MAILBOX_SOURCE=auto`, restart the backend. Nothing then leaves the
machine and the local mock mailbox is used again.

## Mailbox persistence

With `MAILBOX_SOURCE=auto` the mailbox is stored in MongoDB when reachable and **survives a backend
restart**; ids stay sequential (`MSG-00001`, …) via a counter document. Without Mongo the backend
still starts and falls back to an in-memory mailbox, **cleared on every restart**. Every mailbox API
response reports which store served it in the `persistence` field.
