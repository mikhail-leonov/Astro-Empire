import { Router } from 'express';
import { requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as admin from '../controllers/adminController';

const router = Router();

router.get('/admin', requireAdmin, asyncHandler(admin.showAdmin));

router.post('/admin/users/:id', requireAdmin, asyncHandler(admin.updateUser));
router.post('/admin/users/:id/delete', requireAdmin, asyncHandler(admin.deleteUser));

router.post('/admin/tiers', requireAdmin, asyncHandler(admin.createTier));
router.post('/admin/tiers/:id', requireAdmin, asyncHandler(admin.updateTier));
router.post('/admin/tiers/:id/delete', requireAdmin, asyncHandler(admin.deleteTier));

export default router;
