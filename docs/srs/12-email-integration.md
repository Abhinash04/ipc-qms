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

The intake audit order is therefore `QUERY_RECEIVED → QUERY_REGISTERED → AI_SUMMARY_GENERATED →
ACKNOWLEDGEMENT_SENT → QUERY_FORWARDED`, with `EMAIL_CLASSIFIED` written last when the controller
records the decision. `AI_SUMMARY_GENERATED` is recorded with `actorType: agent`, the status in its
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

Outbound dispatch mirrors this in reverse: an approved response is rendered into an email
and sent through the same provider, with delivery status recorded against the query. The response
body only — the case's attachments are **not** carried onto it, by either the automatic send or the
retry, and whether they should be is still open (§12.2, and srs/14 *Dispatch*).

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
- **Provider**: Which email service/API is the *production* one? Gmail (OAuth) and NICeMail
  (IMAP/SMTP) are both implemented and switchable by configuration; the decision is which one the
  deployment runs on, not which one to build.
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

**Three transports are selectable** by `EMAIL_TRANSPORT`, with `MAILBOX_SOURCE` choosing where
incoming enquiries are read from:

| Value | Sends via | Reads from | Status |
|---|---|---|---|
| `mock` | nothing leaves the machine | in-memory or MongoDB | default; what the test suite always uses |
| `gmail` | the Front Office Gmail account (one OAuth 2.0 refresh token) | the Front Officer's real Gmail inbox | working; depends on that refresh token |
| `nic` | NICeMail SMTP, one shared government mailbox | the NICeMail mailbox over IMAP, read-only | implemented; **awaiting an application-specific password** |

Under Gmail, **only the Front Office mailbox is authenticated**. It is the one account the system
reads from and sends as: acknowledgements, the forward to the Officer-in-Charge and the final
dispatch all go out as the Front Officer, and inbox polling uses the same token. So
`GMAIL_REFRESH_TOKEN_FRONT_OFFICE` is required when `EMAIL_TRANSPORT=gmail` and there is no
per-role equivalent — inquirers are external senders who authenticate to nothing here, and the
Officer-in-Charge is a recipient addressed by `OFFICER_IN_CHARGE_EMAIL`, never a sender. Any other
role falls back to the mock transport rather than borrowing another account's credentials; the QMS
never claims a `From` address it did not authenticate as. NICeMail is likewise one mailbox rather
than one account per role, so every role sends from the same configured address with the role
carried in the display name.

Outbound NICeMail is subject to a two-key interlock: selecting the transport is not sufficient, and
mail is confined to `NIC_TEST_RECIPIENT` until `NIC_ALLOW_OUTBOUND=true`. Selecting a transport
should not, by itself, be enough to start mailing the public from a `.gov.in` address.

### 12.3.1 NICeMail has a second, unrelated mechanism

Separate from the IMAP/SMTP transport above, a **browser agent** can attach over the Chrome
DevTools Protocol to a NICeMail web session that an operator has signed in to **by hand**. It
shares no code and no credential with the IMAP/SMTP path.

The agent can only ever attach: it never launches a browser, navigates to a login page, types a
credential or touches an OTP field. Authentication is the operator's responsibility and remains so.
Its code is loaded lazily, so a missing Chrome session cannot prevent the backend starting. With
`NIC_BROWSER_MAILBOX=true` it is also a second Front Office mailbox: a Front Office account that
signs in as `NIC_EMAIL` sees the NICeMail inbox, and the acknowledgement and final response of a case
accepted from it go out through the signed-in NICeMail tab — so for that mailbox it is in the request
path. Its selectors have not yet been calibrated against the live page. See
[backend/README.md](../../backend/README.md#nicemail-two-separate-mechanisms) and
[NIC_BROWSER_AGENT.md §17](../NIC_BROWSER_AGENT.md#17-two-front-office-mailboxes).

## 12.4 Attachments

Attachments are supported end-to-end: upload (`POST /api/v1/attachments`), real MIME
multipart on outbound Gmail sends, byte download of inbound Gmail attachments, and the
Front Officer's Forward to the Officer-in-Charge. See `backend/src/services/attachments/`.

The Forward-to-OIC path is **fail-closed**: if any attachment associated with the query
cannot be resolved (unknown id, missing bytes on disk, checksum mismatch), the forward is
aborted before any email is sent and returns `409` naming the unavailable attachment(s). The
Officer-in-Charge never receives a forward that looks complete but is silently missing a
document. When the forward runs as part of an accept, that abort is reported as
`forwarded: false` with the reason in `errors` — the case is still created and the sender still
acknowledged — and the case stays at `FRONT_OFFICE_VERIFICATION` for the manual forward to retry.

**Security note:** the attachment endpoints require a session and a role, but **not a relationship
to the case** — any authenticated user can read any attachment by id. See
[backend/README.md](../../backend/README.md#security-status-authenticated-but-not-yet-case-scoped)
for what is required before deployment.

**Attachments fail closed on send.** Every referenced file is verified (existence, bytes, SHA-256)
before an outbound message leaves; an unresolvable attachment aborts the send with a 409 naming it,
rather than delivering a message with documents silently missing.
