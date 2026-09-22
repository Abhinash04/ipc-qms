import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { diagnose, inspectBrowser, redact } from '../services/email/nic/browser/inspect.js';

/**
 * The inspector against a fake Chrome: every method it sends and every page
 * function it evaluates is recorded, so "read-only" is checked, not assumed.
 *
 * The documents are shaped like the live session: the operator's tab is the
 * Workplace shell with no mail in it, and the mailbox is a cross-origin iframe
 * target inside it.
 */

const SHELL_URL = 'https://workplace.mgovcloud.in/#mail_app/mail/folder/inbox';
const MAIL_URL = 'https://mail.mgovcloud.in/zm/?fromService=wp&token=SESSION-SECRET';

const census = (overrides = {}) => ({
  url: 'https://example.invalid/',
  title: '',
  readyState: 'complete',
  hidden: true,
  elements: 100,
  shadowRoots: 0,
  sameOriginFrames: 0,
  crossOriginFrames: [],
  appReady: 0,
  appReadyLight: 0,
  rows: 0,
  options: 0,
  passwordFields: 0,
  roles: {},
  landmarks: [],
  inventory: [],
  inventoryGroups: 0,
  hashedClasses: { distinct: 0, examples: [] },
  legacyZmClasses: 0,
  rowLike: {},
  ...overrides,
});

const MAILBOX = census({ url: 'https://mail.mgovcloud.in/zm/', appReady: 1, appReadyLight: 1, rows: 3, options: 3 });

/** Every entry resolves by its first strategy unless `registry` says otherwise. */
const resolvedRegistry = (overrides = {}) => ({ entries }) =>
  entries.map(([key]) => ({
    key,
    strategy: 0,
    count: 1,
    rawStrategy: 0,
    rawCount: 1,
    tried: [{ strategy: 0, raw: 1, visible: 1, named: 1, ambiguous: false }],
    sample: null,
    ...overrides[key],
  }));

const ROWS = [
  { providerMessageId: '1789986401216141600', unread: true, subject: 'Query', senderAddress: 'anita.rao@example.invalid' },
];

function fakeChrome({
  targets = [
    { targetId: 'PAGE', type: 'page', url: SHELL_URL, title: 'Inbox - Mail (anita.rao@example.invalid)' },
    { targetId: 'MAIL', type: 'iframe', url: MAIL_URL, title: '', parentId: 'PAGE' },
    { targetId: 'SW', type: 'service_worker', url: 'https://example.invalid/sw.js', title: '' },
  ],
  documents = { PAGE: { census: census({ url: SHELL_URL }) }, MAIL: { census: MAILBOX } },
  registry = {},
  connectError = null,
} = {}) {
  const sent = [];
  const evaluated = [];

  const session = (doc) => ({
    send: async (method) => {
      sent.push(method);
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'F1', url: doc.census?.url } } };
      if (method === 'Accessibility.getFullAXTree') {
        return { nodes: [{ role: { value: 'button' }, name: { value: 'New Mail' } }] };
      }
      return {};
    },
    evaluate: async (fn, argument, options = {}) => {
      sent.push('Runtime.evaluate');
      evaluated.push(`${fn}${options.kit ? options.kit : ''}`);
      const handlers = {
        censusDocument: () => doc.census,
        inboxIsActive: () => true,
        listRows: () => ROWS,
        describeRegistry: resolvedRegistry(registry),
      };
      if (!handlers[fn.name]) throw new Error(`no handler for ${fn.name}`);
      return handlers[fn.name](argument);
    },
    waitFor: async () => true,
    close: async () => sent.push('Target.detachFromTarget'),
  });

  const client = {
    send: async (method) => {
      sent.push(method);
      if (method === 'Browser.getVersion') return { product: 'Chrome/152.0', protocolVersion: '1.3' };
      if (method === 'Target.getBrowserContexts') return { defaultBrowserContextId: 'CTX', browserContextIds: [] };
      return {};
    },
    listTargets: async () => {
      sent.push('Target.getTargets');
      return targets;
    },
    attach: async (targetId) => {
      sent.push('Target.attachToTarget');
      return session(documents[targetId] || { census: census() });
    },
    disconnect: async () => {},
  };

  return {
    sent,
    evaluated,
    session,
    connect: async () => {
      if (connectError) throw connectError;
      return client;
    },
  };
}

const signedIn = async () => ({
  ok: true,
  stage: 'verify_session',
  data: { browser: { isConnected: () => false }, page: { targetId: 'PAGE' }, url: SHELL_URL, title: 'Inbox' },
});

