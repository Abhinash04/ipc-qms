import { create } from 'zustand';

import {
  BUSINESS_STATUS,
  WORKFLOW_STATE,
  AUDIT_EVENT,
  PRIORITY,
  RESPONSE_SOURCE,
  RESPONSE_STATUS,
} from '@/constants/statusEnums';
import { deriveBusinessStatus, canPerform, WORKFLOW_ACTION } from '@/constants/workflowRules';
import { ROLES, ROLE_LABELS } from '@/constants/roles';
import { MOCK_USERS, findUserById, findUserByEmail } from '@/constants/mockUsers';
import { createEmailMessage, EMAIL_DIRECTION, EMAIL_TYPE } from '@/constants/emailModel';
import { buildSeedState } from '@/constants/mockDomain';
import { summarise, recommendAssignee, draftResponse } from '@/services/ai/mockAiService';
import { loadAll, replaceAll, persistTransition, isEmpty } from '@/services/db/db';
import { sendResponse, forwardQuery } from '@/services/api/mailboxService';
import { fetchGemmaAiSummary, fetchGemmaAiDraft } from '@/services/api/aiService';
import { assembleDraftEmail } from '@/services/ai/draftComposer';

const pad = (n) => String(n).padStart(5, '0');

function mintId(counters, prefix) {
  const next = (counters[prefix] || 0) + 1;
  return { id: `${prefix}-${pad(next)}`, prefix, next, bump: { [prefix]: next } };
}

function mintYearScopedId(counters, prefix, timestamp) {
  const next = (counters[prefix] || 0) + 1;
  const year = new Date(timestamp).getUTCFullYear();
  return { id: `${prefix}-${year}-${pad(next)}`, next, bump: { [prefix]: next } };
}

const now = () => new Date().toISOString();

const actorName = (user) => user?.name || 'System';

const byQuery = (rows, queryId) => rows.filter((r) => r.queryId === queryId);

function parseAddress(from) {
  if (!from) return '';
  const match = String(from).match(/<([^>]+)>/);
  return (match ? match[1] : String(from)).trim();
}

function parseDisplayName(from) {
  if (!from) return '';
  const match = String(from).match(/^\s*"?([^"<]+?)"?\s*</);
  return match ? match[1].trim() : '';
}

function assertCan(state, action, queryId, actor) {
  const query = state.queries.find((q) => q.queryId === queryId);
  if (!query) {
    throw new Error(`${action}: query ${queryId} does not exist`);
  }

  const role = actor?.role;
  if (!canPerform(role, action, query.workflowState)) {
    const who = role ? ROLE_LABELS[role] || role : 'An unauthenticated user';
    throw new Error(
      `${who} may not perform ${action} while ${queryId} is ${query.workflowState}`,
    );
  }

  return query;
}

function assertOwnsStep(step, actor, action) {
  if (step.assignedUserId && step.assignedUserId !== actor?.id) {
    const owner = findUserById(step.assignedUserId);
    throw new Error(
      `${action}: this review level is assigned to ${owner?.name || step.assignedUserId}, not ${actorName(actor)}`,
    );
  }
}

const officerInChargeId = () =>
  MOCK_USERS.find((u) => u.role === ROLES.OFFICER_IN_CHARGE)?.id || null;

function reopenReviewCycle(steps, queryId) {
  return steps.map((step) =>
    step.queryId === queryId && (step.stepType === 'REVIEW' || step.stepType === 'FINAL_APPROVAL')
      ? { ...step, status: 'PENDING', startedAt: null, completedAt: null }
      : step,
  );
}

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

