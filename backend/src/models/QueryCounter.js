import { mongoose } from '../config/db.js';

const queryCounterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { versionKey: false, minimize: false },
);

const QueryCounter =
  mongoose.models.QueryCounter || mongoose.model('QueryCounter', queryCounterSchema);

export { QueryCounter };
