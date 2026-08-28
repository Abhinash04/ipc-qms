import { describe, it, expect } from 'vitest';

import { buildCaseOfficials } from '@/constants/caseOfficials';
import { STAGE_STATUS } from '@/constants/queryLifecycle';
import { AUDIT_EVENT, WORKFLOW_STATE } from '@/constants/statusEnums';
import { findUserById } from '@/constants/mockUsers';

const INQUIRER = findUserById('USR-0001');
const FRONT_OFFICE = findUserById('USR-0002');
const OIC = findUserById('USR-0003');
const OFFICIAL = findUserById('USR-0004');
const REVIEWER_A = findUserById('USR-0005');
const REVIEWER_B = findUserById('USR-0006');

const query = (overrides = {}) => ({
  queryId: 'QRY-2026-00001',
  inquirer: { id: INQUIRER.id, name: INQUIRER.name, email: INQUIRER.email },
  workflowState: WORKFLOW_STATE.RECEIVED,
  currentAssigneeId: null,
  currentWorkflowStepId: null,
  ...overrides,
});

const auditFor = (...events) =>
  events.map(([event, actor]) => ({ event, actor, at: '2026-08-26T09:00:00.000Z' }));

const FORWARDED = auditFor(
  [AUDIT_EVENT.QUERY_REGISTERED, FRONT_OFFICE.name],
  [AUDIT_EVENT.QUERY_FORWARDED, FRONT_OFFICE.name],
);

const ASSIGNED = [...FORWARDED, ...auditFor([AUDIT_EVENT.QUERY_ASSIGNED, OIC.name])];

const reviewStep = (stepId, assignedUserId, sequence, status = 'PENDING') => ({
  stepId,
  queryId: 'QRY-2026-00001',
  stepType: 'REVIEW',
  sequence,
  assignedUserId,
  status,
});

const byRole = (rows, role) => rows.find((r) => r.role === role);

describe('the chain names the real people, not role placeholders', () => {
  it('reads Front Office and the OIC off the audit actors', () => {
    const rows = buildCaseOfficials({
      query: query({
        workflowState: WORKFLOW_STATE.DRAFTING,
        currentAssigneeId: OFFICIAL.id,
      }),
      audit: ASSIGNED,
    });

    expect(byRole(rows, 'Inquirer').name).toBe(INQUIRER.name);
    expect(byRole(rows, 'Front Office').name).toBe(FRONT_OFFICE.name);
    expect(byRole(rows, 'Officer-in-Charge').name).toBe(OIC.name);
    expect(byRole(rows, 'Assigned Official').name).toBe(OFFICIAL.name);
  });

  it('falls back to the inquirers email when no name was captured', () => {
    const rows = buildCaseOfficials({
      query: query({ inquirer: { email: 'someone@example.com' } }),
    });
    expect(byRole(rows, 'Inquirer').name).toBe('someone@example.com');
  });

  it('leaves a name null rather than inventing one', () => {
    const rows = buildCaseOfficials({ query: query() });
    expect(byRole(rows, 'Officer-in-Charge').name).toBeNull();
  });
});