const codes = (report) => report.diagnosis.checks.map((check) => check.code);
const check = (report, code) => report.diagnosis.checks.find((entry) => entry.code === code);

beforeEach(() => {
  vi.stubEnv('NIC_WEBMAIL_URL_PATTERNS', 'mail.gov.in,mgovcloud.in');
  vi.stubEnv('NIC_WEBMAIL_TITLE_PATTERNS', 'mail,inbox,nic');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the live shape: a Workplace shell around a cross-origin mail iframe', () => {
  it('names the iframe that holds the mailbox and says the agent is unaffected', async () => {
    const chrome = fakeChrome();

    const report = await inspectBrowser({ connect: chrome.connect, attach: signedIn });

    expect(report.diagnosis.verdict).toBe('OK');
    expect(check(report, 'MAILBOX_IN_OOPIF')).toMatchObject({ status: 'info' });
    expect(check(report, 'MAILBOX_IN_OOPIF').message).toMatch(/cross-origin iframe/);
    expect(report.documents.find((doc) => doc.targetId === 'MAIL')).toMatchObject({ mailApp: true });
    expect(report.documents.find((doc) => doc.targetId === 'PAGE')).toMatchObject({ mailApp: false });
  });

  it('reports the mail rows as the agent sees them', async () => {
    const report = await inspectBrowser({ connect: fakeChrome().connect, attach: signedIn });

    const mail = report.documents.find((doc) => doc.targetId === 'MAIL');
    expect(mail.inbox).toMatchObject({ page: 'inbox', folder: 'Inbox', total: 1 });
    expect(mail.inbox.mailRows[0].providerMessageId).toBe('1789986401216141600');
  });
});

