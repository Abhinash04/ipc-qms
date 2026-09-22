# 13. Data Model

Field lists as actually implemented. Every collection below is a Mongoose schema in `backend/src/models/` — thirteen models across twelve files — and the client shapes produced by `frontend/src/store/useWorkflowStore.js` are synced into them through `/api/v1/queries`.

**Timestamps are stored as ISO-8601 strings, not `Date`.** That is deliberate: ISO-8601 sorts and compares correctly as text, so the same `from`/`to` bounds work unchanged against a Mongo filter and against the in-memory audit buffer that serves the degraded path, with no conversion on either side. Every schema also sets `versionKey: false`.

## 13.1 Query

`backend/src/models/QueryCase.js`.

| Field | Type | Notes |
| --- | --- | --- |
| `queryId` | string | Human-readable ID, e.g. `QRY-2026-00427`. Required, **unique index**. |
| `subject` | string | Required. |
| `description` | string | Defaults to `''`. |
| `source` | string | Defaults to `Email`. |
| `inquirer` | object | External party (not a system user). Nullable, shape unconstrained. |
| `category` | string | Nullable. See admin Categories. |
| `priority` | string | `LOW` / `NORMAL` / `HIGH` / `URGENT`, defaulting to `NORMAL`. **Indexed.** |
| `businessStatus` | string | `OPEN` / `IN_PROGRESS` / `CLOSED` — see [05](./05-workflow-and-state-machine.md). Defaults to `OPEN`. **Indexed.** |
| `workflowState` | string | 16 states — see [05](./05-workflow-and-state-machine.md). Required, **indexed**. |
| `currentAssigneeId` | string → `User.userId` | Nullable before assignment. **Indexed.** |
| `currentWorkflowStepId` | string → `WorkflowStep.stepId` | Nullable. |
| `attachments` | array | Held inline on the case; the bytes live on disk. |
| `dueDate` | ISO-8601 string | Nullable. |
| `createdAt` / `updatedAt` | ISO-8601 string | Default `new Date().toISOString()`. |
| `threadId` | string | The email thread the case's messages belong to, e.g. `THREAD-2026-00012`. Nullable, **indexed**. |
| `sourceEmailId` | string → `EmailMessage.messageId` | The inbound message record the case was opened from. Nullable. |
| `sourceMailboxMessageId` | string | The mailbox's own id for that incoming message — what lets the client recognise an already-registered message after a reload. Nullable, **indexed** (sparse): portal-raised cases have none. |
| `assignmentDecision` | object | `{ assigneeId, acceptedAiRecommendation, decidedAt }`, written at assignment. Nullable. |
| `pullbackHistory` | array | One record per pullback, oldest first. Defaults to `[]`. |
| `aiSummary` | object | The enquiry summary. Written by the accept before it acknowledges and forwards, and rewritten if it is re-generated from the case page. Nullable, shape unconstrained: `{ text, keyPoints, topics, aiGenerated, fallback, status, generatedAt, error }` with `status` one of `GENERATED` / `FALLBACK` / `FAILED`. There is deliberately no separate `aiSummaryStatus` or `aiSummaryGeneratedAt` column — the provenance rides inside the object it describes. See [12-email-integration.md](./12-email-integration.md). |
| `sourceMailbox` | object | The mailbox the enquiry arrived in: `{ source, address }`, e.g. `{ source: 'nic-browser', address: <NIC_EMAIL> }` for the NICeMail browser mailbox. Written **by the server at accept**, from the signed-in user's mailbox, and kept across a retried accept. It decides how the inquirer is written back to: the acknowledgement, the final response and their retries go out through the NICeMail browser session when `source` is `nic-browser`, and through `EMAIL_TRANSPORT` otherwise. Absent from the persist validator and stripped by `persistTransition`, so a client write can neither set, change nor clear it. Null on portal-raised cases and on cases from before the field existed, which use `EMAIL_TRANSPORT`. |

The three enum-valued fields above are plain `String`s in the schema, not Mongoose enums — the value sets live in `frontend/src/constants/statusEnums.js`. There is no embedded `auditHistory`: audit events are their own collection (13.4), joined by `queryId`.

