import { USERS, nicFrontOfficeUser } from '../../constants/users.js';
import { ROLES } from '../../constants/roles.js';
import { IDENTITY_ROLES, identityForRole } from '../../config/identities.js';
import { isConnected } from '../../config/db.js';
import { User } from '../../models/User.js';

/**
 * Each audit event as plain statements about people, in three parts:
 *   By:  who did it, with their role         "Priya Sharma (Front Office)"
 *   ->   what they did                        "Forwarded query QRY-2026-00042"
 *   ->   To / From: the other person, if any  "EduTR Zairza (Officer-in-Charge)"
 * Every person is named with their role. Everyday words only.
 */

const ROLE_WORDS = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrator',
  FRONT_OFFICE: 'Front Office',
  OFFICER_IN_CHARGE: 'Officer-in-Charge',
  ASSIGNED_OFFICIAL: 'Assigned Official',
  REVIEWER: 'Reviewer',
};

const STAGE_WORDS = {
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

const INQUIRER = 'person who sent the query';

// Staff kept in the database (the users collection), so their roles are known too. Refreshed
// at most every five minutes, before reports and listings are worded.
let storedStaff = [];
let storedStaffAt = 0;
const STAFF_TTL_MS = 5 * 60 * 1000;

export async function refreshStaffDirectory({ force = false } = {}) {
  if (!force && Date.now() - storedStaffAt < STAFF_TTL_MS) return;
  storedStaffAt = Date.now();
  if (!isConnected()) return;
  try {
    const users = await User.find({}, { userId: 1, name: 1, role: 1 }).lean();
    storedStaff = users.filter((user) => user.userId && user.name).map((user) => ({ id: user.userId, name: user.name, role: user.role }));
  } catch {
    // Keep the last list; the built-in staff are still known.
  }
}

const people = () => {
  const nic = nicFrontOfficeUser();
  return [...USERS, ...(nic ? [nic] : []), ...storedStaff];
};

const findPerson = (idOrName) => {
  if (!idOrName) return null;
  const value = String(idOrName).trim();
  return people().find((user) => user.id === value || user.name.toLowerCase() === value.toLowerCase()) || null;
};

export const roleWords = (role) => ROLE_WORDS[role] || (role ? String(role).toLowerCase().replace(/_/g, ' ') : '');

/** "Neha Singh (Assigned Official)". A person not on record keeps the name, marked so. */
export function personWithRole(idOrName, { role } = {}) {
  const person = findPerson(idOrName);
  if (person) return `${person.name} (${roleWords(person.role)})`;
  if (!idOrName) return 'an officer (name not recorded)';
  return role ? `${String(idOrName).trim()} (${roleWords(role)})` : `${String(idOrName).trim()} (role not on record)`;
}

function officerInCharge() {
  const person = people().find((user) => user.role === ROLES.OFFICER_IN_CHARGE);
  if (person) return personWithRole(person.id);
  const identity = identityForRole(IDENTITY_ROLES.OFFICER_IN_CHARGE);
  return identity?.name ? `${identity.name} (Officer-in-Charge)` : 'the Officer-in-Charge';
}

const stage = (code) => STAGE_WORDS[code] || String(code || '').toLowerCase().replace(/_/g, ' ');

const text = (event) => (typeof event.details === 'string' ? event.details : '');
const field = (event, key) => (event.details && typeof event.details === 'object' ? event.details[key] : undefined);

/** Reads "Name: value" out of a "A: x | B: y" detail line. */
const piped = (event, label) => text(event).match(new RegExp(`${label}:\\s*([^|]+)`))?.[1]?.trim() || '';

const after = (event, pattern) => text(event).match(pattern)?.[1]?.trim().replace(/\.$/, '') || '';

const queryWord = (event) => (event.queryId ? `query ${event.queryId}` : 'a query');

const withReason = (sentence, reason, word = 'reason') => (reason ? `${sentence} (${word}: ${reason})` : sentence);

const inquirer = (address) => (address ? `${address} (${INQUIRER})` : `the ${INQUIRER}`);

const emailFrom = (event) => {
  const from = field(event, 'from');
  return from ? String(from).replace(/<.*>/, '').trim() || String(from) : '';
};

const fileName = (event) => (field(event, 'filename') ? `"${field(event, 'filename')}"` : 'a file');

const LOGIN_REASONS = {
  'invalid email or password': 'the email or password was wrong',
  'no staff account uses this email': 'no staff account uses that email',
};

/** Where a refused request was trying to go, in the words of the screen. */
function area(path) {
  const value = String(path || '');
  if (/\/audit/.test(value)) return 'the activity records';
  if (/\/queries|\/pullback/.test(value)) return 'the queries';
  if (/\/mailbox|\/emails?|\/nic/.test(value)) return 'the mailbox';
  if (/\/attachments/.test(value)) return 'a file';
  return 'a part of the system';
}

const assignee = (event) => {
  const id = event.changes?.assignee?.to;
  return personWithRole(id || after(event, /assigned to (.+?)(?:\.|$)/i) || '', { role: ROLES.ASSIGNED_OFFICIAL });
};

const to = (person) => ({ label: 'To', person });
const from = (person) => ({ label: 'From', person });

/**
 * Each returns a string (what was done) or { action, other: { label, person } } when another
 * person is involved.
 */
const SENTENCES = {
  LOGIN_SUCCEEDED: (e) => (field(e, 'authProvider') === 'google' ? 'Logged in with a Google account' : 'Logged in'),
  LOGIN_FAILED: (e) => {
    const reason = LOGIN_REASONS[field(e, 'reason')] || field(e, 'reason');
    return `Tried to log in${field(e, 'email') ? ` as ${field(e, 'email')}` : ''}${reason ? `, but ${reason}` : ', but it failed'}`;
  },
  LOGOUT: () => 'Logged out',
  AUTHENTICATION_FAILED: (e) => `Tried to open ${area(field(e, 'path'))} with a login that had expired; the system refused`,
  AUTHORIZATION_DENIED: (e) => `Tried to open ${area(field(e, 'path'))} without permission; the system refused`,

  QUERY_RECEIVED: (e) => {
    const sender = after(e, /received from (\S+?)\.?$/i);
    return { action: `Received new ${queryWord(e)}`, other: sender ? from(inquirer(sender)) : null };
  },
  CASE_CREATED: (e) => `Created new ${queryWord(e)}`,
  QUERY_REGISTERED: (e) => `Checked and registered ${queryWord(e)}`,
  ACKNOWLEDGEMENT_SENT: (e) => ({
    action: `Sent the "we have received your query" email for ${queryWord(e)}`,
    other: to(inquirer(after(e, /sent to (\S+?)\.?$/i))),
  }),
  QUERY_FORWARDED: (e) => ({ action: `Forwarded ${queryWord(e)} for assignment`, other: to(officerInCharge()) }),
  QUERY_ASSIGNED: (e) => ({ action: `Gave ${queryWord(e)} to an officer to answer`, other: to(assignee(e)) }),
  ASSIGNMENT_OVERRIDDEN: (e) => ({
    action: `Chose an officer for ${queryWord(e)} instead of the suggested ${personWithRole(after(e, /AI recommended (.+?);/i))}`,
    other: to(personWithRole(after(e, /assigned (.+?) instead/i))),
  }),
  AI_ASSIGNMENT_RECOMMENDED: (e) => ({
    action: `Suggested an officer to answer ${queryWord(e)}`,
    other: to(personWithRole(after(e, /Recommended (.+?) \(/i))),
  }),
  AI_RECOMMENDATION_GENERATED: (e) => `Suggested suitable officers to answer ${queryWord(e)}`,
  QUERY_TRANSFERRED: (e) => ({
    action: withReason(
      `Handed ${queryWord(e)} over from ${personWithRole(piped(e, 'Transferred From') || e.changes?.assignee?.from)}`,
      piped(e, 'Reason'),
    ),
    other: to(personWithRole(piped(e, 'Transferred To') || e.changes?.assignee?.to)),
  }),
  QUERY_PULLED_BACK: (e) => {
    const target = e.changes?.status?.to || field(e, 'targetStage') || piped(e, 'Pulled Back To');
    return withReason(`Moved ${queryWord(e)} back to the step "${stage(target)}"`, field(e, 'reason') || piped(e, 'Reason'));
  },
  AI_SUMMARY_GENERATED: (e) => `Prepared a short summary of ${queryWord(e)}`,
  AI_DRAFT_GENERATED: (e) => `Prepared a suggested reply for ${queryWord(e)}`,
  DRAFT_GENERATED: (e) => `Started the reply to ${queryWord(e)} from a suggested draft`,
  DRAFT_CREATED: (e) => `Started the reply to ${queryWord(e)}`,
  DRAFT_EDITED: (e) => `Edited the reply to ${queryWord(e)}`,
  DRAFT_UPDATED: (e) =>
    /submitted for review/i.test(text(e)) ? `Sent the reply to ${queryWord(e)} for checking` : `Saved changes to the reply to ${queryWord(e)}`,
  DRAFT_SUBMITTED_FOR_APPROVAL: (e) => `Sent the reply to ${queryWord(e)} for approval`,
  REVIEW_ADDED: (e) => ({
    action: `Asked for the reply to ${queryWord(e)} to be checked`,
    other: to(personWithRole(after(e, /added for (.+?)(?:\.|$)/i), { role: ROLES.REVIEWER })),
  }),
  REVIEW_REMOVED: (e) => ({
    action: `Removed a checker from the reply to ${queryWord(e)}`,
    other: from(personWithRole(after(e, /level for (.+?) removed/i), { role: ROLES.REVIEWER })),
  }),
  REVIEW_COMPLETED: (e) => withReason(`Checked and approved the reply to ${queryWord(e)}`, after(e, /Review approved:\s*(.+)$/i), 'comment'),
  REVISION_REQUESTED: (e) =>
    withReason(
      `Sent the reply to ${queryWord(e)} back for changes`,
      after(e, /(?:Changes requested|Returned for revision by the Officer-in-Charge):\s*(.+)$/i),
      'comment',
    ),
  FINAL_APPROVAL_GRANTED: (e) => `Gave final approval to the reply to ${queryWord(e)}`,
  FINAL_APPROVAL_REJECTED: (e) => withReason(`Refused final approval for the reply to ${queryWord(e)}`, after(e, /rejected:\s*(.+)$/i)),
  RESPONSE_DISPATCHED: (e) => ({
    action: `Emailed the approved reply to ${queryWord(e)}`,
    other: to(inquirer(after(e, /emailed to (\S+?)\.?$/i))),
  }),
  QUERY_CLOSED: (e) => `Closed ${queryWord(e)}`,

  EMAIL_SENT: (e) => `Sent an email${e.queryId ? ` for ${queryWord(e)}` : ''}`,
  EMAIL_REPLIED: (e) => `Sent a reply email${e.queryId ? ` for ${queryWord(e)}` : ''}`,
  EMAIL_FORWARDED: (e) => `Forwarded an email${e.queryId ? ` for ${queryWord(e)}` : ''}`,
  EMAIL_SEND_FAILED: (e) => `Tried to send an email${e.queryId ? ` for ${queryWord(e)}` : ''}, but it did not go out`,
  EMAIL_RECEIVED: (e) => ({ action: 'Took in an email as a query', other: emailFrom(e) ? from(emailFrom(e)) : null }),
  EMAIL_READ: () => 'Opened the mailbox',
  EMAIL_MARKED_READ: (e) => ({ action: 'Opened an email', other: emailFrom(e) ? from(emailFrom(e)) : null }),
  EMAIL_MARKED_UNREAD: (e) => ({ action: 'Marked an email as unread', other: emailFrom(e) ? from(emailFrom(e)) : null }),
  EMAIL_DELETED: (e) => ({ action: 'Deleted an email', other: emailFrom(e) ? from(emailFrom(e)) : null }),
  EMAIL_MOVED: (e) => ({ action: 'Moved an email to another folder', other: emailFrom(e) ? from(emailFrom(e)) : null }),
  EMAIL_CLASSIFIED: (e) => ({
    action: field(e, 'verdict') === 'JUNK' ? 'Marked an email as possible junk' : 'Marked an email as genuine',
    other: emailFrom(e) ? from(emailFrom(e)) : null,
  }),
  EMAIL_PURGED: (e) =>
    field(e, 'summary')
      ? `Removed ${field(e, 'purged') ?? 0} old junk email(s)`
      : { action: 'Removed a junk email', other: emailFrom(e) ? from(emailFrom(e)) : null },
  SYNC_STARTED: () => 'Started checking the mailbox for new emails',
  SYNC_COMPLETED: (e) => `Checked the mailbox and brought in ${field(e, 'stored') ?? 0} new email(s)`,
  SYNC_FAILED: () => 'Tried to check the mailbox, but could not reach it',
  SYNC_RECOVERED: () => 'Reached the mailbox again after a break',

  ATTACHMENT_UPLOADED: (e) => `Attached ${fileName(e)}${e.queryId ? ` to ${queryWord(e)}` : ''}`,
  ATTACHMENT_DOWNLOADED: (e) => `Opened ${fileName(e)}${e.queryId ? ` from ${queryWord(e)}` : ''}`,

  AUDIT_EXPORTED: (e) => `Downloaded the activity report${field(e, 'reference') ? ` ${field(e, 'reference')}` : ''} (${field(e, 'rows') ?? 0} records)`,
  AUDIT_VIEWED: (e) => (field(e, 'queryId') ? `Looked at the history of query ${field(e, 'queryId')}` : 'Looked at the activity records'),
  AUDIT_VERIFIED: (e) => (field(e, 'ok') === false ? 'Checked the records for tampering: a problem was found' : 'Checked the records for tampering: none found'),
  AUDIT_CHAIN_RESET: () => 'Restarted the activity records (test system only)',
  QUERY_STATE_RESET: () => 'Cleared all query data (test system only)',
  CREDENTIAL_ROTATED: () => 'Changed the mailbox password',
  UIDVALIDITY_CHANGED: () => 'Noticed the email provider had reset the mailbox',
  SENT_APPEND_FAILED: () => 'Sent an email, but could not save a copy in the Sent folder',
  EMAIL_DELIVERY_CONFIRMED: (e) => `Confirmed an email for ${queryWord(e)} was sent`,
  EMAIL_DELIVERY_DENIED: (e) => `Confirmed an email for ${queryWord(e)} was not sent`,
};

/**
 * { who, action, other } for one event: who acted, what they did, and the other person
 * involved ({ label: 'To' | 'From', person }) or null. `fallback` is used when no sentence fits.
 */
export function narrate(event, { who, fallback = '' } = {}) {
  let said;
  try {
    said = SENTENCES[event.action]?.(event);
  } catch {
    said = null;
  }
  if (said && typeof said === 'object') return { who, action: said.action || fallback, other: said.other || null };
  return { who, action: said || fallback, other: null };
}

export { personWithRole as describePerson, ROLE_WORDS };
