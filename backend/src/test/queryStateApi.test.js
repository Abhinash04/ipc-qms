import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import { persistTransitionSchema } from '../validators/queryStateSchemas.js';

describe('/api/v1/queries — authorization', () => {
  it('rejects an unauthenticated caller on every route', async () => {
    const calls = [
      request(app).get('/api/v1/queries'),
      request(app).get('/api/v1/queries/is-empty'),
      request(app).post('/api/v1/queries/persist').send({}),
      request(app).post('/api/v1/queries/reset').send({}),
    ];

    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401);
    }
  });

  it('refuses no signed-in role the hydration route', async () => {
    for (const role of [ROLES.ASSIGNED_OFFICIAL, ROLES.FRONT_OFFICE, ROLES.REVIEWER]) {
      const read = await request(app).get('/api/v1/queries').set(authHeader(role));
      expect(read.status).not.toBe(403);
    }
  });

  it('refuses no signed-in role an empty delta', async () => {
    for (const role of [ROLES.ASSIGNED_OFFICIAL, ROLES.FRONT_OFFICE, ROLES.REVIEWER]) {
      const write = await request(app)
        .post('/api/v1/queries/persist')
        .set(authHeader(role))
        .send({});
      expect(write.status).not.toBe(403);
    }
  });

  it('does not let a protected write through unauthorized when the store is down', async () => {
    const res = await request(app)
      .post('/api/v1/queries/persist')
      .set(authHeader(ROLES.ASSIGNED_OFFICIAL))
      .send({ query: { queryId: 'QRY-2026-00001', workflowState: 'READY_FOR_DISPATCH' } });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/access cannot be determined/i);
  });

  it('refuses /queries/reset to every role except SUPER_ADMIN', async () => {
    const denied = [
      ROLES.ASSIGNED_OFFICIAL,
      ROLES.FRONT_OFFICE,
      ROLES.OFFICER_IN_CHARGE,
      ROLES.ASSIGNED_OFFICIAL,
      ROLES.REVIEWER,
      ROLES.ADMIN,
    ];

    for (const role of denied) {
      const res = await request(app).post('/api/v1/queries/reset').set(authHeader(role)).send({});
      expect(res.status).toBe(403);
    }

    const allowed = await request(app)
      .post('/api/v1/queries/reset')
      .set(authHeader(ROLES.SUPER_ADMIN))
      .send({});
    expect(allowed.status).not.toBe(403);
  });
});

describe('/api/v1/queries — storage availability', () => {
  it('answers 503, not 500, when the database is not connected', async () => {
    const res = await request(app).get('/api/v1/queries').set(authHeader(ROLES.FRONT_OFFICE));
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/unavailable/i);
  });
});