**The unique index on `queryId` does not protect `POST /queries/persist`.** Every case write there is an upsert keyed on `queryId`, so a colliding id never raises a duplicate-key error — it *replaces* the stored case. `persistTransition` therefore compares `createdAt` first and answers **409** when the stored value differs from the incoming one, keeping the original enquiry. Case IDs on the email path are minted server-side by `QueryCounter` and cannot collide; the in-app **Raise Enquiry** portal path still mints client-side, and this is the guard that protects it.

**`inquirer` is write-once.** It is written with `$setOnInsert` by `POST /queries/persist`, so the
address read off the `From` header at intake cannot be replaced by a later delta. Every
acknowledgement and every final response goes to it; a client able to change it is a client able to
send one inquirer's answer to another. `workflowState` is likewise refused a move to `DISPATCHED` or
`CLOSED` from a client — those belong to the path that actually sends the email.

## 13.2 WorkflowStep

Modeled as a **dynamic, ordered collection** per query — never fixed `review1`/`review2`
fields (see [architecture/workflow-engine.md](../architecture/workflow-engine.md)).

`backend/src/models/WorkflowStep.js`.

| Field | Type | Notes |
| --- | --- | --- |
| `stepId` | string | Required, **unique index**. |
| `queryId` | string → `Query.queryId` | Required, **indexed**. |
| `stepType` | string | `DRAFT` / `REVIEW` / `FINAL_APPROVAL`. Required. |
| `sequence` | number | Order within the query's workflow instance. Required. |
| `assignedUserId` | string → `User.userId` | Nullable. |
| `status` | string | `PENDING` / `IN_PROGRESS` / `COMPLETED`, defaulting to `PENDING`. **Indexed.** |
| `createdAt` | ISO-8601 string | Defaults to now. |
| `startedAt` / `completedAt` | ISO-8601 string | Null until reached. |

A compound index on `{ queryId: 1, sequence: 1 }` backs the one read the timeline always makes: a single case's steps in order.

## 13.3 ResponseVersion

`backend/src/models/ResponseVersion.js`.

| Field | Type | Notes |
| --- | --- | --- |
| `responseId` | string | Required, **unique index**. |
| `queryId` | string → `Query.queryId` | Required, **indexed**. |
| `version` | string | e.g. `v1`, `v2`, `Final`. Required. |
| `label` | string | e.g. "AI generated", "Officer revision". Nullable. |
| `content` | string | Defaults to `''`. |
| `createdBy` | string → `User.userId` \| "AI Draft Assistant" | Nullable. |
| `aiMetadata` | object | Generation provenance; null for a human-authored version. |
| `createdAt` | ISO-8601 string | Defaults to now. |
| `status` | string | Nullable. The **final-approval lock**, not a label: `saveDraftVersion` refuses to edit a case holding a version marked `FINAL_APPROVED`. It was read by that check but declared neither here nor in the persist validator, so every write stripped it and an approved response became editable again after a reload. |
| `source` | string | Nullable. Provenance: `AI_GENERATED` / `USER_EDITED` / `REVIEW_REVISION` (`frontend/src/constants/statusEnums.js`). |
| `aiGenerated` | boolean | Defaults to `false`. |
| `approvedAt` | ISO-8601 string | Nullable; the final-approval timestamp that goes with `status`. |

