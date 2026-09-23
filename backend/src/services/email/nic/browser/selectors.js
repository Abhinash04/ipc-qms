/**
 * Every NICeMail UI selector the browser agent uses, in one place.
 *
 * Nearly all of these were calibrated against the live mailbox: each one was
 * matched, counted and cross-checked in the running app, and the comment on it
 * records what it resolved to. Three were not, because the live mailbox never
 * presented them — `ccToggle` (the Cc field is already open, so the toggle that
 * reveals it is hidden), `attachmentEntry` and `listRowAttachment` (no message
 * in 312 live rows carried an attachment). Those three are listed in
 * UNCALIBRATED and the failure message says so rather than reporting a guess as
 * a missing element.
 *
 * NICeMail is Zoho, and Zoho's class names are generated; where an accessible
 * role or a `data-testid` exists it is preferred, and a build-hashed CSS-module
 * class (`zmattachment__<hash>`) is never used — it changes on every deploy.
 *
 * A spec is one of:
 *   - a CSS string, or an array of CSS strings tried in order — the first that
 *     matches anything wins. The structural keys the reader's page code uses
 *     directly stay in this form;
 *   - an element entry, `element([...strategies], checks)`, for every control
 *     the agent clicks or types into: strategies in the order pageKit.js
 *     documents (role + accessible name first, CSS last), plus the checks the
 *     match must pass — `visible`, an expected accessible `name`, `unique`;
 *   - an `(id) => string` builder, called with a message id before use;
 *   - a literal (LITERALS below) that is compared or navigated to, not queried.
 *
 * `npm run nic:browser:discover` reports how every entry here resolves on the
 * live page; recalibrating the agent means editing this file.
 */

import { isSessionLost } from './cdp.js';
import { pageKit } from './pageKit.js';

const element =(strategies, checks = {}) => ({ strategies, ...checks });

