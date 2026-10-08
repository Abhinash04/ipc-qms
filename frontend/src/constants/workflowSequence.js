import { AUDIT_EVENT, AUDIT_EVENT_LABELS, SERVER_EVENTS, WORKFLOW_STATE } from './statusEnums';
import { STAGE, STAGE_STATUS, auditActor } from './queryLifecycle';
import { SPECIAL_EVENT, sortWorkflowEvents, timeOf } from './workflowExceptions';

export const WORKFLOW_ITEM = Object.freeze({
  STAGE: 'stage',
  TRANSFER: 'transfer',
  AUTOMATIC_TRANSFER: 'automatic-transfer',
  PULL_BACK: 'pullback',
  CHANGES_REQUESTED: 'changes-requested',
  // Stands for stages left out of a filtered view.
  GAP: 'gap',
});

export const WORKFLOW_VIEW = Object.freeze({
  ALL: 'all',
  NORMAL: 'normal',
  EXCEPTIONS: 'exceptions',
});

export const isExceptionalItem = (item) => item.kind !== WORKFLOW_ITEM.STAGE && item.kind !== WORKFLOW_ITEM.GAP;
const isStageItem = (item) => item.kind === WORKFLOW_ITEM.STAGE;
const isDoneItem = (item) => !isStageItem(item) || item.status === STAGE_STATUS.COMPLETE;

const isReviewStage = (stage) => String(stage?.key || '').startsWith(`${STAGE.REVIEW}-`);

// Stages whose named person is the assigned official, who can change from one pass to the next.
const ASSIGNEE_STAGES = new Set([STAGE.ASSIGNED, STAGE.DRAFTED]);

// The audit events that show a stage was reached. Review levels are matched separately, in order.
const STAGE_MARKERS = {
  [STAGE.SUBMITTED]: [AUDIT_EVENT.QUERY_RECEIVED],
  [STAGE.VERIFIED]: [AUDIT_EVENT.QUERY_REGISTERED, AUDIT_EVENT.ACKNOWLEDGEMENT_SENT],
  [STAGE.FORWARDED]: [AUDIT_EVENT.QUERY_FORWARDED],
  [STAGE.ASSIGNED]: [AUDIT_EVENT.QUERY_ASSIGNED],
  [STAGE.DRAFTED]: [AUDIT_EVENT.REVIEW_ADDED, AUDIT_EVENT.DRAFT_GENERATED, AUDIT_EVENT.DRAFT_UPDATED],
  [STAGE.FINAL_APPROVAL]: [AUDIT_EVENT.FINAL_APPROVAL_GRANTED],
  [STAGE.DISPATCHED]: [AUDIT_EVENT.RESPONSE_DISPATCHED],
  [STAGE.DELIVERED]: [AUDIT_EVENT.QUERY_CLOSED],
  [STAGE.FO_APPROVED]: [AUDIT_EVENT.QUERY_REGISTERED],
  [STAGE.AI_SUMMARY_ACK]: [AUDIT_EVENT.ACKNOWLEDGEMENT_SENT],
  [STAGE.AI_REPLY]: [SERVER_EVENTS.AUTO_REPLY_PREPARED, SERVER_EVENTS.AUTO_REPLY_APPROVED],
  [STAGE.REPLY_SENT]: [AUDIT_EVENT.RESPONSE_DISPATCHED],
};

/**
 * The last lifecycle stage a query had completed while it sat in a workflow state: where a pull
 * back leaves from, or the stage it returns to. -1 when the state has no place on the line.
 */
