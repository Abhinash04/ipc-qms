import { z } from 'zod';
import { DECISIONS } from '../models/MailboxDecision.js';

/**
 * The Front Officer's decision on one incoming message.
 *
 * `decidedByUserId` and `decidedByRole` are deliberately absent: the server
 * fills those from the session, as it does for audit events. A decision whose
 * actor the caller names is a decision the caller can attribute to someone
 * else.
 */
export const mailboxDecisionSchema = z.object({
  decision: z.enum([DECISIONS.ACCEPTED, DECISIONS.REJECTED]),

  /** Present on accept — the case the client minted for this message. */
  queryId: z.string().nullable().optional(),
  reason: z.string().max(500).nullable().optional(),

  /**
   * A snapshot of the message, so a rejection stays answerable after the mail
   * itself is archived or deleted. Optional: the decision is valid without it.
   */
  message: z
    .object({
      from: z.string().optional(),
      subject: z.string().optional(),
      receivedAt: z.string().optional(),
    })
    .nullable()
    .optional(),
});

/**
 * The incoming message as the Front Office inbox saw it.
 *
 * The server does not re-fetch the message before accepting it — under
 * MAILBOX_SOURCE=gmail that would be a second round trip to the provider for
 * data the client already holds. What it does NOT take from the body is the
 * actor, the Case ID or the decision: those are the server's to determine.
 */
export const acceptMessageSchema = z.object({
  from: z.string().optional(),
  to: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  cc: z.array(z.string()).nullable().optional(),
  bcc: z.array(z.string()).nullable().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  receivedAt: z.string().optional(),
  providerMessageId: z.string().nullable().optional(),
  providerThreadId: z.string().nullable().optional(),
  attachments: z.array(z.unknown()).nullable().optional(),
});
