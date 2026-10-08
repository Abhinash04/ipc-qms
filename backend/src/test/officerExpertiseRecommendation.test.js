import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const db = vi.hoisted(() => ({ connected: true }));

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => db.connected,
}));
vi.mock('../models/User.js', async () => ({
  User: (await import('./support/memoryDb.js')).memoryDb.model('User', { unique: ['userId', 'email'] }),
}));
vi.mock('../models/AuditEvent.js', async () => ({
  AuditEvent: (await import('./support/memoryDb.js')).memoryDb.model('AuditEvent'),
}));
vi.mock('../models/QueryCase.js', async () => ({
  QueryCase: (await import('./support/memoryDb.js')).memoryDb.model('QueryCase', { unique: ['queryId'] }),
}));

import app from '../app.js';
import env from '../config/env.js';
import { User } from '../models/User.js';
import { QueryCase } from '../models/QueryCase.js';
import { ROLES, ACCOUNT_STATUS } from '../constants/roles.js';
import { WORKFLOW_STATE } from '../constants/workflowStates.js';
import { assignableDirectory } from '../services/ai/officialDirectory.js';
import { nextRecommendedOfficial } from '../services/query/autoTransferScheduler.js';
import { authHeader } from './helpers/auth.js';

const ADMIN = authHeader(ROLES.ADMIN);
const OIC = authHeader(ROLES.OFFICER_IN_CHARGE);
const ARJUN = 'USR-0011'; // built-in Microbiology official: sterility, endotoxin, …
const PASSWORD = 'SecurePassword123';

// Names no division, so only expertise decides; both Arjun and an officer with "Microbiology" match it.
const sterilityQuery = {
  subject: 'Sterility test acceptance criteria',
  body: 'Please clarify the endotoxin limits applicable to this injection.',
  summaryText: '',
};
const unrelatedQuery = { subject: 'Request for office furniture procurement', body: 'Chairs and desks.', summaryText: '' };

let serial = 0;
async function signUpOfficer(expertise) {
  serial += 1;
  const email = `officer${serial}@ipc.example`;
  const res = await request(app).post('/api/v1/auth/register').send({
    name: `New Officer ${serial}`,
    email,
    department: 'Analytical & Quality Control',
    designation: 'Assigned Official',
    expertise,
    password: PASSWORD,
    confirmPassword: PASSWORD,
  });
  expect(res.status).toBe(201);
  return (await User.findOne({ email }).lean()).userId;
}

const approve = (userId, body = {}) =>
  request(app)
    .post(`/api/v1/admin/users/${userId}/approve`)
    .set(ADMIN)
    .send({ role: ROLES.ASSIGNED_OFFICIAL, divisionId: 'DIV-007', ...body });
const recommend = (query) => request(app).post('/api/v1/ai/recommend').set(OIC).send(query);
const officials = () => request(app).get('/api/v1/ai/officials').set(OIC);
const recommendedIds = async (query) => (await recommend(query)).body.recommendations.map((rec) => rec.userId);
const officialIds = async () => (await officials()).body.officials.map((official) => official.id);

async function holdOpenCases(userId, count) {
  for (let i = 0; i < count; i += 1) {
    await QueryCase.create({
      queryId: `IPC-${userId}-${i}`,
      currentAssigneeId: userId,
      workflowState: WORKFLOW_STATE.ASSIGNED,
    });
  }
}

beforeEach(async () => {
  db.connected = true;
  await Promise.all([QueryCase.deleteMany({}), User.deleteMany({})]);
});

