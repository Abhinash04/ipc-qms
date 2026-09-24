# Manual Mail Test Procedure

What a person has to check by hand, because no automated test can: that mail really arrives in a real
mailbox, that the addresses on it are the right ones, and that the backend log says where a send
stopped when one does.

**This is the residue, not the whole suite.** Everything that *can* be automated already is — read
[`Tests`](../backend/README.md#tests) first, and do not repeat by hand what these already prove:

| Already covered | Where |
|---|---|
| Accept opens one case, acknowledges, forwards | `e2e/mailboxAccept.spec.js` |
| Reject creates nothing | `e2e/mailboxAccept.spec.js` |
| Two inquirers, one mailbox, two separate cases | `e2e/twoInquirers.spec.js` |
| The full lifecycle to `CLOSED`, and a failed send that leaves the case open | `e2e/lifecycle.spec.js` |
| One response however many times dispatch is pressed | `e2e/dispatchIdempotency.spec.js` |
| Attachment size, type and fail-closed resolution | `backend/src/test/attachment*.test.js` |

Signing in to NICeMail is the operator's job, by hand, in their own browser. Nothing here automates
a login, and nothing here asks for a mailbox password — see
[`NIC_BROWSER_AGENT.md`](./NIC_BROWSER_AGENT.md).

---

## The three postures

Which one you are testing changes what you should see, and mixing them up is the usual cause of a
confusing run.

| Posture | Configuration | What leaves the machine |
|---|---|---|
| **Mock** | `EMAIL_TRANSPORT=mock`, `MAILBOX_SOURCE=auto` | Nothing. Sends are recorded as delivered and deposited into the local mock inbox, so the enquiry → ingestion loop closes without a network. |
| **NICeMail browser agent** | `NIC_BROWSER_MAILBOX=true`, `NIC_EMAIL` set, a signed-in Chrome on `NIC_CDP_ENDPOINT` | Real mail, from the NICeMail mailbox, for cases that arrived in it — **held to the interlock**, below. |
| **NICeMail SMTP** | `EMAIL_TRANSPORT=nic`, the `NIC_IMAP_*`/`NIC_SMTP_*` block, an app password | Real mail over SMTP, for every case that did *not* arrive through the agent. |

The last two are not alternatives: a deployment can run both, and which one a given case uses is
decided by the mailbox its enquiry arrived in, never by a global setting. That rule is stated once,
in [`backend/README.md`](../backend/README.md#which-channel-a-cases-mail-goes-out-through).

### The interlock — read before any real send

`NIC_ALLOW_OUTBOUND` is a second key on a government mailbox. Until it is the exact string `true`,
**every** real send is confined to one test recipient (`NIC_BROWSER_TEST_RECIPIENT`, or
`NIC_TEST_RECIPIENT` for SMTP), and a send to anybody else is refused *before* it is attempted.

That refusal is deliberate and is not a retryable failure. With the interlock closed you should
expect intake to stop at the forward, because the Officer-in-Charge is not the test recipient —
unless you also set `NIC_ALLOW_INTERNAL_FORWARD=true`, which opens exactly
`OFFICER_IN_CHARGE_EMAIL`, for the forward alone.

**Never open `NIC_ALLOW_OUTBOUND` to run a test.** Point
`NIC_BROWSER_TEST_RECIPIENT` at an address you own and send to that.

---

## Who is who

No seeded account can receive mail: the directory in `backend/src/constants/users.js` is entirely on
`@ipc.example`, which RFC 2606 reserves. Where mail actually goes is deployment configuration.

| Part | Who | Where their address comes from |
|---|---|---|
| The inquirer | a member of the public | nothing — read off the `From` header at intake. **They hold no QMS account and never sign in.** |
| Front Office | signs in, works the inbox | `FRONT_OFFICE_EMAIL`, or `NIC_EMAIL` for the NICeMail Front Office (`USR-0014`) |
| Officer-in-Charge | recipient of the forward; assigns; approves | `OFFICER_IN_CHARGE_EMAIL`. Nothing ever sends *as* this role |
| Assigned Official, Reviewers | draft and review | nothing — no mail is sent on their behalf at all |

> **Two similar names, two different people.** The Officer-in-Charge and one of the Assigned
> Officials have names that are transpositions of each other (`USR-0003` and `USR-0009`). They are
> distinct accounts with distinct addresses and roles, and `realIdentities.test.js` keeps them so.

Each account signs in with **its own** password, from `QMS_PASSWORDS_FILE` or
`QMS_PASSWORD_<USER_ID>`. There is no single password that opens the system.

---

## Part 1 — the three-inbox walkthrough

```bash
cd backend  && npm start      # must print "listening on port 5000"
cd frontend && npm run dev    # http://localhost:5173
```

To start clean: **Reset** in the header clears the QMS workflow domain, and is rendered for the
**Super Admin only**, matching `POST /api/v1/queries/reset`. Local state is cleared only once the
server has accepted the reset. From a terminal, `cd backend && npm run db:reset` does the same
against the database (`--dry-run` to see what would go).

**Reset does not undo a decision.** `MailboxDecision` is keyed by the provider's message id and
survives both the reset and anything you do to the mail itself — the first decision on a message
wins, permanently. To exercise the gate again, **send a fresh email**.

| # | Sign in as | Do this | The mailboxes should show | QMS should show |
|---|---|---|---|---|
| 1 | — (any mail client) | Email the enquiry to the Front Office address **from any external address**. No QMS account is needed | it arrives in the Front Office inbox | — |
| 2 | Front Office | **IPC Mailbox** → Check IPC mailbox | — | the message listed with the real sender and **Awaiting validation**. **No case, no Query ID, no acknowledgement** — checking registers nothing |
| 3 | Front Office | Click **✓** on that row → confirm **Yes**. This is the whole intake: one click, one server call | **Sent**: the acknowledgement **and** `Fwd: … [QRY-…]`. **The sender's inbox**: the acknowledgement. **The Officer-in-Charge's inbox**: the forward | the case created; state **`PENDING_ASSIGNMENT`**; audit in this order: QUERY RECEIVED, QUERY REGISTERED, AI SUMMARY GENERATED, ACKNOWLEDGEMENT SENT, QUERY FORWARDED, EMAIL CLASSIFIED |
| 4 | Front Office | Open the case — **nothing to do here**. Confirm the thread | — | _Original enquiry → Acknowledgement → Forwarded to Officer-in-Charge_. **Forward to Officer-in-Charge** is present but is only the recovery path, for a forward that failed at step 3 |
| 5 | Officer-in-Charge | **Assignments** → open the case | — | original enquiry, acknowledgement, forward, AI summary, audit trail, state |
| 6 | Officer-in-Charge | Accept or override the AI recommendation | — | state `ASSIGNED`; same Query ID |
| 7 | Assigned Official | **Drafting** → Start drafting → edit → Save | **nothing** — no mail is ever sent on this role's behalf | v1 and v2 both retained |
| 8 | Assigned Official | Add two review levels → Submit for review | — | state `UNDER_REVIEW` |
| 9 | Reviewer I, then Reviewer II | **Reviews** → Approve each | — | state `PENDING_FINAL_APPROVAL` |
| 10 | Officer-in-Charge | **Approvals** → Grant final approval. The whole dispatch: one click, nobody presses send | **Sent**: the response. **The original sender's inbox**: they receive it | approved version locked; `READY_FOR_DISPATCH` → `DISPATCHED` → `CLOSED`; audit: FINAL APPROVAL GRANTED, RESPONSE DISPATCHED, QUERY CLOSED. If the send fails the approval still stands and the case waits at `READY_FOR_DISPATCH` |
| 11 | Front Office | **Dispatch** → open the case — **nothing to do here** | — | **Response sent automatically**, when and to whom, and *Query closed*. **Retry sending response** appears only if step 10 reported a failure |

There is **no in-app form for raising an enquiry**, for any role. Step 1 is the only way in, which is
the point: an enquiry is an email from outside.

### What to compare at the end

```
QRY-2026-00001            ← one id, from step 3 through step 11
├── Original Query        the external sender → Front Office
├── Acknowledgement       Front Office       → the external sender
├── Forward               Front Office       → Officer-in-Charge
└── Final Response        Front Office       → the external sender
```

All four carry the **same Thread ID**. The audit trail names the staff by their own names, and the
inquirer by the address the mail actually came from.

### Worth trying deliberately

- **Press "Check IPC mailbox" twice.** Neither press creates anything.
- **Double-click ✓.** One case, one acknowledgement, one forward. A second press finishes only what
  did not complete the first time.
- **Send from a second, unrelated address.** It must appear too — a mailbox read filters on recipient
  only, so an enquiry from a stranger is never silently discarded.
- **Double-click Approve.** One email. The dispatch ledger holds a unique key per case email, so a
  press that gets past the disabled button — or a second officer in another tab — is answered
  *already sent*.
- **Check which kind of summary you got.** The `AI_SUMMARY_GENERATED` audit row carries the status:
  `GENERATED` when the model answered, `FALLBACK` when the deterministic stand-in was used, `FAILED`
  when the call threw. Only a `FAILED` summary is re-attempted on a second ✓.
- **Have the sender reply to the acknowledgement.** Accepting the reply must attach it to the
  existing case, not create a second one.
- **Open another role's URL** while signed in as someone else → "Access restricted", not a page.
- **Refresh mid-workflow.** Session and case both survive; the Query ID does not change.

---

## Part 2 — the NICeMail browser agent

Only this posture can be got wrong in ways a test cannot see, because it drives a real signed-in web
session.

**Before you start** — the operator's prerequisites, none of which the application can do:

1. `chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\qms-chrome` (a non-default
   `--user-data-dir` is required on Chrome 136+), then **sign in to NICeMail by hand** in that
   window. The port must be free: another Chromium browser holding 9222 answers the connection
   without speaking CDP.
2. `cd backend && npm run nic:browser:discover` — read-only. It must report the mailbox document and
   how each selector resolves.
3. `npm run nic:browser:calibrate` before any run that involves an **attachment**. The attach
   control is still in `UNCALIBRATED`, and the agent refuses an uncalibrated selector before it
   touches the page — so an accept of a case with an attachment fails at the forward until this has
   been run. See [§17](./NIC_BROWSER_AGENT.md#calibrating-the-selectors).

Then run Part 1, signing in as the **NICeMail** Front Office (`USR-0014`, which signs in as
`NIC_EMAIL`), and watch the agent's own tab rather than the operator's.

### What the backend log should say

Each case email logs `<TAG> START`, then its stages, then `<TAG> RESULT`, where `<TAG>` is `ACK`,
`FORWARD` or `RESPONSE`. Every line carries the `caseId`.

```
ACK START      {"caseId":"QRY-2026-00001","recipients":["…"],"subject":"…","transport":"nic-browser"}
ACK NIC BROWSER {"caseId":"…","step":"compose_started"}      ← up to and including the press of Send
ACK NIC BROWSER {"caseId":"…","step":"from_verified","from":"…"}
ACK NIC BROWSER {"caseId":"…","step":"recipients_verified"}
ACK NIC BROWSER {"caseId":"…","step":"subject_verified","subject":"…"}
ACK NIC BROWSER {"caseId":"…","step":"body_verified","heldLength":412,"expectedLength":412}
ACK NIC BROWSER {"caseId":"…","step":"send_clicked"}
ACK VERIFICATION {"caseId":"…","step":"compose_closed","afterMs":1840}   ← after the press
ACK VERIFICATION {"caseId":"…","step":"sent_found","providerMessageId":"…"}
ACK RESULT     {"caseId":"…","status":"SENT","providerMessageId":"…"}
```

Three things to check, in order:

- **`from_verified` names the mailbox you expect.** The agent checks the From line before typing a
  recipient, so a session signed in to the wrong account fails here rather than sending from it.
- **`body_verified` has `heldLength` equal to `expectedLength`.** A mismatch means the editor did not
  hold what was typed.
- **The stage the line stops at is the stage that failed.** Anything before `send_clicked` sent
  nothing and is safe to retry once the cause is fixed. From `send_clicked` onward the message may
  have gone: the result is `UNCERTAIN`, **check the NICeMail Sent folder before retrying**, then
  record *It was sent* / *It was not sent* on the case page.

**No `UNCERTAIN` send settles itself.** Nothing searches the Sent folder for you — a person answers,
or the case sits at `READY_FOR_DISPATCH` and nothing escalates it.

And what it should **not** say:

- No Mongoose deprecation warnings. `mongooseOptions.test.js` fails the build if one returns.
- No credential, cookie, token or password in any line: `sendTrace` drops a key that looks like one
  whatever its value. Grep a run's log for your own mailbox's name and expect nothing.
- A Gemma failure must name its cause (`fetch failed (ENOTFOUND …)`) rather than falling back in
  silence. A `FALLBACK` summary during an outage is the outage, not a misconfiguration.

---

## Attachment checklist

Run `npm run nic:browser:calibrate -- --attach` first, or the forward will refuse.

1. From an external client, email the Front Office address attaching a PDF, a PNG and an XLSX.
2. The sending account's **Sent** contains all three; open each.
3. The Front Office inbox receives them intact.
4. **IPC Mailbox** → the row shows a paperclip and the count → **✓** → open the case → Attachments
   shows all three; the PDF and PNG preview in-app, the XLSX offers Download.
5. The forward went out as part of that ✓ — there is no second click.
6. The Officer-in-Charge receives the forward with all three files, byte-identical to what was sent.
7. **The fail-closed check.** Delete one attachment's bytes on disk
   (`backend/storage/attachments/<id>.bin`) before accepting a *fresh* message carrying it. The
   accept must report the forward as **failed, naming the missing file**; the case must stay at
   `FRONT_OFFICE_VERIFICATION`; and the Officer-in-Charge must receive **nothing** for that attempt —
   not a message with the file silently missing. The case still exists and the sender is still
   acknowledged: a failed forward is reported, not rolled back. Restore the file and press **Forward
   to Officer-in-Charge** to complete it.

---

## Known limitations — observed by hand

- **Everything addressed to the Front Office is listed, from anyone.** A mailbox read filters on
  recipient only, with no sender filter, so an enquiry from an unknown member of the public is never
  discarded before it is seen. The price is that unrelated mail to that address is listed too.
  Nothing becomes a case without a ✓; use × to record that a message was seen and turned down.
- **A decision is permanent.** The first accept or reject on a message wins, and neither Reset nor
  anything done to the mail clears it. Re-testing the gate needs a fresh email.
- **Validation happens once, in the mailbox.** There is no second "Validate Query" button on the case
  page. Accepting forwards; **Forward to Officer-in-Charge** there is only the recovery path.
- **Only the Front Office inbox is read.** The Officer-in-Charge's is deliberately not polled — the
  forwarded mail sitting in it belongs to a case that already exists, and reading it would create a
  duplicate.
- **The drafting and review steps send nothing.** No mail is sent on behalf of an Assigned Official
  or a Reviewer at all. Intended.
- **The provider decides threading.** A reply the provider places on a new thread — after a heavily
  edited subject, for instance — is treated as a new enquiry.
- **The attach control is uncalibrated.** Until `nic:browser:calibrate -- --attach` has been run,
  every accept of a case carrying an attachment fails at the forward. The agent refuses the selector
  rather than guessing, which is the right failure but is a failure.
- **A QMS "mark read" does not mark the message read in NICeMail.** Read state is QMS's own; the
  server answers 409 for a mailbox that keeps none.
- **The QMS needs a reachable database.** Without Mongo, `/api/v1/queries` answers 503 and nothing is
  saved. Check the backend printed "MongoDB connected" before a run.
- `ipc-query-mock@example.com` is the mock address and **can never receive mail**: `example.com` is
  reserved with a null MX, so anything sent there bounces. Deliberate.

## Switching back

Set `EMAIL_TRANSPORT=mock`, `MAILBOX_SOURCE=auto`, `NIC_BROWSER_MAILBOX=false` and
`NIC_ALLOW_OUTBOUND=false`, then restart the backend. Nothing then leaves the machine.

## Mailbox persistence

With `MAILBOX_SOURCE=auto` the mailbox is stored in MongoDB when reachable and **survives a restart**;
ids stay sequential (`MSG-00001`, …) via a counter document. Without Mongo the backend still starts
and falls back to an in-memory mailbox, **cleared on every restart**. Every mailbox API response
reports which store served it in `persistence`.
