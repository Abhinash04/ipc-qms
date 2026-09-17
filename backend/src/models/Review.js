import { mongoose } from '../config/db.js';

const reviewSchema = new mongoose.Schema(
  {
    reviewId: { type: String, required: true, unique: true, index: true },
    queryId: { type: String, required: true, index: true },
    stepId: { type: String, required: true, index: true },
    reviewerId: { type: String, required: true },
    decision: { type: String, required: true },
    comments: { type: String, default: '' },
    at: { type: String, default: () => new Date().toISOString() },
  },
  { versionKey: false },
);

const Review = mongoose.models.Review || mongoose.model('Review', reviewSchema);

export { Review };
