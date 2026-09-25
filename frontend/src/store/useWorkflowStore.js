import { create } from 'zustand';
import { replaceEqualDeep } from '@tanstack/react-query';

import {
  BUSINESS_STATUS,
  WORKFLOW_STATE,
  AUDIT_EVENT,
  PRIORITY,
  RESPONSE_SOURCE,
  RESPONSE_STATUS,
} from '@/constants/statusEnums';
import {
  deriveBusinessStatus,
  canPerform,
  WORKFLOW_ACTION,
  ASSIGNEE_ONLY_ACTIONS,
  isCaseAssignee,
} from '@/constants/workflowRules';
import { ROLES, ROLE_LABELS } from '@/constants/roles';
import { MOCK_USERS, findUserById, findUserByEmail } from '@/constants/mockUsers';
import { createEmailMessage, EMAIL_DIRECTION, EMAIL_TYPE } from '@/constants/emailModel';
import { buildSeedState } from '@/constants/mockDomain';
import { summarise, recommendAssignee, draftResponse } from '@/services/ai/mockAiService';
let db = null;
const dbModule = async () => {
  db ??= await import('@/services/persistence/queryState');
  return db;
};
import {
  sendResponse,
  forwardQuery,
  sendAcknowledgement,
  acceptMailboxMessage as acceptOnServer,
} from '@/services/api/mailboxService';
import {
  grantFinalApproval as approveOnServer,
  resolveOutboundEmail as resolveOutboundOnServer,
} from '@/services/api/queryCaseService';
import { fetchGemmaAiSummary, fetchGemmaAiDraft } from '@/services/api/aiService';
import { assembleDraftEmail } from '@/services/ai/draftComposer';
import { notify, beginBatch, endBatch } from '@/services/notify';

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

const QUERY_SOURCE = { EMAIL: 'Email' };

function buildNewCase(state, { subject, body, from, to, inquirer, attachments, timestamp, source, providerMessageId, providerThreadId, sourceMessageId, sourceMailboxMessageId }) {
  let counters = state.counters;
  const queryMint = mintYearScopedId(counters, 'QRY', timestamp);
  counters = { ...counters, ...queryMint.bump };
  const threadMint = mintYearScopedId(counters, 'THREAD', timestamp);
  counters = { ...counters, ...threadMint.bump };
  const messageMint = mintId(counters, 'MSG');

  const query = {
    queryId: queryMint.id,
    threadId: threadMint.id,
    sourceEmailId: messageMint.id,
    sourceMailboxMessageId: sourceMailboxMessageId || null,
    subject: subject || '(no subject)',
    description: body || '',
    source,
    inquirer,
    category: null,
    priority: PRIORITY.NORMAL,
    businessStatus: BUSINESS_STATUS.OPEN,
    workflowState: WORKFLOW_STATE.RECEIVED,
    currentAssigneeId: null,
    currentWorkflowStepId: null,
    assignmentDecision: null,
    aiSummary: null,
    attachments: attachments || [],
    createdAt: timestamp,
    updatedAt: timestamp,
    dueDate: null,
  };

  const thread = {
    threadId: threadMint.id,
    queryId: queryMint.id,
    subject: query.subject,
    createdAt: timestamp,
  };

  const message = createEmailMessage({
    messageId: messageMint.id,
    threadId: threadMint.id,
    queryId: queryMint.id,
    direction: EMAIL_DIRECTION.INBOUND,
    emailType: EMAIL_TYPE.INCOMING_QUERY,
    from,
    to,
    cc: [],
    bcc: [],
    subject: query.subject,
    body: query.description,
    attachments: query.attachments,
    timestamp,
    providerMessageId: providerMessageId || null,
    providerThreadId: providerThreadId || null,
  });
  message.sourceMessageId = sourceMessageId || null;

  return {
    query,
    thread,
    message,
    bumps: { ...queryMint.bump, ...threadMint.bump, ...messageMint.bump },
  };
}

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

  if (ASSIGNEE_ONLY_ACTIONS.includes(action)) assertAssignee(query, actor, action);
  return query;
}

