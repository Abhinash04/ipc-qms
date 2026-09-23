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
| `npm run build:check` | Production build, then enforce the bundle budget (`scripts/check-bundle-budget.mjs`) |
| `npm run preview` | Serve the build |
| `npm run lint` | ESLint |
| `npm test` | Vitest, 42 test files (760 tests) |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:e2e` | Playwright, specs in `e2e/` — same as `npx playwright test`. See below |
| `npm run doctor` | React Doctor locally (the same check CI runs) |

**End-to-end tests.** `playwright.config.js` starts both servers itself and drives a real Chromium
against them. Unlike the Vitest suite it needs a **local MongoDB on `127.0.0.1:27017`** — it uses its
own `qms_e2e` database and wipes it between specs — and a one-off
`npx playwright install chromium`. Backend settings come from `backend/.env.e2e`, which is
credential-free and committed on purpose. It pins `QMS_SEED_PASSWORD` to **empty** and
`QMS_ALLOW_SHARED_PASSWORD=false`, deliberately — unset, the shared-password mode would switch itself
on here, because `NODE_ENV` is development. Sign-in uses one distinct password per account from
`src/test/fixtures/passwords.json`, which `playwright.config.js` resolves to an absolute path and
gives to both the server and the test process. Only `JWT_SECRET` is inherited from the gitignored
`backend/.env`. **Stop a hand-started backend first**: `reuseExistingServer`
is `false` for the backend, so anything already on `:5000` makes the run fail outright rather than be
adopted along with whatever database and mail transport it holds.

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

`HydrationGate` waits for `/auth/me` to answer — without it, a reload flashes the login screen
before the session is known — and then loads the workflow store, but **only once someone is signed
in**. That ordering is the point: `GET /queries` requires a session, so hydrating at module load
raced ahead of the cookie check, every call 401'd on a first visit, and the store silently fell back
to its local seed and never reloaded. Signing out clears the store (`resetHydration`) so the next
account does not inherit the previous one's cases.

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

**Two actions deliberately bypass it**, because the server — not this store — is the one that did
the work: `acceptMailboxMessage` (below) and `grantFinalApproval`. Both post to a single endpoint
and then call `refreshFromServer()` to read the result back, rather than reconstructing it locally
and hoping the two agree.

### `grantFinalApproval` — approving is answering

`grantFinalApproval` posts to `POST /queries/:queryId/final-approval`. The server records the
approval, emails the approved response to the inquirer and closes the case; the store re-hydrates.
`assertCan` still runs in front of it, but as a convenience — it refuses an unauthorised click by
name instead of after a round trip, and the server enforces `FINAL_APPROVE` independently.

It used to record the approval here and then call `dispatchResponse` with a null actor, on the
theory that an automatic send is "the system acting". The null actor skipped only *this store's*
permission check: the request still went out on the approving officer's session, against the
Front-Office-only `POST /emails/response`, so every approval ended in a **403** with the case
stranded at `READY_FOR_DISPATCH` and the inquirer never answered.

`dispatchResponse` still serves the Front Office **Retry sending response** control on
`pages/dispatch/DispatchDetailPage.jsx`, which passes a real actor and is gated on `DISPATCH` as it
always was. It sends the case's `queryId` with the request, so the server answers through the
mailbox the case came from — a NICeMail case from NICeMail, not the default transport. That page is
otherwise a status view: it shows what was sent, to whom and when, and offers the retry only when no
`OUTGOING_RESPONSE` message exists, so it does not distinguish a send that failed from one that was
**unconfirmed** — the case's audit history shows which — and a NICeMail case's Sent folder should be
checked before retrying. A retry that itself ends unconfirmed shows the server's Sent-folder
warning in the error banner.

Approving and answering are one click but two outcomes, and the second can fail on its own, so
`ApprovalDetailPage` reads `dispatched` and `alreadyDispatched` off the response and raises
*"Approved, but the inquirer was not emailed: …"* when neither is true. The approval stands either
way; the case waits at `READY_FOR_DISPATCH` for the retry.

### Persistence — the server, via `/api/v1/queries`

`services/persistence/queryState.js`. The store hydrates from `GET /queries` and writes one delta
per committed transition to `POST /queries/persist` — only the delta for the affected case, fired
without blocking the UI.

Query Cases are **server-side**, in MongoDB. Cases, workflow steps, reviews, draft versions, audit
events and notifications are shared across users and browsers. This module held its own Dexie /
IndexedDB database until the server-side Query Case API landed; the folder was named `services/db/`
then, and Dexie is no longer a dependency.

`memoryStore` mirrors the state in memory so the UI keeps working when the API is unreachable. It is
**per-tab memory, not storage** — it does not survive a refresh, which is exactly why a failed
write-through is reported rather than swallowed:

- `loadAll()` throws on failure. `hydrate()` turns that into `persistenceError`.
- the write paths keep the optimistic local update — the user's action already took effect on
  screen — and raise one toast, `"Changes were not saved"`, under a fixed id so a mailbox sweep
  produces one message rather than a dozen. A 403 and a 503 get their own wording.
- a **400** names the field. `validateBody` has always answered `{ error, fields: ['auditEvent.event'] }`
  and this module discarded the list, so a contract mismatch between this client and the server's
  schema — a bug, not something a user can retry their way out of — read as an unactionable "changes
  were not saved". The toast now carries the field paths (paths only, never values, since a delta
  carries case content) — so a rejection like `addReviews.0.stepId`, which used to 400 every
  return-for-revision from final approval, names itself. Note the limit: Zod *strips* an undeclared
  key rather than rejecting it, so a field the schema never learned is lost without any 400 at all.

What else crosses the wire: authentication, emails (send/forward/acknowledge/ingest/delete),
attachment bytes and metadata, AI requests, health, and the server-side audit trail.

## Mail intake — the validation gate

Arriving mail creates nothing. `pages/frontOffice/MailboxInboxPage.jsx` lists what is waiting, and
each undecided row carries two circular icon buttons:

| Control | What it does |
|---|---|
| ✓ **Accept** | `acceptMailboxMessage` — one `POST /mailbox/messages/:messageId/accept`. The server registers the Query Case, mints its id, stores the sender as the inquirer, summarises the enquiry onto `aiSummary`, acknowledges that sender, **and forwards to the Officer-in-Charge** with that same summary, landing the case in `PENDING_ASSIGNMENT`. |
| ✕ **Reject** | records the decision and nothing else: no case, no Case ID, no acknowledgement. The message stays listed, marked *Rejected*. |

Both confirm first, and both are final — the server keeps the first decision on a message and
ignores any later one.

**Accepting mints nothing in the browser.** The whole sequence runs server-side, and
`acceptMailboxMessage` then calls `refreshFromServer()` to read the result back rather than
reconstructing it locally — including on a repeat accept, whose answer may name a case this tab has
never seen. Two things were wrong with doing it here: the Case ID came from a counter this tab held,
so two tabs hydrated at the same number both minted it; and a tab closed midway left a case nobody
had been told about.

The response is
`{ queryId, created, alreadyDecided, acknowledged, forwarded, aiSummaryStatus, errors }` and arrives
as a 200 even when a step failed, so the toast can name what did and did not happen
(`describeAccept` in `MailboxInboxPage.jsx`, which reports the acknowledgement and the forward).
`aiSummaryStatus` is `GENERATED`, `FALLBACK` or `FAILED` — the summary now belongs to the case
(`query.aiSummary`, rendered by `AiSummaryCard`) instead of being made inside the forward and thrown
away, and `FALLBACK` means the model did not answer and the deterministic stand-in was used, which is
an ordinary outcome rather than a failure. Pressing ✓ again is safe: each server step checks for
its own artefact first, so a retry finishes what did not complete and repeats nothing. If the
forward is what failed, the case sits at `FRONT_OFFICE_VERIFICATION` and **Forward to
Officer-in-Charge** on the case page is the recovery path — that button is no longer a required
second step.

**An unconfirmed acknowledgement gets different advice.** When the server flags the acknowledgement
`unconfirmed` — sent through the NICeMail browser, Send pressed, no confirmation seen — it may
already be in the inquirer's inbox, and nothing recorded it, so ✓ would send it again. The toast
then reads "acknowledgement may already have been sent … check the NICeMail Sent folder before
retrying", naming the sender who may otherwise receive it twice, instead of "retry from the case
page".
The case page's **Acknowledgement email not sent** notice is derived from the missing record and
still offers **Retry sending**; the case's audit history has an `EMAIL_SEND_FAILED` row saying the
acknowledgement may have been sent, but the notice does not read it. A retry that itself ends
unconfirmed turns the notice into **Acknowledgement may already have been sent**, with the server's
warning (`acknowledgeInquirer` returns the server's reason and `unconfirmed`, not axios's status
text).

Intake is **N:1**: many external inquirers, one Front Office mailbox. The inquirer on a case is
parsed from the incoming `From` header, so anyone can write in without an account here; a sender the
system has never seen gets `inquirer.id: null` and is otherwise a normal case.

**A second Front Office mailbox.** With the backend's `NIC_BROWSER_MAILBOX=true`, a second Front
Office account sees the NICeMail mailbox on this same page; the server chooses the mailbox by who is
signed in, and the client does nothing different. That mailbox is filled by a browser agent reading
a signed-in NICeMail tab, and a failed read does not fail the inbox request: the server answers 200
with what it already stored and reports the failure in a `sync` field. When `sync.ok === false` the
page shows **The mailbox could not be read — this list may be out of date**, with the reason and its
stage, rather than something that looks like an empty inbox. No other mailbox's response carries
`sync`, so the notice never appears for them. See
[`../docs/NIC_BROWSER_AGENT.md`](../docs/NIC_BROWSER_AGENT.md#13-troubleshooting).

`components/workflow/MailboxAutoSync.jsx` still polls every 30 s, but only to count what is waiting
and say so. It used to register, acknowledge and forward everything it found, from whatever page
happened to be open — so a case could reach the Officer-in-Charge without anyone having read the
email. The poll is useful; what it may do with the result is not.

There is correspondingly **no "Validate Query" button on the case page**. Validation happens once,
in the mailbox; a second validate step asked the Front Officer to judge the same email twice.

## API layer

All modules share `services/api/axiosClient.js` (`withCredentials: true` for the session cookie).

| Module | Endpoints |
|---|---|
| `authService.js` | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| `mailboxService.js` | `/emails/config`, `/emails/enquiry`, `/emails/acknowledgement`, `/emails/forward`, `/emails/response`, `/mailbox/*`: `GET /mailbox/messages` (`q`; `limit`/`offset` add `total`; `unreadOnly` means awaiting validation, not `isRead`), `GET /mailbox/messages/:messageId` (adds `bodyHtml`), `POST /mailbox/messages/:messageId/read` (QMS-local), `POST /mailbox/sync` (NICeMail, 202), plus `mailboxAttachmentUrl()` for `/mailbox/messages/:messageId/attachments/:attachmentId` |
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

`components/ui/` holds 33 shadcn/ui files, of which **17 are actually reachable** from app code
(button, card, badge, label, skeleton, textarea, select, tooltip, dialog, tabs, table, checkbox,
scroll-area, sonner and their variant helpers). The other 16 are dormant scaffold — safe to adopt
or delete, currently imported by nothing. (`breadcrumb.jsx` was one of them and has been removed: it
duplicated the live `components/common/Breadcrumb.jsx`.)

## Layout

```
src/
  main.jsx, App.jsx, index.css
  layouts/       MainLayout (sidebar + header + marquee + mobile nav), AuthLayout
  routes/        AppRoutes, roleRoutes, ProtectedRoute
  constants/     enums, RBAC tables, policies, mock directory data
  store/         useAuthStore, useWorkflowStore
  services/      api/, persistence/ (queryState.js), ai/ (local), notify.js
  hooks/         useQueryCase, useWorkflowAction, useMailboxIngestion, useBucketFilter, useRoutePaths
  components/    admin/ ai/ attachments/ common/ dashboard/ email/ layout/ notifications/ ui/ workflow/
  pages/         33 page components across 13 folders
  test/          42 test files + setup.js and five in-process fakes (fakeQueryApi.js,
                 fakeAcceptEndpoint.js, fakeFinalApprovalEndpoint.js)
  utils/         cn, greeting, queryOwnership
```

`e2e/` sits beside `src/` and holds the Playwright specs plus their `helpers/`; the runner is
configured by `playwright.config.js` at the package root.

## Tests

42 files (760 tests), `npm test` (Vitest 4 + Testing Library, jsdom).

The harness is deliberately strict:

- **`aiService` and `queryCaseService` are mocked globally**, so no test reaches the network.
  `queryCaseService` is backed by `test/fakeQueryApi.js`, an in-process stand-in that keeps its own
  state and applies the same upsert-by-id semantics as the real controller — so `loadAll()` is a
  genuine round trip through a boundary, not a read-back of the object just written. Its
  `grantFinalApproval` is `test/fakeFinalApprovalEndpoint.js`, which stands in for the server
  operation the same way `fakeAcceptEndpoint.js` stands in for accept: the approval, the outbound
  response and the closing audit rows are produced behind the boundary, so a test that reads them
  back is reading what a server would have returned.
- **A console trap** — `afterEach` asserts that nothing wrote to `console.error` or `console.warn`.
  Any test producing console output fails. Several modules note this constraint in their source.

`mailboxService` is auto-mocked per suite and pointed at `test/fakeCaseMail.js` by
`installFakeCaseMail(mailboxService)`. That is not decoration: the three case emails are server
operations now, and the record of one, its audit row and the case's move to `PENDING_ASSIGNMENT` or
`CLOSED` all come back from the server — a bare automock resolving to `undefined` produces none of
them. The fake also answers the way the server answers, including the two outcomes that must never
be read as "try again": `ALREADY_SENT` and `UNCERTAIN`.

Notable suites: `routes.test.jsx` renders **every generated route for the role that owns it**;
`enumGuard.test.js` scans source for references to workflow/audit enum members that do not exist —
it is what caught `AUDIT_EVENT.QUERY_PULLEDBACK`, a misspelling that had every pullback writing
`event: undefined`; `lifecycle.test.js` carries one email end-to-end to `CLOSED` and asserts one
audit event per transition; `notifications.test.jsx` proves a toast follows a committed transition
rather than a click; `outboundIdempotency.test.jsx` covers the send UX — Approve disabled while its
request is open, concurrent approvals collapsed into one, `ALREADY_SENT` reported as a closed case
rather than a failure, and an unconfirmed send offering *It was sent* / *It was not sent* in place
of a retry; `mailboxAutoSync.test.jsx` covers the polling toasts — one per outage rather than one
per poll, the 1–2–5-minute backoff, the recovery notice, and a waiting count announced only when
it grows.

> `routes/routeElements.eager.jsx` has no importers and **must not be deleted**. Vitest resolves
> `@/routes/routeElements` to it through a path alias in `vite.config.js`, because tests drive pages
> synchronously and cannot wait on `React.lazy`. It and `routeElements.jsx` are deliberately kept in
> sync; edit them as a pair.

### End-to-end (`e2e/`)

Playwright, run with `npx playwright test` (or `npm run test:e2e`), configured by
`playwright.config.js`. These are the opposite trade-off to the Vitest suite: a real browser, a real
Express server and a real MongoDB, with nothing mocked. Prerequisites are a local MongoDB on
`127.0.0.1:27017` and a one-off `npx playwright install chromium`; backend configuration comes from
`backend/.env.e2e`, which points at its own `qms_e2e` database and pins **every** mail variable —
most of them to an empty value — so that none is inherited from a developer's `.env`. That
inheritance is the trap: a key the overlay omits is taken from `.env`, so an overlay naming no
`NIC_*` variable would have run the suite against whatever mailbox the developer had configured.
Credentials come from the per-account fixture; only `JWT_SECRET` is inherited.

The specs share one database and each wipes it first, so the config runs one worker, no parallelism
and no retries. Playwright starts both servers itself and **refuses to adopt one it did not start**:
a backend already listening on `:5000` fails the run with *"http://localhost:5000 is already used"*.
That is deliberate — a backend left over from a development session is typically pointed at the real
database and a real mailbox, and adopting it would run the suite against both. Stop it and re-run.

Four specs:

| Spec | What it holds down |
|---|---|
| `lifecycle.spec.js` | One enquiry from arrival to closure, through the screens each role uses, asserted against MongoDB at every stage; plus a failed send that leaves the case open and the retry that closes it. |
| `mailboxAccept.spec.js` | The intake gate: accept, reject, and the same message decided twice. |
| `twoInquirers.spec.js` | **Two external inquirers, one mailbox.** Both accepted, both carried to closure **interleaved**, and each answered exactly once at their own address — neither seeing anything of the other's. |
| `dispatchIdempotency.spec.js` | **One answer per case, however hard it is asked for.** Approve held open and clicked four times; three approvals fired at the API at once; a blocked delivery, its failure, and a retry that sends once. |

The shared stage steps live in `e2e/helpers/workflow.js`, so a spec says what it is testing rather
than how to drive five roles through five screens.

## Known dead code

Not wired to anything, kept here so nobody rediscovers it:

- `adminService.fetchAuditForQuery` — exported, never called.
- 16 dormant `components/ui/` files (above); `src/assets/` and `src/features/` are empty.

Previously listed here and now removed: `DashboardResolutionRate.jsx`, `hooks/useHealthCheck.js`,
`components/ui/breadcrumb.jsx` (a duplicate of the live `components/common/Breadcrumb.jsx`),
`test/dbMigration.test.js` (tested Dexie's own upgrade machinery for a schema the app no longer
declares), and the `dexie`, `fake-indexeddb`, `react-hook-form`, `@hookform/resolvers` and `zod`
dependencies, none of which had a single importer in `src/`.
