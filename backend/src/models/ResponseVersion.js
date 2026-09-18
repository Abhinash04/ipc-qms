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

    /**
     * `status` is the final-approval lock, not a label.
     *
     * `saveDraftVersion` refuses to edit a case that holds a version marked
     * FINAL_APPROVED. That check reads this field — and the field was not
     * declared here or in the persist validator, so it was stripped on every
     * write. The lock therefore held only until the tab was reloaded, after
     * which an approved response could be edited again.
     *
     * `source` and `aiGenerated` record provenance: whether a version came from
     * the model, an officer's edit, or a revision after review.
     */
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
