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

In scope and **built**: the frontend shell and role-generated routing, real authentication, RBAC and
case-level authorization, email ingestion/dispatch, AI-assisted summary/assignment/drafting,
server-side persistence of Query Cases, the mailbox and the audit trail, attachments, the workflow
state-transition engine with dynamic review levels, in-app notifications and toasts, and the
administration console.

In scope but **not yet built**:

- **Workflow-state authorization** — `verifyAction` enforces which roles may ever perform an action;
  whether the case was in a state that allowed it is still decided in the client store.
- **A mutable user directory** — each account has its own credential, but the directory itself is a
  source-code constant, so an account cannot be added or deactivated without a redeploy.
- **Transfer and pullback policy** — both actions are **live**, not disabled. What is outstanding is
  the client's sign-off on who may act, from which stages, and what happens to completed reviews; the
  implementation picked defaults. See
  [workflow/workflow-rules.md](../workflow/workflow-rules.md).
- **Production notifications** (email/SMS out to users) — in-app notifications and toasts exist.
- **NICeMail SMTP** — the IMAP/SMTP transport is written and selectable but still awaiting an
  application-specific password; see [../NIC_EMAIL_PHASE0.md](../NIC_EMAIL_PHASE0.md). The
  operator-signed-in browser session is the working NICeMail channel.

See [14-open-questions-and-client-clarifications.md](./14-open-questions-and-client-clarifications.md)
for what still needs client confirmation.
