import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';

import browserConfig from '../../../../config/browserConfig.js';
import { normaliseAddress } from '../../mailbox/address.js';
import { pageKit } from './pageKit.js';
import { listRows } from './readInbox.js';
import { withNicemail } from './session.js';
import { SELECTORS, UNCALIBRATED, locate, requireElement } from './selectors.js';

/**
 * Sending one message through the signed-in NICeMail compose form.
 *
 * `composeEmail` is the one action the rest of the QMS uses to send as the
 * NICeMail mailbox; every NICeMail-specific step is in here and in
 * selectors.js. It is only ever called by transports/nicBrowserTransport.js,
 * after the outbound interlock has approved every recipient. Everything it
 * types is the message it was handed — never a credential; the session was
 * signed in by a human. It invents no content: subject and body come from the
 * QMS exactly as they are to be sent.
 *
 * It fails closed. Every check runs before Send is pressed — the addresses,
 * the account the form sends as, the recipients the form actually took, the
 * subject and body as the form holds them, each attachment uploaded and
 * scanned, no dialog over the form — and a failure there discards the draft
 * and sends nothing.
 *
 * Pressing Send is not taken as sending. A message counts as sent only when it
 * is in the Sent folder, newer than the moment Send was pressed. Anything short
 * of that, once Send has been pressed, is reported as unconfirmed: the message
 * may have gone, and the person retrying is told to check Sent first rather
 * than risk reaching the recipient twice.
 *
 * Each step is reported through `onStage` as it completes, and a failure
 * carries `failedStep` — the step it stopped at — and `seen`, what was on the
 * page, so the outbound record says where a send failed, not only that it did.
 *
 * Every step was calibrated against the live mailbox by
 * `npm run nic:browser:calibrate` before its keys left UNCALIBRATED.
 */

/** An address the form can take: one @, no spaces or brackets, a dotted domain. */
const ADDRESS = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
/** An address becomes a recipient chip within moments; this bounds the wait. */
const CHIP_TIMEOUT_MS = 5000;
/** Uploading and virus-scanning a file can take a while on a large one. */
const UPLOAD_TIMEOUT_MS = 60000;
/**
 * Zoho's message ids start with the server's time in ms; this allows for the
 * difference between that clock and this machine's (measured live at a few
 * seconds at most). Kept tight on purpose: an earlier message with the same
 * subject to the same recipient — a retried case, or a test re-run after a
 * database reset — must never fall inside it and confirm a press that sent
 * nothing. Every attempt takes far longer than this, so none can.
 */
const CLOCK_SKEW_MS = 10000;
/** The survey dialog opens within a few seconds of the mailbox loading. */
const SURVEY_WAIT_MS = 5000;
/** How long the editor may take to show text it was given. */
const BODY_SETTLE_MS = 2000;
/** A snapshot of the page is evidence, not a step: it must not hold a send up. */
const SNAPSHOT_TIMEOUT_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const firstLine = (error) => String(error?.message || error).split('\n')[0];

const refuse = (message, stage = 'validate') => Object.assign(new Error(message), { stage });

const unconfirmed = (message, cause) =>
  /**
   * `status` and `details` are for the case page's retry buttons, which reach
   * this through HTTP: without a status the error handler hides the message
   * outside development, and the one instruction that prevents a second copy
   * would arrive as a bare "Internal Server Error". 504: the mailbox, upstream
   * of this server, did not confirm in time.
   */
  Object.assign(
    new Error(
      `${message} Check the NICeMail Sent folder before retrying — a retry after a send that did go out ` +
        'reaches the recipient twice.',
    ),
    { unconfirmed: true, stage: 'confirm_send', cause, status: 504, details: { unconfirmed: true } },
  );

// ── Page-side (each receives pageKit as its second argument) ─────────────────

const entryShown = ({ spec }, kit) => kit.resolve(spec).elements.length > 0 || null;
const entryGone = ({ spec }, kit) => kit.resolve(spec, { raw: true }).elements.length === 0 || null;

const openRoute = ({ route }) => {
  location.hash = route;
  return true;
};

/** The entry's accessible name — e.g. "From <address>". */
const nameOfEntry = ({ spec }, kit) => {
  const element = kit.resolve(spec).elements[0];
  return element ? kit.nameOf(element) : null;
};

