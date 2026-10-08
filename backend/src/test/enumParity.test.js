import { describe, it, expect } from 'vitest';

import {
  WORKFLOW_STATE,
  BUSINESS_STATUS,
  RESPONSE_STATUS,
  PRIORITY,
} from '../constants/workflowStates.js';
import { CLIENT_AUDIT_EVENTS, isKnownAuditAction } from '../constants/auditActions.js';
import { activityLabel } from '../services/audit/auditPresentation.js';
import { ROLES } from '../constants/roles.js';
import { MAIL_BUCKETS, MAIL_CATEGORIES, RELATION_KINDS, UNCLASSIFIED, REGISTERED, CATEGORY_SOURCES } from '../constants/mailCategories.js';
import { AUTO_REPLY_STATUS } from '../services/autoReply/assess.js';

import * as clientEnums from '../../../frontend/src/constants/statusEnums.js';
import { ROLES as CLIENT_ROLES } from '../../../frontend/src/constants/roles.js';
import * as clientCategories from '../../../frontend/src/constants/mailCategories.js';
import * as clientCycle from '../../../frontend/src/constants/reviewCycle.js';
import { AUDIT_ACTION_OPTIONS } from '../../../frontend/src/constants/auditFilters.js';
import { PULLBACK_RANK, STEP_STATUS } from '../services/workflow/pullbackPlan.js';
import { EXPERTISE_AREAS, OFFICER_DESIGNATION } from '../constants/expertise.js';
import * as clientExpertise from '../../../frontend/src/constants/expertise.js';
import { ROLE_LABELS as CLIENT_ROLE_LABELS } from '../../../frontend/src/constants/roles.js';

describe('workflow vocabulary parity with the client', () => {
  it.each([
    ['WORKFLOW_STATE', WORKFLOW_STATE, clientEnums.WORKFLOW_STATE],
    ['BUSINESS_STATUS', BUSINESS_STATUS, clientEnums.BUSINESS_STATUS],
    ['RESPONSE_STATUS', RESPONSE_STATUS, clientEnums.RESPONSE_STATUS],
    ['PRIORITY', PRIORITY, clientEnums.PRIORITY],
  ])('%s is identical on both sides', (_name, server, client) => {
    expect(server).toEqual(client);
  });
});

describe('audit vocabulary parity with the client', () => {
  it('lists every client audit event the server will accept', () => {
    expect([...CLIENT_AUDIT_EVENTS].sort()).toEqual(Object.values(clientEnums.AUDIT_EVENT).sort());
  });

  it('filters the Audit Trail by actions the server records, in the words its rows use', () => {
    for (const option of AUDIT_ACTION_OPTIONS) {
      expect(isKnownAuditAction(option.value), option.value).toBe(true);
      expect(option.label, option.value).toBe(activityLabel(option.value));
    }
  });

  it('lets the Audit Trail be filtered by every step of the query workflow', () => {
    const offered = new Set(AUDIT_ACTION_OPTIONS.map((option) => option.value));
    const steps = [...CLIENT_AUDIT_EVENTS, 'QUERY_AUTO_TRANSFERRED', 'QUERY_AUTO_TRANSFER_FAILED'];
    expect(steps.filter((action) => !offered.has(action))).toEqual([]);
  });
});

describe('role parity with the client', () => {
  it('names the same roles on both sides', () => {
    expect(ROLES).toEqual(CLIENT_ROLES);
  });
});

describe('mail category parity with the client', () => {
  it('names the same categories, relations and unclassified key on both sides', () => {
    expect(MAIL_CATEGORIES).toEqual(clientCategories.MAIL_CATEGORIES);
    expect(RELATION_KINDS).toEqual(clientCategories.RELATION_KINDS);
    expect(UNCLASSIFIED).toBe(clientCategories.UNCLASSIFIED);
    expect(REGISTERED).toBe(clientCategories.REGISTERED);
    expect(MAIL_BUCKETS).toEqual(clientCategories.MAIL_BUCKETS);
    expect(AUTO_REPLY_STATUS).toEqual(clientCategories.AUTO_REPLY_STATUS);
  });

  it('gives every category and every source a label in the client', () => {
    expect(Object.keys(clientCategories.MAIL_CATEGORY_META).sort()).toEqual(Object.values(MAIL_CATEGORIES).sort());
    expect(Object.keys(clientCategories.CATEGORY_SOURCE_LABEL).sort()).toEqual(Object.values(CATEGORY_SOURCES).sort());
  });
});

describe('pull back rule parity with the client', () => {
  it('ranks the same stages and names the same step statuses on both sides', () => {
    expect(PULLBACK_RANK).toEqual(clientCycle.PULLBACK_RANK);
    expect(STEP_STATUS).toEqual(clientCycle.STEP_STATUS);
  });
});

describe('expertise vocabulary parity with the client', () => {
  it('offers the same areas, expanded the same way, for the same sign-up designation', () => {
    expect(EXPERTISE_AREAS).toEqual(clientExpertise.EXPERTISE_AREAS);
    expect(OFFICER_DESIGNATION).toBe(clientExpertise.OFFICER_DESIGNATION);
    expect(OFFICER_DESIGNATION).toBe(CLIENT_ROLE_LABELS[ROLES.ASSIGNED_OFFICIAL]);
  });
});
