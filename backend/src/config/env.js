import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateNicConfig } from './nicConfig.js';

/**
 * An overlay file first, then `.env` for whatever it did not name.
 *
 * `ENV_FILE=.env.e2e npm start` is how the end-to-end suite points the server
 * at its own database and the mock mail transport without touching a
 * developer's `.env` — which on this machine is configured for a real Gmail
 * account. Order is the whole mechanism: dotenv never overwrites a variable
 * that is already set, so the overlay wins on every key it declares and `.env`
 * still supplies the secrets the overlay deliberately omits (JWT_SECRET,
 * QMS_SEED_PASSWORD). Unset, this is exactly the single `.env` load it replaced.
 */
if (process.env.ENV_FILE) dotenv.config({ path: process.env.ENV_FILE });
dotenv.config();

/** The backend package root — this file is at <root>/src/config/env.js. */
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * `nic` is the NICeMail IMAP/SMTP path — the direct mail protocols, configured
 * by the NIC_* variables and validated below. It is not the NICeMail browser
 * agent, which drives an authenticated web session over CDP, is never selected
 * here, and is not part of the request path at all.
 */
const EMAIL_TRANSPORTS = { MOCK: 'mock', GMAIL: 'gmail', NIC: 'nic' };
const MAILBOX_SOURCES = { AUTO: 'auto', GMAIL: 'gmail', NIC: 'nic' };

const env = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  DATABASE_URL: process.env.DATABASE_URL || '',

  EMAIL_TRANSPORT: (process.env.EMAIL_TRANSPORT || EMAIL_TRANSPORTS.MOCK).toLowerCase(),

  MAILBOX_SOURCE: (process.env.MAILBOX_SOURCE || MAILBOX_SOURCES.AUTO).toLowerCase(),

  IPC_QUERY_EMAIL: process.env.IPC_QUERY_EMAIL || 'ipc-query-mock@example.com',

  IPC_ACK_FROM_EMAIL: process.env.IPC_ACK_FROM_EMAIL || 'arnd-ipc-mock@example.com',
  IPC_ACK_FROM_NAME: process.env.IPC_ACK_FROM_NAME || 'AR&D Division',

  // INQUIRER_EMAIL / INQUIRER_NAME used to be mirrored here and had zero
  // consumers. They are still read — by config/identities.js, through the
  // dynamic `process.env[`${role}_EMAIL`]` — but an inquirer is now whoever
  // sent the mail, so there is no single configured address to surface.

  GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID || '',
  GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET || '',
  GMAIL_REDIRECT_URI: process.env.GMAIL_REDIRECT_URI || 'https://developers.google.com/oauthplayground',

  // `??`, not `||`: an explicitly empty GEMMA_API_URL means "no LLM configured"
  // and must stay empty, which is how the suite keeps off the network. With `||`
  // a blank value silently fell back to the live endpoint.
  GEMMA_API_URL: process.env.GEMMA_API_URL ?? 'https://pravahai.aicte-india.org/llm/api/gemma',
  // Measured: the live endpoint answers a realistic summary prompt in ~5.0s. A
  // 5000 default sat exactly on that boundary and made real answers abort into
  // the fallback, so it is 12000 here. This is also the ceiling on how long
  // registration can stall, because the forward to the Officer-in-Charge awaits
  // a summary inside the automatic intake chain — gemmaService falls back on
  // abort, so a dead endpoint delays that forward but never loses it.
  GEMMA_TIMEOUT_MS: parseInt(process.env.GEMMA_TIMEOUT_MS || '12000', 10),

  // ── Mailbox retention ────────────────────────────────────────────────────
  // Junk is kept whole for this long before its content is stripped, so a
  // person has a named window in which to rescue it.
  //
  // Not a TTL index, and not for the obvious reason: a TTL index can only
  // *delete* a document, while what is needed here is a field strip that keeps
  // the id stub — the stub is what stops the next sync re-ingesting the message
  // (see services/email/mailbox/nicBrowserMailbox.js).
  // `Number`, not `parseInt`: a fractional value is how an end-to-end run
  // exercises a whole retention cycle in seconds rather than two days.
  MAILBOX_RETENTION_HOURS: Number(process.env.MAILBOX_RETENTION_HOURS ?? '46'),
  // Default on with an explicit off switch, so a deployment that sets nothing
  // still reclaims space. `=false` disables the sweep timer entirely.
  MAILBOX_RETENTION_ENABLED: (process.env.MAILBOX_RETENTION_ENABLED ?? 'true') !== 'false',
  // The confidence a machine JUNK verdict needs before its content may go. A
  // hard rule scores exactly 1; the model is clamped to 0.95.
  //
  // Set this to 1 and only the deterministic rules can purge: model verdicts
  // still show in the Junk filter but can never destroy anything. That is the
  // kill switch, and 1 is the exact value — ABOVE 1 nothing purges at all,
  // because a hard rule scores 1 and would be excluded with the model.
  MAILBOX_JUNK_CONFIDENCE: Number(process.env.MAILBOX_JUNK_CONFIDENCE ?? '0.9'),
  MAILBOX_TRIAGE_BATCH: parseInt(process.env.MAILBOX_TRIAGE_BATCH || '25', 10),
  MAILBOX_PURGE_BATCH: parseInt(process.env.MAILBOX_PURGE_BATCH || '50', 10),

  // ── Attachments ──────────────────────────────────────────────────────────
  // Disk is the only store that works whether or not Mongo is connected
  // (Mongo is optional here — see config/db.js) and is what can feed real
  // bytes into a Gmail MIME multipart.
  // Resolved against the backend package root rather than process.cwd(), so a
  // relative override names the same directory however the process was
  // launched. Resolving against the cwd let `backend/storage/attachments` —
  // read while the cwd was already `backend/` — create a second, stray
  // `backend/backend/storage/attachments` tree. An absolute value passes
  // through unchanged, which is what the test harness relies on.
  ATTACHMENT_DIR: path.resolve(BACKEND_ROOT, process.env.ATTACHMENT_DIR || 'storage/attachments'),
  ATTACHMENT_MAX_FILE_MB: parseInt(process.env.ATTACHMENT_MAX_FILE_MB || '10', 10),
  // Smaller than the 25MB Gmail cap on purpose: base64 inflates payload size
  // by ~33%, and the cap is on the *encoded* message.
  ATTACHMENT_MAX_TOTAL_MB: parseInt(process.env.ATTACHMENT_MAX_TOTAL_MB || '15', 10),
  ATTACHMENT_MAX_FILES: parseInt(process.env.ATTACHMENT_MAX_FILES || '10', 10),
};

