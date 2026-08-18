import { useCallback, useState } from 'react';

import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import {
  fetchMailboxMessages,
  markMessageIngested,
  sendAcknowledgement,
} from '@/services/api/mailboxService';

/**
 * Turn the Front Officer's incoming mail into Query Cases, and carry each new
 * case through intake automatically.
 *
 * The enquiry email is the source event for the whole workflow, so registering
 * it performs the entire Front Office stage in one go:
 *
 *   register → acknowledge the inquirer → verify → forward to the OIC
 *
 * Verification is performed rather than skipped: the SRS treats it as a Front
 * Office checkpoint, so it stays in the audit trail with the Front Officer as
 * actor even though nobody clicked a button. The manual **Forward to
 * Officer-in-Charge** button remains for retries and for cases that arrive by
 * some other route.
 *
 * Each step is committed independently. A failure part-way leaves everything
 * already done intact — a case whose forward failed sits at
 * FRONT_OFFICE_VERIFICATION and can be forwarded by hand — rather than rolling
 * back an email that has genuinely been sent.
 */
export function useMailboxIngestion() {
  const ingestEmail = useWorkflowStore((state) => state.ingestEmail);
  const recordAcknowledgement = useWorkflowStore((state) => state.recordAcknowledgement);
  const verifyQuery = useWorkflowStore((state) => state.verifyQuery);
  const forwardToOic = useWorkflowStore((state) => state.forwardToOic);
  const currentUser = useAuthStore((state) => state.currentUser);

  const [state, setState] = useState({ running: false, error: null, lastResult: null });

  const ingestNow = useCallback(async () => {
    setState((prev) => ({ ...prev, running: true, error: null }));
    try {
      const { messages = [] } = await fetchMailboxMessages({ unreadOnly: true });

      const created = [];
      const skipped = [];
      const acknowledged = [];
      const forwarded = [];

      for (const message of messages) {
        const result = ingestEmail(message);
        (result.created ? created : skipped).push(result.queryId);

        // Best-effort: failing to flag only means the message is polled again,
        // and the ingestion guard still refuses to duplicate it.
        try {
          await markMessageIngested(message.mailboxMessageId);
        } catch {
          /* non-fatal — see comment above */
        }

        if (!result.created) continue;

        if (await acknowledge(result.queryId, message.from, recordAcknowledgement)) {
          acknowledged.push(result.queryId);
        }

        if (await verifyAndForward(result.queryId, currentUser, verifyQuery, forwardToOic)) {
          forwarded.push(result.queryId);
        }
      }

      const result = { fetched: messages.length, created, skipped, acknowledged, forwarded };
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
  }, [ingestEmail, recordAcknowledgement, verifyQuery, forwardToOic, currentUser]);

  return { ...state, ingestNow };
}

/**
 * Send and record the acknowledgement for a new case.
 *
 * A failure here must not undo the registration: the query legitimately exists
 * even if the courtesy email could not go out.
 */
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

/**
 * Complete the Front Office stage: verify, then forward to the OIC.
 *
 * Both go through the store's normal guarded actions, so RBAC and the state
 * machine apply exactly as they do for the manual buttons — this is automation
 * of the clicks, not a bypass of the rules.
 */
async function verifyAndForward(queryId, actor, verifyQuery, forwardToOic) {
  try {
    verifyQuery(queryId, actor);
  } catch {
    // Wrong role, or the case is no longer at RECEIVED. Leave it for a human.
    return false;
  }

  try {
    await forwardToOic(queryId, actor);
    return true;
  } catch {
    // The verification stands; the case waits at FRONT_OFFICE_VERIFICATION and
    // the Forward button is available for a retry.
    return false;
  }
}
