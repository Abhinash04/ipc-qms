import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { ROLES } from '../constants/roles.js';
import { authHeader } from './helpers/auth.js';
import { protectedValueViolations } from '../middleware/authorizeCaseDelta.js';

/**
 * Authorization on POST /queries/persist.
 *
 * The value rules are asserted as UNIT tests, because they are a pure function
 * of (principal, submitted delta, stored state) and the suite runs with
 * DATABASE_URL blank. They used to be HTTP tests, which was possible only while
 * the rules ignored stored state — and ignoring it was a bug: the client sends
 * the whole case document on every transition, so an ordinary save resends the
 * current workflowState untouched and was refused as though the caller were
 * causing that transition.
 *
 * The scope half is unit-tested in caseAccess.test.js. What is left over HTTP
 * here is the wiring: unauthenticated callers, and failing closed with no store.
 */

const CASE_ID = 'QRY-2026-00005';

/**
 * A role the system does not have.
 *
 * INQUIRER was one until it was removed, and a session minted before that still
 * carries it — which is exactly the principal these rules have to fail closed
 * on. `scopeKindForRole` answers NONE for it and `roleCanPerform` answers false
 * for every action, so it is the strongest available statement of "this rule
 * grants nothing by default". These assertions read `ROLES.INQUIRER` until the
 * constant was deleted, at which point they were passing `undefined` and every
 * one of them held vacuously.
 */
const REMOVED_ROLE = 'INQUIRER';

const user = (role) => ({ id: 'USR-0011', role, name: 'Test', email: 't@ipc.example' });

/** Stored state for a case that already exists. */
const storedCase = (over = {}) => ({
  query: { workflowState: 'ASSIGNED', currentAssigneeId: 'USR-0011', ...over },
  versionStatusById: new Map(),
});

/** Stored state for a case that does not exist yet. */
const noCase = { query: null, versionStatusById: new Map() };

const check = (role, body, stored = storedCase()) => protectedValueViolations(user(role), body, stored);

describe('resending an unchanged value is not a transition', () => {
  /**
   * The regression that sent this back for a second pass.
   *
   * An assigned official transferring a case sitting in ASSIGNED resends
   * `workflowState: 'ASSIGNED'` untouched — the transfer only changes the
   * assignee. ASSIGNED is reached by the Officer-in-Charge's ASSIGN, which that
   * role does not hold, so treating the field's presence as an attempt to set
   * it refused the transfer. It refused every other ordinary save on that case
   * too.
   */
  it('lets an assigned official transfer a case that is sitting in ASSIGNED', () => {
    const body = {
      query: { queryId: CASE_ID, workflowState: 'ASSIGNED', currentAssigneeId: 'USR-0010' },
    };

    expect(check(ROLES.ASSIGNED_OFFICIAL, body)).toEqual([]);
  });

  it('lets a reviewer save against a case whose state they could not have caused', () => {
    const body = { query: { queryId: CASE_ID, workflowState: 'ASSIGNED' } };

    expect(check(ROLES.REVIEWER, body)).toEqual([]);
  });

  it('does not re-litigate an assignee that is not changing', () => {
    const body = { query: { queryId: CASE_ID, currentAssigneeId: 'USR-0011' } };

    // USR-0011 is already the stored assignee, and REVIEWER holds no ASSIGN.
    expect(check(ROLES.REVIEWER, body)).toEqual([]);
  });

  it('does not re-litigate a response status that is not changing', () => {
    const stored = storedCase();
    stored.versionStatusById.set('RESP-1', 'FINAL_APPROVED');
    const body = { upsertVersions: [{ responseId: 'RESP-1', queryId: CASE_ID, status: 'FINAL_APPROVED' }] };

    // Before the stored comparison, every later save on a case with an approved
    // response was refused for everyone but the Officer-in-Charge.
    expect(check(ROLES.ASSIGNED_OFFICIAL, body, stored)).toEqual([]);
  });
});

describe('changing a workflow state', () => {
  const moveTo = (state) => ({ query: { queryId: CASE_ID, workflowState: state } });

  it('refuses a state the role holds no action for', () => {
    // A role the table does not name holds no action, so no transition is theirs.
    expect(check(REMOVED_ROLE, moveTo('READY_FOR_DISPATCH'))).toContain('query.workflowState');
    expect(check(ROLES.REVIEWER, moveTo('DISPATCHED'))).toContain('query.workflowState');
  });

  it('permits the role whose action reaches that state', () => {
    expect(check(ROLES.FRONT_OFFICE, moveTo('PENDING_ASSIGNMENT'))).toEqual([]);
    expect(check(ROLES.REVIEWER, moveTo('PENDING_FINAL_APPROVAL'))).toEqual([]);
    expect(check(ROLES.ASSIGNED_OFFICIAL, moveTo('DRAFTING'))).toEqual([]);
  });

  it('lets pullback re-point a case to any earlier stage', () => {
    // ADMIN holds PULLBACK and nothing else, and a pullback targets any stage.
    expect(check(ROLES.ADMIN, moveTo('DRAFTING'))).toEqual([]);
  });

  it('refuses a state the server does not recognise', () => {
    expect(check(ROLES.SUPER_ADMIN, moveTo('TOTALLY_MADE_UP'))).toContain('query.workflowState');
  });

  it('reserves intake-only states for the roles that see every case', () => {
    expect(check(ROLES.ASSIGNED_OFFICIAL, moveTo('RECEIVED'))).toContain('query.workflowState');
    expect(check(ROLES.FRONT_OFFICE, moveTo('RECEIVED'))).toEqual([]);
  });
});

