import { createHash } from 'crypto';
import browserConfig from '../../../../config/browserConfig.js';
import * as attachmentStore from '../../../attachments/attachmentStore.js';
import { SUPPORTED_TYPES, extensionOf, validateFile } from '../../../attachments/attachmentPolicy.js';
import { withNicemail } from './session.js';
import { SELECTORS, locate, locateInFrames, requireElement } from './selectors.js';

/**
 * Reading the NICeMail inbox through the signed-in browser session.
 *
 * The agent's whole job ends at "here is what is in the mailbox": it returns
 * plain message data and nothing else. It creates no case, records no
 * decision and sends nothing — storing and deduplicating the messages is
 * `services/email/mailbox/nicBrowserMailbox.js`, and everything after that is
 * the ordinary QMS workflow.
 *
 * Every UI lookup goes through selectors.js, which must be calibrated against
 * the live mailbox before this reads anything real.
 */

const EMAIL = /[^\s<>"',;]+@[^\s<>"',;]+/g;

const textOf = async (locator) => {
  if (!locator) return '';
  try {
    return (await locator.first().innerText({ timeout: 2000 })).trim();
  } catch {
    return '';
  }
};

/** "Name <a@b>" when a name is visible, else the bare address — the shape acceptMessage parses. */
function asHeader(text) {
  const address = String(text).match(EMAIL)?.[0] || '';
  const name = String(text).replace(EMAIL, '').replace(/[<>"]/g, '').trim();
  if (!address) return String(text).trim();
  return name ? `${name} <${address}>` : address;
}

const addresses = (text) => String(text || '').match(EMAIL) || [];

/** A stable id for a row that exposes none of the expected id attributes. */
const contentId = (parts) =>
  `content-${createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 24)}`;

/** Same derivation as the Gmail reader's, so ids are deterministic across syncs. */
function attachmentId(seed) {
  const hex = createHash('sha1').update(seed).digest('hex').slice(0, 32);
  return `att_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const mimeFor = (filename) =>
  SUPPORTED_TYPES.find((row) => row.exts.includes(extensionOf(filename)))?.mimes[0] || null;

async function rowId(row) {
  for (const attribute of SELECTORS.rowIdAttributes) {
    const value = await row.getAttribute(attribute).catch(() => null);
    if (value) return value;
  }
  return null;
}

/**
 * Download each attachment into the attachment store, the way the Gmail reader
 * materialises its attachments, so the forward to the Officer-in-Charge can
 * carry real bytes. One failed attachment is recorded on that entry and never
 * fails the message.
 */
async function readAttachments(page, providerMessageId) {
  const links = await locate(page, SELECTORS.attachmentLink);
  if (!links) return [];

  const results = [];
  const count = await links.count();

  for (let index = 0; index < count; index += 1) {
    const link = links.nth(index);
    const name = (await textOf(link)) || `attachment-${index + 1}`;

    try {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: browserConfig.timeoutMs }),
        link.click(),
      ]);
      const filename = download.suggestedFilename() || name;

      const chunks = [];
      for await (const chunk of await download.createReadStream()) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      // A download carries no declared type, so it is taken from the extension
      // — and must still pass the same policy an upload does.
      const mimeType = mimeFor(filename);
      const check = validateFile({ filename, mimeType, size: buffer.length });
      if (!check.ok) {
        results.push({ filename, attachmentId: null, materializeError: check.reason });
        continue;
      }

      const meta = await attachmentStore.saveWithId(attachmentId(`${providerMessageId}:${index}:${filename}`), {
        buffer,
        filename,
        mimeType,
        providerMessageId,
      });
      results.push({ filename, mimeType: meta.mimeType, size: meta.size, attachmentId: meta.attachmentId });
    } catch (error) {
      results.push({ filename: name, attachmentId: null, materializeError: error.message });
    }
  }

  return results;
}

async function readOpenMessage(page, providerMessageId) {
  const pane = await locate(page, SELECTORS.readingPane);
  if (pane) await pane.first().waitFor({ timeout: browserConfig.timeoutMs }).catch(() => {});

  const from = await textOf(await locate(page, SELECTORS.fromField));
  const to = await textOf(await locate(page, SELECTORS.toField));
  const cc = await textOf(await locate(page, SELECTORS.ccField));
  const subject = await textOf(await locate(page, SELECTORS.subject));
  const date = await textOf(await locate(page, SELECTORS.dateField));
  const body = await textOf(await locateInFrames(page, SELECTORS.body));

  const parsedDate = date ? new Date(date) : null;

  return {
    providerMessageId,
    from: asHeader(from),
    to: addresses(to),
    cc: addresses(cc),
    subject: subject || '(no subject)',
    body,
    receivedAt:
      parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString(),
    attachments: await readAttachments(page, providerMessageId),
  };
}

/**
 * The newest `max` inbox messages that are not in `skip` (a Set of provider
 * ids already stored). Returns plain message data; throws with a `stage` when
 * the browser session is unavailable.
 */
export async function readInbox({ max = browserConfig.syncMax, skip = new Set(), connect } = {}) {
  return withNicemail(
    async (page) => {
      const inbox = await locate(page, SELECTORS.inboxLink);
      if (inbox) await inbox.first().click();

      const rows = await requireElement(page, 'messageRow');
      const total = Math.min(await rows.count(), max);
      const messages = [];

      for (let index = 0; index < total; index += 1) {
        const row = rows.nth(index);
        const id = (await rowId(row)) || contentId([await textOf(row)]);
        if (skip.has(id)) continue;

        await row.click();
        const message = await readOpenMessage(page, id);
        if (!message.from) continue; // Not a readable message — never store half of one.
        messages.push(message);
      }

      return messages;
    },
    { connect },
  );
}

export { asHeader };
