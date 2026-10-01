import { mongoose } from '../config/db.js';
import { CATEGORY_SOURCES, MAIL_CATEGORIES, RELATION_KINDS } from '../constants/mailCategories.js';

export const TRIAGE_VERDICTS = { GENUINE: 'GENUINE', JUNK: 'JUNK' };

export const TRIAGE_CLASSIFIERS = {
  RULES: 'rules',
  GEMMA: 'gemma',
  FALLBACK: 'fallback',
  EXHAUSTED: 'exhausted',
  HUMAN: 'human',
};

export const RULE_CLASSES = { NONE: 'none', SOFT: 'soft', HARD: 'hard' };

const mailboxTriageSchema = new mongoose.Schema(
  {
    mailboxMessageId: { type: String, required: true, unique: true, index: true },

    verdict: { type: String, required: true, enum: Object.values(TRIAGE_VERDICTS), index: true },
    confidence: { type: Number, required: true, default: 0, min: 0, max: 1 },
    classifier: { type: String, required: true, enum: Object.values(TRIAGE_CLASSIFIERS) },

    rule: { type: String, default: null },
    ruleClass: { type: String, required: true, default: RULE_CLASSES.NONE, enum: Object.values(RULE_CLASSES) },
    reason: { type: String, default: '' },

    classifiedAt: { type: String, required: true, index: true },

    gemmaAt: { type: String, default: null },
    attempts: { type: Number, default: 0 },

    rescuedAt: { type: String, default: null },
    rescuedByUserId: { type: String, default: null },

    purgedAt: { type: String, default: null },

    source: { type: String, default: null },
    from: { type: String, default: '' },
    subject: { type: String, default: '' },
    receivedAt: { type: String, default: null },

    senderKey: { type: String, default: null },
    contentHash: { type: String, default: null },

    category: { type: String, default: null, enum: [...Object.values(MAIL_CATEGORIES), null] },
    categoryConfidence: { type: Number, default: 0, min: 0, max: 1 },
    categoryReason: { type: String, default: '' },
    categorySource: { type: String, default: null, enum: [...Object.values(CATEGORY_SOURCES), null] },
    categorizedAt: { type: String, default: null },
    categoryVersion: { type: Number, default: 0 },
    predictedCategory: { type: String, default: null, enum: [...Object.values(MAIL_CATEGORIES), null] },
    predictedConfidence: { type: Number, default: 0, min: 0, max: 1 },
    needsReview: { type: Boolean, default: false },
    related: {
      type: [
        {
          _id: false,
          kind: { type: String, enum: Object.values(RELATION_KINDS) },
          mailboxMessageId: { type: String, default: null },
          queryId: { type: String, default: null },
          score: { type: Number, default: null },
        },
      ],
      default: [],
    },
    categoryCorrectedAt: { type: String, default: null },
    categoryCorrectedByUserId: { type: String, default: null },

    createdAt: { type: String, required: true },
  },
  { versionKey: false },
);

mailboxTriageSchema.index({ verdict: 1, purgedAt: 1, rescuedAt: 1, classifiedAt: 1, confidence: -1 });

mailboxTriageSchema.index({ gemmaAt: 1, ruleClass: 1, attempts: 1, classifiedAt: 1 });

mailboxTriageSchema.index({ categorizedAt: 1, categoryVersion: 1 });

mailboxTriageSchema.index({ senderKey: 1, receivedAt: -1 });

mailboxTriageSchema.index({ senderKey: 1, contentHash: 1 });

const MailboxTriage =
  mongoose.models.MailboxTriage || mongoose.model('MailboxTriage', mailboxTriageSchema);

export { MailboxTriage };
