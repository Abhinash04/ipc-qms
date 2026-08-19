import express from 'express';
import healthRoutes from './healthRoutes.js';
import emailRoutes from './emailRoutes.js';
import mailboxRoutes from './mailboxRoutes.js';
import aiRoutes from './aiRoutes.js';

const router = express.Router();

router.use(healthRoutes);
router.use(emailRoutes);
router.use(mailboxRoutes);
router.use('/ai', aiRoutes);

export default router;

