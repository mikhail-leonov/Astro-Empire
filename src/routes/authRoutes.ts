import { Router } from 'express';
import { requireAuth, requireGuest } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as auth from '../controllers/authController';

const router = Router();

router.get('/', auth.home);

router.get('/register', requireGuest, auth.showRegister);
router.post('/register', requireGuest, asyncHandler(auth.register));

router.get('/login', requireGuest, auth.showLogin);
router.post('/login', requireGuest, asyncHandler(auth.login));

router.post('/logout', requireAuth, auth.logout);

router.get('/account', requireAuth, asyncHandler(auth.account));
router.post('/account/delete', requireAuth, asyncHandler(auth.deleteAccount));

export default router;