/**
 * Type one address into a recipient field and commit it with Enter — the
 * method the calibration proved turns an address into a recipient chip. The
 * value goes through the prototype's setter, as React needs.
 */
const typeRecipient = ({ spec, address }, kit) => {
  const input = kit.resolve(spec).elements[0];
  if (!input) return false;
  const view = input.ownerDocument.defaultView;
  input.focus();
  Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value').set.call(input, address);
  input.dispatchEvent(new view.InputEvent('input', { bubbles: true, data: address, inputType: 'insertText' }));
  for (const type of ['keydown', 'keypress', 'keyup']) {
    input.dispatchEvent(
      new view.KeyboardEvent(type, { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }),
    );
  }
  return true;
};

/** The addresses the recipient row of this input holds, one per chip. */
const recipientChips = ({ spec, chip }, kit) => {
  const input = kit.resolve(spec, { raw: true }).elements[0];
  const row = input?.closest('.zmCRow');
  if (!row) return null;
  return [...row.querySelectorAll(chip)].map((element) => element.getAttribute('aria-label').trim().toLowerCase());
};

const valueOf = ({ spec }, kit) => kit.resolve(spec).elements[0]?.value ?? null;

/** Focus an element, in its own frame — the editor's body is in an iframe. */
const focusEntry = ({ spec }, kit) => {
  const element = kit.resolve(spec).elements[0];
  if (!element) return false;
  element.ownerDocument.defaultView.frameElement?.focus();
  element.focus();
  return element.ownerDocument.activeElement === element;
};

const textOf = ({ spec }, kit) => {
  const element = kit.resolve(spec).elements[0];
  return element ? (element.innerText ?? element.textContent) : null;
};

/** The Sent folder is the one shown — its route, and the tree marking it current. */
const sentShown = (sel) =>
  location.hash === sel.sentFolderRoute &&
  document.querySelector(sel.folderActive)?.getAttribute('aria-label') === sel.folderSentLabel;

/** Truthy once the named file is listed and its upload and scan have finished. */
const attachmentReady = ({ row, filename }) => {
  const match = [...document.querySelectorAll(row)].find((element) => element.getAttribute('aria-label') === filename);
  if (!match) return null;
  return /scanning|uploading|%/i.test(match.textContent) ? null : true;
};

/**
 * The dialogs open over the page — name, a clip of the text, the buttons. A
 * dialog that holds the compose form itself is the form, not something in
 * front of it; `exclude` names what only the form has (its To field — a
 * confirmation prompt with a Send button of its own has none).
 */
const openDialogs = (argument, kit) => {
  const clip = (text, width) => kit.norm(text).slice(0, width);
  const inside = argument?.exclude ? kit.resolve(argument.exclude, { raw: true }).elements : [];
  const dialogs = [...new Set(kit.all('[role="dialog"], [role="alertdialog"], [aria-modal="true"]'))];
  return dialogs
    .filter((dialog) => kit.visible(dialog) && !inside.some((element) => dialog.contains(element)))
    .map((dialog) => ({
      name: clip(kit.nameOf(dialog), 80),
      text: clip(dialog.innerText ?? dialog.textContent, 120),
      buttons: [...dialog.querySelectorAll('button, [role="button"]')]
        .filter((button) => kit.visible(button))
        .map((button) => clip(kit.nameOf(button), 40))
        .filter(Boolean)
        .slice(0, 6),
    }));
};

/** Truthy once no visible dialog carries the survey's text. */
const surveyGone = ({ text }, kit) =>
  !kit
    .all('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')
    .some((dialog) => kit.visible(dialog) && kit.norm(dialog.innerText ?? dialog.textContent).includes(text)) || null;

/**
 * What the compose form looks like right now — the evidence for a send that
 * failed. Lengths of the body only, never its text; no cookies, no storage.
 */
