import { z } from 'zod';
import { ALL_WORKFLOW_STATES } from '../constants/workflowStates.js';

const trimmed = (label) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: `${label} must not be blank` });

export const pullbackSchema = z.object({
  targetStage: trimmed('targetStage').pipe(z.enum(ALL_WORKFLOW_STATES)),
  reason: trimmed('reason'),
  remarks: z
    .string()
    .optional()
    .nullable()
    .transform((value) => (value ? value.trim() : '')),
});
