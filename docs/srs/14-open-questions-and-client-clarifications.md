# 14. Open Questions and Client Clarifications

Every item below is tagged:

- **Confirmed Requirement** — stated directly by the client/spec, safe to build against.
- **Proposed Design** — our recommendation, not yet confirmed by the client.
- **Client Clarification Required** — genuinely open; must not be assumed.

## Email

- Automatic or manual email ingestion? — **Resolved in implementation**: both, at different stages. The mailbox is polled automatically, but only to *list* what is waiting; registration is manual. A Front Officer accepts or rejects each message, and only an accepted one becomes a case. See the intake section below.
- Which email provider/API? — ~~**Resolved in implementation**: Gmail API (OAuth2) with a mock transport for development. **One mailbox is authenticated — the Front Office's** — because it is the only account the system reads from and sends as; inquirers are external and authenticate to nothing. A NICeMail (`@gov.in`) IMAP/SMTP path is built and selectable, awaiting an application-specific password.~~ — **✅ Re-resolved 2026-09-23: NICeMail.** The Gmail transport, the Gmail inbox reader, the OAuth variables, the `googleapis` dependency and the `gmail:preflight` script have all been **deleted**; `EMAIL_TRANSPORT` accepts only `mock` and `nic`, and `MAILBOX_SOURCE` only `auto` and `nic`. NICeMail is now reached two ways. The **browser agent is the primary channel**: with `NIC_BROWSER_MAILBOX=true` a second Front Office mailbox is read and answered through a Chrome session an operator signed in to by hand, over CDP, and it is verified working against the live mailbox. **IMAP/SMTP is available but not yet proven** — the transport is written and selectable, and still awaiting an application-specific password; see [../NIC_EMAIL_PHASE0.md](../NIC_EMAIL_PHASE0.md). The mailbox address is environment-driven (`NIC_EMAIL`): a test mailbox today, `lab.ipc@gov.in` in production. Client confirmation of the production choice is still outstanding.
- Does the system need email threading (replies attach to the same query)? — **Resolved in implementation**: yes, threading is implemented (RFC 5322 headers, provider thread ids); a reply attaches to the existing case rather than opening a new one.
- How should an incoming reply mid-workflow be handled? — *Client Clarification Required*
- ~~Should outgoing dispatch email be automatic on approval, or require a Front Office confirmation step?~~ — **✅ Decided by the user: automatic on approval.** Granting final approval sends the response; there is no Front Office confirmation step. See *Automatic final dispatch* and [Dispatch](#dispatch) below.
- Email is the primary intake source for the sample query. — *Confirmed Requirement* (per spec example)

### Acknowledgement email (built, user-directed)

An automatic acknowledgement is now sent to the inquirer as soon as an ingested email becomes a
Query Case, using the client-supplied template, recorded on the same email thread and audited as
`ACKNOWLEDGEMENT_SENT`. It was built at the user's explicit direction.

- An acknowledgement email is sent on intake. — *Proposed Design* (user-directed). It appears
  nowhere in the SRS: not in [12-email-integration.md](./12-email-integration.md), not in
  [09-audit-and-compliance.md](./09-audit-and-compliance.md), and not in the §5.2 workflow
  diagram. [10-notifications.md](./10-notifications.md) in fact asks whether inquirers receive
  *any* system notification beyond the final response, which forecloses assuming this.
- `ACKNOWLEDGEMENT_SENT` as an audit event. — *Proposed Design*. The audit catalog in
  [09-audit-and-compliance.md](./09-audit-and-compliance.md) is closed at 16 events; this is one
  of the additions requiring sign-off.
- Should the inquirer receive an acknowledgement at all? — *Client Clarification Required*
- Should it be sent on receipt, or only after Front Office has verified the query is genuine?
  Sending on receipt means spam and misdirected mail also get a reply. — *Client Clarification Required*
- The acknowledgement carries the Query ID in its subject (`… [QRY-2026-00001]`). Is exposing the
  internal id to an external inquirer acceptable? — *Client Clarification Required*
- Reply handling is unchanged and still open: the acknowledgement says "do not reply", but nothing
  processes a reply if one arrives. — *Client Clarification Required*

### Real multi-account Gmail identities (development phase, user-directed) — HISTORY

> **2026-09-23.** Gmail is gone: the transport, the inbox reader, the OAuth variables and the
> `googleapis` dependency have all been deleted, and every seeded address is now on `@ipc.example`,
> which RFC 2606 reserves and which cannot receive mail. This section is kept because it records the
> arrangement that was actually run during development, and because **its privacy concern transfers
> intact** — see *Reading a stakeholder's mailbox* below. Read the rest of this section in the past
> tense.

**One** account authenticated: the Front Office mailbox. It was the only address the system read
from and the only one it sent as.

This section had previously described three authenticated accounts — an inquirer, the Front Officer
and the Officer-in-Charge. That arrangement was already gone by then. Inquirers are **external**:
anyone may write in from their own mail client, and there is no configured inquirer address at all.
Nothing sends as the Officer-in-Charge either; that role is a recipient, addressed by
`OFFICER_IN_CHARGE_EMAIL`. Every other identity was mock.

- **Enquiries are addressed to the Front Officer**, not to a shared IPC mailbox. The SRS describes
  a single IPC query mailbox (`lab.ipc@gov.in`), not a named officer. This is a development
  arrangement for the multi-account test. — *Proposed Design* (user-directed)
- **The acknowledgement, the forward and the final response are all sent by the Front Officer
  personally**, replacing the `AR&D Division` departmental sender in
  [12-email-integration.md](./12-email-integration.md). Is a named individual an acceptable sender
  for official IPC correspondence, or must it remain a departmental address? — *Client
  Clarification Required*
- **Forwarding to the Officer-in-Charge is now a real email** with its own message record
  (`EMAIL_TYPE.FORWARD`) on the same thread. The SRS treats forwarding as a workflow transition
  only and does not mention an email. — *Proposed Design*
- **Reading a stakeholder's mailbox.** With `MAILBOX_SOURCE=gmail` the system polled the Front
  Officer's inbox with `gmail.modify`, which granted access to her entire personal mailbox and let
  the system mark messages read. In production this should be a delegated/service mailbox, not a
  personal account. — *Client Clarification Required*
  > **The concern transfers intact (2026-09-23).** Deleting Gmail did not answer this question, it
  > moved it. With `NIC_BROWSER_MAILBOX=true` the QMS reads and answers a whole **live government
  > mailbox** through a **person's own signed-in Chrome profile**, over CDP on `localhost:9222`. The
  > agent never signs in and holds no credential — authentication is the operator's, by hand — but
  > the session it borrows is that person's, and its reach is the whole mailbox, not a scoped
  > delegation. Two things narrow the blast radius and neither is an answer: reads are throttled
  > (`NIC_BROWSER_SYNC_TTL_MS`, `NIC_BROWSER_SYNC_MAX`) because every message opened is a real page
  > interaction in somebody's mailbox, and sends are confined to one test recipient until
  > `NIC_ALLOW_OUTBOUND` is the exact string `true`. Whether a delegated or service mailbox is
  > required before production remains **Client Clarification Required**.
- **Only the Front Officer's inbox is polled.** Mail arriving in the Officer-in-Charge's inbox is
  never registered, because it belongs to a case that already exists. If OIC-initiated enquiries
  must also become cases, that is a separate intake path. — *Client Clarification Required*
- **Thread-level attachment.** A later message on an existing provider thread (typically an
  inquirer's reply) is attached to the existing query as further correspondence, with a
  `QUERY_RECEIVED` audit entry and no workflow transition. The SRS says nothing about mid-workflow
  replies — [srs/14 Email](#email) still lists that as open. — *Proposed Design*

### Front Office intake (user-directed) — ✅ RESOLVED

Two questions in this section were open because intake ran unattended. Both are now settled by
implementation, and the answers went the way the SRS assumed.

- ~~**Verification happens automatically** rather than by a human click … Is unattended intake
  acceptable, or must Front Office remain a human gate?~~
  **✅ Resolved: Front Office is a human gate.** Arriving mail is listed and creates nothing. The
  Front Officer accepts or rejects each message in the IPC Mailbox; accepting is what registers the
  case, mints the Case ID, acknowledges the sender and forwards to the Officer-in-Charge. The
  `QUERY_REGISTERED` audit event now records a judgement somebody actually made.
- ~~**Only mail from a known inquirer address opens a case.** … In production, intake presumably must
  accept mail from any member of the public.~~
  **✅ Resolved: intake accepts mail from anyone.** The sender allow-list is gone; a mailbox read
  filters on the recipient only. Intake is N:1 — many external inquirers, one Front Office mailbox
  (two with the optional NICeMail browser mailbox, each with its own Front Officer) —
  and the inquirer on a case is read off the incoming `From` header. What protects the Front
  Officer's private mail is no longer a filter but the gate: nothing becomes a case unaided.
- **Forwarding to the OIC still sends a real email**, and is now **part of the accept** rather than
  a separate explicit action after it: ✓ registers the case and forwards it in one server call, so
  an accepted case lands at `PENDING_ASSIGNMENT`. The manual **Forward to Officer-in-Charge** action
  survives only to recover a forward that failed. The SRS treats forwarding as a workflow transition
  and describes no email. — *Proposed Design* (user-directed)
- **Rejection has no SRS counterpart.** A rejected message records who rejected it, when and why,
  and creates no case. `05-workflow-and-state-machine.md` models the case lifecycle and has nothing
  to say about mail that never became a case. — *Proposed Design*
- **Attachments are metadata only** (name, type, size); content is never downloaded or stored.
  [13-data-model.md](./13-data-model.md) leaves the `WorkflowAttachment` field list open. —
  *Proposed Design*

### Automatic final dispatch (user-directed) — ✅ RESOLVED

Granting final approval sends the response and closes the case. The Front Officer presses nothing on
the normal path.

This document previously disagreed with itself: whether an unattended dispatch is acceptable was
listed as open here, while [Dispatch](#dispatch) recorded the opposite answer — Front Office
dispatches — as a *Confirmed Requirement*. **The user has decided: the server sends automatically
on final approval.** The Dispatch entry below keeps what the requirement was and names what
superseded it.

It is one server endpoint — `POST /api/v1/queries/:queryId/final-approval`
(`backend/src/services/workflow/finalApproval.js`) — gated `verifyToken` +
`verifyAction(FINAL_APPROVE)` + `validateBody(finalApprovalSchema)`, answering
`{ queryId, approved, dispatched, alreadyDispatched, workflowState, recipient, errors }` at HTTP
200 even when the send failed.

- **Dispatch is no longer a Front Office action on the normal path.** The Dispatch page is a status
  view with a retry, used only when the automatic send did not complete. — *Proposed Design*
  (user-directed)
- ~~**The automatic send runs as a system action.** It executes in the approving OIC's session, so
  it carries no actor and is gated on the workflow state alone rather than on the Front Office
  `DISPATCH` permission.~~
  **✅ Resolved: the send moved to the server, and no role gained `DISPATCH`.** That arrangement
  never worked. The client had been widened to allow an "actorless system dispatch", but the server
  never was and could not be: the request still carried the Officer-in-Charge's session cookie, and
  `POST /emails/response` is gated on `DISPATCH`, which belongs to Front Office. Every approval
  ended in **403**, with the case stranded at `READY_FOR_DISPATCH` and the inquirer never answered.
  The Officer-in-Charge's session now authorises `FINAL_APPROVE`, which is theirs, and the
  **server** performs the send under the Front Office identity it already holds. The permission
  table is unchanged.
- **Is an unattended dispatch, with no Front Office review of the outgoing message, acceptable?** —
  **✅ Decided by the user: yes.** The response goes out on approval without a second human gate.
  The review that precedes it is the review ladder and the Officer-in-Charge's own approval.
- **No dispatch-failure state exists.** A failed send still leaves the case at `READY_FOR_DISPATCH`
  — approved, response locked, never `CLOSED` — and the error surfaces for retry. The SRS's 16
  audit events contain no `DISPATCH_FAILED`, and none was invented. What changed is that the
  failure is now **recorded against the case**: an `EMAIL_SEND_FAILED` row carrying the `queryId`,
  where the transport's own failure rows carry none and so cannot be traced back to what failed.
  Should a failed dispatch be an explicit state with its own audit event? — *Client Clarification
  Required*
- **The approval is recorded before any mail is attempted, and the case closes only after a send
  that actually happened.** A decision a person made must survive a mail server being down; a case
  reading `CLOSED` while the inquirer received nothing is the worse failure, because nobody goes
  looking for it. — *Proposed Design*
- **A transport that silently degrades to the mock counts as a failure**, unless `EMAIL_TRANSPORT`
  is `mock` — which is what the deployment asked for. `getTransport` falls back to the mock when a
  role holds no usable credential and the mock returns an ordinary success, so without this check a
  missing Front Office credential would close cases having sent nothing. — *Proposed Design*
- **Idempotency** is enforced by the stored `OUTGOING_RESPONSE` message: one response per query,
  surviving reload and restart. Approving twice does not email the inquirer twice, and retrying
  after a failed send completes the send without recording a second approval. — *Proposed Design*

### AI assistance as built (user-directed)

Summaries, assignment recommendations and first drafts are **derived from each query's own subject and
body**, not read from a fixed template.

**Corrected 2026-09-23:** this said "there is no model behind it yet". There is. A real model is wired
in — `backend/src/services/ai/gemmaService.js` calls the external Pravah Gemma endpoint, and it is
what runs on intake (`services/email/mailbox/acceptMessage.js`) and behind the AI routes. Each call
falls back to a deterministic stand-in when the endpoint does not answer, and the stored summary
records which happened (`GENERATED` / `FALLBACK` / `FAILED`) so a stand-in is never presented as the
model's work. The AI section further down this file already described this correctly; these two
paragraphs had not caught up.

- Assignment recommendation and draft generation. — *Confirmed Requirement* (srs/07)
- **Summarisation of the incoming enquiry.** — *Proposed Design* (user-directed). srs/07 documents
  only the two capabilities above. `AI_SUMMARY_GENERATED` and `AI_ASSIGNMENT_RECOMMENDED` also
  extend the audit catalog that [09-audit-and-compliance.md](./09-audit-and-compliance.md) closes
  at 16 events.
- The recommendation scores subject-matter keywords against division, then current workload. Are
  those the right factors, and in that order? — *Client Clarification Required*

### Workflow rules as built (require sign-off)

- **Central enforcement.** Every workflow action now validates role + workflow state and throws if
  either is wrong, rather than relying on the UI hiding buttons. — *Proposed Design*, matching the
  documented role matrix.
- **Response-version locking.** Once final approval is granted the approved version is marked
  `FINAL_APPROVED` and can no longer be edited; earlier versions are retained untouched. — *Proposed
  Design*. The SRS requires version retention but says nothing about locking.
- **Return from final approval does not re-run completed review levels.** A *reviewer* return resets
  that level to pending and the revised draft re-enters it (as srs/14 already describes); an *OIC*
  return from final approval sends the revised draft straight back to final approval, because the
  review levels already passed. The SRS covers the first case and is silent on the second. — *Client
  Clarification Required*
- **Final-approval routing.** The final-approval step is currently pinned to `USR-0003`, the only
  Officer-in-Charge in the mock data. Proposed: any OIC may act on it. — *Client Clarification
  Required*
- **Dispatch failure.** There is no `DISPATCH_FAILED` among the 16 audit events, so a failed send
  leaves the query at `READY_FOR_DISPATCH` and surfaces the error for retry. It is no longer
  *unwritten*: the final-approval path records an `EMAIL_SEND_FAILED` row against the `queryId`.
  Is a failure state and retry policy required? — *Client Clarification Required*

## Roles

- Seven roles: `SUPER_ADMIN`, `ADMIN`, `FRONT_OFFICE`, `OFFICER_IN_CHARGE`, `ASSIGNED_OFFICIAL`, `REVIEWER`, `INQUIRER`. — *Confirmed Requirement*, **narrowed 2026-09-23**. The stakeholder list was never wrong, and it is not being deleted: an inquirer is a party to every case and belongs in it. What was wrong was the implementation, which had given `INQUIRER` a **login** — an in-app account with its own dashboard, a Raise Enquiry form and read access to its own cases. **That has been reverted.** There are now **six signing-in roles** — the list above without `INQUIRER` — and the inquirer is **external**: a member of the public who emails the Front Office mailbox, whose name and address are read off the `From` header at intake, who holds no account and never signs in. `ROLES` in `frontend/src/constants/roles.js` and `backend/src/constants/roles.js` lists exactly six, the Inquirer Dashboard and every `/inquirer/*` route are gone, and no app-level requirement asks an external inquirer to log in. **This narrowing needs the client's sign-off.** The SRS names seven roles; reading one of them as a stakeholder rather than as an account holder is our interpretation, and if the client does intend inquirers to sign in and track their own cases, the portal has to come back. — *Client Clarification Required*
- Can a single user hold multiple roles? — *Client Clarification Required*
- Can queries be assigned across divisions, or only within the inquirer's/query's division? — *Client Clarification Required*
- Is delegation (acting on behalf of another user, e.g. during leave) required? — *Client Clarification Required*

## Assignment

- AI recommends, OIC decides, override is always possible. — *Confirmed Requirement*
- AI recommendation criteria: category, subject, expertise, history, workload, division, availability. — *Proposed Design*
- Is a reason/justification required when overriding the AI recommendation? — *Client Clarification Required*
- How heavily should current workload factor into the recommendation (hard constraint vs. soft signal)? — *Client Clarification Required*
- The recommendation is computed from declared `expertise` keywords, the official's division and their open-query count. The scoring weights are a development stand-in, not a client-agreed formula. — *Proposed Design*
- The official roster now exists **twice**: `frontend/src/constants/mockUsers.js` (the user records the app authenticates and assigns against) and `backend/src/config/officialsMetadata.js` (what the Gemma recommender scores). They agree today and the backend copy carries a few extra keywords, but nothing enforces that — a division change made in one will silently not reach the other. Unifying them means deciding which side owns the roster, which is a design question, not an integration one. — *Client Clarification Required*
- `recommendAssignee(query, users, openQueries) → { userId, matchPercent, reason, factors }` is a fixed contract so a model-backed implementation (Gemma is the candidate) can replace the rule-based scorer without changing the store, the pages or the workflow. Which model is approved remains open (see the AI section). — *Proposed Design*

## Review

- Reviews are a dynamic, ordered collection of steps, not fixed fields. — *Confirmed Requirement*
- Who can add a review level? — *Client Clarification Required*
- Who can delete a review level, and under what conditions? — *Client Clarification Required*
- Who can reorder review levels? — *Client Clarification Required*
- Who assigns which reviewer to which level — the OIC, the assigned official, or auto-assignment? — *Client Clarification Required*
- Can a reviewer directly edit the draft, or only comment/approve/return? — *Client Clarification Required*
- What happens to the workflow position after a review is returned — does it restart at the same level or an earlier one? — **Answered by user direction**: the revision returns to the assigned official and then re-enters at **Reviewer-I**, climbing the full ladder again. A Reviewer-II rejection therefore does not go straight back to Reviewer-II. This supersedes the earlier *Proposed Design* reading of [05-workflow-and-state-machine.md](./05-workflow-and-state-machine.md), which showed re-entry at the same level. — *User-Directed Proposed Behaviour*, still to be confirmed with the client.
- A return for revision from **final approval** restarts the complete cycle too: every review level *and* the final-approval step reset to pending, so the revised response passes Reviewer-I → Reviewer-II → OIC again. — *User-Directed Proposed Behaviour*
- A comment is **mandatory** whenever changes are requested, on both the reviewer path and the OIC's return-for-revision path; the action is refused without one. Approval comments stay optional. The SRS states that a `CHANGE_REQUIRED` decision records the reviewer and comments but does not say the comment is enforced. — *User-Directed Proposed Behaviour*
- Every review decision is bound to the **response version it reviewed** (`responseId` + `version` on the review row), so a comment can never be read against text written after it. The data model does not specify this link. — *User-Directed Proposed Behaviour*
- Reviewer-II cannot forward a response to the OIC after requesting changes — the request resets the cycle, and only a Reviewer-II approval on a subsequent version reaches final approval. — *User-Directed Proposed Behaviour*

## Transfer

- Transfer must preserve query history, draft, response versions, completed review steps, and audit trail, and must create an audit event. — *Confirmed Requirement*
- Who can initiate a transfer? — *Client Clarification Required* (marked "TO BE CONFIRMED WITH CLIENT" in the workflow rules)
- Who is eligible to receive a transferred query? — *Client Clarification Required*
- Does the workflow continue from its current step after transfer, or restart? — *Client Clarification Required*
- Is a transfer reason mandatory? — *Client Clarification Required*

## Pullback

- Pullback is a controlled workflow transition. — *Confirmed Requirement*
- Who can pull back a query? — *Client Clarification Required*
- From which workflow stages is pullback allowed? — *Client Clarification Required*
- Where does the query land after pullback (previous step vs. a specific fixed stage)? — *Client Clarification Required*
- Do already-completed review decisions remain valid after a pullback, or must they be redone? — *Client Clarification Required*
- Is a reason required for pullback? — *Client Clarification Required*
- Is pullback allowed after final approval has been granted? — *Client Clarification Required*

## Final Approval

- OIC grants or rejects final approval, or returns for revision. — *Confirmed Requirement*
- **Granting it also sends the response and closes the query**, in the same server call — see
  [Dispatch](#dispatch). — *User-Directed Proposed Behaviour*
- Can the OIC directly edit the response at final approval, or only approve/reject/return? — *Client Clarification Required*

## Dispatch

- ~~Front Office dispatches the approved response, which closes the query.~~ — *Confirmed
  Requirement*, **superseded by user direction**. The requirement as stated is what the SRS,
  `05-workflow-and-state-machine.md` and the reference workflow diagram all describe, and it is
  recorded here rather than deleted because it is what the client originally asked for. The user has
  since directed that the response go out automatically on final approval, and that is what is
  implemented: granting final approval sends the response and closes the query in one server call.
  Front Office keeps the `DISPATCH` permission and the Dispatch page, which is now a status view
  with a retry for a send that did not complete. Needs client confirmation as a change to a
  previously confirmed requirement — see the *Automatic final dispatch* section under Email, above,
  for what was built and why.
- ~~Manual send (Front Office clicks send) or fully automatic on approval?~~ — **✅ Decided by the
  user: fully automatic on approval.** A manual send survives only as the retry path.
- Is a fixed email template required, or free-form? — *Client Clarification Required*
- Are attachments carried through automatically from the query record? — *Client Clarification Required*. **As built they are not**: neither the automatic send nor the Front Office retry attaches anything, so the inquirer receives the response text alone. The Dispatch page says as much. (The forward to the Officer-in-Charge *does* carry them, fail-closed.)
- Is delivery tracking (opened/bounced) required? — *Client Clarification Required*
- Does dispatch alone trigger closure, or is there a separate closure confirmation step? — *Proposed Design*: dispatch triggers closure directly (per the reference workflow diagram); not confirmed.

## AI

- AI recommends, human always decides — for both assignment and drafting. — *Confirmed Requirement*
- Which LLM/provider is approved for use? — *Client Clarification Required*. **Gemma** is now wired in as the candidate, called over HTTP at `GEMMA_API_URL` (currently an AICTE-hosted endpoint). It fills the `recommendAssignee` swap point and generates the query summary. This is a development integration, not an approved choice — the question stays open.
- The Gemma endpoint is a **third party outside IPC's control**, and enquiry subject and body are sent to it. Whether that is acceptable for real enquiry content — and whether an on-prem model is required instead — is unresolved and overlaps the on-prem question below. — *Client Clarification Required*
- Every Gemma path falls back to the local rule-based scorer on timeout, error or an unparseable reply, so the workflow degrades rather than fails. Whether silent degradation is acceptable, or whether the Officer-in-Charge must be told the recommendation is not model-backed, is not specified. — *Proposed Design*
- Is an external API call permitted, or must this run on a private/on-prem model? — *Client Clarification Required*
- What counts as an "approved knowledge source" for draft generation? — *Client Clarification Required*
- Should previously approved responses be usable as AI context/training examples? — *Client Clarification Required*
- Are AI citations (showing which source informed which part of the draft) required? — *Client Clarification Required*
- What audit requirements apply specifically to AI-generated content (beyond the standard `DRAFT_GENERATED` event and generation metadata in [07-ai-requirements.md](./07-ai-requirements.md))? — *Client Clarification Required*

## SLA

- Priority levels `LOW` / `NORMAL` / `HIGH` / `URGENT` exist as an enum. — *Proposed Design*, exact definitions not confirmed.
- What response-time targets apply per priority? — *Client Clarification Required*
- Are targets measured in calendar days or working days? — *Client Clarification Required*
- What escalation happens when a target is missed? — *Client Clarification Required*

## Dashboard

- Dashboard is role-specific, showing pending work relevant to the logged-in user. — *Confirmed Requirement*
- Exact KPI set required per role? — *Client Clarification Required*
- What reports are required beyond the dashboard? — *Client Clarification Required*
- Export requirements (format, scope)? — *Client Clarification Required*
- What does "real-time" mean for this client's monitoring needs? — *Client Clarification Required*
