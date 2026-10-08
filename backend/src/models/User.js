import { mongoose } from '../config/db.js';
import { ROLES, ACCOUNT_STATUS } from '../constants/roles.js';

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
    // Registration review. No defaults: built-in rows seeded by config/db.js carry none of these,
    // and rows registered before review existed have their status worked out from role/active.
    status: { type: String, enum: [...Object.values(ACCOUNT_STATUS), null] },
    reviewedBy: { id: String, name: String, role: String },
    reviewedAt: { type: String },
    rejectionReason: { type: String, maxlength: 500 },
    deactivatedAt: { type: String },
    lastLoginAt: { type: String },
    // Assigned Officials only: lowercase subject phrases the Recommendation Engine matches
    // queries against, in the same form as config/officialsMetadata.js.
    expertise: { type: [String], default: undefined },
    // Set when an administrator resets the password; sessions issued before it are refused.
    credentialsChangedAt: { type: String },
    createdAt: { type: String, default: () => new Date().toISOString() },
  },
  { versionKey: false },
);

const User = mongoose.models.User || mongoose.model('User', userSchema);

export { User };
