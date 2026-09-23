import browserConfig from '../../../../config/browserConfig.js';
import { attachToNicemail, release, MESSAGES } from './attach.js';
import { connect as cdpConnect } from './cdp.js';
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

/** How many units are queued or running — read by the inbox sync, see `pending()`. */
let queued = 0;

/**
 * Every tab this process has opened and not yet seen closed.
 *
 * The teardown below is best effort by necessity — it talks to a browser that
 * may already be gone — so "we closed it" and "it is closed" are different
 * facts. This holds the difference. A survivor is closed at the start of the
 * next unit, which is the only moment we are certainly connected and certainly
 * not in the middle of something.
 *
 * Ids only. They are also what keeps the agent from mistaking its own tab for
 * the operator's signed-in one: attach.js excludes them when it picks the tab
 * that proves the session.
 */
const ourTargets = new Set();

/** The agent's own tabs, for attach.js. A copy: callers must not mutate it. */
export const agentTargetIds = () => new Set(ourTargets);

/** Units queued or running. The inbox sync stands aside while this is non-zero. */
export const pending = () => queued;

const fail = (message, stage) => Object.assign(new Error(message), { stage });

/**
 * Close tabs an earlier unit could not.
 *
 * Failure is not reported anywhere: this is opportunistic tidying in front of
 * work that has its own errors to raise, and a tab that will not close now will
 * be tried again next time. An id is forgotten once the browser says it is gone
 * — or once it is no longer listed at all, which means somebody closed it by
 * hand.
 */
async function sweepOurTabs(client) {
  if (ourTargets.size === 0) return;

  const targets = await client.listTargets().catch(() => null);
  const live = targets ? new Set(targets.map((target) => target.targetId)) : null;

  for (const targetId of [...ourTargets]) {
    if (live && !live.has(targetId)) {
      ourTargets.delete(targetId);
      continue;
    }
    const closed = await client.closeTarget(targetId).catch(() => false);
    if (closed) ourTargets.delete(targetId);
  }
}

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

/**
 * Open a tab on the mailbox and hand it to `work`.
 *
 * Split out of runExclusive so the setup can be retried once without the work
 * ever being retried — see the caller. Everything it opens is registered in
 * `ourTargets` before it can be lost.
 */
async function withFreshTab(client, browserContextId, work) {
  let targetId = null;
  let session = null;

  try {
    // about:blank, then navigate — the sequence that was measured end to end.
    // Creating the tab straight onto the app races its own first navigation,
    // and a Target.closeTarget issued into that race reports success on a tab
    // that stays open.
    try {
      targetId = await client.createTarget('about:blank', {
        background: true,
        browserContextId,
      });
    } catch (error) {
      // The create timed out but Chrome may have made the tab anyway; cdp.js
      // looks for it and hands back the id so it does not become an orphan.
      if (error?.adoptedTargetId) ourTargets.add(error.adoptedTargetId);
      throw error;
    }
    ourTargets.add(targetId);

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
    // that has already done its work, but never worth hiding either. It stays
    // in `ourTargets` so the next unit tries again.
    if (targetId) {
      const closed = await client.closeTarget(targetId).catch(() => false);
      if (closed) ourTargets.delete(targetId);
      else {
        console.warn(
          `[NICeMail agent] The agent tab (target ${targetId}) would not close. ` +
            'It will be closed before the next NICeMail operation.',
        );
      }
    }
  }
}

/**
 * Is a second tab worth trying?
 *
 * Only for a tab that never became usable, and never for a genuinely signed-out
 * session: a visible password field means the operator has to act, and spending
 * another twenty seconds proving it again helps nobody.
 *
 * Deliberately NOT keyed on the error's tags. The failure this exists for — the
 * discarded background tab — surfaces as a plain `CDP Runtime.evaluate did not
 * answer within Nms` from the request timeout, which carries no tag at all. What
 * makes the retry safe is not the shape of the error but *when* it happened: see
 * `entered` in the caller.
 */
const worthAnotherTab = (error) => error?.stage !== 'verify_session';

async function runExclusive(work, { connect } = {}) {
  const attached = await attachToNicemail({ connect, exclude: ourTargets });
  if (!attached.ok) throw fail(attached.error, attached.stage);

  const { browser, page: operatorPage } = attached.data;
  const { client } = browser;

  try {
    // Anything a previous unit could not close, before this one opens its own.
    // Chrome discards hidden background tabs, and a discarded tab answers CDP
    // exactly as a healthy one does until an evaluate silently never returns.
    await sweepOurTabs(client);

    /**
     * Set the instant the work is entered — before it can touch the page, and
     * so before it can possibly have pressed Send.
     *
     * This is the whole safety of the retry below. It is not "did the work
     * succeed" but "was the work started at all": a send that failed halfway
     * must never be attempted again here, because from `click_send` onwards the
     * message may already have gone. Only the setup — open a tab, load the
     * mailbox — is ever repeated, and that sends nothing.
     */
    let entered = false;
    const guarded = (session) => {
      entered = true;
      return work(session);
    };

    try {
      return await withFreshTab(client, operatorPage.browserContextId, guarded);
    } catch (error) {
      if (entered || !worthAnotherTab(error)) throw error;

      console.warn(
        `[NICeMail agent] The agent tab never became usable (${error.message}). ` +
          'Closing it and trying once more with a fresh tab.',
      );
      await sweepOurTabs(client);
      return await withFreshTab(client, operatorPage.browserContextId, guarded);
    }
  } finally {
    await release(browser);
  }
}

/**
 * Close any tab this process still owns. Called on the way out.
 *
 * Without it a restart — a deploy, a crash, Ctrl-C — orphans whatever tab was
 * open at the time, and nothing afterwards knows it exists. Connects directly
 * rather than through `attachToNicemail`, because cleaning up must not depend on
 * the operator still having a NICeMail tab open.
 *
 * Best effort and bounded by the CDP timeout: a browser that has already gone
 * took its tabs with it, which is the outcome we wanted anyway.
 */
export async function closeAgentTabs({ connect = cdpConnect } = {}) {
  if (ourTargets.size === 0) return;

  let client = null;
  try {
    client = await connect();
    await sweepOurTabs(client);
  } catch {
    // Nothing to report to: the process is on its way out.
  } finally {
    await client?.disconnect?.().catch(() => {});
  }
}

/** `connect` is the test seam, passed through to attachToNicemail. */
export function withNicemail(work, options = {}) {
  // Counted around the whole wait, not just the run: a unit sitting in the
  // queue is exactly what the inbox sync should stand aside for.
  queued += 1;
  const done = () => {
    queued -= 1;
  };

  const run = queue.then(() => runExclusive(work, options));
  // The queue must survive a failed run, or one error would block every later call.
  queue = run.catch(() => {});
  run.then(done, done);
  return run;
}
