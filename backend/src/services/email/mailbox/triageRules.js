import env from '../../../config/env.js';
import { IDENTITY_ROLES, identityForRole } from '../../../config/identities.js';
import browserConfig from '../../../config/browserConfig.js';
import nicConfig from '../../../config/nicConfig.js';
import { RULE_CLASSES, TRIAGE_VERDICTS } from '../../../models/MailboxTriage.js';

/**
 * Deterministic triage: what can be said about a message without asking a model.
 *
 * Pure — no I/O, no models, no clock. Everything is read at call time, because
 * the configured addresses come from process.env and the suite varies them.
 *
 * Two classes of rule, and the distinction is the whole safety story:
 *
 *   `hard`  terminal. Confidence 1, never sent to the model, purgeable. Reserved
 *           for signals that are *provably* machine-generated — an RFC 3464
 *           delivery report, a null reverse-path, one of our own configured
 *           addresses, an address RFC 5321 reserves for automation.
 *   `soft`  recorded as JUNK, but still sent to the model, and the fired signals
 *           are handed to it as *facts about the message*, never as a verdict.
 *
 * Nothing here filters by sender domain or reputation. The reader that once did
 * has since been removed, but it recorded why its `from:` filter went first:
 * "an enquiry from an unknown member of the public was silently discarded before
 * anyone saw it — the worse of the two failures." ESP bounce-domain matching
 * (`sendgrid.net`, `amazonses.com`, `bounces.*`) was considered for this module
 * and rejected on that reasoning: the transport an enquiry travelled over says
 * nothing about whether a person is waiting for a reply. Do not re-add it.
 *
 * `headers` is optional and every Tier-A rule no-ops without it. That is the
 * normal case, not an edge one: the NICeMail browser agent scrapes a rendered
 * inbox and has no RFC headers at all, and it is the only source that stores
 * rows. The tiers that earn the storage back are B and C.
 */

const bare = (address) =>
  String(address || '')
    .trim()
    .replace(/^.*<([^>]*)>.*$/, '$1')
    .trim()
    .toLowerCase();

const localPart = (address) => bare(address).split('@')[0] || '';

/** Case-insensitive header lookup over either a Map or a plain object. */
function headerValue(headers, name) {
  if (!headers) return '';
  const wanted = name.toLowerCase();
  if (typeof headers.get === 'function') {
    const found = headers.get(wanted) ?? headers.get(name);
    if (found != null) return typeof found === 'string' ? found : String(found?.value ?? found);
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return typeof value === 'string' ? value : String(value?.value ?? value);
  }
  return '';
}

const hasHeader = (headers, name) => headerValue(headers, name).trim() !== '';

/** Rough text from an HTML body — enough to tell "empty" from "not empty". */
const htmlText = (html) =>
  String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The addresses that mean "this is our own mail coming back".
 *
 * Named one by one rather than taken from `allIdentities()`. The two are the same
 * set today, but the list there is the staff directory and this one is "mail that
 * came back from us". An identity added for anyone the system corresponds *with*
 * would silently start hard-junking their mail, which is exactly the enquiry this
 * system exists to handle.
 */
function ownAddresses() {
  return [
    identityForRole(IDENTITY_ROLES.FRONT_OFFICE)?.email,
    identityForRole(IDENTITY_ROLES.OFFICER_IN_CHARGE)?.email,
    env.IPC_ACK_FROM_EMAIL,
    env.IPC_QUERY_EMAIL,
    browserConfig.mailboxAddress,
    nicConfig.email,
  ]
    .map(bare)
    .filter(Boolean);
}

/** RFC 5321 §4.5.1 reserves `postmaster`; MAILER-DAEMON is the universal bounce sender. */
const DAEMON_LOCALS = new Set(['mailer-daemon', 'postmaster']);

const NO_REPLY = /^(no[-._]?reply|do[-._]?not[-._]?reply|donotreply|bounces?|automated?|notifications?|alerts?)([-._+].*)?$/i;

const OUT_OF_OFFICE =
  /^\s*(re:\s*)?(out of office|automatic reply|auto[- ]?reply|autoreply|on vacation|abwesenheit)\b/i;

const hard = (rule, reason) => ({
  verdict: TRIAGE_VERDICTS.JUNK,
  ruleClass: RULE_CLASSES.HARD,
  rule,
  reason,
  signals: [reason],
});

/**
 * Classify one message by rules alone.
 *
 * Returns the first hard hit, or — failing that — every soft signal collected
 * together, or a clean GENUINE. Collecting rather than short-circuiting on the
 * soft rules is what lets the model see the whole picture rather than the first
 * thing that tripped.
 */
