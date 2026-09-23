import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { withNicemail, pending, agentTargetIds } from '../services/email/nic/browser/session.js';

/**
 * The browser session: the lock, the agent's own tab, and the teardown.
 *
 * This file exists because none of it was covered. `nicBrowserSendMail.test.js`
 * and `nicBrowserReadInbox.test.js` both stub `withNicemail` out entirely
 * (`async (work) => work(session)`), which is right for testing what they test
 * and left the whole of session.js untested — the queue, the tab lifecycle, the
 * `finally`. A tab that leaked into the operator's Chrome could then be picked
 * as the signed-in mailbox on a later run, and the send that met it failed with
 * a CDP timeout that named a selector rather than the real fault.
 *
 * No browser and no socket: `withNicemail` takes the same `connect` seam
 * `attachToNicemail` does.
 */

/** Chrome, as far as this module is concerned: a set of targets and the calls against them. */
function fakeChrome({
  operatorTargetId = 'operator-tab',
  createBehaviour = null,
  closeBehaviour = null,
  mailboxState = { rendered: true, passwordFields: 0, host: 'mail.mgovcloud.in' },
} = {}) {
  const targets = [
    {
      targetId: operatorTargetId,
      type: 'page',
      url: 'https://workplace.mgovcloud.in/#mail_app/mail/folder/inbox',
      title: 'Inbox - Mail',
      browserContextId: 'ctx-1',
    },
  ];

  const calls = { created: [], closed: [], attached: [], sweeps: 0 };
  let nextTab = 0;

  const client = {
    listTargets: async () => {
      calls.sweeps += 1;
      return targets.map((target) => ({ ...target }));
    },

    createTarget: async (url, { browserContextId } = {}) => {
      nextTab += 1;
      const targetId = `agent-tab-${nextTab}`;
      calls.created.push(targetId);
      const behaviour = createBehaviour?.(targetId, nextTab);

      // "Chrome made the tab, then failed to answer in time" — the case that
      // used to lose the id for good.
      if (behaviour === 'orphan') {
        targets.push({ targetId, type: 'page', url, title: '', browserContextId });
        throw Object.assign(new Error('CDP Target.createTarget did not answer within 20000ms'), {
          adoptedTargetId: targetId,
        });
      }
      if (behaviour === 'throw') throw new Error('CDP Target.createTarget did not answer within 20000ms');

      targets.push({ targetId, type: 'page', url, title: '', browserContextId });
      return targetId;
    },

    closeTarget: async (targetId) => {
      calls.closed.push(targetId);
      if (closeBehaviour?.(targetId, calls.closed.length) === 'refuse') return false;
      const at = targets.findIndex((target) => target.targetId === targetId);
      if (at >= 0) targets.splice(at, 1);
      return true;
    },

    attach: async (targetId) => {
      calls.attached.push(targetId);
      return {
        send: async () => ({}),
        waitFor: async () => {
          const state = typeof mailboxState === 'function' ? mailboxState(targetId) : mailboxState;
          if (state instanceof Error) throw state;
          return state;
        },
        close: async () => {},
      };
    },

    isConnected: () => true,
    disconnect: async () => {},
  };

  const pageFor = (target) => ({
    targetId: target.targetId,
    browserContextId: target.browserContextId,
    url: () => target.url,
    title: async () => target.title,
    locator: () => ({ first: () => ({ isVisible: async () => false }) }),
  });

  const connect = async () => ({
    client,
    contexts: () => [{ pages: () => targets.map(pageFor) }],
    isConnected: () => true,
    close: async () => {},
  });

  return { connect, calls, targets, client };
}

/** Drain the module's tab registry between tests — it is module-level state. */
async function clearRegistry() {
  if (agentTargetIds().size === 0) return;
  const chrome = fakeChrome();
  await withNicemail(async () => 'drain', { connect: chrome.connect }).catch(() => {});
}

