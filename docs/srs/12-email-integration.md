# 12. Email Integration

## 12.1 Architecture (Implemented)

```
Any external sender  ─┐
Any external sender  ─┼→  Front Office mailbox (one address, N:1)
Any external sender  ─┘
      ↓
Polled and LISTED — parsed for sender, subject, body, attachments
      ↓
   ╌╌╌╌╌╌╌╌ validation gate: a Front Officer accepts or rejects ╌╌╌╌╌╌╌╌
      ↓                                             ↓
 accept                                          reject
      ↓                                             ↓
ONE server call:                               decision recorded, nothing else
  • Case ID minted from the DB counter
  • Query created (RECEIVED)
  • ACCEPTED decision recorded
  • AI summary generated and stored on the case
  • Acknowledgement to the sender
  • Forward to the Officer-in-Charge, carrying that same summary
      ↓
Ready for assignment (PENDING_ASSIGNMENT)
```

**Arrival and registration are two stages, not one.** Polling the mailbox lists what is waiting and
creates nothing; a Query Case exists only because a human looked at the message and accepted it. An
advertisement and a genuine enquiry are indistinguishable to a filter, which is why there is no
sender filter and why the judgement is a person's.

**The acknowledgement is sent on accept** — to whoever actually wrote in, read off the incoming
`From` header. It is never sent on arrival, and never for a rejected message. A rejection creates no
case, no Case ID, no acknowledgement and no workflow; it records the decision and leaves the message
listed and traceable.

**Accepting is one action.** `POST /api/v1/mailbox/messages/:messageId/accept` mints the Case ID,
creates the case, records the `ACCEPTED` decision, acknowledges the sender **and forwards to the
Officer-in-Charge**, all in the same request, so an accepted case comes to rest at
`PENDING_ASSIGNMENT`. Forwarding used to be a second, explicit action on the case page; it is not a
second judgement in practice — every accepted enquiry goes to the Officer-in-Charge — and the gap
between the two clicks was a case sitting in `FRONT_OFFICE_VERIFICATION` that nobody had been told
about. The manual forward remains, but only to recover a forward that failed.

**The summary of the enquiry is made once, on accept, and stored.** Before the acknowledgement goes
out, the accept summarises the enquiry and writes the result onto `QueryCase.aiSummary`, then hands
that same object to the forward so the Officer-in-Charge's covering note and the case agree on what
the enquiry says. It used to be generated inside the forward, used for the covering note and
discarded: the case kept `aiSummary: null` while the audit trail recorded that a summary had been
generated. One model call now serves both.

The stored object carries its own honesty about where it came from:

```
aiSummary: { text, keyPoints, topics, aiGenerated, fallback, status, generatedAt, error }
status:    'GENERATED' | 'FALLBACK' | 'FAILED'
```

- `GENERATED` — the model answered.
- `FALLBACK` — the model did not answer (unreachable, timed out, or non-2xx) and the deterministic
  stand-in was used instead. This is an ordinary outcome, not an error: `generateSummary` degrades
  rather than throwing. On the current deployment the Gemma endpoint does not answer within
  `GEMMA_TIMEOUT_MS`, so accepted enquiries come back `FALLBACK`.
- `FAILED` — the call itself threw and there is nothing usable. Pressing ✓ again re-attempts only
  the summary; a `GENERATED` or `FALLBACK` summary already on the case is left alone.

The intake audit order is therefore `QUERY_RECEIVED → QUERY_REGISTERED → CASE_ASSOCIATED →
AI_SUMMARY_GENERATED → ACKNOWLEDGEMENT_SENT → QUERY_FORWARDED`, with `EMAIL_CLASSIFIED` written last
when the controller records the decision. `CASE_ASSOCIATED` is the row that ties the mailbox
message to the case it became, and only the accept whose insert created the case writes it. `AI_SUMMARY_GENERATED` is recorded with `actorType: agent`, the status in its
`aiMetadata`, and `result: failure` only for `FAILED` — a fallback is a success that says so.

**A failed summary costs nothing else.** The case, its Case ID, the acknowledgement and the forward
all still happen; `status: 'FAILED'` is stored with the reason and the step is named in `errors`.
Only a `GENERATED` or `FALLBACK` summary is handed to the forward, so after a `FAILED` one the
forward still makes its own attempt — audited separately, with `trigger: 'forward'` in its
`aiMetadata` — and omits the summary block from the covering note if that attempt yields nothing
either. A summary the forward makes for itself is not written back to the case.

