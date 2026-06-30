import { Router } from 'express';
import * as galaxy from '../services/galaxyService';

const router = Router();

// Generate: clear the galaxy tables and repopulate from the config.
router.post('/generate', async (req, res) => {
  try {
    const out = await galaxy.clearAndGenerate(req.body || {});
    res.json({ ok: true, ...out });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Stage 1/2: occupied system slots for a galaxy.
router.get('/map', async (req, res) => {
  try {
    const server = String(req.query.server || 'B');
    const galaxyNo = Number(req.query.galaxy || 1);
    const systems = await galaxy.readMap(server, galaxyNo);
    res.json({ ok: true, systems });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Stage 3: one system's astros.
router.get('/system/:server/:galaxy/:region/:system', async (req, res) => {
  try {
    const system = await galaxy.readSystem(
      String(req.params.server),
      Number(req.params.galaxy),
      Number(req.params.region),
      Number(req.params.system),
    );
    res.json({ ok: true, system });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

export default router;
