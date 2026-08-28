import express from 'express';
import authorizeAttachmentAccess from '../middleware/authorizeAttachmentAccess.js';
import { uploadMiddleware, uploadFiles, getMeta, serveFile } from '../controllers/attachmentController.js';

const router = express.Router();

router.post('/attachments', authorizeAttachmentAccess, uploadMiddleware, uploadFiles);
router.get('/attachments/:id/meta', authorizeAttachmentAccess, getMeta);
router.get('/attachments/:id', authorizeAttachmentAccess, serveFile);

export default router;
