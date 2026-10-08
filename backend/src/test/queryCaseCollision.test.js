import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => true,
}));

vi.mock('../models/QueryCase.js', async () => ({
  QueryCase: (await import('./support/memoryDb.js')).memoryDb.model('QueryCase', { unique: ['queryId'] }),
}));

import { memoryDb } from './support/memoryDb.js';
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

const persist = (query, baseRevision) =>
  request(app)
    .post('/api/v1/queries/persist')
    .set(authHeader(ROLES.FRONT_OFFICE))
    .send({ query, baseRevision });

const storedCases = () => memoryDb.rows('QueryCase');

beforeEach(() => {
  memoryDb.reset();
});

describe('/api/v1/queries/persist — one id, one case', () => {
  it('stores a case it has not seen before', async () => {
    const res = await persist(CASE);

    expect(res.status).toBe(200);
    expect(storedCases()).toHaveLength(1);
    expect(storedCases()[0].subject).toBe('Dissolution profile clarification');
  });

  it('updates the case it already holds', async () => {
    await persist(CASE);

    const res = await persist({ ...CASE, workflowState: 'PENDING_ASSIGNMENT' }, 1);

    expect(res.status).toBe(200);
    expect(storedCases()).toHaveLength(1);
    expect(storedCases()[0].workflowState).toBe('PENDING_ASSIGNMENT');
  });

  it('refuses to overwrite a different case that shares the id', async () => {
    await persist(CASE);

    const other = {
      ...CASE,
      subject: 'Endotoxin limits',
      inquirer: { id: null, name: 'Priya Nair', email: 'priya@lab.example' },
      createdAt: '2026-09-17T11:30:00.000Z',
    };

    const res = await persist(other, 1);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'ID_COLLISION', queryId: 'QRY-2026-00003' });

    expect(storedCases()).toHaveLength(1);
    expect(storedCases()[0].subject).toBe('Dissolution profile clarification');
    expect(storedCases()[0].inquirer.email).toBe('ravi@pharma.example');
  });

  it('allows the write when there is no createdAt to compare', async () => {
    await persist({ ...CASE, createdAt: undefined });

    const res = await persist({ ...CASE, workflowState: 'PENDING_ASSIGNMENT' }, 1);

    expect(res.status).toBe(200);
    expect(storedCases()[0].workflowState).toBe('PENDING_ASSIGNMENT');
  });
});
