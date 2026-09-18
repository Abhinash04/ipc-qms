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
- **Final Approval** — OIC sign-off, which also dispatches.
- **Dispatch** — sends the approved response and closes the query. Automatic on final approval; the
  Front Office page is a status view with a retry for a send that did not complete.
- **Audit & Compliance** — records every workflow event.
- **Admin** — users, roles, divisions, workflow templates, categories.

## 2.4 Actors

| Actor | Summary |
| --- | --- |
| Inquirer | External party who submitted the query. Does not use the system directly. |
| Front Office | Registers/verifies incoming queries. Retains the dispatch permission, now exercised only to retry a send that did not complete. |
| Officer-in-Charge (OIC) | Assigns queries and grants final approval, which dispatches the response. |
| Assigned Official | Drafts the response. |
| Reviewer | Reviews a draft at one review level. |
| Admin / Super Admin | Configures users, roles, divisions, workflows, categories. |

See [03-stakeholders-and-roles.md](./03-stakeholders-and-roles.md) for the full role hierarchy.

## 2.5 System Boundaries

In scope and **built**: the frontend shell and role-generated routing, real authentication and
RBAC, email ingestion/dispatch, AI-assisted summary/assignment/drafting, server-side persistence of
Query Cases, the mailbox and the audit trail, attachments, the workflow state-transition engine with
dynamic review levels, in-app notifications and toasts, and the administration console.

In scope but **not yet built**:

- **Case-level authorization** — Query Cases and their workflow steps are in MongoDB behind
  `/api/v1/queries`, but every signed-in role can read every case and every attachment.
- **Per-user credentials** — accounts are seeded from source and share one development password.
- **Transfer and pullback** — implemented in the store but deliberately disabled pending client
  answers.
- **Production notifications** (email/SMS out to users) — in-app notifications and toasts exist.
- **NIC government email** — blocked at Phase 0; see [../NIC_EMAIL_PHASE0.md](../NIC_EMAIL_PHASE0.md).

See [14-open-questions-and-client-clarifications.md](./14-open-questions-and-client-clarifications.md)
for what still needs client confirmation.
