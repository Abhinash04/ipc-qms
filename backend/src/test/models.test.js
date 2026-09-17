import { describe, it, expect } from 'vitest';
import {
  AuditEvent,
  MailboxMessage,
  Counter,
  User,
  QueryCase,
  WorkflowStep,
  Review,
  ResponseVersion,
  Notification,
} from '../models/index.js';

describe('Backend MongoDB Models', () => {
  it('exports all 9 expected Mongoose models', () => {
    expect(AuditEvent).toBeDefined();
    expect(MailboxMessage).toBeDefined();
    expect(Counter).toBeDefined();
    expect(User).toBeDefined();
    expect(QueryCase).toBeDefined();
    expect(WorkflowStep).toBeDefined();
    expect(Review).toBeDefined();
    expect(ResponseVersion).toBeDefined();
    expect(Notification).toBeDefined();
  });

  it('instantiates User document with correct defaults', () => {
    const user = new User({
      userId: 'usr-001',
      name: 'Test Officer',
      email: 'test@ipc.example',
      role: 'FRONT_OFFICE',
    });
    expect(user.userId).toBe('usr-001');
    expect(user.role).toBe('FRONT_OFFICE');
    expect(user.active).toBe(true);
    expect(user.createdAt).toBeTypeOf('string');
  });

  it('instantiates QueryCase document with correct defaults', () => {
    const caseDoc = new QueryCase({
      queryId: 'QRY-2026-00001',
      subject: 'Environmental Guidance Inquiry',
      workflowState: 'UNASSIGNED',
    });
    expect(caseDoc.queryId).toBe('QRY-2026-00001');
    expect(caseDoc.source).toBe('Email');
    expect(caseDoc.priority).toBe('NORMAL');
    expect(caseDoc.businessStatus).toBe('OPEN');
    expect(caseDoc.workflowState).toBe('UNASSIGNED');
    expect(caseDoc.createdAt).toBeTypeOf('string');
  });

  it('instantiates WorkflowStep document with correct sequence & type', () => {
    const step = new WorkflowStep({
      stepId: 'stp-001',
      queryId: 'QRY-2026-00001',
      stepType: 'REVIEW',
      sequence: 1,
    });
    expect(step.stepId).toBe('stp-001');
    expect(step.stepType).toBe('REVIEW');
    expect(step.sequence).toBe(1);
    expect(step.status).toBe('PENDING');
  });

  it('instantiates Review document with decision', () => {
    const rev = new Review({
      reviewId: 'rev-001',
      queryId: 'QRY-2026-00001',
      stepId: 'stp-001',
      reviewerId: 'usr-002',
      decision: 'APPROVED',
      comments: 'Looks good',
    });
    expect(rev.reviewId).toBe('rev-001');
    expect(rev.decision).toBe('APPROVED');
    expect(rev.comments).toBe('Looks good');
  });

  it('instantiates ResponseVersion document', () => {
    const version = new ResponseVersion({
      responseId: 'rsp-001',
      queryId: 'QRY-2026-00001',
      version: 'v1',
      content: 'Draft response text...',
      createdBy: 'AI Draft Assistant',
    });
    expect(version.responseId).toBe('rsp-001');
    expect(version.version).toBe('v1');
    expect(version.createdBy).toBe('AI Draft Assistant');
  });

  it('instantiates Notification document', () => {
    const notif = new Notification({
      notificationId: 'ntf-001',
      queryId: 'QRY-2026-00001',
      recipientRole: 'OFFICER_IN_CHARGE',
      title: 'New Query Assigned',
      message: 'Query QRY-2026-00001 requires review',
    });
    expect(notif.notificationId).toBe('ntf-001');
    expect(notif.recipientRole).toBe('OFFICER_IN_CHARGE');
    expect(notif.read).toBe(false);
  });
});
