import '../config/env.js';
import { mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import browserConfig from '../config/browserConfig.js';
import { redact } from '../services/email/nic/browser/inspect.js';
import { pageKit } from '../services/email/nic/browser/pageKit.js';
import { listRows } from '../services/email/nic/browser/readInbox.js';
import { SELECTORS, locate } from '../services/email/nic/browser/selectors.js';
import { withNicemail } from '../services/email/nic/browser/session.js';

const args = process.argv.slice(2);
const attach = args.includes('--attach');
const showAddresses = args.includes('--show-addresses');
const COMPOSE_KEYS = [
  'composeButton',
  'toInput',
  'ccInput',
  'ccToggle',
  'subjectInput',
  'bodyEditor',
  'fileInput',
  'sendButton',
  'discardButton',
  'fromAddress',
];

const unlocked = (key) => ({ ...SELECTORS[key] });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const firstLine = (error) => String(error?.message || error).split('\n')[0];
const resolveEntries = ({ entries }, kit) =>
  entries.map(([key, entry]) => {
    const checked = kit.resolve(entry);
    const raw = kit.resolve(entry, { raw: true });
    const sample = checked.elements[0] || raw.elements[0];
    return {
      key,
      strategy: checked.strategy,
      count: checked.elements.length,
      raw: raw.elements.length,
      tried: checked.tried,
      sample: sample ? kit.summary(sample) : null,
    };
  });

const entryShown = ({ spec }, kit) => kit.resolve(spec).elements.length > 0 || null;
const entryGone = ({ spec }, kit) => kit.resolve(spec, { raw: true }).elements.length === 0 || null;

const hashNow = () => location.hash;
const setHash = ({ hash }) => {
  location.hash = hash;
  return true;
};
const activeFolderIs = ({ label }) =>
  document.querySelector('[role="treeitem"].zmCurTree')?.getAttribute('aria-label') === label || null;
const rowShape = ({ listRow }) => {
  const row = document.querySelector(listRow);
  if (!row) return null;
  return {
    attributes: [...row.attributes].map((attribute) => attribute.name),
    cells: [...new Set([...row.querySelectorAll('[data-action], [data-testid]')].map((cell) => cell.getAttribute('data-action') || cell.getAttribute('data-testid')))],
  };
};
const clearInput = ({ spec }, kit) => {
  const input = kit.resolve(spec).elements[0];
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(input.ownerDocument.defaultView.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '');
  input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true }));
  return true;
};

const commitInPage = ({ spec, address, method }, kit) => {
  const input = kit.resolve(spec).elements[0];
  if (!input) return false;
  const view = input.ownerDocument.defaultView;
  const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value').set;
  const key = (type, init) => input.dispatchEvent(new view.KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }));

  input.focus();
  setter.call(input, method === 'comma' ? `${address},` : address);
  input.dispatchEvent(new view.InputEvent('input', { bubbles: true, data: address, inputType: 'insertText' }));
  if (method === 'setter+enter') {
    for (const type of ['keydown', 'keypress', 'keyup']) key(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
  }
  if (method === 'comma') {
    for (const type of ['keydown', 'keypress', 'keyup']) key(type, { key: ',', code: 'Comma', keyCode: 188, which: 188 });
  }
  if (method === 'blur') {
    input.dispatchEvent(new view.FocusEvent('blur'));
    input.dispatchEvent(new view.FocusEvent('focusout', { bubbles: true }));
    input.blur();
  }
  return true;
};

const focusEntry = ({ spec }, kit) => {
  const element = kit.resolve(spec).elements[0];
  if (!element) return false;
  element.ownerDocument.defaultView.frameElement?.focus();
  element.focus();
  return element.ownerDocument.activeElement === element || element.ownerDocument.hasFocus();
};
const recipientState = ({ spec, address }, kit) => {
  const input = kit.resolve(spec, { raw: true }).elements[0];
  if (!input) return null;
  const row = input.closest('.zmCRow') || input.parentElement;
  const needle = address.toLowerCase();
  const holders = [...row.querySelectorAll('*')].filter(
    (element) =>
      element !== input &&
      ([...element.attributes].some((attribute) => attribute.value.toLowerCase().includes(needle)) ||
        (element.children.length === 0 && (element.textContent || '').toLowerCase().includes(needle))),
  );
  return {
    inputValue: input.value,
    holders: holders.slice(0, 6).map((element) => ({
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role'),
      classes: [...element.classList].filter((name) => !/__[a-z0-9]{5,}$/i.test(name)).slice(0, 4),
      attributes: [...element.attributes]
        .filter((attribute) => attribute.value.toLowerCase().includes(needle) || /^(data-|aria-|role|title)/.test(attribute.name))
        .map((attribute) => `${attribute.name}=${attribute.value.slice(0, 80)}`),
      text: (element.textContent || '').trim().slice(0, 80),
    })),
  };
};

