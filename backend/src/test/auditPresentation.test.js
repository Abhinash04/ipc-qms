import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { extractText, getDocumentProxy } from 'unpdf';
import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import { AUDIT_ACTIONS } from '../constants/auditActions.js';
import * as audit from '../services/audit/auditService.js';
import { buildPdf, buildCsv } from '../services/audit/auditReport.js';
import { computeHash, GENESIS_HASH } from '../services/audit/auditChain.js';
import {
  activityLabel,
  describeDetails,
  describeDevice,
  formatDateTime,
  moduleOf,
  present,
} from '../services/audit/auditPresentation.js';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const pdfText = async (buffer) => {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(buffer)), { mergePages: true });
  return text;
};

beforeEach(() => audit.resetBuffer());

describe('how an audit event reads', () => {
  it('names every activity in plain words, never as a slug', () => {
    expect(activityLabel('EMAIL_SEND_FAILED')).toBe('Email could not be sent');
    expect(activityLabel('QUERY_ASSIGNED')).toBe('Given to an officer to answer');
    expect(activityLabel('AUTHORIZATION_DENIED')).toBe('Tried to open something without permission');
    expect(activityLabel('SOME_NEW_THING')).toBe('Some new thing');
    for (const action of Object.values(AUDIT_ACTIONS)) expect(activityLabel(action)).not.toMatch(/_/);
  });

  it('reads an automatic transfer like a person’s, with who it went from and to', () => {
    const view = present({
      action: 'QUERY_AUTO_TRANSFERRED',
      actorType: 'system',
      actorRole: 'SYSTEM',
      queryId: 'QRY-2026-00050',
      details:
        'Case ID: QRY-2026-00050 | Transferred From: Neha Singh | Transferred To: EduTR Zairza | Transferred By: System (automatic) | Reason: No action within 30 minutes',
      changes: { assignee: { from: 'USR-0004', to: 'USR-0003' } },
    });
    expect(view).toMatchObject({
      who: 'System (automatic)',
      activity: 'Handed over to another officer automatically',
      other: 'To: EduTR Zairza (Officer-in-Charge)',
      previousValue: 'Neha Singh',
      newValue: 'EduTR Zairza',
    });
    expect(view.did).toMatch(/^Handed query QRY-2026-00050 over automatically from Neha Singh \(.+\) \(reason: No action within 30 minutes\)$/);
  });

  it('says why an automatic transfer found no one', () => {
    const view = present({
      action: 'QUERY_AUTO_TRANSFER_FAILED',
      actorType: 'system',
      queryId: 'QRY-2026-00050',
      result: 'failure',
      details: 'Case ID: QRY-2026-00050 | Held By: Neha Singh | Reason: No eligible recommended official remains',
    });
    expect(view.did).toMatch(/^Could not hand query QRY-2026-00050 over automatically; it stays with Neha Singh \(.+\) \(reason: No eligible/);
  });

  it('puts each activity in a module', () => {
    expect(moduleOf('LOGIN_FAILED')).toBe('Login & access');
    expect(moduleOf('EMAIL_SENT')).toBe('Email');
    expect(moduleOf('AI_DRAFT_GENERATED')).toBe('Automatic help');
    expect(moduleOf('ATTACHMENT_DOWNLOADED')).toBe('Files');
    expect(moduleOf('QUERY_ASSIGNED')).toBe('Query handling');
    expect(moduleOf('AUDIT_EXPORTED')).toBe('Activity records');
  });

  it('writes details as sentences, not JSON, and hides integrity values', () => {
    const text = describeDetails({
      details: { filename: 'coa.pdf', size: 248311, chainOk: true, digest: 'ab'.repeat(32) },
    });
    expect(text).toBe('File: coa.pdf; Size: 242 KB; Integrity intact: Yes');
    expect(text).not.toMatch(/[{}"]/);
  });

  it('describes mailbox checks and junk handling in everyday words, without internal IDs', () => {
    const sync = describeDetails({
      action: 'SYNC_COMPLETED',
      details: {
        source: 'nic-browser',
        address: 'contact.ecoclubsedu@gov.in',
        trigger: 'poll',
        stored: 20,
        providerMessageIds: ['1790596211913141600', '1790596212181141200'],
      },
    });
    expect(sync).toBe('20 new emails brought in from the mailbox contact.ecoclubsedu@gov.in (automatic check)');
    expect(sync).not.toMatch(/nic-browser|poll|1790596/);

    expect(describeDetails({ action: 'EMAIL_PURGED', details: { summary: true, purged: 6, retentionHours: 42 } })).toBe(
      '6 junk emails removed after being kept 42 hours',
    );
    expect(describeDetails({ action: 'EMAIL_CLASSIFIED', details: { verdict: 'JUNK', confidence: 0.93, reason: 'newsletter', classifier: 'gemma' } })).toBe(
      'Marked as possible junk (93% sure): newsletter',
    );
    expect(describeDetails({ action: 'SOMETHING_NEW', details: { providerMessageIds: ['1'], source: 'x', count: 3 } })).toBe('Count: 3');
  });

  it('shows times in Indian Standard Time', () => {
    expect(formatDateTime('2026-10-01T03:31:02.000Z')).toBe('01 Oct 2026, 09:01:02');
  });

  it('names the browser and system', () => {
    expect(describeDevice(CHROME)).toBe('Chrome 140 on Windows');
    expect(describeDevice('')).toBe('');
  });

  it('says who acted: the person, else System or the AI assistant', () => {
    expect(present({ actorType: 'human', actorId: 'USR-0004', actorName: 'Neha Singh', actorRole: 'ASSIGNED_OFFICIAL' }))
      .toMatchObject({ user: 'Neha Singh', userId: 'USR-0004', role: 'Assigned Official' });
    expect(present({ actorType: 'system' }).user).toBe('System');
    expect(present({ actorType: 'agent' }).user).toBe('AI assistant');
  });
});

describe('who and where an event came from', () => {
  it('records the signed-in user’s name, IP address and browser on their own actions', async () => {
    await request(app)
      .get('/api/v1/audit/export')
      .query({ format: 'csv' })
      .set(authHeader(ROLES.ADMIN))
      .set('User-Agent', CHROME);

    const [exported] = await audit.list({ action: AUDIT_ACTIONS.AUDIT_EXPORTED });
    expect(exported.actorName).toBe('Suresh Gupta');
    expect(exported.source).toMatchObject({ userAgent: CHROME, method: 'GET', path: '/api/v1/audit/export' });
    expect(exported.source.ip).toMatch(/127\.0\.0\.1|::1/);
  });

  it('records the server that did work no request caused', async () => {
    await audit.record({ action: AUDIT_ACTIONS.SYNC_COMPLETED, actorType: 'system' });
    const [event] = await audit.list({ action: AUDIT_ACTIONS.SYNC_COMPLETED });
    expect(event.source).toMatchObject({ server: expect.any(String), ip: expect.stringMatching(/\d+\.\d+\.\d+\.\d+/) });
    expect(present(event).device).toBe(`Server ${event.source.server}`);
    expect(present(event).ipAddress).toBe(event.source.ip);
  });

  it('records the requester’s IP on AI work their request started', async () => {
    await request(app)
      .post('/api/v1/ai/summary')
      .set(authHeader(ROLES.FRONT_OFFICE))
      .set('User-Agent', CHROME)
      .send({ subject: 'Dissolution limits', body: 'Which dissolution limits apply?' });
    const [event] = await audit.list({ action: AUDIT_ACTIONS.AI_SUMMARY_GENERATED });
    expect(event.source).toMatchObject({ userAgent: CHROME, path: '/api/v1/ai/summary' });
  });

  it('looks up the name of a user an older event stored only by ID', async () => {
    await audit.record({ action: 'QUERY_ASSIGNED', actorType: 'human', actorId: 'USR-0003', actorRole: 'OFFICER_IN_CHARGE' });
    const res = await request(app).get('/api/v1/audit').query({ action: 'QUERY_ASSIGNED' }).set(authHeader(ROLES.ADMIN));
    expect(res.body.events[0].view).toMatchObject({ user: 'EduTR Zairza', userId: 'USR-0003', role: 'Officer-in-Charge' });

    const [named] = await audit.withActorNames([{ actorId: 'USR-0004' }, { actorId: 'USR-UNKNOWN' }]);
    expect(named.actorName).toBe('Neha Singh');
  });

  it('shows previous and new values for older records worked out from the query history, marked as inferred', async () => {
    await audit.record({ action: 'QUERY_RECEIVED', actorType: 'human', queryId: 'QRY-2026-00090' });
    await audit.record({ action: 'QUERY_REGISTERED', actorType: 'human', queryId: 'QRY-2026-00090' });
    await audit.record({ action: 'QUERY_FORWARDED', actorType: 'human', queryId: 'QRY-2026-00090' });
    const res = await request(app).get('/api/v1/audit').query({ action: 'QUERY_FORWARDED' }).set(authHeader(ROLES.ADMIN));
    expect(res.body.events[0].view).toMatchObject({
      previousValue: 'Being checked by Front Office (inferred)',
      newValue: 'Waiting to be given to an officer (inferred)',
    });
  });

  it('reads a name an older browser event stored in the role field', () => {
    expect(present({ action: 'QUERY_ASSIGNED', actorType: 'human', actorRole: 'Priya Sharma' })).toMatchObject({
      user: 'Priya Sharma',
      role: '',
    });
    expect(present({ action: 'QUERY_ASSIGNED', actorType: 'human', actorId: 'USR-0099' }).user).toBe('USR-0099');
  });

  it('says an older event’s IP was not recorded', () => {
    expect(present({ action: 'EMAIL_SENT', actorType: 'system' }).ipAddress).toBe('Not recorded');
  });

  it('keeps the hash of an event recorded before name and IP existed', () => {
    const older = { seq: 1, prevHash: GENESIS_HASH, timestamp: '2026-09-01T00:00:00.000Z', action: 'EMAIL_SENT' };
    expect(computeHash({ ...older, actorName: null, source: null })).toBe(computeHash(older));
    expect(computeHash({ ...older, source: { ip: '10.0.0.1' } })).not.toBe(computeHash(older));
  });
});

describe('the PDF report', () => {
  const rows = [
    {
      seq: 41,
      timestamp: '2026-10-01T05:11:09.000Z',
      action: 'EMAIL_SEND_FAILED',
      result: 'failure',
      actorType: 'human',
      actorId: 'USR-0014',
      actorRole: 'FRONT_OFFICE',
      actorName: 'Priya Sharma',
      source: { ip: '10.21.4.18', userAgent: CHROME },
      queryId: 'QRY-2026-00043',
      error: 'SMTP connection timed out',
      details: { to: 'ravi@pharma.example' },
      hash: 'f'.repeat(64),
    },
    { seq: 42, timestamp: '2026-10-01T05:12:00.000Z', action: 'SYNC_COMPLETED', result: 'success', actorType: 'system' },
  ];

  it('is a register with serial numbers, names, roles, IP addresses and plain activities', async () => {
    const text = await pdfText(
      await buildPdf({ rows, filters: {}, generatedBy: 'Suresh Gupta', generatedAt: '2026-10-01T09:15:27.000Z' }),
    );

    expect(text).toContain('Report generated by Suresh Gupta');
    expect(text).toContain('Report generated on 01 Oct 2026, 14:45:27 IST');
    for (const header of ['S.No.', 'Audit ID', 'User', 'Source IP', 'Case No.', 'Module', 'Activity', 'Result']) {
      expect(text).toContain(header);
    }
    const trail = text.slice(text.indexOf('3. Detailed Audit Trail'), text.indexOf('4. Mandatory Audit Information'));
    expect(trail).not.toMatch(/Previous value|New value/);
    expect(trail).toContain('Priya Sharma (Front Office)');
    expect(trail).toMatch(/Tried to send an email for query\s+QRY-2026-00043, but it did not go out/);
    expect(trail).toContain('System (automatic)');
    expect(text).toContain('10.21.4.18');
    expect(text).toMatch(/Page 1 of \d+/);
  });

  it('carries no chain internals, hashes, sequence numbers or slugs', async () => {
    const text = await pdfText(
      await buildPdf({ rows, filters: {}, generatedBy: 'Suresh Gupta', generatedAt: '2026-10-01T09:15:27.000Z' }),
    );

    for (const gone of ['Chain status', 'Chain verification', 'SHA-256', 'HMAC', 'Hash', 'Seq', '#41', 'fffff', 'EMAIL_SEND_FAILED', '{"']) {
      expect(text).not.toContain(gone);
    }
  });

  it('names the latest audit record at the time of the report, without its seal', async () => {
    const text = await pdfText(
      await buildPdf({
        rows,
        filters: {},
        generatedBy: 'A',
        generatedAt: '2026-10-01T09:15:27.000Z',
        verification: { ok: true, checked: 57, head: { seq: 57, hash: 'a'.repeat(64) } },
      }),
    );
    expect(text).toMatch(/Latest audit record\s+AUD-000057, when this report was made/);
    expect(text).not.toContain('aaaaaaaa');
  });

  it('numbers rows 1, 2, 3 whatever their chain position', async () => {
    const text = await pdfText(await buildPdf({ rows, filters: {}, generatedBy: 'A', generatedAt: '2026-10-01T09:15:27.000Z' }));
    expect(text).toMatch(/\b1\s+AUD-000041/);
    expect(text).toMatch(/\b2\s+AUD-000042/);
  });

  it('follows the government report format, section by section, with its reference', async () => {
    const text = await pdfText(
      await buildPdf({
        rows,
        filters: { queryId: 'QRY-2026-00043' },
        generatedBy: 'Suresh Gupta',
        generatedAt: '2026-10-01T06:00:00.000Z',
        verification: { ok: true, checked: 2 },
        reference: 'BRIDGETECH/ATR/2026-10/004',
      }),
    );
    for (const heading of [
      'AUDIT TRAIL REPORT',
      '1. Purpose',
      '2. Audit Period Summary',
      '3. Detailed Audit Trail',
      '4. Mandatory Audit Information',
      '5. Query Lifecycle Audit',
      '6. Authentication Audit',
      '7. Privileged / Administrative Activity',
      '8. Exception / Security Event Report',
      '9. Audit Log Integrity Controls',
      '10. Log Retention',
      '11. Access Control Review',
      '12. Audit Trail Verification Checklist',
      '13. Audit Findings',
      '14. Compliance Statement',
      '15. Sign-Off',
      'Annexure A',
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain('BRIDGETECH/ATR/2026-10/004');
    expect(text).toContain('Official / Internal Use');
    expect(text).toContain("AI-powered IP Stakeholder's BRIDGETECH");
    expect(text).not.toMatch(/IPC-QMS|IPC Query Management/);
    expect(text).not.toMatch(/Environment/);
    expect(text).toContain('Integrity check: no alteration detected in 2 records.');
    expect(text).toMatch(/Prepared by[\s\S]*Reviewed by[\s\S]*Approved by/);
  });

  it('keeps the readable columns in the CSV too', () => {
    const csv = buildCsv(rows).toString('utf8');
    expect(csv.split('\r\n')[0]).toContain('Date and time (IST),User,Role,IP address,Device name,Browser / device,Module,Activity,Case No.,Status,Description');
    expect(csv).toContain('Priya Sharma');
    expect(csv).toContain('Email could not be sent');
  });
});
