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
