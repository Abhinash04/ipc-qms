import { describe, it, expect } from 'vitest';

import {
  WORKFLOW_STATE,
  BUSINESS_STATUS,
  RESPONSE_STATUS,
  PRIORITY,
} from '../constants/workflowStates.js';
import { CLIENT_AUDIT_EVENTS } from '../constants/auditActions.js';
import { ROLES } from '../constants/roles.js';
import { MAIL_CATEGORIES, RELATION_KINDS, UNCLASSIFIED, CATEGORY_SOURCES } from '../constants/mailCategories.js';

import * as clientEnums from '../../../frontend/src/constants/statusEnums.js';
import { ROLES as CLIENT_ROLES } from '../../../frontend/src/constants/roles.js';
import * as clientCategories from '../../../frontend/src/constants/mailCategories.js';

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
  });

  it('gives every category and every source a label in the client', () => {
    expect(Object.keys(clientCategories.MAIL_CATEGORY_META).sort()).toEqual(Object.values(MAIL_CATEGORIES).sort());
    expect(Object.keys(clientCategories.CATEGORY_SOURCE_LABEL).sort()).toEqual(Object.values(CATEGORY_SOURCES).sort());
  });
});
