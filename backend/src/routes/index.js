import express from 'express';
import healthRoutes from './healthRoutes.js';
import authRoutes from './authRoutes.js';
import emailRoutes from './emailRoutes.js';
import mailboxRoutes from './mailboxRoutes.js';
import aiRoutes from './aiRoutes.js';
import attachmentRoutes from './attachmentRoutes.js';
import nicRoutes from './nicRoutes.js';
import auditRoutes from './auditRoutes.js';
import pullbackRoutes from './pullbackRoutes.js';

const router = express.Router();

// Authentication is applied per route inside each router, not globally here,
// so that GET /health and POST /auth/login stay public — see
// .claude/backend-rules.md and middleware/verifyToken.js.
router.use(healthRoutes);
router.use(authRoutes);
router.use(emailRoutes);
router.use(mailboxRoutes);
router.use('/ai', aiRoutes);
router.use(attachmentRoutes);
router.use(nicRoutes);
router.use(auditRoutes);
router.use(pullbackRoutes);

export default router;

