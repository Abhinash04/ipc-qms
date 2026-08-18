# 13. Data Model

Conceptual field lists, PostgreSQL-ready — no ORM or physical schema has been chosen yet.
These mirror the mock data shapes in `frontend/src/constants/`.

## 13.1 Query

| Field | Type | Notes |
| --- | --- | --- |
| `queryId` | string | Human-readable ID, e.g. `QRY-2026-00427`. |
| `subject` | string | |
| `description` | text | |
| `source` | enum | e.g. `Email`. |
| `inquirer` | reference | External party (not a system user). |
| `category` | string | See admin Categories. |
| `priority` | enum | `LOW` / `NORMAL` / `HIGH` / `URGENT`. |
| `businessStatus` | enum | `OPEN` / `IN_PROGRESS` / `CLOSED` — see [05](./05-workflow-and-state-machine.md). |
| `workflowState` | enum | 16 states — see [05](./05-workflow-and-state-machine.md). |
| `currentAssignee` | reference → User | Nullable before assignment. |
| `currentWorkflowStepId` | reference → WorkflowStep | |
| `attachments` | WorkflowAttachment[] | |
| `createdAt` / `updatedAt` | timestamp | |
| `dueDate` | timestamp | Nullable. |
| `auditHistory` | AuditEvent[] | See 13.4. |

## 13.2 WorkflowStep

Modeled as a **dynamic, ordered collection** per query — never fixed `review1`/`review2`
fields (see [architecture/workflow-engine.md](../architecture/workflow-engine.md)).

| Field | Type | Notes |
| --- | --- | --- |
| `stepId` | string | |
| `queryId` | reference → Query | |
| `stepType` | enum | `DRAFT` / `REVIEW` / `FINAL_APPROVAL`. |
| `sequence` | integer | Order within the query's workflow instance. |
| `assignedUser` | reference → User | |
| `status` | enum | `PENDING` / `IN_PROGRESS` / `COMPLETED`. |
| `createdAt` / `startedAt` / `completedAt` | timestamp | `startedAt`/`completedAt` nullable until reached. |

## 13.3 ResponseVersion

| Field | Type | Notes |
| --- | --- | --- |
| `version` | string | e.g. `v1`, `v2`, `Final`. |
| `label` | string | e.g. "AI generated", "Officer revision". |
| `content` | text | |
| `createdAt` | timestamp | |
| `createdBy` | reference → User \| "AI Draft Assistant" | |

AI-produced versions additionally carry generation metadata — see
[07-ai-requirements.md](./07-ai-requirements.md#74-generation-metadata).

## 13.4 AuditEvent

| Field | Type | Notes |
| --- | --- | --- |
| `event` | enum | See [09-audit-and-compliance.md](./09-audit-and-compliance.md). |
| `queryId` | reference → Query | |
| `actor` | reference → User \| "System" \| "AI" | |
| `at` | timestamp | |
| `details` | jsonb | Optional structured context (e.g. previous vs new assignee). |

## 13.5 Supporting Entities

- **User** — `id`, `name`, `role`, `email`, `divisionId`.
- **Division** — `id`, `name`.
- **Category** — used for query classification and AI assignment matching.

## 13.6 Not Yet Finalized

Physical column types, indexes, and foreign-key constraints are deferred until PostgreSQL
integration begins and the open questions in
[14-open-questions-and-client-clarifications.md](./14-open-questions-and-client-clarifications.md)
are resolved.