function assertAssignee(query, actor, action) {
  if (isCaseAssignee(actor, query)) return;
  const assignee = findUserById(query.currentAssigneeId);
  throw new Error(
    `Only the currently assigned official (${assignee?.name || query.currentAssigneeId || 'none'}) may perform ${action} on ${query.queryId}.`,
  );
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
  if (!event) {
    throw new Error(
      `applyTransition(${queryId}): every transition must name an audit event — ` +
        'see AUDIT_EVENT in constants/statusEnums.js',
    );
  }

  const timestamp = now();
  const baseRevision = state.queries.find((q) => q.queryId === queryId)?.revision ?? 0;
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
      ...(notify.recipientUserId ? { recipientUserId: notify.recipientUserId } : {}),
      message: notify.message,
      at: timestamp,
    };
    notifications = [...notifications, notification];
  }

  const base = { ...state, queries, auditEvents, notifications, counters };
  const mutated = mutate ? { ...base, ...mutate(base) } : base;
  const next = {
    ...mutated,
    queries: mutated.queries.map((q) => (q.queryId === queryId ? { ...q, revision: baseRevision + 1 } : q)),
  };
  return { next, auditEvent, notification, baseRevision };
}

async function persistDelta(prev, next, queryId, auditEvent, notification, baseRevision) {
  const prevStepIds = byQuery(prev.workflowSteps, queryId).map((s) => s.stepId);
  const nextSteps = byQuery(next.workflowSteps, queryId);
  const nextStepIds = new Set(nextSteps.map((s) => s.stepId));

  const prevReviewIds = new Set(byQuery(prev.reviews, queryId).map((r) => r.reviewId));

  const prevMessageIds = new Set(prev.emailMessages.map((m) => m.messageId));
  const prevThreadIds = new Set(prev.emailThreads.map((t) => t.threadId));

  const prevVersions = new Map(
    byQuery(prev.responseVersions, queryId).map((v) => [v.responseId, v]),
  );
  const nextVersions = byQuery(next.responseVersions, queryId);

  const addVersions = nextVersions.filter((v) => !prevVersions.has(v.responseId));
  const upsertVersions = nextVersions.filter((v) => {
    const before = prevVersions.get(v.responseId);
    return before && before !== v;
  });

  const { persistTransition } = db ?? (await dbModule());
  return persistTransition({
    query: next.queries.find((q) => q.queryId === queryId) || null,
    baseRevision,
    auditEvent,
    notification,
    counters: next.counters,
    upsertSteps: nextSteps,
    deleteStepIds: prevStepIds.filter((id) => !nextStepIds.has(id)),
    addReviews: byQuery(next.reviews, queryId).filter((r) => !prevReviewIds.has(r.reviewId)),
    addVersions,
    upsertVersions,
    addThreads: next.emailThreads.filter((t) => !prevThreadIds.has(t.threadId)),
    addMessages: next.emailMessages.filter((m) => !prevMessageIds.has(m.messageId)),
  });
}

async function writesSettled() {
  const { settled } = db ?? (await dbModule());
  return settled();
}

function describeSendFailure(error) {
  const data = error?.response?.data;
  return {
    outcome: data?.outcome ?? null,
    error: data?.error || error?.message || String(error),
    ...(data?.unconfirmed ? { unconfirmed: true } : {}),
    ...(data?.retryable ? { retryable: true } : {}),
  };
}

function sendFailure(error) {
  const described = describeSendFailure(error);
  if (!error?.response?.data?.error) return error;
  return Object.assign(new Error(described.error), {
    outcome: described.outcome,
    unconfirmed: Boolean(described.unconfirmed),
    retryable: Boolean(described.retryable),
    cause: error,
  });
}

const approvalsInFlight = new Map();

