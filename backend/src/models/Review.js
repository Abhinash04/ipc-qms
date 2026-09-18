import { mongoose } from '../config/db.js';

const reviewSchema = new mongoose.Schema(
  {
    reviewId: { type: String, required: true, unique: true, index: true },
    queryId: { type: String, required: true, index: true },

    /**
     * The review step this decision belongs to — null when there is none.
     *
     * The Officer-in-Charge can return a draft for revision from the *final
     * approval* stage, where no review level is open. That review is real and
     * must be stored; declaring `stepId` required rejected it, and because the
     * whole delta is one request it took the case update and the audit event
     * down with it. See `returnForRevisionFromApproval` in the workflow store.
     */
    stepId: { type: String, default: null, index: true },

    /** Null for a decision no person made — the field records who, not that. */
    reviewerId: { type: String, default: null },

    decision: { type: String, required: true },

    /**
     * The reviewer's words, and the draft they were written about.
     *
     * This field was `comments`; the client has always written `comment`, and
     * all four places that display it read `comment`. The plural was therefore
     * never populated and never read — every reviewer comment was silently
     * dropped by the persist validator, which is why the stored reviews on this
     * deployment all read `comments: ""`. Singular here matches the writer.
     *
     * `responseId` and `version` pin the comment to the draft it judged, so it
     * stays meaningful once later revisions supersede that text.
     */
    comment: { type: String, default: '' },
    responseId: { type: String, default: null },
    version: { type: String, default: null },

    at: { type: String, default: () => new Date().toISOString() },
  },
  { versionKey: false },
);

const Review = mongoose.models.Review || mongoose.model('Review', reviewSchema);

export { Review };
