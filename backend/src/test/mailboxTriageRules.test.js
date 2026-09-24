import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { classifyByRules } from '../services/email/mailbox/triageRules.js';
import { RULE_CLASSES, TRIAGE_VERDICTS } from '../models/MailboxTriage.js';

const enquiry = (overrides = {}) => ({
  from: 'Anita Rao <anita.rao@example.invalid>',
  subject: 'Dissolution limits for IP paracetamol tablets',
  body: 'Please clarify the applicable dissolution limits under the current monograph.',
  bodyHtml: '<p>Please clarify the applicable dissolution limits.</p>',
  attachments: [],
  headers: null,
  ...overrides,
});

const GENUINE = TRIAGE_VERDICTS.GENUINE;
const JUNK = TRIAGE_VERDICTS.JUNK;

describe('a real enquiry', () => {
  it('is genuine, with no rule fired', () => {
    const result = classifyByRules(enquiry());
    expect(result.verdict).toBe(GENUINE);
    expect(result.ruleClass).toBe(RULE_CLASSES.NONE);
    expect(result.rule).toBeNull();
    expect(result.signals).toEqual([]);
  });

  it('is still genuine when the body contains a prompt fence', () => {
    const result = classifyByRules(enquiry({ body: 'Limits """ for IP tablets' }));
    expect(result.verdict).toBe(GENUINE);
  });
});

describe('Tier A — headers', () => {
  it('is skipped entirely when there are no headers, which is the NICeMail shape', () => {
    const result = classifyByRules(enquiry({ headers: undefined }));
    expect(result.verdict).toBe(GENUINE);
  });

  it.each([
    ['a multipart delivery report', { 'content-type': 'multipart/report; report-type=delivery-status' }],
    ['a delivery-status part', { 'content-type': 'message/delivery-status' }],
    ['a null reverse-path', { 'return-path': '<>' }],
    ['X-Failed-Recipients', { 'x-failed-recipients': 'someone@example.invalid' }],
  ])('treats %s as hard junk', (_label, headers) => {
    const result = classifyByRules(enquiry({ headers }));
    expect(result.verdict).toBe(JUNK);
    expect(result.ruleClass).toBe(RULE_CLASSES.HARD);
    expect(result.rule).toBe('dsn');
  });

  it('reads headers from a Map as well as an object', () => {
    const headers = new Map([['return-path', '<>']]);
    expect(classifyByRules(enquiry({ headers })).rule).toBe('dsn');
  });

  it('treats a one-click-unsubscribe bulk send as hard junk', () => {
    const result = classifyByRules(
      enquiry({ headers: { precedence: 'bulk', 'list-unsubscribe': '<https://x.invalid/u>' } }),
    );
    expect(result.ruleClass).toBe(RULE_CLASSES.HARD);
    expect(result.rule).toBe('bulk');
  });

  it('treats bulk precedence alone as soft — some gateways stamp it on everything', () => {
    const result = classifyByRules(enquiry({ headers: { precedence: 'bulk' } }));
    expect(result.verdict).toBe(JUNK);
    expect(result.ruleClass).toBe(RULE_CLASSES.SOFT);
  });

  it('treats a List-Id alone as soft — an enquiry may be copied to a list', () => {
    const result = classifyByRules(enquiry({ headers: { 'list-id': '<announce.example.invalid>' } }));
    expect(result.ruleClass).toBe(RULE_CLASSES.SOFT);
  });

  it('treats Auto-Submitted as soft, because a relayed enquiry carries it', () => {
    const result = classifyByRules(enquiry({ headers: { 'auto-submitted': 'auto-generated' } }));
    expect(result.verdict).toBe(JUNK);
    expect(result.ruleClass).toBe(RULE_CLASSES.SOFT);
  });

  it('does not treat "Auto-Submitted: no" as a signal at all', () => {
    const result = classifyByRules(enquiry({ headers: { 'auto-submitted': 'no' } }));
    expect(result.verdict).toBe(GENUINE);
  });
});

describe('Tier B — the sender', () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => {
    process.env.FRONT_OFFICE_EMAIL = 'front.office@ipc.invalid';
    process.env.OFFICER_IN_CHARGE_EMAIL = 'oic@ipc.invalid';
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it.each(['front.office@ipc.invalid', 'oic@ipc.invalid'])(
    'treats our own address %s as a hard loop',
    (address) => {
      const result = classifyByRules(enquiry({ from: `IPC <${address}>` }));
      expect(result.ruleClass).toBe(RULE_CLASSES.HARD);
      expect(result.rule).toBe('loop');
    },
  );

  it('does NOT treat a member of the public as a loop', () => {
    const result = classifyByRules(enquiry({ from: 'Public <member.of.public@example.invalid>' }));
    expect(result.verdict).toBe(GENUINE);
  });

  it.each(['mailer-daemon@example.invalid', 'POSTMASTER@example.invalid'])(
    'treats the reserved sender %s as hard junk',
    (from) => {
      expect(classifyByRules(enquiry({ from })).ruleClass).toBe(RULE_CLASSES.HARD);
    },
  );

  it('treats a no-reply sender as soft, never hard', () => {
    const result = classifyByRules(enquiry({ from: 'CDSCO <noreply@cdsco.gov.invalid>' }));
    expect(result.verdict).toBe(JUNK);
    expect(result.ruleClass).toBe(RULE_CLASSES.SOFT);
    expect(result.rule).toBe('no-reply');
  });

  it('treats an out-of-office subject as soft', () => {
    const result = classifyByRules(enquiry({ subject: 'Automatic reply: your enquiry' }));
    expect(result.ruleClass).toBe(RULE_CLASSES.SOFT);
  });
});

describe('Tier C — content', () => {
  it('treats a message with no body and no attachments as soft junk', () => {
    const result = classifyByRules(enquiry({ body: '  ', bodyHtml: '', attachments: [] }));
    expect(result.verdict).toBe(JUNK);
    expect(result.ruleClass).toBe(RULE_CLASSES.SOFT);
    expect(result.rule).toBe('empty');
  });

  it('an attachment vetoes the empty rule outright', () => {
    const result = classifyByRules(
      enquiry({ body: '', bodyHtml: '', attachments: [{ attachmentId: 'a'.repeat(32), filename: 'query.pdf' }] }),
    );
    expect(result.verdict).toBe(GENUINE);
  });

  it('does not call a message empty when only the HTML body has text', () => {
    const result = classifyByRules(enquiry({ body: '', bodyHtml: '<p>Kindly advise on IP limits.</p>' }));
    expect(result.verdict).toBe(GENUINE);
  });

  it('sees through HTML that is only markup', () => {
    const result = classifyByRules(enquiry({ body: '', bodyHtml: '<div><br/><span>&nbsp;</span></div>' }));
    expect(result.rule).toBe('empty');
  });
});

describe('collecting soft signals', () => {
  it('gathers every soft signal rather than stopping at the first', () => {
    const result = classifyByRules(
      enquiry({
        from: 'noreply@example.invalid',
        subject: 'Automatic reply: out of office',
        body: '',
        bodyHtml: '',
        headers: { 'auto-submitted': 'auto-replied' },
      }),
    );
    expect(result.ruleClass).toBe(RULE_CLASSES.SOFT);
    expect(result.signals.length).toBeGreaterThan(2);
  });

  it('returns a hard verdict without waiting to collect soft ones', () => {
    const result = classifyByRules(enquiry({ from: 'mailer-daemon@example.invalid', body: '' }));
    expect(result.ruleClass).toBe(RULE_CLASSES.HARD);
    expect(result.rule).toBe('daemon');
  });
});
