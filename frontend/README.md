# QMS Frontend

React 19 + Vite 8 single-page app for the Query Management System. **JavaScript only** — no
TypeScript. Path alias `@` → `./src` (set in both `vite.config.js` and `jsconfig.json`).

## Setup

```bash
npm install
cp .env.example .env
npm run dev        # http://localhost:5173
```

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm run preview` | Serve the build |
| `npm run lint` | ESLint |
| `npm test` | Vitest, 38 test files |
| `npm run test:watch` | Vitest watch mode |

**Environment** — one variable:

```env
VITE_API_BASE_URL=http://localhost:5000/api/v1
```

The backend must be running for sign-in, email, attachments, AI and the admin console. See
[`../backend/README.md`](../backend/README.md), and [`../docs/auth.md`](../docs/auth.md) for the
development accounts.

## Architecture at a glance

```
main.jsx → QueryClientProvider → App
App      → HydrationGate → NotificationHost + BrowserRouter → AppRoutes
                                              ↓
                          ProtectedRoute → MainLayout → page
```

`HydrationGate` blocks rendering until both the workflow store has loaded from IndexedDB and
`/auth/me` has answered — without it, a reload flashes the login screen before the session is known.
`NotificationHost` mounts *outside* the router so the login page gets toasts too, but *inside* the
gate so seeded history is never replayed as a burst of notifications.

## Routing and RBAC

Routes are **generated from the permission table**, not hand-listed. Three files:

| File | Role |
|---|---|
| `constants/routeSections.js` | 28 section keys; each maps to a URL `segment`, `label`, icon, and an optional `nav: true` |
| `constants/permissions.js` | `ROLE_SECTIONS` (role → granted sections) and `ROLE_SLUG` (role → URL slug) |
| `constants/routePaths.js` | Composes the two into `/<slug>/<segment>`, frozen per role in `PATHS_BY_ROLE` |

`routes/roleRoutes.js` flat-maps every role over its granted sections; `AppRoutes.jsx` renders one
`<Route>` per entry. **A section a role does not hold has no route at all** — it is absent, not
hidden. That yields ~75 generated routes plus `/` (redirect to the role's dashboard) and `/login`.

Every authenticated URL is `/<role-slug>/<section>`:

| Role | Slug | Landing page |
|---|---|---|
| `SUPER_ADMIN` | `super-admin` | `/super-admin/dashboard` |
| `ADMIN` | `admin` | `/admin/dashboard` |
| `FRONT_OFFICE` | `front-officer` | `/front-officer/dashboard` |
| `OFFICER_IN_CHARGE` | `officer-in-charge` | `/officer-in-charge/dashboard` |
| `ASSIGNED_OFFICIAL` | `assigned-official` | `/assigned-official/dashboard` |
| `REVIEWER` | `reviewer` | `/reviewer/dashboard` |
| `INQUIRER` | `inquirer` | `/inquirer/dashboard` |

`ProtectedRoute` waits for `authReady`, redirects to `/login` when signed out, then checks
`isRouteAllowedForRole(role, pathname)` and renders an inline "Access restricted" panel on failure.
Its `segmentMatches` compares path-part counts and treats `:param` parts as wildcards, so a list
path can never satisfy a detail path.

Navigation comes from the *same* table — `constants/navigation.js` filters sections carrying
`nav: true` and intersects with the role's grants. Sidebar and mobile nav share it; there is no
second nav list.

> **This is a client-side gate.** The backend enforces its own role checks per route
> (`verifyToken` → `verifyRole`/`verifyAction`). Never treat the frontend gate as the security
> boundary.

## State

Two Zustand stores. **Neither uses `persist`.**

**`store/useAuthStore.js`** — `currentUser`, `authReady`. The session lives in an httpOnly cookie
the server sets; it is deliberately *not* mirrored into `localStorage`. `hydrate()` asks
`GET /auth/me` at boot. A 401 from any non-`/auth/*` endpoint clears the session and raises a
"session expired" toast, via a handler registered with the axios client (registering rather than
importing avoids a store↔client cycle).

**`store/useWorkflowStore.js`** — the domain store: `queries`, `workflowSteps`, `reviews`,
`responseVersions`, `auditEvents`, `notifications`, `emailMessages`, `emailThreads`, `counters`.
The seed is **entirely empty** — every number in the UI comes from real user activity.

### `applyTransition` — the single writer

Every mutation funnels through `applyTransition`, and its pure helper `computeTransition` in one
pass: mints an audit id, merges the patch, **derives `businessStatus` from `workflowState`** so the
two cannot disagree, **always appends exactly one audit event**, optionally appends a notification,
and applies a `mutate()` patch for other collections.

Because it is the only writer, the audit trail is complete by construction — which is what the
toast layer subscribes to (below), and why a failed action produces no notification.

Permissions are enforced *in the store*, not only in the UI: `assertCan` throws unless
`canPerform(role, action, workflowState)` allows it, and `assertOwnsStep` stops a reviewer acting on
another reviewer's level.

### Persistence — Dexie / IndexedDB

Database `qms`, schema v2. `persistDelta` writes only the delta for the affected case, fired
without blocking the UI; a failure surfaces as `persistenceError` and an error toast.

> **Query Cases are browser-local.** There is no `/queries` endpoint and no server-side Case model,
> so cases, workflow steps, reviews, draft versions, client audit events and in-app notifications
> live only in the current browser profile. Another user, another browser or the server cannot see
> them. The admin console labels these figures "This browser only" for exactly this reason.

What *does* cross the wire: authentication, emails (send/forward/acknowledge/ingest/delete),
attachment bytes and metadata, AI requests, health, and the **server-side** audit trail.

## API layer

All modules share `services/api/axiosClient.js` (`withCredentials: true` for the session cookie).

| Module | Endpoints |
|---|---|
| `authService.js` | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| `mailboxService.js` | `/emails/config`, `/emails/enquiry`, `/emails/acknowledgement`, `/emails/forward`, `/emails/response`, `/mailbox/*` |
| `attachmentService.js` | `POST /attachments`, `GET /attachments/:id/meta`, plus `attachmentUrl()` |
| `adminService.js` | `GET /audit`, `/audit/summary`, `/audit/query/:queryId` |
| `aiService.js` | `POST /ai/summary`, `/ai/draft`, `/ai/recommend` |
| `healthService.js` | `GET /health` |

The interceptor toasts only **no-response** failures (offline / server down), under a fixed toast id
so a page issuing several requests raises one toast. HTTP error *responses* are left to the call
sites, which name the operation. The module writes nothing to `console` by design — the test setup
fails any test that produces console output.

`forwardQuery` translates a backend 409 carrying `unavailableAttachments` into
`Missing attachment(s): …`, so a fail-closed forward names the file that could not be read.

`services/ai/` is **local, no network**: `mockAiService.js` (deterministic summary/recommendation/
draft used as fallback) and `draftComposer.js`, which assembles the outgoing email from real case
data so a model-supplied name can never reach the output.

## Notifications

`services/notify.js` is the only module that imports `sonner`. `NotificationHost` renders the
Toaster and subscribes to the workflow store's `auditEvents`: a toast fires **because a transition
actually committed**, so an action that threw produces none. It re-baselines when the array shrinks
(`resetDemo`) and stays silent during a batch.

`constants/toastEvents.js` maps 11 audit events to toasts and lists 8 deliberately-silent ones with
a per-event reason. Toasts are transient feedback only — **the audit trail remains the persistent
record**, and nothing is ever toasted *instead of* being audited.

## Attachments

`constants/attachmentPolicy.js`: images, video, audio, PDF/Office/CSV/TXT and ZIP; 10 MB per file,
15 MB total, 10 files. Client validation is pre-flight UX only — **the backend is the authority**.

`AttachmentPicker` collects files with inline per-file errors; `ComposeEnquiryPage` uploads them
*before* sending so a failed upload aborts the send rather than registering a case with missing
files, reporting progress through a live toast. `AttachmentViewerDialog` previews images, video,
audio, PDF and text inline, falling back to download; it re-checks metadata on open and reports
"no longer available" rather than showing a broken frame. `AttachmentList` also renders legacy
metadata-only records, without controls.

## Design system

Tailwind **v4**, configured entirely in CSS — there is **no `tailwind.config.js`**. `src/index.css`
holds an `@theme` block with the colour tokens, an 8-colour sidebar ramp, and 8 status triples
consumed via `constants/statusStyles.js`. Fonts: Outfit (headings), Inter/DM Sans (body), DM Serif
Display. Custom utility layers provide the neumorphic, glassmorphic and aurora surfaces.

Charts are **hand-written SVG** in `components/admin/charts.jsx` (`StatusDonut`, `VolumeBars`,
`TrendLine`, `ProcessingFunnel`) — no charting library is installed. Colours come from
`constants/chartPalette.js`, a validated colour-blind-safe series; identity is never carried by hue
alone.

`components/ui/` holds 34 shadcn/ui files, of which **17 are actually reachable** from app code
(button, card, badge, label, skeleton, textarea, select, tooltip, dialog, tabs, table, checkbox,
scroll-area, sonner and their variant helpers). The other 17 are dormant scaffold — safe to adopt
or delete, currently imported by nothing.

## Layout

```
src/
  main.jsx, App.jsx, index.css
  layouts/       MainLayout (sidebar + header + marquee + mobile nav), AuthLayout
  routes/        AppRoutes, roleRoutes, ProtectedRoute
  constants/     enums, RBAC tables, policies, mock directory data
  store/         useAuthStore, useWorkflowStore
  services/      api/, db/ (Dexie), ai/ (local), notify.js
  hooks/         useQueryCase, useWorkflowAction, useMailboxIngestion, useBucketFilter, useRoutePaths
  components/    admin/ ai/ attachments/ common/ dashboard/ email/ layout/ notifications/ ui/ workflow/
  pages/         35 page components across 14 folders
  test/          38 test files + setup.js
  utils/         cn, greeting, queryOwnership
```

## Tests

38 files, `npm test` (Vitest 4 + Testing Library, jsdom).

The harness is deliberately strict:

- **`fake-indexeddb/auto`** — Dexie runs for real against an in-memory IndexedDB, so persistence
  round-trips are genuinely exercised rather than mocked.
- **`aiService` is mocked** globally so no test reaches the network.
- **A console trap** — `afterEach` asserts that nothing wrote to `console.error` or `console.warn`.
  Any test producing console output fails. Several modules note this constraint in their source.

Notable suites: `routes.test.jsx` renders **every generated route for the role that owns it**;
`enumGuard.test.js` scans source for references to workflow/audit enum members that do not exist;
`lifecycle.test.js` carries one email end-to-end to `CLOSED` and asserts one audit event per
transition and survival across a reload; `notifications.test.jsx` proves a toast follows a committed
transition rather than a click.

## Known dead code

Not wired to anything, kept here so nobody rediscovers it:

- `components/dashboard/DashboardResolutionRate.jsx` — zero importers.
- `hooks/useHealthCheck.js` — zero importers; `AdminSettingsPage` calls `fetchHealth` directly.
- `adminService.fetchAuditForQuery` — exported, never called.
- 17 dormant `components/ui/` files (above); `src/assets/` and `src/features/` are empty.
- **Declared but never imported:** `react-hook-form`, `@hookform/resolvers`, `zod` — forms are plain
  controlled `useState`.

`frontend/DESIGN.md` is a brand-analysis reference that predates the current UI; treat it as
historical input, not a spec.
