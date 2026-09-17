import { mongoose } from '../config/db.js';
import { ROLES } from '../constants/roles.js';

const userSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    role: { type: String, required: true, enum: Object.values(ROLES), index: true },
    divisionId: { type: String, default: null },
    active: { type: Boolean, default: true },
    createdAt: { type: String, default: () => new Date().toISOString() },
  },
  { versionKey: false },
);

const User = mongoose.models.User || mongoose.model('User', userSchema);

export { User };
