const keys = new WeakMap();
let counter = 0;

export function stableKey(object) {
  if (!keys.has(object)) keys.set(object, `k${(counter += 1)}`);
  return keys.get(object);
}
