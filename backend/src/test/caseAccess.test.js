import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ROLES } from '../constants/roles.js';

/**
 * The membership authority, in isolation.
 *
 * The suite runs with DATABASE_URL blank, so `isConnected()` is false and every
 * scoped lookup would refuse. Both the connection and the models are stubbed
 * here so the per-role rules can be asserted directly — which is the right
 * level for them anyway: these are pure predicates, and the HTTP layer is
 * covered separately in caseDeltaAuthorization.test.js.
 */

const connected = { value: true };

vi.mock('../config/db.js', () => ({
  isConnected: () => connected.value,
  mongoose: { Schema: class {}, model: () => ({}), models: {} },
}));

const QueryCase = { distinct: vi.fn() };
const WorkflowStep = { distinct: vi.fn() };
const Review = { distinct: vi.fn() };

vi.mock('../models/index.js', () => ({ QueryCase, WorkflowStep, Review }));

const { visibleQueryIds, isPartyToCase, scopeFilter, scopeKindForRole, SCOPE_KIND, caseScopeFor } =
  await import('../services/authz/caseAccess.js');

const user = (role, over = {}) => ({ id: 'USR-0004', role, email: 'neha.singh@ipc.example', ...over });

beforeEach(() => {
  connected.value = true;
  QueryCase.distinct.mockReset().mockResolvedValue([]);
  WorkflowStep.distinct.mockReset().mockResolvedValue([]);
  Review.distinct.mockReset().mockResolvedValue([]);
});

describe('roles that see everything', () => {
  const everything = [ROLES.FRONT_OFFICE, ROLES.OFFICER_IN_CHARGE, ROLES.ADMIN, ROLES.SUPER_ADMIN];

  it.each(everything)('%s resolves to every case', async (role) => {
    expect(scopeKindForRole(role)).toBe(SCOPE_KIND.EVERYTHING);
    await expect(visibleQueryIds(user(role))).resolves.toBeNull();
    await expect(isPartyToCase(user(role), 'QRY-2026-99999')).resolves.toBe(true);
  });

  /**
   * The highest-consequence mistake available in this module.
   *
   * A SUPER_ADMIN is party to no case in the data sense — they are named on no
   * assignment, no review and no inquirer record. If the role branch were to
   * fall through to a membership query, they would resolve to the EMPTY set and
   * every dashboard in the application would go blank, while /queries/reset —
   * the recovery tool — kept working. Asserting that no query was issued pins
   * the early return, not merely its result.
   */
  it.each(everything)('%s is resolved without querying the database', async (role) => {
    await visibleQueryIds(user(role));

    expect(QueryCase.distinct).not.toHaveBeenCalled();
    expect(WorkflowStep.distinct).not.toHaveBeenCalled();
    expect(Review.distinct).not.toHaveBeenCalled();
  });

  it('answers even with no database connection, since it asks nothing of it', async () => {
    connected.value = false;
    await expect(visibleQueryIds(user(ROLES.SUPER_ADMIN))).resolves.toBeNull();
  });
});

describe('unknown and absent roles', () => {
  it.each([['no role', undefined], ['an unknown role', 'WAREHOUSE_MANAGER'], ['a null user', null]])(
    'fails closed for %s',
    async (_label, role) => {
      const principal = role === null ? null : user(role);
      expect(scopeKindForRole(role ?? undefined)).toBe(SCOPE_KIND.NONE);
      await expect(visibleQueryIds(principal)).resolves.toEqual(new Set());
      await expect(isPartyToCase(principal, 'QRY-2026-00001')).resolves.toBe(false);
    },
  );
});

describe('INQUIRER', () => {
  const inquirer = user(ROLES.INQUIRER, { id: 'USR-0001', email: 'abhinash.pritiraj@gmail.com' });

  it('matches on inquirer.id, and on email only when no id is recorded', async () => {
    QueryCase.distinct.mockResolvedValue(['QRY-2026-00001']);

    await expect(isPartyToCase(inquirer, 'QRY-2026-00001')).resolves.toBe(true);

    const [, filter] = QueryCase.distinct.mock.calls[0];
    expect(filter.$or[0]).toEqual({ 'inquirer.id': 'USR-0001' });

    // The email branch is reachable only when inquirer.id is absent or blank —
    // a present id naming someone else must not fall through to it.
    const emailBranch = filter.$or[1].$and;
    expect(emailBranch[0].$or).toEqual([
      { 'inquirer.id': null },
      { 'inquirer.id': '' },
      { 'inquirer.id': { $exists: false } },
    ]);
    expect(emailBranch[1]['inquirer.email']).toBeInstanceOf(RegExp);
  });

  it('matches the address case-insensitively', async () => {
    await visibleQueryIds(inquirer);
    const regex = QueryCase.distinct.mock.calls[0][1].$or[1].$and[1]['inquirer.email'];

    expect(regex.test('Abhinash.Pritiraj@Gmail.com')).toBe(true);
    expect(regex.test('abhinash.pritiraj@gmail.com.attacker.example')).toBe(false);
    expect(regex.test('xabhinash.pritiraj@gmail.com')).toBe(false);
  });

  /**
   * `+` is a regex quantifier and a perfectly ordinary thing to have in an
   * address. Unescaped, this either throws or silently matches nothing — and a
   * silent mismatch means the inquirer sees none of their own cases while the
   * application otherwise looks healthy.
   */
  it('escapes regex metacharacters in the address', async () => {
    await visibleQueryIds(user(ROLES.INQUIRER, { id: 'USR-0001', email: 'a+b@example.com' }));
    const regex = QueryCase.distinct.mock.calls[0][1].$or[1].$and[1]['inquirer.email'];

    expect(regex.test('a+b@example.com')).toBe(true);
    expect(regex.test('abbbb@example.com')).toBe(false);
  });

  it('refuses rather than widening when storage is unavailable', async () => {
    connected.value = false;
    await expect(visibleQueryIds(inquirer)).rejects.toMatchObject({ status: 503 });
  });
});

