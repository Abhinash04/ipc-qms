import express from 'express';
import healthRoutes from './healthRoutes.js';
import emailRoutes from './emailRoutes.js';
import mailboxRoutes from './mailboxRoutes.js';
import aiRoutes from './aiRoutes.js';
import attachmentRoutes from './attachmentRoutes.js';

const router = express.Router();

router.use(healthRoutes);
router.use(emailRoutes);
router.use(mailboxRoutes);
router.use('/ai', aiRoutes);
router.use(attachmentRoutes);

export default router;

