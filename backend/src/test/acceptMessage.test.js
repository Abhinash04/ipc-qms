import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

/**
 * Accepting an incoming message: the whole intake sequence in one server call.
 *
 * What this file is really about is the half-finished states. Minting a Case ID
 * and creating a case is local and reliable; acknowledging the sender and
 * forwarding to the Officer-in-Charge both talk to a mail server and both fail
 * independently. The contract is that a failure there costs the step, never the
 * case — so the endpoint answers 200 with the failed step named, and pressing ✓
 * again finishes what did not complete without repeating what did.
 *
 * The rest of the suite runs with DATABASE_URL blank, which answers 503 before
 * anything reaches a model. Persistence is the whole subject here, so the
 * models are replaced with an in-memory stand-in and the connection is reported
 * as up. `vi.mock` is hoisted above the imports, so the stand-in is in place
 * before any module captures its references.
 */

/**
 * A stand-in for the handful of Mongoose operators this path actually uses.
 *
 * `$inc` on a dotted path is not decoration: it is how Case IDs are minted, and
 * a fake that merged the whole `value` object instead would hide exactly the
 * kind of counter bug these tests exist to catch.
 */
const db = vi.hoisted(() => {
  const read = (doc, path) => path.split('.').reduce((node, key) => node?.[key], doc);

  const write = (doc, path, value) => {
    const keys = path.split('.');
    const leaf = keys.pop();
    keys.reduce((node, key) => (node[key] ??= {}), doc)[leaf] = value;
  };

  // Rows are handed out by value, so a caller holding a `.lean()` result cannot
  // mutate the store the way it could not mutate a real collection.
  const clone = (doc) => (doc ? JSON.parse(JSON.stringify(doc)) : null);

  const apply = (doc, update, inserted) => {
    for (const [path, by] of Object.entries(update.$inc ?? {})) {
      write(doc, path, (read(doc, path) ?? 0) + by);
    }
    for (const [path, value] of Object.entries(update.$set ?? {})) write(doc, path, value);
    if (!inserted) return;
    for (const [path, value] of Object.entries(update.$setOnInsert ?? {})) write(doc, path, value);
  };

  const collections = new Map();

  const model = (name) => {
    const rows = [];
    collections.set(name, rows);

    const matching = (filter) =>
      rows.filter((row) =>
        Object.entries(filter).every(([path, value]) => read(row, path) === value),
      );

    const upsert = (filter, update, options) => {
      let doc = matching(filter)[0];
      const inserted = !doc;
      if (inserted) {
        if (!options.upsert) return null;
        doc = { ...filter };
        rows.push(doc);
      }
      apply(doc, update, inserted);
      return doc;
    };

    return {
      create: async (doc) => {
        rows.push(clone(doc));
        return clone(doc);
      },
      findOne: (filter) => ({ lean: async () => clone(matching(filter)[0]) }),
      find: (filter = {}) => ({ lean: async () => matching(filter).map(clone) }),
      updateOne: async (filter, update, options = {}) => {
        upsert(filter, update, options);
        return { acknowledged: true };
      },
      findOneAndUpdate: (filter, update, options = {}) => ({
        lean: async () => clone(upsert(filter, update, options)),
      }),
    };
  };

  return { model, reset: () => collections.forEach((rows) => rows.splice(0)) };
});

// Only `isConnected` is replaced: the real module still registers the mongoose
// connection listeners the rest of the app imports it for.
vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => true,
}));

