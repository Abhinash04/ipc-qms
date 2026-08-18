# 9. Audit and Compliance

## 9.1 Principle

Every important workflow event must be auditable, and audit records must not be casually
deleted or overwritten (append-only). The audit trail is what lets any query be reconstructed
end-to-end after the fact.

## 9.2 Audit Event Catalog

| Event | Meaning |
| --- | --- |
| `QUERY_RECEIVED` | A query arrived (e.g. via email) and a record was created. |
| `QUERY_REGISTERED` | Front Office confirmed the query's basic details. |
| `QUERY_FORWARDED` | Query forwarded to the OIC for assignment. |
| `QUERY_ASSIGNED` | OIC assigned the query to an official. |
| `ASSIGNMENT_OVERRIDDEN` | OIC assigned someone other than the AI recommendation. |
| `DRAFT_GENERATED` | AI produced an initial draft. |
| `DRAFT_UPDATED` | A human edited the draft, creating a new response version. |
| `REVIEW_ADDED` | A review level was added to the workflow. |
| `REVIEW_COMPLETED` | A reviewer approved their review level. |
| `REVISION_REQUESTED` | A reviewer or the OIC returned the draft for revision. |
| `QUERY_TRANSFERRED` | The query was transferred to another official. |
| `QUERY_PULLED_BACK` | The query was pulled back to an earlier stage. |
| `FINAL_APPROVAL_GRANTED` | The OIC gave final approval. |
| `FINAL_APPROVAL_REJECTED` | The OIC rejected the draft at final approval. |
| `RESPONSE_DISPATCHED` | The approved response was sent to the inquirer. |
| `QUERY_CLOSED` | The query reached its terminal closed state. |

These map directly to `frontend/src/constants/statusEnums.js` (`AUDIT_EVENT`) in the mock
data layer, and should map 1:1 to backend audit-log rows once persistence exists.

## 9.3 Record Shape (Conceptual)

Each audit record conceptually captures: `event`, `queryId`, `actor` (user or `System`/`AI`),
`at` (timestamp), and an optional `details` payload (e.g. previous vs new assignee for
`ASSIGNMENT_OVERRIDDEN`). Exact schema is finalized alongside
[13-data-model.md](./13-data-model.md) once PostgreSQL integration begins.

## 9.4 Retention & Immutability

Audit records should not be editable or deletable through normal application flows.
Retention period and any legal/compliance hold requirements are to be confirmed with the
client.
