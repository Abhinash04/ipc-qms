# 12. Email Integration

## 12.1 Proposed Architecture (Not Confirmed)

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

None. `MOCK_QUERY.source` is hardcoded to `"Email"` in
`frontend/src/constants/mockQuery.js` to represent the intended intake channel; no ingestion
or dispatch integration exists.
