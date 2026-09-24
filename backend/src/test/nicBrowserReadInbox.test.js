import { describe, it, expect, afterEach, vi } from 'vitest';

import env from '../config/env.js';
import { SELECTORS } from '../services/email/nic/browser/selectors.js';
import { waitTimeout } from '../services/email/nic/browser/cdp.js';
import {
  extractOpenMessage,
  inboxView,
  listRows,
  openMessage as openById,
  parseReceivedAt,
  parseSize,
  readInbox,
  toMessage,
} from '../services/email/nic/browser/readInbox.js';

const agent = vi.hoisted(() => ({ session: null, queued: 0 }));

vi.mock('../services/email/nic/browser/session.js', () => ({
  withNicemail: async (work) => work(agent.session),
  pending: () => agent.queued,
}));

function element({ id = '', classes = [], attrs = {}, text = '', html, href = null, children = {} } = {}) {
  return {
    id,
    href,
    textContent: text,
    innerText: text,
    innerHTML: html ?? text,
    classList: { contains: (name) => classes.includes(name) },
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    querySelector: (selector) => (children[selector] || [])[0] || null,
    querySelectorAll: (selector) => children[selector] || [],
  };
}

const MESSAGE_ID = '1789731183817027200';
const MESSAGE_SELECTOR = SELECTORS.previewMessageById(MESSAGE_ID);

const senderNodes = (address, name) => [
  element({ attrs: { 'data-eid': address }, classes: ['jsCollDisp'], text: address }),
  element({ attrs: { 'data-eid': address }, classes: ['jsExedDisp'], text: `${name} <${address}>` }),
];

const headerRow = (label, addresses) =>
  element({
    children: {
      [SELECTORS.hdrRowLabel]: [element({ text: label })],
      [SELECTORS.hdrRowData]: [
        element({
          children: {
            '[data-eid]': addresses.flatMap((address) => [
              element({ attrs: { 'data-eid': address } }),
              element({ attrs: { 'data-eid': address } }),
            ]),
          },
        }),
      ],
    },
  });

function openMessage({
  address = 'anita.rao@example.invalid',
  name = 'Anita Rao',
  to = ['contact.ecoclubs-edu@gov.in'],
  cc = null,
  bcc = null,
  timestamp = 'Mon, 21 Sep 2026 11:19:09 AM +0530',
  shortTime = '11:19 AM',
  body = 'Placeholder enquiry body.',
  html,
} = {}) {
  const rows = [headerRow('To', to)];
  if (cc) rows.push(headerRow('Cc', cc));
  if (bcc) rows.push(headerRow('Bcc', bcc));
  rows.push(headerRow('Security', []));

  return element({
    id: `zm_Container_m${MESSAGE_ID}`,
    children: {
      [SELECTORS.senderAddr]: senderNodes(address, name),
      [SELECTORS.recipientAddr]: to.map((entry) => element({ attrs: { 'data-eid': entry } })),
      [SELECTORS.hdrRow]: rows,
      [SELECTORS.fullTimestamp]: timestamp ? [element({ text: timestamp })] : [],
      [SELECTORS.shortTime]: [element({ text: shortTime })],
      [SELECTORS.body]: [element({ text: body, html })],
    },
  });
}

const listRow = ({ id, subject, senderAddress, senderName, unread = true, cells = {} }) =>
  element({
    id,
    classes: unread ? [SELECTORS.rowUnreadClass] : [],
    children: {
      [SELECTORS.listRowSubject]: [element({ text: subject })],
      [SELECTORS.listRowSender]: [element({ attrs: { title: senderAddress }, text: senderName })],
      ...cells,
    },
  });

const withDocument = (children) => {
  globalThis.document = element({ children });
};

afterEach(() => {
  delete globalThis.document;
  agent.session = null;
  agent.queued = 1;
  vi.restoreAllMocks();
});