// Mocked one model file at a time rather than models/index.js, so the real
// barrel keeps re-exporting the models this path does not touch.
vi.mock('../models/QueryCase.js', () => ({ QueryCase: db.model('QueryCase') }));
vi.mock('../models/QueryCounter.js', () => ({ QueryCounter: db.model('QueryCounter') }));
vi.mock('../models/EmailMessage.js', () => ({ EmailMessage: db.model('EmailMessage') }));
vi.mock('../models/EmailThread.js', () => ({ EmailThread: db.model('EmailThread') }));
vi.mock('../models/AuditEvent.js', () => ({ AuditEvent: db.model('AuditEvent') }));
vi.mock('../models/MailboxDecision.js', () => ({
  MailboxDecision: db.model('MailboxDecision'),
  DECISIONS: { ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED' },
}));

import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import * as emailService from '../services/email/emailService.js';
import * as gemmaService from '../services/ai/gemmaService.js';
import {
  QueryCase,
  QueryCounter,
  EmailMessage,
  MailboxDecision,
  AuditEvent,
} from '../models/index.js';

/** The person who actually wrote in — never a configured address. */
const SENDER = 'Ravi Kumar <ravi@pharma.example>';
const SENDER_EMAIL = 'ravi@pharma.example';

/** What `vitest.config.mjs` configures as the seeded inquirer identity. */
const CONFIGURED_INQUIRER = 'inquirer@test.invalid';

const incoming = (overrides = {}) => ({
  from: SENDER,
  to: 'front-office@test.invalid',
  subject: 'Dissolution limits for a modified-release tablet',
  body: 'Please clarify the applicable dissolution limits.',
  receivedAt: '2026-09-17T09:00:00.000Z',
  providerMessageId: 'gmail-msg-ravi-1',
  providerThreadId: 'gmail-thread-ravi-1',
  ...overrides,
});

const accept = (mailboxMessageId, body = incoming(), role = ROLES.FRONT_OFFICE) =>
  request(app)
    .post(`/api/v1/mailbox/messages/${mailboxMessageId}/accept`)
    .set(authHeader(role))
    .send(body);

const messagesOfType = (emailType) => EmailMessage.find({ emailType }).lean();

let ackSpy;
let forwardSpy;

beforeEach(() => {
  db.reset();
  // Spied rather than stubbed: EMAIL_TRANSPORT=mock already keeps real mail out
  // of the suite, and the call counts are themselves part of the contract.
  ackSpy = vi.spyOn(emailService, 'sendAcknowledgement');
  forwardSpy = vi.spyOn(emailService, 'forwardToOfficerInCharge');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /mailbox/messages/:messageId/accept — an unseen message', () => {
  it('registers the case, acknowledges the sender and forwards, in one call', async () => {
    const res = await accept('gmail-msg-ravi-1');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      created: true,
      acknowledged: true,
      forwarded: true,
      errors: [],
    });
    expect(res.body.queryId).toMatch(/^QRY-\d{4}-\d{5}$/);
  });

  it('records the inquirer as whoever wrote in, not a configured address', async () => {
    // The bug this pins: the case used to carry the seeded inquirer identity,
    // so every enquiry looked as though it came from the same person and the
    // reply went to an address that had never asked anything.
    const res = await accept('gmail-msg-ravi-1');
    const stored = await QueryCase.findOne({ queryId: res.body.queryId }).lean();

    expect(stored.inquirer).toMatchObject({ name: 'Ravi Kumar', email: SENDER_EMAIL });
    expect(JSON.stringify(stored)).not.toContain(CONFIGURED_INQUIRER);
  });

  it('leaves the case at PENDING_ASSIGNMENT once the forward is out', async () => {
    const res = await accept('gmail-msg-ravi-1');
    const stored = await QueryCase.findOne({ queryId: res.body.queryId }).lean();

    expect(stored.workflowState).toBe('PENDING_ASSIGNMENT');
  });

  it('keeps a copy of the acknowledgement and of the forward', async () => {
    const res = await accept('gmail-msg-ravi-1');

    const [acknowledgement] = await messagesOfType('ACKNOWLEDGEMENT');
    expect(acknowledgement.queryId).toBe(res.body.queryId);
    expect(acknowledgement.to).toContain(SENDER_EMAIL);

    const [forward] = await messagesOfType('FORWARD');
    expect(forward.queryId).toBe(res.body.queryId);
  });

  it('records the decision that produced the case', async () => {
    const res = await accept('gmail-msg-ravi-1');
    const decision = await MailboxDecision.findOne({
      mailboxMessageId: 'gmail-msg-ravi-1',
    }).lean();

    expect(decision).toMatchObject({ decision: 'ACCEPTED', queryId: res.body.queryId });
  });

  /**
   * The forward has to reach the Officer-in-Charge specifically — "a FORWARD
   * record exists" is not the same claim. This used to be asserted in the
   * browser suite against a stub, which proved only that the stub returned what
   * the stub was told to return.
   */
  it('addresses the forward to the Officer-in-Charge', async () => {
    await accept('gmail-msg-ravi-1');

    const [forward] = await messagesOfType('FORWARD');
    expect(forward.to).toContain('officer@test.invalid');
    // Not back to the person who wrote in.
    expect(forward.to).not.toContain(SENDER_EMAIL);
  });

  /**
   * The audit trail is the record an inspector reads, so its order is part of
   * the contract, not an implementation detail: an acknowledgement logged before
   * the case was registered would describe a sequence that never happened.
   */
  it('writes the intake history in order, attributed to the acting officer', async () => {
    const res = await accept('gmail-msg-ravi-1');

    const history = (await AuditEvent.find({ queryId: res.body.queryId }).lean()).map(
      (event) => event.action,
    );

    expect(history).toEqual([
      'QUERY_RECEIVED',
      'QUERY_REGISTERED',
      /**
       * The summary is generated and stored on the case here, before either
       * email goes out. It used to be produced inside the forward, for the
       * covering note only, and audited from there — which is why this row used
       * to sit between the acknowledgement and the forward. The summary was
       * never written to the case, so every accepted enquiry read
       * `aiSummary: null` while the trail claimed one had been generated.
       *
       * Its position is asserted, not tolerated: it has to land before the
       * forward, because the forward is now handed this summary rather than
       * computing a second one.
       */
      'AI_SUMMARY_GENERATED',
      'ACKNOWLEDGEMENT_SENT',
      'QUERY_FORWARDED',
    ]);

    // Taken from the session, never from the request body — an actor a caller
    // can name is an actor a caller can impersonate.
    const registered = (await AuditEvent.find({ queryId: res.body.queryId }).lean()).find(
      (event) => event.action === 'QUERY_REGISTERED',
    );
    expect(registered.actorRole).toBe(ROLES.FRONT_OFFICE);
    expect(registered.actorId).toBeTruthy();
  });
});

