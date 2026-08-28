import { useCallback, useState } from "react";

import { useWorkflowStore } from "@/store/useWorkflowStore";
import { useAuthStore } from "@/store/useAuthStore";
import {
  fetchMailboxMessages,
  markMessageIngested,
  sendAcknowledgement,
} from "@/services/api/mailboxService";

export function useMailboxIngestion() {
  const ingestEmail = useWorkflowStore((state) => state.ingestEmail);
  const recordAcknowledgement = useWorkflowStore(
    (state) => state.recordAcknowledgement,
  );
  const verifyQuery = useWorkflowStore((state) => state.verifyQuery);
  const forwardToOic = useWorkflowStore((state) => state.forwardToOic);
  const currentUser = useAuthStore((state) => state.currentUser);

  const [state, setState] = useState({
    running: false,
    error: null,
    lastResult: null,
  });

  const ingestNow = useCallback(async () => {
    setState((prev) => ({ ...prev, running: true, error: null }));
    try {
      const { messages = [] } = await fetchMailboxMessages({
        unreadOnly: true,
      });

      const created = [];
      const skipped = [];
      const acknowledged = [];
      const forwarded = [];

      for (const message of messages) {
        const result = ingestEmail(message);
        (result.created ? created : skipped).push(result.queryId);

        try {
          await markMessageIngested(message.mailboxMessageId);
        } catch {
          // non-fatal
        }

        if (!result.created) continue;

        if (
          await acknowledge(result.queryId, message.from, recordAcknowledgement)
        ) {
          acknowledged.push(result.queryId);
        }

        if (
          await verifyAndForward(
            result.queryId,
            currentUser,
            verifyQuery,
            forwardToOic,
          )
        ) {
          forwarded.push(result.queryId);
        }
      }

      const result = {
        fetched: messages.length,
        created,
        skipped,
        acknowledged,
        forwarded,
      };
      setState({ running: false, error: null, lastResult: result });
      return result;
    } catch (error) {
      const message = error?.message || String(error);
      setState({ running: false, error: message, lastResult: null });
      return {
        fetched: 0,
        created: [],
        skipped: [],
        acknowledged: [],
        forwarded: [],
        error: message,
      };
    }
  }, [
    ingestEmail,
    recordAcknowledgement,
    verifyQuery,
    forwardToOic,
    currentUser,
  ]);

  return { ...state, ingestNow };
}

async function acknowledge(queryId, inquirerAddress, recordAcknowledgement) {
  try {
    const sent = await sendAcknowledgement({ to: inquirerAddress, queryId });
    const outcome = recordAcknowledgement({
      queryId,
      from: sent.from,
      to: sent.to,
      subject: sent.subject,
      body: sent.body,
      timestamp: sent.sentAt,
      providerMessageId: sent.providerMessageId,
    });
    return outcome.created;
  } catch {
    return false;
  }
}

async function verifyAndForward(queryId, actor, verifyQuery, forwardToOic) {
  try {
    // Awaited so the acknowledgement promise settles inside this try. The chain
    // already acknowledged above, so verifyQuery's own attempt is a no-op.
    await verifyQuery(queryId, actor);
  } catch {
    return false;
  }

  try {
    await forwardToOic(queryId, actor);
    return true;
  } catch {
    return false;
  }
}
