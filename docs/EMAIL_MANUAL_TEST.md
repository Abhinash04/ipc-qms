# Manual Email Test Procedure

Two things in this system cannot be proven by the automated suite, and this document is how you prove them yourself:

1. **The real Gmail send** — automated tests never touch it and never require credentials.
2. **The end-to-end workflow in a browser** — the suite drives the engine directly.

---

## Before you start

```bash
cd backend  && npm start      # terminal 1 — must print "listening on port 5000"
cd frontend && npm run dev    # terminal 2 — http://localhost:5173
```

Mock login password for every development user: **`ipc@1234`**. The login page lists them all with
a **Use Credentials** button.

| Who                  | Email                       | Role              |
| ----------------------| -----------------------------| -------------------|
| Abhinash Pritiraj    | abhinash.pritiraj@gmail.com | Inquirer          |
| Priya Sharma         | priya.sharma@ipc.example    | Front Office      |
| Anil Verma           | anil.verma@ipc.example      | Officer-in-Charge |
| Neha Singh           | neha.singh@ipc.example      | Assigned Official |
| Amit Mehta           | amit.mehta@ipc.example      | Reviewer          |
| Kavita Rao           | kavita.rao@ipc.example      | Reviewer          |
| Suresh Gupta         | suresh.gupta@ipc.example    | Admin             |
| System Administrator | admin@ipc.example           | Super Admin       |

To start from nothing: **Reset demo data** in the header clears the workflow domain, and
`curl -X DELETE http://localhost:5000/api/v1/mailbox` clears the IPC mailbox.

---

## Part 1 — Full workflow walkthrough (mock transport, nothing leaves the machine)

| # | Sign in as | Do this | Expect |
| --- | --- | --- | --- |
| 1 | Abhinash Pritiraj | **Raise Enquiry** → fill subject + message → Send | "Enquiry sent" with a provider message id. A blue banner states the mock transport sends nothing over the internet. |
| 2 | Priya Sharma | **IPC Mailbox** → Check IPC mailbox | The message is listed and now shows a Query ID. `QRY-2026-00001` is created and acknowledged. |
| 3 | Priya Sharma | Open the query → Verify query details | State moves to `FRONT_OFFICE_VERIFICATION`. |
| 4 | Priya Sharma | Forward to Officer-in-Charge | State `PENDING_ASSIGNMENT`. |
| 5 | Anil Verma | **Assignments** → open the case | An AI recommendation with a match percent and a reason drawn from *this* enquiry. |
| 6 | Anil Verma | Accept the recommendation (or override) | State `ASSIGNED`. An override is recorded as its own audit event. |
| 7 | Neha Singh | **Drafting** → Start drafting | An AI first draft that answers the points the inquirer actually listed. |
| 8 | Neha Singh | Edit the text → Save | A new version (`v2`); `v1` is retained. |
| 9 | Neha Singh | Add a review level (choose a reviewer) → Submit for review | State `UNDER_REVIEW`. |
| 10 | Amit Mehta | **Reviews** → Request changes | State `RETURNED_FOR_REVISION`, back to Neha. |
| 11 | Neha Singh | Revise → Submit again | Returns to the same review level. |
| 12 | Amit Mehta | Approve | State `PENDING_FINAL_APPROVAL` (or the next review level, if you added more). |
| 13 | Anil Verma | **Approvals** → Grant final approval | State `READY_FOR_DISPATCH`; the approved version is locked. |
| 14 | Priya Sharma | **Dispatch** → Dispatch response | The response email is recorded on the same thread; state `DISPATCHED` then `CLOSED`. |
| 15 | anyone with access | Open the case | Email thread shows enquiry → acknowledgement → response. Audit history shows every step. |

**Things worth trying deliberately:**

- Paste another role's URL (e.g. `/officer-in-charge/dashboard` while signed in as the inquirer) — expect "Access restricted", not a page.
- Press **Check IPC mailbox** twice — the second press must report the mail as already registered and must not create a second case.
- Refresh the browser mid-workflow — the session and the case must both survive.

---

## Part 2 — Real Gmail send (manual only)

**This is the only part that sends real email.** Automated tests never do this.

### Preconditions
- `backend/.env` has `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` populated.
- The Gmail API is enabled in the Google Cloud project.

### Step 1 — check the credentials without sending

```bash
cd backend && npm run gmail:preflight
```

Reports whether the refresh token is accepted, whether the `gmail.send` scope is granted, and which account is authenticated. It composes and sends nothing. All three checks must pass.

### Step 2 — switch the transport

In `backend/.env`:

```
EMAIL_TRANSPORT=gmail
```

Restart the backend. The Compose page now shows an **orange** banner saying this sends a real email.

### Step 3 — send

Sign in as Abhinash Pritiraj, raise an enquiry, send.

### Step 4 — confirm

Open the real Gmail account's **Sent** folder and confirm the message is there.

> Until you have seen it in Sent with your own eyes, the Gmail path is reported as
> **NOT VERIFIED — awaiting manual test**, never as passing.

### Step 5 — switch back

Set `EMAIL_TRANSPORT=mock` and restart. Leave it on `mock` for day-to-day work.

---

## Known asymmetry — read this before you are surprised by it

`IPC_QUERY_EMAIL` defaults to `ipc-query-mock@example.com`. **That address can never receive mail**: `example.com` is reserved by RFC 2606 and publishes a null MX. That is deliberate — the mock address must never accidentally reach a real mailbox.

So with `EMAIL_TRANSPORT=gmail`:

- the enquiry genuinely leaves your Gmail account and appears in Sent
- it then **bounces**, because the recipient does not exist
- nothing lands in the IPC mailbox, because there is no IMAP/Graph reader in this system — the mailbox is fed by the mock transport only

Sending to the mock address from your own Gmail client will therefore always bounce, and will never create a query. To exercise the workflow, use the in-app Compose page with `EMAIL_TRANSPORT=mock`.

## Mailbox persistence

The IPC mailbox is stored in MongoDB when it is reachable and **survives a backend restart**; message ids stay sequential (`MSG-00001`, `MSG-00002`, …) via a counter document. If Mongo is unavailable the backend still starts and falls back to an in-memory mailbox, which is **cleared on every restart**. Every mailbox API response reports which store served it, in the `persistence` field, so you never have to guess.