describe('reading the message list', () => {
  it('strips the t-prefix the open row carries, so ids match across the read', () => {
    withDocument({
      [SELECTORS.listRow]: [
        listRow({ id: `t${MESSAGE_ID}`, subject: 'Query about labelling', senderAddress: 'a@example.invalid' }),
      ],
    });

    expect(listRows(SELECTORS)[0].providerMessageId).toBe(MESSAGE_ID);
  });

  it('reads unread state from the row class, never from the envelope control', () => {
    withDocument({
      [SELECTORS.listRow]: [
        listRow({ id: MESSAGE_ID, subject: 'One', senderAddress: 'a@example.invalid' }),
        listRow({ id: '1789731183817027201', subject: 'Two', senderAddress: 'b@example.invalid', unread: false }),
      ],
    });

    expect(listRows(SELECTORS).map((row) => row.unread)).toEqual([true, false]);
  });

  it('drops a row whose id is not a Zoho message id, rather than storing it as one', () => {
    withDocument({
      [SELECTORS.listRow]: [
        listRow({ id: 'zmAdBanner', subject: 'Not a message', senderAddress: '' }),
        listRow({ id: MESSAGE_ID, subject: 'Real', senderAddress: 'a@example.invalid' }),
      ],
    });

    expect(listRows(SELECTORS).map((row) => row.providerMessageId)).toEqual([MESSAGE_ID]);
  });

  it('takes the sender address from the title attribute and the name from the text', () => {
    withDocument({
      [SELECTORS.listRow]: [
        listRow({
          id: MESSAGE_ID,
          subject: 'Query about labelling',
          senderAddress: 'anita.rao@example.invalid',
          senderName: 'Anita Rao',
        }),
      ],
    });

    expect(listRows(SELECTORS)[0]).toMatchObject({
      senderAddress: 'anita.rao@example.invalid',
      senderName: 'Anita Rao',
      subject: 'Query about labelling',
    });
  });

  it('reads the date the list shows once, though the cell renders it twice, with the size and thread count', () => {
    withDocument({
      [SELECTORS.listRow]: [
        listRow({
          id: MESSAGE_ID,
          subject: 'Query about labelling',
          senderAddress: 'a@example.invalid',
          cells: {
            [SELECTORS.listRowDate]: [element({ text: '2:40 PM  2:40 PM' })],
            [SELECTORS.listRowSize]: [element({ text: '4 KB' })],
            [SELECTORS.listRowThread]: [element({ text: '3' })],
          },
        }),
        listRow({ id: '1789731183817027201', subject: 'Two', senderAddress: 'b@example.invalid' }),
      ],
    });

    const [first, second] = listRows(SELECTORS);

    expect(first).toMatchObject({ listDate: '2:40 PM', sizeText: '4 KB', threadCount: 3, hasAttachment: false });
    expect(second).toMatchObject({ listDate: '', sizeText: '', threadCount: null });
  });

  it('flags a row that shows an attachment icon', () => {
    withDocument({
      [SELECTORS.listRow]: [
        listRow({
          id: MESSAGE_ID,
          subject: 'With a file',
          senderAddress: 'a@example.invalid',
          cells: { [SELECTORS.listRowAttachment]: [element()] },
        }),
      ],
    });

    expect(listRows(SELECTORS)[0].hasAttachment).toBe(true);
  });
});

