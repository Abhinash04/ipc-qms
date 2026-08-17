import { create } from 'zustand';

import { BUSINESS_STATUS, WORKFLOW_STATE, AUDIT_EVENT } from '@/constants/statusEnums';
import { deriveBusinessStatus } from '@/constants/workflowRules';
import { findUserById } from '@/constants/mockUsers';
import { buildSeedState, AI_DRAFT_TEMPLATE, AI_ASSIGNMENT_RECOMMENDATION } from '@/constants/mockDomain';
import { loadAll, replaceAll, persistTransition, isEmpty } from '@/services/db/db';

const pad = (n) => String(n).padStart(5, '0');

function mintId(counters, prefix) {
  const next = (counters[prefix] || 0) + 1;
  return { id: `${prefix}-${pad(next)}`, prefix, next, bump: { [prefix]: next } };
}

const now = () => new Date().toISOString();

const actorName = (user) => user?.name || 'System';

const byQuery = (rows, queryId) => rows.filter((r) => r.queryId === queryId);

/**
 * Pure state transition — computes the next in-memory state from the previous
 * one. Kept side-effect free so persistence can be derived by diffing prev vs
 * next, rather than every action having to describe its own writes.
 */
function computeTransition(state, { queryId, event, actor, patch = {}, details, actorLabel, notify, mutate }) {
  const timestamp = now();
  const minted = mintId(state.counters, 'AUD');
  let counters = { ...state.counters, ...minted.bump };

  const nextWorkflowState = patch.workflowState;
  const queries = state.queries.map((q) => {
    if (q.queryId !== queryId) return q;
    const merged = { ...q, ...patch, updatedAt: timestamp };
    if (nextWorkflowState) {
      merged.businessStatus = deriveBusinessStatus(nextWorkflowState);
    }
    return merged;
  });

  const auditEvent = {
    auditId: minted.id,
    queryId,
    event,
    actor: actorLabel || actorName(actor),
    at: timestamp,
    details,
  };
  const auditEvents = [...state.auditEvents, auditEvent];

  let notifications = state.notifications;
  let notification = null;
  if (notify) {
    const notifMint = mintId(counters, 'NOTIF');
    counters = { ...counters, ...notifMint.bump };
    notification = {
      notificationId: notifMint.id,
      queryId,
      recipientRole: notify.recipientRole,
      message: notify.message,
      at: timestamp,
    };
    notifications = [...notifications, notification];
  }

  const base = { ...state, queries, auditEvents, notifications, counters };
  const next = mutate ? { ...base, ...mutate(base) } : base;
  return { next, auditEvent, notification };
}

/**
 * Write one transition to IndexedDB. Scoped to the affected query, so the
 * transaction stays small regardless of how many queries exist.
 */
async function persistDelta(prev, next, queryId, auditEvent, notification) {
  const prevStepIds = byQuery(prev.workflowSteps, queryId).map((s) => s.stepId);
  const nextSteps = byQuery(next.workflowSteps, queryId);
  const nextStepIds = new Set(nextSteps.map((s) => s.stepId));

  const prevReviewIds = new Set(byQuery(prev.reviews, queryId).map((r) => r.reviewId));
  const prevVersionIds = new Set(byQuery(prev.responseVersions, queryId).map((v) => v.responseId));

  await persistTransition({
    query: next.queries.find((q) => q.queryId === queryId) || null,
    auditEvent,
    notification,
    counters: next.counters,
    upsertSteps: nextSteps,
    deleteStepIds: prevStepIds.filter((id) => !nextStepIds.has(id)),
    addReviews: byQuery(next.reviews, queryId).filter((r) => !prevReviewIds.has(r.reviewId)),
    addVersions: byQuery(next.responseVersions, queryId).filter((v) => !prevVersionIds.has(v.responseId)),
  });
}

