import { toast } from 'sonner';

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

  promise: (promise, messages) => toast.promise(promise, messages),

  dismiss: (id) => toast.dismiss(id),
};

export default notify;