async function persistDelta(prev, next, queryId, auditEvent, notification) {
  const prevStepIds = byQuery(prev.workflowSteps, queryId).map((s) => s.stepId);
  const nextSteps = byQuery(next.workflowSteps, queryId);
  const nextStepIds = new Set(nextSteps.map((s) => s.stepId));

  const prevReviewIds = new Set(byQuery(prev.reviews, queryId).map((r) => r.reviewId));
  const prevVersionIds = new Set(byQuery(prev.responseVersions, queryId).map((v) => v.responseId));

  const prevMessageIds = new Set(prev.emailMessages.map((m) => m.messageId));
  const prevThreadIds = new Set(prev.emailThreads.map((t) => t.threadId));

  await persistTransition({
    query: next.queries.find((q) => q.queryId === queryId) || null,
    auditEvent,
    notification,
    counters: next.counters,
    upsertSteps: nextSteps,
    deleteStepIds: prevStepIds.filter((id) => !nextStepIds.has(id)),
    addReviews: byQuery(next.reviews, queryId).filter((r) => !prevReviewIds.has(r.reviewId)),
    addVersions: byQuery(next.responseVersions, queryId).filter((v) => !prevVersionIds.has(v.responseId)),
    addThreads: next.emailThreads.filter((t) => !prevThreadIds.has(t.threadId)),
    addMessages: next.emailMessages.filter((m) => !prevMessageIds.has(m.messageId)),
  });
}