export function reachedStageIndex(stages, state, reviewLevel = null) {
  const indexOf = (key) => stages.findIndex((stage) => stage.key === key);
  switch (state) {
    case WORKFLOW_STATE.RECEIVED:
      return indexOf(STAGE.SUBMITTED);
    case WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION:
      return indexOf(STAGE.VERIFIED);
    case WORKFLOW_STATE.PENDING_ASSIGNMENT:
      return indexOf(STAGE.FORWARDED);
    case WORKFLOW_STATE.ASSIGNED:
    case WORKFLOW_STATE.DRAFTING:
    case WORKFLOW_STATE.RETURNED_FOR_REVISION:
      return indexOf(STAGE.ASSIGNED);
    case WORKFLOW_STATE.UNDER_REVIEW: {
      const level = stages.findIndex((stage) => isReviewStage(stage) && stage.label === reviewLevel);
      const target = level >= 0 ? level : stages.findIndex(isReviewStage);
      return target > 0 ? target - 1 : indexOf(STAGE.DRAFTED);
    }
    case WORKFLOW_STATE.PENDING_FINAL_APPROVAL: {
      const final = indexOf(STAGE.FINAL_APPROVAL);
      return final > 0 ? final - 1 : -1;
    }
    case WORKFLOW_STATE.APPROVED:
    case WORKFLOW_STATE.READY_FOR_DISPATCH:
      return indexOf(STAGE.FINAL_APPROVAL);
    case WORKFLOW_STATE.DISPATCHED:
      return indexOf(STAGE.DISPATCHED);
    case WORKFLOW_STATE.CLOSED:
      return indexOf(STAGE.DELIVERED);
    default:
      return -1;
  }
}

/** For each stage index, the audit entry that dates its visit within one pass (the last one found). */
function markersOf(stages, entries) {
  const found = new Map();
  stages.forEach((stage, index) => {
    const events = STAGE_MARKERS[stage.key];
    const hit = events && entries.filter((entry) => events.includes(entry.event)).at(-1);
    if (hit) found.set(index, hit);
  });
  const reviews = entries.filter((entry) => entry.event === AUDIT_EVENT.REVIEW_COMPLETED);
  stages
    .map((stage, index) => (isReviewStage(stage) ? index : -1))
    .filter((index) => index >= 0)
    .forEach((index, level) => reviews[level] && found.set(index, reviews[level]));
  return found;
}

// Undated rows belong only to an open-ended window, so they never jump ahead of a dated pull back.
function within(at, lower, upper) {
  const time = timeOf(at);
  if (time === null) return upper === null;
  return (lower === null || time > lower) && (upper === null || time <= upper);
}

/**
 * Stages keep their order; each exceptional action goes in just after the last stage reached by
 * then (stages with no recorded time don't move it), never ahead of an earlier action, and on the
 * final pass never past the stage being worked on.
 */
function interleave(occurrences, events, final) {
  const times = occurrences.map((occurrence) => timeOf(occurrence.at));
  const open = final ? occurrences.findIndex((occurrence) => occurrence.status !== STAGE_STATUS.COMPLETE) : -1;
  const limit = open >= 0 ? open : occurrences.length;
  const slots = Array.from({ length: occurrences.length + 1 }, () => []);
  let floor = 0;
  for (const event of events) {
    const time = timeOf(event.at);
    let slot = occurrences.length;
    if (time !== null) {
      const after = times.findLastIndex((reached) => reached !== null && reached <= time);
      const before = times.findIndex((reached) => reached !== null && reached > time);
      slot = after >= 0 ? after + 1 : before >= 0 ? before : occurrences.length;
    }
    slot = Math.max(floor, Math.min(slot, limit));
    floor = slot;
    slots[slot].push(event);
  }
  return occurrences.flatMap((occurrence, index) => [...slots[index], occurrence]).concat(slots[occurrences.length]);
}

function earlierVisit(stage, { actor, marker, reopenedBy }) {
  let activity = { action: 'Reached before a later pull back' };
  if (reopenedBy) {
    activity = {
      actor: reopenedBy.by?.name || null,
      role: reopenedBy.by?.role || null,
      action: 'Returned to this stage by a pull back',
      at: reopenedBy.at,
    };
  } else if (marker) {
    activity = { ...auditActor(marker), action: AUDIT_EVENT_LABELS[marker.event] || marker.event, at: marker.at };
  }
  return { ...stage, actor, activity, note: undefined };
}

