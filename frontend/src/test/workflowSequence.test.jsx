import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, screen, within, fireEvent } from '@testing-library/react';

import { AUDIT_EVENT, WORKFLOW_STATE } from '@/constants/statusEnums';
import { STAGE, STAGE_STATUS } from '@/constants/queryLifecycle';
import { SPECIAL_EVENT, sortWorkflowEvents } from '@/constants/workflowExceptions';
import {
  WORKFLOW_ITEM,
  WORKFLOW_VIEW,
  buildWorkflowSequence,
  getExceptionalWorkflowItems,
  getNormalWorkflowItems,
  reachedStageIndex,
  selectWorkflowView,
} from '@/constants/workflowSequence';
import { QueryLifecycleTimeline } from '@/components/workflow/QueryLifecycleTimeline';

const KEYS = [
  [STAGE.SUBMITTED, 'Enquiry submitted'],
  [STAGE.VERIFIED, 'Verified & acknowledged'],
  [STAGE.FORWARDED, 'Forwarded to Officer-in-Charge'],
  [STAGE.ASSIGNED, 'Assigned to an official'],
  [STAGE.DRAFTED, 'Response drafted'],
  [`${STAGE.REVIEW}-S1`, 'Reviewer I'],
  [`${STAGE.REVIEW}-S2`, 'Reviewer II'],
  [STAGE.FINAL_APPROVAL, 'Final approval'],
  [STAGE.DISPATCHED, 'Response dispatched'],
  [STAGE.DELIVERED, 'Inquirer received response'],
];

/** The lifecycle with every stage before `current` complete; `current` = KEYS.length means closed. */
const lifecycle = (current = KEYS.length) =>
  KEYS.map(([key, label], index) => ({
    key,
    label,
    actor: key === STAGE.ASSIGNED ? 'Meera Iyer' : null,
    status: index < current ? STAGE_STATUS.COMPLETE : index === current ? STAGE_STATUS.CURRENT : STAGE_STATUS.PENDING,
  }));

const at = (minute) => `2026-10-05T10:${String(minute).padStart(2, '0')}:00.000Z`;
const entry = (event, minute) => ({ event, at: at(minute) });

const transfer = (id, minute, from, to, extra = {}) => ({
  id,
  type: SPECIAL_EVENT.TRANSFER_QUERY,
  at: minute === null ? null : at(minute),
  by: { name: from, role: 'Assigned Official' },
  from: { name: from },
  to: { name: to },
  reason: 'No action within the action limit',
  remarks: null,
  automatic: false,
  ...extra,
});

const pullback = (id, minute, fromState, toState, extra = {}) => ({
  id,
  type: SPECIAL_EVENT.PULL_BACK,
  at: at(minute),
  fromState,
  toState,
  toReviewLevel: null,
  by: { name: 'Front Office', role: 'Front Office' },
  from: { stage: 'Assigned to Official', name: 'Neha Singh' },
  to: { stage: 'Forwarded to Officer-in-Charge', name: 'Unassigned' },
  reason: 'Incorrect assignment',
  remarks: null,
  automatic: false,
  ...extra,
});

const AUDIT = [
  entry(AUDIT_EVENT.QUERY_RECEIVED, 0),
  entry(AUDIT_EVENT.QUERY_REGISTERED, 1),
  entry(AUDIT_EVENT.QUERY_FORWARDED, 2),
  entry(AUDIT_EVENT.QUERY_ASSIGNED, 3),
];

