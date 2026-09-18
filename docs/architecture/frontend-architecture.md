# Frontend Architecture

Design rationale. For the concrete file map, scripts, dependency list and dead-code register, see
[frontend/README.md](../../frontend/README.md).

## Folder Structure

```
frontend/src/
  main.jsx           React root: QueryClientProvider, font CSS, auth hydration only
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
  pages/             34 page components across 14 folders; thin, no business logic
  layouts/           MainLayout (authenticated shell), AuthLayout (bare, for /login)
  hooks/             useQueryCase, useWorkflowAction, useMailboxIngestion, useBucketFilter,
                     useRoutePaths
  services/
    api/             axiosClient (the only place axios is imported) + per-resource services
    persistence/     queryState.js — server-backed Query Case sync via /api/v1/queries
    ai/              mockAiService (deterministic fallback), draftComposer — local, no network
    notify.js        the only module importing sonner
  store/             useAuthStore, useWorkflowStore
  routes/            AppRoutes, roleRoutes, ProtectedRoute
  constants/         roles, permissions, routeSections, routePaths, navigation, status enums,
                     workflowRules, queryBuckets, policies, directory data
  utils/             cn, greeting, queryOwnership
  test/              39 test files + setup.js + fakeQueryApi.js
```

`src/assets/` and `src/features/` exist but are empty.

## State Layers

State is deliberately split by concern:

- **Global client state (Zustand)** — two stores. `useAuthStore` (session) and `useWorkflowStore`
  (the domain). One store per concern; never a single catch-all.
- **Domain persistence (`/api/v1/queries`)** — the workflow store hydrates once from
  `GET /queries` after sign-in and posts a per-case delta on every transition, through
  `services/persistence/queryState.js`. That module mirrors the state in tab-local memory so the
  UI keeps working when a write-through fails, and raises a toast rather than swallowing it. It
  was a Dexie/IndexedDB database until the server-side Query Case API landed. A **400** is named
  rather than generalised: `validateBody` has always answered `{ error, fields: ['auditEvent.event'] }`
  and the client discarded the list, so a contract mismatch read as an unactionable "changes were not
  saved"; the toast now carries the offending field paths — paths only, never values, since a delta
  carries case content.
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

Every workflow action failure — assign, draft, submit, approve, request revision, forward — surfaces
through `hooks/useWorkflowAction`, which reads `response.data.error` before falling back to the axios
message. Every API error is shaped `{ error, … }` by `middleware/errorHandler.js`, so reporting the
axios string showed "Request failed with status code 403" while the server had been naming the actual
refusal in the body all along.

**Two paths deliberately do not go through `applyTransition`: accepting a mailbox message, and
granting final approval.**
`acceptMailboxMessage` posts to `POST /mailbox/messages/:messageId/accept`, where the server mints
the Case ID, creates the case, summarises the enquiry onto `aiSummary`, acknowledges the sender and
forwards to the Officer-in-Charge, and then calls `refreshFromServer()` to read the result back. It reconstructs nothing locally, because
the server is now the only holder of that case — and it refreshes on a repeat accept too, since the
answer may name a case this tab has never seen and the inbox row would otherwise have nothing to
link to. The client no longer mints Case IDs on the email path; the in-app **Raise Enquiry** portal
path still does, and `POST /queries/persist` answers 409 if two tabs mint the same id.

`grantFinalApproval` follows the same shape: it posts to
`POST /queries/:queryId/final-approval` and calls `refreshFromServer()`, because the server is the
only holder of what just happened — the locked version, the outbound response, the closing audit
rows. `assertCan` stays in front of it, but as a convenience: it refuses an unauthorised click by
name rather than after a round trip, and the server enforces `FINAL_APPROVE` independently. Approving
and answering are one click but two outcomes, so `ApprovalDetailPage` reads `dispatched` and
`alreadyDispatched` off the response and raises an error if the approval was recorded but the
inquirer was not emailed — reporting only "approved" in that case is the failure the whole path
exists to prevent.

This replaces an arrangement where the store recorded the approval locally and then called
`dispatchResponse` with a null actor, on the theory that an automatic send is the system acting. The
null actor skipped only this store's own permission check; the HTTP request still went out on the
approving officer's session against the Front-Office-only `POST /emails/response`, so every approval
ended in a 403. `dispatchResponse` itself is unchanged and still serves the Front Office **Retry
sending response** control on the Dispatch page, which passes a real actor and is gated on
`DISPATCH` as it always was.

`refreshFromServer()` is separate from `hydrate()` rather than a flag on it: `hydrate()` returns
immediately once `hydrated` is true, which is exactly when this is called. It reports through
`persistenceError` instead of throwing — the server has already done the work, so a failed read is a
stale screen, not a lost case.

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
| Dashboards, queries, my work, assignments, drafting, reviews, approvals, dispatch, notifications | The workflow store, hydrated from `GET /queries` — **server-side** |
| Approvals → **Approve** | `POST /queries/:queryId/final-approval`, then a re-hydration. Not a state mirror: the server records the approval, sends the response and closes the case, and the store reads back what it did |
| Raise Enquiry | `GET /emails/config` for identities; `POST /attachments` then `POST /emails/enquiry` |
| IPC Mailbox | `GET /mailbox/messages`, `GET /mailbox/decisions`, `POST /mailbox/messages/:id/accept`, `POST /mailbox/messages/:id/decision` (rejections), `POST /mailbox/messages/:id/ingested`, `DELETE /mailbox/messages/:id` |
| Admin overview / activity / email / AI | `GET /audit`, `/audit/summary` — **server-side** |
| Admin settings | `GET /health`, `GET /audit/summary`, `GET /emails/config` |
| Admin users / divisions / categories | Static constants — no API exists for these yet |
| Reports | Live store KPIs; the charts are explicitly not connected |

## Path Alias

`@/` resolves to `frontend/src` (configured in `vite.config.js` and `jsconfig.json`) — always
import via `@/...`, never deep relative paths (`../../../..`).
