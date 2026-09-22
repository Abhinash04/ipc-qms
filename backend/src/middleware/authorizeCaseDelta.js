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
import { ACTOR_TYPES, ROLES } from '../constants/roles.js';
import { QueryCase, WorkflowStep, Review, ResponseVersion } from '../models/index.js';
import { isConnected } from '../config/db.js';

/**
 * Authorization for POST /queries/persist — step 3 of the chain in
 * .claude/backend-rules.md, for the one route that had none.
 *
 * This route takes a whole case document and `$set`s it. It used to carry
 * `verifyToken` and a body schema and nothing else, so any signed-in account —
 * including the seeded INQUIRER, who is a member of the public — could rewrite
 * any case in the system: set its workflow state, replace the approved response
 * text, name the inquirer it would be mailed to, and delete its workflow steps.
 * `services/workflow/finalApproval.js` then reads exactly those stored fields to
 * decide eligibility, pick the reply body and pick the recipient.
 *
 * ## Why there is no verifyRole here
 *
 * Every role legitimately writes through this route: the INQUIRER raises portal
 * enquiries, the REVIEWER records decisions, the ASSIGNED_OFFICIAL saves
 * drafts. A role allow-list containing all of them denies nothing while looking
 * like a control. The substance is the two layers below.
 *
 * ## Two checks, both against STORED state
 *
 * 1. PROTECTED VALUES — for each guarded field, compare the submitted value
 *    with the one already stored, and require the corresponding workflow action
 *    only when it actually CHANGES.
 *
 *    The comparison is the whole point. The client sends the entire case
 *    document on every transition, so an ordinary save resends the case's
 *    current `workflowState` and `currentAssigneeId` untouched. Treating the
 *    mere presence of a field as an attempt to set it refused every save whose
 *    resent value the caller's role could not itself have caused — an assigned
 *    official transferring a case sitting in ASSIGNED, for instance, since
 *    ASSIGNED is reached by the Officer-in-Charge's ASSIGN. A no-op is not a
 *    transition.
 *
 * 2. CASE SCOPE — resolved from the database AS IT STANDS BEFORE THE DELTA, and
 *    never from a value in the submitted body. This is the whole answer to the
 *    bootstrapping problem: membership is derived from fields this very route
 *    writes, so consulting the body would let a caller write themselves in and
 *    then be admitted on the strength of it.
 *
 * Failure is whole-delta, never per-element: a delta is one transition, and
 * applying the half that passes leaves a case incoherent — a state moved with
 * its steps dropped, or a review recorded against a transition that never
 * happened.
 */

/** Pullback re-points a case to an earlier stage, so it can target any state. */
const canPullBack = (role) => roleCanPerform(role, WORKFLOW_ACTION.PULLBACK);

const permits = (role, actions) =>
  Array.isArray(actions) && actions.some((action) => roleCanPerform(role, action));

/**
 * The field paths this role may not write, given what is submitted and what is
 * already stored. Empty means nothing objectionable.
 *
 * `stored` is `{ query, versionStatusById }` for the case being written, with
 * nulls when it does not exist yet (a creation). Pure — the middleware does the
 * reading — so the rules stay unit-testable without a database.
 */
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
        // An unrecognised state is refused here rather than in the schema, so a
        // client on a newer build gets a 403 naming the field instead of a 400
        // that rejects the entire delta over one value the server has not
        // learned yet.
        violations.push('query.workflowState');
      } else if (creating) {
        /**
         * A new case opens at RECEIVED, and that is not a transition anybody
         * needs an action for — an Inquirer raising a portal enquiry holds no
         * workflow action at all. WHO may create a case is decided separately,
         * by creationViolation below.
         */
        if (query.workflowState !== WORKFLOW_STATE.RECEIVED && !everything) {
          violations.push('query.workflowState');
        }
      } else if (query.workflowState !== storedQuery.workflowState) {
        const required = STATE_REQUIRES_ACTION[query.workflowState];
        if (required === null) {
          // Intake and operational overrides: no workflow action grants these,
          // so they belong to the roles that already see every case.
          if (!everything) violations.push('query.workflowState');
        } else if (!permits(role, required) && !canPullBack(role)) {
          violations.push('query.workflowState');
        }
      }
    }

    /**
     * Naming the assignee is how a principal would write itself into a case's
     * membership, so this is the direct anti-self-promotion rule — but only
     * when the name actually changes. Clearing it is exempt: intake creates a
     * case unassigned.
     */
    const assignee = query.currentAssigneeId;
    if (typeof assignee === 'string' && assignee && assignee !== storedQuery?.currentAssigneeId) {
      if (!permits(role, ASSIGNEE_REQUIRES_ACTION)) violations.push('query.currentAssigneeId');
    }
  }

  const versions = [...(body?.addVersions || []), ...(body?.upsertVersions || [])];
  for (const version of versions) {
    if (!version || typeof version.status !== 'string') continue;

    // Resending a version's existing status is not setting it. Without this,
    // every later save on a case carrying an approved response was refused for
    // everyone but the Officer-in-Charge.
    const previous = stored?.versionStatusById?.get?.(version.responseId);
    if (previous === version.status) continue;

    const required = VERSION_STATUS_REQUIRES_ACTION[version.status];
    if (required === undefined) {
      violations.push('upsertVersions.status');
    } else if (required !== null && !permits(role, required)) {
      // The final-approval lock. Approval is granted by
      // POST /queries/:queryId/final-approval, which is gated on FINAL_APPROVE;
      // this stops persist being a second, ungated way to set the same field.
      violations.push('upsertVersions.status');
    }
  }

  return [...new Set(violations)];
}

