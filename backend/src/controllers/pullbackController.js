import HTTP_STATUS from '../constants/httpStatus.js';
import { isConnected } from '../config/db.js';
import { QueryCase } from '../models/index.js';
import * as audit from '../services/audit/auditService.js';
import { ACTOR_TYPES } from '../constants/roles.js';

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
      { $set: { workflowState: targetStage, updatedAt: new Date().toISOString() }, $inc: { revision: 1 } },
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
