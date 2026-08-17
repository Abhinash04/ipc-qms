# QMS Documentation

Documentation for the Query Management System, built for an IPC client. **Current phase:
Initial Architecture & Foundation** — see the root [README.md](../README.md) for setup.

**New here?** Start with [HANDOFF.md](./HANDOFF.md) — status at a glance, getting started,
mock login identities, known issues, and what's next.

## SRS (`srs/`)

The software requirements specification, in reading order:

1. [Introduction](./srs/01-introduction.md)
2. [System Overview](./srs/02-system-overview.md)
3. [Stakeholders & Roles](./srs/03-stakeholders-and-roles.md)
4. [Functional Requirements](./srs/04-functional-requirements.md)
5. [Workflow & State Machine](./srs/05-workflow-and-state-machine.md)
6. [Non-Functional Requirements](./srs/06-non-functional-requirements.md)
7. [AI Requirements](./srs/07-ai-requirements.md)
8. [Security & Access Control](./srs/08-security-and-access-control.md)
9. [Audit & Compliance](./srs/09-audit-and-compliance.md)
10. [Notifications](./srs/10-notifications.md)
11. [Dashboard & Reporting](./srs/11-dashboard-and-reporting.md)
12. [Email Integration](./srs/12-email-integration.md)
13. [Data Model](./srs/13-data-model.md)
14. [Open Questions & Client Clarifications](./srs/14-open-questions-and-client-clarifications.md) — **read this before assuming anything is settled.**

## Architecture (`architecture/`)

- [System Architecture](./architecture/system-architecture.md)
- [Frontend Architecture](./architecture/frontend-architecture.md) — includes the full route plan.
- [Backend Architecture](./architecture/backend-architecture.md)
- [Workflow Engine](./architecture/workflow-engine.md) — the dynamic review-level model.

## Workflow (`workflow/`)

- [Query Lifecycle](./workflow/query-lifecycle.md) — narrative walkthrough of `QRY-2026-00427`.
- [Role / Permission Matrix](./workflow/role-permission-matrix.md)
- [Workflow Rules](./workflow/workflow-rules.md) — transfer & pullback specifics.

## API (`api/`)

- [API Plan](./api/api-plan.md) — planned REST resources; only `/health` exists today.
