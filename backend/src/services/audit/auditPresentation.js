import { USERS, nicFrontOfficeUser } from '../../constants/users.js';
import { IPC_DIVISIONS } from '../../config/officialsMetadata.js';
import { narrate, describePerson } from './auditNarrative.js';

/**
 * How an audit event reads to a person: in the PDF report, the CSV export and the Audit
 * Trail page. The stored event is unchanged; this only words it — the activity in plain
 * English, the module it belongs to, who did it (name, role, IP address, browser) and its
 * details as sentences rather than JSON.
 */

export const REPORT_TIME_ZONE = 'Asia/Kolkata';
export const REPORT_TIME_ZONE_LABEL = 'IST';

/** A stored category in words: "monograph-query" → "Monograph query". */
export function categoryName(id) {
  const words = String(id || '').replace(/-\d+$/, '').replace(/-/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

// Everyday words, as an officer would describe what happened.
const ACTIVITY = {
  LOGIN_SUCCEEDED: 'Logged in',
  LOGIN_FAILED: 'Login attempt failed',
  LOGOUT: 'Logged out',
  AUTHENTICATION_FAILED: 'Login session expired or not valid',
  AUTHORIZATION_DENIED: 'Tried to open something without permission',

  EMAIL_RECEIVED: 'Email taken in from the mailbox',
  EMAIL_READ: 'Mailbox opened',
  EMAIL_CLASSIFIED: 'Email checked for junk',
  EMAIL_SENT: 'Email sent',
  EMAIL_REPLIED: 'Reply emailed',
  EMAIL_FORWARDED: 'Email forwarded',
  EMAIL_SEND_FAILED: 'Email could not be sent',
  SENT_APPEND_FAILED: 'Sent email not saved in the Sent folder',
  EMAIL_DELIVERY_CONFIRMED: 'Email confirmed as sent',
  EMAIL_DELIVERY_DENIED: 'Email confirmed as not sent',
  EMAIL_MARKED_READ: 'Email marked as read',
  EMAIL_MARKED_UNREAD: 'Email marked as unread',
  EMAIL_MOVED: 'Email moved to another folder',
  EMAIL_DELETED: 'Email deleted',
  EMAIL_PURGED: 'Junk email removed',
  SYNC_STARTED: 'Started checking the mailbox',
  SYNC_COMPLETED: 'Mailbox checked for new emails',
  SYNC_FAILED: 'Mailbox could not be checked',
  SYNC_RECOVERED: 'Mailbox working again',
  UIDVALIDITY_CHANGED: 'Mailbox reset by the email provider',
  CREDENTIAL_ROTATED: 'Mailbox password changed',

  ATTACHMENT_UPLOADED: 'File attached',
  ATTACHMENT_DOWNLOADED: 'File opened or downloaded',

  CASE_CREATED: 'New query created',
  CASE_ASSOCIATED: 'Email linked to the query',
  CASE_ASSOCIATION_CHANGED: 'Email moved to a different query',
  QUERY_RECEIVED: 'New query received',
  QUERY_REGISTERED: 'Query accepted and registered',
  ACKNOWLEDGEMENT_SENT: '"We have received your query" email sent',
  QUERY_FORWARDED: 'Sent to the Officer-in-Charge',
  QUERY_ASSIGNED: 'Given to an officer to answer',
  ASSIGNMENT_OVERRIDDEN: 'Different officer chosen than suggested',
  QUERY_TRANSFERRED: 'Handed over to another officer',
  QUERY_AUTO_TRANSFERRED: 'Handed over to another officer automatically',
  QUERY_AUTO_TRANSFER_FAILED: 'Automatic handover found no officer',
  QUERY_PULLED_BACK: 'Moved back to an earlier step',
  DRAFT_CREATED: 'Reply started',
  DRAFT_GENERATED: 'Suggested reply prepared',
  DRAFT_EDITED: 'Reply edited',
  DRAFT_UPDATED: 'Reply updated',
  DRAFT_SUBMITTED_FOR_APPROVAL: 'Reply sent for approval',
  DRAFT_APPROVED: 'Reply approved',
  DRAFT_REJECTED: 'Reply not approved',
  REVIEW_ADDED: 'Reply sent for checking',
  REVIEW_REMOVED: 'Checking step removed',
  REVIEW_COMPLETED: 'Reply checked and approved',
  REVISION_REQUESTED: 'Changes asked for in the reply',
  FINAL_APPROVAL_GRANTED: 'Reply given final approval',
  FINAL_APPROVAL_REJECTED: 'Final approval refused',
  RESPONSE_DISPATCHED: 'Reply emailed to the person who asked',
  QUERY_CLOSED: 'Query closed',
  QUERY_STATE_RESET: 'All query data cleared (test system only)',

  AI_SUMMARY_GENERATED: 'Short summary of the query prepared automatically',
  AI_DRAFT_GENERATED: 'Suggested reply prepared automatically',
  AI_RECOMMENDATION_GENERATED: 'Suitable officers suggested automatically',
  AI_ASSIGNMENT_RECOMMENDED: 'Suitable officer suggested automatically',

  AUDIT_EXPORTED: 'Activity report downloaded',
  AUDIT_VERIFIED: 'Records checked for tampering',
  AUDIT_VIEWED: 'Activity records viewed',
  AUDIT_CHAIN_RESET: 'Activity records restarted (test system only)',
};

// Query statuses in everyday words, for previous/new values and the query lifecycle.
const STATUS_WORDS = {
  RECEIVED: 'Received',
  FRONT_OFFICE_VERIFICATION: 'Being checked by Front Office',
  PENDING_ASSIGNMENT: 'Waiting to be given to an officer',
  ASSIGNED: 'With an officer',
  DRAFTING: 'Reply being written',
  UNDER_REVIEW: 'Reply being checked',
  RETURNED_FOR_REVISION: 'Sent back for changes',
  PENDING_FINAL_APPROVAL: 'Waiting for final approval',
  READY_FOR_DISPATCH: 'Approved, ready to send',
  DISPATCHED: 'Reply sent',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

// What a server address is, in the words of the screen a person was on.
const AREAS = [
  [/^\/api\/v1\/audit/, 'Activity records'],
  [/^\/api\/v1\/queries/, 'Queries'],
  [/^\/api\/v1\/(mailbox|emails?|nic)/, 'Mailbox'],
  [/^\/api\/v1\/attachments/, 'Files'],
  [/^\/api\/v1\/ai/, 'Automatic help'],
  [/^\/api\/v1\/auth/, 'Login'],
  [/^\/api\/v1\/(pullback|workflow)/, 'Queries'],
];

/** "/api/v1/audit/export" -> "Activity records". */
export function areaOf(path) {
  const clean = String(path || '').split('?')[0];
  return AREAS.find(([pattern]) => pattern.test(clean))?.[1] || 'Another part of the system';
}

/** A query status in everyday words. */
export const statusWords = (status) => STATUS_WORDS[status] || activityLabel(status);

const MODULES = [
  ['Login & access', /^(LOGIN|LOGOUT|AUTHENTICATION|AUTHORIZATION)(_|$)/],
  ['Activity records', /^(AUDIT_|QUERY_STATE_RESET$)/],
  ['Automatic help', /^AI_/],
  ['Files', /^ATTACHMENT_/],
  ['Email', /^(EMAIL_|SYNC_|UIDVALIDITY|CREDENTIAL|SENT_APPEND)/],
];

const ROLE = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrator',
  FRONT_OFFICE: 'Front Office',
  OFFICER_IN_CHARGE: 'Officer-in-Charge',
  ASSIGNED_OFFICIAL: 'Assigned Official',
  REVIEWER: 'Reviewer',
};

const STATUS = { success: 'Success', failure: 'Failed', denied: 'Denied' };

const SLUG = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/;

/** "EMAIL_SEND_FAILED" → "Email could not be sent"; an unknown slug → "Some new action". */
export function activityLabel(action) {
  if (ACTIVITY[action]) return ACTIVITY[action];
  const words = String(action || '').toLowerCase().replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

export const moduleOf = (action) => MODULES.find(([, pattern]) => pattern.test(action || ''))?.[0] || 'Query handling';

export const roleLabel = (role) => (role ? ROLE[role] || activityLabel(role) : '');

export const statusLabel = (result) => STATUS[result] || 'Success';

const IST = new Intl.DateTimeFormat('en-GB', {
  timeZone: REPORT_TIME_ZONE,
  day: '2-digit',
  month: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

// Fixed three-letter months: some ICU versions print "Sept" for September.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-01T08:35:09Z" → "01 Oct 2026, 14:05:09" (Indian Standard Time). */
export function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const part = Object.fromEntries(IST.formatToParts(date).map(({ type, value }) => [type, value]));
  const hour = part.hour === '24' ? '00' : part.hour;
  return `${part.day} ${MONTHS.at(Number(part.month) - 1)} ${part.year}, ${hour}:${part.minute}:${part.second}`;
}

export function displayIp(ip) {
  if (!ip) return '';
  if (ip === '::1') return '127.0.0.1';
  return String(ip).replace(/^::ffff:/, '');
}

/** "Mozilla/5.0 (Windows NT 10.0; …) Chrome/140.0 …" → "Chrome 140 on Windows". */
export function describeDevice(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return '';
  const browsers = [
    ['Edge', /Edg\/(\d+)/],
    ['Opera', /OPR\/(\d+)/],
    ['Chrome', /Chrome\/(\d+)/],
    ['Firefox', /Firefox\/(\d+)/],
    ['Safari', /Version\/(\d+).*Safari/],
  ];
  const systems = [
    ['Android', /Android/],
    ['iPhone', /iPhone|iPad/],
    ['Windows', /Windows/],
    ['macOS', /Mac OS X|Macintosh/],
    ['Linux', /Linux/],
  ];
  const browser = browsers.find(([, pattern]) => pattern.test(ua));
  const system = systems.find(([, pattern]) => pattern.test(ua))?.[0];
  if (!browser) return /node|axios|curl|postman|supertest/i.test(ua) ? 'API client' : 'Other client';
  const version = ua.match(browser[1])?.[1];
  return `${browser[0]}${version ? ` ${version}` : ''}${system ? ` on ${system}` : ''}`;
}

// Integrity values and internals mean nothing to a reader of the report.
// Integrity values and internal identifiers mean nothing to a reader of the report.
const HIDDEN_KEY =
  /(digest|sha256|hash|token|promptversion|keywordchoice|claim|provider|classifier|extractorversion|uid|trigger|^source$|^rule$|^stage$|^summary$|^devlogin$|messageids?$|^threadid$)/i;

const KEY_LABEL = {
  to: 'To',
  from: 'From',
  cc: 'Cc',
  queryId: 'Case No.',
  messageId: 'Message',
  filename: 'File',
  mimeType: 'File type',
  size: 'Size',
  subject: 'Subject',
  reason: 'Reason',
  transport: 'Sent via',
  recipients: 'Recipients',
  attachments: 'Attachments',
  rows: 'Records',
  format: 'Format',
  filters: 'Filters',
  chainOk: 'Integrity intact',
  ok: 'Integrity intact',
  checked: 'Records checked',
  legacy: 'Older records',
  firstBreak: 'First problem',
  confidence: 'Confidence',
  status: 'Status',
  source: 'Source',
  failedStep: 'Failed step',
  changes: 'Changes',
  reference: 'Reference',
  decision: 'Decision',
  divisionId: 'Division',
  keywords: 'Keywords',
  path: 'Tried to open',
};

const keyLabel = (key) => {
  if (KEY_LABEL[key]) return KEY_LABEL[key];
  const words = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function valueText(value, key = '') {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (key === 'size') return value >= 1024 * 1024 ? `${(value / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;
    if (key === 'confidence' && value <= 1) return `${Math.round(value * 100)}%`;
    if (/latency|ms$/i.test(key)) return `${(value / 1000).toFixed(1)} s`;
    return String(value);
  }
  if (typeof value === 'string') {
    if (key === 'category') return categoryName(value);
    if (key === 'path') return areaOf(value);
    if (SLUG.test(value)) return activityLabel(value);
    if (ISO_TIME.test(value)) return `${formatDateTime(value)} IST`;
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => (item && typeof item === 'object' ? `(${objectText(item)})` : valueText(item, key)))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'object') {
    if ('from' in value && 'to' in value && Object.keys(value).length === 2) {
      return `from ${valueText(value.from) || 'none'} to ${valueText(value.to) || 'none'}`;
    }
    return objectText(value);
  }
  return String(value);
}

function objectText(object) {
  return Object.entries(object)
    .filter(([key, value]) => !HIDDEN_KEY.test(key) && value !== null && value !== undefined && value !== '')
    .filter(([, value]) => !(Array.isArray(value) && value.length === 0))
    .filter(([, value]) => !(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0))
    .map(([key, value]) => `${keyLabel(key)}: ${valueText(value, key)}`)
    .filter((part) => !part.endsWith(': '))
    .join('; ');
}

function aiText(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const parts = [];
  if (meta.aiGenerated) parts.push('Written by the AI assistant');
  else if (meta.fallback) parts.push('AI assistant was not available, so standard text was used');
  if (meta.stats?.questions) {
    parts.push(`Answered ${(meta.stats.answered || 0) + (meta.stats.repaired || 0)} of ${plural(meta.stats.questions, 'question')}`);
  }
  if (typeof meta.latencyMs === 'number') parts.push(`Took ${(meta.latencyMs / 1000).toFixed(1)} seconds`);
  return parts.join('; ');
}

const plural = (count, word) => `${count} ${word}${Number(count) === 1 ? '' : 's'}`;

/** 95 -> "2 minutes", 30 -> "30 seconds". */
function duration(seconds) {
  const value = Number(seconds) || 0;
  if (value < 90) return plural(Math.round(value), 'second');
  if (value < 5400) return plural(Math.round(value / 60), 'minute');
  return plural(Math.round(value / 3600), 'hour');
}

const FILE_KIND = [
  [/pdf/i, 'PDF'],
  [/word|msword|docx?$/i, 'Word document'],
  [/excel|spreadsheet|xlsx?$|csv/i, 'spreadsheet'],
  [/^image\//i, 'image'],
  [/^text\//i, 'text file'],
  [/zip/i, 'zip file'],
];
const fileKind = (mime) => FILE_KIND.find(([pattern]) => pattern.test(String(mime || '')))?.[1] || 'file';

const sure = (confidence) => (typeof confidence === 'number' ? ` (${Math.round(confidence * 100)}% sure)` : '');

const fromLine = (details) =>
  [details.from ? `From ${details.from}` : null, details.subject ? `"${details.subject}"` : null].filter(Boolean).join(': ');

/**
 * Plain sentences for activities whose stored details are technical (mailbox checks, junk
 * handling, file reading, reports). Each returns '' to fall back to the generic wording.
 */
const PLAIN_DETAILS = {
  SYNC_COMPLETED: (d) =>
    `${plural(d.stored ?? 0, 'new email')} brought in from the mailbox ${d.address || ''}`.trim() +
    (d.trigger === 'manual' ? ' (checked by hand)' : ' (automatic check)'),
  SYNC_STARTED: (d) => `Started checking the mailbox ${d.address || ''}`.trim(),
  SYNC_FAILED: (d) =>
    `The mailbox ${d.address || ''} could not be reached`.replace('  ', ' ') +
    (d.since ? ` (not working since ${formatDateTime(d.since)} IST)` : ''),
  SYNC_RECOVERED: (d) =>
    `The mailbox ${d.address || ''} is working again`.replace('  ', ' ') +
    (d.seconds ? ` after ${duration(d.seconds)}` : '') +
    (d.failures ? ` (${plural(d.failures, 'failed attempt')})` : ''),
  EMAIL_CLASSIFIED: (d) =>
    d.verdict === 'JUNK'
      ? `Marked as possible junk${sure(d.confidence)}${d.reason ? `: ${d.reason}` : ''}`
      : 'Marked as a genuine email',
  EMAIL_PURGED: (d) =>
    d.summary
      ? `${plural(d.purged ?? 0, 'junk email')} removed` +
        (d.retentionHours ? ` after being kept ${plural(d.retentionHours, 'hour')}` : '') +
        (d.attachmentsRemoved ? `, with ${plural(d.attachmentsRemoved, 'attached file')}` : '')
      : `Junk email removed. ${fromLine(d)}${d.reason ? ` (${d.reason})` : ''}`,
  EMAIL_RECEIVED: (d) => `${fromLine(d)}${d.attachments ? ` - ${plural(d.attachments, 'attachment')}` : ''}`,
  EMAIL_READ: (d) => (d.address ? `Opened the mailbox ${d.address}` : fromLine(d)),
  EMAIL_MARKED_READ: (d) => fromLine(d),
  EMAIL_MARKED_UNREAD: (d) => fromLine(d),
  EMAIL_DELETED: (d) => fromLine(d),
  EMAIL_MOVED: (d) => fromLine(d),
  ATTACHMENT_UPLOADED: (d) => `${d.filename ? `"${d.filename}"` : 'A file'} (${fileKind(d.mimeType)}${d.size ? `, ${valueText(d.size, 'size')}` : ''})`,
  ATTACHMENT_DOWNLOADED: (d) => `${d.filename ? `"${d.filename}"` : 'A file'} (${fileKind(d.mimeType)}${d.size ? `, ${valueText(d.size, 'size')}` : ''})`,
  LOGIN_SUCCEEDED: (d) => (d.authProvider === 'google' ? 'Logged in with a Google account' : d.devLogin ? 'Logged in (test login)' : ''),
  LOGIN_FAILED: (d) => [d.email ? `Tried to log in as ${d.email}` : 'Tried to log in', d.reason].filter(Boolean).join(': '),
  AUTHORIZATION_DENIED: (d) => `Tried to open ${areaOf(d.path)}${d.reason ? ` - ${d.reason}` : ''}`,
  AUTHENTICATION_FAILED: (d) => `Used an expired or invalid login while opening ${areaOf(d.path)}`,
  AUDIT_VIEWED: (d) =>
    d.queryId
      ? `Viewed the history of query ${d.queryId}`
      : `Viewed page ${d.page || 1}${d.filters && Object.keys(d.filters).length ? `, filtered by ${describeFilters(d.filters)}` : ''}`,
  AUDIT_EXPORTED: (d) =>
    `Downloaded ${String(d.format || '').toUpperCase() || 'a'} report${d.reference ? ` ${d.reference}` : ''} with ${plural(d.rows ?? 0, 'record')}` +
    (d.filters && Object.values(d.filters).some(Boolean) ? `, filtered by ${describeFilters(d.filters)}` : ''),
  AUDIT_VERIFIED: (d) =>
    d.ok === false
      ? `Checked the records: a problem was found${d.firstBreak?.seq ? ` at ${auditIdOf({ seq: d.firstBreak.seq })}` : ''}`
      : `Checked ${plural(d.checked ?? 0, 'record')}: no tampering found`,
  QUERY_PULLED_BACK: (d) =>
    [d.targetStage ? `Moved back to "${statusWords(d.targetStage)}"` : null, d.reason ? `Reason: ${d.reason}` : null, d.remarks ? `Remarks: ${d.remarks}` : null]
      .filter(Boolean)
      .join('. '),
  CASE_ASSOCIATED: () => 'Email linked to this query',
};

/** The event's particulars as plain sentences: problem first, then details, then AI facts. */
export function describeDetails(event) {
  const parts = [];
  if (event.error) parts.push(`Problem: ${event.error}`);
  if (typeof event.details === 'string') parts.push(event.details);
  else if (event.details && typeof event.details === 'object') {
    let plain;
    try {
      plain = PLAIN_DETAILS[event.action]?.(event.details, event);
    } catch {
      plain = null;
    }
    parts.push(plain || objectText(event.details));
  }
  const ai = aiText(event.aiMetadata);
  if (ai) parts.push(ai);
  return parts.filter(Boolean).join('. ').replace(/\.\./g, '.');
}

const ACTOR_KIND = { agent: 'AI assistant', system: 'System' };

// Older browser-recorded events stored the person's display name where the role belongs
// ("Priya Sharma", "AI Summary Assistant"); anything that is not a role code is such a name.
const nameInRoleField = (event) => (event.actorRole && !ROLE[event.actorRole] && !SLUG.test(event.actorRole) ? event.actorRole : null);

/** Who acted, as a name: the person's name, else their user ID, else "System" / "AI assistant". */
export function actorLabel(event) {
  if (event.actorName) return event.actorName;
  const legacyName = nameInRoleField(event);
  if (legacyName) return legacyName;
  if (event.actorId) return userById(event.actorId)?.name || event.actorId;
  // A failed sign-in has no user yet; the address tried is who it was.
  if (event.details && typeof event.details === 'object' && event.details.email) return String(event.details.email);
  return ACTOR_KIND[event.actorType] || 'User';
}

/** "AUD-000041" for a chained event; older or unsaved events have no audit ID. */
export const auditIdOf = (event) => (typeof event.seq === 'number' ? `AUD-${String(event.seq).padStart(6, '0')}` : '-');

const userById = (id) => USERS.find((user) => user.id === id) || (nicFrontOfficeUser()?.id === id ? nicFrontOfficeUser() : null);

/** The user's section: the division they belong to. */
const sectionOf = (actorId) => {
  const divisionId = userById(actorId)?.divisionId;
  return IPC_DIVISIONS.find((division) => division.id === divisionId)?.name || '';
};

const EMPTY_VALUE = { status: '-', assignee: 'Unassigned', category: 'Not categorised', priority: '-' };

function changeValue(name, value) {
  if (value === null || value === undefined || value === '') return EMPTY_VALUE[name] || '-';
  if (name === 'assignee') return userById(value)?.name || String(value);
  if (name === 'category') return categoryName(value);
  if (name === 'status') return statusWords(String(value));
  return activityLabel(String(value));
}

/** The previous and new values an event recorded, worded; null when it recorded none. */
export function changeValues(event) {
  const changes = event.changes || (event.details && typeof event.details === 'object' ? event.details.changes : null);
  if (!changes || typeof changes !== 'object') return null;
  const entries = Object.entries(changes).filter(([, value]) => value && typeof value === 'object' && ('from' in value || 'to' in value));
  if (!entries.length) return null;
  const label = (name) => (entries.length > 1 ? `${keyLabel(name)}: ` : '');
  const side = (key) =>
    entries
      .map(([name, value]) => {
        const raw = value[key];
        const text = Array.isArray(raw) ? raw.join(', ') || '-' : changeValue(name, raw);
        return `${label(name)}${text}`;
      })
      .join('; ');
  return { previous: side('from'), next: side('to') };
}

const junkVerdict = (event) => (event.details?.verdict === 'JUNK' ? 'Possible junk' : 'Genuine email');

/**
 * The state before and after, for activities that change something other than a query: a
 * login, an email's read state, a mailbox's connection, a reference document's use.
 */
const STATE_CHANGES = {
  LOGIN_SUCCEEDED: () => ['Logged out', 'Logged in'],
  LOGOUT: () => ['Logged in', 'Logged out'],
  LOGIN_FAILED: () => ['Logged out', 'Still logged out'],
  AUTHENTICATION_FAILED: () => ['Login no longer valid', 'Request refused'],
  AUTHORIZATION_DENIED: () => ['No permission', 'Request refused'],
  EMAIL_RECEIVED: () => ['Waiting in the mailbox', 'Taken in as a query'],
  EMAIL_MARKED_READ: () => ['Unread', 'Read'],
  EMAIL_MARKED_UNREAD: () => ['Read', 'Unread'],
  EMAIL_DELETED: () => ['In the mailbox', 'Deleted'],
  EMAIL_MOVED: () => ['In the mailbox', 'Moved to another folder'],
  EMAIL_CLASSIFIED: (event) => ['Not checked', junkVerdict(event)],
  EMAIL_PURGED: () => ['Kept as junk', 'Removed'],
  SYNC_FAILED: () => ['Working', 'Not reachable'],
  SYNC_RECOVERED: () => ['Not reachable', 'Working'],
  ACKNOWLEDGEMENT_SENT: () => ['Not sent', 'Sent'],
  EMAIL_SEND_FAILED: () => ['Not sent', 'Still not sent'],
  ATTACHMENT_UPLOADED: () => ['Not attached', 'Attached'],
  AI_SUMMARY_GENERATED: () => ['No summary', 'Summary prepared'],
  AI_DRAFT_GENERATED: () => ['No suggested reply', 'Suggested reply prepared'],
  DRAFT_GENERATED: () => ['No reply', 'Suggested reply prepared'],
};

function stateChange(event) {
  try {
    return STATE_CHANGES[event.action]?.(event) || null;
  } catch {
    return null;
  }
}

/** Every reader-facing field of an event, in one object. */
/** Who acted, with their role: "Priya Sharma (Front Office)", "System (automatic)", "AI assistant". */
function whoDidIt(event) {
  if (event.actorType === 'system' && !event.actorId) return 'System (automatic)';
  if (event.actorType === 'agent' && !event.actorId) return 'AI assistant (automatic)';
  // A failed login has no user yet: the address tried is all that is known.
  if (!event.actorId && event.details?.email) return `${event.details.email} (not logged in)`;

  const legacyName = nameInRoleField(event);
  const person = legacyName
    ? describePerson(legacyName)
    : describePerson(event.actorId || actorLabel(event), { role: event.actorRole });
  // A name recorded with this event wins over the directory's spelling.
  const named = event.actorName && !legacyName ? person.replace(/^[^(]+\(/, `${event.actorName} (`) : person;
  return event.actorType === 'agent' ? `AI assistant, on behalf of ${named}` : named;
}

/** The person behind an event as three parts for a "User" column: name, role and user ID. */
function userCard(event, who) {
  if (event.actorType === 'system' && !event.actorId) return { name: 'System', role: 'Automatic process', id: '' };
  if (event.actorType === 'agent' && !event.actorId) return { name: 'AI assistant', role: 'Automatic process', id: '' };
  if (!event.actorId && event.details?.email) return { name: String(event.details.email), role: 'Not logged in', id: '' };
  const viaAi = event.actorType === 'agent';
  const [, name = who, role = ''] = who.replace(/^AI assistant, on behalf of /, '').match(/^(.*) \(([^()]+)\)$/) || [];
  return {
    name: viaAi ? `${name} (using the AI assistant)` : name,
    role: role === 'role not on record' ? 'Role not on record' : role,
    id: event.actorId || '',
  };
}

export function present(event) {
  const source = event.source || {};
  const values = changeValues(event);
  const details = describeDetails(event);
  const states = values ? null : stateChange(event);
  const who = whoDidIt(event);
  // Worked out from the query's other recorded steps, not recorded with this event.
  const inferred = (text) => (event.changesInferred ? `${text} (inferred)` : text);
  const { action: did, other } = narrate(event, {
    who,
    fallback: [activityLabel(event.action), event.queryId ? `for query ${event.queryId}` : null].filter(Boolean).join(' ') +
      (details ? `: ${details}` : ''),
  });
  return {
    who,
    did,
    // The other person involved: "To: EduTR Zairza (Officer-in-Charge)", or '' when none.
    other: other ? `${other.label}: ${other.person}` : '',
    userCard: userCard(event, who),
    narrative: [`By: ${who}`, did, other ? `${other.label}: ${other.person}` : null].filter(Boolean).join(' -> '),
    auditId: auditIdOf(event),
    previousValue: values ? inferred(values.previous) : states ? states[0] : '-',
    newValue: values ? inferred(values.next) : states ? [states[1], details].filter(Boolean).join('. ') : details || '-',
    sessionId: source.sessionId || '',
    logSource: source.server || source.host || '',
    section: sectionOf(event.actorId),
    failureReason: event.result && event.result !== 'success' ? event.error || event.details?.reason || '' : '',
    dateTime: formatDateTime(event.timestamp),
    user: actorLabel(event),
    userId: event.actorId || '',
    performedBy: event.actorType === 'agent' ? 'AI assistant' : event.actorType === 'system' ? 'System' : 'User',
    role: nameInRoleField(event) ? '' : roleLabel(event.actorRole),
    // Events recorded before IP capture existed have no source at all.
    ipAddress: event.source ? displayIp(source.ip) : 'Not recorded',
    device: source.server ? `Server ${source.server}` : describeDevice(source.userAgent),
    // The computer's network name from DNS; for the server's own work, the server's name.
    deviceName: source.hostname || source.server || '',
    module: moduleOf(event.action),
    activity: activityLabel(event.action),
    caseNo: event.queryId || '',
    status: statusLabel(event.result),
    details,
  };
}

const FILTER_LABEL = {
  action: 'Activity',
  actorType: 'Performed by',
  actorId: 'User ID',
  result: 'Status',
  queryId: 'Case No.',
  messageId: 'Message',
  from: 'From',
  to: 'To',
};

/** The filters a report was made with, in words. */
export function describeFilters(filters = {}) {
  const set = Object.entries(filters).filter(([key, value]) => value && FILTER_LABEL[key]);
  if (!set.length) return 'None (all records)';
  return set
    .map(([key, value]) => {
      if (key === 'action') return `${FILTER_LABEL[key]}: ${activityLabel(value)}`;
      if (key === 'actorType') return `${FILTER_LABEL[key]}: ${ACTOR_KIND[value] || 'User'}`;
      if (key === 'result') return `${FILTER_LABEL[key]}: ${statusLabel(value)}`;
      if (key === 'from' || key === 'to') return `${FILTER_LABEL[key]}: ${formatDateTime(value)} IST`;
      return `${FILTER_LABEL[key]}: ${value}`;
    })
    .join('; ');
}