describe('/api/v1/queries/persist — the client contract', () => {
  it('accepts audit details as a string, which is what the client sends', () => {
    const parsed = persistTransitionSchema.parse({
      auditEvent: {
        event: 'QUERY_REGISTERED',
        queryId: 'QRY-2026-00001',
        details: 'Front Office verified the query details and attachments.',
      },
    });

    expect(parsed.auditEvent.details).toBe(
      'Front Office verified the query details and attachments.',
    );
  });

  it('still accepts a structured details object, which the server itself writes', () => {
    const parsed = persistTransitionSchema.parse({
      auditEvent: {
        event: 'EMAIL_FORWARDED',
        queryId: 'QRY-2026-00001',
        details: { recipients: 1, attachments: 2 },
      },
    });

    expect(parsed.auditEvent.details).toEqual({ recipients: 1, attachments: 2 });
  });

  it('keeps the fields that link a case back to its email', () => {
    const parsed = persistTransitionSchema.parse({
      query: {
        queryId: 'QRY-2026-00001',
        subject: 'Dissolution limits',
        workflowState: 'RECEIVED',
        threadId: 'THREAD-2026-00001',
        sourceEmailId: 'MSG-00001',
        sourceMailboxMessageId: 'msg-abc123',
        aiSummary: { text: 'A summary.' },
        assignmentDecision: { recommended: 'USR-0004' },
        pullbackHistory: [],
      },
    });

    expect(parsed.query).toMatchObject({
      threadId: 'THREAD-2026-00001',
      sourceEmailId: 'MSG-00001',
      sourceMailboxMessageId: 'msg-abc123',
      aiSummary: { text: 'A summary.' },
      assignmentDecision: { recommended: 'USR-0004' },
      pullbackHistory: [],
    });
  });

  it('accepts a review raised from final approval, which has no step', () => {
    const parsed = persistTransitionSchema.parse({
      auditEvent: { event: 'REVISION_REQUESTED', queryId: 'QRY-2026-00001' },
      addReviews: [
        {
          reviewId: 'REV-00003',
          queryId: 'QRY-2026-00001',
          stepId: null,
          reviewerId: null,
          decision: 'CHANGES_REQUESTED',
          comment: 'Please cite the monograph.',
          responseId: 'RESP-00002',
          version: 'v2',
          at: '2026-09-17T15:40:00.000Z',
        },
      ],
    });

    expect(parsed.addReviews[0]).toMatchObject({
      stepId: null,
      reviewerId: null,
      comment: 'Please cite the monograph.',
      responseId: 'RESP-00002',
      version: 'v2',
    });
  });

  it('keeps the final-approval lock on a response version', () => {
    const parsed = persistTransitionSchema.parse({
      auditEvent: { event: 'FINAL_APPROVAL_GRANTED', queryId: 'QRY-2026-00001' },
      upsertVersions: [
        {
          responseId: 'RESP-00002',
          queryId: 'QRY-2026-00001',
          version: 'v2',
          content: 'The approved text.',
          status: 'FINAL_APPROVED',
          source: 'USER_EDITED',
          aiGenerated: false,
          approvedAt: '2026-09-17T15:38:28.768Z',
        },
      ],
    });

    expect(parsed.upsertVersions[0]).toMatchObject({
      status: 'FINAL_APPROVED',
      source: 'USER_EDITED',
      aiGenerated: false,
      approvedAt: '2026-09-17T15:38:28.768Z',
    });
  });

  it('keeps the client id on an audit event', () => {
    const parsed = persistTransitionSchema.parse({
      auditEvent: {
        auditId: 'AUD-00013',
        event: 'AI_SUMMARY_GENERATED',
        queryId: 'QRY-2026-00001',
        details: 'A summary.',
      },
    });

    expect(parsed.auditEvent.auditId).toBe('AUD-00013');
  });

  it('rejects an audit event with no name, naming the field', () => {
    const result = persistTransitionSchema.safeParse({
      auditEvent: { auditId: 'AUD-00013', queryId: 'QRY-2026-00001', details: 'A summary.' },
    });

    expect(result.success).toBe(false);
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('auditEvent.event');
  });

  it('accepts a whole transition delta shaped exactly as the store emits one', () => {
    const result = persistTransitionSchema.safeParse({
      query: {
        queryId: 'QRY-2026-00001',
        subject: 'Clarification on dissolution limits',
        description: 'Please clarify.',
        source: 'Email',
        inquirer: { id: null, name: 'A Member of the Public', email: 'someone@example.com' },
        category: null,
        priority: 'NORMAL',
        businessStatus: 'OPEN',
        workflowState: 'FRONT_OFFICE_VERIFICATION',
        currentAssigneeId: null,
        currentWorkflowStepId: null,
        attachments: [],
        dueDate: null,
        createdAt: '2026-09-17T09:00:00.000Z',
        updatedAt: '2026-09-17T09:00:01.000Z',
        threadId: 'THREAD-2026-00001',
        sourceEmailId: 'MSG-00001',
        sourceMailboxMessageId: 'msg-abc123',
        aiSummary: null,
        assignmentDecision: null,
        pullbackHistory: [],
      },
      auditEvent: {
        event: 'QUERY_REGISTERED',
        at: '2026-09-17T09:00:01.000Z',
        queryId: 'QRY-2026-00001',
        details: 'Front Office verified the query details and attachments.',
      },
      notification: null,
      counters: { QRY: 1, THREAD: 1, MSG: 2, AUD: 3, NOTIF: 1, STEP: 0, REV: 0, RESP: 0 },
      upsertSteps: [],
      deleteStepIds: [],
      addReviews: [],
      addVersions: [],
      addMessages: [
        {
          messageId: 'MSG-00001',
          threadId: 'THREAD-2026-00001',
          queryId: 'QRY-2026-00001',
          direction: 'INBOUND',
          emailType: 'INCOMING_QUERY',
          from: 'A Member of the Public <someone@example.com>',
          to: ['front-office@test.invalid'],
          cc: [],
          bcc: [],
          subject: 'Clarification on dissolution limits',
          body: 'Please clarify.',
          attachments: [],
          timestamp: '2026-09-17T09:00:00.000Z',
          providerMessageId: 'msg-abc123',
          providerThreadId: 'thread-abc123',
          sourceMessageId: 'msg-abc123',
        },
      ],
      addThreads: [
        {
          threadId: 'THREAD-2026-00001',
          queryId: 'QRY-2026-00001',
          createdAt: '2026-09-17T09:00:00.000Z',
        },
      ],
    });

    if (!result.success) {
      throw new Error(
        `The store's own delta was rejected: ${result.error.issues
          .map((i) => `${i.path.join('.')} — ${i.message}`)
          .join('; ')}`,
      );
    }

    expect(result.data.query.sourceMailboxMessageId).toBe('msg-abc123');
    expect(result.data.addMessages[0].sourceMessageId).toBe('msg-abc123');
  });
});

