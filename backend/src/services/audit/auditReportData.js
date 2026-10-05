import { USERS } from '../../constants/users.js';
import { ROLES } from '../../constants/roles.js';
import { areaOf, auditIdOf, changeValues, formatDateTime, present, statusWords } from './auditPresentation.js';

/**
 * The sections of the audit trail report, derived from the period's audit events. Pure
 * functions over rows, so each section can be checked on its own. Wording only claims what the
 * records show: where something needs a person's confirmation the status says so.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** "2026-10-01" in Indian Standard Time, for grouping by day. */
const istDay = (iso) => {
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? '' : new Date(time + IST_OFFSET_MS).toISOString().slice(0, 10);
};

/** "01 Oct 2026" for a day key. */
const dayLabel = (day) => formatDateTime(`${day}T06:30:00.000Z`).split(',')[0];

const count = (rows, ...actions) => rows.filter((row) => actions.includes(row.action)).length;
const distinctCases = (rows, ...actions) =>
  new Set(rows.filter((row) => actions.includes(row.action) && row.queryId).map((row) => row.queryId)).size;

export const UNAUTHORISED_ACTIONS = ['AUTHORIZATION_DENIED', 'AUTHENTICATION_FAILED'];

export const ADMIN_ACTIONS = [
  'AUDIT_CHAIN_RESET',
  'QUERY_STATE_RESET',
  'QUERY_PULLED_BACK',
  'CREDENTIAL_ROTATED',
  'AUDIT_EXPORTED',
];