const formState = ({ send, editor }, kit) => {
  const clip = (text, width = 80) => kit.norm(text).slice(0, width);
  const buttons = kit.resolve(send, { raw: true }).elements;
  const body = kit.resolve(editor, { raw: true }).elements[0] || null;
  const frame = body ? body.ownerDocument.defaultView.frameElement : null;
  const active = document.activeElement;
  return {
    hash: location.hash,
    live: [
      ...new Set(kit.all('[aria-live], [role="status"], [role="alert"]').map((element) => clip(element.innerText ?? element.textContent))),
    ]
      .filter(Boolean)
      .slice(0, 6),
    tabs: kit
      .all('[role="tab"]')
      .map((tab) => clip(kit.nameOf(tab), 60))
      .filter(Boolean)
      .slice(0, 10),
    send: {
      raw: buttons.length,
      visible: buttons.filter((button) => kit.visible(button)).length,
      disabled: buttons.filter((button) => button.disabled || button.getAttribute('aria-disabled') === 'true').length,
    },
    active: active && active !== document.body ? kit.summary(active) : null,
    editor: body
      ? {
          frameFocused: Boolean(frame) && document.activeElement === frame,
          focusedInFrame: body.ownerDocument.activeElement === body,
          heldLength: kit.norm(body.innerText ?? body.textContent).length,
        }
      : null,
  };
};

// ── Steps ────────────────────────────────────────────────────────────────────

const collapse = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** Everything that can be checked without a browser, checked before one is used. */
function preflight({ to, cc, attachments }) {
  if (!to.length) throw refuse('There is no recipient to send to; nothing was sent.');
  for (const address of [...to, ...cc]) {
    if (!ADDRESS.test(normaliseAddress(address))) {
      throw refuse(`"${address}" is not a valid email address; nothing was sent.`);
    }
  }
  if (attachments.length && UNCALIBRATED.has('fileInput')) {
    throw refuse(
      'Attachments cannot be sent through NICeMail until the attach control is calibrated ' +
        '(npm run nic:browser:calibrate -- --attach); nothing was sent.',
    );
  }
  if (!browserConfig.mailboxAddress) {
    throw refuse('NIC_EMAIL is not set, so the account NICeMail would send as cannot be checked; nothing was sent.');
  }
}

/** The page as it is, for a log line and a failure's `seen`. Never throws. */
async function snapshot(session) {
  const ask = (fn, argument) =>
    session
      .evaluate(fn, argument, { kit: pageKit, timeout: SNAPSHOT_TIMEOUT_MS })
      .catch((error) => ({ unavailable: firstLine(error) }));
  const dialogs = await ask(openDialogs, { exclude: SELECTORS.toInput });
  const form = await ask(formState, { send: SELECTORS.sendButton, editor: SELECTORS.bodyEditor });
  return { dialogs, ...form };
}

/** One line of what a snapshot shows: the dialogs, the Send button, the notices. */
function seenIn(snap) {
  if (!snap) return null;
  const parts = [];
  if (Array.isArray(snap.dialogs)) {
    parts.push(
      snap.dialogs.length
        ? `dialog open: ${snap.dialogs.map((dialog) => `"${dialog.name || dialog.text}"`).join(', ')}`
        : 'no dialog open',
    );
  }
  if (snap.send) {
    const where = snap.send.visible ? 'still visible' : snap.send.raw ? 'present but hidden' : 'gone';
    parts.push(`Send button ${where}${snap.send.disabled ? ' (disabled)' : ''}`);
  }
  if (snap.live?.length) parts.push(`notices: ${snap.live.join(' | ')}`);
  if (snap.unavailable) parts.push(`page did not answer: ${snap.unavailable}`);
  return parts.join('; ') || null;
}

const dialogNames = (dialogs) => dialogs.map((dialog) => `"${dialog.name || dialog.text}"`).join(', ');
const isSurvey = (dialog) => `${dialog.name} ${dialog.text}`.includes(SELECTORS.surveyDialogText);
const isFollowUpPrompt = (dialog) => `${dialog.name} ${dialog.text}`.includes(SELECTORS.followUpDialogText);

/**
 * After Send: wait for the compose form to close. Zoho may first ask whether
 * to add a follow-up reminder (when the body reads like it expects a reply)
 * and hold the message until answered; when that prompt is the one dialog
 * open, "Skip and Send" is pressed — once — so the message goes as written.
 * Anything else on the page is left alone. Resolves with whether the prompt
 * was answered; throws a timeout when the form never closes.
 */
