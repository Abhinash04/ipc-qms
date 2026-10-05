import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => true,
}));

vi.mock('../models/AuditEvent.js', async () => {
  const { memoryDb } = await import('./support/memoryDb.js');
  return { AuditEvent: memoryDb.model('AuditEventChain', { unique: ['seq'] }) };
});

import env from '../config/env.js';
import * as audit from '../services/audit/auditService.js';
import { AuditEvent } from '../models/AuditEvent.js';
import { memoryDb } from './support/memoryDb.js';
import { AUDIT_ACTIONS } from '../constants/auditActions.js';
import {
  GENESIS_HASH,
  canonicalJSON,
  computeHash,
  verifyRows,
} from '../services/audit/auditChain.js';

const rows = async () => AuditEvent.find({}).sort({ seq: 1 }).lean();

async function recordMany(n) {
  for (let i = 1; i <= n; i += 1) {
    await audit.record({ action: AUDIT_ACTIONS.EMAIL_SENT, messageId: `MSG-${i}`, details: { i } });
  }
}

beforeEach(() => {
  memoryDb.reset?.();
  audit.resetBuffer();
});

describe('canonical form and keyed hash', () => {
  it('serialises the same record identically whatever the key order', () => {
    expect(canonicalJSON({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(
      canonicalJSON({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }),
    );
  });

  it('changes the hash when any covered field changes', () => {
    const row = { seq: 1, prevHash: GENESIS_HASH, action: 'EMAIL_SENT', details: { to: 'a@b' } };
    expect(computeHash(row)).not.toBe(computeHash({ ...row, details: { to: 'x@b' } }));
    expect(computeHash(row)).not.toBe(computeHash({ ...row, seq: 2 }));
  });

  it('depends on the secret, so the chain cannot be rebuilt without it', () => {
    const row = { seq: 1, prevHash: GENESIS_HASH, action: 'EMAIL_SENT' };
    expect(computeHash(row, 'a'.repeat(32))).not.toBe(computeHash(row, 'b'.repeat(32)));
  });
});

describe('appending to the chain', () => {
  it('numbers events 1, 2, 3 … and links each to the one before', async () => {
    await recordMany(3);
    const chain = await rows();

    expect(chain.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(chain[0].prevHash).toBe(GENESIS_HASH);
    expect(chain[1].prevHash).toBe(chain[0].hash);
    expect(chain[2].prevHash).toBe(chain[1].hash);
  });

  it('keeps a gap-free order when many events are recorded at once', async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => audit.record({ action: AUDIT_ACTIONS.EMAIL_SENT, details: { i } })),
    );

    expect((await rows()).map((row) => row.seq)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect((await audit.verifyChain()).ok).toBe(true);
  });

  it('retries when another writer takes the same position, instead of forking', async () => {
    await recordMany(1);
    const original = AuditEvent.create;
    let raced = false;
    AuditEvent.create = vi.fn(async (doc) => {
      if (!raced) {
        raced = true;
        // Another backend claims seq 2 between our head read and our insert.
        const rival = { action: 'EMAIL_RECEIVED', timestamp: new Date().toISOString(), seq: 2, prevHash: doc.prevHash };
        await original.call(AuditEvent, { ...rival, hash: computeHash(rival) });
      }
      return original.call(AuditEvent, doc);
    });

    try {
      const event = await audit.record({ action: AUDIT_ACTIONS.EMAIL_SENT, messageId: 'MINE' });
      expect(event.seq).toBe(3);
    } finally {
      AuditEvent.create = original;
    }

    expect((await audit.verifyChain()).ok).toBe(true);
  });

  it('keeps an event it cannot store, without advancing the chain', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = AuditEvent.create;
    AuditEvent.create = vi.fn().mockRejectedValue(new Error('connection lost'));

    try {
      const event = await audit.record({ action: AUDIT_ACTIONS.EMAIL_SENT });
      expect(event).toMatchObject({ persisted: false, seq: null });
    } finally {
      AuditEvent.create = original;
      spy.mockRestore();
    }

    const report = await audit.verifyChain();
    expect(report.ok).toBe(true);
    expect(report.unpersisted).toBe(1);
  });
});

describe('verification finds every kind of tampering', () => {
  it('passes an untouched chain', async () => {
    await recordMany(5);
    const report = await audit.verifyChain();

    expect(report).toMatchObject({ ok: true, checked: 5, firstBreak: null, head: { seq: 5 } });
  });

  it('pinpoints an edited row', async () => {
    await recordMany(5);
    await AuditEvent.updateOne({ seq: 3 }, { $set: { details: { i: 999 } } });

    const report = await audit.verifyChain();
    expect(report.ok).toBe(false);
    expect(report.firstBreak).toMatchObject({ seq: 3, reason: 'hash' });
  });

  it('pinpoints a deleted row as a gap', async () => {
    await recordMany(5);
    await AuditEvent.deleteOne({ seq: 2 });

    const report = await audit.verifyChain();
    expect(report.firstBreak).toMatchObject({ seq: 2, reason: 'gap' });
  });

  it('notices rows deleted from the start of the chain', async () => {
    await recordMany(3);
    await AuditEvent.deleteOne({ seq: 1 });

    expect((await audit.verifyChain()).firstBreak).toMatchObject({ seq: 1, reason: 'gap' });
  });

  it('catches two rows swapped into each other’s places', async () => {
    await recordMany(4);
    const [second, third] = (await rows()).slice(1, 3);
    const swap = (from, to) => ({ ...from, seq: to.seq });
    await AuditEvent.deleteOne({ seq: 2 });
    await AuditEvent.deleteOne({ seq: 3 });
    await AuditEvent.create(swap(third, second));
    await AuditEvent.create(swap(second, third));

    const report = await audit.verifyChain();
    expect(report.ok).toBe(false);
    expect(report.firstBreak.seq).toBe(2);
  });

  it('catches a row whose hash was recomputed without the secret', async () => {
    await recordMany(3);
    const [, second] = await rows();
    const forged = { ...second, details: { i: 'forged' } };
    forged.hash = computeHash(forged, 'someone-elses-key-that-is-32-chars!!');
    await AuditEvent.deleteOne({ seq: 2 });
    await AuditEvent.create(forged);

    expect((await audit.verifyChain()).firstBreak).toMatchObject({ seq: 2, reason: 'hash' });
  });

  it('counts pre-chain rows as legacy rather than as breaks', async () => {
    await AuditEvent.create({ action: 'LOGIN_SUCCEEDED', timestamp: '2026-01-01T00:00:00.000Z' });
    await recordMany(2);

    expect(await audit.verifyChain()).toMatchObject({ ok: true, checked: 2, legacy: 1 });
  });
});

describe('verifyRows in batches', () => {
  it('carries state across batches exactly as one pass would', async () => {
    await recordMany(6);
    const all = await rows();

    const whole = verifyRows(all);
    const split = verifyRows(all.slice(3), verifyRows(all.slice(0, 3)));
    expect(split).toEqual(whole);
  });
});

describe('the secret', () => {
  let saved;
  beforeEach(() => {
    saved = env.AUDIT_HMAC_SECRET;
  });
  afterEach(() => {
    env.AUDIT_HMAC_SECRET = saved;
  });

  it('refuses to chain without one, keeping the event unpersisted', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    env.AUDIT_HMAC_SECRET = '';
    const event = await audit.record({ action: AUDIT_ACTIONS.EMAIL_SENT });
    spy.mockRestore();

    expect(event.persisted).toBe(false);
  });
});