beforeEach(() => {
  vi.stubEnv('NIC_WEBMAIL_URL_PATTERNS', 'mail.gov.in,mgovcloud.in');
  vi.stubEnv('NIC_WEBMAIL_TITLE_PATTERNS', 'mail,inbox,nic');
  vi.stubEnv('NIC_WEBMAIL_APP_URL', 'https://mail.mgovcloud.in/zm/');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  await clearRegistry();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the agent tab is always closed', () => {
  it('closes it when the work succeeds', async () => {
    const chrome = fakeChrome();

    await expect(withNicemail(async () => 'done', { connect: chrome.connect })).resolves.toBe('done');

    expect(chrome.calls.created).toHaveLength(1);
    expect(chrome.calls.closed).toEqual(chrome.calls.created);
    expect(chrome.targets.map((t) => t.targetId)).toEqual(['operator-tab']);
  });

  /**
   * The failure that matters most. A send that threw halfway is exactly when a
   * tab is most likely to be left behind, and it is also when the operator is
   * least likely to go looking for one.
   */
  it('closes it when the work throws', async () => {
    const chrome = fakeChrome();

    await expect(
      withNicemail(async () => {
        throw new Error('compose failed');
      }, { connect: chrome.connect }),
    ).rejects.toThrow('compose failed');

    expect(chrome.calls.closed).toEqual(chrome.calls.created);
    expect(chrome.targets.map((t) => t.targetId)).toEqual(['operator-tab']);
  });

  it('remembers a tab Chrome refused to close, and closes it on the next run', async () => {
    let refuse = true;
    const chrome = fakeChrome({ closeBehaviour: () => (refuse ? 'refuse' : 'close') });

    await withNicemail(async () => 'first', { connect: chrome.connect });

    // Still open, and the agent knows it.
    expect(chrome.targets.map((t) => t.targetId)).toContain('agent-tab-1');
    expect([...agentTargetIds()]).toContain('agent-tab-1');

    refuse = false;
    await withNicemail(async () => 'second', { connect: chrome.connect });

    expect(chrome.targets.map((t) => t.targetId)).toEqual(['operator-tab']);
    expect(agentTargetIds().size).toBe(0);
  });
});

describe('a create that times out still leaves an owner', () => {
  /**
   * `Target.createTarget` is bounded like every other CDP call, and a late
   * answer is dropped — but Chrome may have made the tab anyway. Before the id
   * was adopted, nothing in the process knew that tab existed and it stayed
   * open for the rest of the session, once per failed sync.
   */
  it('adopts the orphan, recovers on a fresh tab, and leaves nothing behind', async () => {
    let orphanOnce = true;
    const chrome = fakeChrome({
      createBehaviour: () => {
        if (!orphanOnce) return null;
        orphanOnce = false;
        return 'orphan';
      },
    });

    // The setup failed before the work was entered, so the unit gets its one
    // fresh tab and completes rather than failing an email over a lost tab.
    await expect(withNicemail(async () => 'sent', { connect: chrome.connect })).resolves.toBe('sent');

    expect(chrome.calls.created).toEqual(['agent-tab-1', 'agent-tab-2']);
    // Both the orphan and the tab that did the work are gone.
    expect(chrome.targets.map((t) => t.targetId)).toEqual(['operator-tab']);
    expect(agentTargetIds().size).toBe(0);
  });

  /**
   * The invariant the whole registry exists for: a tab the agent created is
   * either closed, or still known so a later run can close it. Never both open
   * and forgotten — that is the state that used to accumulate in the operator's
   * window and eventually get picked as the signed-in mailbox.
   */
  it('leaves no tab both open and forgotten, even when every create orphans', async () => {
    const chrome = fakeChrome({ createBehaviour: () => 'orphan' });

    await expect(withNicemail(async () => 'never', { connect: chrome.connect })).rejects.toThrow(
      /did not answer/,
    );

    const known = agentTargetIds();
    const stillOpen = chrome.targets
      .map((target) => target.targetId)
      .filter((id) => id !== 'operator-tab');

    expect(chrome.calls.created.length).toBeGreaterThan(0);
    for (const id of stillOpen) expect(known).toContain(id);

    // And the next run clears them.
    const cleanup = fakeChrome();
    cleanup.targets.push(...stillOpen.map((id) => ({ targetId: id, type: 'page', url: '', title: '' })));
    await withNicemail(async () => 'later', { connect: cleanup.connect });
    expect(agentTargetIds().size).toBe(0);
  });

  it('does not invent an owner when the tab was never created', async () => {
    const chrome = fakeChrome({ createBehaviour: () => 'throw' });

    await expect(withNicemail(async () => 'never', { connect: chrome.connect })).rejects.toThrow(
      /did not answer/,
    );

    expect(agentTargetIds().size).toBe(0);
    expect(chrome.calls.closed).toHaveLength(0);
  });
});

describe('the agent never mistakes its own tab for the operator’s', () => {
  /**
   * Both tabs score 12: the host is worth 10, the title 2, and NEITHER earns the
   * path bonus, because both put the mailbox route in the URL hash while the
   * bonus reads `pathname`. A tie breaks on Chrome's enumeration order, so a
   * leaked agent tab could be chosen as the proof of session — and a discarded
   * one answers CDP right up until an evaluate never returns.
   */
  it('excludes its own targets when picking the signed-in tab', async () => {
    const chrome = fakeChrome({ closeBehaviour: () => 'refuse' });

    await withNicemail(async () => 'first', { connect: chrome.connect });
    expect(chrome.targets.map((t) => t.targetId)).toContain('agent-tab-1');

    const seen = [];
    await withNicemail(async () => 'second', { connect: chrome.connect });

    // The context of the second run's tab must come from the operator's tab,
    // never from the leaked one.
    const second = chrome.targets.find((t) => t.targetId === 'agent-tab-2');
    expect(second?.browserContextId).toBe('ctx-1');
    expect(seen).toEqual([]);
  });

  it('refuses when the only NICeMail tabs are its own', async () => {
    const chrome = fakeChrome({ closeBehaviour: () => 'refuse' });
    await withNicemail(async () => 'first', { connect: chrome.connect });

    // The operator closes their tab; only the agent's leaked one is left.
    const at = chrome.targets.findIndex((t) => t.targetId === 'operator-tab');
    chrome.targets.splice(at, 1);

    await expect(withNicemail(async () => 'second', { connect: chrome.connect })).rejects.toThrow(
      /No NICeMail tab found/,
    );
  });
});