describe('REVIEWER', () => {
  const reviewer = user(ROLES.REVIEWER, { id: 'USR-0005' });

  it('is party via a step assigned to them or a review they wrote', async () => {
    WorkflowStep.distinct.mockResolvedValue(['QRY-A']);
    Review.distinct.mockResolvedValue(['QRY-B']);

    await expect(visibleQueryIds(reviewer)).resolves.toEqual(new Set(['QRY-A', 'QRY-B']));
    expect(WorkflowStep.distinct).toHaveBeenCalledWith('queryId', { assignedUserId: 'USR-0005' });
    expect(Review.distinct).toHaveBeenCalledWith('queryId', { reviewerId: 'USR-0005' });
  });

  it('is not party to a case they are named on nowhere', async () => {
    await expect(isPartyToCase(reviewer, 'QRY-SOMEONE-ELSE')).resolves.toBe(false);
  });
});

describe('ASSIGNED_OFFICIAL', () => {
  const official = user(ROLES.ASSIGNED_OFFICIAL, { id: 'USR-0004' });

  it('is party via the current assignment', async () => {
    QueryCase.distinct.mockResolvedValue(['QRY-MINE']);

    await expect(isPartyToCase(official, 'QRY-MINE')).resolves.toBe(true);
    expect(QueryCase.distinct).toHaveBeenCalledWith('queryId', { currentAssigneeId: 'USR-0004' });
  });

  /**
   * Deliberately wider than the client's `isAssignedTo`, which tests only the
   * CURRENT step. Without this an official loses sight of a case they drafted
   * the moment it moves to a reviewer — history included — which reads as data
   * loss to the person it happens to.
   */
  it('keeps a case they worked once it has moved on to someone else', async () => {
    WorkflowStep.distinct.mockResolvedValue(['QRY-DRAFTED-EARLIER']);
    QueryCase.distinct.mockResolvedValue([]);

    await expect(isPartyToCase(official, 'QRY-DRAFTED-EARLIER')).resolves.toBe(true);
    expect(WorkflowStep.distinct).toHaveBeenCalledWith('queryId', { assignedUserId: 'USR-0004' });
  });
});

describe('scopeFilter', () => {
  it('is unconstrained for everything, and an $in otherwise', () => {
    expect(scopeFilter({ everything: true, ids: null })).toEqual({});
    expect(scopeFilter({ everything: false, ids: new Set(['QRY-A', 'QRY-B']) })).toEqual({
      queryId: { $in: ['QRY-A', 'QRY-B'] },
    });
  });

  it('can name a different id field', () => {
    expect(scopeFilter({ everything: false, ids: new Set(['QRY-A']) }, 'sourceQueryId')).toEqual({
      sourceQueryId: { $in: ['QRY-A'] },
    });
  });

  /**
   * The filter and the predicate must agree on the same fixture — that
   * agreement is the reason membership resolves to one id set rather than to
   * two separately written rules.
   */
  it('agrees with isPartyToCase on the same fixture', async () => {
    WorkflowStep.distinct.mockResolvedValue(['QRY-A']);
    Review.distinct.mockResolvedValue([]);
    const reviewer = user(ROLES.REVIEWER, { id: 'USR-0005' });

    const ids = await visibleQueryIds(reviewer);
    const filter = scopeFilter({ everything: false, ids });

    expect(filter.queryId.$in).toContain('QRY-A');
    await expect(isPartyToCase(reviewer, 'QRY-A')).resolves.toBe(true);
  });
});

describe('caseScopeFor', () => {
  it('resolves once per request', async () => {
    const req = { user: user(ROLES.REVIEWER, { id: 'USR-0005' }) };

    await caseScopeFor(req);
    await caseScopeFor(req);

    expect(WorkflowStep.distinct).toHaveBeenCalledTimes(1);
  });
});
