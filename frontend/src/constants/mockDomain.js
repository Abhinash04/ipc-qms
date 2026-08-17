import { BUSINESS_STATUS, WORKFLOW_STATE, PRIORITY, AUDIT_EVENT } from './statusEnums';

/**
 * Seed state for the mock workflow domain, loaded into IndexedDB on first run
 * (see services/db/db.js).
 *
 * QRY-2026-00427 is the canonical walkthrough case and is seeded at the very
 * START of its lifecycle (OPEN / RECEIVED, no assignee, no steps) so the full
 * documented flow can actually be driven through the UI.
 *
 * The other five queries are seeded at later stages so list pages, dashboard
 * KPIs, "My Work" filtering, and the Dexie indexes have real data to work
 * against. They are background context — the walkthrough always uses 00427.
 *
 * All IDs are stable and sequential (never random) so a reset reproduces the
 * exact same identifiers.
 */

export const SEED_QUERY_ID = 'QRY-2026-00427';
export const SEED_WORKFLOW_ID = 'WF-2026-00001';

/** Mock AI assignment recommendation (docs/srs/07-ai-requirements.md — AI recommends, OIC decides). */
export const AI_ASSIGNMENT_RECOMMENDATION = {
  recommendedUserId: 'USR-0004',
  matchPercent: 92,
  reason: 'Strong historical and subject-matter relevance.',
  factors: [
    'Query category',
    'Subject / required expertise',
    'Previous assignments',
    'Current workload',
    'Division',
  ],
};

/** Mock AI-generated first draft (docs/srs/07-ai-requirements.md — never auto-final). */
export const AI_DRAFT_TEMPLATE = `Dear Mr. Kumar,

Thank you for your query regarding the eligibility criteria for the Government Training Programme.

Applicants must meet the minimum qualifying experience stated in the programme notice, and supporting documentation should be submitted alongside the application form.

[AI-generated draft — requires review and editing by the assigned official before it can proceed.]

Regards,
Training & Development Division`;

const DRAFT_BODY = (subject) =>
  `Thank you for your query regarding ${subject.toLowerCase()}.\n\n[Draft response prepared by the assigned official.]\n\nRegards,\nIndian Pharmacopoeia Commission`;

function makeQuery({
  queryId,
  workflowId,
  subject,
  description,
  inquirer,
  category,
  priority,
  businessStatus,
  workflowState,
  currentAssigneeId = null,
  currentWorkflowStepId = null,
  attachments = [],
  createdAt,
  updatedAt,
  dueDate,
  assignmentDecision = null,
}) {
  return {
    queryId,
    workflowId,
    subject,
    description,
    source: 'Email',
    inquirer,
    category,
    priority,
    businessStatus,
    workflowState,
    currentAssigneeId,
    currentWorkflowStepId,
    attachments,
    createdAt,
    updatedAt,
    dueDate,
    assignmentDecision,
  };
}

/** The canonical walkthrough query — deliberately left at the start of the flow. */
function walkthroughQuery() {
  return makeQuery({
    queryId: SEED_QUERY_ID,
    workflowId: SEED_WORKFLOW_ID,
    subject: 'Clarification regarding eligibility criteria for Government Training Programme',
    description:
      'Inquirer is seeking clarification on the eligibility criteria for the upcoming Government Training Programme, specifically around minimum qualifying experience and documentation requirements.',
    inquirer: { id: 'USR-0001', name: 'Rajesh Kumar', email: 'rajesh.kumar@example.com' },
    category: 'Training & Development',
    priority: PRIORITY.NORMAL,
    businessStatus: BUSINESS_STATUS.OPEN,
    workflowState: WORKFLOW_STATE.RECEIVED,
    attachments: [{ id: 'ATT-00001', name: 'training-programme-notice.pdf', sizeKb: 240 }],
    createdAt: '2026-08-10T09:15:00.000Z',
    updatedAt: '2026-08-10T09:15:00.000Z',
    dueDate: '2026-08-20T00:00:00.000Z',
  });
}

/**
 * Background queries at later lifecycle stages. Each carries whatever steps /
 * versions / audit rows its stage implies, so the data stays internally
 * consistent (a query UNDER_REVIEW really does have review steps and a draft).
 */
