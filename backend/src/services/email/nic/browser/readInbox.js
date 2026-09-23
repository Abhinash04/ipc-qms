import { createHash } from 'crypto';
import browserConfig from '../../../../config/browserConfig.js';
import * as attachmentStore from '../../../attachments/attachmentStore.js';
import { SUPPORTED_TYPES, extensionOf, limits, validateFile } from '../../../attachments/attachmentPolicy.js';
import { withNicemail, pending as browserPending } from './session.js';
import { isSessionLost, isWaitTimeout } from './cdp.js';
import { SELECTORS, locate } from './selectors.js';

const EMAIL = /[^\s<>"',;]+@[^\s<>"',;]+/g;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const READ_SETTLE_MS = 5000;
const RESTORE_SETTLE_MS = 3000;
const RESTORE_ATTEMPTS = 2;

function asHeader(text) {
  const address = String(text).match(EMAIL)?.[0] || '';
  const name = String(text).replace(EMAIL, '').replace(/[<>"]/g, '').trim();
  if (!address) return String(text).trim();
  return name ? `${name} <${address}>` : address;
}

function attachmentId(seed) {
  const hex = createHash('sha1').update(seed).digest('hex').slice(0, 32);
  return `att_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const mimeFor = (filename) =>
  SUPPORTED_TYPES.find((row) => row.exts.includes(extensionOf(filename)))?.mimes[0] || null;

const SIZE_UNITS = { byte: 1, bytes: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

export function parseSize(text) {
  const match = /(\d+(?:\.\d+)?)\s?(bytes?|kb|mb|gb)\b/i.exec(text || '');
  return match ? Math.round(Number(match[1]) * SIZE_UNITS[match[2].toLowerCase()]) : null;
}

const listRows = (sel) => {
  const text = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const once = (value) => value.match(/^(.+?) \1$/)?.[1] || value;

  return [...document.querySelectorAll(sel.listRow)]
    .map((row) => ({
      providerMessageId: String(row.id || '').replace(/^t/, ''),
      subject: (row.querySelector(sel.listRowSubject)?.textContent || '').trim(),
      senderAddress: row.querySelector(sel.listRowSender)?.getAttribute('title') || '',
      senderName: (row.querySelector(sel.listRowSender)?.textContent || '').trim(),
      unread: row.classList.contains(sel.rowUnreadClass),
      listDate: once(text(row.querySelector(sel.listRowDate))),
      sizeText: text(row.querySelector(sel.listRowSize)),
      threadCount: Number.parseInt(text(row.querySelector(sel.listRowThread)), 10) || null,
      hasAttachment: Boolean(row.querySelector(sel.listRowAttachment)),
    }))
    .filter((row) => /^[0-9]{15,25}$/.test(row.providerMessageId));
};

const inboxIsActive = (sel) =>
  document.querySelector(sel.folderActive)?.getAttribute('aria-label') === sel.folderInboxLabel;

const elementExists = ({ selector }) => document.querySelectorAll(selector).length > 0;
const elementGone = ({ selector }) => document.querySelectorAll(selector).length === 0;

const openRoute = ({ route }) => {
  location.hash = route;
  return true;
};

const rowCounts = (sel) => {
  const matched = document.querySelectorAll(sel.listRow).length;
  const options = document.querySelectorAll(sel.listRowAny).length;
  return matched || options ? { matched, options } : null;
};

const extractOpenMessage = ({ sel, messageSelector, htmlLimit = 1000000 }) => {
  const candidates = [...document.querySelectorAll(messageSelector)];
  const message = candidates.find((node) => node.querySelector(sel.body)) || candidates[0];
  if (!message) return null;

  const attribute = (nodes, name) => [
    ...new Set([...nodes].map((node) => node.getAttribute(name)).filter(Boolean)),
  ];

  const senders = [...message.querySelectorAll(sel.senderAddr)];
  const fromAddress = attribute(senders, 'data-eid')[0] || '';
  const fromName =
    senders
      .map((node) => (node.getAttribute('data-dispname') || node.textContent || '').trim())
      .map((text) => text.replace(/<[^>]*>/g, '').trim())
      .find((text) => text && !text.includes('@')) || '';

  const addressesLabelled = (label) => {
    for (const row of message.querySelectorAll(sel.hdrRow)) {
      const left = row.querySelector(sel.hdrRowLabel);
      const text = (left?.textContent || '').trim().replace(/:$/, '').toLowerCase();
      if (text !== label) continue;
      const data = row.querySelector(sel.hdrRowData);
      if (data) return attribute(data.querySelectorAll('[data-eid]'), 'data-eid');
    }
    return [];
  };

  const bodyNode = message.querySelector(sel.body);
  const bodyHtml = bodyNode?.innerHTML ?? null;

  const attachments = (() => {
    for (const selector of sel.attachmentEntry) {
      const nodes = [...message.querySelectorAll(selector)];
      if (!nodes.length) continue;

      const entries = nodes
        .map((node) => {
          const anchor = node.querySelector('a[href]') || node;
          const filename = (
            node.getAttribute('title') ||
            node.getAttribute('data-filename') ||
            anchor.getAttribute('download') ||
            node.textContent ||
            ''
          ).trim();
          const sizes = (node.textContent || '').replace(filename, '').match(/\d+(?:\.\d+)?\s?(?:bytes?|KB|MB|GB)\b/gi);
          return {
            filename,
            href: anchor.href || anchor.getAttribute('href') || null,
            sizeText: sizes?.at(-1) || '',
          };
        })
        .filter((entry) => entry.href || /\.[a-z0-9]{1,8}$/i.test(entry.filename));

      if (entries.length) return entries;
    }
    return [];
  })();

  return {
    providerMessageId: String(message.id || '').replace('zm_Container_m', ''),
    fromAddress,
    fromName,
    to: addressesLabelled('to'),
    cc: addressesLabelled('cc'),
    bcc: addressesLabelled('bcc'),
    fallbackTo: attribute(message.querySelectorAll(sel.recipientAddr), 'data-eid'),
    body: (bodyNode?.innerText ?? bodyNode?.textContent ?? '').trim(),
    bodyHtml: bodyHtml && bodyHtml.length <= htmlLimit ? bodyHtml : null,
    timestampText: (
      message.querySelector(sel.fullTimestamp)?.textContent ||
      message.querySelector(sel.shortTime)?.textContent ||
      ''
    ).trim(),
    attachments,
  };
};

const restorable = ({ row, toggle, selected, unreadClass }) => {
  const rows = document.querySelectorAll(row);
  if (rows.length !== 1) return { ok: false, reason: 'the row is no longer in the list' };
  if (rows[0].classList.contains(unreadClass)) return { ok: false, reason: 'the row is already unread' };
  if (document.querySelectorAll(selected).length > 1) {
    return { ok: false, reason: 'more than one message is selected' };
  }
  if (document.querySelectorAll(toggle).length === 0) {
    return { ok: false, reason: 'the row has no read/unread control' };
  }
  return { ok: true };
};

const rowIsRead = ({ row, unreadClass }) => {
  const element = document.querySelector(row);
  return Boolean(element) && !element.classList.contains(unreadClass);
};

const readAmong = ({ rows, unreadClass }) =>
  rows
    .filter(([, selector]) => {
      const element = document.querySelector(selector);
      return !element || !element.classList.contains(unreadClass);
    })
    .map(([id]) => id);

const downloadAsBase64 = async ({ url, limit }) => {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) return { error: `the download answered HTTP ${response.status}` };
  if (Number(response.headers.get('content-length')) > limit) {
    return { error: `the attachment is larger than the ${limit}-byte limit` };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > limit) return { error: `the attachment is larger than the ${limit}-byte limit` };

  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return { base64: btoa(binary) };
};

export function parseReceivedAt(text) {
  const parsed = text ? new Date(text) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

export function toMessage(extracted, row = {}) {
  const name = extracted.fromName || row.senderName || '';

  const from = extracted.fromAddress
    ? asHeader(name ? `${name} <${extracted.fromAddress}>` : extracted.fromAddress)
    : asHeader(name || row.senderAddress || '');

  return {
    providerMessageId: extracted.providerMessageId || row.providerMessageId,
    providerThreadId: null,
    from,
    to: extracted.to.length ? extracted.to : extracted.fallbackTo,
    cc: extracted.cc,
    bcc: extracted.bcc || [],
    subject: row.subject || '(no subject)',
    body: extracted.body || '',
    bodyHtml: extracted.bodyHtml ?? null,
    unread: Boolean(row.unread),
    receivedAt: parseReceivedAt(extracted.timestampText),
    receivedAtSource: Number.isNaN(Date.parse(extracted.timestampText || '')) ? 'sync' : 'message',
    attachments: [],
  };
}

async function readAttachments(session, providerMessageId, entries) {
  const { maxFileBytes } = limits();
  const results = [];

  for (const [index, entry] of entries.entries()) {
    const filename = entry.filename || `attachment-${index + 1}`;

    const id = attachmentId(`${providerMessageId}:${index}:${filename}`);
    const record = { id, name: filename, filename, mimeType: mimeFor(filename) };
    const shownSize = parseSize(entry.sizeText);
    if (shownSize) Object.assign(record, { size: shownSize, sizeKb: Math.max(1, Math.round(shownSize / 1024)) });

    const sizeShown = Number.isFinite(shownSize) && shownSize > 0;
    const precheck = validateFile({ filename, mimeType: record.mimeType, size: sizeShown ? shownSize : 1 });
    if (!precheck.ok) {
      results.push({ ...record, attachmentId: null, materializeError: precheck.reason });
      continue;
    }

    try {
      if (!entry.href) throw new Error('no download link was found on the attachment');

      const fetched = await session.evaluate(downloadAsBase64, { url: entry.href, limit: maxFileBytes });
      if (fetched?.error) throw new Error(fetched.error);

      const buffer = Buffer.from(fetched.base64, 'base64');

      const check = validateFile({ filename, mimeType: record.mimeType, size: buffer.length });
      if (!check.ok) {
        results.push({ ...record, attachmentId: null, materializeError: check.reason });
        continue;
      }

      const meta = await attachmentStore.saveWithId(id, {
        buffer,
        filename,
        mimeType: record.mimeType,
        providerMessageId,
      });
      results.push({
        ...record,
        mimeType: meta.mimeType,
        size: meta.size,
        sizeKb: Math.max(1, Math.round(meta.size / 1024)),
        attachmentId: meta.attachmentId,
      });
    } catch (error) {
      if (isSessionLost(error)) throw error;
      results.push({ ...record, attachmentId: null, materializeError: error.message });
    }
  }

  return results;
}

async function ensureInbox(session) {
  if (await session.evaluate(inboxIsActive, SELECTORS)) return;

  const inbox = await locate(session, SELECTORS.folderInbox);
  if (!inbox) {
    throw Object.assign(new Error('The NICeMail folder tree has no Inbox. Recalibrate browser/selectors.js.'), {
      stage: 'ui',
    });
  }

  await inbox.click();
  await session.waitFor(inboxIsActive, { timeout: browserConfig.timeoutMs, argument: SELECTORS });
}

async function closePreview(session) {
  await session.evaluate(openRoute, { route: SELECTORS.folderRoute });
  await session
    .waitFor(elementGone, { timeout: RESTORE_SETTLE_MS, argument: { selector: SELECTORS.previewPaneShown } })
    .catch(() => {});
}

async function markUnread(session, id) {
  const row = SELECTORS.rowById(id);
  const argument = { row, unreadClass: SELECTORS.rowUnreadClass };

  const becameRead = await session
    .waitFor(rowIsRead, { timeout: READ_SETTLE_MS, every: 250, argument })
    .catch((error) => {
      if (isWaitTimeout(error)) return false;
      throw error;
    });

  if (!becameRead) return;

  const check = await session.evaluate(restorable, {
    row,
    toggle: SELECTORS.rowUnreadToggleById(id),
    selected: SELECTORS.listRowSelected,
    unreadClass: SELECTORS.rowUnreadClass,
  });
  if (!check.ok) return;

  const toggle = await locate(session, SELECTORS.rowUnreadToggleById(id));
  if (toggle) await toggle.click();
}

async function restoreUnread(session, ids) {
  if (!ids.length) return;

  const reasons = new Map();

  await closePreview(session).catch((error) => {
    console.warn(`[NICeMail agent] The message preview would not close before restoring unread state: ${error.message}`);
  });

  let outstanding = ids;

  for (let attempt = 0; attempt < RESTORE_ATTEMPTS && outstanding.length; attempt += 1) {
    for (const id of outstanding) {
      try {
        await markUnread(session, id);
        reasons.delete(id);
      } catch (error) {
        reasons.set(id, error.message);
      }
    }

    await sleep(RESTORE_SETTLE_MS);

    try {
      outstanding = await session.evaluate(readAmong, {
        rows: outstanding.map((id) => [id, SELECTORS.rowById(id)]),
        unreadClass: SELECTORS.rowUnreadClass,
      });
    } catch (error) {
      for (const id of outstanding) reasons.set(id, reasons.get(id) || error.message);
      break;
    }
  }

  for (const id of outstanding) {
    const reason = reasons.get(id);
    console.warn(
      `[NICeMail agent] Message ${id} was unread before it was opened and could not be marked unread again` +
        `${reason ? `: ${reason}` : '.'}`,
    );
  }
}

export async function inboxView(session) {
  const inInbox = await session.evaluate(inboxIsActive, SELECTORS);
  return {
    page: inInbox ? 'inbox' : 'other',
    folder: inInbox ? SELECTORS.folderInboxLabel : null,
    mailRows: await session.evaluate(listRows, SELECTORS),
  };
}

export async function openMessage(session, providerMessageId) {
  const id = String(providerMessageId);
  if (!/^[0-9]{15,25}$/.test(id)) {
    throw Object.assign(new Error(`"${id}" is not a NICeMail message id.`), { stage: 'ui' });
  }

  const messageSelector = SELECTORS.previewMessageById(id);
  await session.evaluate(openRoute, { route: SELECTORS.messageRoute(id) });
  await session.waitFor(elementExists, {
    timeout: browserConfig.timeoutMs,
    argument: { selector: messageSelector },
  });
  return messageSelector;
}

async function readOne(session, row) {
  const messageSelector = await openMessage(session, row.providerMessageId);

  const extracted = await session.evaluate(extractOpenMessage, { sel: SELECTORS, messageSelector });
  if (!extracted) throw Object.assign(new Error('The open message could not be read.'), { stage: 'extract' });

  const message = toMessage(extracted, row);
  if (!message.from.includes('@')) {
    throw Object.assign(new Error('No sender address could be read.'), { stage: 'no_sender' });
  }
  message.attachments = await readAttachments(session, message.providerMessageId, extracted.attachments);

  return message;
}

function pickRows(rows, skip, max, retry = new Set()) {
  if (!skip.size && !retry.size) return { chosen: rows.slice(0, max).reverse(), remaining: 0 };

  const anchor = (row) => skip.has(row.providerMessageId) || retry.has(row.providerMessageId);
  const deepest = rows.findLastIndex(anchor);
  const above = deepest < 0 ? rows : rows.slice(0, deepest + 1);
  const fresh = above.filter((row) => !skip.has(row.providerMessageId)).reverse();
  const ordered = [
    ...fresh.filter((row) => !retry.has(row.providerMessageId)),
    ...fresh.filter((row) => retry.has(row.providerMessageId)),
  ];
  const chosen = ordered.slice(0, max);
  return { chosen, remaining: ordered.length - chosen.length };
}

function readFault(failures) {
  const count = failures.length;
  const reason = failures.every((failure) => failure.stage === 'no_sender')
    ? `${count} NICeMail message(s) were opened and none of them yielded a sender address.`
    : `${count} NICeMail message(s) were opened and none of them could be read (${failures[0]?.error}).`;
  return Object.assign(
    new Error(
      `${reason} The mailbox cannot be read with the current selectors — run ` +
        '"npm run nic:browser:discover" and recalibrate browser/selectors.js.',
    ),
    { stage: 'ui', failures },
  );
}

const FIRST_FAILURES = 3;

const firstLine = (error) => String(error?.message || error).split('\n')[0];

export async function readInbox({
  max = browserConfig.syncMax,
  skip = new Set(),
  retry = new Set(),
  onMessage = async () => {},
  connect,
} = {}) {
  return withNicemail(
    async (session) => {
      await ensureInbox(session);

      const counts = await session
        .waitFor(rowCounts, { timeout: browserConfig.timeoutMs, argument: SELECTORS })
        .catch((error) => {
          if (isWaitTimeout(error)) return null;
          throw error;
        });

      if (!counts) return { messages: [], failures: [], remaining: 0 };

      if (!counts.matched) {
        throw Object.assign(
          new Error(
            `The NICeMail list is showing ${counts.options} message(s) and none of them matched the row ` +
              'selector. Run "npm run nic:browser:discover" and recalibrate browser/selectors.js.',
          ),
          { stage: 'ui' },
        );
      }

      const { mailRows } = await inboxView(session);
      const { chosen, remaining } = pickRows(mailRows, skip, max, retry);

      const messages = [];
      const failures = [];
      const opened = [];
      let yielded = false;
      const queue = [...chosen];
      let probed = false;

      try {
        while (queue.length) {
          if (browserPending() > 1) {
            yielded = true;
            break;
          }

          const row = queue.shift();
          if (row.unread) opened.push(row.providerMessageId);

          let message;
          try {
            message = await readOne(session, row);
          } catch (error) {
            if (isSessionLost(error)) throw error;
            failures.push({ providerMessageId: row.providerMessageId, stage: error.stage || 'ui', error: firstLine(error) });
            if (!messages.length && failures.length >= FIRST_FAILURES) {
              if (probed || !queue.length) throw readFault(failures);
              probed = true;
              queue.unshift(queue.pop());
            }
            continue;
          }

          await onMessage(message);
          messages.push(message);
        }
      } finally {
        await restoreUnread(session, opened).catch((error) => {
          console.warn(`[NICeMail agent] The unread restore pass failed: ${error.message}`);
        });
      }

      if (chosen.length && !messages.length && !yielded) throw readFault(failures);

      return { messages, failures, remaining: remaining + queue.length };
    },
    { connect },
  );
}

export { asHeader, listRows, extractOpenMessage, readAttachments };
