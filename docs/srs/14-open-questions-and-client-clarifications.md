# 14. Open Questions and Client Clarifications

Every item below is tagged:

- **Confirmed Requirement** — stated directly by the client/spec, safe to build against.
- **Proposed Design** — our recommendation, not yet confirmed by the client.
- **Client Clarification Required** — genuinely open; must not be assumed.

## Email

- Automatic or manual email ingestion? — *Client Clarification Required*
- Which email provider/API? — *Client Clarification Required*
- Does the system need email threading (replies attach to the same query)? — *Client Clarification Required*
- How should an incoming reply mid-workflow be handled? — *Client Clarification Required*
- Should outgoing dispatch email be automatic on approval, or require a Front Office confirmation step? — *Client Clarification Required*
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

### Real multi-account Gmail identities (development phase, user-directed)

The first three stakeholders now use real Gmail accounts — Abhinash Pritiraj (INQUIRER), Bhumika
Makker (FRONT_OFFICE), Jatin Rawat (OFFICER_IN_CHARGE). The rest remain mock. Each real account
authenticates itself; no account sends on another's behalf.

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
- **Reading a stakeholder's mailbox.** With `MAILBOX_SOURCE=gmail` the system polls the Front
  Officer's inbox with `gmail.modify`, which grants access to her entire personal mailbox and lets
  the system mark messages read. In production this should be a delegated/service mailbox, not a
  personal account. — *Client Clarification Required*
- **Only the Front Officer's inbox is polled.** Mail arriving in the Officer-in-Charge's inbox is
  never registered, because it belongs to a case that already exists. If OIC-initiated enquiries
  must also become cases, that is a separate intake path. — *Client Clarification Required*
- **Thread-level attachment.** A later message on an existing provider thread (typically an
  inquirer's reply) is attached to the existing query as further correspondence, with a
  `QUERY_RECEIVED` audit entry and no workflow transition. The SRS says nothing about mid-workflow
  replies — [srs/14 Email](#email) still lists that as open. — *Proposed Design*

### Automatic Front Office intake (user-directed)

Registering an enquiry now performs the whole Front Office stage in one step: acknowledge → verify →
forward to the Officer-in-Charge.

- **Verification happens automatically** rather than by a human click. The `QUERY_REGISTERED` audit
  event is still written with the Front Officer as actor, so the checkpoint that
  [05-workflow-and-state-machine.md](./05-workflow-and-state-machine.md) documents survives as a
  record. But nobody now inspects an enquiry before it reaches the OIC — an incomplete or
  misdirected enquiry is forwarded automatically. Is unattended intake acceptable, or must Front
  Office remain a human gate? — *Client Clarification Required*
- **Forwarding to the OIC is automatic and sends a real email.** The SRS treats forwarding as a
  workflow transition and describes no email. — *Proposed Design* (user-directed)
- **Only mail from a known inquirer address opens a case.** Enquiries from anyone outside the
  identity directory are invisible. In production, intake presumably must accept mail from any
  member of the public; this allow-list is a development-phase control. — *Client Clarification
  Required*
- **Attachments are metadata only** (name, type, size); content is never downloaded or stored.
  [13-data-model.md](./13-data-model.md) leaves the `WorkflowAttachment` field list open. —
  *Proposed Design*

### Automatic final dispatch (user-directed)

Granting final approval now sends the response and closes the case. The Front Officer presses
nothing on the normal path.

- **Dispatch is no longer a Front Office action.** `05-workflow-and-state-machine.md` describes
  Front Office dispatching the approved response; it is now automatic on the transition to
  `READY_FOR_DISPATCH`. The Dispatch page becomes a status view with a retry, used only when the
  automatic send failed. — *Proposed Design* (user-directed)
- **The automatic send runs as a system action.** It executes in the approving OIC's session, so it
  carries no actor and is gated on the workflow state alone rather than on the Front Office
  `DISPATCH` permission. A human retry still passes an actor and is gated normally. The audit event
  records the Front Office identity that actually sent the mail. Is an unattended dispatch, with no
  Front Office review of the outgoing message, acceptable? — *Client Clarification Required*
- **No dispatch-failure state exists.** A failed send leaves the case at `READY_FOR_DISPATCH` —
  approved, response locked, never `CLOSED` — and the error surfaces for retry. The SRS's 16 audit
  events contain no `DISPATCH_FAILED`, so none was invented. Should a failed dispatch be an explicit
  state with its own audit event? — *Client Clarification Required*
- **Idempotency** is enforced by the stored `OUTGOING_RESPONSE` message: one response per query,
  surviving reload and restart. — *Proposed Design*

### AI assistance as built (user-directed)

Summaries, assignment recommendations and first drafts are now **derived from each query's own
subject and body** (`frontend/src/services/ai/mockAiService.js`), not read from a fixed template.
There is no model behind it yet; the interface is the swap point.

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
  leaves the query at `READY_FOR_DISPATCH` with nothing written and surfaces the error for retry.
  Is a failure state and retry policy required? — *Client Clarification Required*

## Roles

- The six roles (`SUPER_ADMIN`, `ADMIN`, `FRONT_OFFICE`, `OFFICER_IN_CHARGE`, `ASSIGNED_OFFICIAL`, `REVIEWER`) plus external `INQUIRER`. — *Confirmed Requirement*
- Can a single user hold multiple roles? — *Client Clarification Required*
- Can queries be assigned across divisions, or only within the inquirer's/query's division? — *Client Clarification Required*
- Is delegation (acting on behalf of another user, e.g. during leave) required? — *Client Clarification Required*

## Assignment

- AI recommends, OIC decides, override is always possible. — *Confirmed Requirement*
- AI recommendation criteria: category, subject, expertise, history, workload, division, availability. — *Proposed Design*
- Is a reason/justification required when overriding the AI recommendation? — *Client Clarification Required*
- How heavily should current workload factor into the recommendation (hard constraint vs. soft signal)? — *Client Clarification Required*

## Review

- Reviews are a dynamic, ordered collection of steps, not fixed fields. — *Confirmed Requirement*
- Who can add a review level? — *Client Clarification Required*
- Who can delete a review level, and under what conditions? — *Client Clarification Required*
- Who can reorder review levels? — *Client Clarification Required*
- Who assigns which reviewer to which level — the OIC, the assigned official, or auto-assignment? — *Client Clarification Required*
- Can a reviewer directly edit the draft, or only comment/approve/return? — *Client Clarification Required*
- What happens to the workflow position after a review is returned — does it restart at the same level or an earlier one? — *Proposed Design*: returns to the assigned official, then re-enters the same review level once revised (as shown in [05-workflow-and-state-machine.md](./05-workflow-and-state-machine.md)); not confirmed.

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
- Can the OIC directly edit the response at final approval, or only approve/reject/return? — *Client Clarification Required*

## Dispatch

- Front Office dispatches the approved response, which closes the query. — *Confirmed Requirement*
- Manual send (Front Office clicks send) or fully automatic on approval? — *Client Clarification Required*
- Is a fixed email template required, or free-form? — *Client Clarification Required*
- Are attachments carried through automatically from the query record? — *Proposed Design*, not confirmed.
- Is delivery tracking (opened/bounced) required? — *Client Clarification Required*
- Does dispatch alone trigger closure, or is there a separate closure confirmation step? — *Proposed Design*: dispatch triggers closure directly (per the reference workflow diagram); not confirmed.

## AI

- AI recommends, human always decides — for both assignment and drafting. — *Confirmed Requirement*
- Which LLM/provider is approved for use? — *Client Clarification Required*
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
