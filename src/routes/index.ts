import { Router } from 'express';
import setupRoutes from './setupRoutes';
import authRoutes from './authRoutes';
import adminRoutes from './adminRoutes';
import resetRoutes from './resetRoutes';

const router = Router();

router.use('/', setupRoutes);
router.use('/', authRoutes);
router.use('/', adminRoutes);
router.use('/', resetRoutes);

export default router;
