# Query & Email Management Flow --- Analysis & Required Work

## 1. What the reference PDF shows

The PDF is an email thread about a query regarding the **Magnesium Stearate monograph in IP 2026**.

It contains: - Original query email - From / To / CC / Date / Subject - IPC/AR&D response - Forwarded email history - Technical clarification and amendments - Official disclaimer - Official bilingual signature - Three attachments

This should therefore be treated as a **traceable email-thread/query
record**, not simply a question-and-answer document.

## 2. Original Query

**From:** Maria Reis `<maria.reis@indoco.com>`\
**To:** AR&D Division `<arnd-ipc@gov.in>`\
**Date:** 22 July 2026, 09:34:49\
**Subject:** Clarification Regarding Magnesium Stearate Monograph in IP
2026

The sender raises two issues:

1.  Under the Nickel test, an additional dilution appears in the IP method but not in the corresponding USP monograph.
2.  Under the Lead test, the temperature programme refers to the Cadmium temperature programme, which appears potentially inconsistent.

The sender asks whether these differences are intentional or typographical/editorial errors.

## 3. Response

The AR&D Division provides proposed amendments based on the PDG harmonized text, including:

-   Specific Surface Area --- Page 357
-   Magnesium Stearate --- Page 3185
-   `Relative` → `related`
-   `steric acid` → `stearic acid`
-   Cadmium reference solution correction: `0.0003 μg` → `0.003 μg`
-   Removal of the additional Nickel dilution instruction
-   Addition of a Nickel reference-solution note

The response also contains an important disclaimer: it is for information regarding the specific query and should not be treated as an official interpretation of the IP standard or relied upon to demonstrate IP compliance.

## 4. Email Format

The application should preserve these structured fields:

``` text
From:
To:
Cc:
Date:
Time:
Subject:
Email Body:
Attachments:
```

Example:

``` text
From: AR&D Division <arnd-ipc@gov.in>
To: Shruti Rastogi <shruti.ipc@gov.in>
Cc: aishvigupta8@gmail.com
Date: 14 Aug 2026, 14:33:33
Subject: Magnesium stearate IP, Calcium content by AAS - reg.
```

## 5. CC Handling

The PDF shows `aishvigupta8@gmail.com` in CC, but it does **not explicitly explain why** that person was copied.

Therefore, CC should be treated as a separate recipient type, not automatically as a reviewer, approver, or assignee.

Recommended structure:

``` text
toRecipients: []
ccRecipients: []
bccRecipients: []
```

## 6. Forwarded Email

The thread preserves forwarded-message metadata:

``` text
──────── Forwarded message ────────

From:
To:
Date:
Subject:

[Forwarded message]
```

The application should keep forwarded messages connected to the same
query/thread.

## 7. Complete Query Flow

``` text
External Inquirer
       ↓
Incoming Email
       ↓
Create Query Case
       ↓
Store Email + Attachments
       ↓
Front Office Verification
       ↓
Forward / Assign to OIC
       ↓
OIC Reviews Query
       ↓
Assign Official
       ↓
Official Investigates
       ↓
AI Draft Assistance
       ↓
Official Reviews / Edits
       ↓
Reviewer Level 1
       ↓
Reviewer Level 2
       ↓
OIC Final Approval
       ↓
Front Office Verification
       ↓
Send Response
       ↓
Store Delivery Details
       ↓
Close Query
       ↓
Audit Trail
```

## 8. Assignment

The AI Assignment Assistant can analyze:

-   Query category
-   Subject/expertise
-   Previous assignments
-   Current workload

It can recommend an official, for example:

``` text
Suggested Official: Neha Singh
Match: 92%
```

The OIC then chooses:

-   Accept AI Recommendation
-   Choose Different Official

AI should assist; the OIC should retain final assignment control.

## 9. Investigation & AI Drafting

After assignment:

``` text
Status: IN PROGRESS
Workflow State: DRAFTING
```

The assigned official: - Reads the query - Reviews attachments - Researches information - Uses the AI Draft Assistant - Reviews and edits the AI draft

Version flow:

``` text
AI Draft
   ↓
Response v1
   ↓
Human Review/Edit
   ↓
Draft Ready for Review
```

