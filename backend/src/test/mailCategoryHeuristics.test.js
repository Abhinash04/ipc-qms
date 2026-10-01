import { describe, it, expect } from 'vitest';
import { categoryForRule, heuristicCategory } from '../services/email/mailbox/categoryHeuristics.js';
import { MAIL_CATEGORIES } from '../constants/mailCategories.js';

const guess = (message, options) => heuristicCategory(message, options);

describe('categories decided by the hard triage rules', () => {
  it.each(['dsn', 'daemon', 'loop'])('files a %s rule under System Notifications', (rule) => {
    expect(categoryForRule(rule)).toMatchObject({ category: MAIL_CATEGORIES.SYSTEM_NOTIFICATION });
  });

  it('files a bulk mailing with an unsubscribe header under Advertisements', () => {
    expect(categoryForRule('bulk')).toMatchObject({ category: MAIL_CATEGORIES.ADVERTISEMENT });
  });

  it('has no opinion on a soft rule', () => {
    expect(categoryForRule('no-reply')).toBeNull();
    expect(categoryForRule(null)).toBeNull();
  });
});

describe('the keyword fallback used when Gemma is unavailable', () => {
  it('recognises a genuine pharmacopoeia query', () => {
    const result = guess({
      subject: 'Clarification on dissolution limits of Paracetamol tablets IP 2022',
      body: 'Dear Sir, kindly clarify the dissolution limits in the IP monograph.',
    });
    expect(result.category).toBe(MAIL_CATEGORIES.OFFICIAL_QUERY);
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('recognises an event invitation', () => {
    expect(
      guess({ subject: 'Invitation: National Pharmacopoeia Conference 2026', body: 'You are invited. Register now.' }).category,
    ).toBe(MAIL_CATEGORIES.EVENT_INVITATION);
  });

  it('recognises a calendar invitation by its attachment', () => {
    expect(guess({ subject: 'Meeting', body: '', attachments: [{ filename: 'invite.ics' }] }).category).toBe(
      MAIL_CATEGORIES.EVENT_INVITATION,
    );
  });

  it('recognises a system notification', () => {
    const result = guess({
      subject: 'New sign-in to your NIC account',
      body: 'We noticed a new sign-in. Your verification code is 123456.',
    });
    expect(result.category).toBe(MAIL_CATEGORIES.SYSTEM_NOTIFICATION);
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('counts an automated-sender signal towards a system notification', () => {
    expect(guess({ subject: 'Your mailbox', body: 'Storage is almost full.' }, { signals: ['no-reply sender address'] }).category).toBe(
      MAIL_CATEGORIES.SYSTEM_NOTIFICATION,
    );
  });

  it('recognises an advertisement', () => {
    expect(guess({ subject: 'Mega sale - 40% off lab glassware', body: 'Limited-time offer. Unsubscribe here.' }).category).toBe(
      MAIL_CATEGORIES.ADVERTISEMENT,
    );
  });

  it('files an email with no recognisable signal as Other, with no confidence', () => {
    expect(guess({ subject: 'Hello', body: 'Please see.' })).toEqual({
      category: MAIL_CATEGORIES.OTHER,
      confidence: 0,
      reason: 'no recognisable signal',
    });
  });

  it('refuses to pick between two equally strong categories', () => {
    expect(guess({ subject: 'Webinar newsletter', body: '' })).toMatchObject({ category: MAIL_CATEGORIES.OTHER, confidence: 0 });
  });

  it('never claims more than moderate confidence', () => {
    const result = guess({
      subject: 'Query: monograph, IPRS, impurity, assay, dissolution, specification IP 2022 clarification',
      body: 'kindly clarify',
    });
    expect(result.confidence).toBeLessThanOrEqual(0.7);
  });

  it('leans on how the Front Office filed this sender before', () => {
    expect(guess({ subject: 'Update', body: 'Please see.' }, { history: { senderCorrection: MAIL_CATEGORIES.ADVERTISEMENT } })).toMatchObject({
      category: MAIL_CATEGORIES.ADVERTISEMENT,
    });
    expect(
      guess({ subject: 'Update', body: 'Please see.' }, { history: { senderProfile: { dominant: MAIL_CATEGORIES.SYSTEM_NOTIFICATION } } }),
    ).toMatchObject({ category: MAIL_CATEGORIES.SYSTEM_NOTIFICATION });
  });
});
