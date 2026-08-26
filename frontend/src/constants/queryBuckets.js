import {
  Inbox,
  FileText,
  Clock,
  UserCheck,
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  Send,
  Layers,
} from "lucide-react";

import { WORKFLOW_STATE, BUSINESS_STATUS } from "@/constants/statusEnums";
import { ROLES } from "@/constants/roles";
import { isQueryOwnedBy } from "@/utils/queryOwnership";

const ACTIVE_WORK_STATES = [
  WORKFLOW_STATE.ASSIGNED,
  WORKFLOW_STATE.DRAFTING,
  WORKFLOW_STATE.RETURNED_FOR_REVISION,
  WORKFLOW_STATE.UNDER_REVIEW,
];

const FINISHED_STATES = [
  WORKFLOW_STATE.READY_FOR_DISPATCH,
  WORKFLOW_STATE.DISPATCHED,
  WORKFLOW_STATE.CLOSED,
];

export const STATE_GROUPS = {
  ACTIVE_WORK: ACTIVE_WORK_STATES,
  FINISHED: FINISHED_STATES,
  DRAFTING_STAGE: [
    WORKFLOW_STATE.ASSIGNED,
    WORKFLOW_STATE.DRAFTING,
    WORKFLOW_STATE.RETURNED_FOR_REVISION,
  ],
};

const APPROVED = "APPROVED";
const CHANGES_REQUESTED = "CHANGES_REQUESTED";

function ownsCurrentStep(query, workflowSteps, user) {
  if (!user) return false;
  const step = (workflowSteps || []).find(
    (s) => s.stepId === query.currentWorkflowStepId,
  );
  return Boolean(step && step.assignedUserId === user.id);
}

export function isAssignedTo(query, workflowSteps, user) {
  if (!user) return false;
  return (
    query.currentAssigneeId === user.id ||
    ownsCurrentStep(query, workflowSteps, user)
  );
}

export function isActiveWorkFor(query, workflowSteps, user) {
  if (!ACTIVE_WORK_STATES.includes(query.workflowState)) return false;
  return isAssignedTo(query, workflowSteps, user);
}

export function isAwaitingReviewBy(query, workflowSteps, user) {
  if (!user) return false;
  if (query.workflowState !== WORKFLOW_STATE.UNDER_REVIEW) return false;
  return ownsCurrentStep(query, workflowSteps, user);
}

function involvesReviewer(query, { workflowSteps = [], reviews = [], user }) {
  if (!user) return false;
  return (
    workflowSteps.some(
      (s) => s.queryId === query.queryId && s.assignedUserId === user.id,
    ) ||
    reviews.some((r) => r.queryId === query.queryId && r.reviewerId === user.id)
  );
}

const decidedBy =
  (decision) =>
  (query, { reviews = [], user }) =>
    reviews.some(
      (r) =>
        r.queryId === query.queryId &&
        r.reviewerId === user?.id &&
        r.decision === decision,
    );

const inState =
  (...states) =>
  (query) =>
    states.includes(query.workflowState);

const inBusinessStatus = (status) => (query) => query.businessStatus === status;
const everything = () => true;
const totalBucket = (caption) => ({
  key: "total",
  label: "Total Queries",
  caption,
  icon: Layers,
  aggregate: true,
  predicate: everything,
});

