import { useCallback, useState } from "react";

import { useWorkflowStore } from "@/store/useWorkflowStore";
import {
  fetchMailboxMessages,
  markMessageIngested,
  recordMailboxDecision,
} from "@/services/api/mailboxService";
import { notify } from "@/services/notify";

const DECISION = { ACCEPTED: "ACCEPTED", REJECTED: "REJECTED" };

/**
 * The Front Officer's decision on one incoming message.
 *
 * This hook used to sweep the whole mailbox and register everything it found.
 * It no longer registers anything on its own: arriving mail is listed for a
 * human, and a case exists only because somebody accepted the message. That
 * split is the point — an advertisement and a genuine enquiry are
 * indistinguishable to a filter, and only a person can tell them apart.
 */
export function useMailboxIngestion() {
  const acceptMailboxMessage = useWorkflowStore((state) => state.acceptMailboxMessage);

  const [state, setState] = useState({ running: false, error: null, lastResult: null });

  /**
   * Accept: register the case, acknowledge the sender, forward to the
   * Officer-in-Charge — one click, one server call.
   *
   * Forwarding used to be a second, separate click on the case page. It is not
   * a second judgement in practice: every accepted enquiry goes to the
   * Officer-in-Charge, and the gap between the two clicks was a case sitting in
   * FRONT_OFFICE_VERIFICATION that nobody had been told about.
   *
   * The whole sequence runs server-side, so this no longer records the decision
   * itself — the accept endpoint does, in the same request that creates the
   * case, which is what makes the two impossible to separate.
   */
  const accept = useCallback(
    async (message) => {
      setState((prev) => ({ ...prev, running: true, error: null }));
      try {
        // No actor is passed: the server reads the acting officer from the
        // session, which is the only version of it a caller cannot choose.
        const result = await acceptMailboxMessage(message);

        // Marking the mail read is housekeeping, not the decision. A failure
        // here means the message stays unread, which is recoverable; failing the
        // whole accept over it would not be.
        await markMessageIngested(message.mailboxMessageId).catch(() => {});

        setState({ running: false, error: null, lastResult: result });
        return result;
      } catch (error) {
        const detail = error?.message || String(error);
        setState({ running: false, error: detail, lastResult: null });
        return { accepted: false, error: detail };
      }
    },
    [acceptMailboxMessage],
  );

  /**
   * Reject: record why, and create nothing.
   *
   * No case, no Case ID, no acknowledgement, no workflow. The message itself is
   * kept and stays listed — a rejection an administrator cannot later inspect is
   * not much better than a deletion.
   */
  const reject = useCallback(async (message, reason = "") => {
    setState((prev) => ({ ...prev, running: true, error: null }));
    try {
      const { alreadyDecided } = await recordMailboxDecision(message.mailboxMessageId, {
        decision: DECISION.REJECTED,
        reason,
        message: {
          from: message.from,
          subject: message.subject,
          receivedAt: message.receivedAt,
        },
      });

      await markMessageIngested(message.mailboxMessageId).catch(() => {});

      const outcome = { rejected: true, alreadyDecided };
      setState({ running: false, error: null, lastResult: outcome });
      return outcome;
    } catch (error) {
      const detail = error?.message || String(error);
      setState({ running: false, error: detail, lastResult: null });
      return { rejected: false, error: detail };
    }
  }, []);

  /**
   * Fetch what is waiting. Reads only — it registers nothing, which is the
   * whole difference from the sweep this replaced.
   */
  const checkMailbox = useCallback(async () => {
    setState((prev) => ({ ...prev, running: true, error: null }));
    try {
      const { messages = [] } = await fetchMailboxMessages({ unreadOnly: true });
      const result = { fetched: messages.length, messages };
      setState({ running: false, error: null, lastResult: result });
      return result;
    } catch (error) {
      const detail = error?.message || String(error);
      setState({ running: false, error: detail, lastResult: null });
      return { fetched: 0, messages: [], error: detail };
    }
  }, []);

  return { ...state, accept, reject, checkMailbox };
}

/**
 * The one toast for a mailbox check.
 *
 * `announceIdle` is false for the background poll — a timer that found nothing
 * is not news. A failure is always reported, because a mailbox that has
 * silently stopped being read is exactly the thing the Front Office needs to
 * know about.
 *
 * It reports mail *waiting*, never cases created: this check creates none.
 */
export function notifyMailboxCheck(result, { announceIdle = true } = {}) {
  if (result.error) {
    notify.error("Could not check the IPC mailbox", result.error);
    return;
  }

  const waiting = result.fetched || 0;
  if (waiting === 0) {
    if (announceIdle) notify.info("No new mail");
    return;
  }

  notify.info(
    `${waiting} message${waiting === 1 ? "" : "s"} awaiting validation`,
    "Open the IPC mailbox to accept or reject them.",
  );
}
