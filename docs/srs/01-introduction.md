# 1. Introduction

## 1.1 Purpose

This document specifies the requirements for the **Query Management System (QMS)** being
built for the IPC client. It covers the full lifecycle of an incoming query — from receipt
through registration, assignment, drafting, dynamic review, final approval, response dispatch,
and closure.

## 1.2 Scope

This phase of work delivers the **initial software foundation**: repository structure,
frontend/backend scaffolding, routing skeleton, mock authentication/RBAC, mock data, and this
documentation set. It does **not** implement real authentication, email ingestion, AI
integration, database persistence, or the workflow engine — those are scoped for later phases
once the open questions in
[14-open-questions-and-client-clarifications.md](./14-open-questions-and-client-clarifications.md)
are resolved with the client.

## 1.3 Objectives

- Give every incoming query a single, auditable record from receipt to closure.
- Support AI-assisted assignment and drafting, with a human always in control of the final
  decision.
- Support a **dynamic** number of review levels per query, not a fixed set.
- Preserve a complete, immutable audit trail of every workflow transition.
- Provide role-based views so each actor only sees what's relevant to their responsibilities.

## 1.4 Terminology

| Term | Meaning |
| --- | --- |
| Query | A single inquiry received from an inquirer, tracked as one case through the system. |
| Business Status | The coarse, client-facing lifecycle summary of a query (OPEN / IN_PROGRESS / CLOSED). |
| Workflow State | The fine-grained internal step a query is currently at (see [05-workflow-and-state-machine.md](./05-workflow-and-state-machine.md)). |
| Workflow Step | One instance in a query's dynamic review/approval chain (see [architecture/workflow-engine.md](../architecture/workflow-engine.md)). |
| OIC | Officer-in-Charge — assigns queries and grants final approval. |
| Assigned Official | The official responsible for drafting the response. |
| Reviewer | A user assigned to one review level in a query's workflow. |
| Dispatch | The act of sending the approved response back to the inquirer. |

## 1.5 Assumptions

- The client will confirm the open items in
  [14-open-questions-and-client-clarifications.md](./14-open-questions-and-client-clarifications.md)
  before the workflow engine, real email integration, and real AI integration are built.
- PostgreSQL is the intended production database; no ORM or schema has been chosen yet.
- The system is used internally by IPC staff; inquirers are external and do not log in.