export const SELECTORS = {
  // ── The app itself ───────────────────────────────────────────────────────
  /** Present only once the mailbox has rendered — ~1.7s after the load event. */
  appReady: '[role="listbox"][aria-label="Email listing"]',
  passwordField: 'input[type="password"]',

  // ── Folder tree ──────────────────────────────────────────────────────────
  /** 1 match. The Views section also holds "Unread"/"All messages"/"Flagged"
   *  treeitems, so the label must match exactly. */
  folderInbox: '[role="treeitem"][aria-label="Inbox"]',
  folderInboxLabel: 'Inbox',
  /** Exactly one frame-wide: the folder currently being shown. */
  folderActive: '[role="treeitem"].zmCurTree',

  // ── Message list ─────────────────────────────────────────────────────────
  /** The listbox IS the scroll container, and it is not virtualised: rows are
   *  appended on scroll and never recycled, so the loaded rows are all real. */
  mailList: '[role="listbox"][aria-label="Email listing"]',
  listRow: '[role="listbox"][aria-label="Email listing"] [role="option"][data-ty="lt"]',
  /** Every option in the list, `data-ty` or not. Only used to tell an empty
   *  folder ("no options at all") apart from a stale row selector ("options,
   *  none of them matched"). */
  listRowAny: '[role="listbox"][aria-label="Email listing"] [role="option"]',
  listRowSender: '[data-testid="lst-sndr"]',
  listRowSubject: '[data-testid="lst-sub"]',
  /** Cells named by `data-action`, measured live on every row: the list date
   *  ("2:40 PM" today, rendered twice in the cell), the size ("4 KB") and the
   *  conversation's message count (empty for a single message). */
  listRowDate: '[data-action="date"]',
  listRowSize: '[data-action="size"]',
  listRowThread: '[data-action="thread"]',
  /** UNCALIBRATED: none of the 312 live rows had an attachment. The per-type
   *  icon family, minus the toolbar's attachment filter. */
  listRowAttachment: '[class*="msi-att"]:not([class*="msi-attsearch"])',
  /** One row while the agent works; more than one only if a human is
   *  multi-selecting in the same mailbox, which the unread restore refuses to
   *  act during. */
  listRowSelected: '[role="option"][aria-selected="true"]',

  /** Unread rows carry this class; their aria-label also begins "Unread email".
   *  The per-row envelope button's aria-label does NOT track state — it reads
   *  "Mark emails as unread" on read and unread rows alike — so it is never
   *  used as a signal, only as the control. */
  rowUnreadClass: 'zmLUrd',
  /** div.zmLType.jsEnvelope — the only read/unread control in the DOM. */
  rowEnvelopeToggle: '[data-action="envelope"][role="button"]',

  /** Opening a message rewrites its row id from `<id>` to `t<id>`, so a row
   *  must always be matched both ways or it goes missing exactly when the
   *  unread state is being restored. */
  rowById: (id) => `[role="option"][id="${id}"], [role="option"][id="t${id}"]`,

  /**
   * The read/unread control of one row — the ICON, not the button around it.
   *
   * Measured on the live mailbox: a click on the `[data-action="envelope"]`
   * wrapper closes the preview and changes nothing, while the same click on the
   * `i.msi-mail` inside it flips exactly that one row's unread state. The
   * handler is on the icon.
   *
   * Pinned to `i.msi-mail` rather than to any `<i>` in the wrapper: `clickOn`
   * acts on the FIRST match, so a bare `i` would happily click a decorative
   * icon that happens to render first and report a successful mark-unread on a
   * row that is still read.
   *
   * Composed rather than concatenated: a descendant appended to the
   * comma-separated pair above would bind to the second half of it only.
   */
  rowUnreadToggleById: (id) =>
    `[role="option"][id="${id}"] [data-action="envelope"][role="button"] i.msi-mail, ` +
    `[role="option"][id="t${id}"] [data-action="envelope"][role="button"] i.msi-mail`,

  // ── Open message ─────────────────────────────────────────────────────────
  /**
   * The route that opens a message.
   *
   * Opening by URL rather than by clicking the row: a click has to be aimed at
   * a list that grows under it, and in the agent's own background tab a
   * dispatched mouse event was measured to do nothing at all (a tab that is
   * never composited has nothing to hit-test against). The hash is unambiguous
   * — it names the message — and it cannot open the wrong one.
   */
  messageRoute: (id) => `#mail/folder/inbox/p/${id}`,
  /** The folder with nothing open — where the agent leaves the tab, and where it
   *  has to be before a message can be marked unread again. */
  folderRoute: '#mail/folder/inbox',

  previewPane: '[role="region"][aria-label="Email preview pane"]',
  /** `.shw` is the pane being shown. A pane that has been closed keeps the last
   *  message's container inside it, so the class — not the container — is what
   *  says whether anything is open. */
  previewPaneShown: '[role="region"][aria-label="Email preview pane"].shw',
  /** id = `zm_Container_m<message id>`; exactly 1 when a message is open. */
  previewMessage: '[role="region"][aria-label="Email preview pane"].shw [id^="zm_Container_m"]',
  previewMessageById: (id) =>
    `[role="region"][aria-label="Email preview pane"].shw [id="zm_Container_m${id}"]`,

  /** Sender and recipients each render TWICE — a collapsed and an expanded
   *  copy — so the address is read from `data-eid` and de-duplicated, never
   *  accumulated from textContent. */
  senderAddr: '.zmMHFrom [data-eid]',
  recipientAddr: '.zmMHdrData .jsReciID[data-eid]',
  /** Labelled header rows: "To", "Cc", "Tags", "Security". Zoho omits the Cc
   *  row entirely when there is no Cc, so Cc is read by finding the row whose
   *  left cell says "Cc" rather than by a selector of its own. */
  hdrRow: '.zmMHdrRow',
  hdrRowLabel: '.zmMHdrLeft.zmGreyClr',
  hdrRowData: '.zmMHdrData',

  /** The authoritative timestamp: "Mon, 21 Sep 2026 11:19:09 AM +0530" —
   *  fully qualified, with a year and an offset. The list row's date is only
   *  "11:19 AM" for today's mail and has no year at all. */
  fullTimestamp: '.jsRevTS',
  /** Time only, e.g. "11:19 AM"; the fallback when .jsRevTS is missing. */
  shortTime: '.zmMHdrRow .zmGreyClr.zmMHlD',
  /** No nested iframe and no srcdoc — the body text is read directly. */
  body: '[role="document"]',

  /**
   * Attachments — UNVERIFIED. Not one of the messages in the live mailbox had
   * an attachment, so these come from a scan of the app's own stylesheets, not
   * from a match. The legacy non-hashed families are the safer half; the
   * build-hashed CSS-module classes are deliberately absent because they change
   * on every Zoho deploy. A message whose attachment cannot be read records a
   * materializeError on that entry and is still stored.
   */
  attachmentEntry: [
    '.zmAttDRow',
    '.zmAttData',
    '.zmAttList .zmAttLAction',
    // The per-type icons (msi-attpdf, msi-attdoc, …). `msi-attsearch` is the
    // toolbar's attachment FILTER and matched this prefix live, so it is
    // excluded by name rather than by hoping no message contains one.
    '[class*="msi-att"]:not([class*="msi-attsearch"])',
  ],

  // ── Composing ────────────────────────────────────────────────────────────
  // Read from a compose form opened by hand in the live mailbox (2026-09-22):
  // compose opens as an app tab (hash `#compose`, panel `#jstab-Cmp<N>`) in the
  // same document as the inbox. Entries leave UNCALIBRATED only once
  // `npm run nic:browser:calibrate` and a real test send have proven them.
  //
  // The compose button is `<button data-testid="new-btn-opt">New Mail</button>`.
  // It is NOT `tpbr-snd-nw-btn`, which this entry once named: that testid is the
  // toolbar's hidden "Send selected email conversations in outbox immediately".
  // An element that merely exists is not enough: each entry must also be
  // visible, carry the expected name where it has one, and be the only match.
  composeButton: element([{ role: 'button', name: 'New Mail' }, { testid: 'new-btn-opt' }], {
    name: 'New Mail',
    visible: true,
    unique: true,
  }),
  /** `<input role="combobox" aria-label="To Recipients" data-testid="com_To_field">`. */
  toInput: element([{ role: 'combobox', name: 'To Recipients' }, { testid: 'com_To_field' }], {
    name: 'To Recipients',
    visible: true,
    unique: true,
  }),
  /** Shown by default; the toggle below only matters when it is not. */
  ccInput: element([{ role: 'combobox', name: 'CC Recipients' }, { testid: 'com_Cc_field' }], {
    name: 'CC Recipients',
    visible: true,
    unique: true,
  }),
  /** `<font role="button" aria-label="Add Cc recipients">`, hidden while Cc shows. */
  ccToggle: element([{ role: 'button', name: 'Add Cc recipients' }], { visible: true, unique: true }),
  /** The input's id is React-generated (`input-_r_16_`) and changes; its
   *  placeholder is its name, and the row carries a stable testid. */
  subjectInput: element(
    [{ role: 'textbox', name: 'Subject' }, { css: '[data-testid="com_subject_field"] input' }],
    { name: 'Subject', visible: true, unique: true },
  ),
  /** `<body class="ze_body" contenteditable="true" aria-label="Rich text editor
   *  area">` inside a same-origin iframe of `#zmComposeEditor_Cmp<N>`, which
   *  pageKit searches. Unique: a contenteditable elsewhere must never get the body. */
  bodyEditor: element(
    [{ role: 'textbox', name: 'Rich text editor area' }, { css: 'body.ze_body[contenteditable="true"]' }],
    { name: 'Rich text editor area', visible: true, unique: true },
  ),
  /** There is no `<input type="file">` in the form: this button opens the
   *  file chooser, which the agent intercepts (see sendMail.js). */
  fileInput: element([{ role: 'button', name: 'Attach from my computer' }], {
    name: 'Attach from my computer',
    visible: true,
    unique: true,
  }),
  /** `<button data-testid="com_send" aria-label="Send">`. "Send Later"
   *  (`com_send_later`) sits beside it and is excluded by the exact name. */
  sendButton: element([{ role: 'button', name: 'Send' }, { testid: 'com_send' }], {
    name: 'Send',
    visible: true,
    unique: true,
  }),
  /** Closes the form without sending, so a failed send leaves no draft behind. */
  discardButton: element([{ role: 'button', name: 'Discard Draft' }, { testid: 'com_DiscardDraft_Icon' }], {
    name: 'Discard Draft',
    visible: true,
    unique: true,
  }),
  /** `aria-label="From <address>"` — which mailbox the form will send as. */
  fromAddress: element([{ testid: 'com_cur_from_address' }], { name: 'From', match: 'prefix', visible: true, unique: true }),
  /** A committed recipient: `<div role="option" class="zmCB" aria-label="<address>">`,
   *  in the recipient row (`.zmCRow`) of its input. Calibrated: an address
   *  typed into To and committed with Enter became exactly this. */
  recipientChip: '[role="option"].zmCB[aria-label]',
  /** An attached file: `<div role="row" aria-label="<file name>">`, reading
   *  "Scanning Virus" until the upload is checked and then its size. */
  composeAttachmentRow: '.zmCRAtt [role="row"][aria-label]',

  // ── Other folders ────────────────────────────────────────────────────────
  /** The Sent folder's route (calibrated), where a sent message is looked for
   *  to prove it went. Its list rows have the Inbox's shape; the sender cell
   *  holds the recipient. */
  sentFolderRoute: '#mail/folder/sent',
  /** `folderActive`'s label while Sent is the folder shown. */
  folderSentLabel: 'Sent',
  /** Where a sent message is looked for, to prove it went. */
  folderSent: element([{ role: 'treeitem', name: 'Sent' }, { css: '[role="treeitem"][aria-label="Sent"]' }], {
    visible: true,
    unique: true,
  }),
  folderDrafts: element([{ role: 'treeitem', name: 'Drafts' }, { css: '[role="treeitem"][aria-label="Drafts"]' }], {
    visible: true,
    unique: true,
  }),
  // Deliberately no "sent confirmation" selector. It was `[role=alert]` /
  // `[role=status]`, which matches error alerts and permanent status regions
  // as readily as a success toast, so a failed send could be recorded as sent.
  // The form closing and the message then appearing in the Sent folder are
  // the signal — see sendMail.js. Add one back only
  // with a text match proven against the live mailbox by nic:browser:discover.

  // ── Pop-ups ──────────────────────────────────────────────────────────────
  // Seen live (2026-09-22): every newly opened NICeMail tab shows, within a few
  // seconds, a role=dialog reading "Email Satisfaction Survey for the new
  // NICeMail Services. Participate now!" with two buttons, "Close" and
  // "Participate now!". Left open it can take the keyboard focus while the
  // body is typed and swallow the click on Send, so the agent closes it — with
  // its own Close button, exact name, and only when it is the one dialog open
  // (sendMail.js). "Participate now!" can never match.
  /** Text that identifies the survey dialog. */
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
  // Seen live (2026-09-22), right after Send on the acknowledgement: a dialog
  // "Add follow-up reminder? You can add follow-up reminder, as your message
  // has below text. … as soon as possible" with the buttons "Close",
  // "10 minutes", "Add Reminder and Send" and "Skip and Send". Zoho holds the
  // message until one is pressed — Close keeps it unsent. The agent presses
  // "Skip and Send": the message goes as written, with no reminder added
  // (sendMail.js). Exact name, so "Add Reminder and Send" cannot match.
  /** Text that identifies the follow-up reminder prompt. */
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

/**
 * Selectors no live run has proven yet. The agent refuses them (requireElement,
 * locate), and a failure on one is reported as a calibration gap, not a broken
 * mailbox. The compose keys left this set on 2026-09-22, once
 * `npm run nic:browser:calibrate -- --attach` had driven each of them in the
 * agent's own tab and a real test send had been found in the Sent folder.
 */
export const UNCALIBRATED = new Set([
  // Hidden whenever Cc is already shown — as it is by default — so no live
  // run has pressed it yet.
  'ccToggle',
  // Reading attachments off a received message: no live message has had one.
  'attachmentEntry',
  'listRowAttachment',
]);

/** Entries that are compared or navigated to rather than queried. */
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

/** Specs of the UNCALIBRATED keys, so a lookup by spec is refused as well as one by key. */
const UNCALIBRATED_SPECS = new Set([...UNCALIBRATED].map((key) => SELECTORS[key]));

/**
 * Any spec as an element entry. A builder is refused loudly: serialised
 * unevaluated it becomes `undefined` in the page, which queries "undefined",
 * matches nothing, and used to pass for an element that is simply absent.
 */
export function entryOf(spec) {
  if (typeof spec === 'function') throw new TypeError('Call the selector builder with an id before looking it up.');
  if (spec && Array.isArray(spec.strategies)) return spec;
  return { strategies: (Array.isArray(spec) ? spec : [spec]).map((css) => ({ css })) };
}

/** A readable name for a spec, for error messages: its strategies, in order. */
export function describeSpec(spec) {
  return entryOf(spec)
    .strategies.map((strategy) =>
      Object.entries(strategy)
        .map(([key, value]) => (key === 'css' ? value : `${key}=${JSON.stringify(value)}`))
        .join(' '),
    )
    .join(' | ');
}

// ── Page-side helpers ────────────────────────────────────────────────────────
// Passed to session.evaluate() as functions and serialised with their argument,
// so the code that runs in the mail app is readable here rather than in a string.
// Each receives pageKit's resolver as its second argument (see cdp.js).

const countMatching = ({ spec, raw = false }, kit) => kit.resolve(spec, { raw }).elements.length;

/**
 * A whole click, dispatched at the element.
 *
 * Not `Input.dispatchMouseEvent`: in the agent's own background tab a
 * dispatched mouse event was measured to do nothing at all — a tab Chrome never
 * composites has nothing to hit-test the coordinates against — while these
 * events reach the app's handlers. Aiming at the element rather than at a point
 * also removes the worst failure this agent could have: a list that grew under
 * a coordinate, and a click that lands on the neighbouring message.
 *
 * The full sequence rather than `element.click()`, which dispatches a bare
 * click: the app delegates from the document and gates some controls on
 * pointerdown/mousedown, so a click alone silently does nothing to those.
 */
const clickOn = ({ spec, index }, kit) => {
  const element = kit.resolve(spec).elements[index];
  if (!element) return false;

  // The element's own window: it may sit in a same-origin frame.
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
    // Through the prototype's setter, not `element.value = …`: a React input
    // tracks its value with an instance setter of its own, and an assignment
    // through that one is taken as React's own write — the next input event
    // then finds nothing changed, and the form sends an empty field.
    const view = element.ownerDocument.defaultView;
    const prototype = element.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
  }
  // A framework that never sees an input event keeps its own empty state and
  // sends an empty field.
  const { Event: PageEvent } = element.ownerDocument.defaultView;
  element.dispatchEvent(new PageEvent('input', { bubbles: true }));
  element.dispatchEvent(new PageEvent('change', { bubbles: true }));
  return true;
};