describe('reading the open message', () => {
  it('counts the collapsed and expanded copies of an address once', () => {
    withDocument({ [MESSAGE_SELECTOR]: [openMessage()] });

    const extracted = extractOpenMessage({ sel: SELECTORS, messageSelector: MESSAGE_SELECTOR });

    expect(extracted.fromAddress).toBe('anita.rao@example.invalid');
    expect(extracted.fromName).toBe('Anita Rao');
    expect(extracted.to).toEqual(['contact.ecoclubs-edu@gov.in']);
  });

  it('reads the labelled To row, and leaves Cc empty when Zoho omits the row', () => {
    withDocument({ [MESSAGE_SELECTOR]: [openMessage()] });

    expect(extractOpenMessage({ sel: SELECTORS, messageSelector: MESSAGE_SELECTOR }).cc).toEqual([]);
  });

  it('reads a Cc when the row is there', () => {
    withDocument({ [MESSAGE_SELECTOR]: [openMessage({ cc: ['clerk@example.invalid'] })] });

    expect(extractOpenMessage({ sel: SELECTORS, messageSelector: MESSAGE_SELECTOR }).cc).toEqual(['clerk@example.invalid']);
  });

  it('prefers the fully qualified timestamp over the time-only one', () => {
    withDocument({ [MESSAGE_SELECTOR]: [openMessage()] });

    expect(extractOpenMessage({ sel: SELECTORS, messageSelector: MESSAGE_SELECTOR }).timestampText).toBe('Mon, 21 Sep 2026 11:19:09 AM +0530');
  });

  it('falls back to the short time when there is no qualified one', () => {
    withDocument({ [MESSAGE_SELECTOR]: [openMessage({ timestamp: null })] });

    expect(extractOpenMessage({ sel: SELECTORS, messageSelector: MESSAGE_SELECTOR }).timestampText).toBe('11:19 AM');
  });

  it('reads the container that has the body, not the first one with the id', () => {
    const stub = element({ id: `zm_Container_m${MESSAGE_ID}` });
    withDocument({ [MESSAGE_SELECTOR]: [stub, openMessage({ body: 'Placeholder enquiry body.' })] });

    expect(extractOpenMessage({ sel: SELECTORS, messageSelector: MESSAGE_SELECTOR }).body).toBe(
      'Placeholder enquiry body.',
    );
  });

  it('reports nothing at all when no message is open', () => {
    withDocument({});

    expect(extractOpenMessage({ sel: SELECTORS, messageSelector: MESSAGE_SELECTOR })).toBeNull();
  });

  it('finds no attachments on a message that has none', () => {
    withDocument({ [MESSAGE_SELECTOR]: [openMessage()] });

    expect(extractOpenMessage({ sel: SELECTORS, messageSelector: MESSAGE_SELECTOR }).attachments).toEqual([]);
  });

  it('reads a Bcc row when the message shows one, and none otherwise', () => {
    withDocument({ [MESSAGE_SELECTOR]: [openMessage({ bcc: ['records@example.invalid'] })] });
    expect(extractOpenMessage({ sel: SELECTORS, messageSelector: MESSAGE_SELECTOR }).bcc).toEqual([
      'records@example.invalid',
    ]);

    withDocument({ [MESSAGE_SELECTOR]: [openMessage()] });
    expect(extractOpenMessage({ sel: SELECTORS, messageSelector: MESSAGE_SELECTOR }).bcc).toEqual([]);
  });

  it('keeps the body HTML, and drops it past the limit rather than cutting a document in half', () => {
    const html = '<p>Placeholder <b>enquiry</b> body.</p>';
    withDocument({ [MESSAGE_SELECTOR]: [openMessage({ html })] });

    expect(extractOpenMessage({ sel: SELECTORS, messageSelector: MESSAGE_SELECTOR }).bodyHtml).toBe(html);
    expect(
      extractOpenMessage({ sel: SELECTORS, messageSelector: MESSAGE_SELECTOR, htmlLimit: html.length - 1 }).bodyHtml,
    ).toBeNull();
  });
});

describe('the timestamp', () => {
  it('parses NICeMail\'s own format, which is RFC 2822 with a 12-hour clock', () => {
    expect(parseReceivedAt('Mon, 21 Sep 2026 11:19:09 AM +0530')).toBe('2026-09-21T05:49:09.000Z');
  });

  it('falls back to now rather than storing an unparseable date', () => {
    const before = Date.now();

    const parsed = Date.parse(parseReceivedAt('11:19 AM'));

    expect(parsed).toBeGreaterThanOrEqual(before);
  });
});

describe('building the stored message', () => {
  const row = {
    providerMessageId: MESSAGE_ID,
    subject: 'Query about labelling',
    senderAddress: 'anita.rao@example.invalid',
    senderName: 'Anita Rao',
  };

  const build = (overrides) => {
    withDocument({ [MESSAGE_SELECTOR]: [openMessage(overrides)] });
    return toMessage(extractOpenMessage({ sel: SELECTORS, messageSelector: MESSAGE_SELECTOR }), row);
  };

  it('builds the "Name <address>" header acceptMessage parses', () => {
    expect(build().from).toBe('Anita Rao <anita.rao@example.invalid>');
  });

  it('falls back to the list row for a display name the message does not show', () => {
    expect(build({ name: '' }).from).toBe('Anita Rao <anita.rao@example.invalid>');
  });

  it('collapses to the bare address when nobody has a name to give', () => {
    withDocument({ [MESSAGE_SELECTOR]: [openMessage({ name: '' })] });

    const built = toMessage(extractOpenMessage({ sel: SELECTORS, messageSelector: MESSAGE_SELECTOR }), { ...row, senderName: 'anita.rao@example.invalid' });

    expect(built.from).toBe('anita.rao@example.invalid');
  });

  it('takes the subject from the list row, because the pane hides its own copy', () => {
    expect(build().subject).toBe('Query about labelling');
  });

  it('keeps the message id the pane reported', () => {
    expect(build().providerMessageId).toBe(MESSAGE_ID);
  });

  it('produces a from with no @ when no address could be read, so the reader can drop it', () => {
    const built = build({ address: '' });

    expect(built.from).not.toContain('@');
  });

  it('leaves attachments to be materialised, not invented', () => {
    expect(build().attachments).toEqual([]);
  });

  it("carries the HTML body, the Bcc and Zoho's unread state through", () => {
    withDocument({ [MESSAGE_SELECTOR]: [openMessage({ html: '<p>Hi</p>', bcc: ['records@example.invalid'] })] });

    const built = toMessage(extractOpenMessage({ sel: SELECTORS, messageSelector: MESSAGE_SELECTOR }), {
      ...row,
      unread: true,
    });

    expect(built).toMatchObject({
      bodyHtml: '<p>Hi</p>',
      bcc: ['records@example.invalid'],
      unread: true,
      providerThreadId: null,
    });
  });

  it("says when the received time is the message's own and when it is only the time of the read", () => {
    expect(build().receivedAtSource).toBe('message');
    expect(build({ timestamp: null }).receivedAtSource).toBe('sync');
  });
});

