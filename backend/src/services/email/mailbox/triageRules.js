import env from '../../../config/env.js';
import { IDENTITY_ROLES, identityForRole } from '../../../config/identities.js';
import browserConfig from '../../../config/browserConfig.js';
import nicConfig from '../../../config/nicConfig.js';
import { RULE_CLASSES, TRIAGE_VERDICTS } from '../../../models/MailboxTriage.js';

const bare = (address) =>
  String(address || '')
    .trim()
    .replace(/^.*<([^>]*)>.*$/, '$1')
    .trim()
    .toLowerCase();

const localPart = (address) => bare(address).split('@')[0] || '';

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

const htmlText = (html) =>
  String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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

  if (headers) {
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

    const precedence = headerValue(headers, 'precedence').trim().toLowerCase();
    const bulkPrecedence = ['bulk', 'junk', 'list'].includes(precedence);
    const unsubscribe = hasHeader(headers, 'list-unsubscribe');
    if (bulkPrecedence && unsubscribe) return hard('bulk', 'bulk mailing with unsubscribe header');
    if (bulkPrecedence) soft('bulk', `Precedence: ${precedence}`);
    if (unsubscribe) soft('list', 'List-Unsubscribe header present');
    if (hasHeader(headers, 'list-id')) soft('list', 'List-Id header present');

    const autoSubmitted = headerValue(headers, 'auto-submitted').trim().toLowerCase();
    if (autoSubmitted && autoSubmitted !== 'no') soft('auto-submitted', `Auto-Submitted: ${autoSubmitted}`);

    if (
      hasHeader(headers, 'x-autoreply') ||
      hasHeader(headers, 'x-autorespond') ||
      hasHeader(headers, 'x-auto-response-suppress')
    ) {
      soft('autoreply', 'vendor auto-responder header');
    }
  }

  const sender = bare(from);
  if (sender && ownAddresses().includes(sender)) {
    return hard('loop', 'sent by this system');
  }

  if (DAEMON_LOCALS.has(localPart(from))) {
    return hard('daemon', `automated sender (${localPart(from)})`);
  }

  if (sender && NO_REPLY.test(localPart(from))) soft('no-reply', 'no-reply sender address');

  if (OUT_OF_OFFICE.test(String(subject || ''))) soft('autoreply', 'out-of-office subject');

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
