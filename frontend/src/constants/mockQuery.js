import { BUSINESS_STATUS, WORKFLOW_STATE, PRIORITY, AUDIT_EVENT } from './statusEnums';

/**
 * Primary dummy query used consistently across the SRS and the mock UI.
 * Workflow steps are a dynamic array (see docs/architecture/workflow-engine.md)
 * — never fixed review1/review2/review3 fields — so any number of review
 * levels can be represented without changing this shape.
 */
export const MOCK_QUERY = {
  queryId: 'QRY-2026-00427',
  subject: 'Clarification regarding eligibility criteria for Government Training Programme',
  description:
    'Inquirer is seeking clarification on the eligibility criteria for the upcoming Government Training Programme, specifically around minimum qualifying experience and documentation requirements.',
  source: 'Email',
  inquirer: { id: 'USR-0001', name: 'Rajesh Kumar', email: 'rajesh.kumar@example.com' },
  category: 'Training & Development',
  priority: PRIORITY.NORMAL,
  businessStatus: BUSINESS_STATUS.IN_PROGRESS,
  workflowState: WORKFLOW_STATE.UNDER_REVIEW,
  currentAssignee: { id: 'USR-0004', name: 'Neha Singh' },
  currentWorkflowStepId: 'STEP-002',
  attachments: [
    { id: 'ATT-001', name: 'training-programme-notice.pdf', sizeKb: 240 },
  ],
  createdAt: '2026-08-10T09:15:00.000Z',
  updatedAt: '2026-08-14T11:40:00.000Z',
  dueDate: '2026-08-20T00:00:00.000Z',

  /** WorkflowStep[] — dynamic, ordered by `sequence`. */
  workflowSteps: [
    {
      stepId: 'STEP-000',
      queryId: 'QRY-2026-00427',
      stepType: 'DRAFT',
      sequence: 1,
      assignedUser: { id: 'USR-0004', name: 'Neha Singh' },
      status: 'COMPLETED',
      createdAt: '2026-08-11T10:00:00.000Z',
      startedAt: '2026-08-11T10:00:00.000Z',
      completedAt: '2026-08-11T15:30:00.000Z',
    },
    {
      stepId: 'STEP-001',
      queryId: 'QRY-2026-00427',
      stepType: 'REVIEW',
      sequence: 2,
      assignedUser: { id: 'USR-0005', name: 'Amit Mehta' },
      status: 'COMPLETED',
      createdAt: '2026-08-11T15:30:00.000Z',
      startedAt: '2026-08-12T09:00:00.000Z',
      completedAt: '2026-08-12T16:00:00.000Z',
    },
    {
      stepId: 'STEP-002',
      queryId: 'QRY-2026-00427',
      stepType: 'REVIEW',
      sequence: 3,
      assignedUser: { id: 'USR-0006', name: 'Kavita Rao' },
      status: 'IN_PROGRESS',
      createdAt: '2026-08-12T16:00:00.000Z',
      startedAt: '2026-08-14T09:00:00.000Z',
      completedAt: null,
    },
    {
      stepId: 'STEP-003',
      queryId: 'QRY-2026-00427',
      stepType: 'FINAL_APPROVAL',
      sequence: 4,
      assignedUser: { id: 'USR-0003', name: 'Anil Verma' },
      status: 'PENDING',
      createdAt: '2026-08-12T16:00:00.000Z',
      startedAt: null,
      completedAt: null,
    },
  ],

  /** Response versions, preserved per docs/srs/07-ai-requirements.md. */
  responseVersions: [
    { version: 'v1', label: 'AI generated', createdAt: '2026-08-11T10:30:00.000Z', createdBy: 'AI Draft Assistant' },
    { version: 'v2', label: 'Officer revision', createdAt: '2026-08-11T15:30:00.000Z', createdBy: 'Neha Singh' },
    { version: 'v3', label: 'Reviewer requested revision', createdAt: '2026-08-12T16:00:00.000Z', createdBy: 'Neha Singh' },
  ],
  currentDraft:
    'Dear Mr. Kumar,\n\nThank you for your query regarding the eligibility criteria for the Government Training Programme...\n\n[Draft content — v3, pending final approval]',

  auditHistory: [
    { event: AUDIT_EVENT.QUERY_RECEIVED, actor: 'System', at: '2026-08-10T09:15:00.000Z' },
    { event: AUDIT_EVENT.QUERY_REGISTERED, actor: 'Priya Sharma', at: '2026-08-10T09:20:00.000Z' },
    { event: AUDIT_EVENT.QUERY_FORWARDED, actor: 'Priya Sharma', at: '2026-08-10T09:25:00.000Z' },
    { event: AUDIT_EVENT.QUERY_ASSIGNED, actor: 'Anil Verma', at: '2026-08-10T14:00:00.000Z' },
    { event: AUDIT_EVENT.DRAFT_GENERATED, actor: 'AI Draft Assistant', at: '2026-08-11T10:30:00.000Z' },
    { event: AUDIT_EVENT.DRAFT_UPDATED, actor: 'Neha Singh', at: '2026-08-11T15:30:00.000Z' },
    { event: AUDIT_EVENT.REVIEW_ADDED, actor: 'Neha Singh', at: '2026-08-11T15:30:00.000Z' },
    { event: AUDIT_EVENT.REVIEW_COMPLETED, actor: 'Amit Mehta', at: '2026-08-12T16:00:00.000Z' },
    { event: AUDIT_EVENT.DRAFT_UPDATED, actor: 'Neha Singh', at: '2026-08-12T16:00:00.000Z' },
  ],
};
