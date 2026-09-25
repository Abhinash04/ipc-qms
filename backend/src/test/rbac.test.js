import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES, ACTOR_TYPES } from '../constants/roles.js';
import { CAPABILITIES, can, capabilitiesFor } from '../constants/capabilities.js';
import { WORKFLOW_ACTION, roleCanPerform } from '../constants/workflowActions.js';

const as = (role) => authHeader(role);

describe('401 — no session at all', () => {
  it.each([
    ['get', '/api/v1/emails/config'],
    ['get', '/api/v1/mailbox/messages'],
    ['get', '/api/v1/mailbox/messages/MSG-00001'],
    ['get', '/api/v1/mailbox/messages/MSG-00001/attachments/att_1'],
    ['post', '/api/v1/mailbox/messages/MSG-00001/read'],
    ['post', '/api/v1/mailbox/sync'],
    ['post', '/api/v1/emails/forward'],
    ['post', '/api/v1/ai/summary'],
    ['get', '/api/v1/attachments/att_00000000-0000-4000-8000-000000000000'],
  ])('%s %s', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  it('leaves /health and /auth/login public', async () => {
    expect((await request(app).get('/api/v1/health')).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login').send({})).status).toBe(400);
  });
});

describe('403 — a session without the role', () => {
  it('has no enquiry endpoint left to authorise', async () => {
    for (const role of [ROLES.REVIEWER, ROLES.FRONT_OFFICE, ROLES.SUPER_ADMIN]) {
      expect((await request(app).post('/api/v1/emails/enquiry').set(as(role)).send({})).status).toBe(404);
    }
  });

  it('only the Front Office (or Super Admin) may acknowledge', async () => {
    expect(
      (await request(app).post('/api/v1/emails/acknowledgement').set(as(ROLES.ASSIGNED_OFFICIAL)).send({})).status,
    ).toBe(403);
    expect(
      (await request(app).post('/api/v1/emails/acknowledgement').set(as(ROLES.FRONT_OFFICE)).send({})).status,
    ).not.toBe(403);
  });

  it('only roles that may FORWARD reach the forward endpoint', async () => {
    expect((await request(app).post('/api/v1/emails/forward').set(as(ROLES.REVIEWER)).send({})).status).toBe(403);
    expect((await request(app).post('/api/v1/emails/forward').set(as(ROLES.FRONT_OFFICE)).send({})).status).not.toBe(403);
  });

  it('the mailbox is the Front Officer\'s — other staff may not read it', async () => {
    expect((await request(app).get('/api/v1/mailbox/messages').set(as(ROLES.REVIEWER))).status).toBe(403);
    expect((await request(app).get('/api/v1/mailbox/messages').set(as(ROLES.FRONT_OFFICE))).status).not.toBe(403);
    expect((await request(app).get('/api/v1/mailbox/messages/MSG-00001').set(as(ROLES.REVIEWER))).status).toBe(403);
    expect(
      (await request(app).get('/api/v1/mailbox/messages/MSG-00001/attachments/att_1').set(as(ROLES.REVIEWER))).status,
    ).toBe(403);
    expect((await request(app).post('/api/v1/mailbox/messages/MSG-00001/read').set(as(ROLES.REVIEWER))).status).toBe(403);
    expect((await request(app).post('/api/v1/mailbox/sync').set(as(ROLES.REVIEWER))).status).toBe(403);
  });

  it('wiping the whole mailbox is Super Admin only — not even the Front Officer', async () => {
    expect((await request(app).delete('/api/v1/mailbox').set(as(ROLES.FRONT_OFFICE))).status).toBe(403);
  });

  it('any signed-in role may use the AI helpers', async () => {
    for (const role of [ROLES.REVIEWER, ROLES.ASSIGNED_OFFICIAL]) {
      const res = await request(app).post('/api/v1/ai/summary').set(as(role)).send({});
      expect(res.status).not.toBe(403);
    }
  });
});

describe('workflow-action authorization mirrors the frontend table', () => {
  it('permits the roles the matrix permits', () => {
    expect(roleCanPerform(ROLES.FRONT_OFFICE, WORKFLOW_ACTION.DISPATCH)).toBe(true);
    expect(roleCanPerform(ROLES.OFFICER_IN_CHARGE, WORKFLOW_ACTION.ASSIGN)).toBe(true);
    expect(roleCanPerform(ROLES.REVIEWER, WORKFLOW_ACTION.APPROVE_REVIEW)).toBe(true);
  });

  it('refuses the ones it does not', () => {
    expect(roleCanPerform(ROLES.REVIEWER, WORKFLOW_ACTION.FORWARD)).toBe(false);
    expect(roleCanPerform(ROLES.ADMIN, WORKFLOW_ACTION.VERIFY)).toBe(false);
  });

  it('permits DELETE_REVIEW_LEVEL for the Assigned Official and Super Admin only', () => {
    for (const role of Object.values(ROLES)) {
      expect(roleCanPerform(role, WORKFLOW_ACTION.DELETE_REVIEW_LEVEL)).toBe(
        [ROLES.ASSIGNED_OFFICIAL, ROLES.SUPER_ADMIN].includes(role),
      );
    }
  });

  it('permits PULLBACK for Admin and Super Admin only', () => {
    expect(roleCanPerform(ROLES.ADMIN, WORKFLOW_ACTION.PULLBACK)).toBe(true);
    expect(roleCanPerform(ROLES.SUPER_ADMIN, WORKFLOW_ACTION.PULLBACK)).toBe(true);
    expect(roleCanPerform(ROLES.FRONT_OFFICE, WORKFLOW_ACTION.PULLBACK)).toBe(false);
    expect(roleCanPerform(ROLES.OFFICER_IN_CHARGE, WORKFLOW_ACTION.PULLBACK)).toBe(false);
    expect(roleCanPerform(ROLES.ASSIGNED_OFFICIAL, WORKFLOW_ACTION.PULLBACK)).toBe(false);
    expect(roleCanPerform(ROLES.REVIEWER, WORKFLOW_ACTION.PULLBACK)).toBe(false);
  });
});

describe('NIC agent capabilities', () => {
  const agent = { actorType: ACTOR_TYPES.AGENT, role: ROLES.SUPER_ADMIN };

  it('lets the agent read and prepare', () => {
    expect(can(agent, CAPABILITIES.NIC_READ)).toBe(true);
    expect(can(agent, CAPABILITIES.NIC_PREPARE)).toBe(true);
  });

  it('never lets the agent send or delete — even carrying a Super Admin role', () => {
    expect(can(agent, CAPABILITIES.NIC_SEND)).toBe(false);
    expect(can(agent, CAPABILITIES.NIC_DESTRUCTIVE)).toBe(false);
  });

  it('gives the Front Officer the full set', () => {
    const frontOffice = { actorType: ACTOR_TYPES.HUMAN, role: ROLES.FRONT_OFFICE };
    expect(capabilitiesFor(frontOffice)).toEqual(Object.values(CAPABILITIES));
  });

  it('gives read-only roles read only', () => {
    const reviewer = { actorType: ACTOR_TYPES.HUMAN, role: ROLES.REVIEWER };
    expect(capabilitiesFor(reviewer)).toEqual([CAPABILITIES.NIC_READ]);
  });

  it('gives the Inquirer and Admin nothing on the official mailbox', () => {
    expect(capabilitiesFor({ actorType: ACTOR_TYPES.HUMAN, role: ROLES.ADMIN })).toEqual([]);
  });

  it('fails closed on a missing actor, unknown role or unknown capability', () => {
    expect(can(null, CAPABILITIES.NIC_READ)).toBe(false);
    expect(can({ role: 'MADE_UP' }, CAPABILITIES.NIC_READ)).toBe(false);
    expect(can({ role: ROLES.SUPER_ADMIN }, 'NIC_INVENTED')).toBe(false);
  });
});
