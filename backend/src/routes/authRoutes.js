import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { login, logout, me, devLogin } from '../controllers/authController.js';

const router = express.Router();

// Public: login is how a session is obtained, and logout must still clear a
// cookie whose token has already expired.
router.post('/auth/login', login);
router.post('/auth/logout', logout);

// Development only — the controller 404s unless NODE_ENV=development.
router.post('/auth/dev-login', devLogin);

router.get('/auth/me', verifyToken, me);

export default router;
