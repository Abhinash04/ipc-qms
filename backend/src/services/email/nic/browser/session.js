import browserConfig from '../../../../config/browserConfig.js';
import { attachToNicemail, isAuthenticated, release, MESSAGES } from './attach.js';

/**
 * One unit of browser work against the signed-in NICeMail session.
 *
 * The operator's own NICeMail tab is never driven. The work happens in a
 * separate tab opened in the SAME browser context — so it shares the session
 * cookies the operator's sign-in produced — pointed at the mailbox URL the
 * operator's tab is already on. That tab is closed afterwards, and Playwright
 * detaches without closing Chrome.
 *
 * The agent still never signs in. If the work tab lands anywhere that looks
 * like a sign-in step, the work is abandoned with SESSION_EXPIRED before a
 * single field is touched.
 *
 * Calls are serialised: there is one browser session, and a sync and a send
 * interleaving clicks in it would corrupt both.
 */

let queue = Promise.resolve();

const fail = (message, stage) => Object.assign(new Error(message), { stage });

async function runExclusive(work, { connect } = {}) {
  const attached = await attachToNicemail({ connect });
  if (!attached.ok) throw fail(attached.error, attached.stage);

  const { browser, page: operatorPage, url } = attached.data;
  let page = null;

  try {
    page = await operatorPage.context().newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: browserConfig.timeoutMs });

    if (!(await isAuthenticated(page))) throw fail(MESSAGES.SESSION_EXPIRED, 'verify_session');

    return await work(page);
  } finally {
    if (page) await page.close().catch(() => {});
    await release(browser);
  }
}

/** `connect` is the test seam, passed through to attachToNicemail. */
export function withNicemail(work, options = {}) {
  const run = queue.then(() => runExclusive(work, options));
  // The queue must survive a failed run, or one error would block every later call.
  queue = run.catch(() => {});
  return run;
}