const itemKind = (event) => {
  if (event.type === SPECIAL_EVENT.PULL_BACK) return WORKFLOW_ITEM.PULL_BACK;
  if (event.type === SPECIAL_EVENT.CHANGES_REQUESTED) return WORKFLOW_ITEM.CHANGES_REQUESTED;
  return event.automatic ? WORKFLOW_ITEM.AUTOMATIC_TRANSFER : WORKFLOW_ITEM.TRANSFER;
};

/**
 * One chronological line for the whole case: the lifecycle stages, with every transfer, pull back
 * and change request placed where it happened. Each pull back closes a pass; the next pass starts again at the
 * stage it returned to, so a stage visited twice appears twice. `connections` pair each pull back
 * with the earlier visit it returned to, and each change request with the draft it sent back, for
 * the return arrow; `kind` says which.
 */
export function buildWorkflowSequence({ stages = [], events = [], audit = [] } = {}) {
  if (stages.length === 0) return { items: [], connections: [] };

  const ordered = sortWorkflowEvents(events);
  const pullbacks = ordered.filter((event) => event.type === SPECIAL_EVENT.PULL_BACK);
  const others = ordered.filter((event) => event.type !== SPECIAL_EVENT.PULL_BACK);
  const trail = sortWorkflowEvents(audit);
  const firstOpen = stages.findIndex((stage) => stage.status !== STAGE_STATUS.COMPLETE);

  const ids = new Set();
  const uniqueId = (base) => {
    let id = base;
    for (let n = 2; ids.has(id); n += 1) id = `${base}#${n}`;
    ids.add(id);
    return id;
  };
  const eventItem = (event, extra = {}) => ({
    kind: itemKind(event),
    id: uniqueId(event.id || `${event.type}-${event.at || 'undated'}`),
    at: event.at || null,
    event,
    ...extra,
  });

  const items = [];
  const connections = [];
  const visits = new Map();
  let start = 0;
  let lower = null;
  let reopenedBy = null;

  [...pullbacks, null].forEach((pullback) => {
    const final = pullback === null;
    const upper = final ? null : timeOf(pullback.at);
    const inPass = (at) => within(at, lower, upper);
    const markers = markersOf(stages, trail.filter((entry) => inPass(entry.at)));

    let end = stages.length - 1;
    if (final) {
      if (firstOpen >= 0) start = Math.min(start, firstOpen);
    } else {
      end = Math.max(start, reachedStageIndex(stages, pullback.fromState));
      if (pullback.fromState === WORKFLOW_STATE.UNDER_REVIEW) {
        const reviewed = [...markers.keys()].filter((index) => isReviewStage(stages[index]));
        end = Math.max(end, ...reviewed);
      }
    }

    const occurrences = [];
    for (let index = start; index <= end; index += 1) {
      const stage = stages[index];
      const visit = (visits.get(stage.key) || 0) + 1;
      visits.set(stage.key, visit);
      const marker = markers.get(index);
      const reopened = reopenedBy && index === start ? reopenedBy : null;
      const actor = !final && ASSIGNEE_STAGES.has(stage.key) ? pullback.from?.name || null : stage.actor;
      occurrences.push({
        kind: WORKFLOW_ITEM.STAGE,
        id: uniqueId(`${stage.key}:${visit}`),
        stage: final && !reopened ? stage : earlierVisit(stage, { actor, marker, reopenedBy: reopened }),
        status: final ? stage.status : STAGE_STATUS.COMPLETE,
        visit,
        at: marker?.at || reopened?.at || (final ? stage.activity?.at : null) || null,
      });
    }

    items.push(...interleave(occurrences, others.filter((event) => inPass(event.at)).map((event) => eventItem(event)), final));
    if (final) return;

    let returnIndex = reachedStageIndex(stages, pullback.toState, pullback.toReviewLevel);
    if (returnIndex < 0 || returnIndex > end) returnIndex = end;
    const returnStage = stages[returnIndex];
    const item = eventItem(pullback, { returnsTo: returnStage.label });
    const target = items.findLast((entry) => entry.kind === WORKFLOW_ITEM.STAGE && entry.stage.key === returnStage.key);
    items.push(item);
    if (target) connections.push({ id: `${item.id}->${target.id}`, from: item.id, to: target.id, kind: item.kind });

    start = returnIndex;
    lower = upper;
    reopenedBy = pullback;
  });

  // A change request sends the draft back to the assigned official without closing the pass, so
  // its arrow returns to the latest draft before it (or the assignment, when there was no draft yet).
  items.forEach((item, index) => {
    if (item.kind !== WORKFLOW_ITEM.CHANGES_REQUESTED) return;
    const earlier = items.slice(0, index).filter(isStageItem);
    const target =
      earlier.findLast((entry) => entry.stage.key === STAGE.DRAFTED) ||
      earlier.findLast((entry) => entry.stage.key === STAGE.ASSIGNED);
    if (target) connections.push({ id: `${item.id}->${target.id}`, from: item.id, to: target.id, kind: item.kind });
  });
  const position = new Map(items.map((item, index) => [item.id, index]));
  connections.sort((a, b) => position.get(a.from) - position.get(b.from));

  return { items, connections };
}

