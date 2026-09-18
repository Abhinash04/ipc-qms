# Manual Email Test Procedure — one authenticated mailbox

Two things cannot be proven by the automated suite, and this document is how you prove them:

1. **Real Gmail send and receive through the Front Office mailbox** — tests never touch Gmail and
   never require a credential.
2. **The end-to-end workflow in a browser**, starting from the Front Officer's accept/reject
   decision — the suite drives the engine directly.

This procedure covers the Gmail Front Office mailbox. The **NICeMail mailbox** — the second Front
Office mailbox that exists with `NIC_BROWSER_MAILBOX=true`, read and answered through an
operator-signed-in Chrome — has its own procedure: **Test 2** in
[NIC_BROWSER_AGENT.md §17](./NIC_BROWSER_AGENT.md#testing-both-paths). It cannot pass until the
browser agent's selectors have been calibrated against the live NICeMail page, as described there.

---

## Who is real, who is mock

**Inquirers are not in this table.** Anyone may email the Front Office mailbox from any address;
they hold no account here and authenticate to nothing. The seeded `INQUIRER` account below exists
only to drive the in-app **Raise Enquiry** test harness.

| Role              | Person               | Address                     | Sends real mail |
| -------------------| ----------------------| -----------------------------| -----------------|
| Inquirer          | Abhinash Pritiraj    | abhinash.pritiraj@gmail.com | no — test harness, mock transport |
| Front Office      | Bhumika Makker       | bhoomikamakker@gmail.com    | yes — the only authenticated mailbox |
| Officer-in-Charge | Jatin Rawat          | rawatjatin436@gmail.com     | no — recipient only |
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

Every seeded account shares one password, set by **`QMS_SEED_PASSWORD`** in `backend/.env`. The
value is deliberately not written down here — see [auth.md](./auth.md), which refers to it by
variable name for the same reason. In development the login page lists the accounts with a
**Use Credentials** button, so the value is never needed by hand.

> **Two similar names, two different people.** _Jatin Rawat_ `rawatjatin436@gmail.com` is the
> Officer-in-Charge; _Rawat Jatin_ `rawat.jatin@ipc.example` is an Assigned Official. They are
> separate user records with separate roles — the id and the address tell them apart, never the
> display name.
>
> **One authenticated account, not four.** The Assigned Official briefly had a real Gmail identity;
> it was removed, and the role is now six mock officials spread across the technical divisions, each
> with declared expertise. The Inquirer and Officer-in-Charge tokens were removed too — see
> [Why only the Front Office mailbox is authorised](#why-only-the-front-office-mailbox-is-authorised).
> The QMS never claims a `From` address it did not authenticate as, so nobody's actions are ever
> sent from somebody else's Gmail account.

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

## Why only the Front Office mailbox is authorised

A Gmail refresh token authenticates **exactly one account**, and the Gmail API sends as the
authenticated account **regardless of the `From:` header**. There is no header trick that makes one
person's token send as another — the recipient would still see the authenticated account.

Only one mailbox needs a token, because only one is ever read from or sent as. Acknowledgements, the
forward to the Officer-in-Charge and the final dispatch all go out as the **Front Officer**, and
inbox polling uses the same token.

- **Inquirers are external.** They write in from their own mail client and hold no account here, so
  there is no inquirer token to issue.
- **The Officer-in-Charge is a recipient, not a sender.** Nothing in the codebase sends as that
  role; the forward is addressed to `OFFICER_IN_CHARGE_EMAIL` and sent as the Front Officer.

A role with no token falls back to the mock transport; **no other account is ever used on its
behalf**, so the sender the QMS records is always the sender Gmail actually used.

`npm run gmail:preflight` enforces this: it fails only if the **Front Office** mailbox fails, and it
fails if a token authenticates as an address other than the one configured for that role. A stale
token left on another role is reported as configured-but-unused and does not fail the run — delete
the variable.

---

## Part 0 — one-time setup (one account)

With **Bhumika** signed in to Gmail:

1. Open <https://developers.google.com/oauthplayground>.
2. Gear icon → tick **Use your own OAuth credentials**, paste the shared `GMAIL_CLIENT_ID` and
   `GMAIL_CLIENT_SECRET`.
3. Authorise both scopes — send, and a read scope for inbox polling:
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.modify`
4. Exchange the authorisation code for tokens, copy the **refresh token**.
5. Paste it into `backend/.env`:

```env
GMAIL_REFRESH_TOKEN_FRONT_OFFICE=...
```

There is deliberately no `GMAIL_REFRESH_TOKEN_INQUIRER` and no
`GMAIL_REFRESH_TOKEN_OFFICER_IN_CHARGE`. If either is still in your `.env`, delete it.
`GMAIL_REFRESH_TOKEN_FRONT_OFFICE` is **required** when `EMAIL_TRANSPORT=gmail` — the server
refuses to start without it.

> **Privacy — read before authorising Bhumika's account.** `gmail.modify` lets the QMS **read her
> entire inbox**, not only IPC correspondence, and mark messages as read. That access is what makes
> "the query case is created from the email that actually arrived" true. It is a real grant on a
> real personal account and needs her informed agreement. The mitigation is the validation gate:
> everything addressed to her is merely *listed*, and nothing becomes a Query Case until she
> accepts it — a friend's message or a receipt can be rejected, or simply left alone. If the grant
> is still not acceptable, leave `MAILBOX_SOURCE=auto`: sends stay real, but enquiries are listed
> from the local mailbox instead of from her inbox.

`backend/.env` is gitignored. Never commit a token, a client secret, or a password.

### Verify the credentials without sending anything

```bash
cd backend && npm run gmail:preflight
```

`FRONT_OFFICE` must report **"Authenticated as … — matches the configured address"**; every other
role should report **"Not configured"**, which is expected and correct. An `IDENTITY MISMATCH` is a
hard failure: it means that token belongs to a different account, and mail the QMS attributes to one
person would arrive from another.

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

To start clean: **Reset** in the header clears the QMS workflow domain. The button is rendered for
the **Super Admin only**, matching `POST /api/v1/queries/reset`, and local state is cleared only
once the server has accepted the reset — a refused reset no longer empties the tab while the server
keeps the cases. From a terminal, `cd backend && npm run db:reset` does the same job against the
database directly (`--dry-run` to see what would go first). With
`MAILBOX_SOURCE=gmail` there is no mailbox to reset — Gmail's own read/unread state _is_ the
mailbox, so mark the test mail unread in Bhumika's inbox to make it visible again.

**Reset does not undo a decision.** `MailboxDecision` is keyed by the Gmail message id and survives
both the QMS reset and marking the mail unread — the first decision on a message wins, permanently.
To exercise the gate again, **send a fresh email**.

| #   | Sign in as                      | Do this                                           | Gmail should show                                                                                                                               | QMS should show                                                                                                                                                                                                      |
| --- | ------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | — (any mail client)             | Email the enquiry to bhoomikamakker@gmail.com **from any external address** — your own, a colleague's, a throwaway. No QMS account is needed. | **Bhumika → Inbox**: it arrives.                                                        | —                                                                                                                                                                                                                    |
| 2   | Bhumika                         | **IPC Mailbox** → Check IPC mailbox               | —                                                                                                                                               | The message is listed with the real sender and **Awaiting validation**. **No case, no Query ID, no acknowledgement** — the check registers nothing                                                                    |
| 3   | Bhumika                         | Click **✓** on that row → confirm **Yes**. This is the whole intake — one click, one server call | **Bhumika → Sent**: the acknowledgement **and** `Fwd: … [QRY-2026-00001]`. **The sending address → Inbox**: the acknowledgement arrives. **Jatin → Inbox**: the forward. | `QRY-2026-00001` created; the row shows the Query ID; state **`PENDING_ASSIGNMENT`**; audit, **in this order**: QUERY RECEIVED, QUERY REGISTERED, AI SUMMARY GENERATED, ACKNOWLEDGEMENT SENT, QUERY FORWARDED, EMAIL CLASSIFIED. The toast names the acknowledgement and the forward, whichever succeeded or failed |
| 4   | Bhumika                         | Open the case — **nothing to do here**. Confirm the thread                                       | —                                                                                                                                              | Thread shows _Original enquiry → Acknowledgement → Forwarded to Officer-in-Charge_. **Forward to Officer-in-Charge** is present but is now only the recovery path: use it if step 3 reported the forward failed and the case is sitting at `FRONT_OFFICE_VERIFICATION` |
| 5   | Jatin                           | **Assignments** → open the case                   | —                                                                                                                                               | Original enquiry, acknowledgement, forward, AI summary, audit trail, current state                                                                                                                                   |
| 6   | Jatin                           | Accept or override the AI recommendation          | —                                                                                                                                               | State `ASSIGNED`; still `QRY-2026-00001`                                                                                                                                                                             |
| 7   | Neha **or** Rawat (both mock)   | **Drafting** → Start drafting → edit → Save       | nothing — neither holds a token; only the Front Office mailbox is authenticated.                                                                | v1 and v2 both retained                                                                                                                                                                                              |
| 8   | Neha                            | Add two review levels → Submit for review         | —                                                                                                                                               | State `UNDER_REVIEW`                                                                                                                                                                                                 |
| 9   | Amit, then Kavita               | **Reviews** → Approve each                        | —                                                                                                                                               | State `PENDING_FINAL_APPROVAL`                                                                                                                                                                                       |
| 10  | Jatin                           | **Approvals** → Grant final approval. This is the whole dispatch — one click, one server call, nobody presses send | **Bhumika → Sent**: the response, sent by the server under the Front Office identity. **The original sender → Inbox**: they receive it. | Approved version locked; state `READY_FOR_DISPATCH` → `DISPATCHED` → `CLOSED`; audit, **in this order**: FINAL APPROVAL GRANTED, RESPONSE DISPATCHED, QUERY CLOSED. If the send fails the approval still stands: the case waits at `READY_FOR_DISPATCH`, the banner and toast both read *"Approved, but the inquirer was not emailed: …"*, and an `EMAIL_SEND_FAILED` entry names the reason |
| 11  | Bhumika                         | **Dispatch** → open the case — **nothing to do here**. Confirm what was sent | —                                                                                                             | The page shows **Response sent automatically**, when and to whom, and *Query closed*. **Retry sending response** appears only if step 10 reported the send failed; it completes the send without creating a second response |

The in-app **Raise Enquiry** form (sign in as the seeded Inquirer) is an alternative to step 1. It
is a test harness only: it sends through the mock transport and its banner says **"Simulated
enquiry"**, because no Gmail credential is configured for that role. Use a real external send to
prove the Gmail path.

### Part 1b — the reject path

Prove that a rejection creates nothing. Use a **second, different** email — the first decision on a
message is permanent.

1. Send a second message to bhoomikamakker@gmail.com, one that is plainly not an IPC enquiry.
2. Bhumika → **IPC Mailbox** → **Check IPC mailbox**. It is listed as **Awaiting validation**.
3. Click **×** on that row → confirm **Yes**.
4. Expect: a "Message rejected" toast; the Query Case column reads **Rejected**; **no new Query ID**
   (the counter does not move — the next accepted enquiry is still `QRY-2026-00002`); **no
   acknowledgement** in Bhumika's Sent or the sender's inbox; no workflow, no assignment.
5. The message stays listed — a rejection is recorded, not erased. `GET /api/v1/mailbox/decisions`
   returns it with the actor, the timestamp and a snapshot of who wrote in.
6. The ✓ and × buttons are gone from that row. Re-deciding is refused: the stored decision is
   returned with `alreadyDecided: true`.

### What to compare at the end

Open the case and check this against the three inboxes:

```
QRY-2026-00001            ← one id, from step 3 through step 11
├── Original Query        the external sender → Bhumika
├── Acknowledgement       Bhumika  → the external sender
├── Forward               Bhumika  → Jatin
└── Final Response        Bhumika  → the external sender
```

All four messages carry the **same Thread ID**. The audit trail names Bhumika and Jatin by their
real names, the inquirer by the address the mail actually came from, and the mock users for the
drafting and review steps.

### Things worth trying deliberately

- **Press "Check IPC mailbox" twice.** Neither press creates anything. Both must report the mail as
  _awaiting validation_, never as registered.
- **Double-click ✓.** The first decision wins: one case, one acknowledgement, one forward. No
  `QRY-2026-00002`. Each step checks for its own artefact before acting, so a second press finishes
  only what did not complete the first time and repeats nothing.
- **Send from a second, unrelated address.** It must appear in the inbox too — there is no sender
  filter, so an enquiry from a member of the public is never silently discarded.
- **Double-click Approve.** One email, not two. The stored outbound response is the guard, so the
  second press reports the case as already answered rather than sending again — and the audit trail
  carries exactly one `FINAL_APPROVAL_GRANTED`, because the decision was taken once.
- **Check which kind of summary you got.** The case now stores one (`QueryCase.aiSummary`) and the
  forward's covering note quotes the same text. The `AI_SUMMARY_GENERATED` audit row carries the
  status: `GENERATED` when the model answered, `FALLBACK` when it did not and the deterministic
  stand-in was used, `FAILED` when the call threw. **On this deployment the Gemma endpoint does not
  answer within `GEMMA_TIMEOUT_MS`, so expect `FALLBACK`** — a real state, not a broken one. Only a
  `FAILED` summary is re-attempted when you press ✓ again; a `FALLBACK` one is kept as it stands.
- **Have the sender reply to the acknowledgement.** It lands in Bhumika's inbox on the same Gmail
  thread. Accepting it must attach the reply to `QRY-2026-00001`, not create a second case.
- **Open another role's URL** (e.g. `/officer-in-charge/dashboard` while signed in as the Inquirer)
  → "Access restricted", not a page.
- **Refresh mid-workflow.** Session and case both survive; the Query ID does not change.

---

## Known limitations

- **Everything addressed to Bhumika is listed, from anyone.** The Gmail search is
  `in:inbox is:unread to:(bhoomikamakker@gmail.com)` — recipient only, **no sender filter** — so an
  enquiry from an unknown member of the public is never discarded before she sees it. The price is
  that her personal mail is listed too. Nothing becomes a Query Case without her ✓; use × to record
  that a message was seen and turned down.
- **A decision is permanent.** The first accept or reject on a message wins, and neither the QMS
  **Reset** nor marking the mail unread clears it. Re-testing the gate needs a fresh email.
- **Validation happens once, in the mailbox.** There is no second "Validate Query" button on the
  case page; the Front Office actions there are Forward, Transfer and Pullback. Accepting now
  **does** forward — ✓ registers the case and sends it to the Officer-in-Charge in one server call,
  and **Forward to Officer-in-Charge** on the case page survives only as the recovery path for a
  forward that failed during accept.
- **Attachments** now carry real bytes end to end: upload on the enquiry form, real MIME
  parts on outbound Gmail sends, downloaded bytes for inbound Gmail attachments, and full
  files on the Front Officer's forward to the Officer-in-Charge. See the checklist below.
  All three attachment routes require a session (`verifyToken` + `authorizeAttachmentAccess`);
  what they do not do is check the case, so any signed-in user can read any attachment by id —
  see `backend/README.md` "Security status".
- **The QMS needs a reachable database.** Cases live in MongoDB now, not in the browser, so any
  profile signed in as any role sees the same cases and you can move between Bhumika, Jatin and
  Neha in one browser or in several. The flip side: without Mongo `/api/v1/queries` answers 503
  and nothing is saved, so check the backend printed "MongoDB connected" before starting a run.

- **Only Bhumika's inbox is polled.** Jatin's is deliberately not read — the forwarded mail sitting
  there belongs to a case that already exists, and registering it would create a duplicate.
- **The mocked tail sends nothing.** Drafting and review steps are recorded in the QMS only; there
  is no Gmail trace for Neha, Amit or Kavita. Intended for this phase.
- **Gmail decides threading.** A reply Gmail places on a new thread (for instance after a heavily
  edited subject) is treated as a new enquiry.

## Live-Gmail attachment checklist

With `EMAIL_TRANSPORT=gmail`, `MAILBOX_SOURCE=gmail`, and `npm run gmail:preflight` clean:

1. From any external mail client, email bhoomikamakker@gmail.com attaching a PDF, a PNG and an
   XLSX.
2. **The sending account → Sent** contains the enquiry with all 3 attachments; open each from Gmail.
3. **Bhumika → Inbox** receives the mail with all 3 attachments intact.
4. Bhumika → **Check IPC mailbox** → the row shows a paperclip and the attachment count → click
   **✓** → open the case → Attachments tab shows all 3; the PDF and PNG preview in-app, the XLSX
   offers Download.
5. The forward went out as part of that ✓ — there is no second click.
6. **Jatin → Inbox** receives the forward with all 3 original files, each downloadable and
   openable, byte-identical to what the sender attached.
7. Deliberately delete one attachment's file on disk (`backend/storage/attachments/<id>.bin`)
   before accepting a *fresh* message with that attachment — the accept must report the forward as
   failed, naming the missing file, the case must stay at `FRONT_OFFICE_VERIFICATION` and Jatin's
   inbox must receive nothing for that attempt. The case still exists and the sender is still
   acknowledged: a failed forward is reported, not rolled back. Pressing **Forward to
   Officer-in-Charge** (or ✓ again) after restoring the file must then complete it.
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
