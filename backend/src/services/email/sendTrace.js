/**
 * One log line per stage of a case email, so a failed send says where it
 * stopped without anyone opening the database:
 *
 *   ACK START {"caseId":"QRY-2026-00001","inquirerEmail":"…","subject":"…","transport":"nic-browser"}
 *   ACK NIC BROWSER {"caseId":"QRY-2026-00001","step":"send_clicked"}
 *   ACK RESULT {"caseId":"QRY-2026-00001","status":"SENT","providerMessageId":"…"}
 *
 * Addresses and subjects are logged — they are what an operator needs to trace
 * a send. Credentials never are: a key that looks like one is dropped whatever
 * its value, so a careless caller cannot put a token in the log.
 */

const SECRET_KEY = /cookie|token|secret|password|authori[sz]ation|credential/i;

/** Where the lines go. Silent under test unless a test swaps `write`. */
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

/**
 * `sendTrace('ACK', { caseId })` → `(phase, data)`. The returned function never
 * throws: a log line must never be the reason an email was not sent.
 */
export function sendTrace(tag, base = {}) {
  return (phase, data = {}) => {
    try {
      traceSink.write(`${tag} ${phase} ${JSON.stringify(clean({ ...base, ...data }))}`);
    } catch {
      // Logging is best effort.
    }
  };
}
