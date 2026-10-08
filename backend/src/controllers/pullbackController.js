import HTTP_STATUS from '../constants/httpStatus.js';
import { isConnected } from '../config/db.js';
import * as pullback from '../services/workflow/pullback.js';

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
    const { targetStage, reviewStepId, reason, remarks } = req.body;

    const result = await pullback.pullBackQuery({
      queryId,
      targetStage,
      reviewStepId: reviewStepId ?? null,
      reason,
      remarks,
      actor: { id: req.user.id, name: req.user.name, role: req.user.role },
    });

    const target = result.reviewLevel ? `${targetStage} (${result.reviewLevel})` : targetStage;
    return res.status(HTTP_STATUS.OK).json({
      success: true,
      queryId,
      targetStage,
      reviewLevel: result.reviewLevel,
      reason: result.history.reason,
      remarks: result.history.remarks,
      reviewCycle: result.query.reviewCycle,
      currentWorkflowStepId: result.query.currentWorkflowStepId,
      currentAssigneeId: result.query.currentAssigneeId,
      pulledBackBy: {
        id: req.user.id,
        name: req.user.name,
        role: req.user.role,
      },
      pulledBackAt: result.history.pulledBackAt,
      message: `Query ${queryId} has been successfully pulled back to ${target}.`,
    });
  } catch (error) {
    if (error instanceof pullback.PullbackError) {
      return res.status(error.status).json({ error: error.message, code: error.code, queryId: req.params.queryId });
    }
    return next(error);
  }
}

export { pullBackQuery };
