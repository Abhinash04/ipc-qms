import browserConfig from '../../../../config/browserConfig.js';

/**
 * The Chrome DevTools Protocol, spoken directly over the global WebSocket.
 *
 * This replaces Playwright's `chromium.connectOverCDP`, which cannot be used
 * from a long-lived server process:
 *
 *   - its connect ends in `_waitForAllPagesToBeInitialized()`, a `Promise.all`
 *     over EVERY page target Chrome exposes. One page still sitting on its
 *     initial empty document never settles, so an unrelated tab in the
 *     operator's window stalls the whole attach;
 *   - its in-process driver keeps the transport and dispatcher alive after the
 *     connect resolves, so nothing short of `browser.close()` lets the process
 *     exit — a detach that is easy to miss on a failure path.
 *
 * Raw CDP has neither problem: it touches only the targets we name, and every
 * request below is bounded by NIC_BROWSER_TIMEOUT_MS. Nothing in this file can
 * wait forever, which is the point of it.
 *
 * No domain is enabled. `Runtime.evaluate`, `Page.navigate`, `Target.*` and
 * `Input.*` all answer on a bare flat session; enabling `Network` or `Log` only
 * buys a flood of events nobody reads.
 */

/** Gap between `waitFor` polls. The mail app routes on the hash and fires no
 *  lifecycle event, so polling the DOM is the only readiness signal there is. */
const POLL_MS = 250;

/**
 * The least time one `waitFor` poll is given to answer, however little of the
 * wait is left. A poll started with only a millisecond or two to spare times
 * out on a perfectly healthy page, and that timeout is indistinguishable from a
 * page that has stopped answering — so an empty folder would read as a failed
 * read. Bounded: a wait can overrun its deadline by at most this much.
 */
const MIN_POLL_MS = 1000;

/** WebSocket.OPEN, by value — an injected transport need not expose the statics. */
const OPEN = 1;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The error `waitFor` throws when ITS OWN deadline passed — the page never
 * reached the state, and nothing else went wrong.
 *
 * Tagged rather than matched on its message, because one caller has to act on
 * exactly this case and on no other: an inbox folder with nothing in it never
 * fills, so the wait ending in a deadline IS "no rows". Every other failure —
 * a discarded agent tab, a page exception, a closed connection — is a failed
 * read, and a caller that cannot tell the two apart reports a broken sync as an
 * empty mailbox.
 */
export function waitTimeout(message) {
  return Object.assign(new Error(message), { stage: 'ui', waitTimedOut: true });
}

export const isWaitTimeout = (error) => Boolean(error?.waitTimedOut);

/**
 * The error for a connection or agent tab that is gone.
 *
 * Tagged for the same reason as `waitTimeout`: the lookups in selectors.js
 * treat a failed page script as "no match", and without the tag a closed tab
 * would be reported as a selector to recalibrate — sending the operator after
 * the wrong fault.
 */
const lost = (message) => Object.assign(new Error(message), { sessionLost: true });

export const isSessionLost = (error) => Boolean(error?.sessionLost);

/**
 * The default transport: ask the endpoint for its browser-level WebSocket, then
 * open it. `/json/version` is the only HTTP call the agent makes.
 */
async function webSocketTransport(endpoint, { timeoutMs }) {
  const base = String(endpoint).replace(/\/+$/, '');

  let response;
  try {
    response = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    // `fetch` reports every network failure as the same "fetch failed", and the
    // cause is where ECONNREFUSED lives — which is what tells "Chrome is not
    // running" apart from "something else is holding the port", the two states
    // attach.js has to report differently.
    const cause = error?.cause?.code || error?.cause?.message || error?.name || '';
    throw new Error(`${error?.message || error}${cause ? `: ${cause}` : ''}`, { cause: error });
  }

  if (!response.ok) throw new Error(`CDP endpoint answered HTTP ${response.status}`);

  const version = await response.json();
  if (!version?.webSocketDebuggerUrl) {
    throw new Error('The CDP endpoint did not advertise a browser WebSocket.');
  }

  return new WebSocket(version.webSocketDebuggerUrl);
}

