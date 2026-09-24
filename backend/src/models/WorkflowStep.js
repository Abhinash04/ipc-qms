import { mongoose } from '../config/db.js';

const workflowStepSchema = new mongoose.Schema(
  {
    stepId: { type: String, required: true, unique: true, index: true },
    queryId: { type: String, required: true, index: true },
    stepType: { type: String, required: true },
    sequence: { type: Number, required: true },
    assignedUserId: { type: String, default: null },
    status: { type: String, default: 'PENDING', index: true },
    createdAt: { type: String, default: () => new Date().toISOString() },
    startedAt: { type: String, default: null },
    completedAt: { type: String, default: null },
  },
  { versionKey: false },
);

workflowStepSchema.index({ queryId: 1, sequence: 1 });
workflowStepSchema.index({ assignedUserId: 1 });

const WorkflowStep =
  mongoose.models.WorkflowStep || mongoose.model('WorkflowStep', workflowStepSchema);

export { WorkflowStep };
