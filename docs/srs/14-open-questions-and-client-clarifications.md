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