/**
 * The intended path: each lifecycle stage once, in the lifecycle's own order and current status —
 * built from the stage list, not from the visits, so pull-back revisits never repeat a stage here.
 * Ids match each stage's first visit in the full sequence.
 */
export function getNormalWorkflowItems(stages = []) {
  return stages.map((stage) => ({
    kind: WORKFLOW_ITEM.STAGE,
    id: `${stage.key}:1`,
    stage,
    status: stage.status,
    visit: 1,
    at: stage.activity?.at || null,
  }));
}

/**
 * The exceptional actions with the visits that explain them: the stage each run of actions left
 * from, the stage the line went on to, and for a pull back the earlier visit it returned to. Items
 * keep their order and ids from the full sequence; skipped stretches become one gap item.
 */
export function getExceptionalWorkflowItems({ items = [], connections = [] } = {}) {
  const position = new Map(items.map((item, index) => [item.id, index]));
  const returnsTo = new Map(connections.map((connection) => [connection.from, connection.to]));
  const keep = new Set();

  items.forEach((item, index) => {
    if (!isExceptionalItem(item)) return;
    keep.add(index);
    const before = items.findLastIndex((other, at) => at < index && isStageItem(other));
    const after = items.findIndex((other, at) => at > index && isStageItem(other));
    if (before >= 0) keep.add(before);
    if (after >= 0) keep.add(after);
    if (returnsTo.has(item.id)) keep.add(position.get(returnsTo.get(item.id)));
  });

  const kept = [...keep].sort((a, b) => a - b);
  const visible = [];
  kept.forEach((index, n) => {
    const previous = kept[n - 1];
    if (n > 0 && index - previous > 1) {
      const skipped = items.slice(previous + 1, index);
      visible.push({
        kind: WORKFLOW_ITEM.GAP,
        id: `gap:${items[previous].id}:${items[index].id}`,
        hidden: skipped.length,
        done: skipped.every(isDoneItem),
      });
    }
    visible.push(items[index]);
  });

  const shown = new Set(visible.map((item) => item.id));
  return {
    items: visible,
    connections: connections.filter((connection) => shown.has(connection.from) && shown.has(connection.to)),
  };
}

/** What one view of the workflow shows, derived from the full sequence; the sequence is not changed. */
export function selectWorkflowView(sequence, stages, view = WORKFLOW_VIEW.ALL) {
  if (view === WORKFLOW_VIEW.NORMAL) return { items: getNormalWorkflowItems(stages), connections: [] };
  if (view === WORKFLOW_VIEW.EXCEPTIONS) return getExceptionalWorkflowItems(sequence);
  return sequence;
}
