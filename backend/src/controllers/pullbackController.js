import HTTP_STATUS from '../constants/httpStatus.js';
import { isConnected } from '../config/db.js';
import { QueryCase } from '../models/index.js';
import * as audit from '../services/audit/auditService.js';
import { ACTOR_TYPES } from '../constants/roles.js';

/**
 * Pull a case back to an earlier workflow stage.
 *
 * This endpoint used to validate its input and then return a success envelope
 * without writing anything — a caller was told the pullback had happened when
 * nothing had. It now performs the state change it reports.
 *
 * Note for anyone wiring a client to it: the UI currently pulls back through
 * the store's `pullBackQuery`, which lands in Mongo via POST /queries/persist
 * along with the richer client-side record (pullbackHistory, workflow steps).
 * This endpoint writes the authoritative half — `workflowState` and the audit
 * event — and is the server-side path to adopt as workflow enforcement moves
 * off the client. The write is an idempotent upsert on `queryId`, so a client
 * that calls both does not corrupt the case.
 */
async function pullBackQuery(req, res, next) {
  if (!isConnected()) {
    return next(
      Object.assign(new Error('Query storage is unavailable'), {
        status: HTTP_STATUS.SERVICE_UNAVAILABLE,
      }),
    );
  }

  try {
    const { queryId } = req.params;
    const { targetStage, reason, remarks } = req.body;

    const updated = await QueryCase.findOneAndUpdate(
      { queryId },
      { $set: { workflowState: targetStage, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    ).lean();

    if (!updated) {
      return next(
        Object.assign(new Error(`No query case ${queryId}`), { status: HTTP_STATUS.NOT_FOUND }),
      );
    }

    const pulledBackAt = new Date().toISOString();

    await audit.record({
      action: 'QUERY_PULLED_BACK',
      timestamp: pulledBackAt,
      queryId,
      actorType: ACTOR_TYPES.HUMAN,
      actorId: req.user.id,
      actorRole: req.user.role,
      details: { targetStage, reason, remarks },
    });

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      queryId,
      targetStage,
      reason,
      remarks,
      // Identity comes from the session. The previous handler fell back to a
      // hardcoded 'USR-0008' / 'System Administrator' when the session carried
      // no name, which put a fictional actor in the response.
      pulledBackBy: {
        id: req.user.id,
        name: req.user.name,
        role: req.user.role,
      },
      pulledBackAt,
      message: `Query ${queryId} has been successfully pulled back to ${targetStage}.`,
    });
  } catch (error) {
    return next(error);
  }
}

export { pullBackQuery };
