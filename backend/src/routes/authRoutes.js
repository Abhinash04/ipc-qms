import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { login, logout, me } from '../controllers/authController.js';

const router = express.Router();

// Public: login is how a session is obtained, and logout must still clear a
// cookie whose token has already expired.
router.post('/auth/login', login);
router.post('/auth/logout', logout);

router.get('/auth/me', verifyToken, me);

export default router;
