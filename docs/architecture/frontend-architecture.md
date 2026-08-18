# Frontend Architecture

## Folder Structure

```
frontend/src/
  assets/            static assets
  components/
    ui/              Button, Badge, Card — small style primitives
    layout/          Sidebar, Header (app shell chrome)
    common/          PageHeader, Breadcrumb, RoleGate, List/DetailPagePlaceholder
    workflow/        WorkflowTimeline (renders a dynamic WorkflowStep[])
  features/          reserved for future domain logic modules
  pages/             one folder per route area; thin components, no business logic
  layouts/           MainLayout (authenticated shell), AuthLayout (bare, for /login)
  hooks/             useHealthCheck (TanStack Query wrapper)
  services/
    api/             axiosClient (the only place axios is imported) + per-resource services
    ai/              reserved for future AI service wrappers
  store/             useAuthStore (Zustand)
  routes/            routePaths re-export point, AppRoutes, ProtectedRoute
  constants/         roles, permissions, routePaths, navigation, mock data, status enums
  utils/             cn.js (clsx + tailwind-merge)
```

## State Layers

Per `.claude/frontend-rules.md`, state is deliberately split by concern:

- **Global client state (Zustand)** — `useAuthStore` only, for now. One store per domain
  concern when more appear; never a single catch-all store.
- **Server state (TanStack Query)** — `useHealthCheck` is the only live query today. All
  future data fetching must go through a custom hook wrapping `useQuery`/`useMutation`, never
  a raw `axios` call inside a component (enforced by `engineering-rules.md` §4).
- **URL state** — `:queryId` route params (see `routes/AppRoutes.jsx`); no query-string state
  yet.
- **Local component state** — plain `useState` for anything not shared.

## Routing & RBAC

- `constants/routePaths.js` is the single source of truth for path strings — never hardcode a
  path string in a component.
- `routes/AppRoutes.jsx` maps every `ROUTE_PATHS.*` entry to its page component. Authenticated
  routes are wrapped in `ProtectedRoute` (gates by role via `constants/permissions.js`) inside
  `MainLayout`; `/login` renders inside the bare `AuthLayout`.
- `constants/permissions.js` maps each role to the route prefixes it may access.
  `ProtectedRoute` checks the current path against that map for the mock session's role and
  renders an inline "Access restricted" message on mismatch — this is a **display gate only**;
  real authorization must happen server-side once auth exists (see
  [../srs/08-security-and-access-control.md](../srs/08-security-and-access-control.md)).
- `components/common/RoleGate.jsx` provides the same allow-list check for gating individual
  UI elements (e.g. a button only certain roles should see) rather than whole routes.

## Route Plan

Application routes are **namespaced by role**: every page lives at
`/<role-slug>/<section>`, so the URL alone says who is looking at it and the route gate can
refuse another role's namespace outright. `/login` is the only page outside a namespace.

| Role | Slug |
| --- | --- |
| Inquirer | `inquirer` |
| Front Office | `front-officer` |
| Officer-in-Charge | `officer-in-charge` |
| Assigned Official | `assigned-official` |
| Reviewer | `reviewer` |
| Admin | `admin` |
| Super Admin | `super-admin` |

Routes are **generated**, not hand-listed: `constants/routeSections.js` defines the section
segments, `constants/permissions.js` grants sections per role, and `routes/roleRoutes.js` crosses
the two. Components never hold a literal path — they read `useRoutePaths()`, which resolves the
current user's role into concrete paths.

