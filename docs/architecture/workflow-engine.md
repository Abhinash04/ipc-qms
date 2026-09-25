# Workflow Engine

## Why Not `review1`/`review2`/`review3`

A fixed set of review fields caps the workflow at a hardcoded number of levels and makes
"add a review level" or "delete a review level" a schema change instead of a data operation.
QMS must support any number of review levels per query (spec requirement — see
[srs/04-functional-requirements.md](../srs/04-functional-requirements.md#44-dynamic-review)),
so the workflow is modeled as a dynamic, ordered collection instead.

## Model

```
Query
  └── WorkflowInstance (implicit — the query's current workflowSteps collection)
        ├── WorkflowStep (sequence 1) — e.g. DRAFT
        ├── WorkflowStep (sequence 2) — e.g. REVIEW
        ├── WorkflowStep (sequence 3) — e.g. REVIEW
        ├── ...
        └── WorkflowStep (sequence N) — e.g. FINAL_APPROVAL
```

Each `WorkflowStep` (see [srs/13-data-model.md](../srs/13-data-model.md#132-workflowstep))
carries: `step_id`, `query_id`, `step_type`, `sequence`, `assigned_user`, `status`,
`created_at`, `started_at`, `completed_at`.

This lets the same underlying shape represent either:

```
Draft → Review 1 → Review 2 → Final Approval
```

or:

```
Draft → Review 1 → Review 2 → Review 3 → Review 4 → Final Approval
```

without any change to the data model or the components that render it
(`frontend/src/components/workflow/QueryLifecycleTimeline.jsx` renders any length of
`workflowSteps` sorted by `sequence`).

> **Implementation status.** The engine is **implemented client-side** in
> `frontend/src/store/useWorkflowStore.js`, and its steps are now **persisted server-side**:
> `backend/src/models/WorkflowStep.js` is the collection — unique on `stepId`, with a compound
> index on `{queryId, sequence}` so a query's chain reads back in order — and every transition
> syncs through `POST /api/v1/queries/persist`.
>
> What is still client-side is the *decision*. Whether a transition is legal for the acting role in
> the current `workflowState` is checked in the store; the server's `verifyAction` enforces only
> the role half of `canPerform`. That is why this document still describes the rules the backend
> should adopt.

## Step Lifecycle

A step's `status` moves `PENDING → IN_PROGRESS → COMPLETED`. A query's
`currentWorkflowStepId` always points at the step actively being worked — advancing to the
next step means completing the current one and marking the next `IN_PROGRESS`.

## Add / Delete / Reorder

- **Add a review level**: insert a new `WorkflowStep` with `stepType: REVIEW` at the desired
  `sequence`, shifting subsequent sequence numbers. **Implemented** — `addReviewLevel` in
  `useWorkflowStore`, driven from the drafting screen; levels are named "Reviewer I / II / III" in
  sequence order.
- **Delete a review level**: only permitted for a `REVIEW` step whose `status = PENDING` (a
  completed review's decision is part of the audit trail and should not disappear), by the current
  assignee or the Super Admin, while the case is in DRAFTING, UNDER_REVIEW or RETURNED_FOR_REVISION.
  **Implemented** — `deleteReviewLevel` logs `REVIEW_REMOVED`, and `authorizeCaseDelta` refuses any
  other delete server-side.
- **Reorder**: renumber `sequence` for the affected steps. **Not implemented** — levels can be
  added and removed but not moved.

The current assignee (or the Super Admin) manages the chain — see
[srs/14-open-questions-and-client-clarifications.md](../srs/14-open-questions-and-client-clarifications.md#review).
Submission for review is blocked until at least one reviewer exists.

There is no `mockQuery.js`; the store seeds entirely empty and every step is created by real
workflow activity.

## Relationship to Workflow State

A query's coarse `workflowState` (e.g. `UNDER_REVIEW`) tracks where its `currentWorkflowStepId`
sits. In the client implementation this invariant is held by `applyTransition`, the store's single
writer: it is the only place *in the client* that changes `workflowState`, it **derives
`businessStatus` from it**
via `deriveBusinessStatus` so those two can never disagree, and it **always appends exactly one
audit event**. A server-side implementation should preserve that property — one commit point that
updates the step, the state and the audit record together, rather than three call sites that can
drift apart.

Two pieces of that server-side implementation already exist, one at each end of the lifecycle.
`backend/src/services/email/mailbox/acceptMessage.js` owns the intake transitions
(`RECEIVED → FRONT_OFFICE_VERIFICATION → PENDING_ASSIGNMENT`), and
`backend/src/services/workflow/finalApproval.js` owns the closing ones
(`PENDING_FINAL_APPROVAL → READY_FOR_DISPATCH → DISPATCHED → CLOSED`). Both write their own audit
events, and the client reads the result back with `refreshFromServer()` rather than reconstructing
it. They are worth reading as the shape the rest should follow — and as a caveat: with no
cross-document transactions on a standalone MongoDB they achieve safety by making every step check
its own artefact before acting, not by rolling back.

The closing sequence also shows what "one commit point" has to mean when a step leaves the machine.
The approval is written before the response is sent, so a mail failure costs the response and not
the decision; the case is marked `CLOSED` only after a send that actually happened, so the state can
never claim more than occurred. A failed send stops at `READY_FOR_DISPATCH` — no new state was
invented for it — and the Front Office retry resumes from there.
