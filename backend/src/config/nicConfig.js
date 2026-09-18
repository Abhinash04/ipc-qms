/**
 * NICeMail connection configuration.
 *
 * Follows the shape of config/authConfig.js — a flat snapshot read from
 * process.env at import, plus a `validate*` returning error strings and an
 * `assert*` that throws.
 *
 * Deliberately separate from config/env.js, which owns EMAIL_TRANSPORT and
 * MAILBOX_SOURCE and calls `validateNicConfig()` when either is set to `nic`.
 * Keeping the NIC_* names in one file means the Gmail and mock paths cannot be
 * disturbed by anything here, and that the two validators cannot drift.
 *
 * This file configures IMAP/SMTP only. The NICeMail browser agent has its own
 * settings in config/browserConfig.js and shares nothing with these.
 *
 * Endpoint defaults are empty on purpose. The working pair as of Phase 0 is
 * imap.mgovcloud.in:993 / smtp.mgovcloud.in:465, documented in .env.example —
 * NIC may move them, and a hard-coded host is the kind of thing that silently
 * points a government mailbox integration at the wrong server.
 *
 * The password is never held here. See services/email/nic/credentials.js.
 */
/**
 * Read at call time rather than snapshotted at import, matching
 * `services/email/mailbox/index.js` and `config/identities.js`. The suite
 * varies the environment between cases, and a snapshot would force
 * `vi.resetModules()` — which re-imports imapflow and mailparser on every
 * test and costs seconds per case.
 */
const nicConfig = {
  get email() {
    return (process.env.NIC_EMAIL || '').trim();
  },

  get imapHost() {
    return (process.env.NIC_IMAP_HOST || '').trim();
  },
  get imapPort() {
    return parseInt(process.env.NIC_IMAP_PORT || '993', 10);
  },
  get imapSecure() {
    return (process.env.NIC_IMAP_SECURE || 'true').toLowerCase() !== 'false';
  },

  get smtpHost() {
    return (process.env.NIC_SMTP_HOST || '').trim();
  },
  get smtpPort() {
    return parseInt(process.env.NIC_SMTP_PORT || '465', 10);
  },
  get smtpSecure() {
    return (process.env.NIC_SMTP_SECURE || 'true').toLowerCase() !== 'false';
  },

  get mailbox() {
    return (process.env.NIC_MAILBOX || 'INBOX').trim();
  },

  /**
   * The only address `send_nicemail` will mail. Defaults to the NIC mailbox
   * itself, so the default behaviour of the send action is to talk to its own
   * inbox rather than to reach a third party.
   */
  get testRecipient() {
    return (process.env.NIC_TEST_RECIPIENT || process.env.NIC_EMAIL || '').trim();
  },

  get timeoutMs() {
    return parseInt(process.env.NIC_TIMEOUT_MS || '20000', 10);
  },
};

function validateNicConfig(config = nicConfig) {
  const errors = [];

  if (!config.email) errors.push('NIC_EMAIL is required');
  if (!config.imapHost) errors.push('NIC_IMAP_HOST is required (e.g. imap.mgovcloud.in)');
  if (!config.smtpHost) errors.push('NIC_SMTP_HOST is required (e.g. smtp.mgovcloud.in)');

  if (!Number.isFinite(config.imapPort) || config.imapPort <= 0) {
    errors.push('NIC_IMAP_PORT must be a positive port number');
  }
  if (!Number.isFinite(config.smtpPort) || config.smtpPort <= 0) {
    errors.push('NIC_SMTP_PORT must be a positive port number');
  }
  if (!config.mailbox) errors.push('NIC_MAILBOX must not be empty');

  return errors;
}

function assertValidNicConfig(config = nicConfig) {
  const errors = validateNicConfig(config);
  if (errors.length) {
    throw new Error(`Invalid NICeMail configuration:\n  - ${errors.join('\n  - ')}`);
  }
}

export { validateNicConfig, assertValidNicConfig };
export default nicConfig;