/**
 * The summary the Officer-in-Charge is mailed and the summary stored on the
 * case have to be the same object. They were not: one was computed inside the
 * forward for its covering note, and the case kept `null`.
 */
describe('the AI summary', () => {
  it('is stored on the case, not only mailed', async () => {
    const res = await accept('gmail-msg-ravi-1');

    const stored = await QueryCase.findOne({ queryId: res.body.queryId }).lean();
    expect(stored.aiSummary).toBeTruthy();
    expect(stored.aiSummary.text).toEqual(expect.any(String));
    expect(stored.aiSummary.generatedAt).toEqual(expect.any(String));
  });

  /**
   * `GEMMA_API_URL` is blank across this suite (vitest.config.mjs), so the
   * model is never reached and the deterministic stand-in answers instead. The
   * status has to say so — a fallback presented as the model's work is worse
   * than no summary, because nobody goes looking for it.
   */
  it('says when it is the deterministic fallback rather than the model', async () => {
    const res = await accept('gmail-msg-ravi-1');

    expect(res.body.aiSummaryStatus).toBe('FALLBACK');

    const stored = await QueryCase.findOne({ queryId: res.body.queryId }).lean();
    expect(stored.aiSummary).toMatchObject({ status: 'FALLBACK', fallback: true, aiGenerated: false });
  });

  it('is generated once and handed to the forward, not computed twice', async () => {
    await accept('gmail-msg-ravi-1');

    // The forward receives the stored summary, so it does not make its own
    // call — and the trail holds one AI row, not two.
    expect(forwardSpy).toHaveBeenCalledWith(expect.objectContaining({ aiSummary: expect.any(Object) }));
    expect(
      (await AuditEvent.find({ action: 'AI_SUMMARY_GENERATED' }).lean()).length,
    ).toBe(1);
  });

  /**
   * The user's §9: an AI outage costs the summary, never the enquiry.
   */
  it('keeps the case when generation throws, and records the failure', async () => {
    vi.spyOn(gemmaService, 'generateSummary').mockRejectedValue(new Error('Gemma unreachable'));

    const res = await accept('gmail-msg-ravi-1');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: true, aiSummaryStatus: 'FAILED' });
    expect(res.body.errors).toContainEqual({ step: 'aiSummary', error: 'Gemma unreachable' });

    // The case, its id, the acknowledgement and the forward all survive.
    const stored = await QueryCase.findOne({ queryId: res.body.queryId }).lean();
    expect(stored.workflowState).toBe('PENDING_ASSIGNMENT');
    expect(stored.aiSummary).toMatchObject({ status: 'FAILED', error: 'Gemma unreachable' });
    expect(await messagesOfType('ACKNOWLEDGEMENT')).toHaveLength(1);
    expect(await messagesOfType('FORWARD')).toHaveLength(1);
  });

  it('re-attempts a failed summary on retry, without a second case or email', async () => {
    const failing = vi
      .spyOn(gemmaService, 'generateSummary')
      .mockRejectedValue(new Error('Gemma unreachable'));

    const first = await accept('gmail-msg-ravi-1');
    expect(first.body.aiSummaryStatus).toBe('FAILED');

    failing.mockRestore();

    const second = await accept('gmail-msg-ravi-1');

    expect(second.body.aiSummaryStatus).toBe('FALLBACK');
    const stored = await QueryCase.findOne({ queryId: first.body.queryId }).lean();
    expect(stored.aiSummary.status).toBe('FALLBACK');

    // Nothing else was repeated.
    expect(await QueryCase.find({}).lean()).toHaveLength(1);
    expect(await messagesOfType('ACKNOWLEDGEMENT')).toHaveLength(1);
    expect(await messagesOfType('FORWARD')).toHaveLength(1);
    expect(ackSpy).toHaveBeenCalledTimes(1);
  });

  it('does not re-summarise a case that already has one', async () => {
    await accept('gmail-msg-ravi-1');
    const calls = (await AuditEvent.find({ action: 'AI_SUMMARY_GENERATED' }).lean()).length;

    await accept('gmail-msg-ravi-1');

    expect((await AuditEvent.find({ action: 'AI_SUMMARY_GENERATED' }).lean()).length).toBe(calls);
  });
});