describe('the semantic view', () => {
  it('describes the inbox as rows addressed by message id', async () => {
    const rows = unreadRows('100000000000001');
    const session = fakeSession({ listRows: () => rows });

    await expect(inboxView(session)).resolves.toEqual({ page: 'inbox', folder: 'Inbox', mailRows: rows });
  });

  it('opens a message by its id and waits for that message, not whatever the pane shows', async () => {
    const opened = [];
    const session = fakeSession({
      openRoute: ({ route }) => opened.push(route),
      elementExists: ({ selector }) => selector === SELECTORS.previewMessageById(MESSAGE_ID),
    });

    await expect(openById(session, MESSAGE_ID)).resolves.toBe(SELECTORS.previewMessageById(MESSAGE_ID));
    expect(opened).toEqual([SELECTORS.messageRoute(MESSAGE_ID)]);
  });

  it('refuses to open anything that is not a message id', async () => {
    await expect(openById(fakeSession(), 'mail_123')).rejects.toMatchObject({ stage: 'ui' });
  });
});

function fakeSession(overrides = {}) {
  const handlers = {
    inboxIsActive: () => true,
    rowCounts: () => ({ options: 1, matched: 1 }),
    listRows: () => [],
    openRoute: () => true,
    elementExists: () => true,
    elementGone: () => true,
    extractOpenMessage: ({ messageSelector }) => ({
      providerMessageId: null,
      fromName: 'Placeholder Sender',
      fromAddress: `sender+${messageSelector.length}@example.test`,
      to: ['mailbox@example.test'],
      fallbackTo: [],
      cc: [],
      body: 'Placeholder body.',
      timestampText: 'Mon, 21 Sep 2026 11:19:09 AM +0530',
      attachments: [],
    }),
    rowIsRead: () => true,
    restorable: () => ({ ok: true }),
    countMatching: () => 1,
    clickOn: () => true,
    readAmong: () => [],
    ...overrides,
  };

  const call = (fn, argument) => {
    const handler = handlers[fn.name];
    if (!handler) throw new Error(`fake session has no handler for ${fn.name}`);
    return handler(argument);
  };

  return {
    evaluate: async (fn, argument) => call(fn, argument),
    waitFor: async (fn, { argument } = {}) => {
      const value = await call(fn, argument);
      if (!value) throw waitTimeout(`${fn.name} never became true`);
      return value;
    },
  };
}

const unreadRows = (...ids) =>
  ids.map((id) => ({ providerMessageId: id, unread: true, subject: `Subject ${id}`, senderName: 'Placeholder Sender' }));

