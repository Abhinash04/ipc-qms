# Workflow Rules — Transfer & Pullback

## Transfer

**Confirmed**: a transfer must preserve query history, the existing draft, all response
versions, completed review steps, and the audit trail — and must create an audit event
(`QUERY_TRANSFERRED`).

**TO BE CONFIRMED WITH CLIENT**:

- Who can initiate a transfer (assigned official only? OIC too?).
- Who is eligible to receive a transferred query (any official, or only within the same
  division/expertise area?).
- Whether the workflow continues from its current step after transfer, or restarts a step.
- Whether a transfer reason is mandatory.

Until confirmed, no transfer action is implemented — `QUERY_TRANSFERRED` exists only as a
documented audit-event name (see [srs/09-audit-and-compliance.md](../srs/09-audit-and-compliance.md)).

## Pullback

**Confirmed**: pullback is a controlled workflow transition, not a free-form status edit; a
pullback must create an audit event (`QUERY_PULLED_BACK`).

**TO BE CONFIRMED WITH CLIENT**:

- Who can pull back a query.
- From which workflow stages pullback is allowed.
- Where the query lands after pullback (the immediately previous step, or a specific fixed
  stage).
- Whether already-completed review decisions remain valid after a pullback, or must be
  redone.
- Whether a reason is required for pullback.
- Whether pullback is allowed after final approval has already been granted.

Until confirmed, no pullback action is implemented — `QUERY_PULLED_BACK` and the
`PULLED_BACK` workflow state exist only as documented names.

## Why These Are Deliberately Unresolved

Guessing these rules now risks building UI/API shapes that don't match the client's actual
process (e.g. a "pullback reason" field that turns out not to be required, or a permission
check that's too strict/loose). Both are flagged in
[srs/14-open-questions-and-client-clarifications.md](../srs/14-open-questions-and-client-clarifications.md)
for explicit client sign-off before implementation.
