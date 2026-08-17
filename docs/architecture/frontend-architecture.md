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

Every planned route, its purpose, and what it depends on. "Placeholder" pages exist to
establish the skeleton per the initial-foundation scope; only Dashboard and Query Detail are
built out with real mock data end-to-end.

| Route | Purpose | Primary Role(s) | Main Component | Data (this phase) | Future API Dependency |
| --- | --- | --- | --- | --- | --- |
| `/login` | Entry point; explains the mock session. | All | `LoginPage` | Mock current user | `POST /auth/login` |
| `/dashboard` | Role-specific pending-work overview. | All | `DashboardPage` | Mock KPIs + `MOCK_QUERY` | `GET /dashboard` |
| `/queries` | All registered queries. | Admin, Front Office, OIC, Assigned Official, Reviewer | `QueriesListPage` | `MOCK_QUERY` (1 row) | `GET /queries` |
| `/queries/:queryId` | Full query detail — info, timeline, draft, reviews, audit. | Same as above | `QueryDetailPage` | `MOCK_QUERY` (full) | `GET /queries/:id`, `/reviews`, `/responses`, `/audit` |
| `/my-work` | Queries assigned to / awaiting the current user. | Assigned Official, Reviewer, Super Admin | `MyWorkPage` | `MOCK_QUERY` (1 row) | `GET /queries?assignee=me` |
| `/assignments` | Queries pending/awaiting assignment. | OIC, Super Admin | `AssignmentsListPage` | `MOCK_QUERY` (1 row) | `GET /queries?state=PENDING_ASSIGNMENT` |
| `/assignments/:queryId` | AI recommendation + assign/override. | OIC, Super Admin | `AssignmentDetailPage` | Route param only | `POST /queries/:id/assign` |
| `/drafting` | Queries in investigation & drafting. | Assigned Official, Super Admin | `DraftingListPage` | `MOCK_QUERY` (1 row) | `GET /queries?state=DRAFTING` |
| `/drafting/:queryId` | AI draft + human editing. | Assigned Official, Super Admin | `DraftingDetailPage` | Route param only | `GET/POST /queries/:id/responses` |
| `/reviews` | Queries awaiting the user's review. | Reviewer, Super Admin | `ReviewsListPage` | `MOCK_QUERY` (1 row) | `GET /queries?state=UNDER_REVIEW` |
| `/reviews/:queryId` | Approve / return a review step. | Reviewer, Super Admin | `ReviewDetailPage` | Route param only | `POST /queries/:id/reviews` |
| `/approvals` | Reviewed drafts awaiting final approval. | OIC, Super Admin | `ApprovalsListPage` | `MOCK_QUERY` (1 row) | `GET /queries?state=PENDING_FINAL_APPROVAL` |
| `/approvals/:queryId` | Final approve / reject / return. | OIC, Super Admin | `ApprovalDetailPage` | Route param only | `POST /queries/:id/workflow` |
| `/dispatch` | Approved responses ready to send. | Front Office, Super Admin | `DispatchListPage` | `MOCK_QUERY` (1 row) | `GET /queries?state=READY_FOR_DISPATCH` |
| `/dispatch/:queryId` | Preview + send + close. | Front Office, Super Admin | `DispatchDetailPage` | Route param only | `POST /queries/:id/dispatch` (planned resource) |
| `/notifications` | Workflow events relevant to the user. | All | `NotificationsPage` | Static mock list | `GET /notifications` |
| `/reports` | Operational metrics/exports. | Admin, Super Admin, OIC | `ReportsPage` | Static text | `GET /dashboard` (reporting variant) |
| `/admin` | Admin area index. | Admin, Super Admin | `AdminOverviewPage` | Static links | — |
| `/admin/users` | User directory. | Admin, Super Admin | `AdminUsersPage` | `MOCK_USERS` | `GET/POST /users` |
| `/admin/roles` | Role hierarchy reference. | Admin, Super Admin | `AdminRolesPage` | `ROLES` enum | `GET /roles` |
| `/admin/divisions` | Divisions + members. | Admin, Super Admin | `AdminDivisionsPage` | `MOCK_DIVISIONS` + `MOCK_USERS` | `GET/POST /divisions` |
| `/admin/workflows` | Review-level templates. | Admin, Super Admin | `AdminWorkflowsPage` | Static text | `GET/POST` (planned resource) |
| `/admin/categories` | Query categories. | Admin, Super Admin | `AdminCategoriesPage` | Static list | `GET/POST` (planned resource) |

## Path Alias

`@/` resolves to `frontend/src` (configured in `vite.config.js` and `jsconfig.json`) — always
import via `@/...`, never deep relative paths (`../../../..`).
