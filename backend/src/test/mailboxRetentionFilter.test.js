import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import env from '../config/env.js';
import {
  purgeCandidateFilter,
  purgeMessageFilter,
  rejectedCandidateFilter,
  classifyCandidateFilter,
  PURGEABLE_SOURCES,
} from '../services/email/mailbox/retention.js';

/**
 * What the sweep asks MongoDB for.
 *
 * The pattern mongoIpcMailbox.test.js established: no database, assert the
 * filter. Several of these assert what the filter does NOT contain, because
 * those absences are deliberate decisions that read like oversights — without a
 * test naming them, the next reader "fixes" them and quietly makes junk
 * immortal.
 */

const NOW = Date.parse('2026-09-23T12:00:00.000Z');

const ORIGINAL = {
  hours: env.MAILBOX_RETENTION_HOURS,
  floor: env.MAILBOX_JUNK_CONFIDENCE,
};

beforeEach(() => {
  env.MAILBOX_RETENTION_HOURS = 46;
  env.MAILBOX_JUNK_CONFIDENCE = 0.9;
});
afterEach(() => {
  env.MAILBOX_RETENTION_HOURS = ORIGINAL.hours;
  env.MAILBOX_JUNK_CONFIDENCE = ORIGINAL.floor;
});

describe('the junk candidate filter', () => {
  it('selects unpurged, unrescued junk past the cutoff', () => {
    expect(purgeCandidateFilter({ now: NOW })).toEqual({
      verdict: 'JUNK',
      purgedAt: null,
      rescuedAt: null,
      // 46 hours before 2026-09-23T12:00Z.
      classifiedAt: { $lt: '2026-09-21T14:00:00.000Z' },
      confidence: { $gte: 0.9 },
    });
  });

  it('cannot reach a fallback verdict, which is what makes an outage safe', () => {
    // Every failure path in classifyMail returns GENUINE at confidence 0. Both
    // clauses exclude it, so a Gemma outage strictly reduces purging and can
    // never cause a wrong one. No code enforces this — the filter does.
    const filter = purgeCandidateFilter({ now: NOW });
    expect(filter.verdict).toBe('JUNK');
    expect(filter.confidence.$gte).toBeGreaterThan(0);
  });

  it('honours a floor of exactly 1 as the kill switch for model-driven purging', () => {
    // The model is clamped to 0.95 and a hard rule scores exactly 1, so a floor
    // of 1 admits the rules and excludes the model. The value is exact.
    env.MAILBOX_JUNK_CONFIDENCE = 1;
    expect(purgeCandidateFilter({ now: NOW }).confidence.$gte).toBe(1);
  });

  it('stops purging altogether above 1, since a hard rule only scores 1', () => {
    // Documented so nobody reaches for 1.01 expecting the rules to survive it.
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

describe('the message filter', () => {
  const filter = () => purgeMessageFilter(['NICB-1', 'NICB-2']);

  it('scopes to the purgeable sources by allow-list', () => {
    // An allow-list, not the inverse of mongoIpcMailbox's `$ne` scope: that
    // store does not filter on removedAt, so tombstoning a 'local' row would
    // leave a body-less message still listed in the development inbox.
    expect(filter().source).toEqual({ $in: PURGEABLE_SOURCES });
    expect(PURGEABLE_SOURCES).toEqual(['nic-browser']);
  });

  it('is idempotent through purgedAt', () => {
    expect(filter().purgedAt).toBeNull();
  });

  it('does NOT exclude a message somebody has read', () => {
    // Reading is not rescuing. An officer who opens junk to confirm it is junk
    // has read it, and guarding on readAt would make the junk she checks most
    // diligently the junk that lives forever.
    expect(filter()).not.toHaveProperty('readAt');
  });

  it('does NOT exclude a message somebody deleted', () => {
    // A deleted message still carries its full body and megabyte-scale HTML.
    // It is the best candidate here, not an excluded one.
    expect(filter()).not.toHaveProperty('removedAt');
  });

  it('does NOT use `ingested` as a safety guard', () => {
    // That field means "swept", and under Gmail it is literally the UNREAD
    // label — far too overloaded to carry a safety guarantee.
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
