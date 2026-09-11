import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  attachToNicemail,
  scoreTab,
  pickBestTab,
  isAuthenticated,
  MESSAGES,
} from '../services/email/nic/browser/attach.js';

/**
 * Attach-layer tests.
 *
 * No browser and no socket: `attachToNicemail` takes a `connect` seam, the
 * same injection pattern nicImap.js uses for `createClient`. vitest.config.mjs
 * additionally points NIC_CDP_ENDPOINT at an unroutable address so an
 * un-stubbed call fails instantly rather than hanging or reaching a real Chrome.
 */

const page = ({ url = 'https://mail.gov.in/inbox', title = 'Inbox — NIC eMail', password = false } = {}) => ({
  url: () => url,
  title: async () => title,
  locator: () => ({
    first: () => ({ isVisible: async () => password }),
  }),
});

/** A fake CDP browser exposing the contexts/pages shape Playwright returns. */
const fakeBrowser = (pages) => ({
  contexts: () => [{ pages: () => pages }],
  isConnected: () => true,
  close: async () => {},
});

beforeEach(() => {
  vi.stubEnv('NIC_WEBMAIL_URL_PATTERNS', 'mail.gov.in,mgovcloud.in');
  vi.stubEnv('NIC_WEBMAIL_TITLE_PATTERNS', 'mail,inbox,nic');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('tab identification', () => {
  it('ignores tabs on unrelated hosts', () => {
    expect(scoreTab({ url: 'https://mail.google.com/mail/u/0', title: 'Inbox' })).toBe(0);
    expect(scoreTab({ url: 'https://news.example.com', title: 'Mail news' })).toBe(0);
  });

  it('scores a NICeMail mailbox above a plain NICeMail page', () => {
    const mailbox = scoreTab({ url: 'https://mail.gov.in/inbox', title: 'Inbox' });
    const landing = scoreTab({ url: 'https://mail.gov.in/help', title: 'Help' });

    expect(mailbox).toBeGreaterThan(landing);
    expect(landing).toBeGreaterThan(0);
  });

  it('ranks a sign-in page below a real mailbox but still recognises it', () => {
    const login = scoreTab({ url: 'https://mail.gov.in/login', title: 'Sign in' });
    const mailbox = scoreTab({ url: 'https://mail.gov.in/inbox', title: 'Inbox' });

    // Still > 0 so the caller can say "not authenticated" rather than "no tab".
    expect(login).toBeGreaterThan(0);
    expect(login).toBeLessThan(mailbox);
  });

  it('never just takes the first tab', () => {
    const best = pickBestTab([
      { url: 'https://example.com', title: 'Something else' },
      { url: 'https://mail.gov.in/help', title: 'Help' },
      { url: 'https://mail.gov.in/inbox', title: 'Inbox' },
    ]);

    expect(best.url).toBe('https://mail.gov.in/inbox');
  });

  it('breaks ties deterministically by tab order', () => {
    const best = pickBestTab([
      { url: 'https://mail.gov.in/inbox', title: 'Inbox' },
      { url: 'https://mgovcloud.in/inbox', title: 'Inbox' },
    ]);

    expect(best.url).toBe('https://mail.gov.in/inbox');
  });

  it('returns nothing when no tab matches', () => {
    expect(pickBestTab([{ url: 'https://example.com', title: 'x' }])).toBeNull();
  });
});

describe('session detection', () => {
  it('treats a visible password field as not authenticated', async () => {
    expect(await isAuthenticated(page({ password: true }))).toBe(false);
  });

  it('treats a sign-in URL as not authenticated', async () => {
    expect(await isAuthenticated(page({ url: 'https://mail.gov.in/login' }))).toBe(false);
    expect(await isAuthenticated(page({ url: 'https://accounts.mail.gov.in/otp' }))).toBe(false);
  });

  it('treats a mailbox with no password field as authenticated', async () => {
    expect(await isAuthenticated(page())).toBe(true);
  });
});

describe('attachToNicemail', () => {
  it('reports the Chrome prerequisite when CDP is unreachable', async () => {
    const result = await attachToNicemail({
      connect: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:9222');
      },
    });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe('connect_browser');
    expect(result.error).toBe(MESSAGES.NO_CHROME);
  });

  it('never launches a browser as a fallback', async () => {
    const connect = vi.fn(async () => {
      throw new Error('nope');
    });

    await attachToNicemail({ connect });

    // Exactly one attempt, and it is an attach. Anything else would mean a
    // fresh, unauthenticated browser was opened — which defeats the point.
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('reports no tab when Chrome is connected but NICeMail is not open', async () => {
    const result = await attachToNicemail({
      connect: async () => fakeBrowser([page({ url: 'https://example.com', title: 'Other' })]),
    });

    expect(result.stage).toBe('find_tab');
    expect(result.error).toBe(MESSAGES.NO_TAB);
  });

  it('reports an unauthenticated session when the tab is a login screen', async () => {
    const result = await attachToNicemail({
      connect: async () => fakeBrowser([page({ url: 'https://mail.gov.in/login', title: 'Sign in' })]),
    });

    expect(result.stage).toBe('verify_session');
    expect(result.error).toBe(MESSAGES.NOT_AUTHENTICATED);
  });

  it('attaches to the authenticated mailbox tab among several', async () => {
    const target = page({ url: 'https://mail.gov.in/inbox', title: 'Inbox — NIC eMail' });

    const result = await attachToNicemail({
      connect: async () =>
        fakeBrowser([
          page({ url: 'https://example.com', title: 'Unrelated' }),
          page({ url: 'https://mail.gov.in/help', title: 'Help' }),
          target,
        ]),
    });

    expect(result.ok).toBe(true);
    expect(result.stage).toBe('verify_session');
    expect(result.data.url).toBe('https://mail.gov.in/inbox');
    expect(result.data.page).toBe(target);
  });

  it('searches every browser context, not just the first', async () => {
    const target = page();
    const browser = {
      contexts: () => [
        { pages: () => [page({ url: 'https://example.com', title: 'x' })] },
        { pages: () => [target] },
      ],
      isConnected: () => true,
      close: async () => {},
    };

    const result = await attachToNicemail({ connect: async () => browser });

    expect(result.ok).toBe(true);
    expect(result.data.page).toBe(target);
  });

  it('detaches rather than closing the user\'s browser on failure', async () => {
    const close = vi.fn(async () => {});
    const browser = {
      contexts: () => [{ pages: () => [] }],
      isConnected: () => true,
      close,
    };

    await attachToNicemail({ connect: async () => browser });

    // close() on a CDP-connected browser disconnects; it must still be called
    // so the session is not left dangling.
    expect(close).toHaveBeenCalledTimes(1);
  });
});