const ROUTINE_ACTIONS = new Set(['AUDIT_VIEWED', 'AUDIT_VERIFIED', 'LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'LOGOUT']);
const ADMIN_ROLES = new Set([ROLES.ADMIN, ROLES.SUPER_ADMIN]);

/** The reporting period: the filters' dates, else the first and last event. */
export function reportPeriod(filters = {}, rows = []) {
  const times = rows.map((row) => String(row.timestamp)).filter(Boolean).sort();
  const from = filters.from || times[0] || null;
  const to = filters.to || times.at(-1) || null;
  const words = (iso) => (iso ? formatDateTime(iso).split(',')[0] : '-');
  return { from, to, label: `${words(from)} to ${words(to)}` };
}

/** Section 2: counts for the period. */
export function periodSummary(rows, verification = null) {
  return [
    ['Queries registered', distinctCases(rows, 'QUERY_RECEIVED', 'QUERY_REGISTERED', 'CASE_CREATED')],
    ['Acknowledgements sent', count(rows, 'ACKNOWLEDGEMENT_SENT')],
    ['Queries assigned', distinctCases(rows, 'QUERY_ASSIGNED')],
    ['Queries reassigned (transferred)', count(rows, 'QUERY_TRANSFERRED')],
    ['Responses approved', count(rows, 'FINAL_APPROVAL_GRANTED')],
    ['Responses sent to inquirers', count(rows, 'RESPONSE_DISPATCHED')],
    ['Queries closed', distinctCases(rows, 'QUERY_CLOSED')],
    ['Queries pulled back / reopened', count(rows, 'QUERY_PULLED_BACK')],
    ['User sign-ins', count(rows, 'LOGIN_SUCCEEDED')],
    ['Failed sign-in attempts', count(rows, 'LOGIN_FAILED')],
    ['Sign-outs', count(rows, 'LOGOUT')],
    ['Administrative changes', privilegedActivity(rows).filter((row) => row.action !== 'AUDIT_EXPORTED').length],
    ['Audit report exports', count(rows, 'AUDIT_EXPORTED')],
    ['Audit trail views', count(rows, 'AUDIT_VIEWED')],
    ['Attachments opened or downloaded', count(rows, 'ATTACHMENT_DOWNLOADED')],
    ['Unauthorised access attempts', count(rows, ...UNAUTHORISED_ACTIONS)],
    ['Critical audit exceptions', verification && !verification.ok ? verification.breaks?.length || 1 : 0],
  ];
}

/** Section 6: sign-in activity per day, oldest first, with totals. */
export function authenticationByDay(rows) {
  const days = new Map();
  const bump = (row, field) => {
    const day = istDay(row.timestamp);
    if (!day) return;
    if (!days.has(day)) days.set(day, { day, date: dayLabel(day), success: 0, failed: 0, logouts: 0, rejected: 0 });
    days.get(day)[field] += 1;
  };
  for (const row of rows) {
    if (row.action === 'LOGIN_SUCCEEDED') bump(row, 'success');
    else if (row.action === 'LOGIN_FAILED') bump(row, 'failed');
    else if (row.action === 'LOGOUT') bump(row, 'logouts');
    else if (row.action === 'AUTHENTICATION_FAILED') bump(row, 'rejected');
  }
  const list = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  const total = list.reduce(
    (sum, day) => ({
      success: sum.success + day.success,
      failed: sum.failed + day.failed,
      logouts: sum.logouts + day.logouts,
      rejected: sum.rejected + day.rejected,
    }),
    { success: 0, failed: 0, logouts: 0, rejected: 0 },
  );
  return { days: list, total };
}

/** What a privileged action acted on, in words. */
function objectOf(row) {
  const details = row.details && typeof row.details === 'object' ? row.details : {};
  if (row.action === 'AUDIT_EXPORTED') return `Audit report (${String(details.format || '').toUpperCase() || 'file'})`;
  if (row.queryId) return row.queryId;
  return '-';
}

/** Section 7: administrative actions, oldest first. */
export function privilegedActivity(rows) {
  return rows
    .filter(
      (row) =>
        ADMIN_ACTIONS.includes(row.action) ||
        (ADMIN_ROLES.has(row.actorRole) && row.actorType === 'human' && !ROUTINE_ACTIONS.has(row.action)),
    )
    .map((row) => {
      const view = present(row);
      const values = changeValues(row);
      const details = row.details && typeof row.details === 'object' ? row.details : {};
      // The same before/after as the detailed trail: recorded changes first, else the state the
      // activity changes (a reset, a download).
      const states = values ? null : ADMIN_STATES[row.action]?.(details);
      return {
        action: row.action,
        auditId: view.auditId,
        dateTime: view.dateTime,
        administrator: view.who,
        activity: view.activity,
        object: objectOf(row),
        previous: values?.previous || states?.[0] || view.previousValue || '-',
        next: values?.next || states?.[1] || view.newValue || '-',
        reference: details.reference || '-',
      };
    });
}

// Short before/after wording for the administrative activities whose change is not a field.
const ADMIN_STATES = {
  AUDIT_EXPORTED: (d) => ['Not downloaded', `Downloaded: ${d.rows ?? 0} records`],
  AUDIT_CHAIN_RESET: () => ['Earlier records', 'Records restarted (test system)'],
  QUERY_STATE_RESET: () => ['All query data', 'Cleared (test system)'],
  CREDENTIAL_ROTATED: () => ['Old mailbox password', 'New mailbox password'],
};

const groupKey = (row) => {
  const email = row.details && typeof row.details === 'object' ? row.details.email : null;
  return email || row.source?.ip || 'unknown';
};

/** Section 8: security events — refused access, rejected sessions, repeated failed sign-ins, integrity breaks. */
export function securityExceptions(rows, verification = null) {
  const events = [];
  const id = (row, index) => (typeof row.seq === 'number' ? `SEC-${String(row.seq).padStart(6, '0')}` : `SEC-U${index + 1}`);
  const who = (view) =>
    [
      view.user !== 'User' ? view.user : null,
      view.ipAddress && view.ipAddress !== 'Not recorded' ? view.ipAddress : null,
      view.deviceName || null,
    ]
      .filter(Boolean)
      .join(' / ') || '-';

  rows.forEach((row, index) => {
    if (row.action === 'AUTHORIZATION_DENIED') {
      const view = present(row);
      events.push({
        id: id(row, index),
        dateTime: view.dateTime,
        who: who(view),
        event: `Tried to open ${row.details?.path ? areaOf(row.details.path) : 'something'} without permission`,
        severity: 'Medium',
        actionTaken: 'Request blocked by role check',
        status: 'Open - for review',
      });
    } else if (row.action === 'AUTHENTICATION_FAILED') {
      const view = present(row);
      events.push({
        id: id(row, index),
        dateTime: view.dateTime,
        who: who(view),
        event: 'Expired or invalid session presented',
        severity: 'Low',
        actionTaken: 'Request refused',
        status: 'Open - for review',
      });
    }
  });

  const failures = new Map();
  rows.forEach((row, index) => {
    if (row.action !== 'LOGIN_FAILED') return;
    const key = groupKey(row);
    if (!failures.has(key)) failures.set(key, []);
    failures.get(key).push({ row, index });
  });
  for (const [key, attempts] of failures) {
    if (attempts.length < 3) continue;
    const last = attempts.at(-1);
    const view = present(last.row);
    events.push({
      id: id(last.row, last.index),
      dateTime: view.dateTime,
      who: [key, view.ipAddress && view.ipAddress !== 'Not recorded' && view.ipAddress !== key ? view.ipAddress : null].filter(Boolean).join(' / '),
      event: `Repeated failed sign-in (${attempts.length} attempts)`,
      severity: attempts.length >= 10 ? 'Medium' : 'Low',
      actionTaken: 'Attempts logged (no lockout policy)',
      status: 'Open - for review',
    });
  }

  for (const [index, problem] of (verification && !verification.ok ? verification.breaks || [] : []).entries()) {
    const auditId = auditIdOf({ seq: problem.seq });
    events.push({
      id: `SEC-I${index + 1}`,
      dateTime: '-',
      who: '-',
      event: `Audit record ${problem.reason === 'gap' ? 'missing' : 'altered'} at ${auditId}`,
      severity: 'Critical',
      actionTaken: 'Flagged by the integrity check',
      status: 'Open - for review',
    });
  }

  return events.sort((a, b) => a.id.localeCompare(b.id));
}

/** Section 5: one case's history, with the case status after each step. */
export function lifecycle(rows, queryId) {
  if (!queryId) return [];
  let status = '-';
  return rows
    .filter((row) => row.queryId === queryId && row.action !== 'AUDIT_VIEWED')
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
    .map((row) => {
      const view = present(row);
      if (row.changes?.status?.to) status = statusWords(row.changes.status.to);
      return { dateTime: view.dateTime, user: view.user, who: view.who, did: view.did, other: view.other, activity: view.activity, detail: view.details, status };
    });
}

/** Section 13: what the period's records call for, by severity. Empty lists read "None". */
export function findings(rows, verification = null) {
  const critical = [];
  const major = [];
  const minor = [];

  if (verification && !verification.ok) {
    const first = verification.firstBreak;
    critical.push(
      `The integrity check found ${verification.breaks?.length || 1} problem(s) in the audit records${
        first?.seq ? `, the first at ${auditIdOf({ seq: first.seq })}` : ''
      }. Investigate before relying on this report.`,
    );
  }

  const unauthorised = count(rows, ...UNAUTHORISED_ACTIONS);
  if (unauthorised > 10) major.push(`${unauthorised} unauthorised access attempts were recorded.`);
  else if (unauthorised > 0) minor.push(`${unauthorised} unauthorised access attempt(s) were recorded and blocked.`);

  const sendFailures = count(rows, 'EMAIL_SEND_FAILED');
  if (sendFailures) minor.push(`${sendFailures} email(s) could not be sent and needed a retry.`);

  const repeated = securityExceptions(rows).filter((event) => event.event.startsWith('Repeated failed sign-in')).length;
  if (repeated) minor.push(`${repeated} account(s) or address(es) had repeated failed sign-ins.`);

  const unsaved = rows.filter((row) => row.unpersisted).length;
  if (unsaved) minor.push(`${unsaved} audit record(s) were held in memory and not yet saved to the database.`);

  return { critical, major, minor };
}

export const RECOMMENDATIONS = [
  'Continue periodic review of application, authentication and administrative logs.',
  'Review privileged access at defined intervals.',
  'Maintain evidence of approvals for configuration changes.',
  'Keep server clocks synchronised with an authorised time source.',
  'Keep audit records in protected, backed-up storage.',
  'Review repeated failed sign-ins and unauthorised access attempts.',
  'Test restoration and retrieval of archived audit records periodically.',
];

const firstTime = (rows, predicate) => rows.filter(predicate).map((row) => String(row.timestamp)).sort()[0] || null;
const since = (iso) => (iso ? ` since ${formatDateTime(iso).split(',')[0]}` : ' from this release');

/** Section 12: the verification checklist, with honest statuses. */
export function checklist(rows) {
  const ipSince = firstTime(rows, (row) => row.source?.ip);
  const logoutSince = firstTime(rows, (row) => row.action === 'LOGOUT');
  const oldest = rows.map((row) => String(row.timestamp)).sort()[0];
  return [
    ['Unique user ID captured', 'Yes', 'Every action by a person carries their user ID'],
    ['Login / logout recorded', 'Yes', `Sign-in recorded; sign-out${since(logoutSince)}`],
    ['Failed login recorded', 'Yes', 'With the address tried and the reason'],
    ['Date / time captured', 'Yes', 'Server timestamp, shown in IST'],
    ['Source IP captured', 'Yes', `Recorded${since(ipSince)}`],
    ['Query creation recorded', 'Yes', 'Receipt and registration'],
    ['Assignment / reassignment recorded', 'Yes', 'Assignment and transfer'],
    ['Status changes recorded', 'Yes', 'Old and new values kept'],
    ['Priority / category changes recorded', 'Not applicable', 'Priority and category are not edited in the application'],
    ['Query closure recorded', 'Yes', 'Closed after the response is sent'],
    ['Query reopening recorded', 'Yes', 'Recorded as pull-back, with old and new stage'],
    ['User / role changes recorded', 'Not applicable', 'Users and roles are configured outside the application'],
    ['Configuration changes recorded', 'Not applicable', 'System settings are configured outside the application'],
    ['Unauthorised access recorded', 'Yes', 'Refused requests and invalid sessions'],
    ['Database audit logs enabled', 'Recommended', 'Enable auditing on the MongoDB server'],
    ['Export / download activity recorded', 'Yes', 'Audit exports and attachment downloads'],
    ['Audit logs protected from ordinary users', 'Yes', 'Administrators only; records cannot be edited or deleted'],
    ['Log monitoring performed', 'Reviewer to confirm', 'Confirm periodic review at sign-off'],
    ['Log backup available', 'Reviewer to confirm', 'As per the database backup policy'],
    ['Minimum log retention maintained', 'Yes', `Records are never deleted by the application${oldest ? `; oldest record ${formatDateTime(oldest).split(',')[0]}` : ''}`],
  ];
}

/** Section 9: integrity controls, and the result of the integrity check in one line. */
export function controls(verification = null) {
  const verdict = !verification
    ? 'Integrity check: not run.'
    : verification.ok
      ? `Integrity check: no alteration detected in ${verification.checked ?? 0} records.`
      : `Integrity check: alteration detected at ${auditIdOf({ seq: verification.firstBreak?.seq })}.`;
  return {
    verdict,
    items: [
      ['Audit records are generated automatically by the server', 'Implemented'],
      ['Application users cannot modify or delete audit records', 'Implemented'],
      ['Access to audit records is restricted to authorised personnel', 'Implemented (Administrators only)'],
      ['Access to audit records is itself recorded', 'Implemented (views and exports)'],
      ['Database audit logging is enabled', 'Recommended'],
      ['Clocks are synchronised with an authorised time source', 'Recommended (configure NTP on the server)'],
      ['Audit records are securely backed up', 'Reviewer to confirm'],
      ['Audit records are protected from unauthorised modification', 'Implemented (tamper detection)'],
      ['Archival and retrieval procedures are documented', 'Reviewer to confirm'],
      ['Abnormal activity is periodically reviewed', 'Reviewer to confirm'],
      ['Each record is sealed so alteration, deletion or reordering is detected', 'Implemented'],
    ],
  };
}

/** Section 11: access control review. */
export function accessReview(rows) {
  const administrators = USERS.filter((user) => ADMIN_ROLES.has(user.role)).length;
  return [
    ['Role-based access control implemented', 'Compliant', `${Object.keys(ROLES).length} roles; every request checks the role`],
    ['Privileged accounts reviewed', 'Compliant', `${administrators} administrative account(s)`],
    ['Generic / shared IDs', 'Reviewer to confirm', 'Each person signs in with their own account'],
    ['Unauthorised query access', 'Compliant', 'Case access limited to the people on the case'],
    ['Audit-log access restriction', 'Compliant', 'Administrators only; each view is recorded'],
    ['Failed-login monitoring', 'Compliant', `${count(rows, 'LOGIN_FAILED')} failed sign-in(s) recorded in the period`],
    ['Inactive accounts reviewed', 'Not applicable', 'Accounts are configured outside the application'],
  ];
}

/** Section 4: the information each record carries. */
export const MANDATORY_INFORMATION = [
  ['Event identification', 'Audit ID, activity, module', 'Captured'],
  ['Date and time', 'Server timestamp, shown in IST', 'Captured'],
  ['User', 'User ID, name, role, section, session ID', 'Captured'],
  ['Source', 'Full IP address, device name (from DNS), browser; server for background work', 'Captured'],
  ['Transaction', 'Case No., operation, previous value, new value, remarks', 'Captured'],
  ['Result', 'Success / failure / denied, failure reason', 'Captured'],
  ['Approval', 'Approving officer on final approval', 'Captured'],
  ['Escalation', 'No escalation step in the workflow', 'Not applicable'],
  ['Privilege / role changes', 'Configured outside the application', 'Not applicable'],
  ['Configuration changes', 'Configured outside the application', 'Not applicable'],
];
