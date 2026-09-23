# 1. Introduction

## 1.1 Purpose

This document specifies the requirements for the **Query Management System (QMS)** being
built for the IPC client. It covers the full lifecycle of an incoming query — from receipt
through registration, assignment, drafting, dynamic review, final approval, response dispatch,
and closure.

## 1.2 Scope

This document specifies the system as a whole. It is a **requirements** document — for what is
built today, see [docs/HANDOFF.md](../HANDOFF.md) and the two READMEs.

Delivered since this was first written: real authentication (JWT in an httpOnly cookie with
role-based route guards) and **case-level authorization**, the email pipeline (mock and NICeMail
transports, inbox ingestion, acknowledgement, forwarding, dispatch), AI integration (Pravah Gemma
grounded in an indexed IPC corpus), server-side persistence (MongoDB for Query Cases, the mailbox
and the audit trail), attachments, and the workflow state-transition engine with dynamic review
levels.

Still outstanding: the **workflow-state half** of authorization — `verifyAction` enforces which
roles may ever perform an action, but not whether the case was in a state that allowed it — token
revocation, a user directory that can be changed without a redeploy, and the items still awaiting
client sign-off in
[14-open-questions-and-client-clarifications.md](./14-open-questions-and-client-clarifications.md).

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
- **MongoDB (via Mongoose)** is the database. An earlier assumption that PostgreSQL would be used
  was not carried through — there is no PostgreSQL client in the project.
- The system is used internally by IPC staff. Inquirers are **external**: a member of the public
  emails the Front Office mailbox, is read off the `From` header at intake, holds no account and
  never signs in. An implementation that briefly gave the inquirer an in-app account — a dashboard,
  a Raise Enquiry form and read access to their own cases — has been reverted, so the original
  assumption stands.
