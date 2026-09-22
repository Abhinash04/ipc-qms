import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';

import { connect } from '../services/email/nic/browser/cdp.js';
import { censusDocument } from '../services/email/nic/browser/inspect.js';
import { pageKit } from '../services/email/nic/browser/pageKit.js';
import { SELECTORS, locate } from '../services/email/nic/browser/selectors.js';
import { formState, openDialogs } from '../services/email/nic/browser/sendMail.js';

/**
 * The page-side resolver against a real DOM.
 *
 * The expressions are built by the real cdp.js and evaluated inside a JSDOM
 * window, the way Chrome evaluates them: as source text, in the page's own
 * realm. Nothing from this module's scope can reach them there, so a page
 * function that leaned on a closure would fail here exactly as it would live.
 *
 * JSDOM does no layout, so every element is given a 10×10 box; "hidden" below
 * always comes from styles or aria-hidden, as it does in the real app.
 */

async function pageSession(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: 'outside-only' });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0, right: 10, bottom: 10, width: 10, height: 10,
  });

  const listeners = { open: [], message: [], close: [], error: [] };
  const socket = {
    readyState: 1,
    addEventListener: (type, listener) => listeners[type].push(listener),
    close: () => {},
    send: (raw) => {
      const frame = JSON.parse(raw);
      let result = {};
      if (frame.method === 'Target.attachToTarget') result = { sessionId: 'S1' };
      if (frame.method === 'Runtime.evaluate') {
        try {
          result = { result: { value: dom.window.eval(frame.params.expression) } };
        } catch (error) {
          result = { result: {}, exceptionDetails: { exception: { description: String(error) } } };
        }
      }
      // Through JSON, as the protocol carries it: a DOM node cannot come back as a value.
      const reply = JSON.stringify({ id: frame.id, result });
      queueMicrotask(() => listeners.message.forEach((listener) => listener({ data: reply })));
    },
  };

  const client = await connect('x', { transport: async () => socket, timeoutMs: 1000 });
  const session = await client.attach('T1');
  return { dom, document: dom.window.document, session };
}

/** How an entry resolves, straight from the kit. */
const resolved = (session, entry) =>
  session.evaluate(
    (spec, kit) => {
      const { strategy, elements, tried, crossOrigin = [] } = kit.resolve(spec);
      return { strategy, count: elements.length, tried, crossOrigin, first: elements[0] ? kit.summary(elements[0]) : null };
    },
    entry,
    { kit: pageKit },
  );

const entry = (strategies, checks = {}) => ({ strategies, ...checks });

describe('role and accessible name', () => {
  it('finds a plain <button> by its role and its text', async () => {
    const { session } = await pageSession('<button data-testid="new-btn-opt">New Mail</button>');

    const result = await resolved(session, entry([{ role: 'button', name: 'New Mail' }]));

    expect(result).toMatchObject({ strategy: 0, count: 1, first: { testid: 'new-btn-opt', name: 'New Mail' } });
  });

  it('takes the name from aria-labelledby, then aria-label, before the content', async () => {
    const { session } = await pageSession(`
      <span id="lbl">Send</span>
      <div role="button" aria-labelledby="lbl" aria-label="Ignored">Also ignored</div>
      <div role="button" aria-label="Pin this email">📌</div>`);

    expect(await resolved(session, entry([{ role: 'button', name: 'Send' }]))).toMatchObject({ count: 1 });
    expect(await resolved(session, entry([{ role: 'button', name: 'Pin this email' }]))).toMatchObject({ count: 1 });
    expect(await resolved(session, entry([{ role: 'button', name: 'Ignored' }]))).toMatchObject({ count: 0 });
  });

  it('names a form control by its <label>, then its placeholder', async () => {
    const { session } = await pageSession(`
      <label for="to">To</label><input id="to" type="text">
      <input type="text" placeholder="Search ( / )">`);

    expect(await resolved(session, entry([{ role: 'textbox', name: 'To' }]))).toMatchObject({ count: 1 });
    expect(await resolved(session, entry([{ role: 'textbox', name: 'Search', match: 'prefix' }]))).toMatchObject({
      count: 1,
    });
  });
});

