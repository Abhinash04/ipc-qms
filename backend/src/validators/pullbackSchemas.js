import { z } from 'zod';
import { ALL_WORKFLOW_STATES } from '../constants/workflowStates.js';

const trimmed = (label) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: `${label} must not be blank` });

export const pullbackSchema = z.object({
  /**
   * A workflow state, not free text.
   *
   * `pullbackController` writes this value straight into
   * `QueryCase.workflowState`, and the only check was that it was a non-blank
   * string — so a typo, or anything else, became the case's state and no
   * transition recognised it afterwards. The route is ADMIN/SUPER_ADMIN only,
   * which is why this is an integrity fix rather than a privilege one.
   */
  targetStage: trimmed('targetStage').pipe(z.enum(ALL_WORKFLOW_STATES)),
  reason: trimmed('reason'),
  remarks: z
    .string()
    .optional()
    .nullable()
    .transform((value) => (value ? value.trim() : '')),
});
