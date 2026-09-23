import { describe, it, expect, vi } from 'vitest';

import { connect, isSessionLost, isWaitTimeout } from '../services/email/nic/browser/cdp.js';

function fakeSocket({ respond = () => ({}), open = true, delayMs = 0 } = {}) {
  const listeners = { open: [], message: [], close: [], error: [] };
  const sent = [];

  const emit = (type, event) => listeners[type].forEach((listener) => listener(event));

  const socket = {
    readyState: open ? 1 : 0,
    sent,
    closes: 0,
    addEventListener: (type, listener) => listeners[type].push(listener),
    send: (raw) => {
      const frame = JSON.parse(raw);
      sent.push(frame);
      const answer = () => {
        const result = respond(frame);
        if (result === undefined) return;
        emit('message', { data: JSON.stringify({ id: frame.id, ...result }) });
      };
      if (delayMs) setTimeout(answer, delayMs);
      else queueMicrotask(answer);
    },
    close: () => {
      socket.closes += 1;
      socket.readyState = 3;
      emit('close', {});
    },
    emitEvent: (frame) => emit('message', { data: JSON.stringify(frame) }),
    openNow: () => {
      socket.readyState = 1;
      emit('open', {});
    },
  };

  return socket;
}

const transportFor = (socket) => async () => socket;

function fakeBrowser({ values = [], sessionId = 'S1', delayMs = 0 } = {}) {
  let call = 0;
  return fakeSocket({
    delayMs,
    respond: (frame) => {
      if (frame.method === 'Target.attachToTarget') return { result: { sessionId } };
      if (frame.method === 'Target.getTargets') return { result: { targetInfos: [] } };
      if (frame.method === 'Runtime.evaluate') {
        const value = values[Math.min(call, values.length - 1)];
        call += 1;
        return { result: { result: { value } } };
      }
      return { result: {} };
    },
  });
}

describe('connecting', () => {
  it('waits for the socket to open before sending anything', async () => {
    const socket = fakeSocket({ open: false });
    const client = connect('http://localhost:9222', { transport: transportFor(socket), timeoutMs: 500 });

    socket.openNow();

    await expect(client).resolves.toBeTruthy();
  });

  it('gives up on a socket that never opens, rather than waiting forever', async () => {
    const socket = fakeSocket({ open: false });

    await expect(
      connect('http://localhost:9222', { transport: transportFor(socket), timeoutMs: 30 }),
    ).rejects.toThrow(/did not open within 30ms/);
  });

  it('closes the socket it opened when the handshake fails, rather than leaking one per attach', async () => {
    const socket = fakeSocket({ open: false });

    await expect(
      connect('http://localhost:9222', { transport: transportFor(socket), timeoutMs: 20 }),
    ).rejects.toThrow(/did not open/);
    expect(socket.closes).toBe(1);
  });
});

describe('every request is bounded', () => {
  it('times out a call the browser never answers', async () => {
    const client = await connect('x', { transport: transportFor(fakeSocket({ respond: () => undefined })), timeoutMs: 30 });

    await expect(client.listTargets()).rejects.toThrow(/did not answer within 30ms/);
  });

  it('names the method that timed out, so a stuck sync says where it stuck', async () => {
    const client = await connect('x', { transport: transportFor(fakeSocket({ respond: () => undefined })), timeoutMs: 20 });

    await expect(client.send('Page.navigate', { url: 'about:blank' })).rejects.toThrow(/Page.navigate/);
  });

  it('rejects the outstanding calls when the connection closes', async () => {
    const socket = fakeSocket({ respond: () => undefined });
    const client = await connect('x', { transport: transportFor(socket), timeoutMs: 5000 });

    const pending = client.listTargets();
    socket.close();

    await expect(pending).rejects.toThrow(/connection closed/i);
  });

  it('refuses to send on a connection that is already gone', async () => {
    const socket = fakeSocket();
    const client = await connect('x', { transport: transportFor(socket), timeoutMs: 100 });

    await client.disconnect();

    await expect(client.listTargets()).rejects.toThrow(/closed/i);
    expect(client.isConnected()).toBe(false);
  });
});

