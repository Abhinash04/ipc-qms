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
  },
  { versionKey: false },
);

const QueryCase = mongoose.models.QueryCase || mongoose.model('QueryCase', queryCaseSchema);

export { QueryCase };