describe('readInbox — what a failed read looks like', () => {
  it('reports a dead agent tab as a failed read, not as an empty inbox', async () => {
    agent.session = fakeSession({
      rowCounts: () => {
        throw new Error('The NICeMail agent tab was closed or crashed.');
      },
    });

    await expect(readInbox()).rejects.toThrow(/closed or crashed/);
  });

  it('still reads an empty folder as an empty inbox', async () => {
    agent.session = fakeSession({ rowCounts: () => null });

    await expect(readInbox()).resolves.toEqual({ messages: [], failures: [], remaining: 0 });
  });

  it('restores every other message when one restore click fails, and names the one it could not', async () => {
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, _ms, ...args) => realSetTimeout(fn, 0, ...args));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const ids = ['100000000000001', '100000000000002', '100000000000003'];
    const failing = ids[1];
    const clicked = [];

    agent.session = fakeSession({
      rowCounts: () => ({ options: 3, matched: 3 }),
      listRows: () => unreadRows(...ids),
      clickOn: ({ spec }) => {
        const id = ids.find((candidate) => JSON.stringify(spec).includes(candidate));
        clicked.push(id);
        return id !== failing;
      },
      readAmong: ({ rows }) => rows.map(([id]) => id).filter((id) => id === failing),
    });

    const { messages } = await readInbox();

    expect(messages.map((message) => message.providerMessageId)).toEqual([...ids].reverse());
    expect(new Set(clicked)).toEqual(new Set(ids));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(failing);
    for (const id of ids.filter((candidate) => candidate !== failing)) {
      expect(warn.mock.calls[0][0]).not.toContain(id);
    }
  });
});

const readRows = (...ids) =>
  ids.map((id) => ({ providerMessageId: id, unread: false, subject: `Subject ${id}`, senderName: 'Placeholder Sender' }));

const id = (n) => String(100000000000000 + n);

function recordingSession(rows, overrides = {}) {
  const opened = [];
  const session = fakeSession({
    rowCounts: () => ({ options: rows.length, matched: rows.length }),
    listRows: () => rows,
    openRoute: ({ route }) => {
      const match = /\/p\/(\d+)$/.exec(route);
      if (match) opened.push(match[1]);
      return true;
    },
    ...overrides,
  });
  return { session, opened };
}

