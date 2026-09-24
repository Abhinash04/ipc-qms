import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import env, { validateEmailConfig } from '../config/env.js';
import {
  purgeCandidateFilter,
  purgeMessageFilter,
  rejectedCandidateFilter,
  unregisteredCandidateFilter,
  classifyCandidateFilter,
  PURGEABLE_SOURCES,
} from '../services/email/mailbox/retention.js';

const NOW = Date.parse('2026-09-23T12:00:00.000Z');

const ORIGINAL = {
  hours: env.MAILBOX_RETENTION_HOURS,
  unregistered: env.MAILBOX_UNREGISTERED_RETENTION_HOURS,
  floor: env.MAILBOX_JUNK_CONFIDENCE,
};

beforeEach(() => {
  env.MAILBOX_RETENTION_HOURS = 46;
  env.MAILBOX_UNREGISTERED_RETENTION_HOURS = 336;
  env.MAILBOX_JUNK_CONFIDENCE = 0.9;
});
afterEach(() => {
  env.MAILBOX_RETENTION_HOURS = ORIGINAL.hours;
  env.MAILBOX_UNREGISTERED_RETENTION_HOURS = ORIGINAL.unregistered;
  env.MAILBOX_JUNK_CONFIDENCE = ORIGINAL.floor;
});