describe('strategies and checks', () => {
  it('falls through to the next strategy and says which one resolved', async () => {
    const { session } = await pageSession('<div data-action="cc">Cc</div>');

    const result = await resolved(session, entry([{ role: 'button', name: 'Cc' }, { attr: 'data-action', value: 'cc' }]));

    expect(result).toMatchObject({ strategy: 1, count: 1 });
    expect(result.tried[0]).toMatchObject({ strategy: 0, raw: 0 });
  });

  it('rejects a match that is hidden by style or by aria-hidden', async () => {
    const { session } = await pageSession(`
      <div style="display:none"><button>New Mail</button></div>
      <div aria-hidden="true"><button>New Mail</button></div>`);

    const result = await resolved(session, entry([{ role: 'button', name: 'New Mail' }], { visible: true }));

    expect(result).toMatchObject({ strategy: null, count: 0 });
    expect(result.tried[0]).toMatchObject({ raw: 2, visible: 0 });
  });

  it('refuses an ambiguous match for a unique entry rather than picking one', async () => {
    const { session } = await pageSession('<button>New Mail</button><button>New Mail</button>');

    const result = await resolved(session, entry([{ role: 'button', name: 'New Mail' }], { unique: true }));

    expect(result.count).toBe(0);
    expect(result.tried[0]).toMatchObject({ named: 2, ambiguous: true });
  });

  it('matches nothing for an attribute name that is not one', async () => {
    const { session } = await pageSession('<div data-action="cc">Cc</div>');

    expect(await resolved(session, entry([{ attr: 'x"] , body [y', value: 'cc' }]))).toMatchObject({ count: 0 });
  });
});

describe('beyond the light DOM', () => {
  it('searches open shadow roots', async () => {
    const { document, session } = await pageSession('<div id="host"></div>');
    document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<button>Shadow Send</button>';

    expect(await resolved(session, entry([{ role: 'button', name: 'Shadow Send' }]))).toMatchObject({ count: 1 });
    expect(await resolved(session, entry([{ css: 'button' }]))).toMatchObject({ count: 1 });
  });

  it('searches a same-origin iframe, and reports a cross-origin one it cannot read', async () => {
    const { document, session } = await pageSession('<iframe id="same"></iframe><iframe id="other" src="https://elsewhere.invalid/x"></iframe>');
    document.getElementById('same').contentDocument.body.innerHTML = '<button>Inside</button>';
    Object.defineProperty(document.getElementById('other'), 'contentDocument', { get: () => null });

    const result = await resolved(session, entry([{ role: 'button', name: 'Inside' }]));
    const miss = await resolved(session, entry([{ role: 'button', name: 'Nowhere' }]));

    expect(result).toMatchObject({ count: 1 });
    expect(miss.crossOrigin).toEqual(['https://elsewhere.invalid/x']);
  });
});

describe('the compose trap', () => {
  // Measured live: the toolbar's hidden "send outbox now" button carried the
  // testid the compose selector used to name.
  const TRAP =
    '<button data-testid="tpbr-snd-nw-btn" aria-label="Send selected email conversations in outbox immediately" style="display:none">Send now</button>';
  // A copy, so the lookup is not refused as an UNCALIBRATED spec: this is about
  // what the entry itself resolves to once calibration lets it be used.
  const compose = () => ({ ...SELECTORS.composeButton });

  it('clicks New Mail and never the hidden outbox button', async () => {
    const { document, session } = await pageSession(`${TRAP}<button data-testid="new-btn-opt">New Mail</button>`);
    const clicked = [];
    document.querySelector('[data-testid="tpbr-snd-nw-btn"]').addEventListener('click', () => clicked.push('trap'));
    document.querySelector('[data-testid="new-btn-opt"]').addEventListener('click', () => clicked.push('compose'));

    await (await locate(session, compose())).first().click();

    expect(clicked).toEqual(['compose']);
  });

  it('resolves to nothing when only the trap is there', async () => {
    const { session } = await pageSession(TRAP);

    expect(await locate(session, compose())).toBeNull();
  });

  it('rejects a visible control carrying the testid but the wrong name', async () => {
    const { session } = await pageSession(
      '<button data-testid="new-btn-opt" aria-label="Send selected email conversations in outbox immediately">Send now</button>',
    );

    expect(await locate(session, compose())).toBeNull();
  });

  it('would have rejected the old selector too, once checked for name and visibility', async () => {
    const { session } = await pageSession(TRAP);

    const old = entry([{ css: '[data-testid="tpbr-snd-nw-btn"]' }], { name: 'New Mail', visible: true, unique: true });

    expect(await locate(session, old)).toBeNull();
  });
});

