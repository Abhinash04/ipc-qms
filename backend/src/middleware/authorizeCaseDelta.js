import HTTP_STATUS from '../constants/httpStatus.js';
import { roleCanPerform, WORKFLOW_ACTION } from '../constants/workflowActions.js';
import {
  STATE_REQUIRES_ACTION,
  VERSION_STATUS_REQUIRES_ACTION,
  ASSIGNEE_REQUIRES_ACTION,
} from '../constants/protectedFields.js';
import { WORKFLOW_STATE } from '../constants/workflowStates.js';
import { caseScopeFor, scopeKindForRole, SCOPE_KIND } from '../services/authz/caseAccess.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';
import {
  QueryCase,
  WorkflowStep,
  Review,
  ResponseVersion,
  EmailMessage,
  EmailThread,
  Notification,
} from '../models/index.js';
import { isConnected } from '../config/db.js';

const canPullBack = (role) => roleCanPerform(role, WORKFLOW_ACTION.PULLBACK);
const permits = (role, actions) =>
  Array.isArray(actions) && actions.some((action) => roleCanPerform(role, action));
export function protectedValueViolations(user, body, stored = {}) {
  const role = user?.role;
  const everything = scopeKindForRole(role) === SCOPE_KIND.EVERYTHING;
  const violations = [];

  const query = body?.query;
  const storedQuery = stored?.query || null;
  const creating = Boolean(query) && !storedQuery;

  if (query && typeof query === 'object') {
    if (typeof query.workflowState === 'string') {
      if (!(query.workflowState in STATE_REQUIRES_ACTION)) {
        violations.push('query.workflowState');
      } else if (creating) {
        if (query.workflowState !== WORKFLOW_STATE.RECEIVED && !everything) {
          violations.push('query.workflowState');
        }
      } else if (query.workflowState !== storedQuery.workflowState) {
        const required = STATE_REQUIRES_ACTION[query.workflowState];
        if (required === null) {
          if (!everything) violations.push('query.workflowState');
        } else if (!permits(role, required) && !canPullBack(role)) {
          violations.push('query.workflowState');
        }
      }
    }

    const assignee = query.currentAssigneeId;
    if (typeof assignee === 'string' && assignee && assignee !== storedQuery?.currentAssigneeId) {
      if (!permits(role, ASSIGNEE_REQUIRES_ACTION)) violations.push('query.currentAssigneeId');
    }
  }

  const versions = [...(body?.addVersions || []), ...(body?.upsertVersions || [])];
  for (const version of versions) {
    if (!version || typeof version.status !== 'string') continue;
    const previous = stored?.versionStatusById?.get?.(version.responseId);
    if (previous === version.status) continue;

    const required = VERSION_STATUS_REQUIRES_ACTION[version.status];
    if (required === undefined) {
      violations.push('upsertVersions.status');
    } else if (required !== null && !permits(role, required)) {
      violations.push('upsertVersions.status');
    }
  }

  return [...new Set(violations)];
}

async function storedStateFor(body) {
  const queryId = body?.query?.queryId;
  const responseIds = [...(body?.addVersions || []), ...(body?.upsertVersions || [])]
    .map((row) => row?.responseId)
    .filter(Boolean);

  const [query, versions] = await Promise.all([
    queryId ? QueryCase.findOne({ queryId }).select('workflowState currentAssigneeId revision').lean() : null,
    responseIds.length
      ? ResponseVersion.find({ responseId: { $in: responseIds } }).select('responseId status').lean()
      : [],
  ]);

  return {
    query,
    versionStatusById: new Map((versions || []).map((v) => [v.responseId, v.status])),
  };
}

function queryIdsInBody(body) {
  const ids = new Set();
  const add = (id) => {
    if (typeof id === 'string' && id) ids.add(id);
  };

  add(body?.query?.queryId);
  add(body?.notification?.queryId);
  add(body?.auditEvent?.queryId);

  for (const key of ['upsertSteps', 'addReviews', 'addVersions', 'upsertVersions', 'addMessages', 'addThreads']) {
    for (const row of body?.[key] || []) add(row?.queryId);
  }

  return ids;
}

