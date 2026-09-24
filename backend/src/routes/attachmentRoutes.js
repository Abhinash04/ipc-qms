import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import authorizeAttachmentAccess from '../middleware/authorizeAttachmentAccess.js';
import { uploadMiddleware, uploadFiles, getMeta, serveFile } from '../controllers/attachmentController.js';

const router = express.Router();
router.post('/attachments', verifyToken, authorizeAttachmentAccess, uploadMiddleware, uploadFiles);
router.get('/attachments/:id/meta', verifyToken, authorizeAttachmentAccess, getMeta);
router.get('/attachments/:id', verifyToken, authorizeAttachmentAccess, serveFile);

export default router;
