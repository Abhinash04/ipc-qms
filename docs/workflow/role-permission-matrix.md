# Role / Permission Matrix

The workflow action grants as implemented, derived from `ROLE_ACTIONS` in
`frontend/src/constants/workflowRules.js` (mirrored on the backend by
`backend/src/constants/workflowActions.js`, which `verifyAction` enforces). Items marked
**TO BE CONFIRMED WITH CLIENT** remain open — see
[srs/14-open-questions-and-client-clarifications.md](../srs/14-open-questions-and-client-clarifications.md).

The live tables are rendered in-app at **Administration → Roles**, which generates both this action
matrix and the page-access matrix from the same source — so the app is the authoritative view and
this page is the narrative one.

| Action | Inquirer | Front Office | OIC | Assigned Official | Reviewer | Admin | Super Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Raise an enquiry | ✅ | — | — | — | — | — | ✅ |
| View own cases | ✅ | — | — | — | — | — | ✅ |
| Register/verify incoming query | — | ✅ | — | — | — | — | ✅ |
| Forward to Officer-in-Charge | — | ✅ | — | — | — | — | ✅ |
| Assign query (accept AI or override) | — | — | ✅ | — | — | — | ✅ |
| Generate AI draft / edit response | — | — | — | ✅ | — | — | ✅ |
| Add a review level | — | — | — | ✅ | — | — | ✅ |
| Delete a review level (while PENDING) | — | — | — | ✅ | — | — | ✅ |
| Submit for review | — | — | — | ✅ | — | — | ✅ |
| Approve / request changes at a review level | — | — | — | — | ✅ | — | ✅ |
| Grant/reject final approval | — | — | ✅ | — | — | — | ✅ |
| Dispatch response | — | ✅ | — | — | — | — | ✅ |
| Transfer query | ⛔ gated | ⛔ gated | ⛔ gated | ⛔ gated | ⛔ gated | ⛔ gated | ⛔ gated |
| Pull back query | ⛔ gated | ⛔ gated | ⛔ gated | ⛔ gated | ⛔ gated | ⛔ gated | ⛔ gated |
| Read the audit trail | — | — | — | — | — | ✅ | ✅ |
| View admin console (users/divisions/categories/workflows) | — | — | — | — | — | ✅ | ✅ |
| System Settings | — | — | — | — | — | — | ✅ |
| View dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**⛔ gated** — the action is implemented in the store but listed in
`CLARIFICATION_REQUIRED_ACTIONS`, and `canPerform` refuses anything in that list *before* checking
the role table. No role can perform it today. See [workflow-rules.md](./workflow-rules.md).

**Review-level management** is held by the Assigned Official who owns the draft; who *else* may add
or remove levels is still open with the client.

**Reviewer ownership**: holding the Reviewer role is not sufficient — `assertOwnsStep` restricts
approve/request-changes to the reviewer assigned to the *current* level, so a second reviewer sees a
notice naming whose level it is rather than the decision controls.

**Two layers, two purposes.** This matrix covers *workflow actions*. Page access is a separate
grant table (`ROLE_SECTIONS` in `frontend/src/constants/permissions.js`) which decides which routes
exist for a role at all. Admin holds the console but **no workflow actions** — it is a configuration
and oversight role, not an operational one.

"Super Admin can do everything" reflects the implemented grant tables; it is still **not** a
confirmed business rule that Super Admin should hold every operational permission, and remains a
placeholder until the client confirms whether Super Admin is purely a configuration role or also an
operational override.