AI-produced versions additionally carry generation metadata — see
[07-ai-requirements.md](./07-ai-requirements.md#74-generation-metadata).

## 13.4 AuditEvent

`backend/src/models/AuditEvent.js`.

| Field | Type | Notes |
| --- | --- | --- |
| `timestamp` | ISO-8601 string | Required, **indexed**. |
| `auditId` | string | The client's own id for an event it originated (`AUD-00007`). Nullable, **indexed**, and deliberately **not unique** — the counter behind it lives in a browser, so two tabs can mint the same value and refusing the second would lose an audit record to protect a display detail. Events the server writes itself (intake, denials, transport failures) have none. |
| `action` | string | Required, **indexed**. Deliberately **not** an enum — an unrecognised action name must still be recorded. See [09-audit-and-compliance.md](./09-audit-and-compliance.md). |
| `result` | string | Enum `success` / `failure` / `denied`, defaulting to `success`. |
| `actorType` | string | Enum `human` / `agent` / `system`. Required, **indexed**. |
| `actorId` | string → `User.userId` | Nullable, **indexed**. |
| `actorRole` | string | Nullable. |
| `queryId` | string → `Query.queryId` | Nullable, **indexed**. |
| `messageId` | string | Nullable, **indexed**. |
| `threadId` / `attachmentId` | string | Nullable. |
| `error` | string | Nullable; carries the reason when `result` is not `success`. |
| `aiMetadata` | object | Free-form provenance for anything a model produced. |
| `details` | object | Optional structured context (e.g. previous vs new assignee). |

One collection serves both trails. The client works in `{ event, actor, at }` and the collection stores `{ action, actorRole, timestamp }`; `GET /queries` translates on the way out, and `POST /queries/persist` fills the actor fields from the session rather than from the request body. That translation also guarantees a key for every row: `GET /queries` returns `auditId: row.auditId ?? String(row._id)`, so a server-written event falls back to its document id rather than reaching the client with no id at all.

## 13.5 MailboxDecision

`backend/src/models/MailboxDecision.js`. The Front Officer's accept/reject on one incoming message — the gate that separates "mail arrived" from "a case exists".

| Field | Type | Notes |
| --- | --- | --- |
| `mailboxMessageId` | string | The provider's stable message id. Required, **unique index** — this is what makes the first decision the only decision. |
| `decision` | string | `ACCEPTED` / `REJECTED`. Required, **indexed**. |
| `queryId` | string → `Query.queryId` | Set on accept; `null` for a rejection, which creates no case. **Indexed.** |
| `reason` | string | Defaults to `''`. |
| `decidedByUserId` | string → `User.userId` | Nullable. Filled from the session, never from the request body. |
| `decidedByRole` | string | Nullable. |
| `decidedAt` | ISO-8601 string | Required. |
| `from` / `subject` | string | Default `''`. A snapshot of the message as it was when decided. |
| `receivedAt` | ISO-8601 string | Nullable. Part of the same snapshot. |

**Why this is a separate collection, and not a field on `MailboxMessage`.** Under `MAILBOX_SOURCE=gmail` the mailbox is a live, read-only view of a real Gmail account: there is no row to update, and `MailboxMessage` is not even populated. A decision has to survive independently of whichever store the mailbox is being read from, so it is keyed by the provider message id and nothing else. `MailboxMessage.ingested` is a different thing and stays as it is — it means "this copy has been swept", carries no actor, and for Gmail is literally the `UNREAD` label.

The `from`/`subject`/`receivedAt` snapshot exists for the same reason: a rejected Gmail message stops matching `is:unread` once marked read, and may later be archived or deleted by its owner. Without the snapshot, "what did she reject, and from whom?" would have no answer a month later.

## 13.6 OutboundEmail

`backend/src/models/OutboundEmail.js`. One row per outbound email a case may send — the record of
whether it has been sent, and the thing that makes sure it is sent only once.

| Field | Type | Notes |
| --- | --- | --- |
| `dispatchKey` | string | `"${emailType}:${queryId}"`. Required, **unique index**. This is the guard: a second request cannot insert it, so a second request cannot send. |
| `queryId` | string → `Query.queryId` | **Indexed**, with `emailType`. |
| `emailType` | string | `ACKNOWLEDGEMENT` / `FORWARD` / `OUTGOING_RESPONSE`. |
| `status` | string | `SENDING` / `SENT` / `FAILED` / `UNCERTAIN`. |
| `claimToken` | string | Identifies the request that holds the claim, so only it may mark the send complete. |
| `leaseExpiresAt` | ISO-8601 string | Three minutes. A `SENDING` row past its lease is promoted to `UNCERTAIN` — the process that held it died mid-send, and whether the email went out is genuinely unknown. |
| `recipients` | [string] | Read from the stored case, never from a request. |
| `subject`, `transport`, `domain` | string | What was sent, through what, from where. |
| `rfcMessageId` | string | The `Message-ID` header of the attempt, which is what a Gmail Sent-folder search matches on. |
| `attempts` | number | Including the one automatic quick retry. |
| `providerMessageId` / `providerThreadId` | string | Returned by the transport on success. |
| `sentAt` | ISO-8601 string | Set only when the send is known to have happened. |
| `lastError`, `lastOutcome` | string | The reason and the classification of the last attempt. |
| `resolvedBy` | object | Who answered *It was sent* / *It was not sent* for an `UNCERTAIN` row, and when. |
| `history` | [object] | Capped at 20 entries. |

**Why a separate collection rather than a flag on the case.** Three different paths send a case's
email — intake, final approval and the Front Office retry buttons — and two of them can run
concurrently with a third. A flag read and then written leaves a window between the two; a unique
key does not. The live failure this model exists to prevent had four Approve requests all read "no
response sent yet" during one twenty-two-second send, and all proceed.

**`UNCERTAIN` is a first-class state, not an error.** A send whose outcome was never confirmed
cannot be retried safely and must not be silently treated as failed. The row keeps it, the UI reads
it, and a person settles it through `POST /queries/:queryId/outbound/resolve` — audited as
`EMAIL_DELIVERY_CONFIRMED` or `EMAIL_DELIVERY_DENIED`. For Gmail the Sent folder is searched first
and the row is settled automatically where the answer is unambiguous.

**Cleared by a reset.** `POST /queries/reset` and `npm run db:reset` delete this collection with the
rest. Case IDs restart from `00001` after a reset, so a surviving row would silently suppress the
first email of a new case carrying an old case's id.

## 13.7 Supporting Entities

- **User** (`User.js`) — `userId` (unique index), `name`, `email` (unique index), `role` (enum of `constants/roles.js`, indexed), `divisionId`, `active`, `createdAt`. Seeded on connect from `constants/users.js` with `$setOnInsert`, so a restart never overwrites an edited record.
- **Review** (`Review.js`) — one reviewer's decision on one step: `reviewId` (unique index), `queryId` (indexed), `stepId` (indexed), `reviewerId`, `decision`, `comment`, `responseId`, `version`, `at`. The field is **singular**: it was `comments`, the client has always written `comment`, and the persist validator therefore stripped every reviewer's words in silence — stored reviews from before the fix all read `comments: ""`. `responseId` and `version` pin a comment to the draft it judged, so it stays meaningful once a later revision supersedes that text. `stepId` and `reviewerId` are **nullable**: the Officer-in-Charge returning a draft for revision from *final approval* has no review step open, and declaring `stepId` required made that request a 400 that took the case update and the audit event down with it.
- **Notification** (`Notification.js`) — `notificationId` (unique index), `queryId`, `recipientRole`, `recipientUserId` (all indexed), `title`, `message`, `type`, `read`, `at`.
- **EmailMessage** (`EmailMessage.js`) — `messageId` (unique index), `threadId` and `queryId` (indexed), `direction`, `emailType`, `timestamp`, `to` (`Mixed`, because a provider may hand back one address or a list), `from`, `cc`, `bcc`, `subject`, `body`, `attachments`, `sourceMessageId`, `providerMessageId`, `providerThreadId`. `sourceMessageId` carries a unique **partial** index (`partialFilterExpression: { sourceMessageId: { $type: 'string' } }`) — one incoming email can open exactly one case, enforced by the database rather than by one browser tab's memory. Partial and not `sparse: true`: sparse excludes only documents where the field is *absent*, but the field has `default: null`, so Mongoose writes an explicit null on every outbound record and sparse indexed all of them — every acknowledgement and forward then collided on `null`.
- **EmailThread** (`EmailThread.js`) — `threadId` (unique index), `queryId` (indexed), `createdAt`.
- **MailboxMessage** (`MailboxMessage.js`) — the IPC mailbox: `mailboxMessageId` (unique index), `to` (indexed), `from`, `cc`, `bcc`, `subject`, `body`, `attachments`, `receivedAt`, `ingested` (indexed), `aiSummary`, plus three fields for mail read from a provider rather than deposited locally:
  - `source` (indexed, default `local`) — `local` for a message deposited into the mock/Mongo mailbox, `nic-browser` for one read out of NICeMail by the browser agent.
  - `providerMessageId` — the provider's id for the message, under a unique **partial** index (`partialFilterExpression: { providerMessageId: { $type: 'string' } }`), so re-reading the inbox can never store it twice while local messages, which have none, never collide. For `nic-browser` it is Zoho's own message id, taken off the inbox row — the id the mail app routes on and names the open message's container with, verified against the live mailbox ([NIC_BROWSER_AGENT.md §17](../NIC_BROWSER_AGENT.md#17-two-front-office-mailboxes)) — and `mailboxMessageId` is derived from it (`NICB-` plus a hash).
  - `removedAt` — set when the Front Office deletes a `nic-browser` message, which is hidden rather than deleted. The row is the only record that the message was already handled: a sync writes with `$setOnInsert`, so it never resets `ingested` or `removedAt`. The Mongo primary store never lists, changes or deletes a `nic-browser` row, so `DELETE /api/v1/mailbox` and the primary mailbox's delete leave them alone; a row deleted outright by `npm run db:reset` is stored again by the next sync that reaches the message.

  Further fields, additive, for what a provider reader extracts beyond the common shape. Rows are insert-only and **not backfilled**: older rows simply lack them, and the API view fills the defaults.

  - `toAddresses` — the message's own To header, as read. `to` stays the mailbox the message was filed under, so Bcc'd and list mail still belongs to that mailbox's Front Office; the API falls back to `[to]` when this is empty.
  - `providerThreadId` — the provider's conversation id. Null for `nic-browser` until the thread id is calibrated.
  - `bodyHtml` — the body as the provider rendered it, for the dashboard's sandboxed view. Null when there is none or it is over 1,000,000 characters (dropped, never cut). Left out of list responses; only a message's own endpoint returns it.
  - `providerUnread` — whether the provider showed the message unread when it was first read. A record of the provider's state, not the QMS read state.
  - `receivedAtSource` — `message` when `receivedAt` is the message's own timestamp, `sync` when it is only the time the agent read it.
  - `readAt` / `readByUserId` — the QMS read state, set once by the first `POST /api/v1/mailbox/messages/:id/read`. Only the NICeMail mailbox keeps it, and it is never written back to NICeMail.
  - `createdAt` — when the row was written, set explicitly on insert. Its schema default is `null`, not the current time, so an older row reads `null` rather than the time it was loaded.

  A compound index `{ to: 1, source: 1, removedAt: 1, receivedAt: -1, mailboxMessageId: -1 }` serves the inbox list: one mailbox, not removed, newest first.

  The same file exports **Counter** (`key`, numeric `value`), incremented with `$inc` to mint sequential `MSG-00001` ids for locally deposited messages. Carries no accept/reject state — that is `MailboxDecision` (13.5).
- **QueryCounter** (`QueryCounter.js`) — the workflow store's id counters, stored whole as an object (`QRY`, `THREAD`, `MSG`, `AUD`, `NOTIF`, `STEP`, `REV`, `RESP`) under a single `counters` key. Kept apart from `Counter` because that model's `value` is a `Number`, and writing a map into it throws a `CastError` that fails the entire persist. `value` is `Mixed` rather than `Object` so per-key atomic operators reach it: accepting a message mints its Case ID with `$inc: { 'value.QRY': 1 }`, and a client's reported counters are merged with `$max: { 'value.QRY': n }`, never `$set`, so a stale tab cannot regress the sequence. Under a plain `Object` path Mongoose's strict mode strips those dotted updates and the write silently does nothing.
- **Division** and **Category** — still static constants in the frontend. No collection, no API.

**Indexes are authoritative from the schema.** `connectDb()` calls `Model.syncIndexes()` on every model at startup. `createCollection()` builds an index that does not exist yet but will not rebuild one whose *options* have changed, which is how the database kept a unique `EmailMessage.sourceMessageId` index created without the partial filter while the schema said otherwise. `syncIndexes()` drops and recreates what has drifted, and also drops indexes these model files do not declare — the intended contract: the schema files are where indexes are defined.

## 13.8 Not Yet Finalized

- **Referential integrity is not enforced by the database.** References are plain string ids, not `ObjectId`s, so nothing stops a `currentWorkflowStepId` pointing at a step that no longer exists. That invariant is held by the store's single-writer `applyTransition`, and would have to be re-established server-side alongside workflow-state enforcement.
- **Case-field enums are not schema-constrained** — `validators/queryStateSchemas.js` bounds the key space of a persist, not the value sets.
- Retention and archival for closed cases remain open, along with the items in
[14-open-questions-and-client-clarifications.md](./14-open-questions-and-client-clarifications.md).
