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
import queryRoutes from './queryRoutes.js';

const router = express.Router();
router.use(healthRoutes);
router.use(authRoutes);
router.use(emailRoutes);
router.use(mailboxRoutes);
router.use('/ai', aiRoutes);
router.use(attachmentRoutes);
router.use(nicRoutes);
router.use(auditRoutes);
router.use(pullbackRoutes);
router.use(queryRoutes);

export default router;