describe('an officer who signs up with expertise', () => {
  it('is not recommended while pending, and is recommended by that expertise once approved', async () => {
    const userId = await signUpOfficer(['Microbiology']);

    expect(await recommendedIds(sterilityQuery)).not.toContain(userId);
    expect(await officialIds()).not.toContain(userId);

    // The administrator keeps the expertise chosen at sign-up and only adds the division.
    expect((await approve(userId)).status).toBe(200);
    expect((await User.findOne({ userId }).lean()).expertise).toEqual(['microbiology']);

    const listed = (await officials()).body.officials.find((official) => official.id === userId);
    expect(listed).toMatchObject({ role: ROLES.ASSIGNED_OFFICIAL, divisionId: 'DIV-007', expertise: ['microbiology'] });

    const recs = (await recommend(sterilityQuery)).body.recommendations;
    const mine = recs.find((rec) => rec.userId === userId);
    expect(mine).toBeDefined();
    expect(mine.matchedKeywords).toEqual(expect.arrayContaining(['sterility', 'endotoxin']));
    expect(mine.weakMatch).toBe(false);
    expect(mine.matchPercent).toBeGreaterThanOrEqual(70);

    // Auto-transfer reads the same directory, so the officer can be handed the case too.
    const next = nextRecommendedOfficial({ ranking: [mine], directory: await assignableDirectory() });
    expect(next.user.id).toBe(userId);
  });

  it('sends an equal match to whichever overlapping officer holds fewer open cases', async () => {
    const userId = await signUpOfficer(['Microbiology']);
    expect((await approve(userId)).status).toBe(200);

    await holdOpenCases(ARJUN, 2);
    let [first, second] = (await recommend(sterilityQuery)).body.recommendations;
    expect(first.matchPercent).toBe(second.matchPercent);
    expect([first.userId, second.userId]).toEqual([userId, ARJUN]);

    await holdOpenCases(userId, 3);
    [first, second] = (await recommend(sterilityQuery)).body.recommendations;
    expect([first.userId, second.userId]).toEqual([ARJUN, userId]);
  });

  it('is never recommended or offered once deactivated', async () => {
    const userId = await signUpOfficer(['Microbiology']);
    expect((await approve(userId)).status).toBe(200);
    expect(await recommendedIds(sterilityQuery)).toContain(userId);

    const res = await request(app).post(`/api/v1/admin/users/${userId}/deactivate`).set(ADMIN).send({});
    expect(res.status).toBe(200);

    expect(await recommendedIds(sterilityQuery)).not.toContain(userId);
    expect(await officialIds()).not.toContain(userId);
    expect((await assignableDirectory()).map((user) => user.id)).not.toContain(userId);
  });

  it('is never recommended once rejected', async () => {
    const userId = await signUpOfficer(['Microbiology']);
    const res = await request(app).post(`/api/v1/admin/users/${userId}/reject`).set(ADMIN).send({ reason: 'Not staff' });
    expect(res.status).toBe(200);
    expect(await recommendedIds(sterilityQuery)).not.toContain(userId);
  });
});

describe('when no officer’s expertise matches', () => {
  it('marks every recommendation weak when no officer’s expertise appears in the query', async () => {
    const recs = (await recommend(unrelatedQuery)).body.recommendations;
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((rec) => rec.weakMatch && rec.matchedKeywords.length === 0)).toBe(true);
  });
});

describe('with the language model answering', () => {
  const originalUrl = env.GEMMA_API_URL;
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    env.GEMMA_API_URL = originalUrl;
  });

  function modelAnswers(recommendations) {
    env.GEMMA_API_URL = 'http://gemma.test.invalid/api';
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ answer: JSON.stringify({ recommendations }) }),
    }));
  }

  it('lists the new officer it picks from the directory it was given, and drops made-up or repeated IDs', async () => {
    const userId = await signUpOfficer(['Microbiology']);
    expect((await approve(userId)).status).toBe(200);
    modelAnswers([
      { userId, matchPercent: 91, reason: 'Microbiology expertise.', matchedKeywords: ['sterility'] },
      { userId: 'USR-ghost', matchPercent: 85, reason: 'Invented.' },
      { userId, matchPercent: 70, reason: 'Repeated.' },
    ]);

    const recs = (await recommend(sterilityQuery)).body.recommendations;

    const prompt = JSON.parse(global.fetch.mock.calls[0][1].body).prompt;
    expect(prompt).toContain(`${userId}: New Officer`);

    expect(recs[0]).toMatchObject({ userId, rank: 1, aiGenerated: true, weakMatch: false });
    expect(recs.map((rec) => rec.userId)).not.toContain('USR-ghost');
    expect(new Set(recs.map((rec) => rec.userId)).size).toBe(recs.length);
    // Topped up from the keyword ranking, so a later auto-transfer still has someone to try.
    expect(recs).toHaveLength(3);
    expect(recs.map((rec) => rec.rank)).toEqual([1, 2, 3]);
  });

  it('keeps an approved officer with no expertise eligible, but never as a strong match', async () => {
    await User.create({
      userId: 'USR-legacy01',
      name: 'Legacy Officer',
      email: 'legacy.officer@ipc.example',
      role: ROLES.ASSIGNED_OFFICIAL,
      status: ACCOUNT_STATUS.APPROVED,
      active: true,
      password: '$2b$10$abcdefghijklmnopqrstuuxyzabcdefghijklmnopqrstuvwxyz12',
    });
    expect(await officialIds()).toContain('USR-legacy01');

    // Even when the model picks them, nothing in the query points to them.
    modelAnswers([{ userId: 'USR-legacy01', matchPercent: 90, reason: 'Available.' }]);
    const [top] = (await recommend(sterilityQuery)).body.recommendations;
    expect(top).toMatchObject({ userId: 'USR-legacy01', weakMatch: true });
  });
});
