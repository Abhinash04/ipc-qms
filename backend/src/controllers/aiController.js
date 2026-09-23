import HTTP_STATUS from '../constants/httpStatus.js';
import * as gemmaService from '../services/ai/gemmaService.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';

async function recordAi({ req, action, startedAt, output, error = null }) {
  const fallback = Boolean(output?.fallback);

  await audit.record({
    action,
    actorType: ACTOR_TYPES.AGENT,
    actorId: req.user?.id ?? null,
    actorRole: req.user?.role ?? null,
    queryId: req.body?.queryId ?? null,
    result: error ? AUDIT_RESULTS.FAILURE : AUDIT_RESULTS.SUCCESS,
    error: error ? error.message : null,
    aiMetadata: {
      latencyMs: Date.now() - startedAt,
      fallback,
      aiGenerated: error ? false : !fallback,
    },
  });
}

async function generateSummary(req, res, next) {
  const startedAt = Date.now();
  try {
    const { subject, body, inquirerName } = req.body || {};
    if (!subject && !body) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: 'Either "subject" or "body" is required to generate AI summary.',
      });
    }

    const summary = await gemmaService.generateSummary({ subject, body, inquirerName });
    await recordAi({ req, action: AUDIT_ACTIONS.AI_SUMMARY_GENERATED, startedAt, output: summary });

    return res.status(HTTP_STATUS.OK).json({ success: true, summary });
  } catch (error) {
    await recordAi({ req, action: AUDIT_ACTIONS.AI_SUMMARY_GENERATED, startedAt, error });
    return next(error);
  }
}

async function recommendOfficial(req, res, next) {
  const startedAt = Date.now();
  try {
    const { subject, body, summaryText } = req.body || {};
    const recommendations = await gemmaService.recommendOfficial({ subject, body, summaryText });
    await recordAi({
      req,
      action: AUDIT_ACTIONS.AI_RECOMMENDATION_GENERATED,
      startedAt,
      output: Array.isArray(recommendations) ? recommendations[0] : recommendations,
    });

    return res.status(HTTP_STATUS.OK).json({ success: true, recommendations });
  } catch (error) {
    await recordAi({ req, action: AUDIT_ACTIONS.AI_RECOMMENDATION_GENERATED, startedAt, error });
    return next(error);
  }
}

async function generateDraft(req, res, next) {
  const startedAt = Date.now();
  try {
    const { subject, body, inquirerName, summaryText, keyPoints } = req.body || {};
    if (!subject && !body) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: 'Either "subject" or "body" is required to generate an AI draft.',
      });
    }

    const draft = await gemmaService.generateDraft({ subject, body, inquirerName, summaryText, keyPoints });
    await recordAi({ req, action: AUDIT_ACTIONS.AI_DRAFT_GENERATED, startedAt, output: draft });

    return res.status(HTTP_STATUS.OK).json({ success: true, draft });
  } catch (error) {
    await recordAi({ req, action: AUDIT_ACTIONS.AI_DRAFT_GENERATED, startedAt, error });
    return next(error);
  }
}

export { generateSummary, recommendOfficial, generateDraft };
