import express from 'express';
import healthRoutes from './healthRoutes.js';
import emailRoutes from './emailRoutes.js';
import mailboxRoutes from './mailboxRoutes.js';

const router = express.Router();

router.use(healthRoutes);
router.use(emailRoutes);
router.use(mailboxRoutes);

export default router;
