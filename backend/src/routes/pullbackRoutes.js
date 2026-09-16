import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { ROLES } from '../constants/roles.js';

const router = express.Router();

const handlePullback = (req, res) => {
  const user = req.user;

  // Strict Admin / Super Admin RBAC Check
  if (!user || (user.role !== ROLES.ADMIN && user.role !== ROLES.SUPER_ADMIN)) {
    return res.status(403).json({
      error: 'You do not have permission to pull back this query.',
    });
  }

  const { queryId } = req.params;
  const { targetStage, reason, remarks } = req.body;

  if (!targetStage) {
    return res.status(400).json({ error: 'A targetStage is required for pullback.' });
  }

  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'A reason for pullback is required.' });
  }

  const timestamp = new Date().toISOString();
  return res.status(200).json({
    success: true,
    queryId,
    targetStage,
    reason: String(reason).trim(),
    remarks: remarks ? String(remarks).trim() : '',
    pulledBackBy: {
      id: user.id || 'USR-0008',
      name: user.name || 'System Administrator',
      role: user.role,
    },
    pulledBackAt: timestamp,
    message: `Query ${queryId} has been successfully pulled back to ${targetStage}.`,
  });
};

router.post('/queries/:queryId/pullback', verifyToken, handlePullback);
router.post('/api/queries/:queryId/pullback', verifyToken, handlePullback);

export default router;
