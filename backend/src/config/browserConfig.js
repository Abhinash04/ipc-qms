const browserConfig = {
  get cdpEndpoint() {
    return (process.env.NIC_CDP_ENDPOINT || 'http://localhost:9222').trim();
  },

  get urlPatterns() {
    const raw = (process.env.NIC_WEBMAIL_URL_PATTERNS || 'mail.gov.in,mgovcloud.in').trim();
    return raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  },
  get appUrl() {
    return (process.env.NIC_WEBMAIL_APP_URL || 'https://mail.mgovcloud.in/zm/').trim();
  },

  get titlePatterns() {
    const raw = (process.env.NIC_WEBMAIL_TITLE_PATTERNS || 'mail,inbox,nic').trim();
    return raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  },

  get testRecipient() {
    return (
      process.env.NIC_BROWSER_TEST_RECIPIENT ||
      process.env.NIC_TEST_RECIPIENT ||
      process.env.NIC_EMAIL ||
      ''
    ).trim();
  },

  get timeoutMs() {
    return parseInt(process.env.NIC_BROWSER_TIMEOUT_MS || '20000', 10);
  },

  get artifactDir() {
    return (process.env.NIC_BROWSER_ARTIFACT_DIR || 'storage/nic-browser').trim();
  },

  get mailboxEnabled() {
    return String(process.env.NIC_BROWSER_MAILBOX || '').trim().toLowerCase() === 'true';
  },

  get mailboxAddress() {
    return (process.env.NIC_EMAIL || '').trim().toLowerCase();
  },

  get frontOfficeName() {
    return (process.env.NIC_FRONT_OFFICE_NAME || 'NICeMail Front Office').trim();
  },

  get syncTtlMs() {
    return parseInt(process.env.NIC_BROWSER_SYNC_TTL_MS || '15000', 10);
  },

  get syncMax() {
    const max = Number(process.env.NIC_BROWSER_SYNC_MAX || '20');
    return Number.isInteger(max) && max > 0 ? max : 20;
  },
};

export default browserConfig;