## 10. Review Workflow

### Reviewer Level 1

Options: - Approve - Return / Changes Required

If returned:

``` text
Reviewer Comments
       ↓
Assigned Official
       ↓
Response v2
       ↓
Reviewer Level 1
```

### Reviewer Level 2

Options: - Approve - Return / Changes Required

If returned:

``` text
Reviewer Comments
       ↓
Assigned Official
       ↓
Response v3
       ↓
Reviewer Level 2
```

## 11. Final Approval

After successful review:

``` text
Reviewed Draft
      ↓
OIC Final Approval
```

If approved:

``` text
Final Response Locked
```

If returned:

``` text
Revision Required
      ↓
Assigned Official
      ↓
New Response Version
      ↓
Review Process
```

## 12. Final Dispatch

The Front Office should verify:

-   Recipient
-   CC
-   Attachments
-   Final response
-   Disclaimer/signature where applicable

Then:

``` text
Send Response
      ↓
Outgoing Email
      ↓
Delivery Details Stored
      ↓
Query Status = CLOSED
```

## 13. Audit Trail

Every major action should be recorded:

``` text
Received
   ↓
Forwarded
   ↓
Assigned
   ↓
Drafted
   ↓
Reviewed
   ↓
Revised
   ↓
Approved
   ↓
Dispatched
   ↓
Closed
```

Audit data should include: - Action - User - Date/time - Previous
status - New status - Comments - Response version - Related
email/message - Related attachment where applicable

## 14. Recommended UI

### Query Detail Page

Show:

-   Query ID
-   Status
-   Priority
-   Source
-   Created date
-   Assigned official

### Email Thread

Each email should show:

``` text
Sender
Date/Time
To
CC
Subject
Body
Attachments
```

Forwarded emails should be shown as part of the same thread, preferably
collapsible.

### Attachments

Show: - File name - File type - File size - Preview - Download

### Actions

Depending on user role: - Assign - Forward - Reply - Reply All - Draft
Response - Submit for Review - Approve - Return for Revision - Send
Response - Close Query

## 15. Response Composer

The response editor should support:

``` text
To
Cc
Subject
Message Body
Attachments
```

And actions such as: - Generate AI Draft - Edit - Save Draft - Version
History - Preview - Submit for Review

## 16. Main Development Modules

1.  **Email Intake** --- receive and parse email.
2.  **Query Case** --- Query ID, status, priority, source.
3.  **Email Thread** --- original, replies, forwards, To, CC,
    timestamps.
4.  **Attachment Management** --- store and display documents.
5.  **Assignment** --- AI recommendation and OIC assignment.
6.  **Investigation** --- assigned official works on the query.
7.  **AI Drafting** --- generate and version responses.
8.  **Review** --- multi-level approval and revision.
9.  **Final Approval** --- OIC approval and response locking.
10. **Dispatch** --- final verification and email sending.
11. **Audit Trail** --- complete activity and version history.

## 17. Final Requirement

The system should preserve the complete journey:

``` text
Incoming Email
      ↓
Query Case
      ↓
Email Thread
      ↓
Assignment
      ↓
Investigation
      ↓
AI Draft
      ↓
Human Editing
      ↓
Review
      ↓
Revision
      ↓
Final Approval
      ↓
Email Response
      ↓
Delivery
      ↓
Closed
      ↓
Audit History
```

### Key Rules

1.  Preserve the email format.
2.  Keep To and CC as separate fields.
3.  Keep forwarded emails inside the same thread.
4.  Keep attachments linked to the query.
5.  AI assists; it does not automatically make the final decision.
6.  Track response versions.
7.  Support review and revision loops.
8.  Require final approval before dispatch.
9.  Store outgoing email and delivery details.
10. Record every major action in the audit trail.

## Source Note

This document is based on the uploaded **"Magnesium stearate query and
response"** PDF. The PDF confirms the email/thread format, original
query, response content, CC usage, forwarded-message structure,
attachments, disclaimer, and official signature. Where the PDF does not
explicitly state the purpose of a field, that point is identified as an
inference rather than a confirmed requirement.
