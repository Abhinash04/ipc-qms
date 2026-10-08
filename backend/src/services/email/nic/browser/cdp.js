import browserConfig from '../../../../config/browserConfig.js';

const POLL_MS = 250;

const MIN_POLL_MS = 1000;

const OPEN = 1;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function waitTimeout(message) {
  return Object.assign(new Error(message), { stage: 'ui', waitTimedOut: true });
}

export const isWaitTimeout = (error) => Boolean(error?.waitTimedOut);

const lost = (message) => Object.assign(new Error(message), { sessionLost: true });

export const isSessionLost = (error) => Boolean(error?.sessionLost);

async function webSocketTransport(endpoint, { timeoutMs }) {
  const base = String(endpoint).replace(/\/+$/, '');

  let response;
  try {
    response = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
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

export async function connect(endpoint = browserConfig.cdpEndpoint, options = {}) {
  const { transport = webSocketTransport, timeoutMs = browserConfig.timeoutMs } = options;

  const socket = await transport(endpoint, { timeoutMs });

  try {
    await untilOpen(socket, timeoutMs);
  } catch (error) {
    try {
      socket.close();
    } catch {}
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
      return;
    }

    if (frame.id === undefined) {
      for (const listener of listeners) listener(frame);
      return;
    }

    const entry = pending.get(frame.id);
    if (!entry) return;
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

  function send(method, params = {}, sessionId = null, { timeout = timeoutMs } = {}) {
    if (closedReason) return Promise.reject(lost(closedReason));

    nextId += 1;
    const id = nextId;
    const frame = sessionId ? { id, method, params, sessionId } : { id, method, params };

    return new Promise((resolve, reject) => {
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
        error.adoptedTargetId = adopted;
      }
      throw error;
    }
  }

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

    return appeared.length === 1 ? appeared[0].targetId : null;
  }

  async function closeTarget(targetId, { attempts = 3, checks = 4, every = 150 } = {}) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await send('Target.closeTarget', { targetId }).catch(() => {});
      for (let check = 0; check < checks; check += 1) {
        const targets = await listTargets().catch(() => null);
        if (targets) {
          if (!targets.some((target) => target.targetId === targetId)) return true;
        }
        await sleep(every);
      }
    }
    return false;
  }

  async function attach(targetId) {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

    let detached = false;
    const off = onEvent((frame) => {
      if (frame.method === 'Target.detachedFromTarget' && frame.params?.sessionId === sessionId) detached = true;
      if (frame.method === 'Inspector.targetCrashed' && frame.sessionId === sessionId) detached = true;
    });

    const sessionSend = async (method, params, requestOptions) => {
      if (detached) throw lost('The NICeMail agent tab was closed or crashed.');
      return send(method, params, sessionId, requestOptions);
    };

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

    async function waitFor(fnOrExpression, { timeout = timeoutMs, every = POLL_MS, argument = null, kit = null } = {}) {
      const deadline = Date.now() + timeout;
      const label = typeof fnOrExpression === 'function' ? fnOrExpression.name || 'condition' : String(fnOrExpression);

      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw waitTimeout(`NICeMail did not become ready within ${timeout}ms: ${label.slice(0, 80)}`);
        }

        const value = await evaluate(fnOrExpression, argument, { timeout: Math.max(remaining, MIN_POLL_MS), kit });
        if (value) return value;

        await sleep(Math.min(every, Math.max(deadline - Date.now(), 0)));
      }
    }

    async function close() {
      off();
      if (detached) return;
      detached = true;
      await send('Target.detachFromTarget', { sessionId }).catch(() => {});
    }

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
    } catch {}
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