export const ROLE_BUCKETS = {
  [ROLES.INQUIRER]: {
    scope: (query, { user }) => isQueryOwnedBy(query, user),
    defaultKey: "total",
    buckets: [
      totalBucket("Everything you raised"),
      {
        key: "open",
        label: "Open Queries",
        caption: "Received, not yet picked up",
        icon: Inbox,
        predicate: inBusinessStatus(BUSINESS_STATUS.OPEN),
      },
      {
        key: "inProgress",
        label: "In Progress",
        caption: "Being worked on by IPC",
        icon: Clock,
        predicate: inBusinessStatus(BUSINESS_STATUS.IN_PROGRESS),
      },
      {
        key: "closed",
        label: "Closed",
        caption: "Answered and closed",
        icon: CheckCircle2,
        predicate: inBusinessStatus(BUSINESS_STATUS.CLOSED),
      },
    ],
  },

  [ROLES.FRONT_OFFICE]: {
    scope: everything,
    defaultKey: "incoming",
    buckets: [
      totalBucket("Every query within your permitted scope"),
      {
        key: "incoming",
        label: "New / Incoming",
        caption: "Awaiting your verification",
        icon: Inbox,
        predicate: inState(
          WORKFLOW_STATE.RECEIVED,
          WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION,
        ),
      },
      {
        key: "pendingAssignment",
        label: "Pending Assignment",
        caption: "Forwarded, awaiting the OIC",
        icon: UserCheck,
        predicate: inState(WORKFLOW_STATE.PENDING_ASSIGNMENT),
      },
      {
        key: "awaitingDispatch",
        label: "Awaiting Dispatch",
        caption: "Approved, ready to send",
        icon: Send,
        predicate: inState(WORKFLOW_STATE.READY_FOR_DISPATCH),
      },
      {
        key: "dispatched",
        label: "Dispatched",
        caption: "Reply sent to the inquirer",
        icon: CheckCircle2,
        predicate: inState(WORKFLOW_STATE.DISPATCHED, WORKFLOW_STATE.CLOSED),
      },
    ],
  },

  [ROLES.OFFICER_IN_CHARGE]: {
    scope: everything,
    defaultKey: "awaitingAssignment",
    buckets: [
      totalBucket("Every query within your permitted scope"),
      {
        key: "awaitingAssignment",
        label: "Awaiting Assignment",
        caption: "Needs an official",
        icon: UserCheck,
        predicate: inState(WORKFLOW_STATE.PENDING_ASSIGNMENT),
      },
      {
        key: "inProgress",
        label: "In Progress",
        caption: "Assigned, drafting or in review",
        icon: Clock,
        predicate: inState(
          WORKFLOW_STATE.ASSIGNED,
          WORKFLOW_STATE.DRAFTING,
          WORKFLOW_STATE.UNDER_REVIEW,
        ),
      },
      {
        key: "awaitingFinalApproval",
        label: "Awaiting Final Approval",
        caption: "Your decision needed",
        icon: ClipboardCheck,
        predicate: inState(WORKFLOW_STATE.PENDING_FINAL_APPROVAL),
      },
      {
        key: "returned",
        label: "Returned",
        caption: "Sent back for revision",
        icon: XCircle,
        predicate: inState(WORKFLOW_STATE.RETURNED_FOR_REVISION),
      },
      {
        key: "approved",
        label: "Approved",
        caption: "Cleared for dispatch or closed",
        icon: CheckCircle2,
        predicate: inState(...FINISHED_STATES),
      },
    ],
  },

  [ROLES.ASSIGNED_OFFICIAL]: {
    scope: (query, { workflowSteps, user }) =>
      isAssignedTo(query, workflowSteps, user),
    defaultKey: "assigned",
    buckets: [
      totalBucket("Every case assigned to you"),
      {
        key: "assigned",
        label: "Assigned to me",
        caption: "Not started yet",
        icon: UserCheck,
        predicate: inState(WORKFLOW_STATE.ASSIGNED),
      },
      {
        key: "drafting",
        label: "Drafting",
        caption: "Response in progress",
        icon: FileText,
        predicate: inState(WORKFLOW_STATE.DRAFTING),
      },
      {
        key: "submitted",
        label: "Submitted for Review",
        caption: "Waiting on reviewers",
        icon: ClipboardCheck,
        predicate: inState(
          WORKFLOW_STATE.UNDER_REVIEW,
          WORKFLOW_STATE.PENDING_FINAL_APPROVAL,
        ),
      },
      {
        key: "returned",
        label: "Returned for Revision",
        caption: "Changes requested",
        icon: XCircle,
        predicate: inState(WORKFLOW_STATE.RETURNED_FOR_REVISION),
      },
      {
        key: "completed",
        label: "Completed",
        caption: "Approved, dispatched or closed",
        icon: CheckCircle2,
        predicate: inState(...FINISHED_STATES),
      },
    ],
  },

  [ROLES.REVIEWER]: {
    scope: involvesReviewer,
    defaultKey: "awaitingReview",
    buckets: [
      totalBucket("Every case you review"),
      {
        key: "awaitingReview",
        label: "Awaiting My Review",
        caption: "Your review queue",
        icon: ClipboardCheck,
        predicate: (query, { workflowSteps, user }) =>
          isAwaitingReviewBy(query, workflowSteps, user),
      },
      {
        key: "approvedByMe",
        label: "Approved by me",
        caption: "You passed these",
        icon: CheckCircle2,
        predicate: decidedBy(APPROVED),
      },
      {
        key: "returnedByMe",
        label: "Returned by me",
        caption: "You sent these back",
        icon: XCircle,
        predicate: decidedBy(CHANGES_REQUESTED),
      },
    ],
  },
};

const SYSTEM_WIDE = {
  scope: everything,
  defaultKey: "total",
  buckets: [
    totalBucket("Everything in the system"),
    {
      key: "open",
      label: "Open",
      caption: "Not yet picked up",
      icon: Inbox,
      predicate: inBusinessStatus(BUSINESS_STATUS.OPEN),
    },
    {
      key: "inProgress",
      label: "In Progress",
      caption: "Moving through the workflow",
      icon: Clock,
      predicate: inBusinessStatus(BUSINESS_STATUS.IN_PROGRESS),
    },
    {
      key: "closed",
      label: "Closed",
      caption: "Answered and closed",
      icon: CheckCircle2,
      predicate: inBusinessStatus(BUSINESS_STATUS.CLOSED),
    },
  ],
};

ROLE_BUCKETS[ROLES.ADMIN] = SYSTEM_WIDE;
ROLE_BUCKETS[ROLES.SUPER_ADMIN] = SYSTEM_WIDE;

export function configForRole(role) {
  return ROLE_BUCKETS[role] || SYSTEM_WIDE;
}

export function bucketsForRole(role) {
  return configForRole(role).buckets;
}

export function defaultBucketKey(role) {
  const config = configForRole(role);
  return config.defaultKey || config.buckets[0]?.key;
}

export function visibleQueries(queries, role, ctx) {
  const { scope } = configForRole(role);
  return queries.filter((query) => scope(query, ctx));
}

export function bucketRecords(queries, role, bucketKey, ctx) {
  return queries.filter(anyBucket(role, [bucketKey], ctx));
}

export function anyBucket(role, keys, ctx) {
  const config = configForRole(role);
  const buckets = config.buckets.filter((b) => keys.includes(b.key));
  return (query) =>
    config.scope(query, ctx) &&
    buckets.some((bucket) => bucket.predicate(query, ctx));
}

export function roleScope(role, ctx) {
  const { scope } = configForRole(role);
  return (query) => scope(query, ctx);
}
