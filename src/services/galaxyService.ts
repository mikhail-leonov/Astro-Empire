// Galaxy / game-state service.
//
// Every piece of live game state — commanders (players), local-galaxy
// systems & planets, bases, structures, garrisoned & in-transit fleets/ships,
// the active research item and the event log — is read from and written to
// plain relational tables in src/sql/schema.sql. Nothing here is JSON: a
// "map" of levels (structures, techs) or ships is one row per key in its own
// child table, and the build queue is an ordered child table too. Nothing is
// trusted from the client except action parameters (which base, which
// structure, how many ships); every derived number (costs, timers, combat,
// income, and the per-account-tier base/queue caps) is (re)computed here.
//
// This module also keeps the original procedural Galaxy-Gen functions
// (clearAndGenerate / readMap / readSystem) used to browse/populate the
// gx_systems / gx_astros tables (src/sql/galaxy.sql) — those already used
// plain scalar columns, no JSON, and are unchanged in spirit here, just
// extended so "Generate" grants the requesting commander 100,000,000
// credits and clears any orphaned remote bases.
import path from 'path';
import { query, execute, insert, bulkInsert } from '../db';

// The client-side engine is a plain CommonJS module at runtime; reused here
// so server and browser agree on addresses, astro stats, etc.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const GalaxyGen: any = require(path.join(process.cwd(), 'public', 'js', 'galaxygen.js'));

function num(v: any): number { return typeof v === 'string' ? parseFloat(v) : (v ?? 0); }

/* ============================================================= GAME DATA */
type ReqMap = Record<string, number>;

interface StructDef {
  name: string; icon: string; cost: number; f: number; desc: string;
  energy?: (l: number) => number;
  credits?: (l: number) => number;
  research?: (l: number) => number;
  consume?: (l: number) => number;
  build?: (l: number) => number;
  slots?: (l: number) => number;
  req?: ReqMap;
}
const STRUCT: Record<string, StructDef> = {
  solar:    { name: 'Solar Plant',     icon: '☀️', cost: 60,   f: 1.55, energy: (l) => 22 * l, desc: 'Baseline power.' },
  gas:      { name: 'Gas Plant',       icon: '🛢️', cost: 160,  f: 1.6,  energy: (l) => 55 * l, req: { energy: 1 }, desc: 'More energy per slot than solar.' },
  fusion:   { name: 'Fusion Plant',    icon: '⚛️', cost: 520,  f: 1.7,  energy: (l) => 130 * l, req: { energy: 4 }, desc: 'High-output power.' },
  metro:    { name: 'Metropolis',      icon: '🏙️', cost: 220,  f: 1.6,  credits: (l) => 48 * l, consume: (l) => 16 * l, desc: 'Population & commerce.' },
  spaceport:{ name: 'Spaceport',       icon: '🛰️', cost: 320,  f: 1.6,  credits: (l) => 34 * l, consume: (l) => 12 * l, desc: 'Trade income; fleet logistics.' },
  lab:      { name: 'Research Lab',    icon: '🔬', cost: 280,  f: 1.7,  research: (l) => 22 * l, consume: (l) => 20 * l, desc: 'Research points.' },
  robotic:  { name: 'Robotic Factory', icon: '🤖', cost: 200,  f: 1.6,  consume: (l) => 10 * l, build: (l) => 0.12 * l, desc: 'Speeds construction.' },
  nanite:   { name: 'Nanite Factory',  icon: '🧬', cost: 1400, f: 1.85, consume: (l) => 42 * l, build: (l) => 0.35 * l, req: { computer: 5 }, desc: 'Much faster construction.' },
  shipyard: { name: 'Shipyard',        icon: '🏗️', cost: 560,  f: 1.6,  consume: (l) => 25 * l, desc: 'Build warships.' },
  terraform:{ name: 'Terraform',       icon: '🌍', cost: 1800, f: 1.95, slots: (l) => 2 * l, req: { energy: 6 }, desc: 'Adds building slots.' },
};
const STRUCT_ORDER = ['solar', 'gas', 'fusion', 'metro', 'spaceport', 'lab', 'robotic', 'nanite', 'shipyard', 'terraform'];

interface TechDef { name: string; icon: string; cost: number; f: number; desc: string; req?: ReqMap }
const TECH: Record<string, TechDef> = {
  energy:   { name: 'Energy',            icon: '⚡', cost: 220,  f: 1.8,  desc: 'Unlocks advanced power plants.' },
  computer: { name: 'Computer',          icon: '💾', cost: 260,  f: 1.8,  desc: 'Build-queue slots; unlocks Nanite Factory.' },
  laser:    { name: 'Laser',             icon: '🔴', cost: 320,  f: 1.85, desc: 'Core weapon tech.' },
  plasma:   { name: 'Plasma',            icon: '💥', cost: 680,  f: 2.0,  req: { laser: 5 }, desc: 'Heavy weapons.' },
  shield:   { name: 'Shielding',         icon: '🛡️', cost: 360,  f: 1.9,  desc: 'Ship shields.' },
  armour:   { name: 'Armour',            icon: '🔩', cost: 320,  f: 1.9,  desc: 'Ship hull.' },
  warp:     { name: 'Warp Drive',        icon: '🌀', cost: 420,  f: 1.9,  desc: 'Fleet speed.' },
  astro:    { name: 'Astrophysics',      icon: '🔭', cost: 900,  f: 2.2,  desc: 'Maximum bases; Outpost Ships.' },
  ai:       { name: 'Artificial Intel.', icon: '🧠', cost: 1100, f: 2.1,  desc: 'Empire-wide economy.' },
};
const TECH_ORDER = ['energy', 'computer', 'laser', 'plasma', 'shield', 'armour', 'warp', 'astro', 'ai'];

interface ShipDef {
  name: string; icon: string; cost: number; atk: number; arm: number; shd: number; hull: number;
  speed: number; req: ReqMap; colony?: boolean; desc: string;
}
const SHIP: Record<string, ShipDef> = {
  scout:    { name: 'Scout',        icon: '🛰️', cost: 70,   atk: 1,   arm: 3,   shd: 0,   hull: 5,   speed: 60, req: { shipyard: 1 }, desc: 'Probes distant systems.' },
  fighter:  { name: 'Fighter',      icon: '🚀', cost: 130,  atk: 7,   arm: 3,   shd: 1,   hull: 7,   speed: 52, req: { shipyard: 1, laser: 1 }, desc: 'Swarm attacker.' },
  corvette: { name: 'Corvette',     icon: '🛸', cost: 320,  atk: 15,  arm: 9,   shd: 4,   hull: 15,  speed: 46, req: { shipyard: 2, laser: 2 }, desc: 'Balanced light warship.' },
  frigate:  { name: 'Frigate',      icon: '✈️', cost: 760,  atk: 32,  arm: 20,  shd: 9,   hull: 32,  speed: 40, req: { shipyard: 3, laser: 4, shield: 2 }, desc: 'Durable mid-class hull.' },
  destroyer:{ name: 'Destroyer',    icon: '🚢', cost: 1700, atk: 74,  arm: 44,  shd: 20,  hull: 74,  speed: 35, req: { shipyard: 5, plasma: 1, armour: 3 }, desc: 'Heavy firepower.' },
  cruiser:  { name: 'Cruiser',      icon: '🛳️', cost: 3600, atk: 158, arm: 95,  shd: 44,  hull: 158, speed: 32, req: { shipyard: 7, plasma: 4, shield: 5 }, desc: 'Capital-class warship.' },
  dread:    { name: 'Dreadnought',  icon: '🌑', cost: 9200, atk: 420, arm: 250, shd: 120, hull: 420, speed: 28, req: { shipyard: 10, plasma: 8, armour: 8, shield: 8 }, desc: 'Battlefield dominator.' },
  colony:   { name: 'Outpost Ship', icon: '🪐', cost: 2200, atk: 0,   arm: 24,  shd: 0,   hull: 44,  speed: 26, req: { shipyard: 3, astro: 1 }, colony: true, desc: 'Founds a new base — is not a base itself.' },
};
const SHIP_ORDER = ['scout', 'fighter', 'corvette', 'frigate', 'destroyer', 'cruiser', 'dread', 'colony'];