describe('protocol errors', () => {
  it('surfaces a CDP error as a failure, not as an empty result', async () => {
    const socket = fakeSocket({
      respond: () => ({ error: { code: -32000, message: 'No target with given id found' } }),
    });
    const client = await connect('x', { transport: transportFor(socket), timeoutMs: 100 });

    await expect(client.attach('T1')).rejects.toThrow(/No target with given id found/);
  });

  it('raises a page exception instead of returning undefined', async () => {
    const socket = fakeSocket({
      respond: (frame) =>
        frame.method === 'Target.attachToTarget'
          ? { result: { sessionId: 'S1' } }
          : {
              result: {
                result: {},
                exceptionDetails: { exception: { description: 'TypeError: x is not a function' } },
              },
            },
    });
    const client = await connect('x', { transport: transportFor(socket), timeoutMs: 100 });
    const session = await client.attach('T1');

    await expect(session.evaluate('boom()')).rejects.toThrow(/TypeError: x is not a function/);
  });
});

describe('a session', () => {
  it('carries the session id on every request it makes', async () => {
    const socket = fakeBrowser({ sessionId: 'SESSION-7' });
    const client = await connect('x', { transport: transportFor(socket), timeoutMs: 100 });
    const session = await client.attach('T1');

    await session.send('Page.navigate', { url: 'about:blank' });

    expect(socket.sent.at(-1)).toMatchObject({ method: 'Page.navigate', sessionId: 'SESSION-7' });
  });

  it('serialises a function with its argument, so page code is written as code', async () => {
    const socket = fakeBrowser({ values: [7] });
    const client = await connect('x', { transport: transportFor(socket), timeoutMs: 100 });
    const session = await client.attach('T1');

    const value = await session.evaluate((n) => n + 1, 6);

    expect(value).toBe(7);
    const sent = socket.sent.at(-1);
    expect(sent.params.expression).toContain('(6)');
    expect(sent.params.returnByValue).toBe(true);
  });

  it('polls until the page is ready, because the app fires no event when it is', async () => {
    const socket = fakeBrowser({ values: [false, false, true] });
    const client = await connect('x', { transport: transportFor(socket), timeoutMs: 1000 });
    const session = await client.attach('T1');

    await expect(session.waitFor('ready', { timeout: 1000, every: 1 })).resolves.toBe(true);
  });

  it('gives up waiting rather than polling for ever', async () => {
    const socket = fakeBrowser({ values: [false] });
    const client = await connect('x', { transport: transportFor(socket), timeoutMs: 1000 });
    const session = await client.attach('T1');

    await expect(session.waitFor('never', { timeout: 20, every: 1 })).rejects.toThrow(/did not become ready/);
  });

  it('ends a wait on a fast page that never gets there in its own tagged timeout', async () => {
    const socket = fakeBrowser({ values: [false], delayMs: 3 });
    const client = await connect('x', { transport: transportFor(socket), timeoutMs: 1000 });
    const session = await client.attach('T1');

    const error = await session.waitFor('never', { timeout: 30, every: 1 }).catch((failure) => failure);

    expect(isWaitTimeout(error)).toBe(true);
  });

  it("bounds each poll by the wait's own deadline, not by the request timeout", async () => {
    const socket = fakeSocket({
      respond: (frame) => (frame.method === 'Target.attachToTarget' ? { result: { sessionId: 'S1' } } : undefined),
    });
    const client = await connect('x', { transport: transportFor(socket), timeoutMs: 5000 });
    const session = await client.attach('T1');

    const started = Date.now();
    const error = await session.waitFor('ready', { timeout: 50, every: 1 }).catch((failure) => failure);

    expect(error.message).toMatch(/did not answer within/);
    expect(isWaitTimeout(error)).toBe(false);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('reports a discarded tab as such, instead of timing out on every call', async () => {
    const socket = fakeBrowser({ sessionId: 'S1' });
    const client = await connect('x', { transport: transportFor(socket), timeoutMs: 100 });
    const session = await client.attach('T1');

    socket.emitEvent({ method: 'Target.detachedFromTarget', params: { sessionId: 'S1' } });

    const error = await session.evaluate('1').catch((failure) => failure);
    expect(error.message).toMatch(/closed or crashed/);
    expect(isSessionLost(error)).toBe(true);
  });

  it('tags the calls a closing connection cuts off as a lost session', async () => {
    const socket = fakeSocket({ respond: () => undefined });
    const client = await connect('x', { transport: transportFor(socket), timeoutMs: 5000 });

    const pending = client.listTargets().catch((failure) => failure);
    socket.close();

    expect(isSessionLost(await pending)).toBe(true);
    expect(isSessionLost(await client.listTargets().catch((failure) => failure))).toBe(true);
  });

  it('passes a page kit as the second argument, built inside the same expression', async () => {
    const socket = fakeBrowser({ values: [7] });
    const client = await connect('x', { transport: transportFor(socket), timeoutMs: 100 });
    const session = await client.attach('T1');
    const kit = () => ({ plusOne: (n) => n + 1 });

    await session.evaluate((n, k) => k.plusOne(n), 6, { kit });

    const { expression } = socket.sent.at(-1).params;
    expect(expression).toBe(`(${((n, k) => k.plusOne(n)).toString()})(6, (${kit.toString()})())`);
    const methods = socket.sent.map((frame) => frame.method);
    expect(methods.filter((method) => method.endsWith('.enable') || method.startsWith('Target.set'))).toEqual([]);
  });
});

describe('closing the agent tab', () => {
  it('verifies the tab really went, because closeTarget can report success and leave it', async () => {
    const open = new Set(['T1']);
    let attempts = 0;

    const socket = fakeSocket({
      respond: (frame) => {
        if (frame.method === 'Target.closeTarget') {
          attempts += 1;
          if (attempts > 1) open.delete('T1');
          return { result: { success: true } };
        }
        return { result: { targetInfos: [...open].map((targetId) => ({ targetId, type: 'page' })) } };
      },
    });

    const client = await connect('x', { transport: transportFor(socket), timeoutMs: 100 });

    await expect(client.closeTarget('T1')).resolves.toBe(true);
    expect(attempts).toBe(2);
  });

  it('opens the agent tab in the operator profile, so it shares the sign-in', async () => {
    const socket = fakeSocket({ respond: () => ({ result: { targetId: 'NEW' } }) });
    const client = await connect('x', { transport: transportFor(socket), timeoutMs: 100 });

    await client.createTarget('about:blank', { background: true, browserContextId: 'CTX-1' });

    expect(socket.sent.at(-1).params).toEqual({
      url: 'about:blank',
      background: true,
      browserContextId: 'CTX-1',
    });
  });
});

describe('what it enables on a target', () => {
  it('enables no domain at all', async () => {
    const socket = fakeBrowser();
    const client = await connect('x', { transport: transportFor(socket), timeoutMs: 100 });
    const session = await client.attach('T1');

    await session.evaluate('1 + 1');
    await session.close();

    const enables = socket.sent.filter((frame) => frame.method.endsWith('.enable'));
    expect(enables).toEqual([]);
  });

  it('touches only the target it was given', async () => {
    const socket = fakeBrowser();
    const client = await connect('x', { transport: transportFor(socket), timeoutMs: 100 });

    await client.attach('T1');

    const touched = socket.sent.map((frame) => frame.method);
    expect(touched).not.toContain('Target.setAutoAttach');
    expect(touched).not.toContain('Target.setDiscoverTargets');
  });
});

describe('the transport seam', () => {
  it('is the only way a socket is opened', async () => {
    const transport = vi.fn(async () => fakeSocket());

    await connect('http://localhost:9222', { transport, timeoutMs: 100 });

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith('http://localhost:9222', { timeoutMs: 100 });
  });
});
