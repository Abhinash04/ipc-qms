import { describe, it, expect } from 'vitest';
import { AuditEvent } from '../models/AuditEvent.js';

// The hooks run before any query reaches MongoDB, so no database is needed:
// every mutating operation must be refused outright.
describe('the audit model is append-only', () => {
  it.each([
    ['updateOne', () => AuditEvent.updateOne({ seq: 1 }, { $set: { action: 'X' } })],
    ['updateMany', () => AuditEvent.updateMany({}, { $set: { action: 'X' } })],
    ['findOneAndUpdate', () => AuditEvent.findOneAndUpdate({ seq: 1 }, { $set: { action: 'X' } })],
    ['replaceOne', () => AuditEvent.replaceOne({ seq: 1 }, { action: 'X' })],
    ['findOneAndReplace', () => AuditEvent.findOneAndReplace({ seq: 1 }, { action: 'X' })],
    ['deleteOne', () => AuditEvent.deleteOne({ seq: 1 })],
    ['deleteMany', () => AuditEvent.deleteMany({})],
    ['findOneAndDelete', () => AuditEvent.findOneAndDelete({ seq: 1 })],
  ])('refuses %s', async (_name, operation) => {
    await expect(operation().exec()).rejects.toThrow(/append-only/);
  });

  it('refuses bulkWrite, which could carry updates or deletes', async () => {
    await expect(AuditEvent.bulkWrite([{ deleteMany: { filter: {} } }])).rejects.toThrow(/append-only/);
  });

  it('declares a unique index on the chain position that skips legacy rows', () => {
    const [, options] = AuditEvent.schema.indexes().find(([fields]) => fields.seq === 1);
    expect(options).toMatchObject({ unique: true, partialFilterExpression: { seq: { $type: 'number' } } });
  });
});
