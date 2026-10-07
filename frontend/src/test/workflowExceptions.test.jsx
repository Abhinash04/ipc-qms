import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';

import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { FRONT_OFFICE_USER as FRONT_OFFICE } from '@/test/frontOfficeUser';
import { AUDIT_EVENT, WORKFLOW_STATE } from '@/constants/statusEnums';
import { buildLifecycle, STAGE, STAGE_STATUS } from '@/constants/queryLifecycle';
import { buildSpecialEvents, SPECIAL_EVENT } from '@/constants/workflowExceptions';
import { QueryLifecycleTimeline } from '@/components/workflow/QueryLifecycleTimeline';
import { fakeCaseMail } from '@/test/fakeCaseMail';
import { EXTERNAL_INQUIRER as INQUIRER } from '@/test/externalInquirer';

vi.mock('@/services/api/mailboxService');

const s = () => useWorkflowStore.getState();

const OIC = findUserById('USR-0003');
const OFFICIAL = findUserById('USR-0004');
const COLLEAGUE = findUserById('USR-0009');
const ADMIN = findUserById('USR-0008');

const caseMail = fakeCaseMail();

const enquiry = () => ({
  mailboxMessageId: 'MSG-00001',
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Clarification on monograph revision',
  body: 'Please clarify the applicable monograph.',
  receivedAt: '2026-08-18T09:00:00.000Z',
});

async function assignedQuery() {
  const { queryId } = s().ingestEmail(enquiry());
  s().verifyQuery(queryId, FRONT_OFFICE);
  await s().forwardToOic(queryId, FRONT_OFFICE, caseMail.forwardQuery);
  s().assignQuery(queryId, OFFICIAL.id, OIC);
  return queryId;
}

const specialEventsOf = (queryId) => buildSpecialEvents({ query: s().getQuery(queryId), audit: s().getAudit(queryId) });

beforeEach(async () => {
  await s().hydrate();
  await s().resetDemo();
});

describe('buildSpecialEvents', () => {
  const query = {
    queryId: 'QRY-2026-00001',
    pullbackHistory: [
      {
        fromStage: WORKFLOW_STATE.DRAFTING,
        toStage: WORKFLOW_STATE.PENDING_ASSIGNMENT,
        pulledBackByName: 'Super Admin',
        pulledBackByRole: 'SUPER_ADMIN',
        reason: 'Incorrect assignment',
        remarks: 'Reassigning to the right division.',
        previousAssignee: OFFICIAL.name,
        newAssignee: null,
        pulledBackAt: '2026-08-20T10:00:00.000Z',
      },
    ],
    transferHistory: [
      {
        fromAssigneeId: OFFICIAL.id,
        toAssigneeId: COLLEAGUE.id,
        transferredAt: '2026-08-19T10:00:00.000Z',
        transferType: 'MANUAL',
        reason: 'Subject expertise',
        byUserId: OFFICIAL.id,
      },
      {
        fromAssigneeId: COLLEAGUE.id,
        toAssigneeId: OFFICIAL.id,
        transferredAt: '2026-08-19T18:00:00.000Z',
        transferType: 'AUTOMATIC',
        reason: 'No action before the deadline',
        matchPercent: 82,
        byUserId: null,
      },
    ],
  };
  const audit = [
    // The audit copy of the manual transfer above: one transfer, not two.
    {
      event: AUDIT_EVENT.QUERY_TRANSFERRED,
      at: '2026-08-19T10:00:01.000Z',
      details: `Transferred From: ${OFFICIAL.name} | Transferred To: ${COLLEAGUE.name} | Reason: Subject expertise`,
    },
    // A transfer only the audit trail knows about.
    {
      auditId: 'AUD-9',
      event: AUDIT_EVENT.QUERY_TRANSFERRED,
      actorId: COLLEAGUE.id,
      at: '2026-08-21T09:00:00.000Z',
      details: `Case ID: QRY-2026-00001 | Transferred From: ${COLLEAGUE.name} | Transferred To: ${OFFICIAL.name} | Transferred By: ${COLLEAGUE.name} | Reason: Leave`,
    },
    { event: AUDIT_EVENT.QUERY_ASSIGNED, at: '2026-08-18T12:00:00.000Z' },
  ];

  it('lists every pull back and transfer once, oldest first', () => {
    const events = buildSpecialEvents({ query, audit });
    expect(events.map((e) => [e.type, e.at])).toEqual([
      [SPECIAL_EVENT.TRANSFER_QUERY, '2026-08-19T10:00:00.000Z'],
      [SPECIAL_EVENT.TRANSFER_QUERY, '2026-08-19T18:00:00.000Z'],
      [SPECIAL_EVENT.PULL_BACK, '2026-08-20T10:00:00.000Z'],
      [SPECIAL_EVENT.TRANSFER_QUERY, '2026-08-21T09:00:00.000Z'],
    ]);
  });

  it('records who, from, to and why for each', () => {
    const [manual, automatic, pullback, auditOnly] = buildSpecialEvents({ query, audit });

    expect(pullback).toMatchObject({
      fromState: WORKFLOW_STATE.DRAFTING,
      toState: WORKFLOW_STATE.PENDING_ASSIGNMENT,
      by: { name: 'Super Admin' },
      from: { stage: 'Drafting Response', name: OFFICIAL.name },
      to: { stage: 'Forwarded to Officer-in-Charge' },
      reason: 'Incorrect assignment',
      remarks: 'Reassigning to the right division.',
    });
    expect(manual).toMatchObject({
      automatic: false,
      by: { name: OFFICIAL.name },
      from: { name: OFFICIAL.name },
      to: { name: COLLEAGUE.name },
      reason: 'Subject expertise',
    });
    expect(automatic).toMatchObject({ automatic: true, by: { name: 'BRIDGETECH' }, remarks: '82% match to the query' });
    expect(auditOnly).toMatchObject({
      by: { name: COLLEAGUE.name },
      from: { name: COLLEAGUE.name },
      to: { name: OFFICIAL.name },
      reason: 'Leave',
    });
  });

  it('is empty for a query that never left its normal path', () => {
    expect(buildSpecialEvents({ query: { queryId: 'Q' }, audit: [] })).toEqual([]);
    expect(buildSpecialEvents()).toEqual([]);
  });
});