export function classifyByRules({
  from = '',
  subject = '',
  body = '',
  bodyHtml = '',
  attachments = [],
  headers = null,
} = {}) {
  const signals = [];
  const softRules = [];

  const soft = (rule, reason) => {
    softRules.push(rule);
    signals.push(reason);
  };

  // ── Tier A: headers. Gmail and NIC-IMAP only; absent on nic-browser. ──────
  if (headers) {
    // A1 · Delivery Status Notification — RFC 3464 §2, RFC 5321 §4.5.5.
    const contentType = headerValue(headers, 'content-type');
    const returnPath = headerValue(headers, 'return-path').trim();
    if (
      (/multipart\/report/i.test(contentType) && /report-type\s*=\s*"?delivery-status/i.test(contentType)) ||
      /message\/delivery-status/i.test(contentType) ||
      returnPath === '<>' ||
      hasHeader(headers, 'x-failed-recipients')
    ) {
      return hard('dsn', 'delivery status notification');
    }

    // A3 · One-click-unsubscribe bulk mail. Hard only in combination: some
    // corporate gateways stamp `Precedence: bulk` on all outbound, and a real
    // enquiry copied to a mailing list carries a List-Id.
    const precedence = headerValue(headers, 'precedence').trim().toLowerCase();
    const bulkPrecedence = ['bulk', 'junk', 'list'].includes(precedence);
    const unsubscribe = hasHeader(headers, 'list-unsubscribe');
    if (bulkPrecedence && unsubscribe) return hard('bulk', 'bulk mailing with unsubscribe header');
    if (bulkPrecedence) soft('bulk', `Precedence: ${precedence}`);
    if (unsubscribe) soft('list', 'List-Unsubscribe header present');
    if (hasHeader(headers, 'list-id')) soft('list', 'List-Id header present');

    // A2 · RFC 3834 §5. Presence is the signal; absence is not, because almost
    // nothing honours the requirement to send `no` on human mail. Soft because
    // an enquiry relayed by a corporate ticketing system is `auto-generated`
    // and a person is still waiting for the answer.
    const autoSubmitted = headerValue(headers, 'auto-submitted').trim().toLowerCase();
    if (autoSubmitted && autoSubmitted !== 'no') soft('auto-submitted', `Auto-Submitted: ${autoSubmitted}`);

    // A4 · Vendor auto-responder markers.
    if (
      hasHeader(headers, 'x-autoreply') ||
      hasHeader(headers, 'x-autorespond') ||
      hasHeader(headers, 'x-auto-response-suppress')
    ) {
      soft('autoreply', 'vendor auto-responder header');
    }
  }

  // ── Tier B: sender. Every source. ────────────────────────────────────────

  // B1 · The loop guard, and the largest recurring storage cost there is: it
  // fires on this system's own acknowledgement and OIC forward landing back in
  // the mailbox, once per case.
  const sender = bare(from);
  if (sender && ownAddresses().includes(sender)) {
    return hard('loop', 'sent by this system');
  }

  // B2 · Reserved automated senders.
  if (DAEMON_LOCALS.has(localPart(from))) {
    return hard('daemon', `automated sender (${localPart(from)})`);
  }

  // B3 · Soft, always. This is the rule the anti-sender-filtering decision is
  // aimed at: a genuine regulatory notice can arrive from noreply@cdsco.gov.in.
  if (sender && NO_REPLY.test(localPart(from))) soft('no-reply', 'no-reply sender address');

  // A4 continued · An out-of-office subject. The regex tolerates a leading
  // "Re:", so it also matches a human replying to an auto-reply — which is
  // exactly why this can never be hard.
  if (OUT_OF_OFFICE.test(String(subject || ''))) soft('autoreply', 'out-of-office subject');

  // ── Tier C: content. ─────────────────────────────────────────────────────

  // C1 · Nothing in it at all.
  //
  // The attachment clause is the most important line in this file: "please see
  // attached" is the commonest shape a real enquiry takes, and an empty body
  // with a PDF wrongly purged is the worst outcome this feature can produce.
  //
  // Soft, never hard: an empty body is as often a reader that failed to extract
  // one as it is a message with nothing in it. The browser reader lifts the body
  // out of the live DOM, so a page that had not finished rendering yields the
  // same emptiness as genuine junk, and only one of those may be purged.
  const hasAttachment = Array.isArray(attachments) && attachments.length > 0;
  if (!hasAttachment && !String(body || '').trim() && !htmlText(bodyHtml)) {
    soft('empty', 'no body and no attachments');
  }

  if (softRules.length) {
    return {
      verdict: TRIAGE_VERDICTS.JUNK,
      ruleClass: RULE_CLASSES.SOFT,
      rule: softRules[0],
      reason: signals[0],
      signals,
    };
  }

  return {
    verdict: TRIAGE_VERDICTS.GENUINE,
    ruleClass: RULE_CLASSES.NONE,
    rule: null,
    reason: '',
    signals: [],
  };
}

export default { classifyByRules };
