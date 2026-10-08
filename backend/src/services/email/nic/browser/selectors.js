import { isSessionLost } from './cdp.js';
import { pageKit } from './pageKit.js';

const element =(strategies, checks = {}) => ({ strategies, ...checks });

export const SELECTORS = {
  appReady: '[role="listbox"][aria-label="Email listing"]',
  passwordField: 'input[type="password"]',

  folderInbox: '[role="treeitem"][aria-label="Inbox"]',
  folderInboxLabel: 'Inbox',
  folderActive: '[role="treeitem"].zmCurTree',

  mailList: '[role="listbox"][aria-label="Email listing"]',
  listRow: '[role="listbox"][aria-label="Email listing"] [role="option"][data-ty="lt"]',
  listRowAny: '[role="listbox"][aria-label="Email listing"] [role="option"]',
  listRowSender: '[data-testid="lst-sndr"]',
  listRowSubject: '[data-testid="lst-sub"]',
  listRowDate: '[data-action="date"]',
  listRowSize: '[data-action="size"]',
  listRowThread: '[data-action="thread"]',
  listRowAttachment: '[class*="msi-att"]:not([class*="msi-attsearch"])',
  listRowSelected: '[role="option"][aria-selected="true"]',

  rowUnreadClass: 'zmLUrd',
  rowEnvelopeToggle: '[data-action="envelope"][role="button"]',

  rowById: (id) => `[role="option"][id="${id}"], [role="option"][id="t${id}"]`,

  rowUnreadToggleById: (id) =>
    `[role="option"][id="${id}"] [data-action="envelope"][role="button"] i.msi-mail, ` +
    `[role="option"][id="t${id}"] [data-action="envelope"][role="button"] i.msi-mail`,

  messageRoute: (id) => `#mail/folder/inbox/p/${id}`,
  folderRoute: '#mail/folder/inbox',

  previewPane: '[role="region"][aria-label="Email preview pane"]',
  previewPaneShown: '[role="region"][aria-label="Email preview pane"].shw',
  previewMessage: '[role="region"][aria-label="Email preview pane"].shw [id^="zm_Container_m"]',
  previewMessageById: (id) =>
    `[role="region"][aria-label="Email preview pane"].shw [id="zm_Container_m${id}"]`,

  senderAddr: '.zmMHFrom [data-eid]',
  recipientAddr: '.zmMHdrData .jsReciID[data-eid]',
  hdrRow: '.zmMHdrRow',
  hdrRowLabel: '.zmMHdrLeft.zmGreyClr',
  hdrRowData: '.zmMHdrData',

  fullTimestamp: '.jsRevTS',
  shortTime: '.zmMHdrRow .zmGreyClr.zmMHlD',
  body: '[role="document"]',

  attachmentEntry: [
    '.zmAttDRow',
    '.zmAttData',
    '.zmAttList .zmAttLAction',
    '[class*="msi-att"]:not([class*="msi-attsearch"])',
  ],

  composeButton: element([{ role: 'button', name: 'New Mail' }, { testid: 'new-btn-opt' }], {
    name: 'New Mail',
    visible: true,
    unique: true,
  }),
  toInput: element([{ role: 'combobox', name: 'To Recipients' }, { testid: 'com_To_field' }], {
    name: 'To Recipients',
    visible: true,
    unique: true,
  }),
  ccInput: element([{ role: 'combobox', name: 'CC Recipients' }, { testid: 'com_Cc_field' }], {
    name: 'CC Recipients',
    visible: true,
    unique: true,
  }),
  ccToggle: element([{ role: 'button', name: 'Add Cc recipients' }], { visible: true, unique: true }),
  subjectInput: element(
    [{ role: 'textbox', name: 'Subject' }, { css: '[data-testid="com_subject_field"] input' }],
    { name: 'Subject', visible: true, unique: true },
  ),
  bodyEditor: element(
    [{ role: 'textbox', name: 'Rich text editor area' }, { css: 'body.ze_body[contenteditable="true"]' }],
    { name: 'Rich text editor area', visible: true, unique: true },
  ),
  fileInput: element([{ role: 'button', name: 'Attach from my computer' }], {
    name: 'Attach from my computer',
    visible: true,
    unique: true,
  }),
  sendButton: element([{ role: 'button', name: 'Send' }, { testid: 'com_send' }], {
    name: 'Send',
    visible: true,
    unique: true,
  }),
  discardButton: element([{ role: 'button', name: 'Discard Draft' }, { testid: 'com_DiscardDraft_Icon' }], {
    name: 'Discard Draft',
    visible: true,
    unique: true,
  }),
  fromAddress: element([{ testid: 'com_cur_from_address' }], { name: 'From', match: 'prefix', visible: true, unique: true }),
  recipientChip: '[role="option"].zmCB[aria-label]',
  composeAttachmentRow: '.zmCRAtt [role="row"][aria-label]',

  sentFolderRoute: '#mail/folder/sent',
  folderSentLabel: 'Sent',
  folderSent: element([{ role: 'treeitem', name: 'Sent' }, { css: '[role="treeitem"][aria-label="Sent"]' }], {
    visible: true,
    unique: true,
  }),
  folderDrafts: element([{ role: 'treeitem', name: 'Drafts' }, { css: '[role="treeitem"][aria-label="Drafts"]' }], {
    visible: true,
    unique: true,
  }),

  surveyDialogText: 'Email Satisfaction Survey',
  surveyCloseButton: element(
    [
      {
        css:
          '[role="dialog"] button, [role="dialog"] [role="button"], ' +
          '[role="alertdialog"] button, [role="alertdialog"] [role="button"]',
      },
    ],
    { name: 'Close', visible: true, unique: true },
  ),
  followUpDialogText: 'Add follow-up reminder?',
  followUpSkipButton: element(
    [
      {
        css:
          '[role="dialog"] button, [role="dialog"] [role="button"], ' +
          '[role="alertdialog"] button, [role="alertdialog"] [role="button"]',
      },
    ],
    { name: 'Skip and Send', visible: true, unique: true },
  ),
};

