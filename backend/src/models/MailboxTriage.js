import { mongoose } from '../config/db.js';

/**
 * The machine's verdict on one incoming message: a genuine enquiry, or junk.
 *
 * Kept apart from `MailboxMessage` for two reasons. The first is the one that
 * makes `MailboxDecision` separate: under MAILBOX_SOURCE=gmail there is no row
 * to update at all. The second is the retention sweep — it runs hourly and must
 * decide what to purge *without reading the rows it may purge*, whose
 * `bodyHtml` runs to 1,000,000 characters. A verdict stored on the message
 * would make every sweep scan the whole mailbox by weight.
 *
 * Kept apart from `MailboxDecision` for a third reason: that model means "a
 * human decided", its first write wins, and it is what `deriveStatus` reads to
 * say ACCEPTED / REJECTED. A machine verdict written there would report a
 * rejection nobody made, and would refuse the officer's later accept as
 * already-decided.
 */

export const TRIAGE_VERDICTS = { GENUINE: 'GENUINE', JUNK: 'JUNK' };

export const TRIAGE_CLASSIFIERS = {
  /** A deterministic rule settled it. */
  RULES: 'rules',
  /** The model settled it. */
  GEMMA: 'gemma',
  /** The model could not be reached or could not be parsed. Never purgeable. */
  FALLBACK: 'fallback',
  /** Asked MAX_TRIAGE_ATTEMPTS times and never answered usefully. Never purgeable. */
  EXHAUSTED: 'exhausted',
  /** A person said "not junk". Terminal. */
  HUMAN: 'human',
};

/**
 * `hard` — terminal, confidence 1, never sent to the model.
 * `soft` — a signal the model is asked to adjudicate.
 * `none` — no rule fired. A total enum rather than a nullable field, so the
 * model-phase query is one index-friendly `$in` instead of a top-level `$or`.
 */
export const RULE_CLASSES = { NONE: 'none', SOFT: 'soft', HARD: 'hard' };

const mailboxTriageSchema = new mongoose.Schema(
  {
    mailboxMessageId: { type: String, required: true, unique: true, index: true },

    verdict: { type: String, required: true, enum: Object.values(TRIAGE_VERDICTS), index: true },
    /** 0..1. A hard rule scores 1; the model is clamped below that. */
    confidence: { type: Number, required: true, default: 0, min: 0, max: 1 },
    classifier: { type: String, required: true, enum: Object.values(TRIAGE_CLASSIFIERS) },

    /** Which deterministic rule fired: 'loop', 'daemon', 'no-reply', 'empty', … */
    rule: { type: String, default: null },
    ruleClass: { type: String, required: true, default: RULE_CLASSES.NONE, enum: Object.values(RULE_CLASSES) },
    reason: { type: String, default: '' },

    /**
     * THE RETENTION CLOCK. An ISO-8601 string, matching every other model in
     * this project — see the note in backend/README.md on why these are not
     * `Date`. ISO-8601 is fixed-width, so `{ $lt: cutoff }` is a correct range
     * query and the index below serves it.
     *
     * Stamped when this service first formed an opinion, and deliberately NOT
     * derived from `receivedAt`: that field holds the *sync* time whenever
     * `receivedAtSource === 'sync'` (MailboxMessage.js), so a message the first
     * sync found three days after it arrived would be born already expired and
     * purged before anyone saw the Junk filter — exactly what the rescue window
     * exists to prevent.
     */
    classifiedAt: { type: String, required: true, index: true },

    /** Set once the model has answered. Null while only the rules have. */
    gemmaAt: { type: String, default: null },
    /** Model attempts spent, so an unparseable message is not asked 46 times. */
    attempts: { type: Number, default: 0 },

    /** A person said "not junk". Terminal: nothing reclassifies or purges after it. */
    rescuedAt: { type: String, default: null },
    rescuedByUserId: { type: String, default: null },

    /**
     * The sweep's watermark, denormalised from MailboxMessage.purgedAt.
     *
     * Not a second truth — the message row is the truth. Without it every
     * hourly pass would re-select every junk row ever classified, so the
     * candidate scan would grow without bound. Written in the same pass.
     */
    purgedAt: { type: String, default: null },

    /**
     * A snapshot, kept for the reason MailboxDecision keeps one: once the body
     * is gone, "what did the system throw away, and who sent it?" must still
     * have an answer.
     */
    source: { type: String, default: null },
    from: { type: String, default: '' },
    subject: { type: String, default: '' },
    receivedAt: { type: String, default: null },

    createdAt: { type: String, required: true },
  },
  { versionKey: false },
);

/**
 * Every index must be declared here. config/db.js runs syncIndexes() on each
 * connect and drops anything it does not find in a schema — including an index
 * added by hand in the Atlas console.
 */

/** The sweep's candidate scan: unpurged, unrescued junk past the cutoff. */
mailboxTriageSchema.index({ verdict: 1, purgedAt: 1, rescuedAt: 1, classifiedAt: 1, confidence: -1 });

/** The model phase: rows the model has not answered yet, oldest first. */
mailboxTriageSchema.index({ gemmaAt: 1, ruleClass: 1, attempts: 1, classifiedAt: 1 });

const MailboxTriage =
  mongoose.models.MailboxTriage || mongoose.model('MailboxTriage', mailboxTriageSchema);

export { MailboxTriage };