describe('the compose form, as the live one is built', () => {
  // Copied from the live form (npm run nic:browser:calibrate, 2026-09-22),
  // trimmed to what the entries depend on. The editor is the body of a
  // same-origin iframe; the hidden outbox button is still in the toolbar.
  const FORM = `
    <button data-testid="tpbr-snd-nw-btn" aria-label="Send selected email conversations in outbox immediately" style="display:none">Send now</button>
    <button data-testid="com_cur_from_address" aria-label="From nic.mailbox@example.invalid">nic.mailbox@example.invalid</button>
    <div id="addressBar">
      <div class="zmCRow"><input type="text" role="combobox" aria-label="To Recipients" data-testid="com_To_field"></div>
      <div class="zmCRow"><input type="text" role="combobox" aria-label="CC Recipients" data-testid="com_Cc_field"></div>
    </div>
    <div data-testid="com_subject_field"><input id="input-_r_16_" type="text" placeholder="Subject"></div>
    <div id="zmComposeEditor_Cmp1"><iframe></iframe></div>
    <button aria-label="Attach from my computer"></button>
    <button data-testid="com_send" aria-label="Send">Send</button>
    <button data-testid="com_send_later" aria-label="Send Later">Send Later</button>
    <button data-testid="com_DiscardDraft_Icon" aria-label="Discard Draft"></button>`;

  async function composeForm() {
    const page = await pageSession(FORM);
    const frame = page.document.querySelector('#zmComposeEditor_Cmp1 iframe');
    frame.contentWindow.HTMLElement.prototype.getBoundingClientRect = page.dom.window.HTMLElement.prototype.getBoundingClientRect;
    const editor = frame.contentDocument.body;
    editor.className = 'ze_body';
    editor.setAttribute('contenteditable', 'true');
    editor.setAttribute('aria-label', 'Rich text editor area');
    return { ...page, editor };
  }

  it.each([
    ['toInput', 'com_To_field'],
    ['ccInput', 'com_Cc_field'],
    ['sendButton', 'com_send'],
    ['discardButton', 'com_DiscardDraft_Icon'],
    ['fromAddress', 'com_cur_from_address'],
  ])('resolves %s to exactly its own control', async (key, testid) => {
    const { session } = await composeForm();

    expect(await resolved(session, SELECTORS[key])).toMatchObject({ count: 1, first: { testid } });
  });

  it.each(['subjectInput', 'bodyEditor', 'fileInput'])('resolves %s by its role and name, the first strategy', async (key) => {
    const { session } = await composeForm();

    expect(await resolved(session, SELECTORS[key])).toMatchObject({ strategy: 0, count: 1 });
  });

  it('finds the editor inside its iframe', async () => {
    const { session } = await composeForm();

    expect(await resolved(session, SELECTORS.bodyEditor)).toMatchObject({ first: { name: 'Rich text editor area' } });
  });

  it('presses Send, never Send Later or the hidden outbox button', async () => {
    const { document, session } = await composeForm();
    const clicked = [];
    for (const button of document.querySelectorAll('button')) {
      button.addEventListener('click', () => clicked.push(button.getAttribute('data-testid')));
    }

    await (await locate(session, SELECTORS.sendButton)).first().click();

    expect(clicked).toEqual(['com_send']);
  });

  it('finds no Send button where there are only Send Later and the outbox button', async () => {
    const { session } = await pageSession(`
      <button data-testid="tpbr-snd-nw-btn" aria-label="Send selected email conversations in outbox immediately" style="display:none">Send now</button>
      <button data-testid="com_send_later" aria-label="Send Later">Send Later</button>`);

    expect(await locate(session, SELECTORS.sendButton)).toBeNull();
  });

  it('fills the subject so a React-controlled input registers the change', async () => {
    const { dom, document, session } = await composeForm();
    // React's value tracking, in miniature: its own instance setter records
    // every write it sees, and an input event that finds the value unchanged
    // since then is dropped — a plain `.value =` would leave the field empty.
    const input = document.querySelector('[placeholder="Subject"]');
    const native = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value');
    let tracked = '';
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() {
        return native.get.call(this);
      },
      set(value) {
        tracked = value;
        native.set.call(this, value);
      },
    });
    const changes = [];
    input.addEventListener('input', () => {
      if (input.value !== tracked) changes.push((tracked = input.value));
    });

    await (await locate(session, SELECTORS.subjectInput)).first().fill('Acknowledgement of Query Received');

    expect(changes).toEqual(['Acknowledgement of Query Received']);
  });
});

