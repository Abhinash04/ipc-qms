# 6. Non-Functional Requirements

Numeric SLAs are not invented here — anything the client hasn't specified is marked
**To be confirmed.**

- **NFR-001 Security** — RBAC-gated access, no secrets in source control, HTTPS in production. Authentication is implemented as a JWT in an httpOnly cookie with per-route role guards (see 08).
- **NFR-002 Availability** — Target uptime: to be confirmed.
- **NFR-003 Performance** — Response-time targets: to be confirmed. Frontend should follow standard perf practices (code splitting, lazy loading for heavy views) as the app grows.
- **NFR-004 Scalability** — Expected concurrent user / query volume: to be confirmed.
- **NFR-005 Auditability** — Every workflow transition listed in [09-audit-and-compliance.md](./09-audit-and-compliance.md) must be recorded and retained; audit records are append-only.
- **NFR-006 Maintainability** — Feature-oriented frontend structure, controller/service separation on the backend, JavaScript only (no TypeScript), documented conventions in `.claude/*-rules.md`.
- **NFR-007 Accessibility** — Semantic HTML, keyboard-navigable UI, sufficient color contrast in the light theme. Formal accessibility standard (e.g. WCAG level) to be confirmed.
- **NFR-008 Data integrity** — Query, workflow step, and audit records must remain internally consistent (e.g. a query's `currentWorkflowStepId` must reference an existing step). Held today by the store's single-writer `applyTransition`, which updates state and appends the audit event in one commit; a server-side implementation must preserve that property.
- **NFR-009 Error handling** — User-facing errors should be clear and actionable; the backend must never leak stack traces in production (see `backend/src/middleware/errorHandler.js`).
- **NFR-010 Backup and recovery** — Backup frequency/retention: to be confirmed. MongoDB now holds Query Cases and workflow steps as well as the mailbox and audit trail, so one database backup covers the whole system of record.
