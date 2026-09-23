import browserConfig from '../../../../config/browserConfig.js';
import { attachToNicemail, release, MESSAGES } from './attach.js';
import { connect as cdpConnect } from './cdp.js';
import { SELECTORS } from './selectors.js';

let queue = Promise.resolve();

let queued = 0;

const ourTargets = new Set();

export const agentTargetIds = () => new Set(ourTargets);

export const pending = () => queued;

const fail = (message, stage) => Object.assign(new Error(message), { stage });

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

const mailboxState = ({ listing, password }) => {
  const rendered = document.querySelectorAll(listing).length > 0;
  const passwordFields = document.querySelectorAll(password).length;
  if (!rendered && passwordFields === 0) return null;
  return { rendered, passwordFields, host: location.host };
};

async function withFreshTab(client, browserContextId, work) {
  let targetId = null;
  let session = null;

  try {
    try {
      targetId = await client.createTarget('about:blank', {
        background: true,
        browserContextId,
      });
    } catch (error) {
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

const worthAnotherTab = (error) => error?.stage !== 'verify_session';

async function runExclusive(work, { connect } = {}) {
  const attached = await attachToNicemail({ connect, exclude: ourTargets });
  if (!attached.ok) throw fail(attached.error, attached.stage);

  const { browser, page: operatorPage } = attached.data;
  const { client } = browser;

  try {
    await sweepOurTabs(client);

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

export async function closeAgentTabs({ connect = cdpConnect } = {}) {
  if (ourTargets.size === 0) return;

  let client = null;
  try {
    client = await connect();
    await sweepOurTabs(client);
  } catch {} finally {
    await client?.disconnect?.().catch(() => {});
  }
}

export function withNicemail(work, options = {}) {
  queued += 1;
  const done = () => {
    queued -= 1;
  };

  const run = queue.then(() => runExclusive(work, options));
  queue = run.catch(() => {});
  run.then(done, done);
  return run;
}
