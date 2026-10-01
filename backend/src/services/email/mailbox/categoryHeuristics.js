import { MAIL_CATEGORIES } from '../../../constants/mailCategories.js';
import { bodyText } from './mailFingerprint.js';

const RULE_CATEGORIES = {
  dsn: { category: MAIL_CATEGORIES.SYSTEM_NOTIFICATION, confidence: 0.95, reason: 'delivery status notification' },
  daemon: { category: MAIL_CATEGORIES.SYSTEM_NOTIFICATION, confidence: 0.95, reason: 'automated mail daemon' },
  loop: { category: MAIL_CATEGORIES.SYSTEM_NOTIFICATION, confidence: 0.95, reason: 'sent by this system' },
  bulk: { category: MAIL_CATEGORIES.ADVERTISEMENT, confidence: 0.8, reason: 'bulk mailing with an unsubscribe header' },
};

export function categoryForRule(rule) {
  return RULE_CATEGORIES[rule] ?? null;
}

const PATTERNS = [
  [
    MAIL_CATEGORIES.EVENT_INVITATION,
    [
      /\binvit(e|es|ed|ation|ations)\b/i,
      /\b(webinar|seminar|conference|workshop|symposium|summit|conclave|convention)s?\b/i,
      /\b(save the date|rsvp|register now|registration (link|form|is open))\b/i,
    ],
  ],
  [
    MAIL_CATEGORIES.ADVERTISEMENT,
    [
      /\bunsubscribe\b/i,
      /\b(newsletter|promotion(al)?|discount|special offer|limited[- ]time|buy now|shop now|flash sale|coupon)s?\b/i,
      /\d+\s?% off\b/i,
    ],
  ],
  [
    MAIL_CATEGORIES.SYSTEM_NOTIFICATION,
    [
      /\b(new sign[- ]?in|sign[- ]?in (alert|attempt)|security alert|unusual (activity|sign[- ]?in))\b/i,
      /\b(verification code|one[- ]time password|otp|password (reset|expir\w*))\b/i,
      /\b(undeliverable|delivery (status|failure|has failed)|mail delivery|out of office|automatic reply|auto[- ]?reply)\b/i,
      /\b(account (activity|notice|update)|storage (is )?(almost )?full|quota)\b/i,
    ],
  ],
  [
    MAIL_CATEGORIES.OFFICIAL_QUERY,
    [
      /\b(monographs?|pharmacopoeia|iprs|reference (standard|substance)s?|impurit(y|ies)|assay|dissolution|specifications?)\b/i,
      /\bIP\s?20\d\d\b/,
      /\b(clarification|query|queries|enquiry|inquiry|kindly (clarify|confirm|advise)|request(ing)? (you|for)|rti|tender)\b/i,
    ],
  ],
];

const SYSTEM_SIGNALS = /no-reply|auto-?responder|out-of-office|auto-submitted|autoreply/i;

const PROFILE_WEIGHT = 2;
const CORRECTION_WEIGHT = 3;

const confidenceFor = (score) => Math.min(0.45 + 0.1 * score, 0.7);

export function heuristicCategory(message = {}, { signals = [], history = null } = {}) {
  const text = `${message.subject || ''}\n${bodyText(message)}`;
  const scores = new Map();
  const why = new Map();
  const add = (category, points, reason) => {
    scores.set(category, (scores.get(category) || 0) + points);
    if (!why.has(category)) why.set(category, reason);
  };

  for (const [category, patterns] of PATTERNS) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) add(category, 1, `mentions "${match[0].trim().toLowerCase()}"`);
    }
  }

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (attachments.some((attachment) => /\.ics$/i.test(attachment?.filename || ''))) {
    add(MAIL_CATEGORIES.EVENT_INVITATION, 2, 'calendar invitation attached');
  }

  for (const signal of signals) {
    if (SYSTEM_SIGNALS.test(signal)) add(MAIL_CATEGORIES.SYSTEM_NOTIFICATION, 1, signal);
  }

  if (history?.senderCorrection) {
    add(history.senderCorrection, CORRECTION_WEIGHT, 'Front Office filed earlier mail from this sender here');
  }
  if (history?.senderProfile?.dominant) {
    add(history.senderProfile.dominant, PROFILE_WEIGHT, 'most earlier mail from this sender is filed here');
  }

  const ranked = [...scores].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) {
    return { category: MAIL_CATEGORIES.OTHER, confidence: 0, reason: 'no recognisable signal' };
  }
  const [[category, score], runnerUp] = ranked;
  if (runnerUp && runnerUp[1] === score) {
    return { category: MAIL_CATEGORIES.OTHER, confidence: 0, reason: 'mixed signals' };
  }
  return { category, confidence: confidenceFor(score), reason: why.get(category) };
}
