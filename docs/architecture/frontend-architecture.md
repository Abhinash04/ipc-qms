# Frontend Architecture

Design rationale. For the concrete file map, scripts, dependency list and dead-code register, see
[frontend/README.md](../../frontend/README.md).

## Folder Structure

```
frontend/src/
  main.jsx           React root: QueryClientProvider, font CSS, both store hydrations
  App.jsx            HydrationGate -> NotificationHost + BrowserRouter -> AppRoutes
  index.css          Tailwind v4 @theme tokens + custom utility layers (no tailwind.config.js)
  components/
    ui/              shadcn/ui primitives (34 files; 17 in use, 17 dormant scaffold)
    layout/          Sidebar, Header, MobileNav (app shell chrome)
    common/          PageHeader, Breadcrumb, EmptyState, StatTile, StatusBadge, RoleGate, IpcLogo
    workflow/        WorkflowActionsCard, QueryTable, QueryLifecycleTimeline, ReviewDecisionCard,
                     CaseOfficialsCard, MailboxIngestButton, MailboxAutoSync
    admin/           AuditTable, KpiTile, Panel, charts (hand-written SVG), adminStats
    attachments/     AttachmentPicker, AttachmentList, AttachmentViewerDialog
    ai/              AiSummaryCard, AiRecommendationCard
    dashboard/       BucketDashboard and its widgets
    email/           EmailThread
    notifications/   NotificationHost
  pages/             35 page components across 14 folders; thin, no business logic
  layouts/           MainLayout (authenticated shell), AuthLayout (bare, for /login)
  hooks/             useQueryCase, useWorkflowAction, useMailboxIngestion, useBucketFilter,
                     useRoutePaths
  services/
    api/             axiosClient (the only place axios is imported) + per-resource services
    db/              db.js — Dexie/IndexedDB schema and transactions
    ai/              mockAiService (deterministic fallback), draftComposer — local, no network
    notify.js        the only module importing sonner
  store/             useAuthStore, useWorkflowStore
  routes/            AppRoutes, roleRoutes, ProtectedRoute
  constants/         roles, permissions, routeSections, routePaths, navigation, status enums,
                     workflowRules, queryBuckets, policies, directory data
  utils/             cn, greeting, queryOwnership
  test/              38 test files + setup.js
```

`src/assets/` and `src/features/` exist but are empty.

## State Layers

State is deliberately split by concern:

- **Global client state (Zustand)** — two stores. `useAuthStore` (session) and `useWorkflowStore`
  (the domain). One store per concern; never a single catch-all.
- **Domain persistence (Dexie/IndexedDB)** — the workflow store writes a per-case delta on every
  transition. Database `qms`, schema v2.
- **Server state (TanStack Query)** — everything fetched from the API: mailbox messages, email
  config, audit events and summaries, health. Fetching goes through a service module in
  `services/api/`, never a raw `axios` call inside a component.
- **URL state** — `:queryId` route params, plus the Admin activity page seeding its filters from the
  query string so `?result=failure` deep links work.
- **Local component state** — plain `useState` for anything not shared.

### The single-writer rule

Every workflow mutation funnels through `useWorkflowStore.applyTransition`. Its pure helper
`computeTransition` mints an audit id, merges the patch, **derives `businessStatus` from
`workflowState`** so the two cannot disagree, **always appends exactly one audit event**, optionally
appends a notification, and applies a `mutate()` patch for other collections.

Two consequences worth knowing before changing anything here:

1. **The audit trail is complete by construction** — there is no path that changes case state
   without recording it.
2. **The toast layer subscribes to that trail**, not to click handlers, so a notification cannot
   appear for an action that failed.

Permissions are enforced *in the store*, not only in the UI: `assertCan` throws unless
`canPerform(role, action, workflowState)` allows it, and `assertOwnsStep` prevents a reviewer acting
on another reviewer's level.

## Routing & RBAC

Routes are **generated, not hand-listed**:

- `constants/routeSections.js` defines 28 sections, each with a URL segment, label, icon and an
  optional `nav: true`.