describe('the survey dialog, as every new NICeMail tab shows it', () => {
  // Shaped as the live page reported it: a visible role=dialog with its text
  // and two buttons, next to the compose form and a live region.
  const PAGE = `
    <div role="dialog">
      <p>Email Satisfaction Survey for the new NICeMail Services. Participate now!</p>
      <button data-probe="close">Close</button>
      <button data-probe="participate">Participate now!</button>
    </div>
    <div aria-live="polite">Restoring Session</div>
    <button data-testid="com_send" aria-label="Send">Send</button>`;

  it('is closed with its Close button, and "Participate now!" is never pressed', async () => {
    const { document, session } = await pageSession(PAGE);
    const clicked = [];
    for (const button of document.querySelectorAll('[data-probe]')) {
      button.addEventListener('click', () => clicked.push(button.dataset.probe));
    }

    await (await locate(session, SELECTORS.surveyCloseButton)).first().click();

    expect(clicked).toEqual(['close']);
  });

  it('answers the follow-up reminder prompt only with "Skip and Send" — never adding a reminder', async () => {
    const { document, session } = await pageSession(`
      <div role="dialog">
        <p>Add follow-up reminder? You can add follow-up reminder, as your message has below text.</p>
        <button data-probe="close">Close</button>
        <button data-probe="later">10 minutes</button>
        <button data-probe="remind">Add Reminder and Send</button>
        <button data-probe="skip">Skip and Send</button>
      </div>`);
    const clicked = [];
    for (const button of document.querySelectorAll('[data-probe]')) {
      button.addEventListener('click', () => clicked.push(button.dataset.probe));
    }

    await (await locate(session, SELECTORS.followUpSkipButton)).first().click();

    expect(clicked).toEqual(['skip']);
  });

  it('is reported as an open dialog, with its text and buttons', async () => {
    const { session } = await pageSession(PAGE);

    const dialogs = await session.evaluate(openDialogs, { exclude: SELECTORS.toInput }, { kit: pageKit });

    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].text).toContain(SELECTORS.surveyDialogText);
    expect(dialogs[0].buttons).toEqual(['Close', 'Participate now!']);
  });

  it('does not count a dialog that holds the compose form itself', async () => {
    const { session } = await pageSession(`
      <div role="dialog">
        <input type="text" role="combobox" aria-label="To Recipients" data-testid="com_To_field">
        <button aria-label="Send">Send</button>
      </div>`);

    expect(await session.evaluate(openDialogs, { exclude: SELECTORS.toInput }, { kit: pageKit })).toEqual([]);
  });

  it('still counts a prompt that has a Send button of its own', async () => {
    const { session } = await pageSession(
      '<div role="alertdialog" aria-label="Send without subject?"><button>Send</button><button>Cancel</button></div>',
    );

    const dialogs = await session.evaluate(openDialogs, { exclude: SELECTORS.toInput }, { kit: pageKit });

    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].name).toBe('Send without subject?');
  });

  it('shows up in the form snapshot beside the Send button and the live notices', async () => {
    const { session } = await pageSession(PAGE);

    const state = await session.evaluate(
      formState,
      { send: SELECTORS.sendButton, editor: SELECTORS.bodyEditor },
      { kit: pageKit },
    );

    expect(state.send).toEqual({ raw: 1, visible: 1, disabled: 0 });
    expect(state.live).toContain('Restoring Session');
    expect(state.editor).toBeNull();
  });
});