const PLANET_TYPES: Record<string, { name: string; icon: string; hab: boolean }> = {
  terran:  { name: 'Terran',   icon: '🌎', hab: true },
  ocean:   { name: 'Ocean',    icon: '🌊', hab: true },
  jungle:  { name: 'Jungle',   icon: '🌴', hab: true },
  desert:  { name: 'Desert',   icon: '🏜️', hab: true },
  tundra:  { name: 'Tundra',   icon: '🏔️', hab: true },
  gas:     { name: 'Gas Giant', icon: '🪐', hab: false },
  asteroid:{ name: 'Asteroid', icon: '🌑', hab: false },
  barren:  { name: 'Barren',   icon: '⚪', hab: false },
};
const STAR_GLYPHS = ['⭐', '🌟', '✨', '🔆'];

const SPEED = 90;
const OFFLINE_CAP = 8 * 3600;
const MAP_W = 6, MAP_H = 6;
const GALAXY_GEN_CREDITS = 100000000;

/* ============================================================= RNG */
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================================================= FORMULAS
   Pure functions over plain in-memory maps (Record<string, number>). Where
   these maps come from — and go back to — is entirely the "row loaders /
   savers" section further down; no formula here knows or cares that the
   data actually lives across several normalized tables. */
function structLevel(struct: Record<string, number>, key: string) { return struct[key] || 0; }
function buildSpeed(struct: Record<string, number>) {
  return 1 + 0.12 * structLevel(struct, 'robotic') + 0.35 * structLevel(struct, 'nanite');
}
function baseEnergy(struct: Record<string, number>, techs: Record<string, number>) {
  let prod = 0, cons = 0;
  const eBonus = 1 + 0.04 * (techs.energy || 0);
  STRUCT_ORDER.forEach((k) => {
    const l = structLevel(struct, k); if (!l) return;
    const d = STRUCT[k];
    if (d.energy) prod += d.energy(l) * eBonus;
    if (d.consume) cons += d.consume(l);
  });
  return { prod: Math.round(prod), cons: Math.round(cons) };
}
function baseEfficiency(struct: Record<string, number>, techs: Record<string, number>) {
  const e = baseEnergy(struct, techs);
  if (e.cons <= 0) return 1;
  return Math.max(0, Math.min(1, e.prod / e.cons));
}
function baseCredits(struct: Record<string, number>, techs: Record<string, number>) {
  const eff = baseEfficiency(struct, techs);
  let c = 18;
  STRUCT_ORDER.forEach((k) => { const d = STRUCT[k]; if (d.credits) c += d.credits(structLevel(struct, k)) * eff; });
  return c;
}
function baseResearch(struct: Record<string, number>, techs: Record<string, number>) {
  const eff = baseEfficiency(struct, techs);
  let r = 0;
  STRUCT_ORDER.forEach((k) => { const d = STRUCT[k]; if (d.research) r += d.research(structLevel(struct, k)) * eff; });
  return r;
}
function slotsUsed(struct: Record<string, number>) {
  let u = 0; STRUCT_ORDER.forEach((k) => { u += structLevel(struct, k); }); return u;
}
function slotsMax(struct: Record<string, number>, size: number) {
  let max = size;
  STRUCT_ORDER.forEach((k) => { const d = STRUCT[k]; if (d.slots) max += d.slots(structLevel(struct, k)); });
  return max;
}
function structCost(struct: Record<string, number>, key: string) {
  const d = STRUCT[key]; return Math.round(d.cost * Math.pow(d.f, structLevel(struct, key)));
}
function techCost(techs: Record<string, number>, key: string) {
  const d = TECH[key]; return Math.round(d.cost * Math.pow(d.f, techs[key] || 0));
}
function reqMet(techs: Record<string, number>, req?: ReqMap) {
  if (!req) return true;
  for (const k in req) { if (TECH[k] && (techs[k] || 0) < req[k]) return false; }
  return true;
}
function reqMetStruct(struct: Record<string, number>, techs: Record<string, number>, req?: ReqMap) {
  if (!req) return true;
  for (const k in req) {
    if (TECH[k]) { if ((techs[k] || 0) < req[k]) return false; }
    else if (STRUCT[k]) { if (structLevel(struct, k) < req[k]) return false; }
  }
  return true;
}
function structTime(struct: Record<string, number>, key: string) {
  const cost = structCost(struct, key);
  return Math.max(3, Math.sqrt(cost) * 0.95 / buildSpeed(struct));
}
function shipTime(struct: Record<string, number>, key: string) {
  const cost = SHIP[key].cost;
  return Math.max(2, Math.sqrt(cost) * 0.7 / buildSpeed(struct));
}
function techTime(techs: Record<string, number>, key: string) {
  return Math.max(3, Math.sqrt(techCost(techs, key)) * 0.85);
}
function fleetPower(ships: Record<string, number>) {
  let p = 0;
  for (const k in ships) { if (SHIP[k]) p += ships[k] * (SHIP[k].atk + SHIP[k].arm + SHIP[k].shd + SHIP[k].hull); }
  return p;
}
function effStats(key: string, techs: Record<string, number>) {
  const s = SHIP[key];
  const aMul = 1 + 0.06 * ((techs.laser || 0) + (techs.plasma || 0));
  const sMul = 1 + 0.08 * (techs.shield || 0);
  const hMul = 1 + 0.08 * (techs.armour || 0);
  return { atk: s.atk * aMul, hp: s.hull * hMul + s.arm * hMul + s.shd * sMul };
}
function cleanShips(s: Record<string, number>) {
  const o: Record<string, number> = {}; for (const k in s) if (s[k] > 0) o[k] = s[k]; return o;
}
function fleetSpeed(ships: Record<string, number>, techs: Record<string, number>) {
  let min = Infinity;
  for (const k in ships) if (ships[k] > 0) min = Math.min(min, SHIP[k].speed);
  if (!isFinite(min)) min = 30;
  return min * (1 + 0.05 * (techs.warp || 0));
}
function distance(ax: number, ay: number, bx: number, by: number) {
  return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
}
function travelTime(fromX: number, fromY: number, toX: number, toY: number, ships: Record<string, number>, techs: Record<string, number>) {
  const d = distance(fromX, fromY, toX, toY);
  return Math.max(3, d / fleetSpeed(ships, techs) * 240);
}
function hashAddr(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

function expand(ships: Record<string, number>, techs: Record<string, number>) {
  const arr: { key: string; hp: number; atk: number }[] = [];
  for (const k in ships) for (let i = 0; i < ships[k]; i++) { const e = effStats(k, techs); arr.push({ key: k, hp: e.hp, atk: e.atk }); }
  return arr;
}
function applyDamage(side: { hp: number }[], dmg: number) {
  side.sort((a, b) => a.hp - b.hp);
  let i = 0;
  while (dmg > 0 && i < side.length) {
    if (side[i].hp <= dmg) { dmg -= side[i].hp; side[i].hp = 0; i++; } else { side[i].hp -= dmg; dmg = 0; }
  }
}
function survivors(side: { key: string; hp: number }[]) {
  const o: Record<string, number> = {}; side.forEach((s) => { if (s.hp > 0) o[s.key] = (o[s.key] || 0) + 1; }); return o;
}
function resolveCombat(attShips: Record<string, number>, defShips: Record<string, number>, attTechs: Record<string, number>, defTechs: Record<string, number>) {
  let att = expand(attShips, attTechs), def = expand(defShips, defTechs || {});
  let rounds = 0;
  while (rounds < 8 && att.some((s) => s.hp > 0) && def.some((s) => s.hp > 0)) {
    const aDmg = att.reduce((a, s) => a + (s.hp > 0 ? s.atk : 0), 0) * (0.9 + Math.random() * 0.2);
    const dDmg = def.reduce((a, s) => a + (s.hp > 0 ? s.atk : 0), 0) * (0.9 + Math.random() * 0.2);
    att = att.filter((s) => s.hp > 0); def = def.filter((s) => s.hp > 0);
    applyDamage(def, aDmg); applyDamage(att, dDmg);
    att = att.filter((s) => s.hp > 0); def = def.filter((s) => s.hp > 0);
    rounds++;
  }
  return { attSurv: survivors(att), defSurv: survivors(def), attWin: !def.some((s) => s.hp > 0) };
}
function pirateFleet(tier: number, rng: () => number) {
  const f: Record<string, number> = {};
  f.fighter = 4 + ((rng() * 6) | 0) * tier;
  if (tier >= 2) f.corvette = 2 + ((rng() * 4) | 0) * (tier - 1);
  if (tier >= 3) f.frigate = 1 + ((rng() * 3) | 0) * (tier - 2);
  if (tier >= 4) f.destroyer = 1 + ((rng() * 2) | 0) * (tier - 3);
  if (tier >= 5) f.cruiser = 1 + ((rng() * 2) | 0);
  return f;
}
function fmtErr(msg: string) { return { ok: false as const, error: msg }; }
function ok(extra?: Record<string, unknown>) { return { ok: true as const, ...(extra || {}) }; }
function fmt(n: number) {
  n = Math.round(n);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

/* ============================================================= NORMALIZED
   ROW <-> MAP HELPERS
   Every "keyed map" (structure levels, tech levels, garrisoned ships,
   fleet cargo, pirate garrisons) is stored as one row per key in its own
   child table. These generic helpers read a table into a plain map and
   write a plain map back with a full delete+insert (queues/garrisons are
   small, so this stays cheap and avoids fiddly incremental diffing). */
async function loadMap(table: string, idCol: string, idVal: number, keyCol: string, valCol: string): Promise<Record<string, number>> {
  const rows = await query<Record<string, any>>(`SELECT ${keyCol} AS k, ${valCol} AS v FROM ${table} WHERE ${idCol} = ?`, [idVal]);
  const o: Record<string, number> = {};
  rows.forEach((r) => { o[r.k] = num(r.v); });
  return o;
}
async function saveMap(table: string, idCol: string, idVal: number, keyCol: string, valCol: string, map: Record<string, number>): Promise<void> {
  await execute(`DELETE FROM ${table} WHERE ${idCol} = ?`, [idVal]);
  const rows = Object.keys(map).filter((k) => map[k] > 0).map((k) => [idVal, k, map[k]]);
  if (rows.length) await bulkInsert(table, [idCol, keyCol, valCol], rows);
}

/* ---- garrison fleets ----
   Ships stationed at a base are not a bare "base_garrison" table — they are
   that base's one dedicated fleet (mission='garrison', phase='garrison',
   garrison_of=baseId), and its ships live in fleet_ships like any other
   fleet's. So every ship a commander owns — docked or in transit — belongs
   to exactly one fleets row, with no exceptions. */
async function garrisonFleetId(baseId: number): Promise<number | null> {
  const rows = await query<{ id: number }>('SELECT id FROM fleets WHERE garrison_of = ? LIMIT 1', [baseId]);
  return rows[0]?.id ?? null;
}
async function ensureGarrisonFleetId(playerId: number, baseId: number, ox: number | null, oy: number | null): Promise<number> {
  const existing = await garrisonFleetId(baseId);
  if (existing) return existing;
  return insert(
    'INSERT INTO fleets (player_id, origin_base_id, mission, ox, oy, phase, garrison_of, arrive_at, leg) VALUES (?,?,?,?,?,?,?,?,?)',
    [playerId, baseId, 'garrison', ox, oy, 'garrison', baseId, 0, 0],
  );
}
async function loadGarrison(baseId: number): Promise<Record<string, number>> {
  const fid = await garrisonFleetId(baseId);
  if (!fid) return {};
  return loadMap('fleet_ships', 'fleet_id', fid, 'ship_key', 'qty');
}
async function saveGarrison(playerId: number, baseId: number, ox: number | null, oy: number | null, map: Record<string, number>): Promise<void> {
  const fid = await ensureGarrisonFleetId(playerId, baseId, ox, oy);
  await saveMap('fleet_ships', 'fleet_id', fid, 'ship_key', 'qty', map);
}

interface QItem { kind: 'struct' | 'ship'; key: string; qty?: number; unit?: number; finishAt: number; dur: number }
async function loadQueue(baseId: number): Promise<QItem[]> {
  const rows = await query<any>('SELECT * FROM base_queue WHERE base_id = ? ORDER BY seq', [baseId]);
  return rows.map((r) => ({ kind: r.kind, key: r.item_key, qty: r.qty ?? undefined, unit: r.unit_seconds ?? undefined, finishAt: num(r.finish_at), dur: r.dur_seconds }));
}
async function saveQueue(baseId: number, queue: QItem[]): Promise<void> {
  await execute('DELETE FROM base_queue WHERE base_id = ?', [baseId]);
  if (!queue.length) return;
  const rows = queue.map((q, i) => [baseId, i, q.kind, q.key, q.qty ?? null, q.unit ?? null, q.finishAt, q.dur]);
  await bulkInsert('base_queue', ['base_id', 'seq', 'kind', 'item_key', 'qty', 'unit_seconds', 'finish_at', 'dur_seconds'], rows);
}

async function loadPirateDef(playerId: number, x: number, y: number, slot: number): Promise<Record<string, number>> {
  const rows = await query<{ ship_key: string; qty: number }>(
    'SELECT ship_key, qty FROM pirate_defense WHERE player_id=? AND x=? AND y=? AND slot=?', [playerId, x, y, slot],
  );
  const o: Record<string, number> = {}; rows.forEach((r) => { o[r.ship_key] = r.qty; }); return o;
}
async function savePirateDef(playerId: number, x: number, y: number, slot: number, def: Record<string, number>): Promise<void> {
  await execute('DELETE FROM pirate_defense WHERE player_id=? AND x=? AND y=? AND slot=?', [playerId, x, y, slot]);
  const rows = Object.keys(def).filter((k) => def[k] > 0).map((k) => [playerId, x, y, slot, k, def[k]]);
  if (rows.length) await bulkInsert('pirate_defense', ['player_id', 'x', 'y', 'slot', 'ship_key', 'qty'], rows);
}

async function loadActiveResearch(playerId: number): Promise<{ key: string; finishAt: number; dur: number } | null> {
  const rows = await query<any>('SELECT tech_key, finish_at, dur_seconds FROM player_research WHERE player_id = ? LIMIT 1', [playerId]);
  if (!rows[0]) return null;
  return { key: rows[0].tech_key, finishAt: num(rows[0].finish_at), dur: rows[0].dur_seconds };
}
async function setActiveResearch(playerId: number, active: { key: string; finishAt: number; dur: number } | null): Promise<void> {
  await execute('DELETE FROM player_research WHERE player_id = ?', [playerId]);
  if (active) await execute('INSERT INTO player_research (player_id, tech_key, finish_at, dur_seconds) VALUES (?,?,?,?)', [playerId, active.key, active.finishAt, active.dur]);
}

/* ============================================================= PLAYER BOOTSTRAP */
async function logEvent(playerId: number, message: string, cls = '') {
  await execute('INSERT INTO logs (player_id, ts, message, cls) VALUES (?, ?, ?, ?)', [playerId, Date.now(), message, cls]);
}

/** Wipe (if any) and regenerate a player's private local galaxy + home base. */
async function generateLocalGalaxy(playerId: number, seed: number) {
  const rng = mulberry32(seed);
  await execute('DELETE FROM fleets WHERE player_id = ?', [playerId]);
  await execute('DELETE FROM planets WHERE player_id = ?', [playerId]);
  await execute('DELETE FROM bases WHERE player_id = ? AND address IS NULL', [playerId]);
  await execute('DELETE FROM systems WHERE player_id = ?', [playerId]);

  const homeX = 1 + ((rng() * MAP_W) | 0), homeY = 1 + ((rng() * MAP_H) | 0);
  const sysRows: any[][] = [];
  const grid: Record<string, { type: string; size: number; hab: boolean }[]> = {};

  for (let x = 1; x <= MAP_W; x++) {
    for (let y = 1; y <= MAP_H; y++) {
      const star = STAR_GLYPHS[(rng() * 4) | 0];
      sysRows.push([playerId, x, y, star, (x === homeX && y === homeY) ? 1 : 0]);
      const nP = 3 + ((rng() * 3) | 0);
      const planets: { type: string; size: number; hab: boolean }[] = [];
      for (let p = 1; p <= nP; p++) {
        const roll = rng();
        let type: string;
        if (roll < 0.45) type = ['terran', 'ocean', 'jungle', 'desert', 'tundra'][(rng() * 5) | 0];
        else if (roll < 0.7) type = 'gas';
        else if (roll < 0.85) type = 'asteroid';
        else type = 'barren';
        const hab = PLANET_TYPES[type].hab;
        planets.push({ type, size: hab ? 11 + ((rng() * 9) | 0) : 5 + ((rng() * 5) | 0), hab });
      }
      grid[x + ':' + y] = planets;
    }
  }
  await execute(
    'INSERT INTO systems (player_id, x, y, star, known) VALUES ' + sysRows.map(() => '(?,?,?,?,?)').join(','),
    sysRows.flat(),
  );

  const homePlanets = grid[homeX + ':' + homeY];
  let hslot = 1;
  for (let i = 0; i < homePlanets.length; i++) { if (homePlanets[i].hab) { hslot = i + 1; break; } }
  homePlanets[hslot - 1] = { type: 'terran', size: 16, hab: true };

  const planetInsertRows: any[][] = [];
  for (const key in grid) {
    const [xs, ys] = key.split(':');
    const x = +xs, y = +ys;
    grid[key].forEach((p, i) => {
      const slot = i + 1;
      const isHome = x === homeX && y === homeY && slot === hslot;
      planetInsertRows.push([playerId, x, y, slot, p.type, p.size, isHome ? 'you' : 'empty', null, null]);
    });
  }
  await execute(
    'INSERT INTO planets (player_id, x, y, slot, type, size, owner, pirate_tier, pirate_loot) VALUES ' +
    planetInsertRows.map(() => '(?,?,?,?,?,?,?,?,?)').join(','),
    planetInsertRows.flat(),
  );

  const homeBaseId = await insert(
    'INSERT INTO bases (player_id, name, x, y, slot, address, size) VALUES (?,?,?,?,?,?,?)',
    [playerId, 'Homeworld', homeX, homeY, hslot, null, 16],
  );
  await execute('UPDATE planets SET base_id = ? WHERE player_id = ? AND x = ? AND y = ? AND slot = ?',
    [homeBaseId, playerId, homeX, homeY, hslot]);
  await saveMap('base_structures', 'base_id', homeBaseId, 'struct_key', 'level',
    { solar: 5, metro: 3, lab: 2, robotic: 2, shipyard: 1, spaceport: 1 });

  const pirates = 6 + ((rng() * 4) | 0);
  const allKeys = Object.keys(grid).filter((k) => k !== homeX + ':' + homeY);
  for (let pc = 0; pc < pirates && allKeys.length; pc++) {
    const ki = (rng() * allKeys.length) | 0;
    const sysk = allKeys.splice(ki, 1)[0];
    const [xs, ys] = sysk.split(':'); const x = +xs, y = +ys;
    const planets = grid[sysk];
    const pi = (rng() * planets.length) | 0;
    const dist = Math.abs(x - homeX) + Math.abs(y - homeY);
    const tier = Math.max(1, Math.min(5, Math.round(dist / 2 + rng() * 1.5)));
    const def = pirateFleet(tier, rng);
    const loot = Math.round((600 + rng() * 1400) * tier);
    await execute(
      "UPDATE planets SET owner = 'pirate', pirate_tier = ?, pirate_loot = ? WHERE player_id = ? AND x = ? AND y = ? AND slot = ? AND owner = 'empty'",
      [tier, loot, playerId, x, y, pi + 1],
    );
    await savePirateDef(playerId, x, y, pi + 1, def);
  }

  await logEvent(playerId, 'Empire founded. Build your economy, research, and fleet.', 'good');
}

/** Ensure a `players` row exists for this web user, creating a fresh local galaxy on first visit. */
export async function ensurePlayerForUser(userId: number, desiredName: string): Promise<number> {
  const existing = await query<{ id: number }>('SELECT id FROM players WHERE user_id = ? LIMIT 1', [userId]);
  if (existing[0]) return existing[0].id;

  const seed = (Math.random() * 1e9) | 0;
  const playerId = await insert(
    'INSERT INTO players (user_id, username, credits, research_points, seed, last_tick) VALUES (?,?,?,?,?,?)',
    [userId, desiredName, 1500, 0, seed, Date.now()],
  );
  await generateLocalGalaxy(playerId, seed);
  return playerId;
}

/** "New Game": wipe this player's empire and found a brand new one. */
export async function newGame(playerId: number, name: string): Promise<void> {
  const seed = (Math.random() * 1e9) | 0;
  await execute('DELETE FROM logs WHERE player_id = ?', [playerId]);
  await execute('DELETE FROM research_queue WHERE player_id = ?', [playerId]);
  await execute('DELETE FROM player_research WHERE player_id = ?', [playerId]);
  await execute('DELETE FROM player_techs WHERE player_id = ?', [playerId]);
  await execute('DELETE FROM gx_claims WHERE player_id = ?', [playerId]);
  await execute('DELETE FROM fleets WHERE player_id = ?', [playerId]);
  await execute('DELETE FROM bases WHERE player_id = ?', [playerId]);
  await execute('DELETE FROM planets WHERE player_id = ?', [playerId]);
  await execute('DELETE FROM systems WHERE player_id = ?', [playerId]);
  await execute('UPDATE players SET username=?, credits=1500, research_points=0, seed=?, last_tick=? WHERE id = ?',
    [name, seed, Date.now(), playerId]);
  await generateLocalGalaxy(playerId, seed);
}

/* ============================================================= ROW TYPES */
interface PlayerRow { id: number; username: string; credits: any; research_points: any; seed: number; last_tick: any }
interface BaseRow { id: number; player_id: number; name: string; x: number | null; y: number | null; slot: number | null; address: string | null; size: number }
interface FleetRow {
  id: number; player_id: number; origin_base_id: number | null; mission: string;
  ox: number | null; oy: number | null; tx: number | null; ty: number | null; slot: number | null;
  addr: string | null; astro_size: number | null; phase: string; arrive_at: any; leg: number;
}
interface PlanetRow {
  player_id: number; x: number; y: number; slot: number; type: string; size: number;
  owner: 'empty' | 'you' | 'pirate'; pirate_tier: number | null; pirate_loot: number | null; base_id: number | null;
}
interface SystemRow { player_id: number; x: number; y: number; star: string; known: number }

async function loadPlayer(playerId: number): Promise<PlayerRow> {
  const rows = await query<PlayerRow>('SELECT * FROM players WHERE id = ? LIMIT 1', [playerId]);
  if (!rows[0]) throw new Error('Unknown player');
  return rows[0];
}
async function loadBases(playerId: number): Promise<BaseRow[]> { return query<BaseRow>('SELECT * FROM bases WHERE player_id = ? ORDER BY id', [playerId]); }
async function loadFleets(playerId: number): Promise<FleetRow[]> { return query<FleetRow>("SELECT * FROM fleets WHERE player_id = ? AND phase != 'garrison' ORDER BY id", [playerId]); }
async function loadPlanets(playerId: number): Promise<PlanetRow[]> { return query<PlanetRow>('SELECT * FROM planets WHERE player_id = ?', [playerId]); }
async function loadSystems(playerId: number): Promise<SystemRow[]> { return query<SystemRow>('SELECT * FROM systems WHERE player_id = ?', [playerId]); }
async function loadColonized(playerId: number): Promise<Record<string, number>> {
  const rows = await query<{ address: string; base_id: number }>('SELECT address, base_id FROM gx_claims WHERE player_id = ?', [playerId]);
  const o: Record<string, number> = {}; rows.forEach((r) => { o[r.address] = r.base_id; }); return o;
}

/** Account-tier caps for this player (fall back to the Free tier if unlinked). */
async function loadTierCaps(playerId: number): Promise<{ maxBasesTier: number; maxQueueTier: number }> {
  const rows = await query<{ max_bases: number; max_queue: number }>(
    `SELECT COALESCE(t.max_bases, 3) AS max_bases, COALESCE(t.max_queue, 1) AS max_queue
     FROM players p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN account_tiers t ON t.id = u.tier_id
     WHERE p.id = ? LIMIT 1`, [playerId],
  );
  return { maxBasesTier: rows[0]?.max_bases ?? 3, maxQueueTier: rows[0]?.max_queue ?? 1 };
}
function maxBasesFor(techs: Record<string, number>, tierMaxBases: number) { return tierMaxBases + (techs.astro || 0); }
function queueMaxFor(techs: Record<string, number>, tierMaxQueue: number) { return tierMaxQueue + Math.floor((techs.computer || 0) / 2); }

async function countColonizing(playerId: number): Promise<number> {
  const rows = await query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM fleets WHERE player_id = ? AND phase = 'out' AND mission IN ('colonize','colonize-remote')", [playerId],
  );
  return rows[0]?.n ?? 0;
}
async function countBases(playerId: number): Promise<number> {
  const rows = await query<{ n: number }>('SELECT COUNT(*) AS n FROM bases WHERE player_id = ?', [playerId]);
  return rows[0]?.n ?? 0;
}

/* ============================================================= SETTLE (TICK) */
export async function settle(playerId: number): Promise<void> {
  const player = await loadPlayer(playerId);
  const techs = await loadMap('player_techs', 'player_id', playerId, 'tech_key', 'level');
  const now = Date.now();
  const lastTick = num(player.last_tick) || now;
  const elapsed = Math.min(OFFLINE_CAP, Math.max(0, (now - lastTick) / 1000));

  const bases = await loadBases(playerId);
  const baseStructs: Record<number, Record<string, number>> = {};
  let econ = 0, res = 0;
  for (const b of bases) {
    const struct = await loadMap('base_structures', 'base_id', b.id, 'struct_key', 'level');
    baseStructs[b.id] = struct;
    econ += baseCredits(struct, techs);
    res += baseResearch(struct, techs);
  }
  econ *= (1 + 0.05 * (techs.ai || 0));
  const creditsGain = econ / 3600 * SPEED * elapsed;
  const rpGain = res / 3600 * SPEED * elapsed;

  for (const b of bases) {
    const struct = baseStructs[b.id];
    const garrison = await loadGarrison(b.id);
    const queue = await loadQueue(b.id);
    let changed = false;
    let guard = 0;
    while (queue.length && queue[0].finishAt <= now && guard++ < 500) {
      const q = queue[0];
      if (q.kind === 'struct') {
        struct[q.key] = (struct[q.key] || 0) + 1;
        await logEvent(playerId, b.name + ': ' + STRUCT[q.key].name + ' → level ' + struct[q.key], 'good');
        queue.shift(); changed = true;
      } else {
        garrison[q.key] = (garrison[q.key] || 0) + 1;
        q.qty = (q.qty || 1) - 1;
        if ((q.qty || 0) <= 0) { await logEvent(playerId, b.name + ': ' + SHIP[q.key].name + ' built'); queue.shift(); }
        else { q.finishAt = q.finishAt + (q.unit || q.dur) * 1000; }
        changed = true;
      }
    }
    if (changed) {
      await saveMap('base_structures', 'base_id', b.id, 'struct_key', 'level', struct);
      await saveGarrison(playerId, b.id, b.x, b.y, garrison);
      await saveQueue(b.id, queue);
    }
  }

  const active = await loadActiveResearch(playerId);
  if (active && active.finishAt <= now) {
    techs[active.key] = (techs[active.key] || 0) + 1;
    await execute('INSERT INTO player_techs (player_id, tech_key, level) VALUES (?,?,?) ON DUPLICATE KEY UPDATE level = ?',
      [playerId, active.key, techs[active.key], techs[active.key]]);
    await logEvent(playerId, 'Research complete: ' + TECH[active.key].name + ' → level ' + techs[active.key], 'good');
    await execute('INSERT INTO research_queue (player_id, tech_key, level) VALUES (?,?,?)', [playerId, active.key, techs[active.key]]);
    await setActiveResearch(playerId, null);
  }

  const fleets = await loadFleets(playerId);
  for (const f of fleets) {
    if (num(f.arrive_at) > now) continue;
    if (f.phase === 'out') await resolveArrival(playerId, f, techs);
    else await depositFleet(f);
  }

  await execute('UPDATE players SET credits = credits + ?, research_points = research_points + ?, last_tick = ? WHERE id = ?',
    [creditsGain, rpGain, now, playerId]);
}

async function depositFleet(f: FleetRow) {
  const ships = await loadMap('fleet_ships', 'fleet_id', f.id, 'ship_key', 'qty');
  if (f.origin_base_id) {
    const garrison = await loadGarrison(f.origin_base_id);
    for (const k in ships) garrison[k] = (garrison[k] || 0) + ships[k];
    await saveGarrison(f.player_id, f.origin_base_id, f.ox, f.oy, garrison);
  }
  await execute('DELETE FROM fleets WHERE id = ?', [f.id]);
}

async function sendFleetBack(f: FleetRow, ships: Record<string, number>) {
  await execute('UPDATE fleets SET phase="back", arrive_at=?, mission="return" WHERE id=?', [Date.now() + f.leg * 1000, f.id]);
  await saveMap('fleet_ships', 'fleet_id', f.id, 'ship_key', 'qty', cleanShips(ships));
}

async function resolveArrival(playerId: number, f: FleetRow, techs: Record<string, number>) {
  const ships = await loadMap('fleet_ships', 'fleet_id', f.id, 'ship_key', 'qty');
  const { maxBasesTier } = await loadTierCaps(playerId);

  if (f.mission === 'colonize-remote' && f.addr) {
    const claimed = await query<{ address: string }>('SELECT address FROM gx_claims WHERE address = ? LIMIT 1', [f.addr]);
    const nBases = await countBases(playerId);
    if (claimed[0] || nBases >= maxBasesFor(techs, maxBasesTier)) {
      await logEvent(playerId, 'Colonization failed at ' + f.addr + ' (already claimed or base limit reached). Outpost Ship lost.', 'warn');
      await execute('DELETE FROM fleets WHERE id = ?', [f.id]);
      return;
    }
    const baseId = await insert(
      'INSERT INTO bases (player_id, name, x, y, slot, address, size) VALUES (?,?,?,?,?,?,?)',
      [playerId, 'Colony ' + (nBases + 1), null, null, null, f.addr, f.astro_size || 12],
    );
    await saveMap('base_structures', 'base_id', baseId, 'struct_key', 'level', { solar: 2, metro: 1 });
    try {
      await execute('INSERT INTO gx_claims (server, galaxy, address, player_id, base_id) VALUES (?,?,?,?,?)',
        [f.addr.slice(0, 1), parseInt(f.addr.slice(1, 3), 10) || 1, f.addr, playerId, baseId]);
    } catch {
      await execute('DELETE FROM bases WHERE id = ?', [baseId]);
      await logEvent(playerId, 'Colonization failed at ' + f.addr + ' (claimed moments earlier by another commander). Outpost Ship lost.', 'warn');
      await execute('DELETE FROM fleets WHERE id = ?', [f.id]);
      return;
    }
    await logEvent(playerId, 'New base founded at ' + f.addr + ' — Colony ' + (nBases + 1) + '!', 'good');
    await execute('DELETE FROM fleets WHERE id = ?', [f.id]);
    return;
  }

  const coord = f.tx + ':' + f.ty + ':' + f.slot;

  if (f.mission === 'probe') {
    await execute('UPDATE systems SET known = 1 WHERE player_id = ? AND x = ? AND y = ?', [playerId, f.tx, f.ty]);
    await logEvent(playerId, 'Scouted system ' + f.tx + ':' + f.ty + '.');
    await sendFleetBack(f, ships);
    return;
  }

  const planetRows = await query<PlanetRow>('SELECT * FROM planets WHERE player_id=? AND x=? AND y=? AND slot=? LIMIT 1', [playerId, f.tx, f.ty, f.slot]);
  const planet = planetRows[0] || null;

  if (f.mission === 'colonize') {
    const nBases = await countBases(playerId);
    if (planet && planet.owner === 'empty' && PLANET_TYPES[planet.type].hab && nBases < maxBasesFor(techs, maxBasesTier)) {
      const baseId = await insert(
        'INSERT INTO bases (player_id, name, x, y, slot, address, size) VALUES (?,?,?,?,?,?,?)',
        [playerId, 'Colony ' + nBases, f.tx, f.ty, f.slot, null, planet.size],
      );
      await saveMap('base_structures', 'base_id', baseId, 'struct_key', 'level', { solar: 2, metro: 1 });
      await execute('UPDATE planets SET owner="you", base_id=? WHERE player_id=? AND x=? AND y=? AND slot=?', [baseId, playerId, f.tx, f.ty, f.slot]);
      await execute('UPDATE systems SET known = 1 WHERE player_id = ? AND x = ? AND y = ?', [playerId, f.tx, f.ty]);
      await logEvent(playerId, 'New base founded at ' + coord + ' — Colony ' + nBases + '!', 'good');
      const escorts: Record<string, number> = {}; for (const k in ships) if (k !== 'colony') escorts[k] = ships[k];
      if (Object.keys(escorts).length) await sendFleetBack(f, escorts);
      else await execute('DELETE FROM fleets WHERE id = ?', [f.id]);
    } else {
      await logEvent(playerId, 'Colonization failed at ' + coord + ' (occupied or limit). Fleet returning.', 'warn');
      await sendFleetBack(f, ships);
    }
    return;
  }

  if (f.mission === 'attack') {
    await execute('UPDATE systems SET known = 1 WHERE player_id = ? AND x = ? AND y = ?', [playerId, f.tx, f.ty]);
    if (!planet || planet.owner !== 'pirate') {
      await logEvent(playerId, 'Target at ' + coord + ' no longer hostile. Fleet returning.');
      await sendFleetBack(f, ships);
      return;
    }
    const def = await loadPirateDef(playerId, f.tx!, f.ty!, f.slot!);
    const res = resolveCombat(ships, def, techs, {});
    if (res.attWin) {
      const loot = planet.pirate_loot || 0;
      await execute('UPDATE players SET credits = credits + ? WHERE id = ?', [loot, playerId]);
      await execute('UPDATE planets SET owner="empty", pirate_tier=NULL, pirate_loot=0 WHERE player_id=? AND x=? AND y=? AND slot=?', [playerId, f.tx, f.ty, f.slot]);
      await execute('DELETE FROM pirate_defense WHERE player_id=? AND x=? AND y=? AND slot=?', [playerId, f.tx, f.ty, f.slot]);
      await logEvent(playerId, 'Victory at ' + coord + '! Pirate base destroyed. Looted ' + fmt(loot) + ' ₢.', 'good');
    } else {
      await savePirateDef(playerId, f.tx!, f.ty!, f.slot!, res.defSurv);
      await logEvent(playerId, 'Defeat at ' + coord + '. Fleet wiped out by pirate defenses.', 'bad');
    }
    const survShips = cleanShips(res.attSurv);
    if (!Object.keys(survShips).length) { await execute('DELETE FROM fleets WHERE id = ?', [f.id]); return; }
    await sendFleetBack(f, survShips);
    return;
  }

  await sendFleetBack(f, ships);
}

/* ============================================================= STATE ASSEMBLY */
export async function getFullState(playerId: number) {
  await settle(playerId);
  const player = await loadPlayer(playerId);
  const techs = await loadMap('player_techs', 'player_id', playerId, 'tech_key', 'level');
  const { maxBasesTier, maxQueueTier } = await loadTierCaps(playerId);
  const bases = await loadBases(playerId);
  const fleets = await loadFleets(playerId);
  const systems = await loadSystems(playerId);
  const planets = await loadPlanets(playerId);
  const colonized = await loadColonized(playerId);
  const research = await loadActiveResearch(playerId);
  const logs = await query<{ ts: any; message: string; cls: string }>('SELECT ts, message, cls FROM logs WHERE player_id = ? ORDER BY ts DESC LIMIT 60', [playerId]);

  const basesOut = [];
  for (const b of bases) {
    basesOut.push({
      id: b.id, name: b.name, x: b.x, y: b.y, slot: b.slot, address: b.address, size: b.size,
      struct: await loadMap('base_structures', 'base_id', b.id, 'struct_key', 'level'),
      fleet: await loadGarrison(b.id),
      queue: await loadQueue(b.id),
    });
  }
  const fleetsOut = [];
  for (const f of fleets) {
    fleetsOut.push({
      id: f.id, origin: f.origin_base_id, mission: f.mission,
      ox: f.ox, oy: f.oy, tx: f.tx, ty: f.ty, slot: f.slot, addr: f.addr, size: f.astro_size,
      ships: await loadMap('fleet_ships', 'fleet_id', f.id, 'ship_key', 'qty'),
      phase: f.phase, arriveAt: num(f.arrive_at), leg: f.leg,
    });
  }

  const sysMap: Record<string, any> = {};
  systems.forEach((s) => { sysMap[s.x + ':' + s.y] = { x: s.x, y: s.y, star: s.star, known: !!s.known, planets: [] as any[] }; });
  planets.forEach((p) => {
    const key = p.x + ':' + p.y;
    if (!sysMap[key]) return;
    sysMap[key].planets.push({ slot: p.slot, type: p.type, size: p.size, owner: p.owner, tier: p.pirate_tier || undefined, loot: p.pirate_loot || undefined, baseId: p.base_id || undefined });
  });
  Object.values(sysMap).forEach((s: any) => s.planets.sort((a: any, b: any) => a.slot - b.slot));

  return {
    id: player.id, name: player.username,
    credits: num(player.credits), rp: num(player.research_points),
    techs, research,
    bases: basesOut, fleets: fleetsOut,
    map: { w: MAP_W, h: MAP_H, systems: sysMap },
    log: logs.map((l) => ({ t: num(l.ts), m: l.message, c: l.cls })),
    colonized,
    maxBases: maxBasesFor(techs, maxBasesTier), queueMax: queueMaxFor(techs, maxQueueTier),
  };
}

/* ============================================================= ACTIONS */
export async function upgradeStruct(playerId: number, baseId: number, key: string) {
  if (!STRUCT[key]) return fmtErr('Unknown structure');
  await settle(playerId);
  const player = await loadPlayer(playerId);
  const techs = await loadMap('player_techs', 'player_id', playerId, 'tech_key', 'level');
  const { maxQueueTier } = await loadTierCaps(playerId);
  const rows = await query<BaseRow>('SELECT * FROM bases WHERE id=? AND player_id=? LIMIT 1', [baseId, playerId]);
  const base = rows[0]; if (!base) return fmtErr('No base');
  const struct = await loadMap('base_structures', 'base_id', baseId, 'struct_key', 'level');
  const queue = await loadQueue(baseId);
  if (queue.length >= queueMaxFor(techs, maxQueueTier)) return fmtErr('Build queue full');
  if (!reqMetStruct(struct, techs, STRUCT[key].req)) return fmtErr('Requirements not met');
  const pendingSlots = queue.filter((q) => q.kind === 'struct').length;
  if (slotsUsed(struct) + pendingSlots >= slotsMax(struct, base.size)) return fmtErr('No free building slots');
  const cost = structCost(struct, key);
  if (num(player.credits) < cost) return fmtErr('Not enough credits');
  const t = structTime(struct, key);
  const startAt = queue.length ? queue[queue.length - 1].finishAt : Date.now();
  queue.push({ kind: 'struct', key, finishAt: startAt + t * 1000, dur: t });
  await execute('UPDATE players SET credits = credits - ? WHERE id = ?', [cost, playerId]);
  await saveQueue(baseId, queue);
  return ok();
}

export async function buildShip(playerId: number, baseId: number, key: string, qty: number) {
  if (!SHIP[key]) return fmtErr('Unknown ship');
  await settle(playerId);
  const player = await loadPlayer(playerId);
  const techs = await loadMap('player_techs', 'player_id', playerId, 'tech_key', 'level');
  const { maxQueueTier } = await loadTierCaps(playerId);
  const rows = await query<BaseRow>('SELECT * FROM bases WHERE id=? AND player_id=? LIMIT 1', [baseId, playerId]);
  const base = rows[0]; if (!base) return fmtErr('No base');
  const struct = await loadMap('base_structures', 'base_id', baseId, 'struct_key', 'level');
  const queue = await loadQueue(baseId);
  if (structLevel(struct, 'shipyard') < 1) return fmtErr('Build a Shipyard first');
  if (!reqMet(techs, SHIP[key].req) || structLevel(struct, 'shipyard') < (SHIP[key].req.shipyard || 1)) return fmtErr('Requirements not met');
  qty = Math.max(1, qty | 0);
  const unit = SHIP[key].cost;
  const maxAfford = Math.floor(num(player.credits) / unit);
  qty = Math.min(qty, maxAfford);
  if (qty < 1) return fmtErr('Not enough credits');
  if (queue.length >= queueMaxFor(techs, maxQueueTier) && !queue.some((q) => q.kind === 'ship' && q.key === key)) return fmtErr('Build queue full');
  const t = shipTime(struct, key);
  const startAt = queue.length ? queue[queue.length - 1].finishAt : Date.now();
  queue.push({ kind: 'ship', key, qty, unit: t, finishAt: startAt + t * 1000, dur: t });
  await execute('UPDATE players SET credits = credits - ? WHERE id = ?', [qty * unit, playerId]);
  await saveQueue(baseId, queue);
  return ok();
}

export async function cancelQueueItem(playerId: number, baseId: number, idx: number) {
  await settle(playerId);
  const rows = await query<BaseRow>('SELECT * FROM bases WHERE id=? AND player_id=? LIMIT 1', [baseId, playerId]);
  const base = rows[0]; if (!base) return fmtErr('No base');
  const struct = await loadMap('base_structures', 'base_id', baseId, 'struct_key', 'level');
  const queue = await loadQueue(baseId);
  const q = queue[idx]; if (!q) return fmtErr('No such queue item');
  const refund = q.kind === 'struct' ? Math.round(structCost(struct, q.key) * 0.9) : Math.round(SHIP[q.key].cost * (q.qty || 1) * 0.9);
  queue.splice(idx, 1);
  let start = Date.now();
  queue.forEach((qq) => { qq.finishAt = start + qq.dur * 1000; start = qq.finishAt; });
  await execute('UPDATE players SET credits = credits + ? WHERE id = ?', [refund, playerId]);
  await saveQueue(baseId, queue);
  return ok();
}

export async function startResearch(playerId: number, key: string) {
  if (!TECH[key]) return fmtErr('Unknown technology');
  await settle(playerId);
  const player = await loadPlayer(playerId);
  if (await loadActiveResearch(playerId)) return fmtErr('Already researching');
  const techs = await loadMap('player_techs', 'player_id', playerId, 'tech_key', 'level');
  if (!reqMet(techs, TECH[key].req)) return fmtErr('Requirements not met');
  const cost = techCost(techs, key);
  if (num(player.research_points) < cost) return fmtErr('Not enough research points');
  const t = techTime(techs, key);
  await execute('UPDATE players SET research_points = research_points - ? WHERE id = ?', [cost, playerId]);
  await setActiveResearch(playerId, { key, finishAt: Date.now() + t * 1000, dur: t });
  return ok();
}

export async function cancelResearch(playerId: number) {
  await settle(playerId);
  const active = await loadActiveResearch(playerId);
  if (!active) return ok();
  const techs = await loadMap('player_techs', 'player_id', playerId, 'tech_key', 'level');
  const refund = Math.round(techCost(techs, active.key) * 0.9);
  await execute('UPDATE players SET research_points = research_points + ? WHERE id = ?', [refund, playerId]);
  await setActiveResearch(playerId, null);
  return ok();
}

export async function sendFleet(playerId: number, originBaseId: number, target: { x: number; y: number; slot: number }, mission: string, ships: Record<string, number>) {
  await settle(playerId);
  const techs = await loadMap('player_techs', 'player_id', playerId, 'tech_key', 'level');
  const rows = await query<BaseRow>('SELECT * FROM bases WHERE id=? AND player_id=? LIMIT 1', [originBaseId, playerId]);
  const base = rows[0]; if (!base || base.x == null) return fmtErr('No origin base');
  const garrison = await loadGarrison(base.id);

  let any = false;
  for (const k in ships) if (ships[k] > 0) { any = true; if ((garrison[k] || 0) < ships[k]) return fmtErr('Not enough ' + (SHIP[k]?.name || k)); }
  if (!any) return fmtErr('Select ships to send');

  const planetRows = await query<PlanetRow>('SELECT * FROM planets WHERE player_id=? AND x=? AND y=? AND slot=? LIMIT 1', [playerId, target.x, target.y, target.slot]);
  const planet = planetRows[0]; if (!planet) return fmtErr('Bad target');

  if (mission === 'colonize') {
    if (!(ships.colony > 0)) return fmtErr('Need an Outpost Ship to colonize');
    if (planet.owner !== 'empty') return fmtErr('Planet is not empty');
    if (!PLANET_TYPES[planet.type].hab) return fmtErr('Planet is not habitable');
    const { maxBasesTier } = await loadTierCaps(playerId);
    const nBases = await countBases(playerId);
    if (nBases + (await countColonizing(playerId)) >= maxBasesFor(techs, maxBasesTier)) return fmtErr('Max bases reached (research Astrophysics, or upgrade your account tier)');
  }
  if (mission === 'attack' && planet.owner !== 'pirate') return fmtErr('No hostile base there');
  if (mission === 'attack' && fleetPower(ships) <= 0) return fmtErr('Need warships to attack');

  for (const k in ships) if (ships[k] > 0) garrison[k] -= ships[k];
  const tt = travelTime(base.x!, base.y!, target.x, target.y, ships, techs);
  await saveGarrison(playerId, base.id, base.x, base.y, garrison);
  const fleetId = await insert(
    'INSERT INTO fleets (player_id, origin_base_id, mission, ox, oy, tx, ty, slot, phase, arrive_at, leg) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [playerId, base.id, mission, base.x, base.y, target.x, target.y, target.slot, 'out', Date.now() + tt * 1000, tt],
  );
  await saveMap('fleet_ships', 'fleet_id', fleetId, 'ship_key', 'qty', cleanShips(ships));
  return ok();
}

export async function recallFleet(playerId: number, fleetId: number) {
  await settle(playerId);
  const rows = await query<FleetRow>('SELECT * FROM fleets WHERE id=? AND player_id=? LIMIT 1', [fleetId, playerId]);
  const f = rows[0]; if (!f || f.phase !== 'out') return fmtErr('No such fleet');
  await execute('UPDATE fleets SET phase="back", arrive_at=?, mission="return" WHERE id=?', [Date.now() + f.leg * 1000, fleetId]);
  return ok();
}

/** Send an Outpost Ship from the player's first base to a Galaxy-Gen astro address. */
export async function sendColonize(playerId: number, address: string, size: number) {
  await settle(playerId);
  const techs = await loadMap('player_techs', 'player_id', playerId, 'tech_key', 'level');
  const { maxBasesTier } = await loadTierCaps(playerId);
  const bases = await loadBases(playerId);
  const home = bases[0]; if (!home) return fmtErr('No base');
  const alreadyClaimed = await query<{ address: string }>('SELECT address FROM gx_claims WHERE address = ? LIMIT 1', [address]);
  if (alreadyClaimed[0]) return fmtErr('Already colonized');
  const garrison = await loadGarrison(home.id);
  if (!(garrison.colony > 0)) return fmtErr('Need an Outpost Ship — build one in the Shipyard');
  const nBases = await countBases(playerId);
  if (nBases + (await countColonizing(playerId)) >= maxBasesFor(techs, maxBasesTier)) return fmtErr('Max bases reached (research Astrophysics, or upgrade your account tier)');

  garrison.colony -= 1;
  const dist = 3 + (hashAddr(address) % 12);
  const tt = Math.max(6, dist * 6 / (1 + 0.05 * (techs.warp || 0)));
  await saveGarrison(playerId, home.id, home.x, home.y, garrison);
  const fleetId = await insert(
    'INSERT INTO fleets (player_id, origin_base_id, mission, addr, astro_size, phase, arrive_at, leg) VALUES (?,?,?,?,?,?,?,?)',
    [playerId, home.id, 'colonize-remote', address, size || 12, 'out', Date.now() + tt * 1000, tt],
  );
  await saveMap('fleet_ships', 'fleet_id', fleetId, 'ship_key', 'qty', { colony: 1 });
  await logEvent(playerId, 'Outpost Ship dispatched to ' + address, '');
  return ok();
}

/* ============================================================= GALAXY GEN (existing) */
export interface GenPayload {
  master?: number; size?: number; prefix?: string; number?: number;
  stars?: string; planets?: string; moons?: string; asteroids?: string; gas?: string;
  sunSize?: string; planetSize?: string; moonSize?: string;
  asteroidSize?: string; gasSize?: string; variate?: number;
}
function buildCfg(body: GenPayload) {
  const cfg = GalaxyGen.defaults({ seed: (body.master as number) || 1 });
  const keys: (keyof GenPayload)[] = ['size', 'stars', 'planets', 'moons', 'asteroids', 'gas', 'sunSize', 'planetSize', 'moonSize', 'asteroidSize', 'gasSize', 'variate'];
  keys.forEach((k) => { if (body[k] !== undefined) (cfg as any)[k] = body[k]; });
  if (body.master !== undefined) cfg.master = body.master | 0;
  return cfg;
}
function resolvePrefix(p?: string) { return !p || p === 'ALL' ? 'A' : p; }
function resolveNumber(n?: number | string) { return n === undefined || n === 'ALL' ? 1 : (n as number); }

const SYS_COLS = ['server', 'galaxy', 'region', 'system', 'sx', 'sy', 'subx', 'suby', 'sun_size', 'address'];
const AST_COLS = ['server', 'galaxy', 'region', 'system', 'orbital', 'position', 'kind', 'type', 'type_name', 'area', 'solar', 'fertility', 'metal', 'gas', 'crystal', 'size', 'has_base', 'address'];

function astroRow(server: string, galaxy: number, region: number, system: number, b: any): any[] {
  if (b.kind === 'gas') return [server, galaxy, region, system, b.orbit, b.position, 'gas', 'gas', 'Gas Giant', 0, 0, 0, 0, 0, 0, b.size || 0, 0, b.address];
  const a = b.astro;
  return [server, galaxy, region, system, b.orbit, b.position, b.kind, a.type, a.typeName, a.area, a.solar, a.fertility, a.metal, a.gas, a.crystal, b.size || 0, b.hasBase ? 1 : 0, b.address];
}

export async function clearAndGenerate(body: GenPayload, requestingPlayerId?: number) {
  const cfg = buildCfg(body);
  const server = resolvePrefix(body.prefix);
  const galaxy = resolveNumber(body.number);
  const size = cfg.size as number;

  await execute('TRUNCATE TABLE gx_astros');
  await execute('TRUNCATE TABLE gx_systems');
  await execute('DELETE FROM bases WHERE address IS NOT NULL');
  await execute('TRUNCATE TABLE gx_claims');

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
          (b.moons || []).forEach((mn: any) => astRows.push(astroRow(server, galaxy, region, system, mn)));
        });
      });
    }
  }

  await bulkInsert('gx_systems', SYS_COLS, sysRows);
  await bulkInsert('gx_astros', AST_COLS, astRows);

  if (requestingPlayerId) {
    await execute('UPDATE players SET credits = ? WHERE id = ?', [GALAXY_GEN_CREDITS, requestingPlayerId]);
    await logEvent(requestingPlayerId, 'Galaxy generated. Treasury set to ' + fmt(GALAXY_GEN_CREDITS) + ' ₢.', 'good');
  }

  return { server, galaxy, systems: sysRows.length, astros: astRows.length, credits: requestingPlayerId ? GALAXY_GEN_CREDITS : undefined };
}