describe('/api/v1/queries/persist — payload validation', () => {
  it('strips fields the models never declared instead of writing them', () => {
    const parsed = persistTransitionSchema.parse({
      query: {
        queryId: 'QRY-2026-00001',
        subject: 'Dissolution method',
        workflowState: 'OPEN',
        __proto__polluted: true,
        isAdmin: true,
        _id: 'deadbeefdeadbeefdeadbeef',
      },
    });

    expect(parsed.query).toEqual({
      queryId: 'QRY-2026-00001',
      subject: 'Dissolution method',
      workflowState: 'OPEN',
    });
  });

  it('refuses to carry an audit actor supplied by the caller', () => {
    const parsed = persistTransitionSchema.parse({
      auditEvent: {
        event: 'CASE_CREATED',
        queryId: 'QRY-2026-00001',
        actorRole: 'SUPER_ADMIN',
        actorId: 'USR-0008',
        actorType: 'human',
      },
    });

    expect(parsed.auditEvent).toEqual({
      event: 'CASE_CREATED',
      queryId: 'QRY-2026-00001',
    });
  });

  it('accepts the explicit nulls the store sends for untouched slots', () => {
    const parsed = persistTransitionSchema.parse({
      query: null,
      auditEvent: null,
      notification: null,
      counters: null,
      upsertSteps: [],
      deleteStepIds: [],
    });

    expect(parsed.query).toBeNull();
    expect(parsed.upsertSteps).toEqual([]);
  });

  it('accepts a counters map — the shape that used to fail as a CastError', () => {
    const counters = { QRY: 3, THREAD: 2, MSG: 9, AUD: 41, NOTIF: 5, STEP: 7, REV: 2, RESP: 4 };
    const parsed = persistTransitionSchema.parse({ counters });
    expect(parsed.counters).toEqual(counters);
  });

  it('rejects a request whose ids are missing', async () => {
    const res = await request(app)
      .post('/api/v1/queries/persist')
      .set(authHeader(ROLES.FRONT_OFFICE))
      .send({ query: { subject: 'no id' } });

    expect(res.status).toBe(400);
    expect(res.body.details?.fields ?? res.body.fields).toBeDefined();
  });
});
