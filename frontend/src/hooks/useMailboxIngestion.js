import { useCallback, useState } from "react";

import { useWorkflowStore } from "@/store/useWorkflowStore";
import {
  fetchMailboxMessages,
  markMessageIngested,
  recordMailboxDecision,
} from "@/services/api/mailboxService";
import { notify } from "@/services/notify";

const DECISION = { ACCEPTED: "ACCEPTED", REJECTED: "REJECTED" };

export function useMailboxIngestion() {
  const acceptMailboxMessage = useWorkflowStore((state) => state.acceptMailboxMessage);

  const [state, setState] = useState({ running: false, error: null, lastResult: null });

  const accept = useCallback(
    async (message) => {
      setState((prev) => ({ ...prev, running: true, error: null }));
      try {
        const result = await acceptMailboxMessage(message);

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

  const checkMailbox = useCallback(async () => {
    setState((prev) => ({ ...prev, running: true, error: null }));
    try {
      const { messages = [], sync = null, total } = await fetchMailboxMessages({
        unreadOnly: true,
        limit: 1,
      });
      const result = { fetched: total ?? messages.length, messages, sync };
      setState({ running: false, error: null, lastResult: result });
      return result;
    } catch (error) {
      const data = error?.response?.data;
      const detail = data?.error || error?.message || String(error);
      setState({ running: false, error: detail, lastResult: null });
      return { fetched: 0, messages: [], error: detail, retryable: Boolean(data?.retryable) };
    }
  }, []);

  return { ...state, accept, reject, checkMailbox };
}

export function notifyMailboxCheck(result, { announceIdle = true } = {}) {
  if (result.error) {
    notify.error("Could not check the IPC mailbox", result.error, { id: "mailbox-unreachable" });
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
