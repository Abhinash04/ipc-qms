# 2. System Overview

## 2.1 Business Problem

Queries arrive by email today with no shared system of record. Front Office staff triage them
manually, assignment relies on personal knowledge of who's available, drafts and revisions
circulate informally, and there is no consolidated audit trail of who did what and when.

## 2.2 Proposed Solution

QMS gives every query a structured record that moves through a defined workflow: intake,
verification, assignment (AI-assisted), drafting (AI-assisted), one or more review levels,
final approval, and dispatch. Every transition is audited. The workflow supports transfer and
pullback for exceptional cases.

## 2.3 Major Modules

- **Query Intake** — registers incoming queries and their attachments.
- **Assignment** — AI recommendation + human (OIC) decision.
- **Drafting** — AI-generated initial response + human editing, with versioning.
- **Dynamic Review** — a variable-length chain of review levels.
- **Final Approval** — OIC sign-off before dispatch.
- **Dispatch** — sends the approved response and closes the query.
- **Audit & Compliance** — records every workflow event.
- **Admin** — users, roles, divisions, workflow templates, categories.

## 2.4 Actors

| Actor | Summary |
| --- | --- |
| Inquirer | External party who submitted the query. Does not use the system directly. |
| Front Office | Registers/verifies incoming queries and dispatches approved responses. |
| Officer-in-Charge (OIC) | Assigns queries and grants final approval. |
| Assigned Official | Drafts the response. |
| Reviewer | Reviews a draft at one review level. |
| Admin / Super Admin | Configures users, roles, divisions, workflows, categories. |

See [03-stakeholders-and-roles.md](./03-stakeholders-and-roles.md) for the full role hierarchy.

## 2.5 System Boundaries

In scope (this phase): frontend shell, routing, RBAC skeleton, mock data, backend health
endpoint, and this documentation set.

Out of scope (future phases): real authentication, email ingestion/dispatch, AI model
integration, PostgreSQL persistence, the workflow state-transition engine, and production
notifications. See [14-open-questions-and-client-clarifications.md](./14-open-questions-and-client-clarifications.md)
for what must be confirmed before each of those is built.