export const UNCALIBRATED = new Set([
  'ccToggle',
  'attachmentEntry',
  'listRowAttachment',
]);

export const LITERALS = new Set([
  'folderInboxLabel',
  'rowUnreadClass',
  'folderRoute',
  'messageRoute',
  'sentFolderRoute',
  'folderSentLabel',
  'surveyDialogText',
  'followUpDialogText',
]);

const UNCALIBRATED_SPECS = new Set([...UNCALIBRATED].map((key) => SELECTORS[key]));

export function entryOf(spec) {
  if (typeof spec === 'function') throw new TypeError('Call the selector builder with an id before looking it up.');
  if (spec && Array.isArray(spec.strategies)) return spec;
  return { strategies: (Array.isArray(spec) ? spec : [spec]).map((css) => ({ css })) };
}

export function describeSpec(spec) {
  return entryOf(spec)
    .strategies.map((strategy) =>
      Object.entries(strategy)
        .map(([key, value]) => (key === 'css' ? value : `${key}=${JSON.stringify(value)}`))
        .join(' '),
    )
    .join(' | ');
}

const countMatching = ({ spec, raw = false }, kit) => kit.resolve(spec, { raw }).elements.length;

const clickOn = ({ spec, index }, kit) => {
  const element = kit.resolve(spec).elements[index];
  if (!element) return false;

  const view = element.ownerDocument.defaultView;
  const Pointer = view.PointerEvent || view.MouseEvent;
  const box = element.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view,
    clientX: Math.round(box.x + box.width / 2),
    clientY: Math.round(box.y + box.height / 2),
    button: 0,
    buttons: 1,
  };
  const pointer = { ...init, pointerId: 1, isPrimary: true, pointerType: 'mouse' };

  element.dispatchEvent(new Pointer('pointerdown', pointer));
  element.dispatchEvent(new view.MouseEvent('mousedown', init));
  element.dispatchEvent(new Pointer('pointerup', { ...pointer, buttons: 0 }));
  element.dispatchEvent(new view.MouseEvent('mouseup', { ...init, buttons: 0 }));
  element.dispatchEvent(new view.MouseEvent('click', { ...init, buttons: 0, detail: 1 }));
  return true;
};

const fillIn = ({ spec, index, value }, kit) => {
  const element = kit.resolve(spec).elements[index];
  if (!element) return false;

  element.focus();
  if (element.isContentEditable) {
    element.textContent = value;
  } else {
    const view = element.ownerDocument.defaultView;
    const prototype = element.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
  }
  const { Event: PageEvent } = element.ownerDocument.defaultView;
  element.dispatchEvent(new PageEvent('input', { bubbles: true }));
  element.dispatchEvent(new PageEvent('change', { bubbles: true }));
  return true;
};

