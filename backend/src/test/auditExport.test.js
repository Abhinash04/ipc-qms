import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import { AUDIT_ACTIONS } from '../constants/auditActions.js';
import * as audit from '../services/audit/auditService.js';
import { buildCsv, contentDigest, csvCell } from '../services/audit/auditReport.js';
import { sha256 } from '../services/audit/auditChain.js';

const ADMIN = authHeader(ROLES.ADMIN);

const binary = (res, callback) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

const exportAs = (format, query = {}) =>
  request(app)
    .get('/api/v1/audit/export')
    .query({ format, ...query })
    .set(ADMIN)
    .buffer(true)
    .parse(binary);

beforeEach(() => {
  audit.resetBuffer();
});

describe('CSV cells', () => {
  it('quotes commas, quotes and line breaks per RFC 4180', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });

  it.each(['=HYPERLINK("x")', '+1', '-1+1', '@SUM(A1)', '\tx', '\rx'])(
    'neutralises a would-be formula: %j',
    (value) => {
      expect(csvCell(value).replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );

  it('leaves ordinary text alone', () => {
    expect(csvCell('QUERY_ASSIGNED')).toBe('QUERY_ASSIGNED');
  });

  it('writes a header, CRLF rows and a BOM so Excel reads Hindi correctly', () => {
    const csv = buildCsv([{ seq: 1, action: 'EMAIL_SENT', details: { subject: 'भेषज' } }]).toString('utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('\r\n');
    expect(csv.split('\r\n')[0]).toContain('seq,timestamp,action');
    expect(csv).toContain('भेषज');
  });
});

describe('GET /audit/export', () => {
  it('is administrator-only', async () => {
    const res = await request(app).get('/api/v1/audit/export?format=csv').set(authHeader(ROLES.REVIEWER));
    expect(res.status).toBe(403);
  });

  it('rejects an unknown format', async () => {
    const res = await request(app).get('/api/v1/audit/export?format=xlsx').set(ADMIN);
    expect(res.status).toBe(400);
  });

  it('exports the filtered events as CSV with a content digest', async () => {
    await audit.record({ action: AUDIT_ACTIONS.EMAIL_SENT, messageId: 'MSG-1', error: '=1+2' });
    await audit.record({ action: AUDIT_ACTIONS.EMAIL_RECEIVED, messageId: 'MSG-2' });

    const res = await exportAs('csv', { action: AUDIT_ACTIONS.EMAIL_SENT });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="audit-report-BRIDGETECH-ATR-\d{4}-\d{2}-\d{3}\.csv"/);
    expect(res.headers['x-report-rows']).toBe('1');
    expect(res.headers['x-file-sha256']).toBe(sha256(res.body));

    const text = res.body.toString('utf8');
    expect(text).toContain('MSG-1');
    expect(text).not.toContain('MSG-2');
    expect(text).toContain("'=1+2"); // a formula-looking cell is neutralised
  });

  it('exports a PDF of the same selection with the same content digest', async () => {
    await audit.record({ action: AUDIT_ACTIONS.EMAIL_SENT, messageId: 'MSG-1' });

    const csv = await exportAs('csv', { action: AUDIT_ACTIONS.EMAIL_SENT });
    const pdf = await exportAs('pdf', { action: AUDIT_ACTIONS.EMAIL_SENT });

    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.headers['x-report-sha256']).toBe(csv.headers['x-report-sha256']);
  });

  it('puts the export itself on the record, with its digests', async () => {
    await audit.record({ action: AUDIT_ACTIONS.EMAIL_SENT });

    const res = await exportAs('csv', { action: AUDIT_ACTIONS.EMAIL_SENT });

    const [exported] = await audit.list({ action: AUDIT_ACTIONS.AUDIT_EXPORTED });
    expect(exported).toMatchObject({
      actorId: expect.any(String),
      actorRole: ROLES.ADMIN,
      details: expect.objectContaining({
        format: 'csv',
        rows: 1,
        digest: res.headers['x-report-sha256'],
        fileDigest: res.headers['x-file-sha256'],
      }),
    });
  });

  it('gives the same selection the same digest when only its wording has changed since', async () => {
    const queryId = 'QRY-2026-00077';
    await audit.record({ action: 'QUERY_ASSIGNED', actorType: 'human', queryId, timestamp: '2026-09-01T05:00:00.000Z' });
    await audit.record({ action: 'REVIEW_COMPLETED', actorType: 'human', queryId, timestamp: '2026-09-01T06:00:00.000Z' });
    const selection = { queryId, to: '2026-09-01T07:00:00.000Z' };

    const first = await exportAs('csv', selection);
    // A later second review changes the status worked out for the first one, outside the selection.
    await audit.record({ action: 'REVIEW_COMPLETED', actorType: 'human', queryId, timestamp: '2026-09-02T06:00:00.000Z' });
    const second = await exportAs('csv', selection);

    expect(second.body.toString('utf8')).not.toBe(first.body.toString('utf8'));
    expect(second.headers['x-report-sha256']).toBe(first.headers['x-report-sha256']);
  });

  it('produces a digest that depends on every exported row', async () => {
    const one = [{ seq: 1, action: 'EMAIL_SENT', timestamp: 't' }];
    const edited = [{ seq: 1, action: 'EMAIL_SENT', timestamp: 't2' }];
    expect(contentDigest(one)).not.toBe(contentDigest(edited));
    expect(contentDigest(one)).toBe(contentDigest([{ ...one[0] }]));
  });

  it('marks events still only in memory as unpersisted rather than hiding them', async () => {
    await audit.record({ action: AUDIT_ACTIONS.EMAIL_SENT });

    const res = await exportAs('csv', { action: AUDIT_ACTIONS.EMAIL_SENT });
    expect(res.body.toString('utf8')).toContain(',unpersisted,');
  });
});

describe('GET /audit/verify', () => {
  it('is administrator-only', async () => {
    const res = await request(app).get('/api/v1/audit/verify').set(authHeader(ROLES.FRONT_OFFICE));
    expect(res.status).toBe(403);
  });

  it('reports the chain and records that it was checked', async () => {
    const res = await request(app).get('/api/v1/audit/verify').set(ADMIN);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, checked: expect.any(Number), unpersisted: expect.any(Number) });
    expect(await audit.list({ action: AUDIT_ACTIONS.AUDIT_VERIFIED })).toHaveLength(1);
  });
});
