const SECRET_KEY = /cookie|token|secret|password|authori[sz]ation|credential/i;

export const traceSink = {
  write: (line) => {
    if (process.env.NODE_ENV !== 'test') console.info(line);
  },
};

function clean(value, depth = 0) {
  if (value === null || typeof value !== 'object') return value;
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key) || item === undefined) continue;
    out[key] = clean(item, depth + 1);
  }
  return out;
}

export function sendTrace(tag, base = {}) {
  return (phase, data = {}) => {
    try {
      traceSink.write(`${tag} ${phase} ${JSON.stringify(clean({ ...base, ...data }))}`);
    } catch {}
  };
}