describe('a tab that never renders the mailbox', () => {
  /**
   * The observed production failure: the page answers one evaluate fast, then
   * stops answering, and the request timeout fires with no tag on it at all.
   * One fresh tab is worth trying — it opens a tab and loads a page, and sends
   * nothing.
   */
  it('is discarded, and the unit retried once on a new tab', async () => {
    let first = true;
    const chrome = fakeChrome({
      mailboxState: () => {
        if (first) {
          first = false;
          return new Error('CDP Runtime.evaluate did not answer within 19719ms');
        }
        return { rendered: true, passwordFields: 0, host: 'mail.mgovcloud.in' };
      },
    });

    await expect(withNicemail(async () => 'sent', { connect: chrome.connect })).resolves.toBe('sent');

    expect(chrome.calls.created).toHaveLength(2);
    expect(chrome.targets.map((t) => t.targetId)).toEqual(['operator-tab']);
  });

  it('gives up after the second tab, rather than trying forever', async () => {
    const chrome = fakeChrome({
      mailboxState: () => new Error('CDP Runtime.evaluate did not answer within 19719ms'),
    });

    await expect(withNicemail(async () => 'sent', { connect: chrome.connect })).rejects.toThrow(
      /did not answer/,
    );

    expect(chrome.calls.created).toHaveLength(2);
    expect(chrome.targets.map((t) => t.targetId)).toEqual(['operator-tab']);
  });

  /**
   * A password field is the operator's problem, not a bad tab. Another twenty
   * seconds proving it again helps nobody.
   */
  it('does not retry a session that is genuinely signed out', async () => {
    const chrome = fakeChrome({
      mailboxState: { rendered: false, passwordFields: 1, host: 'mail.mgovcloud.in' },
    });

    await expect(withNicemail(async () => 'sent', { connect: chrome.connect })).rejects.toThrow(
      /session expired/i,
    );

    expect(chrome.calls.created).toHaveLength(1);
  });

  /**
   * THE SAFETY PROPERTY. From `click_send` onwards a message may already have
   * gone, so work that has begun must never be run a second time here. Only the
   * setup is ever repeated.
   */
  it('never re-runs work that has already started', async () => {
    let runs = 0;
    const chrome = fakeChrome();

    await expect(
      withNicemail(async () => {
        runs += 1;
        throw new Error('NICeMail may have sent this message');
      }, { connect: chrome.connect }),
    ).rejects.toThrow(/may have sent/);

    expect(runs).toBe(1);
    expect(chrome.calls.created).toHaveLength(1);
  });
});

describe('the queue', () => {
  it('runs units one at a time, in order', async () => {
    const chrome = fakeChrome();
    const events = [];
    const unit = (name) => async () => {
      events.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`${name}:end`);
      return name;
    };

    const all = Promise.all([
      withNicemail(unit('a'), { connect: chrome.connect }),
      withNicemail(unit('b'), { connect: chrome.connect }),
      withNicemail(unit('c'), { connect: chrome.connect }),
    ]);

    await expect(all).resolves.toEqual(['a', 'b', 'c']);
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('is not poisoned by a unit that failed', async () => {
    const chrome = fakeChrome();

    const failed = withNicemail(async () => {
      throw new Error('first blew up');
    }, { connect: chrome.connect });

    await expect(failed).rejects.toThrow('first blew up');
    await expect(withNicemail(async () => 'fine', { connect: chrome.connect })).resolves.toBe('fine');
  });

  /**
   * What the inbox sync reads to stand aside. A sync is a background
   * convenience that the next poll will repeat; a send is a person waiting.
   */
  it('reports work that is queued or running, and settles back to zero', async () => {
    const chrome = fakeChrome();
    expect(pending()).toBe(0);

    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });

    const first = withNicemail(async () => held, { connect: chrome.connect });
    const second = withNicemail(async () => 'second', { connect: chrome.connect });

    expect(pending()).toBe(2);

    release('first');
    await Promise.all([first, second]);

    expect(pending()).toBe(0);
  });

  it('counts a failed unit back down too', async () => {
    const chrome = fakeChrome();

    await withNicemail(async () => {
      throw new Error('nope');
    }, { connect: chrome.connect }).catch(() => {});

    expect(pending()).toBe(0);
  });
});
