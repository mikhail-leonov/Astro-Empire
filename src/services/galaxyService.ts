// Galaxy generation service.
//
// Reuses the very same deterministic engine the browser uses
// (public/js/galaxygen.js, which also exports via module.exports) so the
// database is populated with identical results to the client preview.
import path from 'path';
import { query, execute, bulkInsert } from '../db';

// The engine is a plain CommonJS module at runtime.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const GalaxyGen: any = require(path.join(process.cwd(), 'public', 'js', 'galaxygen.js'));

export interface GenPayload {
  master?: number; size?: number; prefix?: string; number?: number;
  stars?: string; planets?: string; moons?: string; asteroids?: string; gas?: string;
  sunSize?: string; planetSize?: string; moonSize?: string;
  asteroidSize?: string; gasSize?: string; variate?: number;
}

function buildCfg(body: GenPayload) {
  const cfg = GalaxyGen.defaults({ seed: (body.master as number) || 1 });
  const keys: (keyof GenPayload)[] = [
    'size', 'stars', 'planets', 'moons', 'asteroids', 'gas',
    'sunSize', 'planetSize', 'moonSize', 'asteroidSize', 'gasSize', 'variate',
  ];
  keys.forEach((k) => { if (body[k] !== undefined) (cfg as any)[k] = body[k]; });
  if (body.master !== undefined) cfg.master = body.master | 0;
  return cfg;
}

function resolvePrefix(p?: string) { return !p || p === 'ALL' ? 'A' : p; }
function resolveNumber(n?: number | string) {
  return n === undefined || n === 'ALL' ? 1 : (n as number);
}

const SYS_COLS = ['server', 'galaxy', 'region', 'system', 'sx', 'sy', 'subx', 'suby', 'sun_size', 'address'];
const AST_COLS = ['server', 'galaxy', 'region', 'system', 'orbital', 'position', 'kind',
  'type', 'type_name', 'area', 'solar', 'fertility', 'metal', 'gas', 'crystal', 'size', 'has_base', 'address'];

function astroRow(server: string, galaxy: number, region: number, system: number, b: any): any[] {
  if (b.kind === 'gas') {
    return [server, galaxy, region, system, b.orbit, b.position, 'gas',
      'gas', 'Gas Giant', 0, 0, 0, 0, 0, 0, b.size || 0, 0, b.address];
  }
  const a = b.astro;
  return [server, galaxy, region, system, b.orbit, b.position, b.kind,
    a.type, a.typeName, a.area, a.solar, a.fertility, a.metal, a.gas, a.crystal,
    b.size || 0, b.hasBase ? 1 : 0, b.address];
}

// Clear the galaxy tables and repopulate them for the chosen galaxy.
export async function clearAndGenerate(body: GenPayload) {
  const cfg = buildCfg(body);
  const server = resolvePrefix(body.prefix);
  const galaxy = resolveNumber(body.number);
  const size = cfg.size as number;

  await execute('TRUNCATE TABLE gx_astros');
  await execute('TRUNCATE TABLE gx_systems');

  const gSeed = GalaxyGen.galaxySeed(cfg.master, server, galaxy);
  const sysRows: any[][] = [];
  const astRows: any[][] = [];

  for (let sy = 1; sy <= size; sy++) {
    for (let sx = 1; sx <= size; sx++) {
      const cells = GalaxyGen.sectorStars(gSeed, sx, sy, cfg.stars, cfg.variate);
      const region = (sy - 1) * size + sx;
      cells.forEach((c: any) => {
        const system = c.subY * 10 + c.subX + 1;
        const sys = GalaxyGen.generateSystem(cfg, server, galaxy, sx, sy, c.subX, c.subY);
        const sunSize = (sys.sun && sys.sun.sizeName) || cfg.sunSize;
        sysRows.push([server, galaxy, region, system, sx, sy, c.subX, c.subY, sunSize, sys.address]);
        sys.bodies.forEach((b: any) => {
          astRows.push(astroRow(server, galaxy, region, system, b));
          (b.moons || []).forEach((mn: any) => {
            astRows.push(astroRow(server, galaxy, region, system, mn));
          });
        });
      });
    }
  }

  await bulkInsert('gx_systems', SYS_COLS, sysRows);
  await bulkInsert('gx_astros', AST_COLS, astRows);
  return { server, galaxy, systems: sysRows.length, astros: astRows.length };
}

// Stage 1/2 data: every occupied system slot for a galaxy.
export async function readMap(server: string, galaxy: number) {
  return query(
    'SELECT region, `system`, sx, sy, subx, suby, address FROM gx_systems ' +
    'WHERE server = ? AND galaxy = ? ORDER BY region, `system`',
    [server, galaxy],
  );
}

// Stage 3 data: a single system rebuilt from its stored astros, in the shape
// the client's system page expects (bodies, with moons nested under planets).
export async function readSystem(server: string, galaxy: number, region: number, system: number) {
  const sysRows: any[] = await query(
    'SELECT address, sun_size FROM gx_systems ' +
    'WHERE server = ? AND galaxy = ? AND region = ? AND `system` = ? LIMIT 1',
    [server, galaxy, region, system],
  );
  const astros: any[] = await query(
    'SELECT * FROM gx_astros ' +
    'WHERE server = ? AND galaxy = ? AND region = ? AND `system` = ? ' +
    'ORDER BY orbital, position',
    [server, galaxy, region, system],
  );

  const ASTRO = GalaxyGen.ASTRO || {};
  const bodies: any[] = [];
  const planetByOrbital: Record<number, any> = {};
  let planet = 0, moon = 0, asteroid = 0, gas = 0;

  astros.forEach((r) => {
    if (r.kind === 'gas') {
      gas++;
      bodies.push({ kind: 'gas', orbit: r.orbital, position: r.position, address: r.address, size: r.size, hasBase: false, moons: [] });
      return;
    }
    const astro = {
      type: r.type, typeName: r.type_name,
      glyph: (ASTRO[r.type] && ASTRO[r.type].glyph) || '',
      subtype: r.kind === 'moon' ? 'moon' : r.kind === 'asteroid' ? 'asteroid' : 'planet',
      area: r.area, solar: r.solar, fertility: r.fertility,
      metal: r.metal, gas: r.gas, crystal: r.crystal,
    };
    const body: any = { kind: r.kind, orbit: r.orbital, position: r.position, address: r.address, size: r.size, hasBase: !!r.has_base, astro };
    if (r.kind === 'moon') {
      moon++;
      const host = planetByOrbital[r.orbital];
      if (host) { (host.moons = host.moons || []).push(body); return; }
      bodies.push(body); // orphan moon (shouldn't normally happen)
    } else if (r.kind === 'asteroid') {
      asteroid++;
      bodies.push(body);
    } else {
      planet++;
      body.moons = [];
      planetByOrbital[r.orbital] = body;
      bodies.push(body);
    }
  });

  return {
    address: (sysRows[0] && sysRows[0].address) || '',
    sun: { sizeName: (sysRows[0] && sysRows[0].sun_size) || 'medium' },
    bodies,
    totals: { planet, moon, asteroid, gas },
  };
}