const SERVER_COLLECTIONS = [
  'queries',
  'workflowSteps',
  'reviews',
  'responseVersions',
  'auditEvents',
  'notifications',
  'emailMessages',
  'emailThreads',
  'outboundEmails',
];

let revalidating = null;

export const useWorkflowStore = create((set, get) => ({
  ...buildSeedState(),

  hydrated: false,
  persistenceError: null,
  refreshedAt: 0,

  getQuery: (queryId) => get().queries.find((q) => q.queryId === queryId) || null,

  getOutbound: (queryId, emailType) =>
    get().outboundEmails.find((row) => row.queryId === queryId && row.emailType === emailType) || null,

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
    const { next, auditEvent, notification, baseRevision } = computeTransition(prev, options);
    set(next);

    persistDelta(prev, next, options.queryId, auditEvent, notification, baseRevision)
      .then(async (outcome) => {
        await get().revalidate();
        if (!outcome?.conflict) return;
        const stale = outcome.conflict === 'STALE_CASE';
        notify.error(
          stale
            ? `${options.queryId} was changed by someone else`
            : `${options.queryId} clashed with a teammate's change`,
          stale
            ? 'Showing the latest; redo your last step.'
            : 'Record ids were reused; the latest is shown — please retry.',
          { id: `case-conflict-${options.queryId}` },
        );
      })
      .catch((error) => {
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

    const inquirerEmail = parseAddress(mailboxMessage.from);
    const inquirer = {
      id: findUserByEmail(inquirerEmail)?.id || null,
      name: parseDisplayName(mailboxMessage.from) || inquirerEmail,
      email: inquirerEmail,
    };

    return get().createCase({
      subject: mailboxMessage.subject,
      body: mailboxMessage.body,
      from: mailboxMessage.from,
      to: mailboxMessage.to,
      inquirer,
      attachments: mailboxMessage.attachments,
      timestamp,
      source: QUERY_SOURCE.EMAIL,
      providerMessageId: mailboxMessage.providerMessageId,
      providerThreadId: mailboxMessage.providerThreadId,
      sourceMessageId,
      sourceMailboxMessageId: sourceMessageId,
      detail: `Query created from email "${mailboxMessage.subject || '(no subject)'}" received from ${inquirer.email}.`,
      fetchSummary,
    });
  },

  createCase: ({ detail, fetchSummary = fetchGemmaAiSummary, ...params }) => {
    const { query, thread, message, bumps } = buildNewCase(get(), params);
    const { queryId, threadId } = query;

    get().applyTransition({
      queryId,
      actor: null,
      actorLabel: 'System',
      event: AUDIT_EVENT.QUERY_RECEIVED,
      details: detail,
      notify: {
        recipientRole: 'FRONT_OFFICE',
        message: `${queryId} received and awaiting Front Office verification.`,
      },
      mutate: (base) => ({
        counters: { ...base.counters, ...bumps },
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
    })
      .then((gemmaSummary) => {
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
      })
      .catch(() => {});

    return { queryId, threadId, messageId: message.messageId, created: true };
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

  acknowledgeInquirer: async (queryId, actor, send = sendAcknowledgement) => {
    if (!get().queries.some((q) => q.queryId === queryId)) {
      return { acknowledged: false, error: `${queryId} does not exist` };
    }

    try {
      const result = await send({ queryId });
      await get().refreshFromServer();
      return {
        acknowledged: true,
        alreadySent: result?.outcome === 'ALREADY_SENT',
        outcome: result?.outcome ?? null,
      };
    } catch (error) {
      await get().refreshFromServer();
      return { acknowledged: false, ...describeSendFailure(error) };
    }
  },

  verifyQuery: (queryId, actor, send = sendAcknowledgement) => {
    assertCan(get(), WORKFLOW_ACTION.VERIFY, queryId, actor);
    get().applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.QUERY_REGISTERED,
      patch: { workflowState: WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION },
      details: 'Front Office verified the query details and attachments.',
    });
    return get().acknowledgeInquirer(queryId, actor, send);
  },

  acceptMailboxMessage: async (message, accept = acceptOnServer) => {
    const mailboxMessageId = message?.mailboxMessageId || message?.providerMessageId;
    if (!mailboxMessageId) {
      throw new Error('acceptMailboxMessage: message must carry a mailboxMessageId');
    }

    await writesSettled();
    const result = await accept(mailboxMessageId, message);

    if (result?.queryId) await get().refreshFromServer();

    return {
      ...result,
      accepted: Boolean(result?.created),
      acknowledged: Boolean(result?.acknowledged),
      forwarded: Boolean(result?.forwarded),
      errors: result?.errors || [],
    };
  },

  validateAndForward: async (queryId, actor) => {
    const ack = await get().verifyQuery(queryId, actor);

    let forwarded = false;
    let forwardError = null;
    try {
      await get().forwardToOic(queryId, actor);
      forwarded = true;
    } catch (error) {
      forwardError = error?.message || String(error);
    }

    return {
      acknowledged: Boolean(ack?.acknowledged),
      acknowledgementError: ack?.error || null,
      forwarded,
      forwardError,
    };
  },

  forwardToOic: async (queryId, actor, forward = forwardQuery) => {
    assertCan(get(), WORKFLOW_ACTION.FORWARD, queryId, actor);

    await writesSettled();
    try {
      const result = await forward({ queryId });
      await get().refreshFromServer();

      return {
        queryId,
        forwarded: result?.outcome === 'SENT',
        ...(result?.outcome === 'ALREADY_SENT' ? { reason: 'already-forwarded' } : {}),
      };
    } catch (error) {
      await get().refreshFromServer();
      throw sendFailure(error);
    }
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
    const createdBy = fromGemma ? 'Pravah AI Draft Assistant' : 'AI Draft Assistant';

    if (!fromGemma) {
      notify.warning(
        'AI assistant unavailable',
        'A standard template was used instead — review the draft carefully before sending.',
      );
    }

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

  grantFinalApproval: async (queryId, actor, approve = approveOnServer, { comment } = {}) => {
    assertCan(get(), WORKFLOW_ACTION.FINAL_APPROVE, queryId, actor);

    const running = approvalsInFlight.get(queryId);
    if (running) return running;

    const work = (async () => {
      await writesSettled();
      try {
        return await approve(queryId, { comment });
      } finally {
        await get().refreshFromServer();
      }
    })().finally(() => approvalsInFlight.delete(queryId));

    approvalsInFlight.set(queryId, work);
    return work;
  },

  resolveOutboundEmail: async (queryId, { emailType, outcome }, resolve = resolveOutboundOnServer) => {
    await writesSettled();
    try {
      return await resolve(queryId, { emailType, outcome });
    } finally {
      await get().refreshFromServer();
    }
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
    if (!state.queries.some((q) => q.queryId === queryId)) {
      throw new Error(`DISPATCH: query ${queryId} does not exist`);
    }

    if (actor) assertCan(state, WORKFLOW_ACTION.DISPATCH, queryId, actor);

    await writesSettled();
    try {
      const result = await send({ queryId });
      await get().refreshFromServer();

      return {
        queryId,
        dispatched: result?.outcome === 'SENT',
        alreadyDispatched: result?.outcome === 'ALREADY_SENT',
        outcome: result?.outcome ?? null,
      };
    } catch (error) {
      await get().refreshFromServer();
      throw sendFailure(error);
    }
  },

  transferQuery: (queryId, newAssigneeId, reason, actor) => {
    const query = assertCan(get(), WORKFLOW_ACTION.TRANSFER, queryId, actor);

    if (!newAssigneeId) {
      throw new Error('A colleague/official must be selected for transfer.');
    }

    if (newAssigneeId === query.currentAssigneeId) {
      throw new Error('Cannot transfer a query to the currently assigned official.');
    }

    const trimmedReason = String(reason || '').trim();
    if (!trimmedReason) {
      throw new Error('A reason for transfer is required.');
    }

    const prevAssignee = findUserById(query.currentAssigneeId);
    const newAssignee = findUserById(newAssigneeId);
    if (newAssignee?.role !== ROLES.ASSIGNED_OFFICIAL) {
      throw new Error('A query can only be transferred to an Assigned Official.');
    }
    const prevName = prevAssignee?.name || query.currentAssigneeId || 'Unassigned';
    const newName = newAssignee?.name || newAssigneeId;
    const actorLabelStr = actorName(actor);

    const messageMint = mintId(get().counters, 'MSG');
    const timestamp = now();

    const transferMessage = createEmailMessage({
      messageId: messageMint.id,
      threadId: query.threadId,
      queryId,
      direction: EMAIL_DIRECTION.OUTBOUND,
      emailType: EMAIL_TYPE.TRANSFER_NOTIFICATION,
      from: actorLabelStr,
      to: [newAssignee?.email || `${newAssigneeId}@ipc.example`],
      subject: `Query ${queryId} Transferred: ${query.subject}`,
      body: `Query ${queryId} ("${query.subject}") has been transferred to you by ${actorLabelStr}.\n\nPrevious Assignee: ${prevName}\nTransfer Reason: ${trimmedReason}\nDate & Time: ${new Date(timestamp).toLocaleString()}`,
      timestamp,
    });

    const auditDetails = `Case ID: ${query.queryId} | Transferred From: ${prevName} | Transferred To: ${newName} | Transferred By: ${actorLabelStr} | Reason: ${trimmedReason}`;

    get().applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.QUERY_TRANSFERRED,
      patch: { currentAssigneeId: newAssigneeId },
      details: auditDetails,
      notify: {
        recipientRole: null,
        recipientUserId: newAssigneeId,
        message: `${queryId} (${query.subject}) was transferred to ${newName} by ${actorLabelStr}. Reason: ${trimmedReason}`,
      },
      mutate: (base) => ({
        counters: { ...base.counters, ...messageMint.bump },
        emailMessages: [...base.emailMessages, transferMessage],
      }),
    });

    return { queryId, transferredTo: newName, success: true };
  },

  pullBackQuery: (queryId, targetStage, reason, remarks = '', actor) => {
    if (actor?.role !== ROLES.ADMIN && actor?.role !== ROLES.SUPER_ADMIN) {
      throw new Error('You do not have permission to pull back this query.');
    }

    const query = assertCan(get(), WORKFLOW_ACTION.PULLBACK, queryId, actor);

    if (!targetStage) {
      throw new Error('A target stage must be selected for pullback.');
    }

    if (targetStage === query.workflowState) {
      throw new Error('Cannot pull back a query to its current workflow stage.');
    }

    const trimmedReason = String(reason || '').trim();
    if (!trimmedReason) {
      throw new Error('A reason for pullback is required.');
    }

    const trimmedRemarks = String(remarks || '').trim();
    const prevStage = query.workflowState;
    const actorLabelStr = actorName(actor);
    const prevAssignee = findUserById(query.currentAssigneeId);
    const timestamp = now();

    const PRE_ASSIGNMENT_STAGES = [
      WORKFLOW_STATE.RECEIVED,
      WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION,
      WORKFLOW_STATE.PENDING_ASSIGNMENT,
    ];

    const isPreAssignment = PRE_ASSIGNMENT_STAGES.includes(targetStage);
    const newAssigneeId = isPreAssignment ? null : query.currentAssigneeId;

    const pullbackRecord = {
      fromStage: prevStage,
      toStage: targetStage,
      pulledBackBy: actor?.id || 'ADMIN',
      pulledBackByName: actorLabelStr,
      reason: trimmedReason,
      remarks: trimmedRemarks,
      previousAssignee: prevAssignee?.name || query.currentAssigneeId || 'Unassigned',
      newAssignee: isPreAssignment ? 'Unassigned' : (prevAssignee?.name || query.currentAssigneeId || 'Unassigned'),
      pulledBackAt: timestamp,
    };

    const auditDetails = `From: ${prevStage} | Pulled Back To: ${targetStage} | Pulled Back By: ${actorLabelStr} | Reason: ${trimmedReason}${trimmedRemarks ? ` | Remarks: ${trimmedRemarks}` : ''}`;

    let recipientRole = 'OFFICER_IN_CHARGE';
    if (targetStage === WORKFLOW_STATE.RECEIVED || targetStage === WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION) {
      recipientRole = 'FRONT_OFFICE';
    } else if (targetStage === WORKFLOW_STATE.ASSIGNED || targetStage === WORKFLOW_STATE.DRAFTING || targetStage === WORKFLOW_STATE.RETURNED_FOR_REVISION) {
      recipientRole = 'ASSIGNED_OFFICIAL';
    } else if (targetStage === WORKFLOW_STATE.UNDER_REVIEW) {
      recipientRole = 'REVIEWER';
    }

    get().applyTransition({
      queryId,
      actor,
      event: AUDIT_EVENT.QUERY_PULLED_BACK,
      patch: {
        workflowState: targetStage,
        currentAssigneeId: newAssigneeId,
      },
      details: auditDetails,
      notify: {
        recipientRole,
        message: `Query ${queryId} was pulled back from ${prevStage} to ${targetStage} by ${actorLabelStr}. Reason: ${trimmedReason}`,
      },
      mutate: (base) => {
        const existingQuery = base.queries.find((q) => q.queryId === queryId);
        const existingHistory = existingQuery?.pullbackHistory || [];
        return {
          queries: base.queries.map((q) =>
            q.queryId === queryId
              ? {
                  ...q,
                  pullbackHistory: [...existingHistory, pullbackRecord],
                }
              : q
          ),
        };
      },
    });

    return { queryId, prevStage, targetStage, success: true };
  },

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const { isEmpty, loadAll } = await dbModule();
      if (await isEmpty()) {
        set({ ...buildSeedState(), hydrated: true, persistenceError: null, refreshedAt: Date.now() });
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
        outboundEmails: stored.outboundEmails || [],
        counters: stored.counters || buildSeedState().counters,
        hydrated: true,
        persistenceError: null,
        refreshedAt: Date.now(),
      });
    } catch (error) {
      set({ hydrated: true, persistenceError: String(error?.message || error) });
    }
  },

  refreshFromServer: async ({ quiet = false } = {}) => {
    try {
      const { loadAll } = db ?? (await dbModule());
      const stored = await loadAll();
      const current = get();
      if (quiet && !current.hydrated) return false;
      const fresh = {
        ...Object.fromEntries(
          SERVER_COLLECTIONS.map((key) => [key, replaceEqualDeep(current[key], stored[key] || [])]),
        ),
        counters: stored.counters || current.counters,
        persistenceError: null,
        refreshedAt: Date.now(),
      };
      if (quiet) beginBatch();
      try {
        set(fresh);
      } finally {
        if (quiet) endBatch();
      }
      return true;
    } catch (error) {
      if (!quiet) set({ persistenceError: String(error?.message || error) });
      return false;
    }
  },

  revalidate: () => {
    revalidating ??= get()
      .refreshFromServer({ quiet: true })
      .finally(() => {
        revalidating = null;
      });
    return revalidating;
  },

  resetHydration: () => set({ ...buildSeedState(), hydrated: false, persistenceError: null }),

  resetDemo: async () => {
    const seed = buildSeedState();
    try {
      const { replaceAll } = await dbModule();
      await replaceAll(seed);
      set({ ...seed, persistenceError: null });
    } catch (error) {
      set({ persistenceError: String(error?.message || error) });
    }
  },
}));

export { BUSINESS_STATUS, WORKFLOW_STATE };
