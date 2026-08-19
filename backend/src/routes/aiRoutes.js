import express from 'express';
import * as aiController from '../controllers/aiController.js';

const router = express.Router();

router.post('/summary', aiController.generateSummary);
router.post('/recommend', aiController.recommendOfficial);

export default router;
