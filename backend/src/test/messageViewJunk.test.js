import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import env from '../config/env.js';
import { deriveStatus, MAIL_STATUS, purgesAtFor } from '../services/email/mailbox/messageView.js';

/**
 * Where the machine's verdict becomes something the Front Office can see.
 *
 * The precedence is the point: a person's decision always outranks the
 * machine's verdict, and a message nobody has classified is exactly as it was
 * before this feature existed.
 */

const junk = { verdict: 'JUNK', rescuedAt: null };

describe('a human decision always outranks the machine', () => {
  it('shows ACCEPTED over JUNK', () => {
    expect(deriveStatus({ decision: { decision: 'ACCEPTED' }, triage: junk })).toBe(MAIL_STATUS.ACCEPTED);
  });

  it('shows ACCEPTED for a message that became a case, whatever the verdict', () => {
    expect(deriveStatus({ linkedCase: { queryId: 'QRY-2026-00001' }, triage: junk })).toBe(MAIL_STATUS.ACCEPTED);
  });

  it('shows REJECTED over JUNK', () => {
    expect(deriveStatus({ decision: { decision: 'REJECTED' }, triage: junk })).toBe(MAIL_STATUS.REJECTED);
  });
});

describe('the junk verdict', () => {
  it('outranks READ and NEW', () => {
    expect(deriveStatus({ isRead: true, triage: junk })).toBe(MAIL_STATUS.JUNK);
    expect(deriveStatus({ isRead: false, triage: junk })).toBe(MAIL_STATUS.JUNK);
  });

  it('disappears the moment a person rescues the message', () => {
    const rescued = { verdict: 'JUNK', rescuedAt: '2026-09-23T10:00:00.000Z' };
    expect(deriveStatus({ isRead: false, triage: rescued })).toBe(MAIL_STATUS.NEW);
  });

  it('is not applied to a genuine verdict', () => {
    expect(deriveStatus({ isRead: false, triage: { verdict: 'GENUINE' } })).toBe(MAIL_STATUS.NEW);
  });
});

describe('a message with no verdict at all', () => {
  it('keeps exactly the status it had before this feature existed', () => {
    // Every row written before triage shipped has no verdict. This is the
    // backward-compatibility contract, and no backfill is required for it.
    expect(deriveStatus({ isRead: true, triage: null })).toBe(MAIL_STATUS.READ);
    expect(deriveStatus({ isRead: false, triage: null })).toBe(MAIL_STATUS.NEW);
    expect(deriveStatus({ isRead: false })).toBe(MAIL_STATUS.NEW);
  });
});

describe('the purge countdown the inbox shows', () => {
  const ORIGINAL = {
    hours: env.MAILBOX_RETENTION_HOURS,
    unregistered: env.MAILBOX_UNREGISTERED_RETENTION_HOURS,
    floor: env.MAILBOX_JUNK_CONFIDENCE,
  };

  beforeEach(() => {
    env.MAILBOX_RETENTION_HOURS = 42;
    env.MAILBOX_UNREGISTERED_RETENTION_HOURS = 336;
    env.MAILBOX_JUNK_CONFIDENCE = 0.9;
  });
  afterEach(() => {
    env.MAILBOX_RETENTION_HOURS = ORIGINAL.hours;
    env.MAILBOX_UNREGISTERED_RETENTION_HOURS = ORIGINAL.unregistered;
    env.MAILBOX_JUNK_CONFIDENCE = ORIGINAL.floor;
  });

  const at = '2026-09-01T00:00:00.000Z';

  it('puts confident junk on the short window', () => {
    expect(purgesAtFor({ verdict: 'JUNK', confidence: 1, classifiedAt: at, rescuedAt: null })).toBe(
      '2026-09-02T18:00:00.000Z',
    );
  });

  it('puts a genuine message on the long one, because that is the tier that will take it', () => {
    // The countdown has to match whichever filter would actually reach the row,
    // or the inbox promises a message is safe when it is not.
    expect(purgesAtFor({ verdict: 'GENUINE', confidence: 0, classifiedAt: at, rescuedAt: null })).toBe(
      '2026-09-15T00:00:00.000Z',
    );
  });

  it('puts unconfident junk on the long window too, since the junk tier cannot reach it', () => {
    expect(purgesAtFor({ verdict: 'JUNK', confidence: 0, classifiedAt: at, rescuedAt: null })).toBe(
      '2026-09-15T00:00:00.000Z',
    );
  });

  it('shows nothing once a person has rescued the message', () => {
    expect(purgesAtFor({ verdict: 'JUNK', confidence: 1, classifiedAt: at, rescuedAt: at })).toBeNull();
  });

  it('shows nothing for a row that has no verdict at all', () => {
    expect(purgesAtFor(null)).toBeNull();
  });

  it('shows nothing rather than an Invalid Date when the timestamp is unusable', () => {
    expect(purgesAtFor({ verdict: 'JUNK', confidence: 1, classifiedAt: 'not a date', rescuedAt: null })).toBeNull();
    expect(purgesAtFor({ verdict: 'JUNK', confidence: 1, classifiedAt: null, rescuedAt: null })).toBeNull();
  });

  it('tracks the configured windows rather than hard-coding them', () => {
    env.MAILBOX_RETENTION_HOURS = 1;
    expect(purgesAtFor({ verdict: 'JUNK', confidence: 1, classifiedAt: at, rescuedAt: null })).toBe(
      '2026-09-01T01:00:00.000Z',
    );
  });
});