describe('the junk candidate filter', () => {
  it('selects unpurged, unrescued junk past the cutoff', () => {
    expect(purgeCandidateFilter({ now: NOW })).toEqual({
      verdict: 'JUNK',
      purgedAt: null,
      rescuedAt: null,
      classifiedAt: { $lt: '2026-09-21T14:00:00.000Z' },
      confidence: { $gte: 0.9 },
    });
  });

  it('cannot reach a fallback verdict, which is what makes an outage safe', () => {
    const filter = purgeCandidateFilter({ now: NOW });
    expect(filter.verdict).toBe('JUNK');
    expect(filter.confidence.$gte).toBeGreaterThan(0);
  });

  it('honours a floor of exactly 1 as the kill switch for model-driven purging', () => {
    env.MAILBOX_JUNK_CONFIDENCE = 1;
    expect(purgeCandidateFilter({ now: NOW }).confidence.$gte).toBe(1);
  });

  it('stops purging altogether above 1, since a hard rule only scores 1', () => {
    env.MAILBOX_JUNK_CONFIDENCE = 1.01;
    expect(purgeCandidateFilter({ now: NOW }).confidence.$gte).toBeGreaterThan(1);
  });

  it('honours an overridden window', () => {
    expect(purgeCandidateFilter({ now: NOW, retentionHours: 1 }).classifiedAt.$lt).toBe('2026-09-23T11:00:00.000Z');
  });

  it('compares fixed-width ISO strings, so the range query is sound', () => {
    const { $lt } = purgeCandidateFilter({ now: NOW }).classifiedAt;
    expect($lt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('the rejected candidate filter', () => {
  it('selects rejections past the cutoff', () => {
    expect(rejectedCandidateFilter({ now: NOW })).toEqual({
      decision: 'REJECTED',
      decidedAt: { $lt: '2026-09-21T14:00:00.000Z' },
    });
  });
});

describe('the unregistered candidate filter', () => {
  it('selects anything unpurged and unrescued past the long cutoff', () => {
    expect(unregisteredCandidateFilter({ now: NOW })).toEqual({
      purgedAt: null,
      rescuedAt: null,
      classifiedAt: { $lt: '2026-09-09T12:00:00.000Z' },
    });
  });

  it('reaches what the junk tier cannot: no verdict clause and no confidence floor', () => {
    const filter = unregisteredCandidateFilter({ now: NOW });
    expect(filter).not.toHaveProperty('verdict');
    expect(filter).not.toHaveProperty('confidence');
  });

  it('still honours a rescue, which is the one way a person makes a message permanent', () => {
    expect(unregisteredCandidateFilter({ now: NOW }).rescuedAt).toBeNull();
  });

  it('is idempotent through purgedAt, like the junk tier', () => {
    expect(unregisteredCandidateFilter({ now: NOW }).purgedAt).toBeNull();
  });

  it('honours an overridden window', () => {
    expect(unregisteredCandidateFilter({ now: NOW, unregisteredHours: 24 }).classifiedAt).toEqual({
      $lt: '2026-09-22T12:00:00.000Z',
    });
  });

  it('measures first sight, not the message date — the field is classifiedAt', () => {
    const filter = unregisteredCandidateFilter({ now: NOW });
    expect(Object.keys(filter)).toContain('classifiedAt');
    expect(filter).not.toHaveProperty('receivedAt');
  });

  it('opens a strictly later window than the junk tier, so junk always goes first', () => {
    const junk = Date.parse(purgeCandidateFilter({ now: NOW }).classifiedAt.$lt);
    const unregistered = Date.parse(unregisteredCandidateFilter({ now: NOW }).classifiedAt.$lt);
    expect(unregistered).toBeLessThan(junk);
  });
});

describe('the message filter', () => {
  const filter = () => purgeMessageFilter(['NICB-1', 'NICB-2']);

  it('scopes to the purgeable sources by allow-list', () => {
    expect(filter().source).toEqual({ $in: PURGEABLE_SOURCES });
    expect(PURGEABLE_SOURCES).toEqual(['nic-browser']);
  });

  it('is idempotent through purgedAt', () => {
    expect(filter().purgedAt).toBeNull();
  });

  it('does NOT exclude a message somebody has read', () => {
    expect(filter()).not.toHaveProperty('readAt');
  });

  it('does NOT exclude a message somebody deleted', () => {
    expect(filter()).not.toHaveProperty('removedAt');
  });

  it('does NOT use `ingested` as a safety guard', () => {
    expect(filter()).not.toHaveProperty('ingested');
  });
});

describe('the classification candidate filter', () => {
  it('takes only rows the model has not answered for, and has not given up on', () => {
    const filter = classifyCandidateFilter();
    expect(filter.gemmaAt).toBeNull();
    expect(filter.rescuedAt).toBeNull();
    expect(filter.purgedAt).toBeNull();
    expect(filter.attempts.$lt).toBeGreaterThan(0);
  });

  it('never re-asks about a message a hard rule already settled', () => {
    expect(classifyCandidateFilter().ruleClass.$in).toEqual(['none', 'soft']);
  });
});

describe('the retention settings refuse a nonsensical deployment at boot', () => {
  const errorsFor = (overrides) => validateEmailConfig({ ...env, ...overrides }).join('\n');

  it('accepts the shipped defaults', () => {
    expect(validateEmailConfig(env).filter((line) => line.includes('MAILBOX_'))).toEqual([]);
  });

  it.each([
    ['not a number', Number('abc')],
    ['zero', 0],
    ['negative', -1],
  ])('refuses an unregistered window that is %s', (_label, value) => {
    expect(errorsFor({ MAILBOX_UNREGISTERED_RETENTION_HOURS: value })).toMatch(
      /MAILBOX_UNREGISTERED_RETENTION_HOURS must be a positive number of hours/,
    );
  });

  it('refuses a second tier shorter than the first', () => {
    expect(errorsFor({ MAILBOX_RETENTION_HOURS: 42, MAILBOX_UNREGISTERED_RETENTION_HOURS: 24 })).toMatch(
      /must not be shorter than MAILBOX_RETENTION_HOURS/,
    );
  });

  it('allows the two windows to be equal', () => {
    expect(errorsFor({ MAILBOX_RETENTION_HOURS: 42, MAILBOX_UNREGISTERED_RETENTION_HOURS: 42 })).not.toMatch(
      /MAILBOX_UNREGISTERED_RETENTION_HOURS/,
    );
  });

  it('still refuses a nonsensical junk window', () => {
    expect(errorsFor({ MAILBOX_RETENTION_HOURS: 0 })).toMatch(
      /MAILBOX_RETENTION_HOURS must be a positive number of hours/,
    );
  });
});