async function awaitComposeClosed(session, { onSkipped }) {
  const deadline = Date.now() + browserConfig.timeoutMs;
  let skipped = false;
  for (;;) {
    if (await session.evaluate(entryGone, { spec: SELECTORS.sendButton }, { kit: pageKit })) return skipped;
    if (!skipped) {
      const dialogs = await session.evaluate(openDialogs, { exclude: SELECTORS.toInput }, { kit: pageKit });
      if (dialogs.length === 1 && isFollowUpPrompt(dialogs[0])) {
        const skip = await locate(session, SELECTORS.followUpSkipButton);
        if (skip) {
          await skip.click();
          skipped = true;
          onSkipped();
        }
      }
    }
    if (Date.now() > deadline) {
      throw new Error(`Timeout ${browserConfig.timeoutMs}ms exceeded waiting for the compose form to close after Send`);
    }
    await sleep(250);
  }
}

/**
 * Close NICeMail's survey dialog if it is open, or opens within `waitMs`, with
 * its own Close button — found by exact name, and pressed only when the survey
 * is the one dialog open. "Participate now!" is never pressed. Returns
 * 'closed' or 'absent'; refuses (nothing sent) when it cannot be closed.
 */
async function closeSurvey(session, { waitMs = 0 } = {}) {
  const deadline = Date.now() + waitMs;
  const ask = () => session.evaluate(openDialogs, { exclude: SELECTORS.toInput }, { kit: pageKit });
  let dialogs = await ask();
  while (!dialogs.some(isSurvey) && Date.now() < deadline) {
    await sleep(250);
    dialogs = await ask();
  }
  if (!dialogs.some(isSurvey)) return 'absent';

  if (!dialogs.every(isSurvey)) {
    throw refuse(`NICeMail shows a dialog besides its survey (${dialogNames(dialogs)}); nothing was sent.`, 'ui');
  }
  const close = await locate(session, SELECTORS.surveyCloseButton);
  if (!close) {
    throw refuse('NICeMail\'s survey dialog has no single "Close" button to dismiss it; nothing was sent.', 'ui');
  }
  await close.click();
  await session
    .waitFor(surveyGone, {
      timeout: Math.min(SURVEY_WAIT_MS, browserConfig.timeoutMs),
      argument: { text: SELECTORS.surveyDialogText },
      kit: pageKit,
    })
    .catch(() => {
      throw refuse('NICeMail\'s survey dialog did not close; nothing was sent.', 'ui');
    });
  return 'closed';
}

async function openCompose(session) {
  await (await requireElement(session, 'composeButton')).first().click();
  for (const key of ['toInput', 'sendButton']) {
    await session.waitFor(entryShown, { timeout: browserConfig.timeoutMs, argument: { spec: SELECTORS[key] }, kit: pageKit });
  }
}

/** The form must send as the mailbox the QMS files this case under. */
async function checkSender(session) {
  await requireElement(session, 'fromAddress');
  const from = await session.evaluate(nameOfEntry, { spec: SELECTORS.fromAddress }, { kit: pageKit });
  if (!String(from || '').toLowerCase().includes(browserConfig.mailboxAddress)) {
    throw refuse(
      `NICeMail would send this from a different account than ${browserConfig.mailboxAddress}. ` +
        'Sign in to that mailbox in the dedicated Chrome; nothing was sent.',
      'verify_session',
    );
  }
}

async function addRecipients(session, key, addresses) {
  await requireElement(session, key);
  const argument = { spec: SELECTORS[key], chip: SELECTORS.recipientChip };
  for (const address of addresses) {
    const wanted = normaliseAddress(address);
    await session.evaluate(typeRecipient, { spec: SELECTORS[key], address: wanted }, { kit: pageKit });
    const started = Date.now();
    while (!(await session.evaluate(recipientChips, argument, { kit: pageKit }))?.includes(wanted)) {
      if (Date.now() - started > Math.min(CHIP_TIMEOUT_MS, browserConfig.timeoutMs)) {
        throw refuse(`NICeMail did not take "${wanted}" as a recipient; nothing was sent.`, 'ui');
      }
      await sleep(200);
    }
  }
}

/** Exactly the intended recipients — an autocomplete that picked someone else, or a leftover chip, stops the send. */
async function checkRecipients(session, key, addresses) {
  const held = await session.evaluate(recipientChips, { spec: SELECTORS[key], chip: SELECTORS.recipientChip }, { kit: pageKit });
  const wanted = [...new Set(addresses.map(normaliseAddress))].sort();
  const actual = [...new Set(held || [])].sort();
  if (JSON.stringify(wanted) !== JSON.stringify(actual)) {
    throw refuse(
      `The NICeMail ${key === 'toInput' ? 'To' : 'Cc'} line holds ${actual.length} recipient(s), not the ` +
        `${wanted.length} intended; nothing was sent.`,
      'ui',
    );
  }
}

