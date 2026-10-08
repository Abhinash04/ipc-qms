import { describe, it, expect } from 'vitest';
import { buildScopedFilters } from '../controllers/queryController.js';
import { ROLES } from '../constants/roles.js';

const everything = { everything: true, ids: null, userId: 'USR-0008', role: ROLES.SUPER_ADMIN };
const scoped = {
  everything: false,
  ids: new Set(['QRY-A', 'QRY-B']),
  userId: 'USR-0001',
  role: ROLES.REVIEWER,
};

const CASE_KEYED = [
  'queries',
  'workflowSteps',
  'reviews',
  'responseVersions',
  'emailMessages',
  'emailThreads',
  'auditEvents',
  'outboundEmails',
];

describe('a role that sees every case', () => {
  it('constrains nothing', () => {
    const filters = buildScopedFilters(everything);
    for (const key of [...CASE_KEYED, 'notifications']) {
      expect(filters[key]).toEqual({});
    }
  });
});

describe('a narrowed role', () => {
  it('restricts every case-keyed collection to the visible ids', () => {
    const filters = buildScopedFilters(scoped);

    for (const key of CASE_KEYED) {
      expect(filters[key]).toEqual({ queryId: { $in: ['QRY-A', 'QRY-B'] } });
    }
  });

  it('scopes notifications by recipient rather than by case', () => {
    const filters = buildScopedFilters(scoped);

    expect(filters.notifications).toEqual({
      $or: [{ recipientUserId: 'USR-0001' }, { recipientRole: ROLES.REVIEWER }],
    });
  });

  it('produces no filter for the counters, which stay global', () => {
    expect(buildScopedFilters(scoped)).not.toHaveProperty('counters');
    expect(buildScopedFilters(everything)).not.toHaveProperty('counters');
  });

  it('yields an empty result rather than everything when nothing is visible', () => {
    const none = { everything: false, ids: new Set(), userId: 'USR-0001', role: ROLES.REVIEWER };

    expect(buildScopedFilters(none).queries).toEqual({ queryId: { $in: [] } });
  });
});
