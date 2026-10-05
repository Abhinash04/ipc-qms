import { BellRing, CalendarDays, CircleHelp, Copy, FileCheck2, FileQuestionMark, Megaphone } from 'lucide-react';

export const MAIL_CATEGORIES = Object.freeze({
  OFFICIAL_QUERY: 'OFFICIAL_QUERY',
  EVENT_INVITATION: 'EVENT_INVITATION',
  SYSTEM_NOTIFICATION: 'SYSTEM_NOTIFICATION',
  ADVERTISEMENT: 'ADVERTISEMENT',
  DUPLICATE: 'DUPLICATE',
  OTHER: 'OTHER',
});

export const UNCLASSIFIED = 'UNCLASSIFIED';

export const REGISTERED = 'REGISTERED';

// The mailbox's top-level views (backend constants/mailCategories.js).
export const MAIL_BUCKETS = Object.freeze({
  ALL: 'all',
  AUTO_REPLY: 'auto_reply',
  HUMAN: 'human',
});

export const MAIL_BUCKET_META = Object.freeze({
  [MAIL_BUCKETS.ALL]: { label: 'All Mails', description: 'All categories and incoming mails' },
  [MAIL_BUCKETS.AUTO_REPLY]: { label: 'Auto Reply', description: 'General queries with AI draft replies' },
  [MAIL_BUCKETS.HUMAN]: { label: 'Human Intervention', description: 'Queries requiring manual processing' },
});

// What became of a mail's automatic reply (backend services/autoReply/assess.js).
export const AUTO_REPLY_STATUS = Object.freeze({
  SUGGESTED: 'SUGGESTED',
  NOT_ELIGIBLE: 'NOT_ELIGIBLE',
  APPROVING: 'APPROVING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  DECLINED: 'DECLINED',
});

export const REGISTERED_META = Object.freeze({
  label: 'Registered Queries',
  tab: 'Registered queries',
  icon: FileCheck2,
  tone: 'blue',
  description: 'Accepted, with a Query ID',
});

export const MAIL_CATEGORY_META = Object.freeze({
  [MAIL_CATEGORIES.OFFICIAL_QUERY]: {
    label: 'Official Queries',
    short: 'Official query',
    tab: 'Official queries',
    icon: FileQuestionMark,
    variant: 'status-green',
    tone: 'green',
    description: 'Queries, RTIs and official notices',
  },
  [MAIL_CATEGORIES.EVENT_INVITATION]: {
    label: 'Events and Invitations',
    short: 'Event',
    tab: 'Events',
    icon: CalendarDays,
    variant: 'status-amber',
    tone: 'amber',
    description: 'Conferences and invitations',
  },
  [MAIL_CATEGORIES.SYSTEM_NOTIFICATION]: {
    label: 'System Notifications',
    short: 'System',
    tab: 'System',
    icon: BellRing,
    variant: 'status-purple',
    tone: 'purple',
    description: 'Alerts, bounces and auto-replies',
  },
  [MAIL_CATEGORIES.ADVERTISEMENT]: {
    label: 'Advertisements and Promotions',
    short: 'Advertisement',
    tab: 'Advertisements',
    icon: Megaphone,
    variant: 'status-red',
    tone: 'red',
    description: 'Promotions and unsolicited offers',
  },
  [MAIL_CATEGORIES.DUPLICATE]: {
    label: 'Duplicate or Similar Emails',
    short: 'Duplicate',
    tab: 'Duplicates',
    icon: Copy,
    variant: 'status-indigo',
    tone: 'indigo',
    description: 'Repeats of an earlier email',
  },
  [MAIL_CATEGORIES.OTHER]: {
    label: 'Other / Unclassified',
    short: 'Other',
    tab: 'Other',
    icon: CircleHelp,
    variant: 'status-gray',
    tone: 'gray',
    description: 'Fits no other category',
  },
});

export const CATEGORY_SOURCE_LABEL = Object.freeze({
  gemma: 'AI (Gemma)',
  rules: 'Mail rules',
  history: 'Mail history',
  fallback: 'Keyword fallback — AI unavailable',
  human: 'Corrected by the Front Office',
});

export const RELATION_KINDS = Object.freeze({
  EXACT_DUPLICATE: 'EXACT_DUPLICATE',
  FOLLOW_UP: 'FOLLOW_UP',
  SAME_SENDER_SIMILAR: 'SAME_SENDER_SIMILAR',
  RESEMBLES_CASE: 'RESEMBLES_CASE',
});

export const RELATION_LABEL = Object.freeze({
  [RELATION_KINDS.EXACT_DUPLICATE]: 'Identical to an earlier email',
  [RELATION_KINDS.FOLLOW_UP]: 'Follow-up on',
  [RELATION_KINDS.SAME_SENDER_SIMILAR]: 'Similar to an earlier email',
  [RELATION_KINDS.RESEMBLES_CASE]: 'Resembles',
});

export const CATEGORY_ORDER = Object.freeze(Object.values(MAIL_CATEGORIES));
