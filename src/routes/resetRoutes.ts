import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as reset from '../controllers/resetController';

const router = Router();

// GET (not POST) is deliberate — this is meant to be reachable by just
// visiting the URL, "at any stage" of the app's boot state. See
// src/controllers/resetController.ts for why that's safe here: it's gated
// on whether the target database already has real accounts, not on request
// method.
router.get('/reset', asyncHandler(reset.resetDatabase));

export default router;
