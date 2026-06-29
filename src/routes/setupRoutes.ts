import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as setup from '../controllers/setupController';

const router = Router();

router.get('/setup', setup.showSetup);
router.post('/setup', asyncHandler(setup.saveSetup));

export default router;