export const useWorkflowStore = create((set, get) => ({
  ...buildSeedState(),

  /** False until IndexedDB has been read — UI should wait before acting. */
  hydrated: false,
  /** Set if IndexedDB is unavailable (private mode, quota, etc.). */
  persistenceError: null,

  // -------------------------------------------------------------------------
  // Getters — for use INSIDE store actions via get(), NOT as component selectors.
  //
  // Everything below that filters/sorts allocates a new array per call. Passing
  // one to `useWorkflowStore(...)` would give useSyncExternalStore a fresh
  // reference on every snapshot and hang React in an infinite render loop
  // ("The result of getSnapshot should be cached"). In components, select the
  // raw slice (e.g. `state.workflowSteps`) and derive with useMemo — see
  // hooks/useQueryCase.js for the pattern.
  // -------------------------------------------------------------------------

  getQuery: (queryId) => get().queries.find((q) => q.queryId === queryId) || null,

  getSteps: (queryId) =>
    get()
      .workflowSteps.filter((s) => s.queryId === queryId)
      .sort((a, b) => a.sequence - b.sequence),

  getCurrentStep: (queryId) => {
    const query = get().getQuery(queryId);
    if (!query?.currentWorkflowStepId) return null;
    return get().workflowSteps.find((s) => s.stepId === query.currentWorkflowStepId) || null;
  },

  getVersions: (queryId) =>
    get().responseVersions.filter((v) => v.queryId === queryId),

  getLatestVersion: (queryId) => {
    const versions = get().getVersions(queryId);
    return versions.length ? versions[versions.length - 1] : null;
  },

  getReviews: (queryId) => get().reviews.filter((r) => r.queryId === queryId),

  getAudit: (queryId) =>
    get()
      .auditEvents.filter((a) => a.queryId === queryId)
      .sort((a, b) => new Date(a.at) - new Date(b.at)),

  getNotifications: () =>
    [...get().notifications].sort((a, b) => new Date(b.at) - new Date(a.at)),

  /**
   * The single writer. Computes the next state purely, commits it to memory
   * so the UI updates immediately, then persists the delta to IndexedDB.
   * Because the audit event is produced in the same step as the state
   * change, a transition can never be recorded without its audit row.
   */
  applyTransition: (options) => {
    const prev = get();
    const { next, auditEvent, notification } = computeTransition(prev, options);
    set(next);

    persistDelta(prev, next, options.queryId, auditEvent, notification).catch((error) => {
      console.error('[qms] failed to persist workflow transition', error);
      set({ persistenceError: String(error?.message || error) });
    });
  },

  // ---------------------------------------------------------------------
  // Phase 3 — Front Office intake & verification
  // ---------------------------------------------------------------------

  verifyQuery: (queryId, actor) =>
    get().applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.QUERY_REGISTERED,
      patch: { workflowState: WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION },
      details: 'Front Office verified the query details and attachments.',
    }),

  forwardToOic: (queryId, actor) =>
    get().applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.QUERY_FORWARDED,
      patch: { workflowState: WORKFLOW_STATE.PENDING_ASSIGNMENT },
      details: 'Query forwarded to the Officer-in-Charge for assignment.',
      notify: {
        recipientRole: 'OFFICER_IN_CHARGE',
        message: `${queryId} is awaiting assignment.`,
      },
    }),

  // ---------------------------------------------------------------------
  // Phase 4 — OIC assignment (AI recommends, human decides)
  // ---------------------------------------------------------------------

  assignQuery: (queryId, assigneeId, actor) => {
    const acceptedAi = assigneeId === AI_ASSIGNMENT_RECOMMENDATION.recommendedUserId;
    const assignee = findUserById(assigneeId);

    get().applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.QUERY_ASSIGNED,
      patch: {
        workflowState: WORKFLOW_STATE.ASSIGNED,
        currentAssigneeId: assigneeId,
        assignmentDecision: {
          assigneeId,
          acceptedAiRecommendation: acceptedAi,
          decidedAt: now(),
        },
      },
      details: `Assigned to ${assignee?.name || assigneeId}.`,
      notify: {
        recipientRole: 'ASSIGNED_OFFICIAL',
        message: `${queryId} was assigned to ${assignee?.name || assigneeId}.`,
      },
    });

    if (!acceptedAi) {
      const recommended = findUserById(AI_ASSIGNMENT_RECOMMENDATION.recommendedUserId);
      get().applyTransition({
        queryId,
        actor,
        event: AUDIT_EVENT.ASSIGNMENT_OVERRIDDEN,
        details: `AI recommended ${recommended?.name}; OIC assigned ${assignee?.name || assigneeId} instead.`,
      });
    }
  },

  generateAiDraft: (queryId, actor) => {
    const state = get();
    const versionNumber = state.getVersions(queryId).length + 1;
    const minted = mintId(state.counters, 'RESP');

    state.applyTransition({
      queryId,
      actor,
      actorLabel: 'AI Draft Assistant',
      event: AUDIT_EVENT.DRAFT_GENERATED,
      patch: { workflowState: WORKFLOW_STATE.DRAFTING },
      details: `AI generated response version v${versionNumber}.`,
      mutate: (base) => ({
        counters: { ...base.counters, ...minted.bump },
        responseVersions: [
          ...base.responseVersions,
          {
            responseId: minted.id,
            queryId,
            version: `v${versionNumber}`,
            label: 'AI generated',
            content: AI_DRAFT_TEMPLATE,
            createdBy: 'AI Draft Assistant',
            createdAt: now(),
            aiGenerated: true,
          },
        ],
      }),
    });
  },

  saveDraftVersion: (queryId, content, actor, label = 'Officer revision') => {
    const state = get();
    const versionNumber = state.getVersions(queryId).length + 1;
    const minted = mintId(state.counters, 'RESP');

    state.applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.DRAFT_UPDATED,
      patch: { workflowState: WORKFLOW_STATE.DRAFTING },
      details: `${label} saved as v${versionNumber}.`,
      mutate: (base) => ({
        counters: { ...base.counters, ...minted.bump },
        responseVersions: [
          ...base.responseVersions,
          {
            responseId: minted.id,
            queryId,
            version: `v${versionNumber}`,
            label,
            content,
            createdBy: actorName(actor),
            createdAt: now(),
            aiGenerated: false,
          },
        ],
      }),
    });
  },

  submitForReview: (queryId, actor) => {
    const state = get();
    const steps = state.getSteps(queryId);
    let stepCounter = state.counters.STEP || 0;
    const newSteps = [];
    const timestamp = now();

    if (steps.length === 0) {
      const draftMint = mintId({ STEP: stepCounter }, 'STEP');
      stepCounter = draftMint.next;
      newSteps.push({
        stepId: draftMint.id,
        queryId,
        stepType: 'DRAFT',
        sequence: 1,
        assignedUserId: state.getQuery(queryId)?.currentAssigneeId || null,
        status: 'COMPLETED',
        createdAt: timestamp,
        startedAt: timestamp,
        completedAt: timestamp,
      });

      const approvalMint = mintId({ STEP: stepCounter }, 'STEP');
      stepCounter = approvalMint.next;
      newSteps.push({
        stepId: approvalMint.id,
        queryId,
        stepType: 'FINAL_APPROVAL',
        sequence: 1000,
        assignedUserId: 'USR-0003',
        status: 'PENDING',
        createdAt: timestamp,
        startedAt: null,
        completedAt: null,
      });
    }

    const allSteps = [...steps, ...newSteps];
    const firstPendingReview = allSteps
      .filter((s) => s.stepType === 'REVIEW' && s.status === 'PENDING')
      .sort((a, b) => a.sequence - b.sequence)[0];

    const target = firstPendingReview
      ? { step: firstPendingReview, workflowState: WORKFLOW_STATE.UNDER_REVIEW }
      : {
          step: allSteps.find((s) => s.stepType === 'FINAL_APPROVAL'),
          workflowState: WORKFLOW_STATE.PENDING_FINAL_APPROVAL,
        };

    state.applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.DRAFT_UPDATED,
      patch: {
        workflowState: target.workflowState,
        currentWorkflowStepId: target.step?.stepId || null,
      },
      details: firstPendingReview
        ? 'Draft submitted for review.'
        : 'Draft submitted directly for final approval (no review levels configured).',
      notify: {
        recipientRole: firstPendingReview ? 'REVIEWER' : 'OFFICER_IN_CHARGE',
        message: `${queryId} is awaiting ${firstPendingReview ? 'review' : 'final approval'}.`,
      },
      mutate: (base) => ({
        counters: { ...base.counters, STEP: stepCounter },
        workflowSteps: [...base.workflowSteps, ...newSteps].map((s) =>
          s.stepId === target.step?.stepId
            ? { ...s, status: 'IN_PROGRESS', startedAt: s.startedAt || timestamp }
            : s,
        ),
      }),
    });
  },

  addReviewLevel: (queryId, reviewerId, actor) => {
    const state = get();
    const steps = state.getSteps(queryId);
    const reviewer = findUserById(reviewerId);
    const minted = mintId(state.counters, 'STEP');

    const reviewSteps = steps.filter((s) => s.stepType === 'REVIEW');
    const sequence = reviewSteps.length ? Math.max(...reviewSteps.map((s) => s.sequence)) + 1 : 2;
    const timestamp = now();

    state.applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.REVIEW_ADDED,
      details: `Review level added for ${reviewer?.name || reviewerId}.`,
      mutate: (base) => ({
        counters: { ...base.counters, ...minted.bump },
        workflowSteps: [
          ...base.workflowSteps,
          {
            stepId: minted.id,
            queryId,
            stepType: 'REVIEW',
            sequence,
            assignedUserId: reviewerId,
            status: 'PENDING',
            createdAt: timestamp,
            startedAt: null,
            completedAt: null,
          },
        ],
      }),
    });
  },

  deleteReviewLevel: (queryId, stepId, actor) => {
    const state = get();
    const step = state.workflowSteps.find((s) => s.stepId === stepId);
    if (!step || step.status !== 'PENDING') {
      return { ok: false, reason: 'Only a PENDING review level can be deleted.' };
    }
    const reviewer = findUserById(step.assignedUserId);

    state.applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.REVIEW_ADDED,
      details: `Review level for ${reviewer?.name || step.assignedUserId} removed (was pending).`,
      mutate: (base) => ({
        workflowSteps: base.workflowSteps.filter((s) => s.stepId !== stepId),
      }),
    });
    return { ok: true };
  },

  approveReview: (queryId, comment, actor) => {
    const state = get();
    const current = state.getCurrentStep(queryId);
    if (!current) return;

    const steps = state.getSteps(queryId);
    const nextReview = steps
      .filter((s) => s.stepType === 'REVIEW' && s.status === 'PENDING' && s.stepId !== current.stepId)
      .sort((a, b) => a.sequence - b.sequence)[0];
    const finalStep = steps.find((s) => s.stepType === 'FINAL_APPROVAL');

    const target = nextReview
      ? { step: nextReview, workflowState: WORKFLOW_STATE.UNDER_REVIEW }
      : { step: finalStep, workflowState: WORKFLOW_STATE.PENDING_FINAL_APPROVAL };

    const reviewMint = mintId(state.counters, 'REV');
    const timestamp = now();

    state.applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.REVIEW_COMPLETED,
      patch: {
        workflowState: target.workflowState,
        currentWorkflowStepId: target.step?.stepId || null,
      },
      details: comment ? `Review approved: ${comment}` : 'Review approved.',
      notify: {
        recipientRole: nextReview ? 'REVIEWER' : 'OFFICER_IN_CHARGE',
        message: `${queryId} is awaiting ${nextReview ? 'the next review level' : 'final approval'}.`,
      },
      mutate: (base) => ({
        counters: { ...base.counters, ...reviewMint.bump },
        reviews: [
          ...base.reviews,
          {
            reviewId: reviewMint.id,
            queryId,
            stepId: current.stepId,
            decision: 'APPROVED',
            comment: comment || null,
            reviewerId: actor?.id || null,
            at: timestamp,
          },
        ],
        workflowSteps: base.workflowSteps.map((s) => {
          if (s.stepId === current.stepId) {
            return { ...s, status: 'COMPLETED', completedAt: timestamp };
          }
          if (s.stepId === target.step?.stepId) {
            return { ...s, status: 'IN_PROGRESS', startedAt: s.startedAt || timestamp };
          }
          return s;
        }),
      }),
    });
  },

  requestRevision: (queryId, comment, actor) => {
    const state = get();
    const current = state.getCurrentStep(queryId);
    if (!current) return;

    const reviewMint = mintId(state.counters, 'REV');
    const timestamp = now();

    state.applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.REVISION_REQUESTED,
      patch: {
        workflowState: WORKFLOW_STATE.RETURNED_FOR_REVISION,
        currentWorkflowStepId: current.stepId,
      },
      details: comment ? `Changes requested: ${comment}` : 'Changes requested.',
      notify: {
        recipientRole: 'ASSIGNED_OFFICIAL',
        message: `${queryId} was returned for revision.`,
      },
      mutate: (base) => ({
        counters: { ...base.counters, ...reviewMint.bump },
        reviews: [
          ...base.reviews,
          {
            reviewId: reviewMint.id,
            queryId,
            stepId: current.stepId,
            decision: 'CHANGES_REQUESTED',
            comment: comment || null,
            reviewerId: actor?.id || null,
            at: timestamp,
          },
        ],
        workflowSteps: base.workflowSteps.map((s) =>
          s.stepId === current.stepId ? { ...s, status: 'PENDING', startedAt: null } : s,
        ),
      }),
    });
  },

  grantFinalApproval: (queryId, actor) => {
    const state = get();
    const current = state.getCurrentStep(queryId);
    const timestamp = now();

    state.applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.FINAL_APPROVAL_GRANTED,
      patch: { workflowState: WORKFLOW_STATE.READY_FOR_DISPATCH },
      details: 'Final approval granted; response locked and ready for dispatch.',
      notify: {
        recipientRole: 'FRONT_OFFICE',
        message: `${queryId} is approved and ready for dispatch.`,
      },
      mutate: (base) => ({
        workflowSteps: base.workflowSteps.map((s) =>
          s.stepId === current?.stepId ? { ...s, status: 'COMPLETED', completedAt: timestamp } : s,
        ),
      }),
    });
  },

  rejectFinalApproval: (queryId, reason, actor) =>
    get().applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.FINAL_APPROVAL_REJECTED,
      patch: { workflowState: WORKFLOW_STATE.RETURNED_FOR_REVISION },
      details: reason ? `Final approval rejected: ${reason}` : 'Final approval rejected.',
      notify: {
        recipientRole: 'ASSIGNED_OFFICIAL',
        message: `${queryId} was rejected at final approval.`,
      },
    }),

  returnForRevisionFromApproval: (queryId, comment, actor) =>
    get().applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.REVISION_REQUESTED,
      patch: { workflowState: WORKFLOW_STATE.RETURNED_FOR_REVISION },
      details: comment ? `Returned for revision by OIC: ${comment}` : 'Returned for revision by OIC.',
      notify: {
        recipientRole: 'ASSIGNED_OFFICIAL',
        message: `${queryId} was returned for revision by the Officer-in-Charge.`,
      },
    }),

  dispatchResponse: (queryId, actor) => {
    const state = get();

    state.applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.RESPONSE_DISPATCHED,
      patch: { workflowState: WORKFLOW_STATE.DISPATCHED },
      details: 'Approved response dispatched to the inquirer (mock send — no real email sent).',
    });

    get().applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.QUERY_CLOSED,
      patch: { workflowState: WORKFLOW_STATE.CLOSED },
      details: 'Query closed following dispatch.',
      notify: {
        recipientRole: 'FRONT_OFFICE',
        message: `${queryId} has been dispatched and closed.`,
      },
    });
  },

  transferQuery: (queryId, newAssigneeId, actor) => {
    const assignee = findUserById(newAssigneeId);
    get().applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.QUERY_TRANSFERRED,
      patch: { currentAssigneeId: newAssigneeId },
      details: `Query transferred to ${assignee?.name || newAssigneeId}.`,
    });
  },

  /** Pullback plumbing — destination rules unconfirmed, so no UI calls this yet. */
  pullBackQuery: (queryId, actor, reason) =>
    get().applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.QUERY_PULLED_BACK,
      details: reason ? `Query pulled back: ${reason}` : 'Query pulled back.',
    }),

  // ---------------------------------------------------------------------
  // Demo control
  // ---------------------------------------------------------------------

  /**
   * Load from IndexedDB, seeding it on first run. Called once at app start.
   * If IndexedDB is unavailable the app still works from the in-memory seed —
   * it just won't survive a reload, which is surfaced via `persistenceError`.
   */
  hydrate: async () => {
if (get().hydrated) return;
try {
  if (await isEmpty()) {
    const seed = buildSeedState();
    await replaceAll(seed);
    set({ ...seed, hydrated: true, persistenceError: null });
    return;
  }
  const stored = await loadAll();
  set({
    queries: stored.queries,
    workflowSteps: stored.workflowSteps,
    reviews: stored.reviews,
    responseVersions: stored.responseVersions,
    auditEvents: stored.auditEvents,
    notifications: stored.notifications,
    counters: stored.counters || buildSeedState().counters,
    hydrated: true,
    persistenceError: null,
  });
} catch (error) {
  console.error('[qms] IndexedDB unavailable — running from in-memory seed', error);
  set({ hydrated: true, persistenceError: String(error?.message || error) });
}
  },

  /** Wipe IndexedDB and reseed. */
  resetDemo: async () => {
const seed = buildSeedState();
set({ ...seed });
try {
  await replaceAll(seed);
  set({ persistenceError: null });
} catch (error) {
  console.error('[qms] failed to reset demo data', error);
  set({ persistenceError: String(error?.message || error) });
}
  },
}));

export { BUSINESS_STATUS, WORKFLOW_STATE };
