import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import * as aiController from '../controllers/aiController.js';

const router = express.Router();

// Any signed-in role may use the AI helpers, but anonymous callers may not —
// these spend real time and budget against an external LLM endpoint.
router.post('/summary', verifyToken, aiController.generateSummary);
router.post('/recommend', verifyToken, aiController.recommendOfficial);
router.post('/draft', verifyToken, aiController.generateDraft);

export default router;