describe('readInbox — which rows it opens', () => {
  it('opens only what is above the deepest stored row, oldest first — never the backlog below it', async () => {
    const rows = readRows(id(9), id(8), id(7), id(6), id(5), id(4), id(3));
    const { session, opened } = recordingSession(rows);
    agent.session = session;

    const result = await readInbox({ skip: new Set([id(7), id(5)]) });

    expect(opened).toEqual([id(6), id(8), id(9)]);
    expect(result).toMatchObject({ failures: [], remaining: 0 });
  });

  it('takes the newest `max` on the first sync, with nothing stored to measure against', async () => {
    const { session, opened } = recordingSession(readRows(id(5), id(4), id(3), id(2)));
    agent.session = session;

    await readInbox({ max: 2 });

    expect(opened).toEqual([id(4), id(5)]);
  });

  it('leaves the newest for the next sync when more is new than it may open', async () => {
    const { session, opened } = recordingSession(readRows(id(9), id(8), id(7), id(1)));
    agent.session = session;

    const result = await readInbox({ max: 2, skip: new Set([id(1)]) });

    expect(opened).toEqual([id(7), id(8)]);
    expect(result.remaining).toBe(1);
  });

  it('stops early when something else is waiting for the browser', async () => {
    const { session, opened } = recordingSession(readRows(id(9), id(8), id(7), id(6)));
    agent.session = session;
    agent.queued = 2;

    const result = await readInbox({ max: 4 });

    expect(opened).toEqual([]);
    expect(result.messages).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('reads the whole batch when it is the only thing using the browser', async () => {
    const { session, opened } = recordingSession(readRows(id(9), id(8)));
    agent.session = session;
    agent.queued = 1;

    await readInbox({ max: 4 });

    expect(opened).toEqual([id(8), id(9)]);
  });

  it('tries a row that failed before again, even below newer stored mail — after the untried ones', async () => {
    const { session, opened } = recordingSession(readRows(id(9), id(8), id(7), id(6)));
    agent.session = session;

    await readInbox({ skip: new Set([id(8), id(6)]), retry: new Set([id(7)]) });

    expect(opened).toEqual([id(9), id(7)]);
  });

  it('looks past a run of bad messages at the oldest end instead of calling the page broken', async () => {
    const bad = [id(2), id(3), id(4)];
    const { session, opened } = recordingSession(readRows(id(6), id(5), id(4), id(3), id(2), id(1)), {
      elementExists: ({ selector }) => !bad.some((candidate) => selector.includes(candidate)),
    });
    agent.session = session;

    const result = await readInbox({ skip: new Set([id(1)]) });

    expect(opened).toEqual([id(2), id(3), id(4), id(6), id(5)]);
    expect(result.messages.map((message) => message.providerMessageId)).toEqual([id(6), id(5)]);
    expect(result.failures.map((failure) => failure.providerMessageId)).toEqual(bad);
  });

  it('treats every loaded row as new when nothing stored is loaded any more', async () => {
    const { session, opened } = recordingSession(readRows(id(9), id(8)));
    agent.session = session;

    await readInbox({ skip: new Set([id(1)]) });

    expect(opened).toEqual([id(8), id(9)]);
  });
});

describe('readInbox — one message at a time', () => {
  it('hands each message over before it opens the next', async () => {
    const events = [];
    const { session } = recordingSession(readRows(id(2), id(1)), {
      openRoute: ({ route }) => events.push(`open ${route.split('/').pop()}`),
    });
    agent.session = session;

    await readInbox({ onMessage: async (message) => events.push(`store ${message.providerMessageId}`) });

    expect(events).toEqual([`open ${id(1)}`, `store ${id(1)}`, `open ${id(2)}`, `store ${id(2)}`]);
  });

  it('stops when a message cannot be stored, and still puts back what it marked read', async () => {
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, _ms, ...args) => realSetTimeout(fn, 0, ...args));
    const readAmong = vi.fn(() => []);
    const { session, opened } = recordingSession(unreadRows(id(2), id(1)), { readAmong });
    agent.session = session;

    await expect(
      readInbox({
        onMessage: async () => {
          throw new Error('MongoDB is not connected');
        },
      }),
    ).rejects.toThrow(/MongoDB/);
    expect(opened).toEqual([id(1)]);
    expect(readAmong).toHaveBeenCalled();
  });

  it('records a message it cannot read and goes on to the next', async () => {
    const { session, opened } = recordingSession(readRows(id(3), id(2), id(1)), {
      elementExists: ({ selector }) => !selector.includes(id(2)),
    });
    agent.session = session;

    const result = await readInbox();

    expect(opened).toEqual([id(1), id(2), id(3)]);
    expect(result.messages.map((message) => message.providerMessageId)).toEqual([id(1), id(3)]);
    expect(result.failures).toEqual([expect.objectContaining({ providerMessageId: id(2), stage: 'ui' })]);
  });

  it('stops when the first three it opens all fail — that is the page, not the mail', async () => {
    const { session, opened } = recordingSession(readRows(id(5), id(4), id(3), id(2), id(1)), {
      elementExists: () => false,
    });
    agent.session = session;

    await expect(readInbox()).rejects.toMatchObject({ stage: 'ui', failures: expect.any(Array) });
    expect(opened).toHaveLength(4);
  });

  it('stops at once when the agent tab is lost', async () => {
    const { session, opened } = recordingSession(readRows(id(2), id(1)), {
      elementExists: () => {
        throw Object.assign(new Error('The NICeMail agent tab was closed or crashed.'), { sessionLost: true });
      },
    });
    agent.session = session;

    await expect(readInbox()).rejects.toThrow(/closed or crashed/);
    expect(opened).toEqual([id(1)]);
  });

  it('downloads nothing for a message with no sender address', async () => {
    const downloads = vi.fn();
    const { session } = recordingSession(readRows(id(2), id(1)), {
      extractOpenMessage: ({ messageSelector }) => ({
        providerMessageId: null,
        fromName: messageSelector.includes(id(2)) ? 'Name Only' : 'Placeholder Sender',
        fromAddress: messageSelector.includes(id(2)) ? '' : 'sender@example.test',
        to: [],
        fallbackTo: [],
        cc: [],
        body: '',
        timestampText: '',
        attachments: messageSelector.includes(id(2)) ? [{ filename: 'a.pdf', href: 'https://example.invalid/a' }] : [],
      }),
      downloadAsBase64: downloads,
    });
    agent.session = session;

    const result = await readInbox();

    expect(result.failures).toEqual([expect.objectContaining({ providerMessageId: id(2), stage: 'no_sender' })]);
    expect(downloads).not.toHaveBeenCalled();
  });
});

