export const MAIL_CATEGORIES = Object.freeze({
  OFFICIAL_QUERY: 'OFFICIAL_QUERY',
  EVENT_INVITATION: 'EVENT_INVITATION',
  SYSTEM_NOTIFICATION: 'SYSTEM_NOTIFICATION',
  ADVERTISEMENT: 'ADVERTISEMENT',
  DUPLICATE: 'DUPLICATE',
  OTHER: 'OTHER',
});

export const MAIL_CATEGORY_INFO = Object.freeze({
  [MAIL_CATEGORIES.OFFICIAL_QUERY]: {
    label: 'Official Queries',
    prompt:
      'a genuine query, request, complaint, RTI, tender or official notice from a person or body that needs action or attention from IPC',
  },
  [MAIL_CATEGORIES.EVENT_INVITATION]: {
    label: 'Events and Invitations',
    prompt: 'a conference, seminar, workshop, webinar, meeting, event or invitation',
  },
  [MAIL_CATEGORIES.SYSTEM_NOTIFICATION]: {
    label: 'System Notifications',
    prompt:
      'an automated message: a sign-in or security alert, a delivery failure, an out-of-office reply, an account or subscription notice',
  },
  [MAIL_CATEGORIES.ADVERTISEMENT]: {
    label: 'Advertisements and Promotions',
    prompt: 'marketing, a promotion, a newsletter nobody at IPC asked for, or an unsolicited advertisement',
  },
  [MAIL_CATEGORIES.DUPLICATE]: {
    label: 'Duplicate or Similar Emails',
    prompt:
      'it only repeats, re-sends or chases an earlier email listed under RELATED HISTORY, without new questions or new information',
  },
  [MAIL_CATEGORIES.OTHER]: {
    label: 'Other / Unclassified',
    prompt: 'none of the above clearly fits',
  },
});

export const GENUINE_CATEGORIES = Object.freeze([
  MAIL_CATEGORIES.OFFICIAL_QUERY,
  MAIL_CATEGORIES.EVENT_INVITATION,
  MAIL_CATEGORIES.DUPLICATE,
]);

export const CATEGORY_SOURCES = Object.freeze({
  RULES: 'rules',
  HISTORY: 'history',
  GEMMA: 'gemma',
  FALLBACK: 'fallback',
  HUMAN: 'human',
});

export const RELATION_KINDS = Object.freeze({
  EXACT_DUPLICATE: 'EXACT_DUPLICATE',
  FOLLOW_UP: 'FOLLOW_UP',
  SAME_SENDER_SIMILAR: 'SAME_SENDER_SIMILAR',
  RESEMBLES_CASE: 'RESEMBLES_CASE',
});

export const UNCLASSIFIED = 'UNCLASSIFIED';

export const REGISTERED = 'REGISTERED';

export const CATEGORY_VERSION = 1;

export const CATEGORY_CONFIDENCE_FLOOR = 0.6;

export const isMailCategory = (value) => Object.values(MAIL_CATEGORIES).includes(value);