async function checkSubject(session, subject) {
  const held = await session.evaluate(valueOf, { spec: SELECTORS.subjectInput }, { kit: pageKit });
  if (held !== subject) throw refuse('The NICeMail subject line did not take the subject; nothing was sent.', 'ui');
}

async function fillSubject(session, subject) {
  await (await requireElement(session, 'subjectInput')).first().fill(subject);
  await checkSubject(session, subject);
}

/** The body as the editor holds it — polled briefly, as the editor lays text out. */
async function checkBody(session, body) {
  const deadline = Date.now() + Math.min(BODY_SETTLE_MS, browserConfig.timeoutMs);
  for (;;) {
    const held = collapse(await session.evaluate(textOf, { spec: SELECTORS.bodyEditor }, { kit: pageKit }));
    if (held.includes(collapse(body))) return held.length;
    if (Date.now() > deadline) {
      throw refuse('The NICeMail message editor does not hold the message body; nothing was sent.', 'ui');
    }
    await sleep(100);
  }
}

/** Typed into the editor as text, the way a person would: the editor takes
 *  line breaks as its own paragraphs, and nothing in the text is read as markup. */
async function fillBody(session, body) {
  await requireElement(session, 'bodyEditor');
  if (!(await session.evaluate(focusEntry, { spec: SELECTORS.bodyEditor }, { kit: pageKit }))) {
    throw refuse('The NICeMail message editor could not be focused; nothing was sent.', 'ui');
  }
  await session.send('Input.insertText', { text: String(body ?? '') });
  return checkBody(session, body);
}

/**
 * There is no file input in the form: "Attach from my computer" opens a file
 * chooser, which is intercepted and handed the staged files. Each file must
 * then be listed with its upload and virus scan finished before Send.
 */
/**
 * The name to write inside the staging directory.
 *
 * `filename` reaches here from whatever an external sender called the file:
 * NICeMail's attachment row → the attachment store's metadata → the forward.
 * attachmentPolicy checks the extension, the type and the size, and never the
 * path, so "../../../x.pdf" passes every one of those and would resolve
 * outside the staging directory. basename() is what makes join() safe; the
 * rejection covers the names basename() can still return ('', '.', '..').
 *
 * NICeMail shows the file under the name on disk, so the name is preserved
 * rather than replaced by an index.
 */
function stagedName(filename) {
  const name = basename(String(filename || '').trim());
  if (!name || name === '.' || name === '..') {
    throw refuse(`An attachment has an unusable filename (${filename}); nothing was sent.`, 'validate');
  }
  return name;
}

