# QMS Documentation

Documentation for the Query Management System, built for an IPC client.

**New here?** Start with [HANDOFF.md](./HANDOFF.md) — status at a glance, how to run it, what is
real versus mock, known gaps, and what to do next.

For the implementation as it actually stands, the two READMEs are the primary reference:
[backend/README.md](../backend/README.md) (routes, database, email pipeline, AI grounding,
configuration) and [frontend/README.md](../frontend/README.md) (routing/RBAC, state, API layer,
design system).

## Operational Guides

- [ENVIRONMENT.md](./ENVIRONMENT.md) — the environment reference: every variable the backend and
  frontend read, which env file the backend loads, which values are secret, the local profiles, the
  production values for the VM backend and the Render static site, and every boot refusal.
- [auth.md](./auth.md) — the 12 seeded accounts (a 13th, the NICeMail Front Office, when `NIC_BROWSER_MAILBOX=true`), their roles and landing dashboards, how
  sign-in works, and the known limitations of the seeded-account mechanism. **Contains no
  credentials** — each account's password is referenced by environment-variable name.
- [MAIL_MANUAL_TEST.md](./MAIL_MANUAL_TEST.md) — what a person still has to check by hand, and only
  that: the automated suites are listed first so the same ground is not covered twice. Covers the
  mock, NICeMail browser-agent and NICeMail SMTP postures, the three-inbox walkthrough, what the
  backend log should and should not say, and the attachment checklist. An enquiry is sent from any
  external address; no QMS account is involved.
- [NIC_EMAIL_PHASE0.md](./NIC_EMAIL_PHASE0.md) — the feasibility gate for NIC government email
  (`@gov.in`) over IMAP/SMTP. The `mgovcloud.in` endpoints are reachable and the transport is
  implemented and selectable, but **authentication has not yet succeeded**: an application-specific
  password is required under MFA.
- [NIC_BROWSER_AGENT.md](./NIC_BROWSER_AGENT.md) — setup runbook for the NICeMail browser agent:
  dedicated Chrome profile, CDP on `localhost:9222`, manual sign-in, `nic:browser:discover`.

> NICeMail has **two unrelated mechanisms** — IMAP/SMTP (the mail protocols, selected by
> `EMAIL_TRANSPORT=nic`) and the browser agent over CDP (attaching to a Chrome session an operator
> signed in to by hand). They share no code and no credential. See
> [backend/README.md](../backend/README.md#nicemail-two-separate-mechanisms) before changing either.

## SRS (`srs/`)

The software requirements specification, in reading order. These files define *what the system must
do*; where they describe implementation status, defer to the READMEs.

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
14. [Open Questions & Client Clarifications](./srs/14-open-questions-and-client-clarifications.md) — **the register of what still needs client sign-off.**

## Architecture (`architecture/`)

- [System Architecture](./architecture/system-architecture.md)
- [Frontend Architecture](./architecture/frontend-architecture.md) — includes the route plan.
- [Backend Architecture](./architecture/backend-architecture.md)
- [Workflow Engine](./architecture/workflow-engine.md) — the dynamic review-level model.

## Workflow (`workflow/`)

- [Query Lifecycle](./workflow/query-lifecycle.md) — narrative walkthrough of one case.
- [Role / Permission Matrix](./workflow/role-permission-matrix.md)
- [Workflow Rules](./workflow/workflow-rules.md) — transfer & pullback specifics.
- [Query & Email Management Flow](./workflow/query_email_management_flow.md) — analysis of the
  client's reference email thread and the work it implies.
- [AI Email Generation — Production Flow](./workflow/AI_Email_Generation_Production_Flow.md) — the
  step-by-step production flow for AI-generated replies.

## API (`api/`)

- [API Plan](./api/api-plan.md) — the implemented REST surface, and what remains planned.

## Not documentation: `docs/markdown/`

`docs/markdown/` holds IPC source material — guidance documents, amendment lists, notices and FAQs
— used to build the AI's grounding corpus. It is **gitignored and not part of the repository**, and
it is not project documentation.

The committed artefact of record is `backend/src/data/ipcKnowledge.json`, which is what the
application reads: a fresh clone has full grounding and needs no build step. `npm run ingest:ipc` is
a maintainer step, run when the source documents change, and it needs the corpus obtained
separately. See [backend/README.md](../backend/README.md#ai-grounding-layer) for the ingestion
rules, including which documents are deliberately excluded from retrieval and why none of them are
deleted.
