import express from 'express';
import * as aiController from '../controllers/aiController.js';

const router = express.Router();

router.post('/summary', aiController.generateSummary);

export default router;