/** The stored case and response-version statuses the value rules compare against. */
async function storedStateFor(body) {
  const queryId = body?.query?.queryId;
  const responseIds = [...(body?.addVersions || []), ...(body?.upsertVersions || [])]
    .map((row) => row?.responseId)
    .filter(Boolean);

  const [query, versions] = await Promise.all([
    queryId ? QueryCase.findOne({ queryId }).select('workflowState currentAssigneeId').lean() : null,
    responseIds.length
      ? ResponseVersion.find({ responseId: { $in: responseIds } }).select('responseId status').lean()
      : [],
  ]);

  return {
    query,
    versionStatusById: new Map((versions || []).map((v) => [v.responseId, v.status])),
  };
}

/** Every queryId named anywhere in the delta body. */
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

/**
 * The cases the delta touches through a STORED row rather than by naming them.
 *
 * Two ways that happens, and both are load-bearing:
 *
 *  - `deleteStepIds` carries step ids with no queryId of their own.
 *  - an upsert keyed on a natural key (stepId, reviewId, responseId) may name
 *    one case in the body while the stored row belongs to another. Requiring
 *    party-to on the STORED parent as well is what stops a foreign step being
 *    re-homed onto a case you are entitled to.
 */
async function storedParentIds(body) {
  const stepIds = [
    ...(body?.deleteStepIds || []),
    ...(body?.upsertSteps || []).map((row) => row?.stepId),
  ].filter(Boolean);
  const reviewIds = (body?.addReviews || []).map((row) => row?.reviewId).filter(Boolean);
  const responseIds = [...(body?.addVersions || []), ...(body?.upsertVersions || [])]
    .map((row) => row?.responseId)
    .filter(Boolean);

  const [steps, reviews, versions] = await Promise.all([
    stepIds.length ? WorkflowStep.distinct('queryId', { stepId: { $in: stepIds } }) : [],
    reviewIds.length ? Review.distinct('queryId', { reviewId: { $in: reviewIds } }) : [],
    responseIds.length ? ResponseVersion.distinct('queryId', { responseId: { $in: responseIds } }) : [],
  ]);

  return new Set([...steps, ...reviews, ...versions].filter(Boolean));
}

function deny(req, res, message, { fields = [], queryIds = [] } = {}) {
  // A run of these against one account is what an attempted escalation looks
  // like from the outside. Fire-and-forget, exactly as verifyRole does.
  void audit.record({
    action: AUDIT_ACTIONS.AUTHORIZATION_DENIED,
    result: AUDIT_RESULTS.DENIED,
    actorType: ACTOR_TYPES.HUMAN,
    actorId: req.user?.id ?? null,
    actorRole: req.user?.role ?? null,
    details: { method: req.method, path: req.originalUrl, fields, queryIds },
  });

  // Field paths and case ids only. A delta carries case content, so no value
  // from it may be echoed back.
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

    // Both checks read stored state, so neither can run without the store. This
    // is the fail-closed point: "cannot tell" must never widen to "allowed".
    if (!isConnected()) {
      return next(
        Object.assign(new Error('Case access cannot be determined: query storage is unavailable'), {
          status: HTTP_STATUS.SERVICE_UNAVAILABLE,
        }),
      );
    }

    // ── The value rules, against what is stored ────────────────────────────
    const stored = await storedStateFor(body);
    const violations = protectedValueViolations(req.user, body, stored);
    if (violations.length) {
      return deny(req, res, `${req.user.role} is not permitted to make that change`, {
        fields: violations,
      });
    }

    // ── Case scope ─────────────────────────────────────────────────────────
    const scope = await caseScopeFor(req);
    if (scope.everything) return next();

    const named = queryIdsInBody(body);
    const parents = await storedParentIds(body);
    const touched = new Set([...named, ...parents]);
    if (!touched.size) return next();

    // A queryId naming no stored case is a CREATION, not a case this caller has
    // failed to be party to. Everything else must already be theirs.
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

/**
 * Creating a case: there is no prior membership to check, so the rules are
 * about what the new case may claim.
 *
 * The INQUIRER may raise a portal enquiry, but may not hand it an assignee or a
 * current step — that would be self-service membership on a case nobody has
 * triaged. Their `inquirer` record is CLAMPED to the session identity in the
 * controller rather than validated here, the same choice already made for the
 * audit actor and for `sourceMailbox`.
 *
 * The ASSIGNED_OFFICIAL and REVIEWER raise no cases in this workflow. Letting
 * them would hand both an unbounded way to mint cases they are party to.
 */
function creationViolation(user, body) {
  if (user.role === ROLES.INQUIRER) {
    const query = body?.query || {};
    if (query.currentAssigneeId || query.currentWorkflowStepId) {
      return {
        message: 'A new enquiry cannot name its own assignee',
        fields: ['query.currentAssigneeId', 'query.currentWorkflowStepId'].filter(
          (field) => query[field.split('.')[1]],
        ),
      };
    }
    return null;
  }

  return {
    message: `${user.role} is not permitted to raise a case`,
    fields: ['query.queryId'],
  };
}

export default authorizeCaseDelta;
