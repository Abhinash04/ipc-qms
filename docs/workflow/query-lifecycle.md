# Query Lifecycle — Walkthrough

This narrates an illustrative case, `QRY-2026-00427`, through the full lifecycle shown in the
mermaid diagram at
[srs/05-workflow-and-state-machine.md](../srs/05-workflow-and-state-machine.md).

The example is **narrative only** — there is no fixture file. The application seeds entirely empty
(`buildSeedState()` returns empty arrays and zeroed counters), and every case, workflow step, review
and audit event you see in the running app was produced by real activity. Case ids are minted
year-scoped as `QRY-<year>-#####`.

1. **Received** — Abhinash Pritiraj emails a question about eligibility criteria for the
   Government Training Programme. Front Office (Bhumika Makker) receives it.
2. **Registered** — the system creates `QRY-2026-00427` (`businessStatus: OPEN`,
   `workflowState: RECEIVED`), stores the email and attachments against it.
3. **Verified & forwarded** — Bhumika confirms the basic details are correct and forwards the
   query to the Officer-in-Charge, Jatin Rawat.
4. **Assignment** — the AI Assignment Assistant recommends Neha Singh (92% match, based on
   category/subject/history/workload). Jatin accepts the recommendation. `workflowState`
   moves to `ASSIGNED`, then `DRAFTING` once Neha starts.
5. **Drafting** — Neha reviews the attachments, and the AI Draft Assistant generates an
   initial response (`response version v1`). Neha edits it (`v2`) and marks it ready for
   review.
6. **Review Level 1** — Amit Mehta reviews `v2` and approves it.
7. **Review Level 2** — Kavita Rao reviews next. In this walkthrough she requests changes;
   Neha revises (`v3`) and the query re-enters Review Level 2, which then approves.
8. **Final approval** — Jatin reviews the fully-approved draft and grants final approval
   (`workflowState: APPROVED`, then `READY_FOR_DISPATCH`).
9. **Dispatch** — Bhumika (Front Office) previews the recipient and attachments, sends the
   response to Abhinash, and the system records delivery details.
10. **Closed** — `businessStatus: CLOSED`, `workflowState: CLOSED`. The full audit trail —
    every step above — remains attached to the query permanently.

To see this in the running app, raise an enquiry as the Inquirer and work it through as each role in
turn — the accounts are listed in [docs/auth.md](../auth.md). The `/queries/:queryId` detail screen
builds its timeline, draft-version history and audit log from whatever the case has actually
accumulated, so it is only as rich as the workflow you have driven.
