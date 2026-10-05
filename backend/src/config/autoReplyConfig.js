import env from './env.js';
import { validateDataset } from '../services/autoReply/dataset.js';

/**
 * The auto-reply threshold is the confidence a mail must reach to be offered an automatic
 * reply: 1 (the default) means only the very wording of a supported question. A broken
 * threshold or dataset stops startup rather than offering replies it should not.
 */
export function validateAutoReplyConfig(config = env) {
  const errors = [];
  const threshold = config.AUTO_REPLY_CONFIDENCE_THRESHOLD;

  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    errors.push(`AUTO_REPLY_CONFIDENCE_THRESHOLD must be greater than 0 and at most 1 (got ${threshold})`);
  }
  if (config.AUTO_REPLY_ENABLED) errors.push(...validateDataset());

  return errors;
}

export function assertValidAutoReplyConfig(config = env) {
  const errors = validateAutoReplyConfig(config);
  if (errors.length) {
    throw new Error(`Invalid auto-reply configuration:\n  - ${errors.join('\n  - ')}`);
  }
}
