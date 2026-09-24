import { z } from 'zod';
import { DECISIONS } from '../models/MailboxDecision.js';

export const mailboxDecisionSchema = z.object({
  decision: z.enum([DECISIONS.ACCEPTED, DECISIONS.REJECTED]),
  queryId: z.string().nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
  message: z
    .object({
      from: z.string().optional(),
      subject: z.string().optional(),
      receivedAt: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export const listMessagesQuerySchema = z.object({
  recipient: z.string().optional(),
  unreadOnly: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  junkOnly: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  q: z
    .string()
    .trim()
    .max(200)
    .refine((value) => [...value].every((char) => char.charCodeAt(0) >= 32), 'contains a control character')
    .optional()
    .transform((value) => value || undefined),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).default(0),
});

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