async function storedParentIds(body) {
  const stepIds = [
    ...(body?.deleteStepIds || []),
    ...(body?.upsertSteps || []).map((row) => row?.stepId),
  ].filter(Boolean);
  const reviewIds = (body?.addReviews || []).map((row) => row?.reviewId).filter(Boolean);
  const responseIds = [...(body?.addVersions || []), ...(body?.upsertVersions || [])]
    .map((row) => row?.responseId)
    .filter(Boolean);

  const messageIds = (body?.addMessages || []).map((row) => row?.messageId).filter(Boolean);
  const threadIds = (body?.addThreads || []).map((row) => row?.threadId).filter(Boolean);
  const notificationIds = [body?.notification?.notificationId].filter(Boolean);

  const found = await Promise.all([
    stepIds.length ? WorkflowStep.distinct('queryId', { stepId: { $in: stepIds } }) : [],
    reviewIds.length ? Review.distinct('queryId', { reviewId: { $in: reviewIds } }) : [],
    responseIds.length ? ResponseVersion.distinct('queryId', { responseId: { $in: responseIds } }) : [],
    messageIds.length ? EmailMessage.distinct('queryId', { messageId: { $in: messageIds } }) : [],
    threadIds.length ? EmailThread.distinct('queryId', { threadId: { $in: threadIds } }) : [],
    notificationIds.length ? Notification.distinct('queryId', { notificationId: { $in: notificationIds } }) : [],
  ]);

  return new Set(found.flat().filter(Boolean));
}

function deny(req, res, message, { fields = [], queryIds = [] } = {}) {
  void audit.record({
    action: AUDIT_ACTIONS.AUTHORIZATION_DENIED,
    result: AUDIT_RESULTS.DENIED,
    actorType: ACTOR_TYPES.HUMAN,
    actorId: req.user?.id ?? null,
    actorRole: req.user?.role ?? null,
    details: { method: req.method, path: req.originalUrl, fields, queryIds },
  });

  return res.status(HTTP_STATUS.FORBIDDEN).json({ error: message, fields, queryIds });
}

async function authorizeCaseDelta(req, res, next) {
  try {
    if (!req.user) {
      return next(
        Object.assign(new Error('Authentication required'), { status: HTTP_STATUS.UNAUTHORIZED }),
      );
    }

    const body = req.body || {};

    if (!isConnected()) {
      return next(
        Object.assign(new Error('Case access cannot be determined: query storage is unavailable'), {
          status: HTTP_STATUS.SERVICE_UNAVAILABLE,
        }),
      );
    }

    const stored = await storedStateFor(body);
    if (body.query && (stored.query?.revision ?? 0) !== (body.baseRevision ?? 0)) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        code: 'STALE_CASE',
        error: 'This case was changed by someone else',
        queryId: body.query.queryId,
      });
    }

    const violations = protectedValueViolations(req.user, body, stored);
    if (violations.length) {
      return deny(req, res, `${req.user.role} is not permitted to make that change`, {
        fields: violations,
      });
    }

    const named = queryIdsInBody(body);
    const parents = await storedParentIds(body);
    if ([...parents].some((id) => !named.has(id))) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        code: 'ID_COLLISION',
        error: 'A record in this change already belongs to another case',
        queryId: body.query?.queryId ?? null,
      });
    }

    const scope = await caseScopeFor(req);
    if (scope.everything) return next();

    const touched = new Set([...named, ...parents]);
    if (!touched.size) return next();

    const existing = named.size
      ? new Set(await QueryCase.distinct('queryId', { queryId: { $in: [...named] } }))
      : new Set();

    const mustBeParty = [...new Set([...parents, ...existing])];
    const outOfScope = mustBeParty.filter((id) => !scope.ids.has(id));

    if (outOfScope.length) {
      return deny(req, res, 'You are not permitted to modify that case', {
        queryIds: outOfScope.sort(),
      });
    }

    const creating = [...named].filter((id) => !existing.has(id));
    if (creating.length) {
      const violation = creationViolation(req.user, body);
      if (violation) {
        return deny(req, res, violation.message, { fields: violation.fields, queryIds: creating });
      }
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

function creationViolation(user) {
  return {
    message: `${user.role} is not permitted to raise a case`,
    fields: ['query.queryId'],
  };
}

export default authorizeCaseDelta;
