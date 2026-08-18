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
(`frontend/src/components/workflow/WorkflowTimeline.jsx` renders any length of
`workflowSteps` sorted by `sequence`).

## Step Lifecycle

A step's `status` moves `PENDING → IN_PROGRESS → COMPLETED`. A query's
`currentWorkflowStepId` always points at the step actively being worked — advancing to the
next step means completing the current one and marking the next `IN_PROGRESS`.

## Add / Delete / Reorder (Conceptual — Not Implemented)

- **Add a review level**: insert a new `WorkflowStep` with `stepType: REVIEW` at the desired
  `sequence`, shifting subsequent sequence numbers.
- **Delete a review level**: only permitted while `status = PENDING` (a completed review's
  decision is part of the audit trail and should not disappear); removing it shifts later
  sequence numbers down.
- **Reorder**: renumber `sequence` for the affected steps.

Who is authorized to perform each of these operations is an open question — see
[srs/14-open-questions-and-client-clarifications.md](../srs/14-open-questions-and-client-clarifications.md#review).
None of add/delete/reorder is implemented in this phase; `mockQuery.js` ships a fixed
4-step example (Draft → Review 1 → Review 2 → Final Approval) purely to demonstrate the
shape.

## Relationship to Workflow State

A query's coarse `workflowState` (e.g. `UNDER_REVIEW`) is derived from where its
`currentWorkflowStepId` sits, not stored independently of the steps — once the workflow
engine is implemented, advancing a step should be the single place that also updates
`workflowState` and appends the corresponding audit event, so the two can never drift apart.
