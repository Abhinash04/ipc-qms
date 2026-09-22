import { describe, it, expect } from 'vitest';
import { buildScopedFilters } from '../controllers/queryController.js';
import { ROLES } from '../constants/roles.js';

/**
 * What GET /queries narrows, and the two things it deliberately does not.
 *
 * Pure, so it needs no database — which matters, because the suite has none.
 */

const everything = { everything: true, ids: null, userId: 'USR-0008', role: ROLES.SUPER_ADMIN };
const scoped = {
  everything: false,
  ids: new Set(['QRY-A', 'QRY-B']),
  userId: 'USR-0001',
  role: ROLES.INQUIRER,
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

  /**
   * Notifications key on the RECIPIENT, and the union is deliberate.
   *
   * Intersecting with the visible case set would drop system-wide
   * notifications, which carry no queryId at all. The cost is that a title can
   * mention a case the reader cannot open; that is accepted, and preferable to
   * silently losing the rest of their notifications.
   */
  it('scopes notifications by recipient rather than by case', () => {
    const filters = buildScopedFilters(scoped);

    expect(filters.notifications).toEqual({
      $or: [{ recipientUserId: 'USR-0001' }, { recipientRole: ROLES.INQUIRER }],
    });
  });

  /**
   * The id-minting contract, and the reason this test exists at all.
   *
   * The client mints every id from the counter map it hydrates (`mintId` in
   * frontend/src/store/useWorkflowStore.js). Scope that map, or omit it, and the
   * client falls back to a zeroed seed and re-issues ids that already exist:
   * best case the createdAt collision guard rejects every new case, worst case
   * one silently replaces a live enquiry.
   */
  it('produces no filter for the counters, which stay global', () => {
    expect(buildScopedFilters(scoped)).not.toHaveProperty('counters');
    expect(buildScopedFilters(everything)).not.toHaveProperty('counters');
  });

  it('yields an empty result rather than everything when nothing is visible', () => {
    const none = { everything: false, ids: new Set(), userId: 'USR-0001', role: ROLES.INQUIRER };

    // An empty $in matches no documents. The failure to avoid is an absent
    // filter, which would match all of them.
    expect(buildScopedFilters(none).queries).toEqual({ queryId: { $in: [] } });
  });
});