const isVisible = ({ spec, index }, kit) => {
  const element = kit.resolve(spec, { raw: true }).elements[index];
  return Boolean(element) && kit.visible(element);
};

/** The element itself — for `setInputFiles`, which needs a remote object, not a value. */
const elementAt = ({ spec, index }, kit) => kit.resolve(spec).elements[index] || null;

/** Why an entry resolved to nothing: per strategy, counts only. */
const explainMiss = ({ spec }, kit) => {
  const { tried, crossOrigin = [] } = kit.resolve(spec);
  return { tried, crossOriginFrames: crossOrigin.length };
};

/** Only the keys the agent actually presses. An unknown key throws rather than
 *  guessing at a virtual key code. */
const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
};

// ── Locator ──────────────────────────────────────────────────────────────────

/**
 * An element entry bound to a session, with the handful of actions the compose
 * flow performs. Intentionally not a general Locator: the reader works through
 * `session.evaluate` directly, because extracting a message is one page-side
 * pass rather than a dozen round trips.
 *
 * Every action resolves the entry afresh, with all its checks, so a control
 * that went hidden or changed between lookup and use is not acted on.
 */
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
        // Nothing resolved, so no event was dispatched: a caller that must
        // know whether a click could have acted (Send) can rely on this.
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

    /**
     * File inputs take paths, not buffers: CDP has no in-memory variant of
     * DOM.setFileInputFiles, so the bytes are staged on disk first. The caller
     * owns the staged files — see sendMail.js, which removes them.
     */
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

    /** `detached` resolves once nothing matches at all, whatever its checks;
     *  anything else once it is visible. Polled, because a CDP session has no
     *  auto-waiting. */
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

