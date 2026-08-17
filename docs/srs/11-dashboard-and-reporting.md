# 11. Dashboard and Reporting

## 11.1 Dashboard (Proposed)

Role-specific operational dashboard. Proposed KPI set (not confirmed):

- Queries assigned to the current user.
- Queries currently in drafting.
- Queries awaiting the current user's review.
- Queries closed in the current period.
- Workflow-state distribution (received / in progress / closed) for managers.

The current `/dashboard` implementation (`frontend/src/pages/dashboard/DashboardPage.jsx`)
renders these as static mock KPI cards plus the one mock assigned query, to establish the
layout — no aggregation logic exists yet.

## 11.2 Reports (Proposed)

`/reports` is a page-level placeholder only. Proposed but **not confirmed**:

- Turnaround-time reporting (received → closed).
- Volume by category / division / priority.
- SLA compliance (once SLA definitions are confirmed — see [14](./14-open-questions-and-client-clarifications.md#sla)).
- Export to CSV/PDF.

## 11.3 Open Items (Client Clarification Required)

- Which metrics are actually required for the dashboard vs. reports?
- Export format requirements?
- What does "real-time" mean for this client — sub-second, minute-level, or daily refresh?
