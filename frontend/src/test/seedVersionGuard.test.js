import { describe, it, expect, beforeEach } from 'vitest';

import {
  db,
  replaceAll,
  readSeedVersion,
  isEmpty,
  SEED_VERSION_KEY,
  COUNTER_KEY,
} from '@/services/db/db';
import { buildSeedState, SEED_VERSION } from '@/constants/mockDomain';

/**
 * Browsers are only seeded when their store is empty, so a seed change would
 * otherwise never reach anyone who had already opened the app — they keep
 * serving cases that no longer exist, which surfaces as dashboard counts that
 * match nothing. The version stamp is what makes a stale database detectable.
 */
describe('seed version guard', () => {
  beforeEach(async () => {
    await replaceAll(buildSeedState());
  });

  it('stamps the current seed version on a wholesale write', async () => {
    expect(await readSeedVersion()).toBe(SEED_VERSION);
  });

  it('reports a database written before versioning as stale', async () => {
    // Exactly the shape a pre-18-Aug browser is in: cases present, no stamp.
    await db.meta.delete(SEED_VERSION_KEY);

    expect(await readSeedVersion()).toBeNull();
    expect(await readSeedVersion()).not.toBe(SEED_VERSION);
  });

  it('reports a database written by an older seed as stale', async () => {
    await db.meta.put({ key: SEED_VERSION_KEY, value: SEED_VERSION - 1 });

    expect(await readSeedVersion()).not.toBe(SEED_VERSION);
  });

  it('re-stamps once the stale database is replaced', async () => {
    await db.meta.delete(SEED_VERSION_KEY);
    await replaceAll(buildSeedState());

    expect(await readSeedVersion()).toBe(SEED_VERSION);
  });

  it('keeps the counters entry alongside the version stamp', async () => {
    const counters = (await db.meta.get(COUNTER_KEY))?.value;

    expect(counters).toEqual(buildSeedState().counters);
    expect(await readSeedVersion()).toBe(SEED_VERSION);
  });

  it('leaves a freshly seeded database empty of cases', async () => {
    // The seed ships no queries: cases arrive through mailbox ingestion, so a
    // correct dashboard starts at zero rather than at a demo figure.
    expect(await isEmpty()).toBe(true);
  });
});