const BACKGROUND = [
  {
    queryId: 'QRY-2026-00428',
    workflowId: 'WF-2026-00002',
    subject: 'Query on revised monograph submission timelines',
    description: 'Requesting confirmation of the revised submission window for monograph updates.',
    inquirer: { id: 'INQ-0002', name: 'Meera Iyer', email: 'meera.iyer@example.com' },
    category: 'Policy & Compliance',
    priority: PRIORITY.HIGH,
    workflowState: WORKFLOW_STATE.PENDING_ASSIGNMENT,
    createdAt: '2026-08-11T10:05:00.000Z',
    dueDate: '2026-08-19T00:00:00.000Z',
  },
  {
    queryId: 'QRY-2026-00429',
    workflowId: 'WF-2026-00003',
    subject: 'Request for guidance on impurity threshold reporting',
    description: 'Seeking guidance on reporting thresholds for identified impurities.',
    inquirer: { id: 'INQ-0003', name: 'Sanjay Bose', email: 'sanjay.bose@example.com' },
    category: 'Technical Operations',
    priority: PRIORITY.NORMAL,
    workflowState: WORKFLOW_STATE.DRAFTING,
    assigneeId: 'USR-0004',
    createdAt: '2026-08-09T08:30:00.000Z',
    dueDate: '2026-08-18T00:00:00.000Z',
    withDraft: true,
  },
  {
    queryId: 'QRY-2026-00430',
    workflowId: 'WF-2026-00004',
    subject: 'Clarification on reference standard reorder process',
    description: 'Asking how to reorder reference standards after the catalogue update.',
    inquirer: { id: 'INQ-0004', name: 'Farhan Qureshi', email: 'farhan.qureshi@example.com' },
    category: 'Technical Operations',
    priority: PRIORITY.URGENT,
    workflowState: WORKFLOW_STATE.UNDER_REVIEW,
    assigneeId: 'USR-0004',
    createdAt: '2026-08-06T14:20:00.000Z',
    dueDate: '2026-08-17T00:00:00.000Z',
    withDraft: true,
    reviewers: ['USR-0005', 'USR-0006'],
    activeReviewIndex: 0,
  },
  {
    queryId: 'QRY-2026-00431',
    workflowId: 'WF-2026-00005',
    subject: 'Question about laboratory accreditation renewal',
    description: 'Requesting the renewal checklist for laboratory accreditation.',
    inquirer: { id: 'INQ-0005', name: 'Lata Menon', email: 'lata.menon@example.com' },
    category: 'Administration',
    priority: PRIORITY.LOW,
    workflowState: WORKFLOW_STATE.READY_FOR_DISPATCH,
    assigneeId: 'USR-0004',
    createdAt: '2026-08-04T11:00:00.000Z',
    dueDate: '2026-08-16T00:00:00.000Z',
    withDraft: true,
    reviewers: ['USR-0005'],
    allReviewsComplete: true,
  },
  {
    queryId: 'QRY-2026-00432',
    workflowId: 'WF-2026-00006',
    subject: 'Clarification regarding sample retention duration',
    description: 'Asked how long retained samples must be preserved after batch release.',
    inquirer: { id: 'INQ-0006', name: 'Vikram Shetty', email: 'vikram.shetty@example.com' },
    category: 'Policy & Compliance',
    priority: PRIORITY.NORMAL,
    workflowState: WORKFLOW_STATE.CLOSED,
    assigneeId: 'USR-0004',
    createdAt: '2026-07-28T09:45:00.000Z',
    dueDate: '2026-08-08T00:00:00.000Z',
    withDraft: true,
    reviewers: ['USR-0005'],
    allReviewsComplete: true,
    closed: true,
  },
];

const pad = (n) => String(n).padStart(5, '0');

function businessStatusFor(workflowState) {
  if (workflowState === WORKFLOW_STATE.RECEIVED) return BUSINESS_STATUS.OPEN;
  if (workflowState === WORKFLOW_STATE.CLOSED) return BUSINESS_STATUS.CLOSED;
  return BUSINESS_STATUS.IN_PROGRESS;
}

