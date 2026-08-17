# Query Lifecycle — Walkthrough

This narrates `QRY-2026-00427` through the full lifecycle shown in the mermaid diagram at
[srs/05-workflow-and-state-machine.md](../srs/05-workflow-and-state-machine.md). This is the
same mock query used throughout the SRS and the frontend prototype
(`frontend/src/constants/mockQuery.js`).

1. **Received** — Rajesh Kumar emails a question about eligibility criteria for the
   Government Training Programme. Front Office (Priya Sharma) receives it.
2. **Registered** — the system creates `QRY-2026-00427` (`businessStatus: OPEN`,
   `workflowState: RECEIVED`), stores the email and attachments against it.
3. **Verified & forwarded** — Priya confirms the basic details are correct and forwards the
   query to the Officer-in-Charge, Anil Verma.
4. **Assignment** — the AI Assignment Assistant recommends Neha Singh (92% match, based on
   category/subject/history/workload). Anil accepts the recommendation. `workflowState`
   moves to `ASSIGNED`, then `DRAFTING` once Neha starts.
5. **Drafting** — Neha reviews the attachments, and the AI Draft Assistant generates an
   initial response (`response version v1`). Neha edits it (`v2`) and marks it ready for
   review.
6. **Review Level 1** — Amit Mehta reviews `v2` and approves it.
7. **Review Level 2** — Kavita Rao reviews next. In this walkthrough she requests changes;
   Neha revises (`v3`) and the query re-enters Review Level 2, which then approves.
8. **Final approval** — Anil reviews the fully-approved draft and grants final approval
   (`workflowState: APPROVED`, then `READY_FOR_DISPATCH`).
9. **Dispatch** — Priya (Front Office) previews the recipient and attachments, sends the
   response to Rajesh, and the system records delivery details.
10. **Closed** — `businessStatus: CLOSED`, `workflowState: CLOSED`. The full audit trail —
    every step above — remains attached to the query permanently.

The current mock data snapshot in `mockQuery.js` freezes this story mid-way (at Review Level
2, `workflowState: UNDER_REVIEW`) specifically so the `/queries/:queryId` detail screen has a
non-trivial timeline, draft-version history, and audit log to display.
