import HTTP_STATUS from '../constants/httpStatus.js';
import * as gemmaService from '../services/ai/gemmaService.js';

async function generateSummary(req, res, next) {
  try {
    const { subject, body, inquirerName } = req.body || {};
    if (!subject && !body) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: 'Either "subject" or "body" is required to generate AI summary.',
      });
    }

    const summary = await gemmaService.generateSummary({ subject, body, inquirerName });
    return res.status(HTTP_STATUS.OK).json({
      success: true,
      summary,
    });
  } catch (error) {
    return next(error);
  }
}

export { generateSummary };
