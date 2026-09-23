import { mongoose } from '../config/db.js';

const queryCaseSchema = new mongoose.Schema(
  {
    queryId: { type: String, required: true, unique: true, index: true },
    subject: { type: String, required: true },
    description: { type: String, default: '' },
    source: { type: String, default: 'Email' },
    inquirer: { type: Object, default: null },
    category: { type: String, default: null },
    priority: { type: String, default: 'NORMAL', index: true },
    businessStatus: { type: String, default: 'OPEN', index: true },
    workflowState: { type: String, required: true, index: true },
    currentAssigneeId: { type: String, default: null, index: true },
    currentWorkflowStepId: { type: String, default: null },
    attachments: { type: Array, default: [] },
    dueDate: { type: String, default: null },
    createdAt: { type: String, default: () => new Date().toISOString() },
    updatedAt: { type: String, default: () => new Date().toISOString() },
    threadId: { type: String, default: null, index: true },
    sourceEmailId: { type: String, default: null },
    sourceMailboxMessageId: { type: String, default: null },
    sourceMailbox: { type: Object, default: null },
    aiSummary: { type: Object, default: null },
    assignmentDecision: { type: Object, default: null },
    pullbackHistory: { type: Array, default: [] },
  },
  { versionKey: false },
);

queryCaseSchema.index(
  { sourceMailboxMessageId: 1 },
  { unique: true, partialFilterExpression: { sourceMailboxMessageId: { $type: 'string' } } },
);

const QueryCase = mongoose.models.QueryCase || mongoose.model('QueryCase', queryCaseSchema);

export { QueryCase };
