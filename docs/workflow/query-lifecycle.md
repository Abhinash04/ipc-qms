# Query Lifecycle — Walkthrough

This narrates an illustrative case, `QRY-2026-00427`, through the full lifecycle shown in the
mermaid diagram at
[srs/05-workflow-and-state-machine.md](../srs/05-workflow-and-state-machine.md).

The example is **narrative only** — there is no fixture file. The application seeds entirely empty
(`buildSeedState()` returns empty arrays and zeroed counters), and every case, workflow step, review
and audit event you see in the running app was produced by real activity. Case ids are minted
year-scoped as `QRY-<year>-#####`.

1. **Arrived** — an external inquirer emails a question about eligibility criteria for the
   Government Training Programme to the Front Office mailbox. Anyone may write to it from any
   address, and the message is *listed* in the IPC Mailbox as **Awaiting validation**. Nothing
   exists yet: no case, no Case ID, no acknowledgement.
2. **Accepted** — Front Office (Bhumika Makker) reads it, judges it a genuine IPC enquiry and
   clicks ✓. That one click runs the whole intake sequence server-side, in a single request
   (`POST /mailbox/messages/:messageId/accept`): it mints `QRY-2026-00427` from the database
   counter, creates the case (`businessStatus: OPEN`, `workflowState: RECEIVED`), stores the email
   and attachments against it, records the sender — read off the `From` header — as the inquirer,
   summarises the enquiry onto `aiSummary`, sends the acknowledgement to that address, and forwards
   the enquiry — with that same summary in the covering note — to the Officer-in-Charge.
   The case passes through `FRONT_OFFICE_VERIFICATION` and lands at `PENDING_ASSIGNMENT`, and the
   audit trail reads `QUERY_RECEIVED → QUERY_REGISTERED → CASE_ASSOCIATED → AI_SUMMARY_GENERATED →
   ACKNOWLEDGEMENT_SENT → QUERY_FORWARDED`, then `EMAIL_CLASSIFIED` for the decision itself. The
   summary records how it was produced: `status: GENERATED` when the model answered, `FALLBACK`
   when it did not and the deterministic stand-in was used, `FAILED` when the call threw — and only
   the last of those is worth pressing ✓ again for, which re-attempts the summary and nothing else.
   Had she clicked × instead, the rejection would have been recorded and nothing else would have
   happened.
3. **Forwarded** — already done, by the same click. The enquiry reaches the Officer-in-Charge,
   Jatin Rawat, as part of accepting it; there is no second action. **Forward to
   Officer-in-Charge** still exists on the case page, but only as the recovery path: if the forward
   failed during accept the case stays at `FRONT_OFFICE_VERIFICATION`, and that button — or
   pressing ✓ again, which repeats nothing that already succeeded — completes it.
4. **Assignment** — the AI Assignment Assistant recommends Neha Singh (92% match, based on
   category/subject/history/workload). Jatin accepts the recommendation. `workflowState`
   moves to `ASSIGNED`, then `DRAFTING` once Neha starts.
5. **Drafting** — Neha reviews the attachments, and the AI Draft Assistant generates an
   initial response (`response version v1`). Neha edits it (`v2`) and marks it ready for
   review.
6. **Review Level 1** — Amit Mehta reviews `v2` and approves it.
7. **Review Level 2** — Kavita Rao reviews next. In this walkthrough she requests changes;
   Neha revises (`v3`) and the query re-enters Review Level 2, which then approves.
8. **Final approval, and the answer** — Jatin reviews the fully-approved draft and grants final
   approval. That one click is a single server call (`POST /queries/:queryId/final-approval`) which
   locks the approved version, moves the case to `READY_FOR_DISPATCH`, emails the response to the
   address the enquiry came from, and closes the case. The audit trail reads
   `FINAL_APPROVAL_GRANTED → RESPONSE_DISPATCHED → QUERY_CLOSED`.
   The order is deliberate: the approval is recorded **before** any mail is attempted, so a decision
   Jatin made survives a mail server being down; and the case becomes `CLOSED` **only after** a send
   that actually happened, so it can never read closed while the inquirer heard nothing.
9. **Dispatch** — nothing for Bhumika to do. The Dispatch page shows the response that went out and
   who received it. It carries a **Retry sending response** button, and that is the only thing on
   this page that acts: if the send in step 8 failed, the case waits at `READY_FOR_DISPATCH` with
   an `EMAIL_SEND_FAILED` entry against it, and the retry — a Front Office action, gated on
   `DISPATCH` as it always was — completes it without creating a second response.
10. **Closed** — `businessStatus: CLOSED`, `workflowState: CLOSED`, reached in step 8. The full
    audit trail — every step above — remains attached to the query permanently.

To see this in the running app, email the Front Office mailbox from any address — email is the only
intake channel, and the in-app Raise Enquiry harness that was the other one is gone — accept it as the
Front Officer, and work it through as each role in
turn — the accounts are listed in [docs/auth.md](../auth.md). The `/queries/:queryId` detail screen
builds its timeline, draft-version history and audit log from whatever the case has actually
accumulated, so it is only as rich as the workflow you have driven.
