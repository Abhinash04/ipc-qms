import { describe, it, expect } from 'vitest';
import { deriveStatus, MAIL_STATUS } from '../services/email/mailbox/messageView.js';

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
