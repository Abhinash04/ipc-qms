import { mongoose } from '../config/db.js';

const responseVersionSchema = new mongoose.Schema(
  {
    responseId: { type: String, required: true, unique: true, index: true },
    queryId: { type: String, required: true, index: true },
    version: { type: String, required: true },
    label: { type: String, default: null },
    content: { type: String, default: '' },
    createdBy: { type: String, default: null },
    aiMetadata: { type: Object, default: null },
    createdAt: { type: String, default: () => new Date().toISOString() },
    status: { type: String, default: null },
    source: { type: String, default: null },
    aiGenerated: { type: Boolean, default: false },
    approvedAt: { type: String, default: null },
  },
  { versionKey: false },
);

const ResponseVersion =
  mongoose.models.ResponseVersion || mongoose.model('ResponseVersion', responseVersionSchema);

export { ResponseVersion };
