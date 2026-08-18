import { useCallback, useState } from 'react';

import { useWorkflowStore } from '@/store/useWorkflowStore';
import {
  fetchMailboxMessages,
  markMessageIngested,
  sendAcknowledgement,
} from '@/services/api/mailboxService';

export function useMailboxIngestion() {
  const ingestEmail = useWorkflowStore((state) => state.ingestEmail);
  const recordAcknowledgement = useWorkflowStore((state) => state.recordAcknowledgement);
  const [state, setState] = useState({ running: false, error: null, lastResult: null });

  const ingestNow = useCallback(async () => {
    setState((prev) => ({ ...prev, running: true, error: null }));
    try {
      const { messages = [] } = await fetchMailboxMessages({ unreadOnly: true });

      const created = [];
      const skipped = [];
      const acknowledged = [];

      for (const message of messages) {
        const result = ingestEmail(message);
        (result.created ? created : skipped).push(result.queryId);

        try {
          await markMessageIngested(message.mailboxMessageId);
        } catch {
          /* non-fatal — see comment above */
        }

        if (result.created) {
          const ack = await acknowledge(result.queryId, message.from, recordAcknowledgement);
          if (ack) acknowledged.push(result.queryId);
        }
      }

      const result = { fetched: messages.length, created, skipped, acknowledged };
      setState({ running: false, error: null, lastResult: result });
      return result;
    } catch (error) {
      const message = error?.message || String(error);
      setState({ running: false, error: message, lastResult: null });
      return { fetched: 0, created: [], skipped: [], acknowledged: [], error: message };
    }
  }, [ingestEmail, recordAcknowledgement]);

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