describe('Case ID numbering', () => {
  it('numbers cases sequentially from one, off the server-side counter', async () => {
    // The counter used to live in the browser, so two tabs minted the same id.
    const first = await accept('gmail-msg-ravi-1');
    const second = await accept('gmail-msg-priya-1', incoming({ from: 'Priya <priya@lab.example>' }));

    expect(first.body.queryId).toMatch(/-00001$/);
    expect(second.body.queryId).toMatch(/-00002$/);

    const counter = await QueryCounter.findOne({ key: 'counters' }).lean();
    expect(counter.value.QRY).toBe(2);
  });
});

describe('accepting the same message twice', () => {
  it('answers from the record, without a second case or a second email', async () => {
    const first = await accept('gmail-msg-ravi-1');
    const second = await accept('gmail-msg-ravi-1');

    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      queryId: first.body.queryId,
      created: false,
      alreadyDecided: true,
    });

    expect(await QueryCase.find({}).lean()).toHaveLength(1);
    expect(await messagesOfType('ACKNOWLEDGEMENT')).toHaveLength(1);
    expect(await messagesOfType('FORWARD')).toHaveLength(1);

    // The assertion that matters to the person who wrote in: they were emailed
    // once, and the Officer-in-Charge received the case once.
    expect(ackSpy).toHaveBeenCalledTimes(1);
    expect(forwardSpy).toHaveBeenCalledTimes(1);
  });
});

