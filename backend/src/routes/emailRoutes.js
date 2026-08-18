import express from 'express';
import {
  getConfig,
  sendEnquiry,
  sendAcknowledgement,
  forwardQuery,
  sendResponse,
} from '../controllers/emailController.js';

const router = express.Router();

router.get('/emails/config', getConfig);
router.post('/emails/enquiry', sendEnquiry);
router.post('/emails/acknowledgement', sendAcknowledgement);
router.post('/emails/forward', forwardQuery);
router.post('/emails/response', sendResponse);

export default router;