export const useWorkflowStore = create((set, get) => ({
  ...buildSeedState(),

  hydrated: false,
  persistenceError: null,

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

  applyTransition: (options) => {
    const prev = get();
    const { next, auditEvent, notification } = computeTransition(prev, options);
    set(next);

    persistDelta(prev, next, options.queryId, auditEvent, notification).catch((error) => {
      console.error('[qms] failed to persist workflow transition', error);
      set({ persistenceError: String(error?.message || error) });
    });
  },

  findQueryBySourceMessage: (sourceMessageId) => {
    const message = get().emailMessages.find((m) => m.sourceMessageId === sourceMessageId);
    return message ? message.queryId : null;
  },

  ingestEmail: (mailboxMessage, fetchSummary = fetchGemmaAiSummary) => {
    const state = get();
    const sourceMessageId = mailboxMessage.mailboxMessageId || mailboxMessage.providerMessageId;
    if (!sourceMessageId) {
      throw new Error('ingestEmail: message must carry a mailboxMessageId or providerMessageId');
    }

    const existing = state.emailMessages.find((m) => m.sourceMessageId === sourceMessageId);
    if (existing) {
      return {
        queryId: existing.queryId,
        threadId: existing.threadId,
        created: false,
        reason: 'already-ingested',
      };
    }

    const providerThreadId = mailboxMessage.providerThreadId || null;
    if (providerThreadId) {
      const sameThread = state.emailMessages.find(
        (m) => m.providerThreadId && m.providerThreadId === providerThreadId,
      );
      if (sameThread) {
        return get().attachToThread(sameThread.queryId, mailboxMessage);
      }
    }

    const timestamp = mailboxMessage.receivedAt || now();

    let counters = state.counters;
    const queryMint = mintYearScopedId(counters, 'QRY', timestamp);
    counters = { ...counters, ...queryMint.bump };
    const threadMint = mintYearScopedId(counters, 'THREAD', timestamp);
    counters = { ...counters, ...threadMint.bump };
    const messageMint = mintId(counters, 'MSG');

    const queryId = queryMint.id;
    const threadId = threadMint.id;
    const messageId = messageMint.id;

    const inquirerEmail = parseAddress(mailboxMessage.from);
    const inquirer = {
      id: findUserByEmail(inquirerEmail)?.id || null,
      name: parseDisplayName(mailboxMessage.from) || inquirerEmail,
      email: inquirerEmail,
    };

    const query = {
      queryId,
      threadId,
      sourceEmailId: messageId,
      subject: mailboxMessage.subject || '(no subject)',
      description: mailboxMessage.body || '',
      source: 'Email',
      inquirer,
      category: null,
      priority: PRIORITY.NORMAL,
      businessStatus: BUSINESS_STATUS.OPEN,
      workflowState: WORKFLOW_STATE.RECEIVED,
      currentAssigneeId: null,
      currentWorkflowStepId: null,
      assignmentDecision: null,
      aiSummary: null,
      attachments: mailboxMessage.attachments || [],
      createdAt: timestamp,
      updatedAt: timestamp,
      dueDate: null,
    };

    const thread = {
      threadId,
      queryId,
      subject: query.subject,
      createdAt: timestamp,
    };

    const message = createEmailMessage({
      messageId,
      threadId,
      queryId,
      direction: EMAIL_DIRECTION.INBOUND,
      emailType: EMAIL_TYPE.INCOMING_QUERY,
      from: mailboxMessage.from,
      to: mailboxMessage.to,
      cc: mailboxMessage.cc || [],
      bcc: mailboxMessage.bcc || [],
      subject: query.subject,
      body: query.description,
      attachments: query.attachments,
      timestamp,
      providerMessageId: mailboxMessage.providerMessageId || null,
      providerThreadId: mailboxMessage.providerThreadId || null,
    });
    message.sourceMessageId = sourceMessageId;

    get().applyTransition({
      queryId,
      actor: null,
      actorLabel: 'System',
      event: AUDIT_EVENT.QUERY_RECEIVED,
      details: `Query created from email "${query.subject}" received from ${inquirer.email}.`,
      notify: {
        recipientRole: 'FRONT_OFFICE',
        message: `${queryId} received and awaiting Front Office verification.`,
      },
      mutate: (base) => ({
        counters: { ...base.counters, ...queryMint.bump, ...threadMint.bump, ...messageMint.bump },
        queries: [...base.queries, query],
        emailThreads: [...base.emailThreads, thread],
        emailMessages: [...base.emailMessages, message],
      }),
    });

    const summary = summarise(query);
    get().applyTransition({
      queryId,
      actor: null,
      actorLabel: 'AI Summary Assistant',
      event: AUDIT_EVENT.AI_SUMMARY_GENERATED,
      patch: { aiSummary: summary },
      details: summary.text,
    });

    fetchSummary({
      subject: query.subject,
      body: query.description,
      inquirerName: query.inquirer?.name,
    }).then((gemmaSummary) => {
      if (gemmaSummary) {
        get().applyTransition({
          queryId,
          actor: null,
          actorLabel: 'Gemma AI Summary Assistant',
          event: AUDIT_EVENT.AI_SUMMARY_GENERATED,
          patch: { aiSummary: gemmaSummary },
          details: gemmaSummary.text,
        });
      }
    }).catch(() => {});

    return { queryId, threadId, messageId, created: true };
  },

  attachToThread: (queryId, mailboxMessage) => {
    const state = get();
    const query = state.queries.find((q) => q.queryId === queryId);
    if (!query) return { queryId: null, created: false, reason: 'unknown-query' };

    const sourceMessageId = mailboxMessage.mailboxMessageId || mailboxMessage.providerMessageId;
    const timestamp = mailboxMessage.receivedAt || now();
    const messageMint = mintId(state.counters, 'MSG');

    const message = createEmailMessage({
      messageId: messageMint.id,
      threadId: query.threadId,
      queryId,
      direction: EMAIL_DIRECTION.INBOUND,
      emailType: EMAIL_TYPE.INCOMING_QUERY,
      from: mailboxMessage.from,
      to: mailboxMessage.to,
      cc: mailboxMessage.cc || [],
      subject: mailboxMessage.subject || query.subject,
      body: mailboxMessage.body || '',
      timestamp,
      providerMessageId: mailboxMessage.providerMessageId || null,
      providerThreadId: mailboxMessage.providerThreadId || null,
    });
    message.sourceMessageId = sourceMessageId;

    get().applyTransition({
      queryId,
      actor: null,
      actorLabel: 'System',
      event: AUDIT_EVENT.QUERY_RECEIVED,
      details: `Further correspondence received from ${parseAddress(mailboxMessage.from)} on the existing thread.`,
      mutate: (base) => ({
        counters: { ...base.counters, ...messageMint.bump },
        emailMessages: [...base.emailMessages, message],
      }),
    });

    return {
      queryId,
      threadId: query.threadId,
      messageId: message.messageId,
      created: false,
      reason: 'attached-to-thread',
    };
  },

  recordAcknowledgement: ({ queryId, from, to, subject, body, timestamp, providerMessageId }) => {
    const state = get();
    const query = state.queries.find((q) => q.queryId === queryId);
    if (!query) return { messageId: null, created: false, reason: 'unknown-query' };

    const already = state.emailMessages.find(
      (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT,
    );
    if (already) {
      return { messageId: already.messageId, created: false, reason: 'already-acknowledged' };
    }

    const at = timestamp || now();
    const messageMint = mintId(state.counters, 'MSG');
    const message = createEmailMessage({
      messageId: messageMint.id,
      threadId: query.threadId,
      queryId,
      direction: EMAIL_DIRECTION.OUTBOUND,
      emailType: EMAIL_TYPE.ACKNOWLEDGEMENT,
      from,
      to,
      subject,
      body,
      timestamp: at,
      providerMessageId: providerMessageId || null,
    });

    get().applyTransition({
      queryId,
      actor: null,
      actorLabel: 'System',
      event: AUDIT_EVENT.ACKNOWLEDGEMENT_SENT,
      details: `Acknowledgement email sent to ${message.to.join(', ')}.`,
      mutate: (base) => ({
        counters: { ...base.counters, ...messageMint.bump },
        emailMessages: [...base.emailMessages, message],
      }),
    });

    return { messageId: message.messageId, created: true };
  },

  verifyQuery: (queryId, actor) => {
    assertCan(get(), WORKFLOW_ACTION.VERIFY, queryId, actor);
    return get().applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.QUERY_REGISTERED,
      patch: { workflowState: WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION },
      details: 'Front Office verified the query details and attachments.',
    });
  },

  forwardToOic: async (queryId, actor, forward = forwardQuery) => {
    const query = assertCan(get(), WORKFLOW_ACTION.FORWARD, queryId, actor);

    const original = get().emailMessages.find(
      (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.INCOMING_QUERY,
    );

    const body = [
      `Forwarded by ${actorName(actor)} for assignment.`,
      '',
      `Query: ${queryId}`,
      `Received from: ${query.inquirer?.name || ''} <${query.inquirer?.email || ''}>`,
      '',
      '---------- Original enquiry ----------',
      `Subject: ${query.subject}`,
      '',
      original?.body || query.description || '',
    ].join('\n');

    const sent = await forward({
      queryId,
      subject: query.subject,
      body,
      providerThreadId: original?.providerThreadId || null,
    });

    const timestamp = sent?.sentAt || now();
    const messageMint = mintId(get().counters, 'MSG');

    const message = createEmailMessage({
      messageId: messageMint.id,
      threadId: query.threadId,
      queryId,
      direction: EMAIL_DIRECTION.OUTBOUND,
      emailType: EMAIL_TYPE.FORWARD,
      from: sent?.from || actorName(actor),
      to: sent?.to || [],
      subject: sent?.subject || `Fwd: ${query.subject} [${queryId}]`,
      body: sent?.body || body,
      timestamp,
      providerMessageId: sent?.providerMessageId || null,
      providerThreadId: sent?.providerThreadId || null,
    });

    get().applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.QUERY_FORWARDED,
      patch: { workflowState: WORKFLOW_STATE.PENDING_ASSIGNMENT },
      details: `Forwarded by ${actorName(actor)} to ${message.to.join(', ')} for assignment.`,
      notify: {
        recipientRole: 'OFFICER_IN_CHARGE',
        message: `${queryId} is awaiting assignment.`,
      },
      mutate: (base) => ({
        counters: { ...base.counters, ...messageMint.bump },
        emailMessages: [...base.emailMessages, message],
      }),
    });

    return { queryId, messageId: message.messageId, forwarded: true };
  },

  recommendAssigneeFor: (queryId) => {
    const state = get();
    const query = state.queries.find((q) => q.queryId === queryId);
    if (!query) return null;
    const open = state.queries.filter((q) => q.workflowState !== WORKFLOW_STATE.CLOSED);
    return recommendAssignee(query, MOCK_USERS, open);
  },

  assignQuery: (queryId, assigneeId, actor) => {
    assertCan(get(), WORKFLOW_ACTION.ASSIGN, queryId, actor);
    const recommendation = get().recommendAssigneeFor(queryId);
    const acceptedAi = recommendation?.userId === assigneeId;
    const assignee = findUserById(assigneeId);

    if (recommendation) {
      get().applyTransition({
        queryId,
        actor: null,
        actorLabel: 'AI Assignment Assistant',
        event: AUDIT_EVENT.AI_ASSIGNMENT_RECOMMENDED,
        details: `Recommended ${findUserById(recommendation.userId)?.name || recommendation.userId} (${recommendation.matchPercent}% match). ${recommendation.reason}`,
      });
    }

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

    if (!acceptedAi && recommendation) {
      const recommended = findUserById(recommendation.userId);
      get().applyTransition({
        queryId,
        actor,
        event: AUDIT_EVENT.ASSIGNMENT_OVERRIDDEN,
        details: `AI recommended ${recommended?.name}; OIC assigned ${assignee?.name || assigneeId} instead.`,
      });
    }
  },

  generateAiDraft: async (queryId, actor, fetchDraft = fetchGemmaAiDraft) => {
    assertCan(get(), WORKFLOW_ACTION.GENERATE_AI_DRAFT, queryId, actor);
    const query = get().getQuery(queryId);

    let draft;
    try {
      draft = await fetchDraft({
        subject: query.subject,
        body: query.description,
        inquirerName: query.inquirer?.name,
        summaryText: query.aiSummary?.text || '',
        keyPoints: query.aiSummary?.keyPoints || [],
      });
    } catch {
      draft = null;
    }

    const composed = draft ? assembleDraftEmail({ query: get().getQuery(queryId), draft }) : '';
    const content = composed || draftResponse(get().getQuery(queryId));
    const fromGemma = Boolean(composed) && draft?.fallback !== true;
    const createdBy = fromGemma ? 'Gemma AI Draft Assistant' : 'AI Draft Assistant';

    const state = get();
    const versionNumber = state.getVersions(queryId).length + 1;
    const minted = mintId(state.counters, 'RESP');

    state.applyTransition({
      queryId,
      actor,
      actorLabel: createdBy,
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
            content,
            createdBy,
            createdAt: now(),
            aiGenerated: true,
            source: RESPONSE_SOURCE.AI_GENERATED,
            status: RESPONSE_STATUS.DRAFT,
          },
        ],
      }),
    });
  },

  saveDraftVersion: (queryId, content, actor, label = 'Officer revision') => {
    assertCan(get(), WORKFLOW_ACTION.SAVE_DRAFT, queryId, actor);
    const state = get();
    const locked = state
      .getVersions(queryId)
      .find((v) => v.status === RESPONSE_STATUS.FINAL_APPROVED);
    if (locked) {
      throw new Error(
        `${queryId}: response ${locked.version} is locked by final approval and cannot be edited`,
      );
    }

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
            source:
              label === 'Revision after review'
                ? RESPONSE_SOURCE.REVIEW_REVISION
                : RESPONSE_SOURCE.USER_EDITED,
            status: RESPONSE_STATUS.DRAFT,
          },
        ],
      }),
    });
  },

  submitForReview: (queryId, actor) => {
    assertCan(get(), WORKFLOW_ACTION.SUBMIT_FOR_REVIEW, queryId, actor);
    const state = get();
    const steps = state.getSteps(queryId);

    if (!steps.some((s) => s.stepType === 'REVIEW')) {
      throw new Error(
        `${queryId} cannot be submitted: add at least one review level before sending for review`,
      );
    }

    let stepCounter = state.counters.STEP || 0;
    const newSteps = [];
    const timestamp = now();

    if (!steps.some((s) => s.stepType === 'DRAFT')) {
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
    }

    if (!steps.some((s) => s.stepType === 'FINAL_APPROVAL')) {
      const approvalMint = mintId({ STEP: stepCounter }, 'STEP');
      stepCounter = approvalMint.next;
      newSteps.push({
        stepId: approvalMint.id,
        queryId,
        stepType: 'FINAL_APPROVAL',
        sequence: 1000,
        assignedUserId: officerInChargeId(),
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

    state.applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.DRAFT_UPDATED,
      patch: {
        workflowState: WORKFLOW_STATE.UNDER_REVIEW,
        currentWorkflowStepId: firstPendingReview?.stepId || null,
      },
      details: 'Draft submitted for review.',
      notify: {
        recipientRole: 'REVIEWER',
        message: `${queryId} is awaiting review.`,
      },
      mutate: (base) => ({
        counters: { ...base.counters, STEP: stepCounter },
        workflowSteps: [...base.workflowSteps, ...newSteps].map((s) =>
          s.stepId === firstPendingReview?.stepId
            ? { ...s, status: 'IN_PROGRESS', startedAt: s.startedAt || timestamp }
            : s,
        ),
      }),
    });
  },

  addReviewLevel: (queryId, reviewerId, actor) => {
    assertCan(get(), WORKFLOW_ACTION.ADD_REVIEW_LEVEL, queryId, actor);
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
    assertCan(get(), WORKFLOW_ACTION.APPROVE_REVIEW, queryId, actor);
    const state = get();
    const approvedVersion = state.getLatestVersion(queryId);
    const current = state.getCurrentStep(queryId);
    if (!current) return;
    assertOwnsStep(current, actor, WORKFLOW_ACTION.APPROVE_REVIEW);

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
            responseId: approvedVersion?.responseId || null,
            version: approvedVersion?.version || null,
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
    assertCan(get(), WORKFLOW_ACTION.REQUEST_REVISION, queryId, actor);
    // A rejection without a reason is not actionable by the drafter.
    if (!String(comment || '').trim()) {
      throw new Error('Requesting changes requires a comment explaining what must change');
    }
    const reviewed = get().getLatestVersion(queryId);
    const state = get();
    const current = state.getCurrentStep(queryId);
    if (!current) return;
    assertOwnsStep(current, actor, WORKFLOW_ACTION.REQUEST_REVISION);

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
            comment,
            // Bind the comment to the text it was written about, so it stays
            // meaningful after later revisions supersede that version.
            responseId: reviewed?.responseId || null,
            version: reviewed?.version || null,
            reviewerId: actor?.id || null,
            at: timestamp,
          },
        ],
        workflowSteps: reopenReviewCycle(base.workflowSteps, queryId),
      }),
    });
  },

  grantFinalApproval: async (queryId, actor, send = sendResponse) => {
    assertCan(get(), WORKFLOW_ACTION.FINAL_APPROVE, queryId, actor);
    const state = get();
    const current = state.getCurrentStep(queryId);
    const approved = state.getLatestVersion(queryId);
    const timestamp = now();

    state.applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.FINAL_APPROVAL_GRANTED,
      patch: { workflowState: WORKFLOW_STATE.READY_FOR_DISPATCH },
      details: `Final approval granted; ${approved ? `${approved.version} locked` : 'no draft to lock'} and ready for dispatch.`,
      notify: {
        recipientRole: 'FRONT_OFFICE',
        message: `${queryId} is approved and ready for dispatch.`,
      },
      mutate: (base) => ({
        workflowSteps: base.workflowSteps.map((s) =>
          s.stepId === current?.stepId ? { ...s, status: 'COMPLETED', completedAt: timestamp } : s,
        ),
        responseVersions: base.responseVersions.map((v) =>
          v.responseId === approved?.responseId
            ? { ...v, status: RESPONSE_STATUS.FINAL_APPROVED, approvedAt: timestamp }
            : v,
        ),
      }),
    });

    return get().dispatchResponse(queryId, null, send);
  },

  rejectFinalApproval: (queryId, reason, actor) => {
    assertCan(get(), WORKFLOW_ACTION.FINAL_REJECT, queryId, actor);
    return get().applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.FINAL_APPROVAL_REJECTED,
      patch: { workflowState: WORKFLOW_STATE.RETURNED_FOR_REVISION },
      details: reason ? `Final approval rejected: ${reason}` : 'Final approval rejected.',
      notify: {
        recipientRole: 'ASSIGNED_OFFICIAL',
        message: `${queryId} was rejected at final approval.`,
      },
      mutate: (base) => ({
        workflowSteps: reopenReviewCycle(base.workflowSteps, queryId),
      }),
    });
  },

  returnForRevisionFromApproval: (queryId, comment, actor) => {
    assertCan(get(), WORKFLOW_ACTION.RETURN_FOR_REVISION, queryId, actor);
    if (!String(comment || '').trim()) {
      throw new Error('Returning for revision requires a comment explaining what must change');
    }

    const state = get();
    const reviewed = state.getLatestVersion(queryId);
    const reviewMint = mintId(state.counters, 'REV');
    const timestamp = now();

    return get().applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.REVISION_REQUESTED,
      patch: {
        workflowState: WORKFLOW_STATE.RETURNED_FOR_REVISION,
        currentWorkflowStepId: null,
      },
      details: `Returned for revision by the Officer-in-Charge: ${comment}`,
      notify: {
        recipientRole: 'ASSIGNED_OFFICIAL',
        message: `${queryId} was returned for revision by the Officer-in-Charge.`,
      },
      mutate: (base) => ({
        counters: { ...base.counters, ...reviewMint.bump },
        reviews: [
          ...base.reviews,
          {
            reviewId: reviewMint.id,
            queryId,
            stepId: null,
            decision: 'CHANGES_REQUESTED',
            comment,
            responseId: reviewed?.responseId || null,
            version: reviewed?.version || null,
            reviewerId: actor?.id || null,
            at: timestamp,
          },
        ],
        workflowSteps: reopenReviewCycle(base.workflowSteps, queryId),
      }),
    });
  },

  dispatchResponse: async (queryId, actor, send = sendResponse) => {
    const state = get();
    const query = state.queries.find((q) => q.queryId === queryId);
    if (!query) throw new Error(`DISPATCH: query ${queryId} does not exist`);

    // Order matters, and each step guards something different.
    //
    // 1. PERMISSION first, so an unauthorised caller is refused outright and
    //    never receives the benign "already dispatched" shape instead.
    //    A human retry from the Dispatch page passes an actor and is gated
    //    exactly as before. The automatic dispatch that follows final approval
    //    passes NO actor: it is the system acting on the READY_FOR_DISPATCH
    //    transition. Recorded in docs/srs/14 as a deliberate widening.
    if (actor) {
      assertCan(state, WORKFLOW_ACTION.DISPATCH, queryId, actor);
    }

    // 2. IDEMPOTENCY next, so a duplicate trigger is a harmless no-op rather
    //    than an error — a refresh, a retry or a double click must not send a
    //    second response, and must not look like a failure either. The guard is
    //    the stored OUTGOING_RESPONSE message, which lives in IndexedDB and so
    //    survives a reload and a backend restart.
    const already = state.emailMessages.find(
      (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE,
    );
    if (already) {
      return { queryId, messageId: already.messageId, dispatched: false, reason: 'already-dispatched' };
    }

    // 3. STATE last, for the system path: nothing may be sent before the
    //    Officer-in-Charge has granted final approval.
    if (!actor && query.workflowState !== WORKFLOW_STATE.READY_FOR_DISPATCH) {
      throw new Error(
        `DISPATCH refused: ${queryId} is ${query.workflowState}, not ${WORKFLOW_STATE.READY_FOR_DISPATCH}`,
      );
    }

    const approved = get().getLatestVersion(queryId);
    if (!approved) {
      throw new Error(`${queryId}: there is no approved response to dispatch`);
    }

    const subject = `Re: ${query.subject} [${queryId}]`;
    const sent = await send({
      to: query.inquirer.email,
      subject,
      body: approved.content,
      attachments: [],
      providerThreadId: query.providerThreadId || null,
    });

    const timestamp = sent?.sentAt || now();
    const messageMint = mintId(get().counters, 'MSG');
    const message = createEmailMessage({
      messageId: messageMint.id,
      threadId: query.threadId,
      queryId,
      direction: EMAIL_DIRECTION.OUTBOUND,
      emailType: EMAIL_TYPE.OUTGOING_RESPONSE,
      from: sent?.from || 'Indian Pharmacopoeia Commission',
      to: sent?.to || [query.inquirer.email],
      subject: sent?.subject || subject,
      body: sent?.body || approved.content,
      timestamp,
      providerMessageId: sent?.providerMessageId || null,
      providerThreadId: sent?.providerThreadId || null,
    });

    get().applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.RESPONSE_DISPATCHED,
      patch: { workflowState: WORKFLOW_STATE.DISPATCHED },
      details: `Approved response ${approved.version} emailed to ${query.inquirer.email}.`,
      mutate: (base) => ({
        counters: { ...base.counters, ...messageMint.bump },
        emailMessages: [...base.emailMessages, message],
      }),
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

    return { messageId: message.messageId, dispatched: true };
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

  pullBackQuery: (queryId, actor, reason) =>
    get().applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.QUERY_PULLED_BACK,
      details: reason ? `Query pulled back: ${reason}` : 'Query pulled back.',
    }),

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
    emailMessages: stored.emailMessages || [],
    emailThreads: stored.emailThreads || [],
    counters: stored.counters || buildSeedState().counters,
    hydrated: true,
    persistenceError: null,
  });
} catch (error) {
  console.error('[qms] IndexedDB unavailable — running from in-memory seed', error);
  set({ hydrated: true, persistenceError: String(error?.message || error) });
}
  },

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