describe('special actions stay out of the normal progress line', () => {
  it('shows a transfer as an exception, while the assignment stage still describes the assignment', async () => {
    const queryId = await assignedQuery();
    s().transferQuery(queryId, COLLEAGUE.id, 'Subject expertise', OFFICIAL);

    const transfer = specialEventsOf(queryId).at(-1);
    expect(transfer).toMatchObject({
      type: SPECIAL_EVENT.TRANSFER_QUERY,
      from: { name: OFFICIAL.name },
      to: { name: COLLEAGUE.name },
      reason: 'Subject expertise',
    });
    expect(transfer.at).toBeTruthy();

    const stages = buildLifecycle({ query: s().getQuery(queryId), audit: s().getAudit(queryId) });
    const assigned = stages.find((stage) => stage.key === STAGE.ASSIGNED);
    expect(assigned.activity.action).toMatch(/^Assigned the query/);
  });

  it('shows a pull back as an exception with its stages, actor, time and reason', async () => {
    const queryId = await assignedQuery();
    await s().generateAiDraft(queryId, OFFICIAL);
    await s().pullBackQuery(queryId, WORKFLOW_STATE.PENDING_ASSIGNMENT, 'Incorrect assignment', 'Wrong division.', ADMIN);

    const pullback = specialEventsOf(queryId).at(-1);
    expect(pullback).toMatchObject({
      type: SPECIAL_EVENT.PULL_BACK,
      from: { stage: 'Drafting Response' },
      to: { stage: 'Forwarded to Officer-in-Charge' },
      reason: 'Incorrect assignment',
      remarks: 'Wrong division.',
    });
    expect(pullback.by.name).toBeTruthy();
    expect(pullback.at).toBeTruthy();
  });
});

describe('the progress line animates its completed segments', () => {
  it('fills only the segments after completed stages', () => {
    const stages = [
      { key: 'a', label: 'A', status: STAGE_STATUS.COMPLETE },
      { key: 'b', label: 'B', status: STAGE_STATUS.CURRENT },
      { key: 'c', label: 'C', status: STAGE_STATUS.PENDING },
    ];
    const { container } = render(<QueryLifecycleTimeline stages={stages} />);
    const track = container.querySelector('ol');

    expect(track.querySelectorAll('[data-filled]')).toHaveLength(2);
    expect(track.querySelectorAll('[data-filled] .wf-sweep-x')).toHaveLength(2);
    expect(track.querySelector('li[aria-current="step"] .wf-current')).not.toBeNull();
    // The segment leading out of the current stage shows the work in progress.
    const active = track.querySelectorAll('[data-active]');
    expect(active).toHaveLength(1);
    expect(active[0].closest('li')).toHaveAttribute('aria-current', 'step');
  });
});
