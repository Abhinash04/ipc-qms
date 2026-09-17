import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import {
  loadAllQueries,
  checkIsEmpty,
  persistTransition,
  resetQueryState,
} from '../controllers/queryController.js';

const router = express.Router();

router.get('/queries', verifyToken, loadAllQueries);
router.get('/queries/is-empty', verifyToken, checkIsEmpty);
router.post('/queries/persist', verifyToken, persistTransition);
router.post('/queries/reset', verifyToken, resetQueryState);

export default router;