function validateEmailConfig(config = env) {
  const errors = [];

  if (!Object.values(EMAIL_TRANSPORTS).includes(config.EMAIL_TRANSPORT)) {
    errors.push(
      `EMAIL_TRANSPORT must be one of: ${Object.values(EMAIL_TRANSPORTS).join(', ')} (got "${config.EMAIL_TRANSPORT}")`,
    );
  }

  if (config.EMAIL_TRANSPORT === EMAIL_TRANSPORTS.GMAIL) {
    for (const key of ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET']) {
      if (!config[key]) errors.push(`${key} is required when EMAIL_TRANSPORT=gmail`);
    }
    // Only the Front Office mailbox is authenticated. It is the one account the
    // system reads from and sends as: acknowledgements, the forward to the
    // Officer-in-Charge and the final dispatch all go out as the Front Officer,
    // and inbox polling uses the same token. Inquirers are external senders who
    // never authenticate to anything here, and nothing sends as the OIC — that
    // role is a recipient, addressed by OFFICER_IN_CHARGE_EMAIL.
    if (!process.env.GMAIL_REFRESH_TOKEN_FRONT_OFFICE) {
      errors.push('GMAIL_REFRESH_TOKEN_FRONT_OFFICE is required when EMAIL_TRANSPORT=gmail');
    }
  }

  // NICeMail is validated by config/nicConfig.js, which owns the NIC_* names
  // and their defaults. Re-listing them here would let the two drift.
  if (
    config.EMAIL_TRANSPORT === EMAIL_TRANSPORTS.NIC ||
    config.MAILBOX_SOURCE === MAILBOX_SOURCES.NIC
  ) {
    for (const problem of validateNicConfig()) {
      errors.push(`${problem} (required when NICeMail is selected)`);
    }
  }

  if (!Object.values(MAILBOX_SOURCES).includes(config.MAILBOX_SOURCE)) {
    errors.push(
      `MAILBOX_SOURCE must be one of: ${Object.values(MAILBOX_SOURCES).join(', ')} (got "${config.MAILBOX_SOURCE}")`,
    );
  }

  // The NICeMail browser mailbox is a second Front Office mailbox, alongside
  // whatever MAILBOX_SOURCE selects. It needs only its address — the browser
  // session carries the authentication, so none of the IMAP settings apply.
  if (String(process.env.NIC_BROWSER_MAILBOX || '').trim().toLowerCase() === 'true') {
    const nicEmail = (process.env.NIC_EMAIL || '').trim().toLowerCase();
    const frontOffice = (process.env.FRONT_OFFICE_EMAIL || '').trim().toLowerCase();
    if (!nicEmail) errors.push('NIC_EMAIL is required when NIC_BROWSER_MAILBOX=true');
    else if (nicEmail === frontOffice) {
      errors.push('NIC_EMAIL must differ from FRONT_OFFICE_EMAIL when NIC_BROWSER_MAILBOX=true');
    }
  }

  if (!config.IPC_QUERY_EMAIL) errors.push('IPC_QUERY_EMAIL is required');

  // Retention destroys content, so a nonsensical setting must fail at boot
  // rather than at the first sweep an hour later.
  //
  // Only checked when the key is present. Callers pass a partial object to ask
  // about one concern — the transport, the mailbox source — and those calls are
  // not asking about retention. The real `env` always defines both keys, so a
  // genuinely bad deployment value is still caught.
  if (config.MAILBOX_RETENTION_HOURS !== undefined) {
    if (!Number.isFinite(config.MAILBOX_RETENTION_HOURS) || config.MAILBOX_RETENTION_HOURS <= 0) {
      errors.push(
        `MAILBOX_RETENTION_HOURS must be a positive number of hours (got "${config.MAILBOX_RETENTION_HOURS}")`,
      );
    }
  }
  if (config.MAILBOX_JUNK_CONFIDENCE !== undefined) {
    if (!Number.isFinite(config.MAILBOX_JUNK_CONFIDENCE) || config.MAILBOX_JUNK_CONFIDENCE < 0) {
      errors.push(`MAILBOX_JUNK_CONFIDENCE must be a number >= 0 (got "${config.MAILBOX_JUNK_CONFIDENCE}")`);
    }
  }

  return errors;
}

function assertValidEmailConfig(config = env) {
  const errors = validateEmailConfig(config);
  if (errors.length) {
    throw new Error(`Invalid email configuration:\n  - ${errors.join('\n  - ')}`);
  }
}

export { EMAIL_TRANSPORTS, MAILBOX_SOURCES, validateEmailConfig, assertValidEmailConfig };
export default env;