describe('it only reads', () => {
  const ALLOWED = new Set([
    'Browser.getVersion',
    'Target.getBrowserContexts',
    'Target.getTargets',
    'Target.attachToTarget',
    'Target.detachFromTarget',
    'Runtime.evaluate',
    'Page.getFrameTree',
    'Accessibility.getFullAXTree',
  ]);

  it('sends nothing outside the read-only methods', async () => {
    const chrome = fakeChrome();

    await inspectBrowser({ connect: chrome.connect, attach: signedIn });

    expect(chrome.sent.filter((method) => !ALLOWED.has(method))).toEqual([]);
  });

  it('evaluates no code that writes to the page', async () => {
    const chrome = fakeChrome();

    await inspectBrowser({ connect: chrome.connect, attach: signedIn });

    for (const source of chrome.evaluated) {
      expect(source).not.toMatch(/dispatchEvent|scrollTop|location\.hash\s*=|\.value\s*=(?!=)|\.focus\(/);
    }
  });

  it("opens the agent's own tab only when asked", async () => {
    const chrome = fakeChrome();
    const withSession = vi.fn(async (work) => work(chrome.session({ census: MAILBOX })));

    await inspectBrowser({ connect: chrome.connect, attach: signedIn, withSession });
    expect(withSession).not.toHaveBeenCalled();

    const report = await inspectBrowser({ connect: chrome.connect, attach: signedIn, withSession, agentTab: true });
    expect(withSession).toHaveBeenCalledTimes(1);
    expect(report.documents.at(-1)).toMatchObject({ type: 'agent-tab', mailApp: true });
  });
});

describe('redaction', () => {
  it('masks addresses and drops URL query values by default', async () => {
    const text = JSON.stringify(await inspectBrowser({ connect: fakeChrome().connect, attach: signedIn }));

    expect(text).not.toContain('anita.rao@example.invalid');
    expect(text).toContain('a***@example.invalid');
    expect(text).not.toContain('SESSION-SECRET');
    expect(text).toContain('?fromService&token');
  });

  it('shows addresses when asked, and still never a query value', async () => {
    const text = JSON.stringify(
      await inspectBrowser({ connect: fakeChrome().connect, attach: signedIn, showAddresses: true }),
    );

    expect(text).toContain('anita.rao@example.invalid');
    expect(text).not.toContain('SESSION-SECRET');
  });

  it('masks inside nested values', () => {
    expect(redact({ a: ['x b.c@example.invalid'] })).toEqual({ a: ['x b***@example.invalid'] });
  });
});

describe('the diagnosis names the cause', () => {
  it('Chrome not reachable', async () => {
    const report = await inspectBrowser({
      connect: fakeChrome({ connectError: new Error('connect ECONNREFUSED 127.0.0.1:9222') }).connect,
      attach: signedIn,
    });

    expect(report.diagnosis.verdict).toBe('FAIL');
    expect(codes(report)).toEqual(['NO_CDP']);
  });

  it('no NICeMail tab', async () => {
    const chrome = fakeChrome({ targets: [{ targetId: 'T', type: 'page', url: 'https://example.invalid/', title: 'x' }] });

    const report = await inspectBrowser({ connect: chrome.connect, attach: signedIn });

    expect(check(report, 'NO_TAB')).toMatchObject({ status: 'fail' });
  });

  it('a tab on a sign-in step', async () => {
    const report = await inspectBrowser({
      connect: fakeChrome().connect,
      attach: async () => ({ ok: false, stage: 'verify_session', error: 'not signed in' }),
    });

    expect(check(report, 'NOT_SIGNED_IN')).toMatchObject({ status: 'fail' });
  });

  it('no document showing the mail list', async () => {
    const chrome = fakeChrome({ documents: { PAGE: { census: census() }, MAIL: { census: census() } } });

    const report = await inspectBrowser({ connect: chrome.connect, attach: signedIn });

    expect(check(report, 'NO_MAILBOX')).toMatchObject({ status: 'fail' });
  });

  it('rows on the page that the row selector no longer matches', async () => {
    const chrome = fakeChrome({
      documents: { PAGE: { census: census() }, MAIL: { census: { ...MAILBOX, rows: 0, options: 12 } } },
    });

    const report = await inspectBrowser({ connect: chrome.connect, attach: signedIn });

    expect(check(report, 'SELECTORS_DRIFTED')).toMatchObject({ status: 'fail' });
  });

  it('an expected element missing from the Inbox', async () => {
    const chrome = fakeChrome({
      registry: { folderInbox: { count: 0, rawCount: 0, strategy: null, tried: [{ strategy: 0, raw: 0 }] } },
    });

    const report = await inspectBrowser({ connect: chrome.connect, attach: signedIn });

    expect(check(report, 'SELECTORS_DRIFTED').message).toContain('folderInbox');
  });

  it('a compose control that is there but hidden — the trap the old selector fell into', async () => {
    const chrome = fakeChrome({
      registry: { composeButton: { count: 0, strategy: null, tried: [{ strategy: 0, raw: 1, visible: 0, named: 0 }] } },
    });

    const report = await inspectBrowser({ connect: chrome.connect, attach: signedIn });

    expect(check(report, 'REGISTRY')).toMatchObject({ status: 'warn' });
    expect(check(report, 'REGISTRY').message).toContain('HIDDEN');
  });

  it('a compose control that is visible under the wrong name', async () => {
    const chrome = fakeChrome({
      registry: { composeButton: { count: 0, strategy: null, tried: [{ strategy: 0, raw: 1, visible: 1, named: 0 }] } },
    });

    const report = await inspectBrowser({ connect: chrome.connect, attach: signedIn });

    expect(check(report, 'REGISTRY').message).toContain('NAME_MISMATCH');
  });

  it('a compose form open without one of its controls', async () => {
    const chrome = fakeChrome({
      registry: { sendButton: { count: 0, rawCount: 0, strategy: null, tried: [{ strategy: 0, raw: 0 }] } },
    });

    const report = await inspectBrowser({ connect: chrome.connect, attach: signedIn });

    expect(check(report, 'SELECTORS_DRIFTED')).toMatchObject({ status: 'fail' });
    expect(check(report, 'SELECTORS_DRIFTED').message).toContain('sendButton');
  });

  it('no compose form open: the compose controls are not held against the mailbox', async () => {
    const gone = { count: 0, rawCount: 0, strategy: null, tried: [{ strategy: 0, raw: 0 }] };
    const keys = ['fromAddress', 'toInput', 'ccInput', 'subjectInput', 'bodyEditor', 'fileInput', 'sendButton', 'discardButton'];
    const chrome = fakeChrome({ registry: Object.fromEntries(keys.map((key) => [key, gone])) });

    const report = await inspectBrowser({ connect: chrome.connect, attach: signedIn });

    expect(check(report, 'COMPOSE')).toMatchObject({ status: 'info' });
    expect(codes(report)).not.toContain('SELECTORS_DRIFTED');
  });

  it('a compose form with every control in place', async () => {
    const report = await inspectBrowser({ connect: fakeChrome().connect, attach: signedIn });

    expect(check(report, 'COMPOSE')).toMatchObject({ status: 'ok' });
  });

  it('is a pure function of the report', () => {
    expect(diagnose({ cdp: { error: 'x' }, targets: [], documents: [] })).toMatchObject({ verdict: 'FAIL' });
  });
});
