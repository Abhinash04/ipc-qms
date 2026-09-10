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

**Status: built, deliberately disabled.** `transferQuery` exists in
`frontend/src/store/useWorkflowStore.js` and emits `QUERY_TRANSFERRED` (see
[srs/09-audit-and-compliance.md](../srs/09-audit-and-compliance.md)), but the action is listed in
`CLARIFICATION_REQUIRED_ACTIONS` (`frontend/src/constants/workflowRules.js`), and `canPerform`
returns `false` for anything in that list **before** consulting the role table. So no role can
invoke it and no UI offers it. Removing the entry from that list is the single change that turns it
on once the questions above are answered.

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

**Status: built, deliberately disabled.** `pullBackQuery` exists in the store and emits
`QUERY_PULLED_BACK`, and `PULLED_BACK` is a declared `WORKFLOW_STATE`. As with transfer, the action
sits in `CLARIFICATION_REQUIRED_ACTIONS`, so `canPerform` refuses it for every role and no UI
exposes it.

## Why These Are Deliberately Unresolved

Guessing these rules risks building UI/API shapes that don't match the client's actual
process (e.g. a "pullback reason" field that turns out not to be required, or a permission
check that's too strict/loose). Both are flagged in
[srs/14-open-questions-and-client-clarifications.md](../srs/14-open-questions-and-client-clarifications.md)
for explicit client sign-off.

The mechanics were built anyway — they are cheap and the audit-event shape was already settled — but
gated behind `CLARIFICATION_REQUIRED_ACTIONS` so the *policy* questions stay open. That way the
client's answers determine who may act and from which states, without the transition logic having to
be written from scratch afterwards.