const shape = ({ items }) =>
  items.map((item) => (item.kind === WORKFLOW_ITEM.STAGE ? `${item.stage.key}${item.visit > 1 ? `#${item.visit}` : ''}` : item.kind));

describe('sortWorkflowEvents', () => {
  it('orders oldest first, keeps same-instant events in their recorded order and puts undated ones last', () => {
    const events = [transfer('late', 9, 'A', 'B'), transfer('none', null, 'A', 'B'), transfer('t1', 5, 'A', 'B'), transfer('t2', 5, 'B', 'C')];
    expect(sortWorkflowEvents(events).map((e) => e.id)).toEqual(['t1', 't2', 'late', 'none']);
  });
});

describe('reachedStageIndex', () => {
  const stages = lifecycle();
  const keyOf = (state, level) => stages[reachedStageIndex(stages, state, level)]?.key;

  it('maps a workflow state to the last stage it had completed', () => {
    expect(keyOf(WORKFLOW_STATE.PENDING_ASSIGNMENT)).toBe(STAGE.FORWARDED);
    expect(keyOf(WORKFLOW_STATE.DRAFTING)).toBe(STAGE.ASSIGNED);
    expect(keyOf(WORKFLOW_STATE.UNDER_REVIEW, 'Reviewer II')).toBe(`${STAGE.REVIEW}-S1`);
    expect(keyOf(WORKFLOW_STATE.UNDER_REVIEW)).toBe(STAGE.DRAFTED);
    expect(keyOf(WORKFLOW_STATE.PENDING_FINAL_APPROVAL)).toBe(`${STAGE.REVIEW}-S2`);
    expect(reachedStageIndex(stages, 'SOMETHING_ELSE')).toBe(-1);
  });
});

describe('buildWorkflowSequence', () => {
  it('is the plain lifecycle when nothing left the normal path', () => {
    const stages = lifecycle(4);
    const sequence = buildWorkflowSequence({ stages, audit: AUDIT });
    expect(sequence.items.map((item) => item.stage)).toEqual(stages);
    expect(sequence.items.map((item) => item.status)).toEqual(stages.map((stage) => stage.status));
    expect(sequence.connections).toEqual([]);
    expect(buildWorkflowSequence()).toEqual({ items: [], connections: [] });
  });

  it('places consecutive transfers after the assignment they followed, in order', () => {
    const events = [transfer('t1', 5, 'Arjun Nair', 'Meera Iyer'), transfer('t2', 6, 'Meera Iyer', 'Rawat Jatin')];
    const audit = [...AUDIT, entry(AUDIT_EVENT.REVIEW_ADDED, 8)];
    expect(shape(buildWorkflowSequence({ stages: lifecycle(5), events, audit }))).toEqual([
      STAGE.SUBMITTED,
      STAGE.VERIFIED,
      STAGE.FORWARDED,
      STAGE.ASSIGNED,
      WORKFLOW_ITEM.TRANSFER,
      WORKFLOW_ITEM.TRANSFER,
      STAGE.DRAFTED,
      `${STAGE.REVIEW}-S1`,
      `${STAGE.REVIEW}-S2`,
      STAGE.FINAL_APPROVAL,
      STAGE.DISPATCHED,
      STAGE.DELIVERED,
    ]);
  });

  it('puts actions on an open case before the stage being worked on', () => {
    const events = [transfer('t1', 5, 'Arjun Nair', 'Meera Iyer')];
    const kinds = shape(buildWorkflowSequence({ stages: lifecycle(4), events, audit: AUDIT }));
    expect(kinds.indexOf(WORKFLOW_ITEM.TRANSFER)).toBe(kinds.indexOf(STAGE.DRAFTED) - 1);
  });

  it('tells an automatic transfer from a manual one', () => {
    const events = [transfer('auto', 5, 'Arjun Nair', 'Meera Iyer', { automatic: true, by: { name: 'BRIDGETECH' } })];
    const { items } = buildWorkflowSequence({ stages: lifecycle(), events, audit: AUDIT });
    expect(items.find((item) => item.kind !== WORKFLOW_ITEM.STAGE).kind).toBe(WORKFLOW_ITEM.AUTOMATIC_TRANSFER);
  });

  it('closes a pass at a pull back and starts again from the stage it returned to', () => {
    const events = [
      transfer('t1', 5, 'Arjun Nair', 'Neha Singh'),
      pullback('p1', 10, WORKFLOW_STATE.ASSIGNED, WORKFLOW_STATE.PENDING_ASSIGNMENT),
    ];
    const audit = [...AUDIT, entry(AUDIT_EVENT.QUERY_ASSIGNED, 12), entry(AUDIT_EVENT.REVIEW_ADDED, 20)];
    const sequence = buildWorkflowSequence({ stages: lifecycle(), events, audit });

    expect(shape(sequence)).toEqual([
      STAGE.SUBMITTED,
      STAGE.VERIFIED,
      STAGE.FORWARDED,
      STAGE.ASSIGNED,
      WORKFLOW_ITEM.TRANSFER,
      WORKFLOW_ITEM.PULL_BACK,
      `${STAGE.FORWARDED}#2`,
      `${STAGE.ASSIGNED}#2`,
      STAGE.DRAFTED,
      `${STAGE.REVIEW}-S1`,
      `${STAGE.REVIEW}-S2`,
      STAGE.FINAL_APPROVAL,
      STAGE.DISPATCHED,
      STAGE.DELIVERED,
    ]);

    const [connection] = sequence.connections;
    const byId = new Map(sequence.items.map((item) => [item.id, item]));
    expect(byId.get(connection.from).kind).toBe(WORKFLOW_ITEM.PULL_BACK);
    expect(byId.get(connection.to)).toMatchObject({ visit: 1, stage: { key: STAGE.FORWARDED } });
    expect(byId.get(connection.from).returnsTo).toBe('Forwarded to Officer-in-Charge');

    // The earlier pass names the official who held the case then, and its stages are done.
    const firstAssigned = sequence.items.find((item) => item.stage?.key === STAGE.ASSIGNED);
    expect(firstAssigned).toMatchObject({ status: STAGE_STATUS.COMPLETE, stage: { actor: 'Neha Singh' } });
    const reopened = sequence.items.find((item) => item.stage?.key === STAGE.FORWARDED && item.visit === 2);
    expect(reopened.stage.activity.action).toBe('Returned to this stage by a pull back');
  });

  it('returns each later pull back to the most recent earlier visit, with unique ids throughout', () => {
    const events = [
      pullback('p1', 10, WORKFLOW_STATE.ASSIGNED, WORKFLOW_STATE.PENDING_ASSIGNMENT),
      pullback('p2', 20, WORKFLOW_STATE.ASSIGNED, WORKFLOW_STATE.PENDING_ASSIGNMENT),
    ];
    const audit = [...AUDIT, entry(AUDIT_EVENT.QUERY_ASSIGNED, 12), entry(AUDIT_EVENT.QUERY_ASSIGNED, 22)];
    const sequence = buildWorkflowSequence({ stages: lifecycle(), events, audit });
    const byId = new Map(sequence.items.map((item) => [item.id, item]));

    expect(sequence.connections.map((c) => byId.get(c.to).visit)).toEqual([1, 2]);
    expect(new Set(sequence.items.map((item) => item.id)).size).toBe(sequence.items.length);
    expect(sequence.items.filter((item) => item.stage?.key === STAGE.FORWARDED).map((item) => item.visit)).toEqual([1, 2, 3]);
  });

  it('keeps a transfer that followed a pull back after the restart', () => {
    const events = [
      pullback('p1', 10, WORKFLOW_STATE.ASSIGNED, WORKFLOW_STATE.PENDING_ASSIGNMENT),
      transfer('t1', 15, 'Meera Iyer', 'Rawat Jatin'),
    ];
    const audit = [...AUDIT, entry(AUDIT_EVENT.QUERY_ASSIGNED, 12)];
    const kinds = shape(buildWorkflowSequence({ stages: lifecycle(), events, audit }));
    expect(kinds.slice(4, 8)).toEqual([WORKFLOW_ITEM.PULL_BACK, `${STAGE.FORWARDED}#2`, `${STAGE.ASSIGNED}#2`, WORKFLOW_ITEM.TRANSFER]);
  });

  it('gives events that share an id their own keys', () => {
    const events = [transfer('same', 5, 'A', 'B'), transfer('same', 6, 'B', 'C')];
    const { items } = buildWorkflowSequence({ stages: lifecycle(), events, audit: AUDIT });
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });
});

describe('the three views come from the one sequence', () => {
  const events = [
    transfer('t1', 5, 'Arjun Nair', 'Neha Singh'),
    pullback('p1', 10, WORKFLOW_STATE.ASSIGNED, WORKFLOW_STATE.PENDING_ASSIGNMENT),
  ];
  const audit = [...AUDIT, entry(AUDIT_EVENT.QUERY_ASSIGNED, 12), entry(AUDIT_EVENT.REVIEW_ADDED, 20)];
  const stages = lifecycle();
  const sequence = buildWorkflowSequence({ stages, events, audit });

  it('All is the full sequence, unchanged', () => {
    expect(selectWorkflowView(sequence, stages, WORKFLOW_VIEW.ALL)).toBe(sequence);
  });

  it('Normal is the lifecycle definition once each, even after revisits', () => {
    const normal = selectWorkflowView(sequence, stages, WORKFLOW_VIEW.NORMAL);
    expect(normal.items.map((item) => item.stage.key)).toEqual(KEYS.map(([key]) => key));
    expect(normal.items.every((item) => item.visit === 1 && item.kind === WORKFLOW_ITEM.STAGE)).toBe(true);
    expect(normal.connections).toEqual([]);
    expect(getNormalWorkflowItems(stages).map((item) => item.status)).toEqual(stages.map((stage) => stage.status));
  });

  it('Exceptions keeps the stage each action left from, where the line went, and where a pull back returned to', () => {
    const { items, connections } = selectWorkflowView(sequence, stages, WORKFLOW_VIEW.EXCEPTIONS);
    expect(shape({ items })).toEqual([
      STAGE.FORWARDED,
      STAGE.ASSIGNED,
      WORKFLOW_ITEM.TRANSFER,
      WORKFLOW_ITEM.PULL_BACK,
      `${STAGE.FORWARDED}#2`,
    ]);
    expect(connections).toEqual(sequence.connections);
  });

  it('marks the stages it skips between actions with one gap', () => {
    const spread = buildWorkflowSequence({
      stages,
      events: [transfer('t1', 5, 'A', 'B'), transfer('t2', 12, 'B', 'C')],
      audit: [
        ...AUDIT,
        entry(AUDIT_EVENT.REVIEW_ADDED, 8),
        entry(AUDIT_EVENT.REVIEW_COMPLETED, 9),
        entry(AUDIT_EVENT.REVIEW_COMPLETED, 11),
      ],
    });
    const { items } = getExceptionalWorkflowItems(spread);
    expect(items.map((item) => (item.kind === WORKFLOW_ITEM.STAGE ? item.stage.key : item.kind))).toEqual([
      STAGE.ASSIGNED,
      WORKFLOW_ITEM.TRANSFER,
      STAGE.DRAFTED,
      WORKFLOW_ITEM.GAP,
      `${STAGE.REVIEW}-S2`,
      WORKFLOW_ITEM.TRANSFER,
      STAGE.FINAL_APPROVAL,
    ]);
    expect(items[3]).toMatchObject({ hidden: 1, done: true });
  });

  it('Exceptions is empty when nothing left the normal path', () => {
    const plain = buildWorkflowSequence({ stages, audit: AUDIT });
    expect(getExceptionalWorkflowItems(plain)).toEqual({ items: [], connections: [] });
  });

  describe('drawn', () => {
    afterEach(() => vi.restoreAllMocks());
    const track = () => screen.getByRole('group', { name: 'Workflow progress' });

    it('Normal draws no actions and no arcs', () => {
      const { container } = render(<QueryLifecycleTimeline stages={stages} events={events} audit={audit} view={WORKFLOW_VIEW.NORMAL} />);
      expect(within(track()).getAllByRole('listitem')).toHaveLength(KEYS.length);
      expect(within(track()).queryByRole('button')).toBeNull();
      expect(within(track()).queryByText(/^Visit/)).toBeNull();
      expect(container.querySelector('path[data-return-arc]')).toBeNull();
    });

    it('Exceptions draws the actions with their context, the arc and working tooltips', async () => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 10, top: 30, width: 24, height: 24, right: 34, bottom: 54, x: 10, y: 30, toJSON: () => ({}),
      });
      const { container } = render(<QueryLifecycleTimeline stages={stages} events={events} audit={audit} view={WORKFLOW_VIEW.EXCEPTIONS} />);

      const stageNodes = track().querySelectorAll(`li[data-workflow-item="${WORKFLOW_ITEM.STAGE}"] [data-stage-trigger]`);
      expect([...stageNodes].map((node) => node.getAttribute('data-stage-trigger'))).toEqual([
        STAGE.FORWARDED,
        STAGE.ASSIGNED,
        STAGE.FORWARDED,
      ]);
      expect(container.querySelectorAll('path[data-return-arc]')).toHaveLength(1);

      await act(async () => within(track()).getByRole('button', { name: /^Pull back/ }).focus());
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Reason:Incorrect assignment');
    });

    it('removes stale arcs when the view changes', () => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 10, top: 30, width: 24, height: 24, right: 34, bottom: 54, x: 10, y: 30, toJSON: () => ({}),
      });
      const props = { stages, events, audit };
      const { container, rerender } = render(<QueryLifecycleTimeline {...props} view={WORKFLOW_VIEW.ALL} />);
      expect(container.querySelectorAll('path[data-return-arc]')).toHaveLength(1);
      rerender(<QueryLifecycleTimeline {...props} view={WORKFLOW_VIEW.NORMAL} />);
      expect(container.querySelectorAll('path[data-return-arc]')).toHaveLength(0);
      rerender(<QueryLifecycleTimeline {...props} view={WORKFLOW_VIEW.EXCEPTIONS} />);
      expect(container.querySelectorAll('path[data-return-arc]')).toHaveLength(1);
    });

    it('says so, instead of an empty line, when there are no actions to show', () => {
      render(<QueryLifecycleTimeline stages={stages} audit={AUDIT} view={WORKFLOW_VIEW.EXCEPTIONS} />);
      expect(screen.getByText('No pull backs or transfers recorded.')).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Workflow progress' })).toBeNull();
    });
  });
});

