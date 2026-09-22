/**
 * Configuration for attaching to the human's already-authenticated Chrome.
 *
 * Getters rather than a snapshot, matching config/nicConfig.js — the suite
 * varies the environment between cases and a snapshot would force
 * `vi.resetModules()`.
 *
 * There is deliberately no credential here and no launch option. This module
 * can only describe how to ATTACH to a browser a human already opened and
 * logged into; it cannot start one.
 */
const browserConfig = {
  /**
   * Where Chrome exposes the DevTools Protocol.
   *
   * Chrome 144+ can enable this on the running instance, default profile
   * included, via chrome://inspect/#remote-debugging. Before 144 — and as a
   * fallback if that toggle does not produce a reachable endpoint — Chrome
   * must be launched with `--remote-debugging-port=9222` AND a non-default
   * `--user-data-dir`, because Chrome 136+ ignores the flag on the default
   * profile.
   */
  get cdpEndpoint() {
    return (process.env.NIC_CDP_ENDPOINT || 'http://localhost:9222').trim();
  },

  /**
   * Hosts that identify a NICeMail tab. NICeMail is Zoho-backed, so a
   * deployment may sit on either the gov.in front door or the mgovcloud
   * infrastructure behind it.
   */
  get urlPatterns() {
    const raw = (process.env.NIC_WEBMAIL_URL_PATTERNS || 'mail.gov.in,mgovcloud.in').trim();
    return raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  },

  /**
   * The mailbox URL the agent opens in its OWN tab.
   *
   * Not the operator's URL. On the workplace front door the mail UI is a
   * cross-origin iframe with a debugging target of its own, which a session on
   * the host page cannot reach; `mail.mgovcloud.in/zm/` serves the same mailbox
   * as a single top-level document — verified: zero iframes, one frame in the
   * frame tree — so one session can drive all of it. Same browser profile, so
   * the same sign-in cookies.
   */
  get appUrl() {
    return (process.env.NIC_WEBMAIL_APP_URL || 'https://mail.mgovcloud.in/zm/').trim();
  },

  /** Title fragments used as a secondary signal when the URL is ambiguous. */
  get titlePatterns() {
    const raw = (process.env.NIC_WEBMAIL_TITLE_PATTERNS || 'mail,inbox,nic').trim();
    return raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  },

  /**
   * The only address the browser send action will mail. Falls back to the
   * IMAP-side test recipient so both paths agree, then to the mailbox itself.
   */
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

  /** Where `nic:browser:discover --json` writes its inspection reports.
   *  Diagnostics only; never on the happy path. */
  get artifactDir() {
    return (process.env.NIC_BROWSER_ARTIFACT_DIR || 'storage/nic-browser').trim();
  },

  /**
   * Is the NICeMail mailbox, read through the browser agent, a second Front
   * Office mailbox? Only the exact string "true" enables it.
   */
  get mailboxEnabled() {
    return String(process.env.NIC_BROWSER_MAILBOX || '').trim().toLowerCase() === 'true';
  },

  /**
   * The mailbox the browser agent reads — NIC_EMAIL, the one place the address
   * lives. It is also the sign-in email of that mailbox's Front Office user.
   */
  get mailboxAddress() {
    return (process.env.NIC_EMAIL || '').trim().toLowerCase();
  },

  /** Display name of the Front Office user who owns the NICeMail mailbox. */
  get frontOfficeName() {
    return (process.env.NIC_FRONT_OFFICE_NAME || 'NICeMail Front Office').trim();
  },

  /** Minimum gap between two inbox syncs; the inbox poll is what triggers them. */
  get syncTtlMs() {
    return parseInt(process.env.NIC_BROWSER_SYNC_TTL_MS || '30000', 10);
  },

  /** At most this many new messages are opened per sync. Anything but a
   *  positive whole number falls back to 20 — 0 or a typo must not mean "all". */
  get syncMax() {
    const max = Number(process.env.NIC_BROWSER_SYNC_MAX || '20');
    return Number.isInteger(max) && max > 0 ? max : 20;
  },
};

export default browserConfig;
