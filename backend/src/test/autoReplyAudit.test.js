import { describe, it, expect } from 'vitest';
import { present } from '../services/audit/auditPresentation.js';
import { periodSummary } from '../services/audit/auditReportData.js';
import { inferCaseChanges, changeKeyOf } from '../services/audit/caseChanges.js';

const suggested = {
  seq: 7,
  timestamp: '2026-10-05T05:00:00.000Z',
  action: 'AUTO_REPLY_SUGGESTED',
  actorType: 'system',
  messageId: 'NIC-row-1',
  details: { entryId: 'AR-PARACETAMOL-USE', topic: 'Uses of paracetamol', confidence: 1, threshold: 1, from: 'Ravi Kumar <ravi@pharma.example>', subject: 'Query' },
};

describe('how the automatic reply reads in the audit trail', () => {
  it('names the suggestion, its topic, its match and who wrote in', () => {
    const view = present(suggested);
    expect(view).toMatchObject({
      who: 'System (automatic)',
      activity: 'Automatic reply suggested',
      did: 'Suggested an automatic reply to an email on uses of paracetamol',
      other: 'From: Ravi Kumar',
      previousValue: 'Not checked',
    });
    expect(view.details).toBe('Matched the supported question on Uses of paracetamol at 100%. From Ravi Kumar <ravi@pharma.example>: "Query"');
  });

  it('says whether the Front Office edited the reply it approved', () => {
    const approved = {
      action: 'AUTO_REPLY_APPROVED',
      actorType: 'human',
      actorId: 'USR-0014',
      actorRole: 'FRONT_OFFICE',
      queryId: 'QRY-2026-00090',
      changes: { status: { from: 'FRONT_OFFICE_VERIFICATION', to: 'READY_FOR_DISPATCH' } },
      details: { entryId: 'AR-PARACETAMOL-USE', topic: 'Uses of paracetamol', confidence: 1, edited: true },
    };
    expect(present(approved)).toMatchObject({
      activity: 'Automatic reply approved',
      did: 'Approved the automatic reply for query QRY-2026-00090, after editing it',
      previousValue: 'Being checked by Front Office',
      newValue: 'Approved, ready to send',
      details: 'Reply on Uses of paracetamol edited by the Front Office before sending',
    });
    expect(present({ ...approved, details: { ...approved.details, edited: false } }).did).toMatch(/, as drafted$/);
  });

  it('gives the reason a suggestion was turned down', () => {
    const view = present({
      action: 'AUTO_REPLY_DECLINED',
      actorType: 'human',
      actorId: 'USR-0014',
      messageId: 'NIC-row-1',
      details: { entryId: 'AR-PARACETAMOL-USE', reason: 'Needs a pharmacist to answer' },
    });
    expect(view).toMatchObject({
      activity: 'Automatic reply turned down',
      did: 'Sent an email to Human Intervention instead of an automatic reply (reason: Needs a pharmacist to answer)',
      previousValue: 'Automatic reply suggested',
    });
  });

  it('names the AI preparing the reply on behalf of the Front Officer who accepted the mail', () => {
    const view = present({
      action: 'AUTO_REPLY_PREPARED',
      actorType: 'agent',
      actorId: 'USR-0014',
      actorRole: 'FRONT_OFFICE',
      queryId: 'QRY-2026-00090',
      changes: { status: { from: 'FRONT_OFFICE_VERIFICATION', to: 'READY_FOR_DISPATCH' } },
      details: { entryId: 'AR-PARACETAMOL-USE', topic: 'Uses of paracetamol', confidence: 1, threshold: 1 },
    });
    expect(view).toMatchObject({
      activity: 'Automatic reply prepared',
      did: 'Prepared the automatic reply for query QRY-2026-00090 (matched: uses of paracetamol)',
      previousValue: 'Being checked by Front Office',
      newValue: 'Approved, ready to send',
      details: 'Reply on Uses of paracetamol drafted from the supported question, matched at 100%',
    });
    expect(view.who).toMatch(/^AI assistant, on behalf of /);
  });

  it('counts the automatic replies actually sent in the period summary', () => {
    const rows = [
      suggested,
      { ...suggested, seq: 8, action: 'AUTO_REPLY_PREPARED', queryId: 'QRY-2026-00090' },
      { ...suggested, seq: 9, action: 'RESPONSE_DISPATCHED', queryId: 'QRY-2026-00090' },
      { ...suggested, seq: 10, action: 'AUTO_REPLY_PREPARED', queryId: 'QRY-2026-00091' },
      { ...suggested, seq: 11, action: 'RESPONSE_DISPATCHED', queryId: 'QRY-2026-00092' },
    ];
    expect(periodSummary(rows).find(([label]) => label === 'Automatic replies sent')[1]).toBe(1);
  });

  it('works out the status an older approval left the case in', () => {
    const history = [
      { seq: 1, timestamp: 't1', action: 'QUERY_REGISTERED', queryId: 'Q' },
      { seq: 2, timestamp: 't2', action: 'AUTO_REPLY_APPROVED', queryId: 'Q' },
    ];
    expect(inferCaseChanges(history).get(changeKeyOf(history[1]))).toEqual({
      status: { from: 'FRONT_OFFICE_VERIFICATION', to: 'READY_FOR_DISPATCH' },
    });
  });
});
