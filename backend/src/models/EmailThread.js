import { mongoose } from '../config/db.js';

const emailThreadSchema = new mongoose.Schema(
  {
    threadId: { type: String, required: true, unique: true, index: true },
    queryId: { type: String, default: null, index: true },
    createdAt: { type: String, default: () => new Date().toISOString() },
  },
  { versionKey: false },
);

const EmailThread =
  mongoose.models.EmailThread || mongoose.model('EmailThread', emailThreadSchema);

export { EmailThread };
