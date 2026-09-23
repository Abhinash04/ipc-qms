import { mongoose } from '../config/db.js';

const reviewSchema = new mongoose.Schema(
  {
    reviewId: { type: String, required: true, unique: true, index: true },
    queryId: { type: String, required: true, index: true },
    stepId: { type: String, default: null, index: true },
    reviewerId: { type: String, default: null },
    decision: { type: String, required: true },
    comment: { type: String, default: '' },
    responseId: { type: String, default: null },
    version: { type: String, default: null },

    at: { type: String, default: () => new Date().toISOString() },
  },
  { versionKey: false },
);

reviewSchema.index({ reviewerId: 1 });

const Review = mongoose.models.Review || mongoose.model('Review', reviewSchema);

export { Review };