describe('creating a case', () => {
  /**
   * The value layer does not decide WHO may create a case — `creationViolation`
   * in the middleware does, and it refuses everyone who reaches it. What is
   * asserted here is the split: opening a case at RECEIVED is not a transition
   * anybody needs a workflow action for, so the value rules stay out of it even
   * for a principal that holds no action whatsoever.
   */
  it('does not gate the initial state on a workflow action', () => {
    const body = { query: { queryId: 'QRY-2026-00099', workflowState: 'RECEIVED' } };

    expect(check(REMOVED_ROLE, body, noCase)).toEqual([]);
  });

  it('does not let a new case be opened mid-workflow', () => {
    const body = { query: { queryId: 'QRY-2026-00099', workflowState: 'READY_FOR_DISPATCH' } };

    expect(check(REMOVED_ROLE, body, noCase)).toContain('query.workflowState');
  });
});

describe('naming the assignee', () => {
  const assignTo = (id) => ({ query: { queryId: CASE_ID, currentAssigneeId: id } });

  /**
   * Writing a NEW assignee is how a principal would grant itself membership of
   * a case, so this is the direct anti-self-promotion rule.
   */
  it.each([REMOVED_ROLE, ROLES.REVIEWER])('refuses %s naming a different assignee', (role) => {
    expect(check(role, assignTo('USR-0004'))).toContain('query.currentAssigneeId');
  });

  it('permits the Officer-in-Charge, who assigns', () => {
    expect(check(ROLES.OFFICER_IN_CHARGE, assignTo('USR-0004'))).toEqual([]);
  });

  it('permits an official transferring a case', () => {
    expect(check(ROLES.ASSIGNED_OFFICIAL, assignTo('USR-0009'))).toEqual([]);
  });

  it('allows clearing it, which is what a pre-assignment pullback does', () => {
    expect(check(REMOVED_ROLE, assignTo(null))).toEqual([]);
  });
});

describe('the final-approval lock', () => {
  const setStatus = (status) => ({
    upsertVersions: [{ responseId: 'RESP-NEW', queryId: CASE_ID, status, content: 'text' }],
  });

  it.each([REMOVED_ROLE, ROLES.REVIEWER, ROLES.ASSIGNED_OFFICIAL, ROLES.FRONT_OFFICE, ROLES.ADMIN])(
    'refuses %s marking a response FINAL_APPROVED',
    (role) => {
      expect(check(role, setStatus('FINAL_APPROVED'))).toContain('upsertVersions.status');
    },
  );

  it.each([ROLES.OFFICER_IN_CHARGE, ROLES.SUPER_ADMIN])('permits %s, who holds FINAL_APPROVE', (role) => {
    expect(check(role, setStatus('FINAL_APPROVED'))).toEqual([]);
  });

  it('leaves an ordinary draft alone', () => {
    expect(check(ROLES.ASSIGNED_OFFICIAL, setStatus('DRAFT'))).toEqual([]);
  });
});

describe('deltas that authorize nothing', () => {
  it.each(Object.values(ROLES))('does not object to %s sending an empty delta', (role) => {
    expect(check(role, {})).toEqual([]);
  });
});

describe('the route wiring', () => {
  const persistAs = (role, body) =>
    request(app).post('/api/v1/queries/persist').set(authHeader(role)).send(body);

  it('401s an unauthenticated caller rather than 403', async () => {
    const res = await request(app).post('/api/v1/queries/persist').send({});
    expect(res.status).toBe(401);
  });

  /**
   * Both checks read stored state, so with no store the guard must refuse
   * outright. Skipping it because the database is down is exactly how an
   * interim guard becomes decorative — a 200 here would mean it never ran.
   */
  // A scoped role, a second scoped role and one that sees every case: the guard
  // must refuse all three, because it is the store it cannot reach, not the
  // caller. REMOVED_ROLE cannot appear here — `authHeader` mints from a seeded
  // account, and naming a role no account holds makes it throw. It named
  // INQUIRER until that role was deleted, after which `authHeader(undefined)`
  // silently fell back to SUPER_ADMIN and this case duplicated the last one.
  it.each([ROLES.ASSIGNED_OFFICIAL, ROLES.REVIEWER, ROLES.SUPER_ADMIN])(
    'fails closed for %s when case storage is unavailable',
    async (role) => {
      const res = await persistAs(role, { query: { queryId: CASE_ID, workflowState: 'ASSIGNED' } });

      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/access cannot be determined/i);
    },
  );
});