export function buildSeedState() {
  const queries = [walkthroughQuery()];
  const workflowSteps = [];
  const reviews = [];
  const responseVersions = [];
  const auditEvents = [
    {
      auditId: 'AUD-00001',
      queryId: SEED_QUERY_ID,
      event: AUDIT_EVENT.QUERY_RECEIVED,
      actor: 'System',
      at: '2026-08-10T09:15:00.000Z',
      details: 'Query received via email and registered in the system.',
    },
  ];
  const notifications = [
    {
      notificationId: 'NOTIF-00001',
      queryId: SEED_QUERY_ID,
      recipientRole: 'FRONT_OFFICE',
      message: `${SEED_QUERY_ID} received and awaiting Front Office verification.`,
      at: '2026-08-10T09:15:00.000Z',
    },
  ];

  const counters = { AUD: 1, NOTIF: 1, STEP: 0, REV: 0, RESP: 0 };

  for (const spec of BACKGROUND) {
    const stepIds = [];

    // Draft step (completed) for anything past assignment.
    if (spec.withDraft) {
      counters.STEP += 1;
      const draftStepId = `STEP-${pad(counters.STEP)}`;
      stepIds.push(draftStepId);
      workflowSteps.push({
        stepId: draftStepId,
        queryId: spec.queryId,
        stepType: 'DRAFT',
        sequence: 1,
        assignedUserId: spec.assigneeId,
        status: 'COMPLETED',
        createdAt: spec.createdAt,
        startedAt: spec.createdAt,
        completedAt: spec.createdAt,
      });

      counters.RESP += 1;
      responseVersions.push({
        responseId: `RESP-${pad(counters.RESP)}`,
        queryId: spec.queryId,
        version: 'v1',
        label: 'AI generated',
        content: DRAFT_BODY(spec.subject),
        createdBy: 'AI Draft Assistant',
        createdAt: spec.createdAt,
        aiGenerated: true,
      });
    }

    // Review levels — created as ordinary dynamic steps, same shape the
    // addReviewLevel action produces at runtime.
    const reviewers = spec.reviewers || [];
    let currentStepId = null;

    reviewers.forEach((reviewerId, index) => {
      counters.STEP += 1;
      const stepId = `STEP-${pad(counters.STEP)}`;
      stepIds.push(stepId);

      const isActive = spec.activeReviewIndex === index;
      const done = spec.allReviewsComplete || (spec.activeReviewIndex ?? -1) > index;

      workflowSteps.push({
        stepId,
        queryId: spec.queryId,
        stepType: 'REVIEW',
        sequence: index + 2,
        assignedUserId: reviewerId,
        status: done ? 'COMPLETED' : isActive ? 'IN_PROGRESS' : 'PENDING',
        createdAt: spec.createdAt,
        startedAt: done || isActive ? spec.createdAt : null,
        completedAt: done ? spec.createdAt : null,
      });

      if (isActive) currentStepId = stepId;

      if (done) {
        counters.REV += 1;
        reviews.push({
          reviewId: `REV-${pad(counters.REV)}`,
          queryId: spec.queryId,
          stepId,
          decision: 'APPROVED',
          comment: null,
          reviewerId,
          at: spec.createdAt,
        });
      }
    });

    // Terminal approval step for anything that reached the review chain.
    if (spec.withDraft) {
      counters.STEP += 1;
      const approvalStepId = `STEP-${pad(counters.STEP)}`;
      workflowSteps.push({
        stepId: approvalStepId,
        queryId: spec.queryId,
        stepType: 'FINAL_APPROVAL',
        sequence: 1000,
        assignedUserId: 'USR-0003',
        status: spec.allReviewsComplete ? 'COMPLETED' : 'PENDING',
        createdAt: spec.createdAt,
        startedAt: spec.allReviewsComplete ? spec.createdAt : null,
        completedAt: spec.allReviewsComplete ? spec.createdAt : null,
      });
      if (spec.allReviewsComplete) currentStepId = approvalStepId;
    }

    queries.push(
      makeQuery({
        queryId: spec.queryId,
        workflowId: spec.workflowId,
        subject: spec.subject,
        description: spec.description,
        inquirer: spec.inquirer,
        category: spec.category,
        priority: spec.priority,
        businessStatus: businessStatusFor(spec.workflowState),
        workflowState: spec.workflowState,
        currentAssigneeId: spec.assigneeId || null,
        currentWorkflowStepId: currentStepId,
        createdAt: spec.createdAt,
        updatedAt: spec.createdAt,
        dueDate: spec.dueDate,
        assignmentDecision: spec.assigneeId
          ? { assigneeId: spec.assigneeId, acceptedAiRecommendation: true, decidedAt: spec.createdAt }
          : null,
      }),
    );

    // Minimal audit so every seeded query has a non-empty history.
    counters.AUD += 1;
    auditEvents.push({
      auditId: `AUD-${pad(counters.AUD)}`,
      queryId: spec.queryId,
      event: AUDIT_EVENT.QUERY_RECEIVED,
      actor: 'System',
      at: spec.createdAt,
      details: 'Query received via email and registered in the system.',
    });

    if (spec.closed) {
      counters.AUD += 1;
      auditEvents.push({
        auditId: `AUD-${pad(counters.AUD)}`,
        queryId: spec.queryId,
        event: AUDIT_EVENT.QUERY_CLOSED,
        actor: 'Priya Sharma',
        at: spec.createdAt,
        details: 'Query closed following dispatch.',
      });
    }
  }

  return { queries, workflowSteps, reviews, responseVersions, auditEvents, notifications, counters };
}
