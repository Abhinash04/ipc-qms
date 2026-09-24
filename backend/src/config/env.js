import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateNicConfig } from './nicConfig.js';

if (process.env.ENV_FILE) dotenv.config({ path: process.env.ENV_FILE });
dotenv.config();
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EMAIL_TRANSPORTS = { MOCK: 'mock', NIC: 'nic' };
const MAILBOX_SOURCES = { AUTO: 'auto', NIC: 'nic' };

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
  GEMMA_API_URL: process.env.GEMMA_API_URL ?? 'https://pravahai.aicte-india.org/llm/api/gemma',
  GEMMA_TIMEOUT_MS: parseInt(process.env.GEMMA_TIMEOUT_MS || '12000', 10),

  MAILBOX_RETENTION_HOURS: Number(process.env.MAILBOX_RETENTION_HOURS ?? '42'),
  MAILBOX_UNREGISTERED_RETENTION_HOURS: Number(process.env.MAILBOX_UNREGISTERED_RETENTION_HOURS ?? '336'),
  MAILBOX_SYNC_ENABLED: (process.env.MAILBOX_SYNC_ENABLED ?? 'true') !== 'false',
  MAILBOX_SYNC_INTERVAL_MS: parseInt(process.env.MAILBOX_SYNC_INTERVAL_MS || '15000', 10),
  MAILBOX_RETENTION_ENABLED: (process.env.MAILBOX_RETENTION_ENABLED ?? 'true') !== 'false',
  MAILBOX_JUNK_CONFIDENCE: Number(process.env.MAILBOX_JUNK_CONFIDENCE ?? '0.9'),
  MAILBOX_TRIAGE_BATCH: parseInt(process.env.MAILBOX_TRIAGE_BATCH || '25', 10),
  MAILBOX_PURGE_BATCH: parseInt(process.env.MAILBOX_PURGE_BATCH || '50', 10),

  ATTACHMENT_DIR: path.resolve(BACKEND_ROOT, process.env.ATTACHMENT_DIR || 'storage/attachments'),
  ATTACHMENT_MAX_FILE_MB: parseInt(process.env.ATTACHMENT_MAX_FILE_MB || '10', 10),
  ATTACHMENT_MAX_TOTAL_MB: parseInt(process.env.ATTACHMENT_MAX_TOTAL_MB || '15', 10),
  ATTACHMENT_MAX_FILES: parseInt(process.env.ATTACHMENT_MAX_FILES || '10', 10),
};

const isProduction = () => (process.env.NODE_ENV || env.NODE_ENV) === 'production';

function validateEmailConfig(config = env) {
  const errors = [];

  if (!Object.values(EMAIL_TRANSPORTS).includes(config.EMAIL_TRANSPORT)) {
    errors.push(
      `EMAIL_TRANSPORT must be one of: ${Object.values(EMAIL_TRANSPORTS).join(', ')} (got "${config.EMAIL_TRANSPORT}")`,
    );
  }

  const browserMailbox = String(process.env.NIC_BROWSER_MAILBOX || '').trim().toLowerCase() === 'true';

  if (isProduction()) {
    if (config.EMAIL_TRANSPORT === EMAIL_TRANSPORTS.MOCK) {
      errors.push(
        'EMAIL_TRANSPORT=mock records emails as sent without sending them; set it explicitly when NODE_ENV=production',
      );
    }

    if (config.EMAIL_TRANSPORT !== EMAIL_TRANSPORTS.NIC && !browserMailbox) {
      errors.push(
        'production needs a real outbound channel: set NIC_BROWSER_MAILBOX=true, or EMAIL_TRANSPORT=nic',
      );
    }

    for (const role of ['FRONT_OFFICE', 'OFFICER_IN_CHARGE']) {
      const address = (process.env[`${role}_EMAIL`] || '').trim();
      if (!address || address.endsWith('@example.com')) {
        errors.push(`${role}_EMAIL must be a real address when NODE_ENV=production (got "${address}")`);
      }
    }
  }

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

  if (browserMailbox) {
    const nicEmail = (process.env.NIC_EMAIL || '').trim().toLowerCase();
    const frontOffice = (process.env.FRONT_OFFICE_EMAIL || '').trim().toLowerCase();
    if (!nicEmail) errors.push('NIC_EMAIL is required when NIC_BROWSER_MAILBOX=true');
    else if (nicEmail === frontOffice) {
      errors.push('NIC_EMAIL must differ from FRONT_OFFICE_EMAIL when NIC_BROWSER_MAILBOX=true');
    }
    const outboundOpen = String(process.env.NIC_ALLOW_OUTBOUND || '').trim() === 'true';
    const testRecipient = (process.env.NIC_BROWSER_TEST_RECIPIENT || process.env.NIC_TEST_RECIPIENT || '').trim();
    if (!outboundOpen && !testRecipient) {
      errors.push(
        'NIC_BROWSER_TEST_RECIPIENT is required while NIC_ALLOW_OUTBOUND is not true, or the interlock confines sends to NIC_EMAIL itself',
      );
    }
  }

  if (String(process.env.NIC_ALLOW_INTERNAL_FORWARD || '').trim() === 'true') {
    const officer = (process.env.OFFICER_IN_CHARGE_EMAIL || '').trim();
    if (!officer || officer.endsWith('@example.com')) {
      errors.push(
        'NIC_ALLOW_INTERNAL_FORWARD=true requires a real OFFICER_IN_CHARGE_EMAIL — it is the one address the allowance opens',
      );
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
  if (config.MAILBOX_SYNC_INTERVAL_MS !== undefined) {
    if (!Number.isInteger(config.MAILBOX_SYNC_INTERVAL_MS) || config.MAILBOX_SYNC_INTERVAL_MS < 1000) {
      errors.push(
        'MAILBOX_SYNC_INTERVAL_MS must be a whole number of milliseconds, at least 1000 ' +
          `(got "${config.MAILBOX_SYNC_INTERVAL_MS}")`,
      );
    }
  }
  if (config.MAILBOX_UNREGISTERED_RETENTION_HOURS !== undefined) {
    if (
      !Number.isFinite(config.MAILBOX_UNREGISTERED_RETENTION_HOURS) ||
      config.MAILBOX_UNREGISTERED_RETENTION_HOURS <= 0
    ) {
      errors.push(
        'MAILBOX_UNREGISTERED_RETENTION_HOURS must be a positive number of hours ' +
          `(got "${config.MAILBOX_UNREGISTERED_RETENTION_HOURS}")`,
      );
    } else if (
      Number.isFinite(config.MAILBOX_RETENTION_HOURS) &&
      config.MAILBOX_UNREGISTERED_RETENTION_HOURS < config.MAILBOX_RETENTION_HOURS
    ) {
      // A second tier shorter than the first would purge every message on the
      // longer rule before the junk rule could ever apply, which silently makes
      // the confidence floor — the whole protection against a wrong verdict —
      // irrelevant.
      errors.push(
        `MAILBOX_UNREGISTERED_RETENTION_HOURS (${config.MAILBOX_UNREGISTERED_RETENTION_HOURS}) must not be ` +
          `shorter than MAILBOX_RETENTION_HOURS (${config.MAILBOX_RETENTION_HOURS})`,
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

export { EMAIL_TRANSPORTS, MAILBOX_SOURCES, isProduction, validateEmailConfig, assertValidEmailConfig };
export default env;
