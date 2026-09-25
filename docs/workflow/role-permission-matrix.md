# Role / Permission Matrix

The workflow action grants as implemented, derived from `ROLE_ACTIONS` in
`frontend/src/constants/workflowRules.js` (mirrored on the backend by
`backend/src/constants/workflowActions.js`, which `verifyAction` enforces). Items marked
**TO BE CONFIRMED WITH CLIENT** remain open — see
[srs/14-open-questions-and-client-clarifications.md](../srs/14-open-questions-and-client-clarifications.md).

The live tables are rendered in-app at **Administration → Roles**, which generates both this action
matrix and the page-access matrix from the same source — so the app is the authoritative view and
this page is the narrative one.

**Six roles, six columns.** There is no Inquirer column, because an inquirer holds no account: they
are a member of the public who emails the Front Office mailbox, are read off the `From` header at
intake, and sign in to nothing. An earlier revision of this table carried an Inquirer column with
*Raise an enquiry* and *View own cases* rows, for a signing-in `INQUIRER` role that has since been
removed along with the Raise Enquiry portal — see
[srs/03-stakeholders-and-roles.md](../srs/03-stakeholders-and-roles.md#31-roles).

| Action | Front Office | OIC | Assigned Official | Reviewer | Admin | Super Admin |
| --- | --- | --- | --- | --- | --- | --- |
| Register/verify incoming query (accept — includes the forward) | ✅ | — | — | — | — | ✅ |
| Forward to Officer-in-Charge (recovery only) | ✅ | — | — | — | — | ✅ |
| Assign query (accept AI or override) | — | ✅ | — | — | — | ✅ |
| Generate AI draft / edit response | — | — | ✅ | — | — | ✅ |
| Add a review level | — | — | ✅ | — | — | ✅ |
| Delete a review level | ⛔ gated | ⛔ gated | ⛔ gated | ⛔ gated | ⛔ gated | ⛔ gated |
| Submit for review | — | — | ✅ | — | — | ✅ |
| Approve / request changes at a review level | — | — | — | ✅ | — | ✅ |
| Grant/reject final approval (granting also sends the response) | — | ✅ | — | — | — | ✅ |
| Return a draft for revision from final approval | — | ✅ | — | — | — | ✅ |
| Dispatch response (retry only) | ✅ | — | — | — | — | ✅ |
| Transfer query (assignee only, reason required) | — | — | ✅ | — | — | ✅ |
| Pull back query (any stage) | — | — | — | — | ✅ | ✅ |
| Read the audit trail | — | — | — | — | ✅ | ✅ |
| View admin console (users/divisions/categories/workflows) | — | — | — | — | ✅ | ✅ |
| System Settings | — | — | — | — | — | ✅ |
| View dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Transfer and pullback are live, and their policy is not settled.** Corrected 2026-09-23 — both rows
read "⛔ gated" for every role, which stopped being true when the two actions were taken out of
`CLARIFICATION_REQUIRED_ACTIONS`. The grants above are what `ROLE_ACTIONS` and `ACTION_VALID_STATES`
now enforce; who *should* hold them, and from which stages, is still open with the client. See
[workflow-rules.md](./workflow-rules.md), which lists the defaults the implementation chose.

**⛔ gated** — an action implemented in the store but listed in `CLARIFICATION_REQUIRED_ACTIONS`, which
`canPerform` refuses *before* checking the role table, so no role can perform it. One action is in
that list today: `DELETE_REVIEW_LEVEL`, the *Delete a review level* row above, on both the frontend and
the backend. It appears in no role's `ROLE_ACTIONS` entry either, which is why every column reads
gated rather than showing it as an Assigned Official grant.

**Accept and forward are one grant, not two.** Accepting a mailbox message registers the case *and*
forwards it to the Officer-in-Charge in a single server call, so the two rows above are exercised
together by one ✓ click. `POST /api/v1/mailbox/messages/:messageId/accept` is guarded by
`verifyToken` + `verifyRole([FRONT_OFFICE, SUPER_ADMIN])` + `validateBody`. The separate **Forward
to Officer-in-Charge** action survives only as the recovery path for a forward that failed during
accept, which is why it keeps its own row.

**Final approval sends the response, and no role gained `DISPATCH` for it.** Granting final approval
is one call — `POST /api/v1/queries/:queryId/final-approval`, guarded by `verifyToken` +
`verifyAction(FINAL_APPROVE)` + `validateBody` — which records the approval, sends the response to
the inquirer and closes the case. The Officer-in-Charge's session authorises `FINAL_APPROVE`, which
is theirs; the **server** performs the send under the Front Office identity it already holds, so the
two rows above are still two distinct grants held by two distinct roles. This replaces an earlier
arrangement where the browser called the Front-Office-only `POST /emails/response` from the
approving officer's session and was refused with a 403 every time.

`DISPATCH` therefore remains a Front Office grant, and the **Retry sending response** control on the
Dispatch page is what exercises it — the recovery path for a send that did not complete. It passes a
real actor and is gated exactly as it always was. On the normal path the Front Officer presses
nothing.

**One Front Office account.** With `NIC_BROWSER_MAILBOX=true` the only `FRONT_OFFICE` account
exists (`USR-0014`, signing in as `NIC_EMAIL` — see
[auth.md](../auth.md#the-nicemail-front-office)). It holds exactly the Front Office column above. Its
mailbox routes always act on the NICeMail mailbox read by the browser agent, and `?recipient=` cannot
point them elsewhere, while `SUPER_ADMIN` reads the `MAILBOX_SOURCE` mailbox. Cases are shared. Which mailbox
answers follows the **case**, not the person acting: a case accepted from NICeMail sends **all three**
of its emails — acknowledgement, forward to the Officer-in-Charge, final response — and their retries
through NICeMail, whether a Front Officer, Super Admin or the Officer-in-Charge's final approval
triggers the send. The rule is stated normatively in
[backend/README.md](../../backend/README.md#which-channel-a-cases-mail-goes-out-through). The pinning
covers that account's own requests only — the decision routes are not scoped to a mailbox; see
[NIC_BROWSER_AGENT.md §17](../NIC_BROWSER_AGENT.md#known-limitations--open).

**Resetting the workflow state is Super Admin only**, in the UI as well as in the API. The header
Reset button is rendered only for `SUPER_ADMIN`, matching `verifyRole(SUPER_ADMIN)` on
`POST /queries/reset`; it used to be shown to every role, and the 403 arrived after local state had
already been cleared. Local state is now cleared only once the server has accepted the reset.

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
