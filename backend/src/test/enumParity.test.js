import { describe, it, expect } from 'vitest';

import {
  WORKFLOW_STATE,
  BUSINESS_STATUS,
  RESPONSE_STATUS,
  PRIORITY,
} from '../constants/workflowStates.js';
import { CLIENT_AUDIT_EVENTS } from '../constants/auditActions.js';
import { ROLES } from '../constants/roles.js';

import * as clientEnums from '../../../frontend/src/constants/statusEnums.js';
import { ROLES as CLIENT_ROLES } from '../../../frontend/src/constants/roles.js';

/**
 * The mirrored vocabularies, held to each other.
 *
 * Several backend constants files say "mirrored from the frontend; the two must
 * stay identical" and then rely on a reader noticing. This is the mechanism
 * that makes that true: drift fails here rather than turning up later as a
 * state the server quietly refuses, or an audit row silently dropped.
 *
 * It works because frontend/src/constants/statusEnums.js and roles.js have no
 * imports and no `@/` alias, so the backend suite can load them directly. Keep
 * them that way — a dependency there would cost this test, and with it the only
 * thing keeping the two halves honest.
 */
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
  /**
   * Note this is a UNION, not a merge: the server keeps its own AUDIT_ACTIONS
   * for events it raises itself, and 18 of the client's 19 appear in no
   * server-side list. Constraining the persist route to AUDIT_ACTIONS alone
   * would therefore have rejected nearly every audit row the application
   * writes — which is exactly the kind of thing this test exists to catch.
   */
  it('lists every client audit event the server will accept', () => {
    expect([...CLIENT_AUDIT_EVENTS].sort()).toEqual(Object.values(clientEnums.AUDIT_EVENT).sort());
  });
});

describe('role parity with the client', () => {
  it('names the same roles on both sides', () => {
    expect(ROLES).toEqual(CLIENT_ROLES);
  });
});