/**
 * The spec resolved to a locator — or null when it resolves to nothing.
 *
 * `session` is a CDP session from cdp.js. The spec of an UNCALIBRATED key
 * resolves to nothing without the page being asked (see requireElement). A
 * lost session is rethrown: reported as "no match" it would send the operator
 * to recalibrate a selector when the agent tab had simply gone.
 */
export async function locate(session, spec) {
  if (UNCALIBRATED_SPECS.has(spec)) return null;
  const entry = entryOf(spec);
  try {
    if ((await session.evaluate(countMatching, { spec: entry }, { kit: pageKit })) > 0) return locator(session, entry);
  } catch (error) {
    if (isSessionLost(error)) throw error;
    // A page script that failed, or a document mid-navigation: no match.
  }
  return null;
}

/**
 * Kept as the frame-aware form of `locate`, and identical to it.
 *
 * pageKit already searches open shadow roots and same-origin iframes. A
 * cross-origin iframe is a separate CDP target that a session on this page
 * cannot evaluate in; the agent never needs one — it opens the mailbox as its
 * own top-level document — so the inspector reports them rather than the agent
 * attaching to them. If a calibrated compose editor ever turns out to live in
 * one, attaching to that child target is what goes here.
 */
export async function locateInFrames(session, spec) {
  return locate(session, spec);
}

/**
 * Like locate(), but a missing element is an error naming the selector.
 *
 * An UNCALIBRATED key is refused before the page is even asked. A guess that
 * happens to match is worse than one that matches nothing: the old compose
 * selector matched a hidden "send outbox now" button, and once compose really
 * opens, a guessed body selector can match the To field and type the reply
 * into it. Nothing is clicked or typed through a selector until a live
 * calibration has taken it out of UNCALIBRATED.
 */
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
    // Why, per strategy — best effort, and never allowed to replace the error.
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