The response is
`{ queryId, created, alreadyDecided, acknowledged, forwarded, aiSummaryStatus, errors }` and is
**HTTP 200 even when a step failed**: a case that exists but was not acknowledged or forwarded is a
recoverable state, and answering 500 would lose the Case ID with it. Retrying is safe — each step
looks for its own artefact (the decision, the inbound `EmailMessage`, an `ACKNOWLEDGEMENT` message,
a `FORWARD` message) before acting, so pressing ✓ again finishes what did not complete and sends
nothing twice. One incoming email can open exactly one case: `EmailMessage.sourceMessageId` carries
a unique **partial** index (`partialFilterExpression: { sourceMessageId: { $type: 'string' } }`),
which is enforcement by the database rather than by one browser tab's memory.

Outbound dispatch mirrors this in reverse: an approved response is rendered into an email and sent
back through the channel the case arrived in, with delivery status recorded against the query. The
response body only — the case's attachments are **not** carried onto it, by either the automatic send
or the retry, and whether they should be is still open (§12.2, and srs/14 *Dispatch*).

**Which channel a case's mail goes out through is the case's property, not the deployment's.** A case
stores `sourceMailbox` at intake, and all three of its emails — the acknowledgement, the forward to
the Officer-in-Charge and the final response — follow it. The rule is stated once, normatively, in
[backend/README.md](../../backend/README.md#which-channel-a-cases-mail-goes-out-through); it is not
restated here.

**It is sent by the server, on final approval, and nobody presses send.**
`POST /api/v1/queries/:queryId/final-approval` (`services/workflow/finalApproval.js`) records the
Officer-in-Charge's approval, sends the response and closes the case in one call. The
Officer-in-Charge's session authorises `FINAL_APPROVE`; the send itself is performed by the server
under the Front Office identity it already holds, so no role acquired the `DISPATCH` permission in
order to make this work. The response goes to the case's stored `inquirer.email` — the original
sender, read off the `From` header at intake — never to a configured address.

Two orderings hold. The approval is written **before** any mail is attempted, so a decision a person
made survives a mail server being down; and the case becomes `CLOSED` **only after** a send that
actually happened, so it can never read closed while the inquirer heard nothing. A failed send
leaves the case at `READY_FOR_DISPATCH` with an `EMAIL_SEND_FAILED` audit row carrying the
`queryId`, and the Front Office **Retry sending response** control — gated on `DISPATCH` as it
always was — is the recovery path. Retrying completes the send without recording a second approval,
and the stored `OUTGOING_RESPONSE` message ensures the inquirer is never emailed twice.

A transport that silently degrades to the mock is treated as a **failure** rather than a delivery,
unless `EMAIL_TRANSPORT=mock` is what the deployment configured. `getTransport` falls back to the
mock when a role holds no usable credential and the mock returns an ordinary success, so without
that check a missing or revoked Front Office credential would close cases having sent nothing.

## 12.2 Open Items (Client Clarification Required)

- **Ingestion**: Automatic (mailbox polling/webhook) or manual (Front Office pastes/uploads
  the email)? — **Resolved in implementation** (12.1): both, split. Polling is automatic but only
  *lists*; registration is manual — the Front Officer decides what becomes a case.
- **Provider**: Which email service/API is the *production* one? — **Re-resolved in implementation**:
  NICeMail. The Gmail transport, its inbox reader and its OAuth configuration have been deleted;
  what remains is NICeMail, reached two ways — an operator-signed-in browser session (the working
  channel) and IMAP/SMTP (awaiting an application-specific password) — with `mock` for development.
  Client confirmation of the production choice is still outstanding; see
  [14-open-questions-and-client-clarifications.md](./14-open-questions-and-client-clarifications.md#email).
- **Threading**: Should follow-up emails on the same query thread attach to the existing
  Query record, or always create a new one?
- **Incoming replies**: If an inquirer replies mid-workflow, how should that be handled —
  new query, or appended to the existing one?
- **Outgoing automation**: ~~Should dispatch send automatically on final approval, or require a
  Front Office confirmation step first?~~ — **Decided by the user: automatically on final
  approval**, and implemented that way (12.1). There is no Front Office confirmation step; Front
  Office keeps the `DISPATCH` permission as the retry path. As a change to what
  [04-functional-requirements.md](./04-functional-requirements.md) records as a confirmed
  requirement, it still wants the client's sign-off — see
  [14-open-questions-and-client-clarifications.md](./14-open-questions-and-client-clarifications.md#dispatch).

## 12.3 Current Implementation

Email ingestion and dispatch exist; see `backend/src/services/email/`. Sections above describing
"None" predate that work and cover the parts of this document (threading rules, provider choice
already made) that remain otherwise unrevised.

**Two transports are selectable** by `EMAIL_TRANSPORT`, with `MAILBOX_SOURCE` choosing where
incoming enquiries are read from:

| Value | Sends via | Reads from | Status |
|---|---|---|---|
| `mock` | nothing leaves the machine | in-memory or MongoDB | default; what the test suite always uses |
| `nic` | NICeMail SMTP, one shared government mailbox | the NICeMail mailbox over IMAP, read-only | implemented; **awaiting an application-specific password** |

`EMAIL_TRANSPORT` accepts nothing else, and `MAILBOX_SOURCE` accepts only `auto` and `nic`. A Gmail
transport and Gmail inbox reader existed through the development phase, authenticated as the Front
Office account with one OAuth 2.0 refresh token; they, the OAuth variables and the `googleapis`
dependency have all been deleted. Nothing here reads a personal mailbox any more.

NICeMail is **one mailbox rather than one account per role**, so every role sends from the same
configured address with the role carried in the display name. Inquirers are external senders who
authenticate to nothing here, and the Officer-in-Charge is a recipient addressed by
`OFFICER_IN_CHARGE_EMAIL`, never a sender. A role holding no usable credential falls back to the mock
transport rather than borrowing another account's; the QMS never claims a `From` address it did not
authenticate as.

The mailbox address is environment-driven (`NIC_EMAIL`) and hardcoded nowhere: it is a test mailbox
today and `lab.ipc@gov.in` in production, so moving over is a one-variable change.

Outbound NICeMail is subject to a two-key interlock: selecting the transport is not sufficient, and
every real send is confined to one test recipient until `NIC_ALLOW_OUTBOUND` is the exact string
`true`. Selecting a transport should not, by itself, be enough to start mailing the public from a
`.gov.in` address. `NIC_ALLOW_INTERNAL_FORWARD=true` additionally opens exactly one more address —
`OFFICER_IN_CHARGE_EMAIL`, re-derived server-side and never taken from a request — for the forward
alone. It is a **recipient allowance, not a second channel**, and it applies to the **browser channel
only**: the SMTP transport checks recipients against `NIC_TEST_RECIPIENT` alone and never reads it.

### 12.3.1 NICeMail has a second, unrelated mechanism

Separate from the IMAP/SMTP transport above, a **browser agent** can attach over the Chrome
DevTools Protocol to a NICeMail web session that an operator has signed in to **by hand**. It
shares no code and no credential with the IMAP/SMTP path.

The agent can only ever attach: it never launches a browser, navigates to a login page, types a
credential or touches an OTP field. Authentication is the operator's responsibility and remains so.
Its code is loaded lazily, so a missing Chrome session cannot prevent the backend starting. It is
never selected by `EMAIL_TRANSPORT`. With `NIC_BROWSER_MAILBOX=true` it is a second Front Office
mailbox: a Front Office account (`USR-0014`) signs in as `NIC_EMAIL` and sees the NICeMail inbox, and
**all three** emails of a case accepted from it — acknowledgement, forward to the Officer-in-Charge
and final response — go out through the signed-in NICeMail tab, so for that mailbox it is in the
request path. The reading selectors and the compose form are calibrated and verified against the live
mailbox; the attachment-reading keys and `ccToggle` are not, and the agent refuses an uncalibrated
key before the page is touched. See
[backend/README.md](../../backend/README.md#nicemail-two-separate-mechanisms) and
[NIC_BROWSER_AGENT.md §17](../NIC_BROWSER_AGENT.md#17-two-front-office-mailboxes).

## 12.4 Attachments

Attachments are supported end-to-end: upload (`POST /api/v1/attachments`), real MIME
multipart on outbound SMTP sends, file upload into the compose form on a browser-session send, and
the Front Officer's Forward to the Officer-in-Charge. See `backend/src/services/attachments/`.
Inbound NICeMail attachments are **metadata only** — `nicImap` records name, type and size and does
not download the bytes, and the browser agent's attachment-reading selectors are still uncalibrated.

The Forward-to-OIC path is **fail-closed**: if any attachment associated with the query
cannot be resolved (unknown id, missing bytes on disk, checksum mismatch), the forward is
aborted before any email is sent and returns `409` naming the unavailable attachment(s). The
Officer-in-Charge never receives a forward that looks complete but is silently missing a
document. When the forward runs as part of an accept, that abort is reported as
`forwarded: false` with the reason in `errors` — the case is still created and the sender still
acknowledged — and the case stays at `FRONT_OFFICE_VERIFICATION` for the manual forward to retry.

**Security note:** the attachment endpoints are case-scoped.
`middleware/authorizeAttachmentAccess.js` resolves an attachment's owning case — through the message
it arrived on, when the attachment predates the case — and admits only a principal party to it; one
with no case yet is readable by its uploader and by the roles that see everything. It fails closed
with 503 when there is no store. See
[backend/README.md](../../backend/README.md#security-status-authenticated-and-case-scoped)
for what is still required before deployment.

**Attachments fail closed on send.** Every referenced file is verified (existence, bytes, SHA-256)
before an outbound message leaves; an unresolvable attachment aborts the send with a 409 naming it,
rather than delivering a message with documents silently missing.
