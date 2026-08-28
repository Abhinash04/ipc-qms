import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const EMAIL_TRANSPORTS = { MOCK: 'mock', GMAIL: 'gmail' };
const MAILBOX_SOURCES = { AUTO: 'auto', GMAIL: 'gmail' };

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

  INQUIRER_EMAIL: process.env.INQUIRER_EMAIL || 'abhinash.pritiraj@gmail.com',
  INQUIRER_NAME: process.env.INQUIRER_NAME || 'Abhinash Pritiraj',

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

  // ── Attachments ──────────────────────────────────────────────────────────
  // Disk is the only store that works whether or not Mongo is connected
  // (Mongo is optional here — see config/db.js) and is what can feed real
  // bytes into a Gmail MIME multipart.
  ATTACHMENT_DIR: process.env.ATTACHMENT_DIR || path.join(process.cwd(), 'storage', 'attachments'),
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
    // Per-role refresh tokens are NOT required here: a role without one falls
    // back to the mock transport rather than borrowing another account. Only a
    // completely unauthenticated Gmail setup is a configuration error.
    const anyToken = ['INQUIRER', 'FRONT_OFFICE', 'OFFICER_IN_CHARGE'].some(
      (role) => process.env[`GMAIL_REFRESH_TOKEN_${role}`],
    );
    if (!anyToken) {
      errors.push(
        'At least one GMAIL_REFRESH_TOKEN_<ROLE> is required when EMAIL_TRANSPORT=gmail',
      );
    }
  }

  if (!Object.values(MAILBOX_SOURCES).includes(config.MAILBOX_SOURCE)) {
    errors.push(
      `MAILBOX_SOURCE must be one of: ${Object.values(MAILBOX_SOURCES).join(', ')} (got "${config.MAILBOX_SOURCE}")`,
    );
  }

  if (!config.IPC_QUERY_EMAIL) errors.push('IPC_QUERY_EMAIL is required');

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
