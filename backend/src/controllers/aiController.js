import HTTP_STATUS from '../constants/httpStatus.js';
import * as gemmaService from '../services/ai/gemmaService.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';

/**
 * AI calls are audited so an administrator can answer the question that
 * actually matters: was this text written by the model, or by the deterministic
 * fallback after the endpoint failed to answer?
 *
 * `gemmaService` degrades silently by design — a timeout returns a fallback
 * rather than throwing — so without this record a run of total LLM outage is
 * indistinguishable from normal operation.
 *
 * Prompts and generated content are never recorded: only whether it worked,
 * how long it took, and whether it fell back.
 */
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
      // `fallback: true` means the model did not answer and deterministic text
      // was substituted — a success for the user, a failure for the model.
      fallback,
      aiGenerated: error ? false : !fallback,
      // Drafts ask one question at a time, so the draft as a whole is no longer
      // simply "model" or "fallback": some questions can answer while others
      // degrade. These counts (answered / repaired / failed / noEvidence) are what
      // distinguish a healthy draft from one that mostly fell back. Still counts
      // only — no prompts, no generated content.
      ...(output?.stats ? { stats: output.stats } : {}),
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
