# Workflow Rules — Transfer & Pullback

## Transfer

**Confirmed**: a transfer must preserve query history, the existing draft, all response
versions, completed review steps, and the audit trail — and must create an audit event
(`QUERY_TRANSFERRED`).

**Decided**:

- only the **current assignee** (or the Super Admin) may initiate;
- **any other** Assigned Official may receive it — there is no division or expertise restriction;
- transfer is valid only while the case is `ASSIGNED`, before drafting starts, and the state stays
  `ASSIGNED`. Once drafting has started the control is hidden and the server refuses it; reassigning a
  case after that is an Admin pullback;
- a reason **is** mandatory;
- only the new assignee is notified.

**Status: LIVE.** `transferQuery` is in `frontend/src/store/useWorkflowStore.js` and emits
`QUERY_TRANSFERRED` (see [srs/09-audit-and-compliance.md](../srs/09-audit-and-compliance.md)), whose
details name the previous assignee, the new one, who transferred it and why. `ROLE_ACTIONS` grants
TRANSFER to the `ASSIGNED_OFFICIAL` and `SUPER_ADMIN`, and `ACTION_VALID_STATES` allows it only from
`ASSIGNED`. After the transfer the previous assignee loses every assignee action: the UI hides Start
drafting, Transfer and the drafting controls, the store refuses them, and `authorizeCaseDelta` refuses
any write from an Assigned Official who is not the stored assignee. The same middleware refuses a
transfer outside `ASSIGNED` or to anyone who is not an Assigned Official. `transferQuery.test.jsx` and
`backend/src/test/assigneeAuthorization.test.js` exercise it.

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

**Status: LIVE, with the questions above still open.** Corrected 2026-09-23 — as with transfer, the
"deliberately disabled" claim is no longer true.

`pullBackQuery` is in the store, emits `QUERY_PULLED_BACK`, and `PULLED_BACK` is a declared
`WORKFLOW_STATE`. It is **not** in `CLARIFICATION_REQUIRED_ACTIONS`: `ROLE_ACTIONS` grants PULLBACK to
`ADMIN` and `SUPER_ADMIN`, `ACTION_VALID_STATES` allows it from **every** state — including after final
approval, which is one of the open questions above — and `WorkflowActionsCard` renders the control.
`pullbackQuery.test.jsx` exercises it.

The implementation's current answers to the open questions, none of them confirmed: Admin and Super
Admin may pull back, from any stage, to any earlier stage the operator picks, with a reason recorded
in `pullbackHistory`, and completed review decisions are left as they are.

A server-side endpoint also exists — `POST /api/v1/queries/:queryId/pullback`, guarded by
`verifyAction(PULLBACK)`, which `ROLE_ACTIONS` grants to ADMIN and SUPER_ADMIN. It persists
`workflowState` and writes the `QUERY_PULLED_BACK` audit event. Two things to know before relying on
it:

- **The UI does not call it.** `PullbackQueryModal` goes through the store's `pullBackQuery`, which
  reaches MongoDB via `POST /queries/persist` together with the richer client-side record
  (`pullbackHistory`, workflow steps). The endpoint is the server-authoritative path to adopt as
  workflow enforcement moves off the client; its write is an idempotent upsert on `queryId`, so
  calling both does not corrupt the case.
- **It does not answer the questions above.** The grant it enforces is provisional and follows
  `ROLE_ACTIONS`; the stage rules, review-validity rules and reason requirement are still open.

## Why These Are Deliberately Unresolved

Guessing these rules risks building UI/API shapes that don't match the client's actual
process (e.g. a "pullback reason" field that turns out not to be required, or a permission
check that's too strict/loose). Both are flagged in
[srs/14-open-questions-and-client-clarifications.md](../srs/14-open-questions-and-client-clarifications.md)
for explicit client sign-off.

The mechanics were built anyway — they are cheap and the audit-event shape was already settled — and
were at first gated behind `CLARIFICATION_REQUIRED_ACTIONS` so the *policy* questions stayed open.

**That gate is gone, and the questions are not.** Both actions now ship with defaults chosen by
whoever implemented them, which is the situation the gate existed to prevent. The defaults are listed
under each status above so they can be confirmed or corrected as written rather than discovered in
use. `CLARIFICATION_REQUIRED_ACTIONS` still exists and is now empty, so the mechanism is available if
either action should be closed again pending an answer.
