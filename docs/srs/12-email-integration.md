# 12. Email Integration

## 12.1 Architecture (Implemented)

```
Inbound mailbox
      ↓
Email ingestion service (polls or receives webhook)
      ↓
Parses sender, subject, body, attachments
      ↓
Creates Query (WORKFLOW_STATE = RECEIVED)
      ↓
Front Office verification queue
```

Outbound dispatch mirrors this in reverse: an approved response is rendered into an email
(with attachments) and sent through the same provider, with delivery status recorded against
the query.

## 12.2 Open Items (Client Clarification Required)

- **Ingestion**: Automatic (mailbox polling/webhook) or manual (Front Office pastes/uploads
  the email)?
- **Provider**: Which email service/API (e.g. Microsoft Graph, Gmail API, SMTP/IMAP)?
- **Threading**: Should follow-up emails on the same query thread attach to the existing
  Query record, or always create a new one?
- **Incoming replies**: If an inquirer replies mid-workflow, how should that be handled —
  new query, or appended to the existing one?
- **Outgoing automation**: Should dispatch send automatically on final approval, or require a
  Front Office confirmation step first?

## 12.3 Current Implementation

Email ingestion and dispatch (Gmail transport + mailbox polling) exist; see
`backend/src/services/email/`. Sections above describing "None" predate that work and cover
the parts of this document (threading rules, provider choice already made) that remain
otherwise unrevised.

## 12.4 Attachments

Attachments are supported end-to-end: upload (`POST /api/v1/attachments`), real MIME
multipart on outbound Gmail sends, byte download of inbound Gmail attachments, and the
Front Officer's Forward to the Officer-in-Charge. See `backend/src/services/attachments/`.

The Forward-to-OIC path is **fail-closed**: if any attachment associated with the query
cannot be resolved (unknown id, missing bytes on disk, checksum mismatch), the forward is
aborted before any email is sent and returns `409` naming the unavailable attachment(s). The
Officer-in-Charge never receives a forward that looks complete but is silently missing a
document.

**Security note:** the attachment endpoints require a session and a role, but **not a relationship
to the case** — any authenticated user can read any attachment by id. See
[backend/README.md](../../backend/README.md#security-status-authenticated-but-not-yet-case-scoped)
for what is required before deployment.

**Attachments fail closed on send.** Every referenced file is verified (existence, bytes, SHA-256)
before an outbound message leaves; an unresolvable attachment aborts the send with a 409 naming it,
rather than delivering a message with documents silently missing.