function untilOpen(socket, timeoutMs) {
  if (socket.readyState === OPEN) return Promise.resolve();

  return new Promise((resolve, reject) => {
    // Deliberately NOT unref'd. An unref'd timer does not hold the event loop
    // open, so in a quiet process — `npm run nic:browser:discover`, which does
    // nothing but this — Node reaches the end of the loop with only this timer
    // left, exits it, and the await above never settles ("Detected unsettled
    // top-level await"). Every path below clears it.
    const timer = setTimeout(() => reject(new Error(`CDP socket did not open within ${timeoutMs}ms`)), timeoutMs);

    const settle = (fn, value) => {
      clearTimeout(timer);
      fn(value);
    };

    socket.addEventListener('open', () => settle(resolve));
    socket.addEventListener('error', (event) =>
      settle(reject, new Error(`CDP socket failed to open: ${event?.error?.message || event?.message || 'error'}`)),
    );
    socket.addEventListener('close', () => settle(reject, new Error('CDP socket closed before it opened')));
  });
}

/**
 * Connect to the browser endpoint.
 *
 * `transport` is the injection seam — `(endpoint, { timeoutMs }) => WebSocket`
 * — so the protocol handling below can be tested without a Chrome or a socket.
 */
export async function connect(endpoint = browserConfig.cdpEndpoint, options = {}) {
  const { transport = webSocketTransport, timeoutMs = browserConfig.timeoutMs } = options;

  const socket = await transport(endpoint, { timeoutMs });

  try {
    await untilOpen(socket, timeoutMs);
  } catch (error) {
    // Nothing escapes a failed connect(), so a socket left open here can never
    // be closed by anyone — and the inbox sync retries every syncTtlMs, so a
    // Chrome that is up but not answering leaks one socket every 30 seconds.
    try {
      socket.close();
    } catch {
      // Best effort: a socket that cannot be closed is already gone.
    }
    throw error;
  }

  const pending = new Map();
  const listeners = new Set();
  let nextId = 0;
  let closedReason = null;

  const fail = (reason) => {
    closedReason = closedReason || reason;
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(lost(reason));
    }
  };

  socket.addEventListener('message', (event) => {
    let frame;
    try {
      frame = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
    } catch {
      return; // Not a protocol frame; there is nothing to route it to.
    }

    if (frame.id === undefined) {
      for (const listener of listeners) listener(frame);
      return;
    }

    const entry = pending.get(frame.id);
    if (!entry) return; // Already timed out; its caller has moved on.
    pending.delete(frame.id);
    clearTimeout(entry.timer);

    if (frame.error) {
      entry.reject(new Error(`CDP ${entry.method} failed: ${frame.error.message || frame.error.code}`));
    } else {
      entry.resolve(frame.result || {});
    }
  });

  socket.addEventListener('close', () => fail('The CDP connection closed.'));
  socket.addEventListener('error', () => fail('The CDP connection failed.'));

  /**
   * One request. Every one of them is bounded: a CDP call that is never
   * answered — a crashed tab, a discarded background tab — used to take the
   * whole inbox sync down with it, and the sync is called from an HTTP request.
   */
  function send(method, params = {}, sessionId = null, { timeout = timeoutMs } = {}) {
    if (closedReason) return Promise.reject(lost(closedReason));

    nextId += 1;
    const id = nextId;
    const frame = sessionId ? { id, method, params, sessionId } : { id, method, params };

    return new Promise((resolve, reject) => {
      // Not unref'd, for the same reason as the handshake timer above: in a
      // process whose only work is this request, an unref'd timer lets Node
      // leave the event loop before the timeout can fire, and the caller's
      // promise never settles at all.
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} did not answer within ${timeout}ms`));
      }, timeout);

      pending.set(id, { resolve, reject, timer, method });

      try {
        socket.send(JSON.stringify(frame));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  function onEvent(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function listTargets() {
    const { targetInfos = [] } = await send('Target.getTargets');
    return targetInfos;
  }

  /**
   * A new tab. `browserContextId` keeps it in the operator's own profile, which
   * is what makes it share the cookies their manual sign-in produced — without
   * it Chrome may open the tab in a fresh, signed-out context.
   *
   * A timed-out create is NOT the same as a tab that was not created. The
   * request is bounded like every other, and a late answer is dropped on the
   * floor (see the message handler above) — but Chrome may well have made the
   * tab anyway. Before this adopted it, the id was simply lost: the caller's
   * `finally` had nothing to close, nothing else knew the tab existed, and it sat
   * in the operator's window for the rest of the session. The inbox sync runs
   * every syncTtlMs, so those accumulated.
   *
   * So: remember what was there, and if the create times out, look for what
   * appeared. Matching on the context and the requested url is enough — the tab
   * is made at `about:blank` and navigated afterwards, and a tab a human opened
   * at exactly `about:blank` in the same profile in that window is worth closing
   * anyway, being indistinguishable from ours.
   */
  async function createTarget(url, { background = true, browserContextId = null } = {}) {
    const params = { url, background };
    if (browserContextId) params.browserContextId = browserContextId;

    const before = await listTargets().catch(() => null);

    try {
      const { targetId } = await send('Target.createTarget', params);
      return targetId;
    } catch (error) {
      const adopted = await adoptCreatedTarget(before, { url, browserContextId });
      if (adopted) {
        // Reported, never swallowed: the caller still gets its error and the
        // send still fails, but the tab now has an owner that will close it.
        error.adoptedTargetId = adopted;
      }
      throw error;
    }
  }

  /** The page target that appeared since `before`, if exactly one did. */
  async function adoptCreatedTarget(before, { url, browserContextId }) {
    if (!Array.isArray(before)) return null;

    const after = await listTargets().catch(() => null);
    if (!after) return null;

    const known = new Set(before.map((target) => target.targetId));
    const appeared = after.filter(
      (target) =>
        target.type === 'page' &&
        !known.has(target.targetId) &&
        target.url === url &&
        (!browserContextId || target.browserContextId === browserContextId),
    );

    // Exactly one, or none: two matches mean something else is opening tabs in
    // this profile, and closing the wrong one is worse than leaving both.
    return appeared.length === 1 ? appeared[0].targetId : null;
  }

  /**
   * Close a tab, and make sure it really closed.
   *
   * Observed live: `Target.closeTarget` answers `{ success: true }` and leaves
   * the tab open when it races a navigation. Without the read-back, a failed
   * teardown litters the operator's window with agent tabs — one per sync.
   */
  async function closeTarget(targetId, { attempts = 3, checks = 4, every = 150 } = {}) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await send('Target.closeTarget', { targetId }).catch(() => {});
      // A tab being torn down stays in the list for a moment; read straight
      // back, every close looked like a failure and the operator was told to
      // close a tab that was already gone.
      for (let check = 0; check < checks; check += 1) {
        const targets = await listTargets().catch(() => null);
        // A read-back that itself failed proves nothing either way. It used to
        // `return false` here, which abandoned every remaining attempt on one
        // bad read and left a tab open that a second try would have closed.
        if (targets) {
          if (!targets.some((target) => target.targetId === targetId)) return true;
        }
        await sleep(every);
      }
    }
    return false;
  }

  /** Attach a flat session to one target. Only the named target is touched. */
  async function attach(targetId) {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

    let detached = false;
    // A hidden tab can be discarded by Chrome's memory saver mid-run. Noticing
    // gives the caller "the agent tab was closed" instead of a timeout per call.
    const off = onEvent((frame) => {
      if (frame.method === 'Target.detachedFromTarget' && frame.params?.sessionId === sessionId) detached = true;
      if (frame.method === 'Inspector.targetCrashed' && frame.sessionId === sessionId) detached = true;
    });

    const sessionSend = async (method, params, requestOptions) => {
      if (detached) throw lost('The NICeMail agent tab was closed or crashed.');
      return send(method, params, sessionId, requestOptions);
    };

    /**
     * Evaluate in the page. A function is serialised with its argument, so page
     * code can be written as a function here rather than as a string.
     *
     * An exception is raised rather than returned: a silent `undefined` is
     * indistinguishable from "not ready yet", which reads as a hang to every
     * caller that polls.
     *
     * `kit` is a second self-contained function whose result is passed to `fn`
     * as its second argument — the shared page-side resolver (pageKit.js). It
     * is built inside the same expression on every call, so nothing is ever
     * left behind on the page's globals.
     */
    async function evaluate(fnOrExpression, argument = null, requestOptions = {}) {
      const { kit, ...sendOptions } = requestOptions;
      const expression =
        typeof fnOrExpression === 'function'
          ? `(${fnOrExpression.toString()})(${JSON.stringify(argument)}${kit ? `, (${kit.toString()})()` : ''})`
          : String(fnOrExpression);

      const result = await sessionSend(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        sendOptions,
      );

      if (result.exceptionDetails) {
        const detail =
          result.exceptionDetails.exception?.description ||
          result.exceptionDetails.exception?.value ||
          result.exceptionDetails.text;
        throw Object.assign(new Error(`NICeMail page script failed: ${detail}`), { stage: 'ui' });
      }

      return result.result?.value;
    }

    /**
     * Poll an expression until it is truthy.
     *
     * Not a lifecycle event: the mail app's `load` fires well over a second
     * before the message list exists, and its hash routes fire no lifecycle
     * event at all. What is on the page is the only honest signal.
     */
    async function waitFor(fnOrExpression, { timeout = timeoutMs, every = POLL_MS, argument = null, kit = null } = {}) {
      const deadline = Date.now() + timeout;
      const label = typeof fnOrExpression === 'function' ? fnOrExpression.name || 'condition' : String(fnOrExpression);

      for (;;) {
        // The deadline is checked BEFORE polling, so the wait ends in its own
        // tagged timeout rather than in a doomed last poll.
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw waitTimeout(`NICeMail did not become ready within ${timeout}ms: ${label.slice(0, 80)}`);
        }

        // The wait's own deadline bounds each poll. Without it the evaluate
        // falls back to the request timeout — 20s by default — so a 3s wait on
        // a page that has stopped answering blocks for the whole 20s, once per
        // poll, inside a sync that is called from an HTTP request. A poll that
        // does run out is a page not answering, and is rethrown as such.
        const value = await evaluate(fnOrExpression, argument, { timeout: Math.max(remaining, MIN_POLL_MS), kit });
        if (value) return value;

        await sleep(Math.min(every, Math.max(deadline - Date.now(), 0)));
      }
    }

    /** Detach the session. The tab itself is closed with `closeTarget`. */
    async function close() {
      off();
      if (detached) return;
      detached = true;
      await send('Target.detachFromTarget', { sessionId }).catch(() => {});
    }

    /** Events this session's target raises — e.g. `Page.fileChooserOpened`. Returns the unsubscribe. */
    const on = (method, listener) =>
      onEvent((frame) => {
        if (frame.sessionId === sessionId && frame.method === method) listener(frame.params || {});
      });

    return { targetId, sessionId, send: sessionSend, evaluate, waitFor, on, close };
  }

  async function disconnect() {
    fail('The CDP connection was closed by the agent.');
    try {
      socket.close();
    } catch {
      // Best effort: a socket that cannot be closed is already gone.
    }
  }

  return {
    send,
    onEvent,
    listTargets,
    createTarget,
    closeTarget,
    attach,
    disconnect,
    isConnected: () => !closedReason && socket.readyState === OPEN,
  };
}

export { webSocketTransport };
