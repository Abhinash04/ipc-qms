import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';

import browserConfig from '../../../../config/browserConfig.js';
import { normaliseAddress } from '../../mailbox/address.js';
import { pageKit } from './pageKit.js';
import { listRows } from './readInbox.js';
import { withNicemail } from './session.js';
import { SELECTORS, UNCALIBRATED, locate, requireElement } from './selectors.js';

const ADDRESS = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const CHIP_TIMEOUT_MS = 5000;
const UPLOAD_TIMEOUT_MS = 60000;
const CLOCK_SKEW_MS = 10000;
const SURVEY_WAIT_MS = 5000;
const BODY_SETTLE_MS = 2000;
const SNAPSHOT_TIMEOUT_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const firstLine = (error) => String(error?.message || error).split('\n')[0];

const refuse = (message, stage = 'validate') => Object.assign(new Error(message), { stage });

const unconfirmed = (message, cause) =>
  Object.assign(
    new Error(
      `${message} Check the NICeMail Sent folder before retrying — a retry after a send that did go out ` +
        'reaches the recipient twice.',
    ),
    { unconfirmed: true, stage: 'confirm_send', cause, status: 504, details: { unconfirmed: true } },
  );

const entryShown = ({ spec }, kit) => kit.resolve(spec).elements.length > 0 || null;
const entryGone = ({ spec }, kit) => kit.resolve(spec, { raw: true }).elements.length === 0 || null;

const openRoute = ({ route }) => {
  location.hash = route;
  return true;
};

const nameOfEntry = ({ spec }, kit) => {
  const element = kit.resolve(spec).elements[0];
  return element ? kit.nameOf(element) : null;
};

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

const recipientChips = ({ spec, chip }, kit) => {
  const input = kit.resolve(spec, { raw: true }).elements[0];
  const row = input?.closest('.zmCRow');
  if (!row) return null;
  return [...row.querySelectorAll(chip)].map((element) => element.getAttribute('aria-label').trim().toLowerCase());
};

const valueOf = ({ spec }, kit) => kit.resolve(spec).elements[0]?.value ?? null;

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

const sentShown = (sel) =>
  location.hash === sel.sentFolderRoute &&
  document.querySelector(sel.folderActive)?.getAttribute('aria-label') === sel.folderSentLabel;

const attachmentReady = ({ row, filename }) => {
  const match = [...document.querySelectorAll(row)].find((element) => element.getAttribute('aria-label') === filename);
  if (!match) return null;
  return /scanning|uploading|%/i.test(match.textContent) ? null : true;
};

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

const surveyGone = ({ text }, kit) =>
  !kit
    .all('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')
    .some((dialog) => kit.visible(dialog) && kit.norm(dialog.innerText ?? dialog.textContent).includes(text)) || null;

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

const collapse = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

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

async function snapshot(session) {
  const ask = (fn, argument) =>
    session
      .evaluate(fn, argument, { kit: pageKit, timeout: SNAPSHOT_TIMEOUT_MS })
      .catch((error) => ({ unavailable: firstLine(error) }));
  const dialogs = await ask(openDialogs, { exclude: SELECTORS.toInput });
  const form = await ask(formState, { send: SELECTORS.sendButton, editor: SELECTORS.bodyEditor });
  return { dialogs, ...form };
}

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

async function fillBody(session, body) {
  await requireElement(session, 'bodyEditor');
  if (!(await session.evaluate(focusEntry, { spec: SELECTORS.bodyEditor }, { kit: pageKit }))) {
    throw refuse('The NICeMail message editor could not be focused; nothing was sent.', 'ui');
  }
  await session.send('Input.insertText', { text: String(body ?? '') });
  return checkBody(session, body);
}

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
  const left = await ask();
  if (left.length) throw blocked(left);
}

async function discardDraft(session) {
  const discard = await locate(session, SELECTORS.discardButton).catch(() => null);
  if (!discard) return;
  await discard.click();
  await session
    .waitFor(entryGone, { timeout: browserConfig.timeoutMs, argument: { spec: SELECTORS.toInput }, kit: pageKit })
    .catch(() => {});
}

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

export async function composeEmail(
  { to = [], cc = [], subject = '', body = '', attachments = [] },
  { connect, onStage = null } = {},
) {
  const emit = (phase, data) => {
    try {
      onStage?.(phase, data);
    } catch {}
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
        if (current === 'click_send' && error?.dispatched === false) pressed = false;

        if (pressed) {
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
    if (error && typeof error === 'object') error.failedStep ??= 'open_browser_tab';
    throw error;
  });
}

export const sendMail = composeEmail;

export { openDialogs, formState };