describe("the inspector's census", () => {
  const MAIL_LIST = `
    <div role="listbox" aria-label="Email listing">
      <div role="option" id="1" data-ty="lt" class="zmList"><div role="button" data-action="envelope" aria-label="Mark emails as unread"></div><span>a@example.invalid</span></div>
      <div role="option" id="2" data-ty="lt" class="zmList"><div role="button" data-action="envelope" aria-label="Mark emails as unread"></div><span>b@example.invalid</span></div>
    </div>
    <button data-testid="new-btn-opt" class="zmbtn__rhuj3">New Mail</button>
    <div id="host"></div>`;

  const run = (session) =>
    session.evaluate(
      censusDocument,
      { appReady: '[role="listbox"][aria-label="Email listing"]', listRow: '[role="option"][data-ty="lt"]', maxInventory: 50 },
      { kit: pageKit },
    );

  it('counts shadow roots, the mail list and its rows, and the generated classes', async () => {
    const { document, session } = await pageSession(MAIL_LIST);
    document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<span></span>';

    const result = await run(session);

    expect(result).toMatchObject({ shadowRoots: 1, appReady: 1, appReadyLight: 1, rows: 2, options: 2 });
    expect(result.hashedClasses).toEqual({ distinct: 1, examples: ['zmbtn__rhuj3'] });
    expect(result.rowLike).toEqual({ 'option in listbox "Email listing"': 2 });
  });

  it('collapses the controls repeated in every row into one line, without their text', async () => {
    const { session } = await pageSession(MAIL_LIST);

    const { inventory } = await run(session);

    const rowControl = inventory.filter((item) => item.inRow);
    expect(rowControl).toEqual([expect.objectContaining({ action: 'envelope', count: 2, name: '', label: '' })]);
    expect(inventory).toContainEqual(expect.objectContaining({ role: 'button', name: 'New Mail', testid: 'new-btn-opt' }));
  });
});

describe('the page is only read', () => {
  it('leaves no globals behind', async () => {
    const { dom, session } = await pageSession('<button>New Mail</button><div id="host"></div>');
    const before = new Set(Object.getOwnPropertyNames(dom.window));

    await resolved(session, entry([{ role: 'button', name: 'New Mail' }], { visible: true, unique: true }));
    await locate(session, entry([{ css: 'button' }]));

    expect(Object.getOwnPropertyNames(dom.window).filter((name) => !before.has(name))).toEqual([]);
  });

  it('contains no code that writes to the page', () => {
    const source = pageKit.toString();
    const writes = [/dispatchEvent/, /\.value\s*=(?!=)/, /scrollTop/, /location/, /innerHTML\s*=(?!=)/, /\.focus\(/];
    for (const write of writes) {
      expect(source).not.toMatch(write);
    }
  });

  it('rethrows a lost session instead of calling it a missing element', async () => {
    const lostSession = {
      evaluate: vi.fn(async () => {
        throw Object.assign(new Error('The NICeMail agent tab was closed or crashed.'), { sessionLost: true });
      }),
    };

    await expect(locate(lostSession, entry([{ css: 'button' }]))).rejects.toThrow(/closed or crashed/);
  });
});
