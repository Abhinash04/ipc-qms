import { mongoose } from '../config/db.js';
import { ROLES } from '../constants/roles.js';

const userSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    // A self-registered account has no role until an administrator approves it.
    role: { type: String, enum: [...Object.values(ROLES), null], default: null, index: true },
    divisionId: { type: String, default: null },
    active: { type: Boolean, default: true },
    // Self-registration only: what the person asked for, and their bcrypt hash. Built-in
    // accounts keep their passwords in the environment, not here.
    department: { type: String, default: '', trim: true },
    designation: { type: String, default: '', trim: true },
    password: { type: String },
    createdAt: { type: String, default: () => new Date().toISOString() },
  },
  { versionKey: false },
);

const User = mongoose.models.User || mongoose.model('User', userSchema);

export { User };
