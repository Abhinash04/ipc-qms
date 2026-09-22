import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

/**
 * Two tabs, one Case ID.
 *
 * Every case write on /queries/persist is an upsert keyed on `queryId`, so the
 * unique index on that field can never fire: a second case carrying an id that
 * already exists does not collide, it *replaces* the stored one and the first
 * enquiry is gone without a trace. The email path no longer mints client-side,
 * but the portal still does, and two browsers hydrated at the same counter mint
 * the same number.
 *
 * `createdAt` is what tells the two apart — an update to a case carries the one
 * it was created with, a collision carries its own. The rest of the suite runs
 * with DATABASE_URL blank and answers 503 before reaching a model, so this file
 * stands the models in and reports the connection as up. `vi.mock` is hoisted
 * above the imports so the stand-in is in place before anything captures it.
 */

const db = vi.hoisted(() => {
  const rows = [];

  const matching = (filter) =>
    rows.filter((row) => Object.entries(filter).every(([key, value]) => row[key] === value));

  const found = (filter) => {
    const doc = matching(filter)[0];
    return doc ? { ...doc } : null;
  };

  return {
    rows,
    reset: () => rows.splice(0),
    QueryCase: {
      // `.select()` is part of the contract here, not decoration: the guard
      // reads only `createdAt`, and a stand-in without it would pass a test the
      // real driver fails.
      findOne: (filter) => ({
        select: () => ({ lean: async () => found(filter) }),
        lean: async () => found(filter),
      }),
      findOneAndUpdate: async (filter, update, options = {}) => {
        let doc = matching(filter)[0];
        if (!doc) {
          if (!options.upsert) return null;
          doc = { ...filter };
          rows.push(doc);
        }
        Object.assign(doc, update.$set ?? {});
        return { ...doc };
      },
    },
  };
});

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => true,
}));

vi.mock('../models/QueryCase.js', () => ({ QueryCase: db.QueryCase }));

import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';

const CASE = {
  queryId: 'QRY-2026-00003',
  subject: 'Dissolution profile clarification',
  inquirer: { id: null, name: 'Ravi Kumar', email: 'ravi@pharma.example' },
  workflowState: 'PENDING_ASSIGNMENT',
  businessStatus: 'OPEN',
  createdAt: '2026-09-17T09:00:00.000Z',
  updatedAt: '2026-09-17T09:00:00.000Z',
};

/**
 * Posted as the Front Office, which is the role that drives intake. Note the
 * states used below are ones that role may actually set: since
 * middleware/authorizeCaseDelta.js landed, a delta naming a state the caller's
 * role holds no action for is refused with 403 before the collision guard runs.
 */
const persist = (query) =>
  request(app)
    .post('/api/v1/queries/persist')
    .set(authHeader(ROLES.FRONT_OFFICE))
    .send({ query });

beforeEach(() => {
  db.reset();
});

describe('/api/v1/queries/persist — one id, one case', () => {
  it('stores a case it has not seen before', async () => {
    const res = await persist(CASE);

    expect(res.status).toBe(200);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].subject).toBe('Dissolution profile clarification');
  });

  it('updates the case it already holds', async () => {
    await persist(CASE);

    const res = await persist({ ...CASE, workflowState: 'PENDING_ASSIGNMENT' });

    expect(res.status).toBe(200);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].workflowState).toBe('PENDING_ASSIGNMENT');
  });

  /** The one that matters: a different enquiry arriving under the same id. */
  it('refuses to overwrite a different case that shares the id', async () => {
    await persist(CASE);

    const other = {
      ...CASE,
      subject: 'Endotoxin limits',
      inquirer: { id: null, name: 'Priya Nair', email: 'priya@lab.example' },
      createdAt: '2026-09-17T11:30:00.000Z',
    };

    const res = await persist(other);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ queryId: 'QRY-2026-00003' });

    // The stored case is untouched — that is the whole point. Before the guard
    // this read back as Priya's enquiry and Ravi's was unrecoverable.
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].subject).toBe('Dissolution profile clarification');
    expect(db.rows[0].inquirer.email).toBe('ravi@pharma.example');
  });

  /**
   * A case stored before the guard existed has no `createdAt` to compare, and a
   * client that omits it is not evidence of a collision. Refusing those would
   * block ordinary writes to prove a point.
   */
  it('allows the write when there is no createdAt to compare', async () => {
    await persist({ ...CASE, createdAt: undefined });

    const res = await persist({ ...CASE, workflowState: 'PENDING_ASSIGNMENT' });

    expect(res.status).toBe(200);
    expect(db.rows[0].workflowState).toBe('PENDING_ASSIGNMENT');
  });
});
