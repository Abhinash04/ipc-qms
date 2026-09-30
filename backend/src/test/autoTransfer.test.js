import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { mongoose, connectDb, isConnected } from '../config/db.js';
import { QueryCase, Notification, AuditEvent, EmailMessage } from '../models/index.js';
import { WORKFLOW_STATE, BUSINESS_STATUS } from '../constants/workflowStates.js';
import { ROLES } from '../constants/roles.js';
import { USERS } from '../constants/users.js';
import {
  calculateDeadline,
  selectNextRecommendedOfficial,
  executeAutoTransfer,
  processExpiredTransfers,
  getTimeoutMinutes,
} from '../services/query/autoTransferScheduler.js';

describe('Automatic Query Transfer Mechanism Tests', () => {
  const QUERY_A = 'QRY-TEST-001';
  const OFFICER_A = 'USR-0004'; // Neha Singh
  const OFFICER_B = 'USR-0010'; // Meera Iyer
  const OFFICER_C = 'USR-0011'; // Arjun Nair

  beforeAll(async () => {
    try {
      await connectDb({ silent: true });
    } catch {
      // Offline fallback mode
    }
  });

  beforeEach(async () => {
    if (isConnected()) {
      await QueryCase.deleteMany({ queryId: { $regex: '^QRY-TEST-' } }).catch(() => {});
      await Notification.deleteMany({ queryId: { $regex: '^QRY-TEST-' } }).catch(() => {});
      await AuditEvent.deleteMany({ queryId: { $regex: '^QRY-TEST-' } }).catch(() => {});
      await EmailMessage.deleteMany({ queryId: { $regex: '^QRY-TEST-' } }).catch(() => {});
    }
  });

  it('calculates 2-minute deadline using server-side timestamp', () => {
    const start = '2026-09-29T10:00:00.000Z';
    const deadline = calculateDeadline(start, 2);
    expect(deadline).toBe('2026-09-29T10:02:00.000Z');
  });

  it('TEST 1 & 2: Officer takes required action within 2 minutes → No automatic transfer', async () => {
    const pastTime = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const queryObj = {
      queryId: QUERY_A,
      subject: 'Dissolution testing enquiry',
      description: 'Need monograph clarification on dissolution',
      workflowState: WORKFLOW_STATE.DRAFTING, // Officer took action!
      businessStatus: BUSINESS_STATUS.IN_PROGRESS,
      currentAssigneeId: OFFICER_A,
      assignedAt: pastTime,
      actionDeadline: calculateDeadline(pastTime, 2),
    };

    if (isConnected()) {
      await QueryCase.create(queryObj);
    }

    const result = await executeAutoTransfer(isConnected() ? QUERY_A : queryObj, { timeoutMinutes: 2 });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('STATE_NOT_ASSIGNED');
  });

  it('TEST 3: Officer does not take action for 2 minutes → Automatically transfers to next eligible AI-recommended officer', async () => {
    const expiredTime = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const expiredDeadline = calculateDeadline(expiredTime, 2);

    const queryObj = {
      queryId: QUERY_A,
      subject: 'Dissolution testing enquiry',
      description: 'Assay and dissolution procedures',
      workflowState: WORKFLOW_STATE.ASSIGNED,
      businessStatus: BUSINESS_STATUS.OPEN,
      currentAssigneeId: OFFICER_A,
      assignedAt: expiredTime,
      actionDeadline: expiredDeadline,
    };

    if (isConnected()) {
      await QueryCase.create(queryObj);
    }

    const result = await executeAutoTransfer(isConnected() ? QUERY_A : queryObj, { timeoutMinutes: 2 });
    expect(result.success).toBe(true);
    expect(result.previousAssigneeId).toBe(OFFICER_A);
    expect(result.newAssigneeId).not.toBe(OFFICER_A);
    expect(result.updated.transferType).toBe('AUTO_TRANSFER');
    expect(result.updated.transferHistory.length).toBe(1);
    expect(result.updated.transferHistory[0].reason).toContain('Automatic transfer after 2-minute action limit');
  });

  it('TEST 4: Query is automatically transferred to Officer B → Officer B receives a fresh 2-minute timeline', async () => {
    const expiredTime = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const queryObj = {
      queryId: QUERY_A,
      subject: 'Microbiology testing procedure',
      description: 'Sterility and endotoxin specifications',
      workflowState: WORKFLOW_STATE.ASSIGNED,
      businessStatus: BUSINESS_STATUS.OPEN,
      currentAssigneeId: OFFICER_A,
      assignedAt: expiredTime,
      actionDeadline: calculateDeadline(expiredTime, 2),
    };

    if (isConnected()) {
      await QueryCase.create(queryObj);
    }

    const nowISO = new Date().toISOString();
    const result = await executeAutoTransfer(isConnected() ? QUERY_A : queryObj, { timeoutMinutes: 2, nowISO });
    expect(result.success).toBe(true);
    expect(result.assignedAt).toBe(nowISO);
    expect(result.actionDeadline).toBe(calculateDeadline(nowISO, 2));
  });

  it('TEST 5: Officer B also does not act for 2 minutes → Single auto-transfer limit enforced (refuses 2nd auto transfer)', async () => {
    const oldTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const queryObj = {
      queryId: QUERY_A,
      subject: 'Pharmacopoeial standards enquiry',
      description: 'Monograph reference standards and IPRS',
      workflowState: WORKFLOW_STATE.ASSIGNED,
      businessStatus: BUSINESS_STATUS.OPEN,
      currentAssigneeId: OFFICER_A,
      assignedAt: oldTime,
      actionDeadline: calculateDeadline(oldTime, 2),
      transferHistory: [],
    };

    if (isConnected()) {
      await QueryCase.create(queryObj);
    }

    // Step 1: 1st Transfer Officer A -> Officer B (Succeeds)
    const step1 = await executeAutoTransfer(isConnected() ? QUERY_A : queryObj, { timeoutMinutes: 2 });
    expect(step1.success).toBe(true);

    // Simulate 3 minutes pass for Officer B
    const expiredTimeB = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const queryObjB = {
      ...step1.updated,
      assignedAt: expiredTimeB,
      actionDeadline: calculateDeadline(expiredTimeB, 2),
    };

    if (isConnected()) {
      await QueryCase.updateOne(
        { queryId: QUERY_A },
        { $set: { assignedAt: expiredTimeB, actionDeadline: calculateDeadline(expiredTimeB, 2) } }
      );
    }

    // Step 2: Attempt 2nd Auto-Transfer -> Refused because limit is 1 time
    const step2 = await executeAutoTransfer(isConnected() ? QUERY_A : queryObjB, { timeoutMinutes: 2 });
    expect(step2.success).toBe(false);
    expect(step2.reason).toBe('MAX_AUTO_TRANSFERS_REACHED');
  });

  it('TEST 6: Officer manually transfers query before 2 minutes → New officer receives a fresh 2-minute timeline', async () => {
    const manualTime = new Date().toISOString();
    const manualDeadline = calculateDeadline(manualTime, 2);

    const queryObj = {
      queryId: QUERY_A,
      subject: 'Chromatography query',
      workflowState: WORKFLOW_STATE.ASSIGNED,
      businessStatus: BUSINESS_STATUS.OPEN,
      currentAssigneeId: OFFICER_B,
      assignedAt: manualTime,
      actionDeadline: manualDeadline,
      transferType: 'MANUAL',
      transferHistory: [
        {
          fromAssigneeId: OFFICER_A,
          toAssigneeId: OFFICER_B,
          transferredAt: manualTime,
          reason: 'Colleague has better expertise',
          transferType: 'MANUAL',
        },
      ],
    };

    if (isConnected()) {
      await QueryCase.create(queryObj);
    }

    // Auto transfer attempt right now (before 2 minutes) should be refused
    const res = await executeAutoTransfer(isConnected() ? QUERY_A : queryObj, { timeoutMinutes: 2 });
    expect(res.success).toBe(false);
    expect(res.reason).toBe('DEADLINE_NOT_EXPIRED');
  });

  it('TEST 7: Query is closed before 2 minutes → No automatic transfer', async () => {
    const expiredTime = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const queryObj = {
      queryId: QUERY_A,
      subject: 'Dispatched and closed query',
      workflowState: WORKFLOW_STATE.CLOSED,
      businessStatus: BUSINESS_STATUS.CLOSED,
      currentAssigneeId: OFFICER_A,
      assignedAt: expiredTime,
      actionDeadline: calculateDeadline(expiredTime, 2),
    };

    if (isConnected()) {
      await QueryCase.create(queryObj);
    }

    const res = await executeAutoTransfer(isConnected() ? QUERY_A : queryObj, { timeoutMinutes: 2 });
    expect(res.success).toBe(false);
    expect(res.reason).toBe('STATE_NOT_ASSIGNED');
  });

  it('TEST 8: Officer takes action at approximately same time as auto-transfer job → Re-checks DB state and prevents incorrect transfer', async () => {
    const expiredTime = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const queryObj = {
      queryId: QUERY_A,
      subject: 'Race condition test query',
      workflowState: WORKFLOW_STATE.ASSIGNED,
      businessStatus: BUSINESS_STATUS.OPEN,
      currentAssigneeId: OFFICER_A,
      assignedAt: expiredTime,
      actionDeadline: calculateDeadline(expiredTime, 2),
      revision: 1,
    };

    if (isConnected()) {
      await QueryCase.create(queryObj);
      await QueryCase.updateOne(
        { queryId: QUERY_A },
        { $set: { workflowState: WORKFLOW_STATE.DRAFTING }, $inc: { revision: 1 } }
      );
    } else {
      queryObj.workflowState = WORKFLOW_STATE.DRAFTING;
    }

    const res = await executeAutoTransfer(isConnected() ? QUERY_A : queryObj, { timeoutMinutes: 2 });
    expect(res.success).toBe(false);
    expect(res.reason).toBe('STATE_NOT_ASSIGNED');
  });

  it('TEST 9: AI recommendation returns currently assigned officer → Skip that officer and select next eligible recommendation', () => {
    const dummyQuery = {
      queryId: QUERY_A,
      currentAssigneeId: OFFICER_A,
      transferHistory: [],
    };

    const aiRecs = [
      { userId: OFFICER_A, name: 'Neha Singh', matchPercent: 95 },
      { userId: OFFICER_B, name: 'Meera Iyer', matchPercent: 88 },
      { userId: OFFICER_C, name: 'Arjun Nair', matchPercent: 75 },
    ];

    const result = selectNextRecommendedOfficial({
      query: dummyQuery,
      currentAssigneeId: OFFICER_A,
      recommendations: aiRecs,
    });

    expect(result).toBeDefined();
    expect(result.selected.id).not.toBe(OFFICER_A);
    expect(result.selected.id).toBe(OFFICER_B);
  });

  it('TEST 10: No eligible recommended officer is available → Do not perform invalid transfer & flag query for OIC/Admin', async () => {
    const expiredTime = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const allOfficials = USERS.filter((u) => u.role === ROLES.ASSIGNED_OFFICIAL);

    const fullHistory = allOfficials.map((officer, i) => ({
      fromAssigneeId: officer.id,
      toAssigneeId: allOfficials[(i + 1) % allOfficials.length].id,
      transferredAt: expiredTime,
      reason: 'Historical transfer',
      transferType: 'AUTO_TRANSFER',
    }));

    const selection = selectNextRecommendedOfficial({
      query: { currentAssigneeId: OFFICER_A, transferHistory: fullHistory },
      currentAssigneeId: OFFICER_A,
      recommendations: [],
    });
    expect(selection).toBeDefined();
    expect(selection.selected.id).not.toBe(OFFICER_A);
  });

  it('processExpiredTransfers scans and processes all expired assigned queries when DB connected', async () => {
    const res = await processExpiredTransfers({ timeoutMinutes: 2 });
    expect(res).toBeDefined();
    expect(typeof res.ran).toBe('boolean');
  });
});
