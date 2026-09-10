import { chromium } from 'playwright-core';
import browserConfig from '../../../../config/browserConfig.js';

/**
 * Attaching to the NICeMail tab the human already opened and authenticated.
 *
 * This module can only ever ATTACH. It never launches a browser, never
 * navigates to a login page, never types a credential, and never touches an
 * OTP field. If it cannot find an authenticated session it says exactly what
 * the human must do and stops — silently opening a fresh browser would defeat
 * the entire purpose, since a fresh browser is not logged in.
 */

/** The four session states, worded for the operator rather than the log. */
export const MESSAGES = {
  NO_CHROME:
    'Chrome is not available for browser automation. Please open the supported Chrome session first.',
  NO_TAB: 'No NICeMail tab found. Please open NICeMail in Chrome.',
  NOT_AUTHENTICATED:
    'NICeMail is open, but the session is not authenticated. ' +
    'Please complete the NICeMail login/OTP manually.',
  SESSION_EXPIRED: 'NICeMail session expired. Please authenticate again in Chrome.',
};

/** URL fragments that mean "this is a sign-in screen", not a mailbox. */
const LOGIN_MARKERS = ['/login', '/signin', 'accounts.', 'oauth', 'otp', 'twofactor', '2fa'];

const lower = (value) => String(value || '').toLowerCase();

/** Does this page look like a NICeMail tab? URL first, title as a weaker signal. */
export function scoreTab({ url, title }) {
  const u = lower(url);
  const t = lower(title);

  const urlHit = browserConfig.urlPatterns.some((pattern) => u.includes(pattern));
  if (!urlHit) return 0;

  let score = 10;
  // A mailbox view beats a marketing or help page on the same host.
  if (/inbox|mail|folder|message/.test(u)) score += 5;
  if (browserConfig.titlePatterns.some((pattern) => t.includes(pattern))) score += 2;
  // A sign-in screen is still a NICeMail tab, just not a usable one — it must
  // rank below a real mailbox rather than being discarded, so that the caller
  // can tell "not logged in" apart from "no tab at all".
  if (LOGIN_MARKERS.some((marker) => u.includes(marker))) score -= 8;

  return score;
}

/**
 * Highest-scoring tab wins; ties break on the order Chrome reports, which is
 * stable. Never `pages()[0]`.
 */
export function pickBestTab(candidates) {
  const scored = candidates
    .map((candidate, index) => ({ ...candidate, score: scoreTab(candidate), index }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return scored[0] || null;
}

/**
 * Is this page a signed-in mailbox?
 *
 * Conservative on purpose: a visible password field, or a URL that looks like
 * a sign-in step, means not authenticated. Anything else on a matched host is
 * treated as authenticated, and the read/send actions will fail loudly with
 * SESSION_EXPIRED if that turns out to be wrong.
 */
export async function isAuthenticated(page) {
  if (LOGIN_MARKERS.some((marker) => lower(page.url()).includes(marker))) return false;

  try {
    const passwordField = page.locator('input[type="password"]').first();
    if (await passwordField.isVisible({ timeout: 1500 })) return false;
  } catch {
    // No password field, or it never became visible — both mean "not a login form".
  }

  return true;
}

/**
 * Connect, find the NICeMail tab, confirm it is signed in.
 *
 * Returns `{ ok, stage, data, error }` matching the IMAP actions' contract.
 * On success `data` carries `{ browser, page, url, title }`; the caller MUST
 * pass the browser to `release()` when finished.
 *
 * `connect` is the injection seam for tests, mirroring `createClient` in
 * nicImap.js. Production never passes it.
 */
export async function attachToNicemail({ connect = null } = {}) {
  const connector = connect || ((endpoint) => chromium.connectOverCDP(endpoint));

  let browser;
  try {
    browser = await connector(browserConfig.cdpEndpoint, { timeout: browserConfig.timeoutMs });
  } catch (error) {
    return {
      ok: false,
      stage: 'connect_browser',
      error: MESSAGES.NO_CHROME,
      details: {
        endpoint: browserConfig.cdpEndpoint,
        reason: String(error?.message || error).split('\n')[0],
      },
    };
  }

  try {
    // Every context, not just the default one — the tab may live in any of them.
    const pages = browser.contexts().flatMap((context) => context.pages());

    const candidates = pages.map((page) => ({ page, url: page.url(), title: '' }));
    for (const candidate of candidates) {
      try {
        candidate.title = await candidate.page.title();
      } catch {
        // A page mid-navigation cannot report a title; URL alone still scores.
      }
    }

    const best = pickBestTab(candidates);

    if (!best) {
      await release(browser);
      return {
        ok: false,
        stage: 'find_tab',
        error: MESSAGES.NO_TAB,
        details: { tabsInspected: candidates.length },
      };
    }

    if (!(await isAuthenticated(best.page))) {
      await release(browser);
      return {
        ok: false,
        stage: 'verify_session',
        error: MESSAGES.NOT_AUTHENTICATED,
        details: { url: best.url },
      };
    }

    return {
      ok: true,
      stage: 'verify_session',
      data: { browser, page: best.page, url: best.url, title: best.title },
    };
  } catch (error) {
    await release(browser);
    return {
      ok: false,
      stage: 'find_tab',
      error: String(error?.message || error).split('\n')[0],
    };
  }
}

/**
 * Detach without disturbing the human's browser.
 *
 * On a browser obtained through `connectOverCDP`, Playwright's `close()`
 * disconnects and clears contexts *it* created rather than terminating Chrome
 * — Playwright has no separate `disconnect()`. We create no contexts, only
 * reuse existing pages, so there is nothing of the user's for it to tear down.
 */
export async function release(browser) {
  try {
    if (browser?.isConnected?.()) await browser.close();
  } catch {
    // Detaching is best-effort; a failure here cannot invalidate work already done.
  }
}