const inputValue = ({ spec }, kit) => kit.resolve(spec).elements[0]?.value ?? null;
const writeBodyHtml = ({ spec, lines }, kit) => {
  const body = kit.resolve(spec).elements[0];
  if (!body) return false;
  const view = body.ownerDocument.defaultView;
  const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  body.focus();
  body.innerHTML = lines.map((line) => `<div>${escape(line) || '<br>'}</div>`).join('');
  body.dispatchEvent(new view.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
  body.dispatchEvent(new view.KeyboardEvent('keyup', { bubbles: true, key: 'End' }));
  return true;
};

const bodyText = ({ spec }, kit) => {
  const body = kit.resolve(spec).elements[0];
  return body ? { text: body.innerText ?? body.textContent, html: body.innerHTML.slice(0, 300) } : null;
};

const clearBody = ({ spec }, kit) => {
  const body = kit.resolve(spec).elements[0];
  if (!body) return false;
  body.innerHTML = '<div><br></div>';
  return true;
};
const tabLabels = () =>
  [...document.querySelectorAll('[role="tab"]')].map((tab) => (tab.getAttribute('aria-label') || tab.textContent || '').trim());

const openDialogs = (_, kit) =>
  kit
    .all('[role="dialog"], [role="alertdialog"]')
    .filter((dialog) => kit.visible(dialog))
    .map((dialog) => ({
      name: kit.nameOf(dialog).slice(0, 80),
      text: kit.norm(dialog.textContent).slice(0, 160),
      buttons: [...dialog.querySelectorAll('button, [role="button"]')].filter((button) => kit.visible(button)).map((button) => kit.nameOf(button)),
    }));

const liveRegions = (_, kit) =>
  kit.all('[role="status"], [role="alert"], [aria-live]').map((region) => kit.norm(region.textContent).slice(0, 120)).filter(Boolean);

const attachmentArea = ({ spec, stem }, kit) => {
  const button = kit.resolve(spec, { raw: true }).elements[0];
  const row = button?.closest('.zmCRAtt') || button?.closest('.zmCAttListWra')?.parentElement;
  if (!row) return null;
  const named = [...row.querySelectorAll('*')].filter((element) =>
    [element.getAttribute('title'), element.getAttribute('aria-label'), element.children.length ? '' : element.textContent]
      .some((value) => (value || '').includes(stem)),
  );
  return {
    text: kit.norm(row.innerText ?? row.textContent).slice(0, 200),
    elements: row.querySelectorAll('*').length,
    named: named.slice(0, 4).map((element) => ({
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role'),
      classes: [...element.classList].filter((name) => !/__[a-z0-9]{5,}$/i.test(name)).slice(0, 4),
      testid: element.getAttribute('data-testid'),
      title: element.getAttribute('title'),
      label: element.getAttribute('aria-label'),
      text: kit.norm(element.textContent).slice(0, 80),
    })),
  };
};

async function resolveKeys(session, keys) {
  return session.evaluate(resolveEntries, { entries: keys.map((key) => [key, SELECTORS[key]]) }, { kit: pageKit });
}

async function click(session, key) {
  const found = await locate(session, unlocked(key));
  if (!found) throw new Error(`"${key}" did not resolve`);
  await found.click();
}

async function waitShown(session, key, timeout = browserConfig.timeoutMs) {
  await session.waitFor(entryShown, { timeout, argument: { spec: unlocked(key) }, kit: pageKit });
}

async function visitFolder(session, key, label) {
  await click(session, key);
  await session.waitFor(activeFolderIs, { timeout: browserConfig.timeoutMs, argument: { label } });
  await sleep(1500);
  const rows = await session.evaluate(listRows, SELECTORS);
  return {
    hash: await session.evaluate(hashNow),
    rows: rows.length,
    shape: await session.evaluate(rowShape, { listRow: SELECTORS.listRow }),
    sample: rows.slice(0, 3).map((row) => ({ id: row.providerMessageId, to: row.senderAddress, subject: row.subject })),
    subjects: rows.map((row) => row.subject),
  };
}

async function backToInbox(session) {
  await session.evaluate(setHash, { hash: SELECTORS.folderRoute });
  await session.waitFor(activeFolderIs, { timeout: browserConfig.timeoutMs, argument: { label: SELECTORS.folderInboxLabel } });
}

async function tryRecipient(session, address) {
  const spec = unlocked('toInput');
  const attempts = [];
  for (const method of ['setter+enter', 'cdp-insert+enter', 'comma', 'blur']) {
    await session.evaluate(clearInput, { spec }, { kit: pageKit });
    if (method === 'cdp-insert+enter') {
      const focused = await session.evaluate(focusEntry, { spec }, { kit: pageKit });
      await session.send('Input.insertText', { text: address });
      await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      attempts.push({ method, focused });
    } else {
      await session.evaluate(commitInPage, { spec, address, method }, { kit: pageKit });
      attempts.push({ method });
    }
    await sleep(1500);
    const state = await session.evaluate(recipientState, { spec, address }, { kit: pageKit });
    Object.assign(attempts.at(-1), state);
    if (state?.holders.length && !state.inputValue.toLowerCase().includes(address.toLowerCase())) {
      return { chosen: method, attempts };
    }
  }
  return { chosen: null, attempts };
}

async function tryBody(session, lines) {
  const spec = unlocked('bodyEditor');
  const results = [];

  await session.evaluate(writeBodyHtml, { spec, lines }, { kit: pageKit });
  await sleep(500);
  results.push({ method: 'innerHTML', readBack: await session.evaluate(bodyText, { spec }, { kit: pageKit }) });

  await session.evaluate(clearBody, { spec }, { kit: pageKit });
  const focused = await session.evaluate(focusEntry, { spec }, { kit: pageKit });
  await session.send('Input.insertText', { text: lines.join('\n') });
  await sleep(500);
  results.push({ method: 'cdp-insert', focused, readBack: await session.evaluate(bodyText, { spec }, { kit: pageKit }) });

  return results;
}

async function tryAttach(session) {
  const staging = path.join(tmpdir(), `qms-nic-calibrate-${Date.now()}`);
  await mkdir(staging, { recursive: true });
  const filename = `calibration-${Date.now()}.pdf`;
  const file = path.join(staging, filename);
  await writeFile(file, Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'));

  let opened = null;
  const off = session.on('Page.fileChooserOpened', (params) => {
    opened = params;
  });
  try {
    await session.send('Page.enable');
    await session.send('Page.setInterceptFileChooserDialog', { enabled: true });
    await click(session, 'fileInput');
    const started = Date.now();
    while (!opened && Date.now() - started < 8000) await sleep(100);
    if (!opened) return { ok: false, reason: 'no file chooser opened', filename };
    const argument = { spec: unlocked('fileInput'), stem: filename.replace(/\.pdf$/, '').slice(0, 14) };
    const before = await session.evaluate(attachmentArea, argument, { kit: pageKit });
    await session.send('DOM.enable');
    await session.send('DOM.setFileInputFiles', { files: [file], backendNodeId: opened.backendNodeId });
    const snapshots = [];
    const uploadStarted = Date.now();
    while (Date.now() - uploadStarted < 45000) {
      await sleep(1000);
      const area = await session.evaluate(attachmentArea, argument, { kit: pageKit });
      if (JSON.stringify(area) !== JSON.stringify(snapshots.at(-1)?.area)) snapshots.push({ afterMs: Date.now() - uploadStarted, area });
      if (area?.named.length && !/scanning|uploading|%/i.test(area.text)) break;
    }
    const last = snapshots.at(-1)?.area;
    return {
      ok: Boolean(last?.named.length) && !/scanning|uploading|%/i.test(last.text),
      chooser: { mode: opened.mode, backendNodeId: Boolean(opened.backendNodeId) },
      filename,
      before,
      snapshots,
    };
  } finally {
    off();
    await session.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

async function discard(session) {
  const started = Date.now();
  await click(session, 'discardButton');
  await sleep(1500);
  const dialogs = await session.evaluate(openDialogs, null, { kit: pageKit });
  let confirmedWith = null;
  const dialog = dialogs.find((candidate) => candidate.buttons.some((name) => /discard|delete|yes|ok/i.test(name)));
  if (dialog) {
    confirmedWith = dialog.buttons.find((name) => /discard|delete|yes|ok/i.test(name));
    const found = await locate(session, { strategies: [{ role: 'button', name: confirmedWith }], visible: true, unique: true });
    if (found) await found.click();
    await sleep(1500);
  }
  const closed = await session
    .waitFor(entryGone, { timeout: browserConfig.timeoutMs, argument: { spec: unlocked('toInput') }, kit: pageKit })
    .then(() => true)
    .catch(() => false);
  return { dialogs, confirmedWith, closed, closedAfterMs: closed ? Date.now() - started : null };
}

async function calibrate(session) {
  const report = { at: new Date().toISOString(), steps: {} };
  const recipient = browserConfig.testRecipient;
  if (!recipient) throw new Error('NIC_BROWSER_TEST_RECIPIENT (or NIC_TEST_RECIPIENT / NIC_EMAIL) is not set.');
  const marker = `IPC-QMS calibration dry run ${report.at}`;
  const lines = ['IPC-QMS calibration dry run.', 'This draft is discarded without being sent.'];

  report.steps.sent = await visitFolder(session, 'folderSent', 'Sent');
  report.steps.draftsBefore = await visitFolder(session, 'folderDrafts', 'Drafts');
  await backToInbox(session);

  report.steps.beforeCompose = await resolveKeys(session, COMPOSE_KEYS);
  await click(session, 'composeButton');
  await waitShown(session, 'toInput');
  await waitShown(session, 'sendButton');
  report.steps.hashInCompose = await session.evaluate(hashNow);
  report.steps.compose = await resolveKeys(session, COMPOSE_KEYS);

  const [from] = report.steps.compose.filter((result) => result.key === 'fromAddress');
  report.steps.fromMatchesMailbox = Boolean(
    from?.sample?.name && browserConfig.mailboxAddress && from.sample.name.toLowerCase().includes(browserConfig.mailboxAddress),
  );

  report.steps.recipient = await tryRecipient(session, recipient);

  const subject = await locate(session, unlocked('subjectInput'));
  await subject.fill(marker);
  await sleep(800);
  report.steps.subject = {
    readBack: await session.evaluate(inputValue, { spec: unlocked('subjectInput') }, { kit: pageKit }),
    tabs: await session.evaluate(tabLabels),
  };
  report.steps.subject.ok = report.steps.subject.readBack === marker;
  report.steps.subject.appSawIt = report.steps.subject.tabs.some((label) => label.includes('calibration dry run'));

  report.steps.body = await tryBody(session, lines);
  report.steps.liveRegions = await session.evaluate(liveRegions, null, { kit: pageKit });

  if (attach) report.steps.attach = await tryAttach(session).catch((error) => ({ ok: false, reason: firstLine(error) }));

  report.steps.discard = await discard(session);
  await backToInbox(session).catch(() => {});
  const draftsAfter = await visitFolder(session, 'folderDrafts', 'Drafts');
  report.steps.draftLeftBehind = draftsAfter.subjects.some((text) => text.includes('calibration dry run'));
  await backToInbox(session).catch(() => {});

  delete report.steps.draftsBefore.subjects;
  delete report.steps.sent.subjects;
  return report;
}

async function main() {
  console.log('\nNICeMail compose calibration — in the agent\'s own background tab.');
  console.log('Types into one draft and discards it. Never presses Send.\n');

  const report = redact(await withNicemail(calibrate), { showAddresses });
  console.log(JSON.stringify(report, null, 2));

  const dir = path.resolve(browserConfig.artifactDir);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `nic-calibrate-${report.at.replace(/[:.]/g, '-')}.json`);
  await writeFile(file, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${file}\n`);
  process.exit(0);
}

main().catch((error) => {
  console.error(`\nCalibration stopped: ${firstLine(error)}${error?.stage ? ` (stage ${error.stage})` : ''}\n`);
  process.exit(1);
});
