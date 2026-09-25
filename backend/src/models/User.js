import { mongoose } from '../config/db.js';
import { ROLES } from '../constants/roles.js';

const userSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `USR-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    },
    name: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    department: { type: String, default: '' },
    designation: { type: String, default: '' },
    password: { type: String, required: false },
    role: {
      type: String,
      required: true,
      enum: Object.values(ROLES),
      default: ROLES.INQUIRER,
      index: true,
    },
    divisionId: { type: String, default: null },
    active: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    authProvider: {
      type: String,
      enum: ['local', 'google'],
      default: 'local',
    },
    googleId: {
      type: String,
      sparse: true,
      unique: true,
      index: true,
      default: undefined,
    },
    profilePicture: {
      type: String,
      default: '',
    },
    createdAt: { type: String, default: () => new Date().toISOString() },
    updatedAt: { type: String, default: () => new Date().toISOString() },
  },
  { versionKey: false },
);

const User = mongoose.models.User || mongoose.model('User', userSchema);

export { User };

