const keys = new WeakMap();
let counter = 0;

/**
 * Stable fallback key for list items that have no id field.
 *
 * The key is attached to the object itself (WeakMap), so it survives re-renders
 * and list reorders/filters — unlike an array index, which React would use to
 * match state to the wrong row after the list changes.
 */
export function stableKey(object) {
  if (!keys.has(object)) keys.set(object, `k${(counter += 1)}`);
  return keys.get(object);
}
