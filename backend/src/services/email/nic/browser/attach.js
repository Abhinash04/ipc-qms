import browserConfig from '../../../../config/browserConfig.js';
import { connect as cdpConnect } from './cdp.js';

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

function connectFailureMessage(error) {
  const text = String(error?.message || error);
  if (/ECONNREFUSED|connect ECONNREFUSED|refused/i.test(text)) return MESSAGES.NO_CHROME;
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) return MESSAGES.NO_CHROME;
  if (/timeout|ETIMEDOUT/i.test(text)) return MESSAGES.NO_CHROME;
  return MESSAGES.PORT_NOT_CDP;
}

const LOGIN_MARKERS = ['/login', '/signin', 'accounts.', 'oauth', 'otp', 'twofactor', '2fa'];

const lower = (value) => String(value || '').toLowerCase();

export function scoreTab({ url, title }) {
  const t = lower(title);

  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return 0;
  }
  if (parsed.protocol !== 'https:') return 0;

  const host = parsed.hostname.toLowerCase();
  const hostHit = browserConfig.urlPatterns.some(
    (pattern) => host === pattern || host.endsWith(`.${pattern}`),
  );
  if (!hostHit) return 0;

  let score = 10;
  if (/inbox|mail|folder|message/.test(parsed.pathname.toLowerCase())) score += 5;
  if (browserConfig.titlePatterns.some((pattern) => t.includes(pattern))) score += 2;
  if (LOGIN_MARKERS.some((marker) => lower(parsed.href).includes(marker))) score -= 8;

  return score;
}

export function pickBestTab(candidates) {
  const scored = candidates
    .map((candidate, index) => ({ ...candidate, score: scoreTab(candidate), index }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return scored[0] || null;
}

export async function isAuthenticated(page) {
  if (LOGIN_MARKERS.some((marker) => lower(page.url()).includes(marker))) return false;

  try {
    const passwordField = page.locator('input[type="password"]').first();
    if (await passwordField.isVisible({ timeout: 1500 })) return false;
  } catch {}

  return true;
}

const isElementVisible = (selector) => {
  const element = document.querySelector(selector);
  if (!element) return false;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
};

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

async function cdpBrowser(endpoint, { timeout } = {}) {
  const client = await cdpConnect(endpoint, { timeoutMs: timeout });

  let targets;
  try {
    targets = await client.listTargets();
  } catch (error) {
    await client.disconnect();
    throw error;
  }

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

export async function attachToNicemail({ connect = null, exclude = null } = {}) {
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
    const pages = browser.contexts().flatMap((context) => context.pages());

    const ours = exclude instanceof Set ? exclude : new Set(exclude || []);
    const candidates = pages
      .filter((page) => !ours.has(page.targetId))
      .map((page) => ({ page, url: page.url(), title: '' }));
    for (const candidate of candidates) {
      try {
        candidate.title = await candidate.page.title();
      } catch {}
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

export async function release(browser) {
  try {
    if (browser?.isConnected?.()) await browser.close();
  } catch {}
}
