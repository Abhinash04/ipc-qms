# 10. Notifications

## 10.1 Proposed Triggers

| Trigger | Notify |
| --- | --- |
| Query assigned | Assigned official |
| Assignment overridden | AI-recommended official (informational), assigned official |
| Draft ready for review | Reviewer(s) at the current review level |
| Review returned for revision | Assigned official |
| Review completed / advanced to next level | Next reviewer, or OIC if final level |
| Final approval granted | Front Office |
| Final approval rejected / returned | Assigned official |
| Response dispatched | Inquirer (external), audit log |
| Query transferred | New assignee, previous assignee (informational) |
| Query pulled back | Relevant stage owner |

This is a **proposed design**, not a confirmed requirement — see open items below.

## 10.2 Open Items (Client Clarification Required)

- Delivery channel(s): in-app only, email, or both?
- Are notifications real-time (WebSocket/SSE) or polled?
- Digest vs. immediate delivery preference?
- Do inquirers receive any system notifications beyond the final response email?

These are also tracked in
[14-open-questions-and-client-clarifications.md](./14-open-questions-and-client-clarifications.md).

## 10.3 Current Implementation

The `/notifications` route renders a static mock list
(`frontend/src/pages/notifications/NotificationsPage.jsx`) to establish the page skeleton.
No delivery mechanism exists yet.