describe('attachments', () => {
  const PDF = Buffer.from('%PDF-1.4 placeholder').toString('base64');

  async function readWith(entries, download) {
    const downloads = vi.fn(download);
    const { session } = recordingSession(readRows(id(1)), {
      extractOpenMessage: () => ({
        providerMessageId: null,
        fromName: 'Placeholder Sender',
        fromAddress: 'sender@example.test',
        to: [],
        fallbackTo: [],
        cc: [],
        body: '',
        timestampText: '',
        attachments: entries,
      }),
      downloadAsBase64: downloads,
    });
    agent.session = session;
    const { messages } = await readInbox();
    return { attachments: messages[0].attachments, downloads };
  }

  it('records a type the policy refuses, with the size the message shows, and never fetches it', async () => {
    const { attachments, downloads } = await readWith(
      [{ filename: 'records.xml', href: 'https://example.invalid/att/1', sizeText: '12 KB' }],
      () => ({ base64: PDF }),
    );

    expect(downloads).not.toHaveBeenCalled();
    expect(attachments[0]).toMatchObject({
      filename: 'records.xml',
      size: 12288,
      attachmentId: null,
      materializeError: expect.stringMatching(/unsupported file type/),
    });
  });

  it('does not fetch a file the message already says is over the limit', async () => {
    const { attachments, downloads } = await readWith(
      [{ filename: 'scan.pdf', href: 'https://example.invalid/att/2', sizeText: '4 GB' }],
      () => ({ base64: PDF }),
    );

    expect(downloads).not.toHaveBeenCalled();
    expect(attachments[0].materializeError).toMatch(/limit/);
  });

  it('refuses a file that under-declares its size but arrives oversize', async () => {
    const oversize = Buffer.alloc((env.ATTACHMENT_MAX_FILE_MB + 1) * 1024 * 1024).toString('base64');

    const { attachments, downloads } = await readWith(
      [{ filename: 'sneaky.pdf', href: 'https://example.invalid/att/9', sizeText: '1 KB' }],
      () => ({ base64: oversize }),
    );

    expect(downloads).toHaveBeenCalled();
    expect(attachments[0]).toMatchObject({ attachmentId: null, materializeError: expect.stringMatching(/limit/i) });
  });

  it('saves a supported file, sized by its bytes', async () => {
    const { attachments } = await readWith(
      [{ filename: 'application.pdf', href: 'https://example.invalid/att/3', sizeText: '1 KB' }],
      () => ({ base64: PDF }),
    );

    expect(attachments[0]).toMatchObject({
      filename: 'application.pdf',
      mimeType: 'application/pdf',
      size: Buffer.from(PDF, 'base64').length,
      attachmentId: attachments[0].id,
    });
  });

  it('keeps the others when one fails to download', async () => {
    const { attachments } = await readWith(
      [
        { filename: 'first.pdf', href: 'https://example.invalid/att/4', sizeText: '' },
        { filename: 'second.pdf', href: 'https://example.invalid/att/5', sizeText: '' },
      ],
      ({ url }) => (url.endsWith('/4') ? { error: 'the download answered HTTP 403' } : { base64: PDF }),
    );

    expect(attachments[0]).toMatchObject({ attachmentId: null, materializeError: 'the download answered HTTP 403' });
    expect(attachments[1].attachmentId).toBeTruthy();
  });

  it('stops the whole read when the tab is lost during a download, rather than storing the file as failed', async () => {
    const lost = () => {
      throw Object.assign(new Error('The NICeMail agent tab was closed or crashed.'), { sessionLost: true });
    };

    await expect(
      readWith([{ filename: 'application.pdf', href: 'https://example.invalid/att/6', sizeText: '' }], lost),
    ).rejects.toThrow(/closed or crashed/);
  });

  it('takes the size the message shows after the name, not a figure inside the name', () => {
    const entry = element({
      attrs: { title: 'Q3 2 MB summary.pdf' },
      text: 'Q3 2 MB summary.pdf 180 KB',
      children: { 'a[href]': [element({ href: 'https://example.invalid/att/7' })] },
    });
    withDocument({ [MESSAGE_SELECTOR]: [element({ id: `zm_Container_m${MESSAGE_ID}`, children: { [SELECTORS.body]: [element()], [SELECTORS.attachmentEntry[0]]: [entry] } })] });

    const [attachment] = extractOpenMessage({ sel: SELECTORS, messageSelector: MESSAGE_SELECTOR }).attachments;

    expect(attachment).toMatchObject({ filename: 'Q3 2 MB summary.pdf', sizeText: '180 KB' });
  });

  it('reads the sizes messages show', () => {
    expect(parseSize('2.4 MB')).toBe(Math.round(2.4 * 1024 * 1024));
    expect(parseSize('512 bytes')).toBe(512);
    expect(parseSize('4 KB')).toBe(4096);
    expect(parseSize('')).toBeNull();
  });
});
