import { mongoose } from '../config/db.js';

const userSchema = new mongoose.Schema(
  {
    userId: { type: String, required: false, unique: true, sparse: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    department: { type: String, required: false, default: '', trim: true },
    designation: { type: String, required: false, default: '', trim: true },
    password: { type: String, required: false },
    role: { type: String, required: true, default: 'Inquirer', index: true },
    divisionId: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);

const User = mongoose.models.User || mongoose.model('User', userSchema);

export { User };
