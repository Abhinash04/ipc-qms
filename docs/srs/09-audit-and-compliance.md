# 9. Audit and Compliance

## 9.1 Principle

Every important workflow event must be auditable, and audit records must not be casually
deleted or overwritten (append-only). The audit trail is what lets any query be reconstructed
end-to-end after the fact.

## 9.2 Audit Event Catalog

| Event | Meaning |
| --- | --- |
| `QUERY_RECEIVED` | A query arrived (e.g. via email) and a record was created. |
| `QUERY_REGISTERED` | Front Office confirmed the query's basic details. |
| `QUERY_FORWARDED` | Query forwarded to the OIC for assignment. |
| `QUERY_ASSIGNED` | OIC assigned the query to an official. |
| `ASSIGNMENT_OVERRIDDEN` | OIC assigned someone other than the AI recommendation. |
| `DRAFT_GENERATED` | AI produced an initial draft. |
| `DRAFT_UPDATED` | A human edited the draft, creating a new response version. |
| `REVIEW_ADDED` | A review level was added to the workflow. |
| `REVIEW_REMOVED` | A pending review level was removed from the workflow. |
| `REVIEW_COMPLETED` | A reviewer approved their review level. |
| `REVISION_REQUESTED` | A reviewer or the OIC returned the draft for revision. |
| `QUERY_TRANSFERRED` | The query was transferred to another official. |
| `QUERY_PULLED_BACK` | The query was pulled back to an earlier stage. |
| `FINAL_APPROVAL_GRANTED` | The OIC gave final approval. |
| `FINAL_APPROVAL_REJECTED` | The OIC rejected the draft at final approval. |
| `RESPONSE_DISPATCHED` | The approved response was sent to the inquirer. |
| `QUERY_CLOSED` | The query reached its terminal closed state. |

These map directly to `frontend/src/constants/statusEnums.js` (`AUDIT_EVENT`) in the client
workflow store, and are written 1:1 as the `action` of a backend audit-log row.

## 9.3 Record Shape (Conceptual)

Each audit record conceptually captures: `event`, `queryId`, `actor` (user or `System`/`AI`),
`at` (timestamp), and an optional `details` payload (e.g. previous vs new assignee for
`ASSIGNMENT_OVERRIDDEN`). Exact schema is finalized alongside
[13-data-model.md](./13-data-model.md). Audit records are persisted in MongoDB (`backend/src/models/AuditEvent.js`) and queryable via `GET /api/v1/audit`; the case-lifecycle trail is written into the same collection through `POST /api/v1/queries/persist`, which takes the actor from the session rather than from the request body.

## 9.4 Retention & Immutability

Audit records cannot be edited or deleted through the application: the `AuditEvent` model refuses
every update, replace and delete, and no route mutates the trail. Retention period and any
legal/compliance hold requirements are to be confirmed with the client.

**Tamper evidence.** Every persisted record carries a sequence number, the previous record's hash,
and an HMAC-SHA256 of its own contents keyed with `AUDIT_HMAC_SECRET`. An administrator can re-verify
the whole chain at any time (`GET /api/v1/audit/verify`, and the badge on the Audit Trail page); an
edited record, a deleted record and a reordered record are each reported with the position where the
chain breaks. Records written before chaining existed are reported as *legacy*. Removal of records
from the very end of the chain is not detectable from the data alone; the chain head printed on each
report is the reference to compare against.

**Production hardening (recommended).** Give the application's MongoDB user a role that allows only
`insert` and `find` on the `auditevents` collection, keep `AUDIT_HMAC_SECRET` out of the database's
reach, and never rotate it once the production trail exists.

## 9.5 Audit Reports

Administrators export the trail as **CSV** or **PDF** from the Audit Trail page, using the page's
current filters (`GET /api/v1/audit/export`). The PDF follows the Government of India audit trail
report format: report particulars with a unique reference (`IPC-QMS/ATR/<yyyy-mm>/<nnn>`) and the
classification "Official / Internal Use"; purpose; period summary; the detailed trail (Audit ID, date and
time in IST, user, role, source IP, case number, module, activity, previous and new value, result);
mandatory information; query lifecycle (for one case); authentication by day; privileged activity;
security events; integrity controls; log retention (CERT-In: at least 180 days); access-control review;
a 20-point verification checklist; findings and recommendations; compliance statement; and sign-off
blocks for the preparer, reviewer and approver. Items the application does not perform (user and role
administration, account lockout, database-level auditing) are stated as not applicable or for the
reviewer to confirm rather than claimed. Every export is itself recorded as `AUDIT_EXPORTED` with its
reference and a SHA-256 digest of its contents, so a printed or downloaded copy can later be matched to
the trail. CSV cells that a spreadsheet would treat as formulas are neutralised.

Each event records the person's user ID, name, role and session, the source IP address and browser (or
the server, for background work), and — for changes to a case — the previous and new status, assignee,
category or priority. Sign-out, rejected sessions and every view of the audit trail are recorded too.
