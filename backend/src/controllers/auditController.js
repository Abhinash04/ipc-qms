import HTTP_STATUS from '../constants/httpStatus.js';
import * as audit from '../services/audit/auditService.js';

/**
 * The audit read API — what makes the Administration console real rather than
 * decorative. Everything served here is a persisted record of something the
 * server actually did.
 *
 * Access is restricted to ADMIN and SUPER_ADMIN in routes/auditRoutes.js.
 */

const MAX_LIMIT = 500;

/** Query strings are always text; coerce and clamp rather than trusting them. */
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

async function listEvents(req, res, next) {
  try {
    const criteria = { ...readFilters(req.query), ...readPaging(req.query) };
    const events = await audit.list(criteria);

    res.status(HTTP_STATUS.OK).json({
      events,
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

/** Everything the server knows about one case, oldest first for a timeline. */
async function getForQuery(req, res, next) {
  try {
    const events = await audit.list({ queryId: req.params.queryId, limit: MAX_LIMIT });

    res.status(HTTP_STATUS.OK).json({
      queryId: req.params.queryId,
      events: [...events].reverse(),
      count: events.length,
    });
  } catch (error) {
    next(error);
  }
}

export { listEvents, getSummary, getForQuery };
