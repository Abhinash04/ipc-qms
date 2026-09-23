import {
  LogIn,
  ShieldOff,
  Mail,
  MailOpen,
  Send,
  Forward,
  Trash2,
  Bot,
  Paperclip,
  Download,
  RefreshCw,
  Activity,
} from 'lucide-react';

const EXACT = {
  LOGIN_SUCCEEDED: { icon: LogIn, tint: 'bg-emerald-100 text-emerald-700' },
  LOGIN_FAILED: { icon: LogIn, tint: 'bg-rose-100 text-rose-700' },
  AUTHENTICATION_FAILED: { icon: ShieldOff, tint: 'bg-rose-100 text-rose-700' },
  AUTHORIZATION_DENIED: { icon: ShieldOff, tint: 'bg-amber-100 text-amber-700' },

  EMAIL_RECEIVED: { icon: Mail, tint: 'bg-blue-100 text-blue-700' },
  EMAIL_READ: { icon: MailOpen, tint: 'bg-slate-100 text-slate-600' },
  EMAIL_SENT: { icon: Send, tint: 'bg-emerald-100 text-emerald-700' },
  EMAIL_REPLIED: { icon: Send, tint: 'bg-emerald-100 text-emerald-700' },
  EMAIL_FORWARDED: { icon: Forward, tint: 'bg-indigo-100 text-indigo-700' },
  EMAIL_SEND_FAILED: { icon: Send, tint: 'bg-rose-100 text-rose-700' },
  EMAIL_DELETED: { icon: Trash2, tint: 'bg-slate-100 text-slate-600' },

  ATTACHMENT_UPLOADED: { icon: Paperclip, tint: 'bg-teal-100 text-teal-700' },
  ATTACHMENT_DOWNLOADED: { icon: Download, tint: 'bg-teal-100 text-teal-700' },
};

const PREFIX = [
  ['AI_', { icon: Bot, tint: 'bg-violet-100 text-violet-700' }],
  ['SYNC_', { icon: RefreshCw, tint: 'bg-slate-100 text-slate-600' }],
  ['EMAIL_', { icon: Mail, tint: 'bg-blue-100 text-blue-700' }],
  ['DRAFT_', { icon: Send, tint: 'bg-indigo-100 text-indigo-700' }],
  ['CASE_', { icon: Activity, tint: 'bg-blue-100 text-blue-700' }],
];

const FALLBACK = { icon: Activity, tint: 'bg-slate-100 text-slate-600' };

export function actionVisual(action) {
  const key = String(action || '');
  if (EXACT[key]) return EXACT[key];

  const matched = PREFIX.find(([prefix]) => key.startsWith(prefix));
  return matched ? matched[1] : FALLBACK;
}
