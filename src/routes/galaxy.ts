import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as galaxy from '../services/galaxyService';

const router = Router();

/** API routes need a 401 JSON response on auth failure, not a page redirect. */
function requireAuthJson(req: Request, res: Response, next: NextFunction): void {
  if (req.session.userId) { next(); return; }
  res.status(401).json({ ok: false, error: 'Not logged in' });
}

/**
 * FIX: /generate used to be reachable by any authenticated user via
 * requireAuthJson, yet it truncates gx_systems/gx_astros and deletes every
 * player's remote bases + gx_claims rows, and grants the caller
 * 100,000,000 credits. Any logged-in commander could wipe the whole galaxy
 * and every other player's colonies, and self-enrich, in a single request.
 * It is now admin-only, same as the JSON-401 pattern used elsewhere in this
 * file (401 for "not logged in", 403 for "logged in but not admin").
 */
function requireAdminJson(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) { res.status(401).json({ ok: false, error: 'Not logged in' }); return; }
  if (req.session.role !== 'admin') { res.status(403).json({ ok: false, error: 'Admin access required' }); return; }
  next();
}

/** Ensure the logged-in user has a `players` row, return its id. */
async function playerIdFor(req: any): Promise<number> {
  const userId = req.session.userId as number;
  const desiredName = (req.session.username as string) || 'Nova Imperium';
  return galaxy.ensurePlayerForUser(userId, desiredName);
}

// ---------------------------------------------------------------- game state
router.get('/state', requireAuthJson, asyncHandler(async (req, res) => {
  const playerId = await playerIdFor(req);
  const state = await galaxy.getFullState(playerId);
  res.json({ ok: true, state });
}));

router.post('/newgame', requireAuthJson, asyncHandler(async (req, res) => {
  const playerId = await playerIdFor(req);
  const name = String(req.body?.name || 'Nova Imperium').trim().slice(0, 22) || 'Nova Imperium';
  await galaxy.newGame(playerId, name);
  const state = await galaxy.getFullState(playerId);
  res.json({ ok: true, state });
}));

router.post('/struct/upgrade', requireAuthJson, asyncHandler(async (req, res) => {
  const playerId = await playerIdFor(req);
  const result = await galaxy.upgradeStruct(playerId, Number(req.body?.baseId), String(req.body?.key));
  res.json(result);
}));

router.post('/ship/build', requireAuthJson, asyncHandler(async (req, res) => {
  const playerId = await playerIdFor(req);
  const result = await galaxy.buildShip(playerId, Number(req.body?.baseId), String(req.body?.key), Number(req.body?.qty) || 1);
  res.json(result);
}));

router.post('/queue/cancel', requireAuthJson, asyncHandler(async (req, res) => {
  const playerId = await playerIdFor(req);
  const result = await galaxy.cancelQueueItem(playerId, Number(req.body?.baseId), Number(req.body?.idx));
  res.json(result);
}));

router.post('/research/start', requireAuthJson, asyncHandler(async (req, res) => {
  const playerId = await playerIdFor(req);
  const result = await galaxy.startResearch(playerId, String(req.body?.key));
  res.json(result);
}));

router.post('/research/cancel', requireAuthJson, asyncHandler(async (req, res) => {
  const playerId = await playerIdFor(req);
  const result = await galaxy.cancelResearch(playerId);
  res.json(result);
}));

router.post('/fleet/send', requireAuthJson, asyncHandler(async (req, res) => {
  const playerId = await playerIdFor(req);
  const { originBaseId, target, mission, ships } = req.body || {};
  const result = await galaxy.sendFleet(playerId, Number(originBaseId), target, String(mission), ships || {});
  res.json(result);
}));

router.post('/fleet/recall', requireAuthJson, asyncHandler(async (req, res) => {
  const playerId = await playerIdFor(req);
  const result = await galaxy.recallFleet(playerId, Number(req.body?.fleetId));
  res.json(result);
}));

// Colonize a procedurally generated Galaxy-Gen astro (Outpost Ship, remote).
// FIX: `size` used to be taken directly from the client and trusted as the
// new base's building-slot capacity. galaxyService.sendColonize() now looks
// the address up in gx_astros itself and uses the DB's real `area` value,
// ignoring whatever the client sends, so a modified client can no longer
// grant itself an oversized base by lying about `size`.
router.post('/colonize', requireAuthJson, asyncHandler(async (req, res) => {
  const playerId = await playerIdFor(req);
  const result = await galaxy.sendColonize(playerId, String(req.body?.address));
  res.json(result);
}));

// ---------------------------------------------------------------- galaxy gen
// Generate: clear the galaxy tables and repopulate from the config. Grants
// the requesting commander 100,000,000 credits once the galaxy is ready.
// FIX: admin-only now — see requireAdminJson above.
router.post('/generate', requireAdminJson, asyncHandler(async (req, res) => {
  const playerId = await playerIdFor(req);
  const out = await galaxy.clearAndGenerate(req.body || {}, playerId);
  res.json({ ok: true, ...out });
}));

// Stage 1/2: occupied system slots for a galaxy.
router.get('/map', asyncHandler(async (req, res) => {
  const server = String(req.query.server || 'B');
  const galaxyNo = Number(req.query.galaxy || 1);
  const systems = await galaxy.readMap(server, galaxyNo);
  res.json({ ok: true, systems });
}));

// Stage 3: one system's astros.
router.get('/system/:server/:galaxy/:region/:system', asyncHandler(async (req, res) => {
  const system = await galaxy.readSystem(
    String(req.params.server),
    Number(req.params.galaxy),
    Number(req.params.region),
    Number(req.params.system),
  );
  res.json({ ok: true, system });
}));

export default router;
