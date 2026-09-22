import browserConfig from '../../../../config/browserConfig.js';
import { attachToNicemail, release, MESSAGES } from './attach.js';
import { SELECTORS } from './selectors.js';

/**
 * One unit of browser work against the signed-in NICeMail session.
 *
 * The operator's own NICeMail tab is never driven. It is the proof of the
 * session and nothing else: the work happens in a tab this agent opens itself,
 * in the operator's own browser profile — so it shares the cookies their manual
 * sign-in produced — and that tab is closed again before the call returns.
 *
 * The agent tab goes to browserConfig.appUrl rather than to whatever the
 * operator is looking at. On the workplace front door the mail UI is a
 * cross-origin iframe with a debugging target of its own, which a session on
 * the host page cannot reach; the app URL serves the same mailbox as a single
 * top-level document.
 *
 * The agent still never signs in. If the tab lands anywhere that shows a
 * password field, the work is abandoned with SESSION_EXPIRED before a single
 * field is touched — the field is counted, never focused.
 *
 * Calls are serialised: there is one browser session, and a sync and a send
 * interleaving clicks in it would corrupt both.
 */

let queue = Promise.resolve();

const fail = (message, stage) => Object.assign(new Error(message), { stage });

/**
 * Null until the app has settled one way or the other, so `waitFor` keeps
 * polling: the mailbox appears well over a second after the load event, and the
 * app's hash routing fires no lifecycle event at all.
 */
const mailboxState = ({ listing, password }) => {
  const rendered = document.querySelectorAll(listing).length > 0;
  const passwordFields = document.querySelectorAll(password).length;
  if (!rendered && passwordFields === 0) return null;
  return { rendered, passwordFields, host: location.host };
};

async function runExclusive(work, { connect } = {}) {
  const attached = await attachToNicemail({ connect });
  if (!attached.ok) throw fail(attached.error, attached.stage);

  const { browser, page: operatorPage } = attached.data;
  const { client } = browser;

  let targetId = null;
  let session = null;

  try {
    // about:blank, then navigate — the sequence that was measured end to end.
    // Creating the tab straight onto the app races its own first navigation,
    // and a Target.closeTarget issued into that race reports success on a tab
    // that stays open.
    targetId = await client.createTarget('about:blank', {
      background: true,
      browserContextId: operatorPage.browserContextId,
    });

    session = await client.attach(targetId);
    await session.send('Page.navigate', { url: browserConfig.appUrl });

    const state = await session.waitFor(mailboxState, {
      timeout: browserConfig.timeoutMs,
      argument: { listing: SELECTORS.appReady, password: SELECTORS.passwordField },
    });

    if (state.passwordFields > 0 || !state.rendered) {
      throw fail(MESSAGES.SESSION_EXPIRED, 'verify_session');
    }

    return await work(session);
  } finally {
    if (session) await session.close().catch(() => {});
    // Verified and retried inside closeTarget, which reports false rather than
    // throwing when the tab outlived the close. A tab left behind is a tab the
    // operator finds in their window, once per sync — not worth failing a sync
    // that has already done its work, but never worth hiding either.
    if (targetId) {
      const closed = await client.closeTarget(targetId).catch(() => false);
      if (!closed) {
        console.warn(
          `[NICeMail agent] The agent tab (target ${targetId}) would not close. ` +
            'Close it by hand; it is not the tab you signed in on.',
        );
      }
    }
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
