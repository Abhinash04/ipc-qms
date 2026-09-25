import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { login, logout, me, users, devLogin, register, googleAuth } from '../controllers/authController.js';

const router = express.Router();

router.post('/auth/login', login);
router.post('/auth/register', register);
router.post('/auth/google', googleAuth);
router.post('/auth/logout', logout);
router.post('/auth/dev-login', devLogin);
router.get('/auth/me', verifyToken, me);
router.get('/auth/users', verifyToken, users);

export default router;
