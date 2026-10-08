# 4. Functional Requirements

Requirements are grouped by module. Each has a stable identifier (`FR-NNN`) for traceability.

## 4.1 Intake & Verification

- **FR-001** — The system shall receive/register incoming queries, creating one Query record per inquiry.
- **FR-002** — The Front Office shall be able to verify incoming query details (inquirer, subject, category, attachments) before forwarding.
- **FR-003** — The system shall store attachments against the Query record they arrived with.
- **FR-004** — The system shall set the initial Business Status to `OPEN` and Workflow State to `RECEIVED` on intake.

## 4.2 Assignment

- **FR-005** — The OIC shall be able to assign a query to an eligible official.
- **FR-006** — The system shall provide AI-assisted assignment recommendations, considering query category, subject, required expertise, historical assignments, current workload, division, and availability.
- **FR-007** — The OIC shall be able to override the AI's assignment recommendation and select a different official.
- **FR-008** — The system shall record whether an assignment followed or overrode the AI recommendation (`ASSIGNMENT_OVERRIDDEN` audit event when overridden).

## 4.3 Drafting

- **FR-009** — The assigned official shall be able to prepare a response to the query.
- **FR-010** — The system shall provide AI-assisted initial draft generation from the query, its attachments, and approved knowledge sources.
- **FR-011** — AI-generated content shall never automatically become the final official response — a human must review and can edit it before it proceeds.
- **FR-012** — The system shall preserve response versions (e.g. AI generated, officer revision, reviewer-requested revision, final approved) rather than overwriting drafts in place.

## 4.4 Dynamic Review

- **FR-013** — The system shall support a dynamic number of review levels per query, modeled as an ordered `WorkflowStep` collection, not fixed `review1`/`review2`/`review3` fields.
- **FR-014** — Authorized users shall be able to add a review level to a query's workflow.
- **FR-015** — The current assignee (or the Super Admin) shall be able to delete a review level that is still PENDING, while the query is in DRAFTING, UNDER_REVIEW or RETURNED_FOR_REVISION. The server refuses any other delete, and each one creates a `REVIEW_REMOVED` audit event.
- **FR-016** — A reviewer shall be able to approve a review step or return it with revision comments.
- **FR-017** — Returning a review step for revision shall route the query back to the assigned official and create a `REVISION_REQUESTED` audit event.

## 4.5 Transfer & Pullback

- **FR-018** — The current assignee (or the Super Admin) shall be able to transfer a query to another Assigned Official, with a reason, only while it is in ASSIGNED, before drafting starts. The query history and audit trail are preserved, and the previous assignee loses every assignee action on the query; the server enforces both.
- **FR-019** — Authorized users shall be able to pull back a query according to workflow rules (exact rules: see open questions).
- **FR-020** — Both transfer and pullback shall create an audit event (`QUERY_TRANSFERRED`, `QUERY_PULLED_BACK`).

## 4.6 Final Approval & Dispatch

- **FR-021** — The OIC shall be able to grant or reject final approval, or return the query for revision.
- **FR-022** — ~~Front Office shall be able to dispatch an approved response to the inquirer.~~
  **Superseded by user direction:** granting final approval shall dispatch the approved response to
  the inquirer automatically, in the same operation. Front Office retains the dispatch permission as
  the retry path for a send that did not complete. The original requirement is kept here because it
  is what the client asked for; the change needs their confirmation — see
  [14-open-questions-and-client-clarifications.md](./14-open-questions-and-client-clarifications.md#dispatch).
- **FR-023** — Dispatch shall transition the query's Business Status to `CLOSED` and Workflow State to `CLOSED`, and only after a send that actually completed. A failed send shall leave the query at `READY_FOR_DISPATCH` with the approval intact.

## 4.7 Audit

- **FR-024** — The system shall maintain a complete, append-only audit trail of every workflow event listed in [09-audit-and-compliance.md](./09-audit-and-compliance.md).
- **FR-025** — Audit records shall not be casually deleted or overwritten.

## 4.8 Notifications

- **FR-026** — The system shall notify relevant users of key workflow events (assignment, review requested, returned for revision, approved, dispatched). Channels are to be confirmed — see [10-notifications.md](./10-notifications.md).

## 4.9 Admin & RBAC

- **FR-027** — The system shall support role-based access control across `SUPER_ADMIN`, `ADMIN`, `FRONT_OFFICE`, `OFFICER_IN_CHARGE`, `ASSIGNED_OFFICIAL`, `REVIEWER`.
- **FR-028** — Admin users shall be able to manage users, divisions, categories, and workflow templates.
- **FR-029** — A user's page/action access shall be determined by an explicit permission mapping, not solely by role hierarchy position.

## 4.10 Dashboard

- **FR-030** — The system shall provide a role-specific dashboard summarizing a user's pending work and relevant query counts.
