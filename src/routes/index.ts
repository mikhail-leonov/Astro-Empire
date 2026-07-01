import { Router } from 'express';
import setupRoutes from './setupRoutes';
import authRoutes from './authRoutes';
import adminRoutes from './adminRoutes';

const router = Router();

router.use('/', setupRoutes);
router.use('/', authRoutes);
router.use('/', adminRoutes);

export default router;