async function attachFiles(session, attachments) {
  const staging = await mkdtemp(join(tmpdir(), 'qms-nic-send-'));
  let chooser = null;
  const off = session.on('Page.fileChooserOpened', (params) => {
    chooser = params;
  });
  try {
    const paths = [];
    for (const attachment of attachments) {
      const path = join(staging, stagedName(attachment.filename));
      await writeFile(path, attachment.content);
      paths.push(path);
    }

    await session.send('Page.enable');
    await session.send('Page.setInterceptFileChooserDialog', { enabled: true });
    await (await requireElement(session, 'fileInput')).first().click();
    const started = Date.now();
    while (!chooser) {
      if (Date.now() - started > browserConfig.timeoutMs) throw refuse('NICeMail did not open its file chooser; nothing was sent.', 'ui');
      await sleep(100);
    }
    await session.send('DOM.enable');
    await session.send('DOM.setFileInputFiles', { files: paths, backendNodeId: chooser.backendNodeId });

    for (const { filename } of attachments) {
      await session
        .waitFor(attachmentReady, {
          timeout: Math.max(browserConfig.timeoutMs, UPLOAD_TIMEOUT_MS),
          argument: { row: SELECTORS.composeAttachmentRow, filename },
        })
        .catch(() => {
          throw refuse(`NICeMail did not finish uploading "${filename}"; nothing was sent.`, 'ui');
        });
    }
  } finally {
    off();
    await session.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Nothing may stand between the checked form and Send. The survey is closed —
 * and since it may have taken the focus while it was open, the form is checked
 * again. Any other dialog stops the send: what it asks is unknown, and a click
 * on Send might answer it instead of sending.
 */
async function clearBeforeSend(session, { to, cc, subject, body }) {
  const ask = () => session.evaluate(openDialogs, { exclude: SELECTORS.toInput }, { kit: pageKit });
  const blocked = (dialogs) =>
    refuse(`NICeMail shows a dialog (${dialogNames(dialogs)}), so Send was not pressed; nothing was sent.`, 'ui');

  const dialogs = await ask();
  if (!dialogs.length) return;
  if (!dialogs.every(isSurvey)) throw blocked(dialogs);

  await closeSurvey(session);
  await checkRecipients(session, 'toInput', to);
  if (cc.length) await checkRecipients(session, 'ccInput', cc);
  await checkSubject(session, subject);
  await checkBody(session, body);
  // Last, straight before Send: closing the survey may have opened something
  // else, and nothing at all may be open when Send is pressed.
  const left = await ask();
  if (left.length) throw blocked(left);
}

/** Close the form without sending, so a failed send leaves no draft behind. Best effort. */
async function discardDraft(session) {
  const discard = await locate(session, SELECTORS.discardButton).catch(() => null);
  if (!discard) return;
  await discard.click();
  await session
    .waitFor(entryGone, { timeout: browserConfig.timeoutMs, argument: { spec: SELECTORS.toInput }, kit: pageKit })
    .catch(() => {});
}

/**
 * The sent message, found in the Sent folder: same subject, the recipient on
 * it, and newer than the moment Send was pressed — an older message with the
 * same subject can never confirm this one. Rows are read only once the Sent
 * folder is the one shown: every folder shares one list, and until Sent has
 * loaded it still holds the Inbox. Null if it does not appear in time.
 */
async function findInSent(session, { subject, to, since }) {
  const wanted = to.map(normaliseAddress);
  try {
    await session.evaluate(openRoute, { route: SELECTORS.sentFolderRoute });
    const deadline = Date.now() + browserConfig.timeoutMs;
    for (;;) {
      const shown = await session.evaluate(sentShown, SELECTORS).catch(() => false);
      const rows = (shown && (await session.evaluate(listRows, SELECTORS).catch(() => null))) || [];
      const match = rows.find(
        (row) =>
          collapse(row.subject) === collapse(subject) &&
          wanted.some((address) => String(row.senderAddress).toLowerCase().includes(address)) &&
          Number(String(row.providerMessageId).slice(0, 13)) >= since,
      );
      if (match) return match;
      if (Date.now() > deadline) return null;
      await sleep(1000);
    }
  } finally {
    await session.evaluate(openRoute, { route: SELECTORS.folderRoute }).catch(() => {});
  }
}

/**
 * Send one message as the NICeMail mailbox.
 *
 * Resolves `{ ok: true, providerMessageId, sentAt }` — the id is the message's
 * own in the Sent folder — only once the send is proven. Throws otherwise, with
 * `failedStep` (the step it stopped at) and `seen` (what was on the page);
 * `unconfirmed: true` whenever Send may have been pressed, since from then on
 * the message may have gone.
 *
 * `onStage(phase, data)` hears each step as it completes: 'NIC BROWSER' up to
 * and including the press of Send, 'VERIFICATION' after it.
 */
export async function composeEmail(
  { to = [], cc = [], subject = '', body = '', attachments = [] },
  { connect, onStage = null } = {},
) {
  const emit = (phase, data) => {
    try {
      onStage?.(phase, data);
    } catch {
      // A log line is never the reason a send fails.
    }
  };

  try {
    preflight({ to, cc, attachments });
  } catch (error) {
    throw Object.assign(error, { failedStep: 'validate' });
  }
  emit('NIC BROWSER', { step: 'compose_started', to, ...(cc.length ? { cc } : {}), attachments: attachments.length });

  return withNicemail(
    async (session) => {
      let current = 'close_survey';
      let opened = false;
      let pressed = false;
      const done = (step, data = {}) => emit('NIC BROWSER', { step, ...data });

      try {
        done('browser_ready');
        done(`survey_${await closeSurvey(session, { waitMs: Math.min(SURVEY_WAIT_MS, browserConfig.timeoutMs) })}`);

        current = 'open_compose';
        await openCompose(session);
        opened = true;
        done('compose_opened');

        current = 'verify_from';
        await checkSender(session);
        done('from_verified', { from: browserConfig.mailboxAddress });

        current = 'enter_recipients';
        await addRecipients(session, 'toInput', to);
        done('recipient_entered', { field: 'To', recipients: to });
        if (cc.length) {
          if (!(await locate(session, SELECTORS.ccInput))) {
            await (await requireElement(session, 'ccToggle')).first().click();
            await session.waitFor(entryShown, { timeout: browserConfig.timeoutMs, argument: { spec: SELECTORS.ccInput }, kit: pageKit });
          }
          await addRecipients(session, 'ccInput', cc);
          done('recipient_entered', { field: 'Cc', recipients: cc });
        }

        current = 'verify_recipients';
        await checkRecipients(session, 'toInput', to);
        if (cc.length) await checkRecipients(session, 'ccInput', cc);
        done('recipients_verified');

        current = 'fill_subject';
        await fillSubject(session, subject);
        done('subject_verified', { subject });

        current = 'fill_body';
        const heldLength = await fillBody(session, body);
        done('body_verified', { heldLength, expectedLength: collapse(body).length });

        if (attachments.length) {
          current = 'attach_files';
          await attachFiles(session, attachments);
          done('attachments_ready', { count: attachments.length });
        }

        current = 'pre_send_check';
        await clearBeforeSend(session, { to, cc, subject, body });
        done('pre_send_clear');

        // Held on to, not looked up again: a successful send removes the
        // button, and a fresh lookup would report that success as "not found".
        current = 'click_send';
        const sendButton = (await requireElement(session, 'sendButton')).first();
        const since = Date.now() - CLOCK_SKEW_MS;
        pressed = true;
        await sendButton.click();
        done('send_clicked');

        current = 'await_compose_close';
        const started = Date.now();
        let notClosed = null;
        try {
          const skipped = await awaitComposeClosed(session, { onSkipped: () => done('follow_up_reminder_skipped') });
          emit('VERIFICATION', { step: 'compose_closed', afterMs: Date.now() - started, followUpSkipped: skipped });
        } catch (cause) {
          // Still looked for in Sent: the form staying open does not prove
          // the message stayed with it.
          const snap = await snapshot(session);
          notClosed = { cause, seen: seenIn(snap) };
          emit('VERIFICATION', { step: 'compose_not_closed', afterMs: Date.now() - started, cause: firstLine(cause), snapshot: snap });
        }

        current = 'find_in_sent';
        const sent = await findInSent(session, { subject, to, since });
        if (sent) {
          emit('VERIFICATION', { step: 'sent_found', providerMessageId: sent.providerMessageId, formClosed: !notClosed });
          return { ok: true, providerMessageId: sent.providerMessageId, sentAt: new Date().toISOString() };
        }
        emit('VERIFICATION', { step: 'sent_not_found' });

        if (notClosed) {
          throw Object.assign(unconfirmed('NICeMail may have sent this message but did not confirm it in time.', notClosed.cause), {
            failedStep: 'await_compose_close',
            seen: notClosed.seen,
          });
        }
        throw Object.assign(
          unconfirmed(
            'NICeMail may have sent this message: the compose form closed, but the message did not appear ' +
              'in the Sent folder in time.',
          ),
          { failedStep: 'find_in_sent' },
        );
      } catch (error) {
        // A click that resolved nothing dispatched nothing: Send was not pressed.
        if (current === 'click_send' && error?.dispatched === false) pressed = false;

        if (pressed) {
          // From the press of Send on, nothing can be reported as "not sent".
          if (error?.unconfirmed) throw error;
          throw Object.assign(unconfirmed('NICeMail may have sent this message, but the send could not be checked.', error), {
            failedStep: current,
          });
        }

        error.failedStep ??= current;
        const snap = await snapshot(session);
        error.seen ??= seenIn(snap);
        emit('NIC BROWSER', { step: 'failed', failedStep: error.failedStep, error: firstLine(error), snapshot: snap });
        if (opened) await discardDraft(session).catch(() => {});
        throw error;
      }
    },
    { connect },
  ).catch((error) => {
    // Reaching Chrome, finding the signed-in tab, loading the mailbox.
    if (error && typeof error === 'object') error.failedStep ??= 'open_browser_tab';
    throw error;
  });
}

/** The name the transport and its tests have always used. */
export const sendMail = composeEmail;

// Page-side, for the tests that run them against a real DOM.
export { openDialogs, formState };
