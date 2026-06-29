import { Router } from 'express';
import setupRoutes from './setupRoutes';
import authRoutes from './authRoutes';

const router = Router();

router.use('/', setupRoutes);
router.use('/', authRoutes);

export default router;
