import { mongoose } from '../config/db.js';

const notificationSchema = new mongoose.Schema(
  {
    notificationId: { type: String, required: true, unique: true, index: true },
    queryId: { type: String, default: null, index: true },
    recipientRole: { type: String, default: null, index: true },
    recipientUserId: { type: String, default: null, index: true },
    title: { type: String, required: true },
    message: { type: String, default: '' },
    type: { type: String, default: 'INFO' },
    read: { type: Boolean, default: false },
    at: { type: String, default: () => new Date().toISOString() },
  },
  { versionKey: false },
);

const Notification =
  mongoose.models.Notification || mongoose.model('Notification', notificationSchema);

export { Notification };