describe('a step that fails', () => {
  it('still creates and forwards the case when the acknowledgement fails', async () => {
    ackSpy.mockRejectedValue(new Error('SMTP refused the acknowledgement'));

    const res = await accept('gmail-msg-ravi-1');

    // 200, not 500: a case that exists but was not acknowledged is a state an
    // operator can recover from. A 500 would lose the Case ID as well.
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: true, acknowledged: false, forwarded: true });
    expect(res.body.errors).toContainEqual(
      expect.objectContaining({ step: 'acknowledgement' }),
    );

    const stored = await QueryCase.findOne({ queryId: res.body.queryId }).lean();
    expect(stored.workflowState).toBe('PENDING_ASSIGNMENT');
  });

  /**
   * A NICeMail browser send can fail after Send was pressed, when nothing on
   * screen confirms the message left. That is not an ordinary failure — the
   * inquirer may already have it — and the page has to be able to tell, or it
   * offers a retry that emails them twice. So the flag has to survive the trip.
   */
  it('marks an unconfirmed acknowledgement distinctly, and records none', async () => {
    ackSpy.mockRejectedValue(
      Object.assign(new Error('NICeMail may have sent this message but did not confirm it in time.'), {
        unconfirmed: true,
      }),
    );

    const res = await accept('gmail-msg-ravi-1');

    expect(res.status).toBe(200);
    expect(res.body.acknowledged).toBe(false);
    expect(res.body.errors).toContainEqual(
      expect.objectContaining({ step: 'acknowledgement', unconfirmed: true }),
    );
    // Nothing recorded, so nothing claims the inquirer was told.
    expect(await messagesOfType('ACKNOWLEDGEMENT')).toHaveLength(0);
  });

  it('does not mark an ordinary acknowledgement failure as unconfirmed', async () => {
    ackSpy.mockRejectedValue(new Error('SMTP refused the acknowledgement'));

    const res = await accept('gmail-msg-ravi-1');

    const failure = res.body.errors.find((entry) => entry.step === 'acknowledgement');
    expect(failure.unconfirmed).toBeUndefined();
  });

  /**
   * A failed acknowledgement used to leave no trace but the toast the Front
   * Officer saw once. The case page's retry audits its failures, and final
   * approval audits a failed dispatch; accept is where most acknowledgements
   * are sent. For an unconfirmed one this row is the only lasting record that
   * the inquirer may already have it — and it shows in the case's history.
   */
  const sendFailures = async (queryId) =>
    (await AuditEvent.find({ queryId }).lean()).filter((event) => event.action === 'EMAIL_SEND_FAILED');

  it('audits an unconfirmed acknowledgement as possibly sent', async () => {
    ackSpy.mockRejectedValue(
      Object.assign(new Error('NICeMail may have sent this message but did not confirm it in time.'), {
        unconfirmed: true,
      }),
    );

    const res = await accept('gmail-msg-ravi-1');

    const [failure, ...more] = await sendFailures(res.body.queryId);
    expect(more).toHaveLength(0);
    expect(failure).toMatchObject({ result: 'failure', actorRole: ROLES.FRONT_OFFICE });
    expect(failure.details).toMatch(/may have been sent/);
    expect(failure.details).toMatch(/Sent folder/);
  });

  it('audits an ordinary acknowledgement failure as not sent', async () => {
    ackSpy.mockRejectedValue(new Error('SMTP refused the acknowledgement'));

    const res = await accept('gmail-msg-ravi-1');

    const [failure] = await sendFailures(res.body.queryId);
    expect(failure.error).toBe('SMTP refused the acknowledgement');
    expect(failure.details).toMatch(/could not be sent/);
    expect(failure.details).not.toMatch(/may have been sent/);
  });

  it('leaves the case where the manual forward button acts when the forward fails', async () => {
    forwardSpy.mockRejectedValue(new Error('the officer mailbox timed out'));

    const res = await accept('gmail-msg-ravi-1');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: true, acknowledged: true, forwarded: false });
    expect(res.body.errors).toContainEqual(expect.objectContaining({ step: 'forward' }));

    const stored = await QueryCase.findOne({ queryId: res.body.queryId }).lean();
    expect(stored.workflowState).toBe('FRONT_OFFICE_VERIFICATION');
    expect(await messagesOfType('FORWARD')).toHaveLength(0);
  });

  it('finishes the forward on a retry, without acknowledging a second time', async () => {
    forwardSpy.mockRejectedValueOnce(new Error('the officer mailbox timed out'));

    const first = await accept('gmail-msg-ravi-1');
    const second = await accept('gmail-msg-ravi-1');

    expect(second.body).toMatchObject({
      queryId: first.body.queryId,
      created: false,
      forwarded: true,
    });

    const stored = await QueryCase.findOne({ queryId: first.body.queryId }).lean();
    expect(stored.workflowState).toBe('PENDING_ASSIGNMENT');

    // The point of the retry: the step that failed is re-attempted, the step
    // that succeeded is not. The sender does not get a second email.
    expect(ackSpy).toHaveBeenCalledTimes(1);
    expect(await messagesOfType('ACKNOWLEDGEMENT')).toHaveLength(1);
    expect(await messagesOfType('FORWARD')).toHaveLength(1);
  });
});

describe('POST /mailbox/messages/:messageId/accept — authorization', () => {
  it('rejects an unauthenticated caller', async () => {
    const res = await request(app)
      .post('/api/v1/mailbox/messages/gmail-msg-ravi-1/accept')
      .send(incoming());

    expect(res.status).toBe(401);
  });

  it('is refused to every role except Front Office and Super Admin', async () => {
    const denied = [
      ROLES.INQUIRER,
      ROLES.OFFICER_IN_CHARGE,
      ROLES.ASSIGNED_OFFICIAL,
      ROLES.REVIEWER,
      ROLES.ADMIN,
    ];

    for (const role of denied) {
      const res = await accept('gmail-msg-ravi-1', incoming(), role);
      expect(res.status).toBe(403);
    }

    // Nothing reached the mailbox on the way to being refused.
    expect(await QueryCase.find({}).lean()).toHaveLength(0);
  });
});
