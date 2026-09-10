import { toast } from 'sonner';

/**
 * The one module that imports sonner.
 *
 * Everything that raises a toast goes through here, which keeps the wording
 * rules in a single place and makes the whole notification surface mockable in
 * a test with one `vi.mock('@/services/notify')`.
 *
 * Toasts are the *transient* half of feedback. The persistent record is the
 * audit trail (`applyTransition` → `auditEvents`, and the backend audit
 * service): nothing here is a substitute for it, and no caller should skip
 * writing an audit event because it raised a toast.
 *
 * This module must never write to `console` — `src/test/setup.js` fails any
 * test that produces console output.
 */

/**
 * Batch scope.
 *
 * A mailbox sweep registers, acknowledges and forwards every unread message,
 * which is three committed transitions per email — a dozen toasts for one
 * click. Inside a batch the per-transition toasts are suppressed and the caller
 * reports the sweep once instead. The transitions themselves are unaffected:
 * every one of them is still written to the audit trail, which is where the
 * per-message detail belongs.
 */
let batchDepth = 0;

export function beginBatch() {
  batchDepth += 1;
}

export function endBatch() {
  batchDepth = Math.max(0, batchDepth - 1);
}

export function inBatch() {
  return batchDepth > 0;
}

const DEFAULTS = {
  success: 4000,
  info: 4000,
  warning: 6000,
  // Failures stay until dismissed: the user usually has to do something.
  error: Infinity,
};

const describe = (detail) => {
  if (!detail) return undefined;
  if (typeof detail === 'string') return detail;
  return detail.message || String(detail);
};

export const notify = {
  success: (title, detail, options) =>
    toast.success(title, { description: describe(detail), duration: DEFAULTS.success, ...options }),

  info: (title, detail, options) =>
    toast.info(title, { description: describe(detail), duration: DEFAULTS.info, ...options }),

  warning: (title, detail, options) =>
    toast.warning(title, { description: describe(detail), duration: DEFAULTS.warning, ...options }),

  error: (title, detail, options) =>
    toast.error(title, { description: describe(detail), duration: DEFAULTS.error, ...options }),

  loading: (title, detail, options) =>
    toast.loading(title, { description: describe(detail), ...options }),

  /**
   * Binds a toast to a promise's actual settlement, so the success message
   * cannot appear unless the operation resolved. Prefer this over a manual
   * loading/dismiss pair.
   */
  promise: (promise, messages) => toast.promise(promise, messages),

  dismiss: (id) => toast.dismiss(id),
};

export default notify;