describe('status tracks where the case actually is', () => {
  it('puts Front Office in the chair on a freshly received query', () => {
    const rows = buildCaseOfficials({ query: query(), audit: [] });

    expect(byRole(rows, 'Front Office').status).toBe(STAGE_STATUS.CURRENT);
    expect(byRole(rows, 'Officer-in-Charge').status).toBe(STAGE_STATUS.PENDING);
    // Nobody is assigned yet, so that row is not invented.
    expect(byRole(rows, 'Assigned Official')).toBeUndefined();
  });

  it('hands over to the OIC once forwarded', () => {
    const rows = buildCaseOfficials({
      query: query({ workflowState: WORKFLOW_STATE.PENDING_ASSIGNMENT }),
      audit: FORWARDED,
    });

    expect(byRole(rows, 'Front Office').status).toBe(STAGE_STATUS.COMPLETE);
    expect(byRole(rows, 'Officer-in-Charge').status).toBe(STAGE_STATUS.CURRENT);
  });

  it('hands over to the official while they draft', () => {
    const rows = buildCaseOfficials({
      query: query({
        workflowState: WORKFLOW_STATE.DRAFTING,
        currentAssigneeId: OFFICIAL.id,
      }),
      audit: ASSIGNED,
    });

    expect(byRole(rows, 'Officer-in-Charge').status).toBe(STAGE_STATUS.COMPLETE);
    expect(byRole(rows, 'Assigned Official').status).toBe(STAGE_STATUS.CURRENT);
  });

  it('returns the case to the official when changes are requested', () => {
    const rows = buildCaseOfficials({
      query: query({
        workflowState: WORKFLOW_STATE.RETURNED_FOR_REVISION,
        currentAssigneeId: OFFICIAL.id,
      }),
      audit: ASSIGNED,
    });

    expect(byRole(rows, 'Assigned Official').status).toBe(STAGE_STATUS.CURRENT);
  });

  it('marks the OIC current again at final approval', () => {
    const rows = buildCaseOfficials({
      query: query({
        workflowState: WORKFLOW_STATE.PENDING_FINAL_APPROVAL,
        currentAssigneeId: OFFICIAL.id,
      }),
      audit: ASSIGNED,
      steps: [
        reviewStep('STP-1', REVIEWER_A.id, 2, 'COMPLETED'),
        { stepId: 'STP-F', stepType: 'FINAL_APPROVAL', sequence: 1000, assignedUserId: OIC.id },
      ],
    });

    expect(byRole(rows, 'Officer-in-Charge').status).toBe(STAGE_STATUS.CURRENT);
    expect(byRole(rows, 'Final approval').status).toBe(STAGE_STATUS.CURRENT);
    expect(byRole(rows, 'Reviewer I').status).toBe(STAGE_STATUS.COMPLETE);
  });

  it('puts Front Office back in the chair for dispatch', () => {
    const rows = buildCaseOfficials({
      query: query({ workflowState: WORKFLOW_STATE.READY_FOR_DISPATCH }),
      audit: [],
    });
    expect(byRole(rows, 'Front Office').status).toBe(STAGE_STATUS.CURRENT);
  });
});

describe('review levels', () => {
  const steps = [
    reviewStep('STP-2', REVIEWER_B.id, 3),
    reviewStep('STP-1', REVIEWER_A.id, 2, 'COMPLETED'),
  ];

  it('lists every level in sequence order, naming each reviewer', () => {
    const rows = buildCaseOfficials({
      query: query({
        workflowState: WORKFLOW_STATE.UNDER_REVIEW,
        currentAssigneeId: OFFICIAL.id,
        currentWorkflowStepId: 'STP-2',
      }),
      audit: ASSIGNED,
      steps,
    });

    expect(byRole(rows, 'Reviewer I').name).toBe(REVIEWER_A.name);
    expect(byRole(rows, 'Reviewer II').name).toBe(REVIEWER_B.name);
  });

  it('marks only the level the case is sitting on as current', () => {
    const rows = buildCaseOfficials({
      query: query({
        workflowState: WORKFLOW_STATE.UNDER_REVIEW,
        currentAssigneeId: OFFICIAL.id,
        currentWorkflowStepId: 'STP-2',
      }),
      audit: ASSIGNED,
      steps,
    });

    expect(byRole(rows, 'Reviewer I').status).toBe(STAGE_STATUS.COMPLETE);
    expect(byRole(rows, 'Reviewer II').status).toBe(STAGE_STATUS.CURRENT);
  });

  it('omits final approval until the case has left the front of the workflow', () => {
    const rows = buildCaseOfficials({
      query: query({ workflowState: WORKFLOW_STATE.PENDING_ASSIGNMENT }),
      audit: FORWARDED,
      steps: [{ stepId: 'STP-F', stepType: 'FINAL_APPROVAL', sequence: 1000, assignedUserId: OIC.id }],
    });

    expect(byRole(rows, 'Final approval')).toBeUndefined();
  });
});

describe('it never crashes on thin data', () => {
  it('returns nothing without a query', () => {
    expect(buildCaseOfficials()).toEqual([]);
    expect(buildCaseOfficials({ query: null })).toEqual([]);
  });

  it('copes with no steps and no audit', () => {
    const rows = buildCaseOfficials({ query: query() });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.role && r.status)).toBe(true);
  });
});
