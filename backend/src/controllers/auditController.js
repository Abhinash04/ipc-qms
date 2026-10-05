import HTTP_STATUS from '../constants/httpStatus.js';
import * as audit from '../services/audit/auditService.js';
import { buildCsv, buildPdf, contentDigest } from '../services/audit/auditReport.js';
import { sha256 } from '../services/audit/auditChain.js';
import { present } from '../services/audit/auditPresentation.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';

const EXPORT_FORMATS = ['csv', 'pdf'];
const MAX_EXPORT_ROWS = 50000;

const MAX_LIMIT = 500;
function readPaging(query) {
  const limit = Math.min(Math.max(parseInt(query.limit || '100', 10) || 100, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(query.offset || '0', 10) || 0, 0);
  return { limit, offset };
}

function readFilters(query) {
  return {
    action: query.action || null,
    actorType: query.actorType || null,
    actorId: query.actorId || null,
    result: query.result || null,
    queryId: query.queryId || null,
    messageId: query.messageId || null,
    from: query.from || null,
    to: query.to || null,
  };
}

// Looking at the audit trail, and a passing re-check of it, are themselves recorded once a
// minute per person (and filter set), so a page that refetches does not flood the trail.
const THROTTLE_MS = 60 * 1000;
const recentChecks = new Map();

function firstThisMinute(key) {
  const now = Date.now();
  if (now - (recentChecks.get(key) || 0) < THROTTLE_MS) return false;
  recentChecks.set(key, now);
  if (recentChecks.size > 2000) recentChecks.delete(recentChecks.keys().next().value);
  return true;
}

async function recordView(req, scope) {
  if (!firstThisMinute(`view|${req.user?.id}|${JSON.stringify(scope)}`)) return;
  await audit.record({ action: AUDIT_ACTIONS.AUDIT_VIEWED, ...actorOf(req), queryId: scope.queryId ?? null, details: scope });
}

async function listEvents(req, res, next) {
  try {
    const criteria = { ...readFilters(req.query), ...readPaging(req.query) };
    const events = await audit.withDisplayDetails(await audit.list(criteria));
    const filters = Object.fromEntries(Object.entries(readFilters(req.query)).filter(([, value]) => value));
    await recordView(req, { filters, page: Math.floor(criteria.offset / criteria.limit) + 1 });

    res.status(HTTP_STATUS.OK).json({
      // `view` is each event as a person reads it: name, role, IP address, plain-language activity.
      events: events.map((event) => ({ ...event, view: present(event) })),
      count: events.length,
      ...audit.describe(),
    });
  } catch (error) {
    next(error);
  }
}

async function getSummary(req, res, next) {
  try {
    const filters = readFilters(req.query);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [overall, today] = await Promise.all([
      audit.summary(filters),
      audit.summary({ ...filters, from: startOfToday.toISOString() }),
    ]);

    res.status(HTTP_STATUS.OK).json({ overall, today });
  } catch (error) {
    next(error);
  }
}

async function getForQuery(req, res, next) {
  try {
    const events = await audit.withDisplayDetails(await audit.list({ queryId: req.params.queryId, limit: MAX_LIMIT }));
    await recordView(req, { queryId: req.params.queryId });

    res.status(HTTP_STATUS.OK).json({
      queryId: req.params.queryId,
      events: [...events].reverse().map((event) => ({ ...event, view: present(event) })),
      count: events.length,
    });
  } catch (error) {
    next(error);
  }
}

const actorOf = (req) => ({
  actorType: ACTOR_TYPES.HUMAN,
  actorId: req.user?.id ?? null,
  actorRole: req.user?.role ?? null,
});

async function verifyChain(req, res, next) {
  try {
    const report = await audit.verifyChain();

    // A break is always recorded.
    if (!report.ok || firstThisMinute(`verify|${req.user?.id}`)) {
      await audit.record({
        action: AUDIT_ACTIONS.AUDIT_VERIFIED,
        ...actorOf(req),
        result: report.ok ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.FAILURE,
        details: {
          ok: report.ok,
          checked: report.checked,
          legacy: report.legacy,
          unpersisted: report.unpersisted,
          head: report.head,
          firstBreak: report.firstBreak,
        },
      });
    }

    res.status(HTTP_STATUS.OK).json(report);
  } catch (error) {
    next(error);
  }
}


async function exportEvents(req, res, next) {
  const format = String(req.query.format || 'csv').toLowerCase();
  if (!EXPORT_FORMATS.includes(format)) {
    return res
      .status(HTTP_STATUS.BAD_REQUEST)
      .json({ error: `format must be one of: ${EXPORT_FORMATS.join(', ')}` });
  }

  try {
    const filters = readFilters(req.query);
    // The summaries cover the whole report period; the detailed trail honours every filter.
    const periodFilters = { from: filters.from, to: filters.to };
    const narrowed = Object.entries(filters).some(([key, value]) => value && key !== 'from' && key !== 'to');
    const [{ rows: stored, truncated }, period, verification] = await Promise.all([
      audit.exportRows(filters, { max: MAX_EXPORT_ROWS }),
      format === 'pdf' && narrowed ? audit.exportRows(periodFilters, { max: MAX_EXPORT_ROWS }) : null,
      audit.verifyChain(),
    ]);
    const rows = await audit.withDisplayDetails(stored);
    const periodRows = period ? await audit.withDisplayDetails(period.rows) : rows;

    const digest = contentDigest(stored);
    const generatedAt = new Date().toISOString();
    const generatedBy = req.user?.name || req.user?.id || 'Unknown user';
    const reference = await audit.nextReportReference(generatedAt);

    const body =
      format === 'csv'
        ? buildCsv(rows)
        : await buildPdf({
            rows,
            periodRows,
            filters,
            generatedBy,
            generatedAt,
            truncated,
            verification,
            reference,
          });

    const fileDigest = sha256(body);

    // The export is itself on the record, with the digests that identify it.
    await audit.record({
      action: AUDIT_ACTIONS.AUDIT_EXPORTED,
      ...actorOf(req),
      details: {
        reference,
        format,
        filters,
        rows: rows.length,
        truncated,
        digest,
        fileDigest,
        chainOk: verification.ok,
        // The chain's last record when the report was made, to compare the trail against later.
        head: verification.head,
      },
    });

    res
      .status(HTTP_STATUS.OK)
      .set({
        'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf',
        'Content-Disposition': `attachment; filename="audit-report-${reference.replace(/\//g, '-')}.${format}"`,
        'X-Report-Reference': reference,
        'X-Report-SHA256': digest,
        'X-File-SHA256': fileDigest,
        'X-Report-Rows': String(rows.length),
        'X-Report-Truncated': String(truncated),
        'X-Chain-Verified': String(verification.ok),
        'Access-Control-Expose-Headers':
          'Content-Disposition, X-Report-Reference, X-Report-SHA256, X-File-SHA256, X-Report-Rows, X-Report-Truncated, X-Chain-Verified',
        'Cache-Control': 'no-store',
      })
      .send(body);
  } catch (error) {
    next(error);
  }
}

export { listEvents, getSummary, getForQuery, verifyChain, exportEvents };
