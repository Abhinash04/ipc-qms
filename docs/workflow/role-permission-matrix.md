# Role / Permission Matrix

This is a **proposed** matrix reflecting the confirmed shape of the workflow (spec §14–20)
plus the frontend's current route-level RBAC (`frontend/src/constants/permissions.js`). Items
marked **TO BE CONFIRMED WITH CLIENT** are not settled — see
[srs/14-open-questions-and-client-clarifications.md](../srs/14-open-questions-and-client-clarifications.md).

| Action | Front Office | OIC | Assigned Official | Reviewer | Admin | Super Admin |
| --- | --- | --- | --- | --- | --- | --- |
| Register/verify incoming query | ✅ | — | — | — | — | ✅ |
| Assign query (accept AI or override) | — | ✅ | — | — | — | ✅ |
| Draft / edit response | — | — | ✅ | — | — | ✅ |
| Approve / return a review level | — | — | — | ✅ | — | ✅ |
| Add a review level | TO BE CONFIRMED WITH CLIENT | TO BE CONFIRMED WITH CLIENT | TO BE CONFIRMED WITH CLIENT | TO BE CONFIRMED WITH CLIENT | — | ✅ |
| Delete a review level | TO BE CONFIRMED WITH CLIENT | TO BE CONFIRMED WITH CLIENT | TO BE CONFIRMED WITH CLIENT | TO BE CONFIRMED WITH CLIENT | — | ✅ |
| Transfer query | TO BE CONFIRMED WITH CLIENT | TO BE CONFIRMED WITH CLIENT | TO BE CONFIRMED WITH CLIENT | TO BE CONFIRMED WITH CLIENT | — | ✅ |
| Pull back query | TO BE CONFIRMED WITH CLIENT | TO BE CONFIRMED WITH CLIENT | TO BE CONFIRMED WITH CLIENT | TO BE CONFIRMED WITH CLIENT | — | ✅ |
| Grant/reject final approval | — | ✅ | — | — | — | ✅ |
| Dispatch response | ✅ | — | — | — | — | ✅ |
| Manage users/divisions/categories/workflows | — | — | — | — | ✅ | ✅ |
| View dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

"Super Admin can do everything" reflects the frontend's current display-only route map; it is
**not** a confirmed business rule that Super Admin should hold every operational permission —
it is a placeholder until the client confirms whether Super Admin is purely a configuration
role or also an operational override role.