export async function readMap(server: string, galaxy: number) {
  return query('SELECT region, `system`, sx, sy, subx, suby, address FROM gx_systems WHERE server = ? AND galaxy = ? ORDER BY region, `system`', [server, galaxy]);
}

export async function readSystem(server: string, galaxy: number, region: number, system: number) {
  const sysRows: any[] = await query('SELECT address, sun_size FROM gx_systems WHERE server = ? AND galaxy = ? AND region = ? AND `system` = ? LIMIT 1', [server, galaxy, region, system]);
  const astros: any[] = await query('SELECT * FROM gx_astros WHERE server = ? AND galaxy = ? AND region = ? AND `system` = ? ORDER BY orbital, position', [server, galaxy, region, system]);

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
      type: r.type, typeName: r.type_name, glyph: (ASTRO[r.type] && ASTRO[r.type].glyph) || '',
      subtype: r.kind === 'moon' ? 'moon' : r.kind === 'asteroid' ? 'asteroid' : 'planet',
      area: r.area, solar: r.solar, fertility: r.fertility, metal: r.metal, gas: r.gas, crystal: r.crystal,
    };
    const body: any = { kind: r.kind, orbit: r.orbital, position: r.position, address: r.address, size: r.size, hasBase: !!r.has_base, astro };
    if (r.kind === 'moon') {
      moon++;
      const host = planetByOrbital[r.orbital];
      if (host) { (host.moons = host.moons || []).push(body); return; }
      bodies.push(body);
    } else if (r.kind === 'asteroid') { asteroid++; bodies.push(body); }
    else { planet++; body.moons = []; planetByOrbital[r.orbital] = body; bodies.push(body); }
  });

  return {
    address: (sysRows[0] && sysRows[0].address) || '',
    sun: { sizeName: (sysRows[0] && sysRows[0].sun_size) || 'medium' },
    bodies, totals: { planet, moon, asteroid, gas },
  };
}
