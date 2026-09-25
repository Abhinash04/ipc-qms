import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { ROLES } from '../constants/roles.js';
import { authHeader } from './helpers/auth.js';
import { protectedValueViolations } from '../middleware/authorizeCaseDelta.js';

const CASE_ID = 'QRY-2026-00005';

const REMOVED_ROLE = 'INQUIRER';

const user = (role) => ({ id: 'USR-0011', role, name: 'Test', email: 't@ipc.example' });

const storedCase = (over = {}) => ({
  query: { workflowState: 'ASSIGNED', currentAssigneeId: 'USR-0011', ...over },
  versionStatusById: new Map(),
});

const noCase = { query: null, versionStatusById: new Map() };

const check = (role, body, stored = storedCase()) => protectedValueViolations(user(role), body, stored);

describe('resending an unchanged value is not a transition', () => {
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

    expect(check(ROLES.REVIEWER, body)).toEqual([]);
  });

  it('does not re-litigate a response status that is not changing', () => {
    const stored = storedCase();
    stored.versionStatusById.set('RESP-1', 'FINAL_APPROVED');
    const body = { upsertVersions: [{ responseId: 'RESP-1', queryId: CASE_ID, status: 'FINAL_APPROVED' }] };

    expect(check(ROLES.ASSIGNED_OFFICIAL, body, stored)).toEqual([]);
  });
});

describe('changing a workflow state', () => {
  const moveTo = (state) => ({ query: { queryId: CASE_ID, workflowState: state } });

  it('refuses a state the role holds no action for', () => {
    expect(check(REMOVED_ROLE, moveTo('READY_FOR_DISPATCH'))).toContain('query.workflowState');
    expect(check(ROLES.REVIEWER, moveTo('DISPATCHED'))).toContain('query.workflowState');
  });

  it('permits the role whose action reaches that state', () => {
    expect(check(ROLES.FRONT_OFFICE, moveTo('PENDING_ASSIGNMENT'))).toEqual([]);
    expect(check(ROLES.REVIEWER, moveTo('PENDING_FINAL_APPROVAL'))).toEqual([]);
    expect(check(ROLES.ASSIGNED_OFFICIAL, moveTo('DRAFTING'))).toEqual([]);
  });

  it('lets pullback re-point a case to any earlier stage', () => {
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

  it.each([REMOVED_ROLE, ROLES.REVIEWER])('refuses %s naming a different assignee', (role) => {
    expect(check(role, assignTo('USR-0004'))).toContain('query.currentAssigneeId');
  });

  it('permits the Officer-in-Charge, who assigns', () => {
    const pending = storedCase({ workflowState: 'PENDING_ASSIGNMENT', currentAssigneeId: null });

    expect(check(ROLES.OFFICER_IN_CHARGE, assignTo('USR-0004'), pending)).toEqual([]);
  });

  it('refuses the Officer-in-Charge re-pointing a case that is already assigned', () => {
    expect(check(ROLES.OFFICER_IN_CHARGE, assignTo('USR-0004'))).toContain('query.currentAssigneeId');
  });

  it('refuses an Admin naming a new assignee', () => {
    expect(check(ROLES.ADMIN, assignTo('USR-0004'))).toContain('query.currentAssigneeId');
  });

  it('permits an official transferring a case', () => {
    expect(check(ROLES.ASSIGNED_OFFICIAL, assignTo('USR-0009'))).toEqual([]);
  });

  it.each(['DRAFTING', 'UNDER_REVIEW', 'RETURNED_FOR_REVISION', 'PENDING_FINAL_APPROVAL'])(
    'refuses a transfer once drafting has started (%s)',
    (workflowState) => {
      const stored = storedCase({ workflowState });

      expect(check(ROLES.ASSIGNED_OFFICIAL, assignTo('USR-0009'), stored)).toContain('query.currentAssigneeId');
      expect(check(ROLES.SUPER_ADMIN, assignTo('USR-0009'), stored)).toContain('query.currentAssigneeId');
    },
  );

  it('refuses a transfer that also moves the case out of ASSIGNED', () => {
    const body = { query: { queryId: CASE_ID, workflowState: 'DRAFTING', currentAssigneeId: 'USR-0009' } };

    expect(check(ROLES.ASSIGNED_OFFICIAL, body)).toContain('query.currentAssigneeId');
  });

  it.each(['USR-0005', 'USR-0003', 'USR-0008', 'USR-9999'])('refuses a transfer to %s, who is not an Assigned Official', (id) => {
    expect(check(ROLES.ASSIGNED_OFFICIAL, assignTo(id))).toContain('query.currentAssigneeId');
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

  it.each([ROLES.ASSIGNED_OFFICIAL, ROLES.REVIEWER, ROLES.SUPER_ADMIN])(
    'fails closed for %s when case storage is unavailable',
    async (role) => {
      const res = await persistAs(role, { query: { queryId: CASE_ID, workflowState: 'ASSIGNED' } });

      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/access cannot be determined/i);
    },
  );
});