| Section | Segment | Granted to | Main Component | Data (this phase) | Future API Dependency |
| --- | --- | --- | --- | --- | --- |
| Login | `/login` (no namespace) | Everyone signed out | `LoginPage` | `MOCK_USERS` + one dev password | `POST /auth/login` |
| Dashboard | `dashboard` | All roles | `DashboardPage` | Live workflow store | `GET /dashboard` |
| Raise Enquiry | `compose` | Inquirer, Super Admin | `ComposeEnquiryPage` | `GET /emails/config` | `POST /emails/enquiry` |
| Queries | `queries` | Front Office, OIC, Assigned Official, Reviewer, Admin, Super Admin | `QueriesListPage` | Live workflow store | `GET /queries` |
| Query detail | `queries/:queryId` | Same as above | `QueryDetailPage` | Live workflow store | `GET /queries/:id`, `/reviews`, `/responses`, `/audit` |
| My Work | `my-work` | Assigned Official, Reviewer, Super Admin | `MyWorkPage` | Live workflow store | `GET /queries?assignee=me` |
| Assignments | `assignments` | OIC, Super Admin | `AssignmentsListPage` | Live workflow store | `GET /queries?state=PENDING_ASSIGNMENT` |
| Assignment detail | `assignments/:queryId` | OIC, Super Admin | `AssignmentDetailPage` | Route param only | `POST /queries/:id/assign` |
| Drafting | `drafting` | Assigned Official, Super Admin | `DraftingListPage` | Live workflow store | `GET /queries?state=DRAFTING` |
| Drafting detail | `drafting/:queryId` | Assigned Official, Super Admin | `DraftingDetailPage` | Route param only | `GET/POST /queries/:id/responses` |
| Reviews | `reviews` | Reviewer, Super Admin | `ReviewsListPage` | Live workflow store | `GET /queries?state=UNDER_REVIEW` |
| Review detail | `reviews/:queryId` | Reviewer, Super Admin | `ReviewDetailPage` | Route param only | `POST /queries/:id/reviews` |
| Approvals | `approvals` | OIC, Super Admin | `ApprovalsListPage` | Live workflow store | `GET /queries?state=PENDING_FINAL_APPROVAL` |
| Approval detail | `approvals/:queryId` | OIC, Super Admin | `ApprovalDetailPage` | Route param only | `POST /queries/:id/workflow` |
| Dispatch | `dispatch` | Front Office, Super Admin | `DispatchListPage` | Live workflow store | `GET /queries?state=READY_FOR_DISPATCH` |
| Dispatch detail | `dispatch/:queryId` | Front Office, Super Admin | `DispatchDetailPage` | Route param only | `POST /queries/:id/dispatch` (planned resource) |
| Notifications | `notifications` | All except Inquirer | `NotificationsPage` | Live workflow store | `GET /notifications` |
| Reports | `reports` | OIC, Admin, Super Admin | `ReportsPage` | Static text | `GET /dashboard` (reporting variant) |
| Administration | `administration` | Admin, Super Admin | `AdminOverviewPage` | Static links | — |
| Users | `users` | Admin, Super Admin | `AdminUsersPage` | `MOCK_USERS` | `GET/POST /users` |
| Roles | `roles` | Admin, Super Admin | `AdminRolesPage` | `ROLES` enum | `GET /roles` |
| Divisions | `divisions` | Admin, Super Admin | `AdminDivisionsPage` | `MOCK_DIVISIONS` + `MOCK_USERS` | `GET/POST /divisions` |
| Workflows | `workflows` | Admin, Super Admin | `AdminWorkflowsPage` | Static text | `GET/POST` (planned resource) |
| Categories | `categories` | Admin, Super Admin | `AdminCategoriesPage` | Static list | `GET/POST` (planned resource) |

Examples: `/front-officer/queries/QRY-2026-00001`, `/reviewer/reviews`, `/super-admin/users`,
`/inquirer/compose`.

**Access control.** `ProtectedRoute` sends a signed-out visitor to `/login`, and shows an
"Access restricted" panel when a signed-in user opens a URL outside their grants — the denial is
explicit rather than a 404, which makes RBAC verifiable by hand. The sidebar is derived from the
same grant lists (`navItemsForRole`), so it can never offer a link the gate would refuse.

**Authentication is mock.** `useAuthStore` holds the current mock user and persists only their id
to `localStorage` under `qms.auth`, resolving it back through `MOCK_USERS` on load; an id that no
longer exists fails closed to signed out. Replacing this with real authentication means changing
`LoginPage` and `useAuthStore` — the role-based routing above is unaffected.

## Path Alias

`@/` resolves to `frontend/src` (configured in `vite.config.js` and `jsconfig.json`) — always
import via `@/...`, never deep relative paths (`../../../..`).