describe('the unified workflow line', () => {
  afterEach(() => vi.restoreAllMocks());

  const events = [
    transfer('t1', 5, 'Arjun Nair', 'Neha Singh', { reason: null, by: null }),
    pullback('p1', 10, WORKFLOW_STATE.ASSIGNED, WORKFLOW_STATE.PENDING_ASSIGNMENT),
  ];
  const audit = [...AUDIT, entry(AUDIT_EVENT.QUERY_ASSIGNED, 12)];
  const track = () => screen.getByRole('group', { name: 'Workflow progress' });

  it('draws stages and exceptional actions on one line, with no separate section', () => {
    render(<QueryLifecycleTimeline stages={lifecycle()} events={events} audit={audit} />);

    expect(screen.queryByRole('region', { name: /pull backs/i })).not.toBeInTheDocument();
    const items = within(track()).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-workflow-item')).slice(3, 7)).toEqual([
      WORKFLOW_ITEM.STAGE,
      WORKFLOW_ITEM.TRANSFER,
      WORKFLOW_ITEM.PULL_BACK,
      WORKFLOW_ITEM.STAGE,
    ]);
    expect(within(track()).getAllByText('Visit 2').length).toBeGreaterThan(0);
  });

  it('pins every visit tag to the bottom of its column, so tags line up however the labels wrap', () => {
    const { container } = render(<QueryLifecycleTimeline stages={lifecycle()} events={events} audit={audit} />);

    expect(container.querySelector('ol').className).toMatch(/items-stretch/);
    const tags = within(track()).getAllByText(/^Visit \d$/);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      const trigger = tag.closest('[data-stage-trigger]');
      expect(trigger.className).toMatch(/flex-1/);
      expect(trigger.lastElementChild).toBe(tag);
      expect(tag.previousElementSibling.className).toMatch(/flex-1/);
    }
  });

  it('labels every action control for assistive tech, without relying on colour', () => {
    render(<QueryLifecycleTimeline stages={lifecycle()} events={events} audit={audit} />);

    const back = within(track()).getByRole('button', { name: /^Pull back: from Assigned to Official to Forwarded to Officer-in-Charge, by Front Office/ });
    expect(back).toHaveTextContent('Pull back');
    expect(within(track()).getByRole('button', { name: /^Transfer: from Arjun Nair to Neha Singh/ })).toHaveTextContent('Transfer');
  });

  it('shows an action’s details on focus, leaving out what was not recorded', async () => {
    render(<QueryLifecycleTimeline stages={lifecycle()} events={events} audit={audit} />);

    await act(async () => within(track()).getByRole('button', { name: /^Pull back/ }).focus());
    const pullbackTip = await screen.findByRole('tooltip');
    expect(pullbackTip).toHaveTextContent('Reason:Incorrect assignment');
    expect(pullbackTip).toHaveTextContent('To:Forwarded to Officer-in-Charge · Unassigned');

    await act(async () => within(track()).getByRole('button', { name: /^Transfer/ }).focus());
    const transferTip = await screen.findByRole('tooltip');
    expect(transferTip).toHaveTextContent('From:Arjun Nair');
    expect(transferTip).not.toHaveTextContent('Reason:');
    expect(transferTip).not.toHaveTextContent('By:');
  });

  it('opens an action’s details on click', async () => {
    render(<QueryLifecycleTimeline stages={lifecycle()} events={events} audit={audit} />);
    fireEvent.click(within(track()).getByRole('button', { name: /^Transfer/ }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Transfer');
  });

  it('draws a decorative return arc with an arrowhead for each pull back', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 10, top: 30, width: 24, height: 24, right: 34, bottom: 54, x: 10, y: 30, toJSON: () => ({}),
    });
    const { container } = render(<QueryLifecycleTimeline stages={lifecycle()} events={events} audit={audit} />);

    const svg = container.querySelector('svg[aria-hidden="true"] marker')?.closest('svg');
    expect(svg).not.toBeNull();
    const arcs = svg.querySelectorAll('path[data-return-arc]');
    expect(arcs).toHaveLength(1);
    expect(arcs[0].getAttribute('marker-end')).toMatch(/^url\(#pullback-arrowhead-/);
    expect(arcs[0].getAttribute('d')).toMatch(/^M [\d.]+ [\d.]+ C /);
  });

  it('looks like the plain lifecycle when there are no exceptional actions', () => {
    const { container } = render(<QueryLifecycleTimeline stages={lifecycle(4)} events={[]} audit={audit} />);
    expect(within(track()).getAllByRole('listitem')).toHaveLength(KEYS.length);
    expect(container.querySelector('path[data-return-arc]')).toBeNull();
    expect(within(track()).queryByRole('button')).toBeNull();
  });
});