const isVisible = ({ spec, index }, kit) => {
  const element = kit.resolve(spec, { raw: true }).elements[index];
  return Boolean(element) && kit.visible(element);
};

const elementAt = ({ spec, index }, kit) => kit.resolve(spec).elements[index] || null;

const explainMiss = ({ spec }, kit) => {
  const { tried, crossOrigin = [] } = kit.resolve(spec);
  return { tried, crossOriginFrames: crossOrigin.length };
};

const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
};

function locator(session, entry, index = 0) {
  const at = { spec: entry, index };
  const selector = describeSpec(entry);
  const inPage = (fn, argument) => session.evaluate(fn, argument, { kit: pageKit });

  const self = {
    selector,
    first: () => (index === 0 ? self : locator(session, entry, 0)),
    nth: (position) => locator(session, entry, position),
    count: () => inPage(countMatching, { spec: entry }),

    click: async () => {
      if (!(await inPage(clickOn, at))) {
        throw Object.assign(new Error(`NICeMail element "${selector}" could not be clicked.`), {
          stage: 'ui',
          dispatched: false,
        });
      }
    },

    fill: async (value) => {
      if (!(await inPage(fillIn, { ...at, value: String(value ?? '') }))) {
        throw Object.assign(new Error(`NICeMail element "${selector}" could not be filled.`), { stage: 'ui' });
      }
    },

    pressSequentially: async (text) => {
      await session.send('Input.insertText', { text: String(text ?? '') });
    },

    press: async (key) => {
      const descriptor = KEYS[key];
      if (!descriptor) throw new Error(`No key descriptor for "${key}" — add one rather than guessing.`);
      await session.send('Input.dispatchKeyEvent', { type: 'keyDown', ...descriptor });
      await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...descriptor, text: undefined });
    },

    setInputFiles: async (paths) => {
      const { result } = await session.send('Runtime.evaluate', {
        expression: `(${elementAt.toString()})(${JSON.stringify(at)}, (${pageKit.toString()})())`,
      });
      if (!result?.objectId) {
        throw Object.assign(new Error(`NICeMail file input "${selector}" was not found.`), { stage: 'ui' });
      }
      await session.send('DOM.enable');
      await session.send('DOM.setFileInputFiles', { files: paths, objectId: result.objectId });
    },

    waitFor: async ({ state = 'visible', timeout = 30000, every = 100 } = {}) => {
      const started = Date.now();
      for (;;) {
        const reached =
          state === 'detached'
            ? (await inPage(countMatching, { spec: entry, raw: true })) === 0
            : Boolean(await inPage(isVisible, at));
        if (reached) return;
        if (Date.now() - started > timeout) {
          throw new Error(`Timeout ${timeout}ms exceeded waiting for ${selector} → ${state}`);
        }
        await new Promise((resolve) => setTimeout(resolve, every));
      }
    },
  };

  return self;
}

export async function locate(session, spec) {
  if (UNCALIBRATED_SPECS.has(spec)) return null;
  const entry = entryOf(spec);
  try {
    if ((await session.evaluate(countMatching, { spec: entry }, { kit: pageKit })) > 0) return locator(session, entry);
  } catch (error) {
    if (isSessionLost(error)) throw error;
  }
  return null;
}

export async function locateInFrames(session, spec) {
  return locate(session, spec);
}

export async function requireElement(session, key) {
  if (UNCALIBRATED.has(key)) {
    throw Object.assign(
      new Error(
        `NICeMail UI element "${key}" has never been calibrated against the live NICeMail mailbox, ` +
          'so the agent will not use it. Run "npm run nic:browser:calibrate" (and "npm run nic:browser:discover"), ' +
          'set it from what they report and remove it from UNCALIBRATED in browser/selectors.js.',
      ),
      { stage: 'ui', selector: key, uncalibrated: true },
    );
  }

  const found = await locate(session, SELECTORS[key]);
  if (!found) {
    const why = await session
      .evaluate(explainMiss, { spec: entryOf(SELECTORS[key]) }, { kit: pageKit })
      .catch(() => null);
    const frames = why?.crossOriginFrames ? ` ${why.crossOriginFrames} cross-origin frame(s) could not be searched.` : '';

    throw Object.assign(
      new Error(`NICeMail UI element "${key}" was not found.${frames} Recalibrate browser/selectors.js.`),
      { stage: 'ui', selector: key, uncalibrated: false, details: { tried: why?.tried ?? null } },
    );
  }
  return found;
}
