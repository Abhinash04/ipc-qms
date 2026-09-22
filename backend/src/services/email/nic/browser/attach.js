import browserConfig from '../../../../config/browserConfig.js';
import { connect as cdpConnect } from './cdp.js';

/**
 * Attaching to the NICeMail tab the human already opened and authenticated.
 *
 * This module can only ever ATTACH. It never launches a browser, never
 * navigates to a login page, never types a credential, and never touches an
 * OTP field. If it cannot find an authenticated session it says exactly what
 * the human must do and stops — silently opening a fresh browser would defeat
 * the entire purpose, since a fresh browser is not logged in.
 *
 * Reading and sending mail happen in session.js, in a separate tab of the same
 * signed-in context; the tab found here is only the proof of that session, and
 * is read — never driven.
 */

/** The session states, worded for the operator rather than the log. */
export const MESSAGES = {
  NO_CHROME:
    'Chrome is not available for browser automation. Please open the supported Chrome session first.',
  PORT_NOT_CDP:
    'Something is listening on the CDP port, but it is not a Chrome DevTools endpoint. ' +
    'Another browser (Brave, Edge, a second Chrome profile) is most likely holding the port — ' +
    'close it, or point NIC_CDP_ENDPOINT at a different port.',
  NO_TAB: 'No NICeMail tab found. Please open NICeMail in Chrome.',
  NOT_AUTHENTICATED:
    'NICeMail is open, but the session is not authenticated. ' +
    'Please complete the NICeMail login/OTP manually.',
  SESSION_EXPIRED: 'NICeMail session expired. Please authenticate again in Chrome.',
};

/**
 * "Nothing is listening" and "something is listening that is not CDP" need
 * different fixes, and reporting both as "start Chrome" sends an operator to
 * restart a browser that is already running. A refused connection is the first;
 * anything that completed a TCP connection and then failed to speak CDP is the
 * second — which is what a rival Chromium browser squatting port 9222 looks
 * like.
 */
function connectFailureMessage(error) {
  const text = String(error?.message || error);
  if (/ECONNREFUSED|connect ECONNREFUSED|refused/i.test(text)) return MESSAGES.NO_CHROME;
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) return MESSAGES.NO_CHROME;
  if (/timeout|ETIMEDOUT/i.test(text)) return MESSAGES.NO_CHROME;
  return MESSAGES.PORT_NOT_CDP;
}

/** URL fragments that mean "this is a sign-in screen", not a mailbox. */
const LOGIN_MARKERS = ['/login', '/signin', 'accounts.', 'oauth', 'otp', 'twofactor', '2fa'];

const lower = (value) => String(value || '').toLowerCase();

/**
 * Does this page look like a NICeMail tab? HOST first, title as a weaker signal.
 *
 * The host is matched, not the URL string. A substring test over the whole URL
 * accepted anything that merely CONTAINED a configured pattern:
 * `https://mail.gov.in.attacker.example/inbox` (the pattern as a domain
 * prefix), `https://attacker.example/?next=mgovcloud.in` (in the query), and
 * `https://attacker.example/mgovcloud.in/inbox` (in the path) all matched — and
 * the mailbox-view bonus below let such a page OUTRANK the operator's real tab,
 * which scores 10 without an `/inbox` segment.
 *
 * That mattered because the caller then drives whatever this returns: on a send
 * it types the recipients, subject and body into the page and hands it the
 * resolved attachment bytes; on a read it stores whatever the page renders as
 * genuine government-mailbox intake.
 */
export function scoreTab({ url, title }) {
  const t = lower(title);

  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return 0;
  }
  // NICeMail is https. Refusing anything else also denies a plaintext
  // look-alike on a matching host name.
  if (parsed.protocol !== 'https:') return 0;

  const host = parsed.hostname.toLowerCase();
  const hostHit = browserConfig.urlPatterns.some(
    (pattern) => host === pattern || host.endsWith(`.${pattern}`),
  );
  if (!hostHit) return 0;

  let score = 10;
  // A mailbox view beats a marketing or help page on the same host. Read from
  // the PATH alone: from the whole URL, an attacker-chosen query string earned
  // the bonus.
  if (/inbox|mail|folder|message/.test(parsed.pathname.toLowerCase())) score += 5;
  if (browserConfig.titlePatterns.some((pattern) => t.includes(pattern))) score += 2;
  // A sign-in screen is still a NICeMail tab, just not a usable one — it must
  // rank below a real mailbox rather than being discarded, so that the caller
  // can tell "not logged in" apart from "no tab at all".
  if (LOGIN_MARKERS.some((marker) => lower(parsed.href).includes(marker))) score -= 8;

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

/** Does this element exist and occupy space? The whole of what a page is asked. */
const isElementVisible = (selector) => {
  const element = document.querySelector(selector);
  if (!element) return false;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
};

/**
 * One tab, in the shape attachToNicemail uses.
 *
 * Deliberately three methods wide. Scoring a tab needs its URL and title, both
 * of which CDP reports for every target without attaching to any of them, and
 * the only question ever asked of the page itself is whether a password field
 * is on it. Keeping the surface this small is what let the transport change
 * underneath without touching the scoring or the session detection above — or
 * the tests that pin them.
 */
function cdpPage(client, target) {
  return {
    targetId: target.targetId,
    browserContextId: target.browserContextId,
    url: () => target.url,
    title: async () => target.title || '',
    locator: (selector) => ({
      first: () => ({
        isVisible: async ({ timeout = browserConfig.timeoutMs } = {}) => {
          const session = await client.attach(target.targetId);
          try {
            return Boolean(await session.evaluate(isElementVisible, selector, { timeout }));
          } finally {
            await session.close();
          }
        },
      }),
    }),
  };
}

/**
 * The default connector: a CDP client wearing just enough of a browser to be
 * scored. `client` rides along on it for session.js, which needs to open the
 * agent's own tab in the same browser.
 */
async function cdpBrowser(endpoint, { timeout } = {}) {
  const client = await cdpConnect(endpoint, { timeoutMs: timeout });

  let targets;
  try {
    targets = await client.listTargets();
  } catch (error) {
    await client.disconnect();
    throw error;
  }

  // Page targets and iframe targets both: on the workplace front door the mail
  // UI is a cross-origin iframe with a target of its own, and that iframe — not
  // its host page — is what carries the signed-in mailbox.
  const pages = targets
    .filter((target) => target.type === 'page' || target.type === 'iframe')
    .map((target) => cdpPage(client, target));

  return {
    client,
    contexts: () => [{ pages: () => pages }],
    isConnected: () => client.isConnected(),
    close: () => client.disconnect(),
  };
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
  const connector = connect || cdpBrowser;

  let browser;
  try {
    browser = await connector(browserConfig.cdpEndpoint, { timeout: browserConfig.timeoutMs });
  } catch (error) {
    return {
      ok: false,
      stage: 'connect_browser',
      error: connectFailureMessage(error),
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
 * `close()` here closes the agent's own CDP socket and nothing else: no tab of
 * the operator's is closed, and Chrome keeps running. It must still be called
 * on every path, or the socket — and the process holding it — outlives the work.
 */
export async function release(browser) {
  try {
    if (browser?.isConnected?.()) await browser.close();
  } catch {
    // Detaching is best-effort; a failure here cannot invalidate work already done.
  }
}