- `constants/permissions.js` grants sections per role (`ROLE_SECTIONS`) and defines the URL slug
  (`ROLE_SLUG`).
- `constants/routePaths.js` composes them into `/<slug>/<segment>`, frozen per role.
- `routes/roleRoutes.js` crosses the two; `AppRoutes.jsx` renders one `<Route>` per entry.

**A section a role does not hold has no route at all** — absent, not hidden. Components never hold a
literal path; they read `useRoutePaths()`, and `paths[SECTION]` being undefined is the idiomatic way
to hide a link the current role cannot follow.

Every authenticated page lives at `/<role-slug>/<section>`, so the URL alone says who is looking at
it and the gate can refuse another role's namespace outright. `/login` is the only page outside a
namespace.

| Role | Slug | Sections granted |
|---|---|---|
| Inquirer | `inquirer` | 3 — dashboard, compose, query detail |
| Front Office | `front-officer` | 7 — + inbox, queries, dispatch, notifications |
| Officer-in-Charge | `officer-in-charge` | 9 — + assignments, approvals, reports |
| Assigned Official | `assigned-official` | 7 — + my work, drafting |
| Reviewer | `reviewer` | 7 — + my work, reviews |
| Admin | `admin` | 14 — operational + the admin console, **excluding System Settings** |
| Super Admin | `super-admin` | all 28 |

Examples: `/front-officer/queries/QRY-2026-00001`, `/reviewer/reviews`,
`/super-admin/administration/settings`, `/inquirer/compose`.

`ProtectedRoute` waits for `authReady`, redirects a signed-out visitor to `/login` (preserving the
attempted path), then calls `isRouteAllowedForRole`. A denial renders an explicit "Access
restricted" panel rather than a 404, which makes RBAC verifiable by hand. `segmentMatches` compares
path-part counts and treats `:param` parts as wildcards, so a list path can never satisfy a detail
path.

The sidebar and mobile nav derive from the same grant lists (`navItemsForRole`), so navigation can
never offer a link the gate would refuse. `components/common/RoleGate.jsx` applies the same
allow-list check to individual UI elements.

> **This is a client-side gate.** The backend enforces its own per-route chain (`verifyToken` →
> `verifyRole`/`verifyAction`). The frontend gate is for usability and must never be treated as the
> security boundary — see
> [../srs/08-security-and-access-control.md](../srs/08-security-and-access-control.md).

## Authentication

Real, and server-backed. `useAuthStore` holds `currentUser` and `authReady`; the session itself
lives in an httpOnly cookie the server sets and is deliberately **not** mirrored into
`localStorage`, because a mirror can drift and any script on the page can read it. `hydrate()` asks
`GET /auth/me` at boot; `authReady` distinguishes "not signed in" from "we have not asked yet", so a
reload does not flash the login screen.

A 401 from any non-`/auth/*` endpoint clears the session and raises a "session expired" toast, via a
handler the store *registers* with the axios client rather than being imported by it — the store
already imports the client through `authService`, so importing back would close a cycle.

## Data sources, by page area

| Area | Source |
|---|---|
| Dashboards, queries, my work, assignments, drafting, reviews, approvals, dispatch, notifications | The workflow store (IndexedDB — **browser-local**) |
| Raise Enquiry | `GET /emails/config` for identities; `POST /attachments` then `POST /emails/enquiry` |
| IPC Mailbox | `GET /mailbox/messages`, `POST /mailbox/messages/:id/ingested`, `DELETE /mailbox/messages/:id` |
| Admin overview / activity / email / AI | `GET /audit`, `/audit/summary` — **server-side** |
| Admin settings | `GET /health`, `GET /audit/summary`, `GET /emails/config` |
| Admin users / divisions / categories | Static constants — no API exists for these yet |
| Reports | Live store KPIs; the charts are explicitly not connected |

## Path Alias

`@/` resolves to `frontend/src` (configured in `vite.config.js` and `jsconfig.json`) — always
import via `@/...`, never deep relative paths (`../../../..`).
