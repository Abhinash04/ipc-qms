import { createHash } from 'crypto';
import browserConfig from '../../../../config/browserConfig.js';
import * as attachmentStore from '../../../attachments/attachmentStore.js';
import { SUPPORTED_TYPES, extensionOf, limits, validateFile } from '../../../attachments/attachmentPolicy.js';
import { withNicemail } from './session.js';
import { isSessionLost, isWaitTimeout } from './cdp.js';
import { SELECTORS, locate } from './selectors.js';

/**
 * Reading the NICeMail inbox through the signed-in browser session.
 *
 * The agent's whole job ends at "here is what is in the mailbox": it returns
 * plain message data and nothing else. It creates no case, records no
 * decision and sends nothing — storing and deduplicating the messages is
 * `services/email/mailbox/nicBrowserMailbox.js`, and everything after that is
 * the ordinary QMS workflow.
 *
 * It also puts the mailbox back as it found it. Opening a message is how the
 * body is read, and opening a message is what marks it read in Zoho — so every
 * message that was unread before the agent looked at it is marked unread again
 * afterwards. The Front Officer's own view of what they have and have not seen
 * is not the agent's to change.
 *
 * Every UI lookup goes through selectors.js.
 */

const EMAIL = /[^\s<>"',;]+@[^\s<>"',;]+/g;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long a row is given to pick up the read state Zoho applies after an open
 *  (it returns as soon as it does), how long the result is left to settle
 *  before it is believed, and how many times a row that came back read is put
 *  back. Restoring is best effort and must never slow a sync down. */
const READ_SETTLE_MS = 5000;
const RESTORE_SETTLE_MS = 3000;
const RESTORE_ATTEMPTS = 2;

/** "Name <a@b>" when a name is visible, else the bare address — the shape acceptMessage parses. */
function asHeader(text) {
  const address = String(text).match(EMAIL)?.[0] || '';
  const name = String(text).replace(EMAIL, '').replace(/[<>"]/g, '').trim();
  if (!address) return String(text).trim();
  return name ? `${name} <${address}>` : address;
}

/** Derived from the message, not the sync, so an id is stable across re-polls. */
function attachmentId(seed) {
  const hex = createHash('sha1').update(seed).digest('hex').slice(0, 32);
  return `att_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const mimeFor = (filename) =>
  SUPPORTED_TYPES.find((row) => row.exts.includes(extensionOf(filename)))?.mimes[0] || null;

const SIZE_UNITS = { byte: 1, bytes: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

/** "2.4 MB" → bytes, or null. */
export function parseSize(text) {
  const match = /(\d+(?:\.\d+)?)\s?(bytes?|kb|mb|gb)\b/i.exec(text || '');
  return match ? Math.round(Number(match[1]) * SIZE_UNITS[match[2].toLowerCase()]) : null;
}

// ── Page-side ────────────────────────────────────────────────────────────────
// Serialised into the mail app by session.evaluate(). They read the DOM and
// return plain data; every decision that can be made here rather than over the
// wire is, because a message is otherwise a dozen round trips.

/**
 * The loaded rows, newest first, as the list is currently showing them.
 *
 * Snapshotted in one pass on purpose: mail arrives in this box continuously
 * (fifteen new messages in ten minutes of probing), so anything that resolves a
 * row by position after the fact races the next delivery. Ids are the only
 * stable handle, and a row id that is not a Zoho message id is dropped rather
 * than stored as a provider id.
 */
const listRows = (sel) => {
  const text = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  // The date cell renders its text twice: "2:40 PM 2:40 PM".
  const once = (value) => value.match(/^(.+?) \1$/)?.[1] || value;

  return [...document.querySelectorAll(sel.listRow)]
    .map((row) => ({
      // The open row's id is 't' + the message id; every other row carries it bare.
      providerMessageId: String(row.id || '').replace(/^t/, ''),
      subject: (row.querySelector(sel.listRowSubject)?.textContent || '').trim(),
      // The sender span's title attribute is the bare address; its text is the
      // display name.
      senderAddress: row.querySelector(sel.listRowSender)?.getAttribute('title') || '',
      senderName: (row.querySelector(sel.listRowSender)?.textContent || '').trim(),
      unread: row.classList.contains(sel.rowUnreadClass),
      // As the list shows them, for the semantic view and the inspector. The
      // date is time-only for today's mail, so it is never the stored timestamp.
      listDate: once(text(row.querySelector(sel.listRowDate))),
      sizeText: text(row.querySelector(sel.listRowSize)),
      threadCount: Number.parseInt(text(row.querySelector(sel.listRowThread)), 10) || null,
      hasAttachment: Boolean(row.querySelector(sel.listRowAttachment)),
    }))
    .filter((row) => /^[0-9]{15,25}$/.test(row.providerMessageId));
};

/** The folder being shown is the one treeitem carrying .zmCurTree — exactly one
 *  frame-wide, and it agrees with aria-selected. */
const inboxIsActive = (sel) =>
  document.querySelector(sel.folderActive)?.getAttribute('aria-label') === sel.folderInboxLabel;

const elementExists = ({ selector }) => document.querySelectorAll(selector).length > 0;
const elementGone = ({ selector }) => document.querySelectorAll(selector).length === 0;

/** Open a message by its route. Returns immediately; the wait is separate. */
const openRoute = ({ route }) => {
  location.hash = route;
  return true;
};

/**
 * Null until the list has rows in it, which is what `waitFor` polls on.
 *
 * The listbox exists well before its rows do — the mailbox reports itself ready
 * and stays empty for another second or more — and a read in that window comes
 * back with nothing. That is indistinguishable from an empty mailbox from the
 * Front Office inbox, which is exactly the report this whole change is fixing.
 */
const rowCounts = (sel) => {
  const matched = document.querySelectorAll(sel.listRow).length;
  const options = document.querySelectorAll(sel.listRowAny).length;
  return matched || options ? { matched, options } : null;
};

/**
 * Everything on the open message, in one pass.
 *
 * Sender and recipients each render twice — a collapsed copy and an expanded
 * one — so addresses are taken from `data-eid` and de-duplicated; reading
 * textContent off "all matches" doubles every address. The subject is NOT read
 * here: in the pane it lives in a hidden summary row, and the list row carries
 * the same string in a visible one.
 */
const extractOpenMessage = ({ sel, messageSelector, htmlLimit = 1000000 }) => {
  // The pane can hold more than one node carrying the message's id; the one
  // with the body in it is the message, the other is scaffolding.
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

  /**
   * The labelled header rows are the only place To and Cc are told apart, and
   * Zoho omits a row entirely when it is empty — there is no hidden Cc row to
   * read, so an absent one means no Cc.
   */
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
  // As Zoho rendered it, for the dashboard's sandboxed view. Past the limit it
  // is dropped rather than cut: half an HTML document renders as something else.
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
          // What the message says the file weighs, e.g. "2.4 MB" — kept even
          // when the file itself cannot be fetched. The last such figure once
          // the name is taken out: "Q3 2 MB summary.pdf 180 KB" weighs 180 KB.
          const sizes = (node.textContent || '').replace(filename, '').match(/\d+(?:\.\d+)?\s?(?:bytes?|KB|MB|GB)\b/gi);
          return {
            filename,
            href: anchor.href || anchor.getAttribute('href') || null,
            sizeText: sizes?.at(-1) || '',
          };
        })
        // These selectors are uncalibrated and the widest of them matches icon
        // elements too; an entry with neither a file name nor a link is one of
        // those, not an attachment.
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
    // Shown only on mail this mailbox sent; received mail carries no Bcc.
    bcc: addressesLabelled('bcc'),
    fallbackTo: attribute(message.querySelectorAll(sel.recipientAddr), 'data-eid'),
    body: (bodyNode?.innerText ?? bodyNode?.textContent ?? '').trim(),
    bodyHtml: bodyHtml && bodyHtml.length <= htmlLimit ? bodyHtml : null,
    // Fully qualified, with a year and an offset. The short form is time-only.
    timestampText: (
      message.querySelector(sel.fullTimestamp)?.textContent ||
      message.querySelector(sel.shortTime)?.textContent ||
      ''
    ).trim(),
    attachments,
  };
};

/**
 * Is it safe to press this row's envelope control?
 *
 * The control is a TOGGLE, and its aria-label does not track state — unread and
 * read rows both offer "Mark emails as unread", and the plural hints it may act
 * on the current selection rather than on the row it sits in. So it is pressed
 * only on a row that is demonstrably read, with nothing multi-selected.
 */
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

/** The row has picked up the read state Zoho applies a moment after opening. */
const rowIsRead = ({ row, unreadClass }) => {
  const element = document.querySelector(row);
  return Boolean(element) && !element.classList.contains(unreadClass);
};

/** Which of these rows are read (or gone) — what is left to put back. */
const readAmong = ({ rows, unreadClass }) =>
  rows
    .filter(([, selector]) => {
      const element = document.querySelector(selector);
      return !element || !element.classList.contains(unreadClass);
    })
    .map(([id]) => id);

/**
 * Fetch an attachment's bytes from inside the page, where the session cookies
 * are. Base64 because Runtime.evaluate returns JSON; the size is checked first
 * so a large file is refused rather than pulled through the protocol.
 */
const downloadAsBase64 = async ({ url, limit }) => {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) return { error: `the download answered HTTP ${response.status}` };
  // Refused before the body is read when the server says up front it is too big.
  if (Number(response.headers.get('content-length')) > limit) {
    return { error: `the attachment is larger than the ${limit}-byte limit` };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > limit) return { error: `the attachment is larger than the ${limit}-byte limit` };

  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return { base64: btoa(binary) };
};

// ── Server-side ──────────────────────────────────────────────────────────────

/**
 * The message's own timestamp, or now.
 *
 * "Mon, 21 Sep 2026 11:19:09 AM +0530" is RFC 2822 with a 12-hour clock and an
 * offset, which Date parses. The list row's date is deliberately not used: for
 * today's mail it is "11:19 AM", with no day and no year, and a message parsed
 * into the wrong year sorts to the bottom of an inbox that then looks empty.
 */
export function parseReceivedAt(text) {
  const parsed = text ? new Date(text) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

/**
 * One stored message from what the page reported. Pure, so the shape the rest
 * of the QMS depends on can be tested without a browser.
 */
export function toMessage(extracted, row = {}) {
  // The open message shows a display name only when the sender set one; the
  // list row's sender span carries the same name and is the fallback — its
  // title attribute is the address, its text the name. When neither has a
  // name, asHeader collapses "a@b <a@b>" back to the bare address.
  const name = extracted.fromName || row.senderName || '';

  const from = extracted.fromAddress
    ? asHeader(name ? `${name} <${extracted.fromAddress}>` : extracted.fromAddress)
    : asHeader(name || row.senderAddress || '');

  return {
    providerMessageId: extracted.providerMessageId || row.providerMessageId,
    // No thread id has been found in the DOM yet; see the calibration runbook.
    providerThreadId: null,
    from,
    // The labelled To row when there is one; otherwise every recipient chip on
    // the message. The mailbox store keeps these as the message's recipients;
    // the message itself is filed under the mailbox address — Bcc'd mail
    // belongs to this mailbox too.
    to: extracted.to.length ? extracted.to : extracted.fallbackTo,
    cc: extracted.cc,
    bcc: extracted.bcc || [],
    subject: row.subject || '(no subject)',
    body: extracted.body || '',
    bodyHtml: extracted.bodyHtml ?? null,
    // Zoho's state before the agent opened it; the agent puts it back.
    unread: Boolean(row.unread),
    receivedAt: parseReceivedAt(extracted.timestampText),
    // 'sync' says the date is when the agent read it, because the message's own
    // could not be parsed — rather than passing "now" off as the real one.
    receivedAtSource: Number.isNaN(Date.parse(extracted.timestampText || '')) ? 'sync' : 'message',
    attachments: [],
  };
}

/**
 * Download each attachment into the attachment store, so the forward to the
 * Officer-in-Charge can carry real bytes. One failed attachment is recorded on
 * that entry and never fails the message.
 */
async function readAttachments(session, providerMessageId, entries) {
  const { maxFileBytes } = limits();
  const results = [];

  for (const [index, entry] of entries.entries()) {
    const filename = entry.filename || `attachment-${index + 1}`;

    /**
     * The shape the rest of the app already consumes, both halves of it. The
     * case page (DispatchDetailPage) renders `att.name` and `att.sizeKb` raw,
     * while AttachmentList normalises `{attachmentId, filename, size}`; emitting
     * only the second set showed a NIC attachment as a blank name and
     * "undefined KB". `id` is the stable key that list keys on — the
     * deterministic attachment id, which stands in for the per-part handle
     * NICeMail does not expose, and which is known before the download so a
     * failed one still has a key.
     */
    const id = attachmentId(`${providerMessageId}:${index}:${filename}`);
    const record = { id, name: filename, filename, mimeType: mimeFor(filename) };
    // The size the message shows, until the bytes say otherwise.
    const shownSize = parseSize(entry.sizeText);
    if (shownSize) Object.assign(record, { size: shownSize, sizeKb: Math.max(1, Math.round(shownSize / 1024)) });

    // A type the policy refuses, or a file the message already says is too
    // big, is recorded as it is and never fetched. No size shown is not a
    // refusal — the policy fails an unknown size, so only the type is checked
    // here; the real size is checked below, once the bytes are in, and the
    // download itself is capped at the limit.
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

      // A download carries no declared type, so it is taken from the extension
      // — and must still pass the same policy an upload does.
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
      // A lost tab is the whole read: the message must stay unread-by-the-QMS
      // and be tried again, not be stored for good with this file marked failed.
      if (isSessionLost(error)) throw error;
      results.push({ ...record, attachmentId: null, materializeError: error.message });
    }
  }

  return results;
}

/** Put the list back on the Inbox if something else is showing. */
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

/**
 * Back to the folder, with nothing open.
 *
 * The restore below acts on list rows, and a message that is still on screen is
 * a second source of read state in the same moment. Closing first keeps the
 * restore to one question, and leaves the tab where it started.
 */
async function closePreview(session) {
  await session.evaluate(openRoute, { route: SELECTORS.folderRoute });
  await session
    .waitFor(elementGone, { timeout: RESTORE_SETTLE_MS, argument: { selector: SELECTORS.previewPaneShown } })
    .catch(() => {});
}

/**
 * Mark back as unread every message that was unread before the agent opened it.
 *
 * Done once, at the end, with the preview closed, because of what Zoho does
 * with read state — measured on the live mailbox, not assumed:
 *
 *   - it marks an opened message read on a DELAY of a second or two, and the
 *     envelope control is a plain TOGGLE. Pressing it before that lands does
 *     the opposite of what is wanted: it marks a still-unread row read. So
 *     each row is waited on until it really is read, and a row Zoho never
 *     marked read is left alone — there is nothing to put back.
 *   - that delayed mark can also land AFTER a restore, putting a row back to
 *     read a second later, which is what the verification pass is for.
 *
 * Best effort and loud about failing: the read/unread state belongs to the
 * Front Officer, but a message that could not be put back is a cosmetic
 * problem, not a reason to throw away mail that has already been read.
 */
async function markUnread(session, id) {
  const row = SELECTORS.rowById(id);
  const argument = { row, unreadClass: SELECTORS.rowUnreadClass };

  // Only the wait running out means "Zoho never marked it read". A dead tab or
  // a page exception is a failed restore, and must reach restoreUnread's
  // per-id report rather than pass as a row that needed nothing.
  const becameRead = await session
    .waitFor(rowIsRead, { timeout: READ_SETTLE_MS, every: 250, argument })
    .catch((error) => {
      if (isWaitTimeout(error)) return false;
      throw error;
    });

  // Still unread: Zoho never marked it read, so it is already as it was.
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

  /** Why a given id could not be put back, for the warning at the end. */
  const reasons = new Map();

  await closePreview(session).catch((error) => {
    // Worth saying, not worth abandoning the restore over: with a message still
    // on screen the row's read state simply has a second source.
    console.warn(`[NICeMail agent] The message preview would not close before restoring unread state: ${error.message}`);
  });

  let outstanding = ids;

  for (let attempt = 0; attempt < RESTORE_ATTEMPTS && outstanding.length; attempt += 1) {
    // Guarded per message on purpose. One row whose control has gone — a click
    // that finds nothing to click throws — used to abandon every row after it,
    // and the throw was then swallowed whole by the caller, so the mailbox kept
    // messages marked read and said nothing at all.
    for (const id of outstanding) {
      try {
        await markUnread(session, id);
        reasons.delete(id);
      } catch (error) {
        reasons.set(id, error.message);
      }
    }

    // Zoho's own mark-read can land AFTER the restore did, putting a row back
    // to read a second later, so the result is re-read once it has settled
    // rather than trusted at the moment of the click.
    await sleep(RESTORE_SETTLE_MS);

    try {
      outstanding = await session.evaluate(readAmong, {
        rows: outstanding.map((id) => [id, SELECTORS.rowById(id)]),
        unreadClass: SELECTORS.rowUnreadClass,
      });
    } catch (error) {
      // The page cannot be asked what was restored, so nothing can be confirmed
      // and a second attempt would only repeat the same failure. Report what is
      // left rather than retrying into it.
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

/**
 * What the mailbox is showing, as data: the folder, and each loaded row by its
 * message id. This is what the agent works from — never the raw DOM — and
 * what the inspector reports.
 */
export async function inboxView(session) {
  const inInbox = await session.evaluate(inboxIsActive, SELECTORS);
  return {
    page: inInbox ? 'inbox' : 'other',
    folder: inInbox ? SELECTORS.folderInboxLabel : null,
    mailRows: await session.evaluate(listRows, SELECTORS),
  };
}

/**
 * Open one message by its id — "open mail 1789…" — and wait for THAT message's
 * container, so a pane still showing the previous message cannot pass for it.
 * Returns the container's selector.
 */
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
  // A message with no address is not one this mailbox can answer: the
  // acknowledgement would be addressed to a display name. Checked before any
  // attachment is downloaded, so nothing is stored for a message that is not.
  if (!message.from.includes('@')) {
    throw Object.assign(new Error('No sender address could be read.'), { stage: 'no_sender' });
  }
  message.attachments = await readAttachments(session, message.providerMessageId, extracted.attachments);

  return message;
}

/**
 * Which of the loaded rows to open, oldest first.
 *
 * The list is newest first and the agent's tab loads only the newest few
 * dozen rows, so "not stored yet" alone is not "new": on a mailbox this size
 * the rows below what was last stored are the backlog from before the first
 * sync — calendar notices, mostly — and opening them would fill the Front
 * Office inbox with them. So the deepest stored row still loaded is the
 * cut-off, and only what is above it is new. A row that failed to read sits
 * above it too, so it is simply tried again next time.
 *
 * `retry` holds the rows that failed to read before and are to be tried
 * again. They count as anchors too — a row that failed must never end up
 * below a newer row that was stored — and they are opened after the rows not
 * tried yet, so a message that keeps failing cannot hold up the mail behind it.
 *
 * Oldest first, so that whatever is left for the next sync — cut short by
 * `max` or by a read that stopped — is still above what this one stored and
 * cannot fall below the cut-off. On the first sync there is nothing to measure
 * against, and the newest `max` are taken.
 */
function pickRows(rows, skip, max, retry = new Set()) {
  if (!skip.size && !retry.size) return { chosen: rows.slice(0, max).reverse(), remaining: 0 };

  const anchor = (row) => skip.has(row.providerMessageId) || retry.has(row.providerMessageId);
  const deepest = rows.findLastIndex(anchor);
  // Nothing stored is loaded any more: every loaded row arrived after it.
  const above = deepest < 0 ? rows : rows.slice(0, deepest + 1);
  const fresh = above.filter((row) => !skip.has(row.providerMessageId)).reverse();
  const ordered = [
    ...fresh.filter((row) => !retry.has(row.providerMessageId)),
    ...fresh.filter((row) => retry.has(row.providerMessageId)),
  ];
  const chosen = ordered.slice(0, max);
  return { chosen, remaining: ordered.length - chosen.length };
}

/** The opened messages all failed: that is the page, not the messages. */
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

/** When the first this many opened messages all fail, the read stops. */
const FIRST_FAILURES = 3;

const firstLine = (error) => String(error?.message || error).split('\n')[0];

/**
 * Up to `max` new inbox messages — see pickRows — not in `skip` (a Set of
 * provider ids already stored or given up on).
 *
 * Each message is handed to `onMessage` as soon as it is read and before the
 * next is opened, so a read that fails half way keeps what it read; if
 * `onMessage` throws, the read stops there. A message that cannot be read is
 * recorded in `failures` and the read goes on. It throws, with a `stage`, only
 * when the whole read is in doubt: the session lost, rows on the page that no
 * selector matches, or every opened message failing.
 *
 * Returns `{ messages, failures, remaining }` — `remaining` new rows are left
 * for the next sync.
 */
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

      // A folder with nothing in it never fills, so the wait ending in ITS OWN
      // deadline is the answer, not an error. Nothing else is: a discarded
      // agent tab, a page exception or a closed connection all reach here as
      // failures of the read, and catching them too is precisely the bug being
      // fixed — the sync recorded { ok: true, stored: 0 }, the inbox showed no
      // mail and no warning, because MailboxSyncNotice only renders on ok:false.
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
      /** Opened by the agent and unread before it was — to be put back. */
      const opened = [];
      const queue = [...chosen];
      let probed = false;

      try {
        while (queue.length) {
          const row = queue.shift();
          if (row.unread) opened.push(row.providerMessageId);

          let message;
          try {
            message = await readOne(session, row);
          } catch (error) {
            // A lost tab is the whole read, not this message.
            if (isSessionLost(error)) throw error;
            failures.push({ providerMessageId: row.providerMessageId, stage: error.stage || 'ui', error: firstLine(error) });
            // The first few all failing is either the page or a run of bad
            // messages side by side. One more, from the other end of the batch,
            // tells the two apart; failing too, it is the page, and the read
            // stops before opening the rest into the same fault.
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
        // A read that fails half way must still not leave the messages it did
        // open sitting there marked read. restoreUnread guards and reports every
        // message itself; this last catch only stops an unforeseen failure in it
        // from replacing the real error of the read — and says so rather than
        // being the silence that hid finding 2.
        await restoreUnread(session, opened).catch((error) => {
          console.warn(`[NICeMail agent] The unread restore pass failed: ${error.message}`);
        });
      }

      /**
       * Every message opened, not one read. That is always a selector fault — a
       * real mailbox cannot answer this way — and it used to pass for an empty
       * inbox: the sync recorded `{ ok: true, stored: 0 }`, the Front Officer
       * saw "No Mail in the IPC Mailbox", and nothing anywhere said the agent
       * could not read the page.
       */
      if (chosen.length && !messages.length) throw readFault(failures);

      return { messages, failures, remaining };
    },
    { connect },
  );
}

// readAttachments is exported for the suite: it enforces the attachment policy
// on the one ingest path a member of the public drives, so the size and type
// rules are tested against it directly rather than through a whole sync.
export { asHeader, listRows, extractOpenMessage, readAttachments };
