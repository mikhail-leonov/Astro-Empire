/* public/js/app.js — Astro Empire
   A single-player, real-time space 4X inspired by AstroEmpires:
   structures produce credits/research/energy in real time, a tech tree gates
   ships & buildings, a galaxy map you explore/colonize, fleets travel with time,
   and you raid pirate bases for loot. State persists in localStorage with
   offline progress. The simulation core is DOM-free (see window.__ASTRO). */
(function () {
  "use strict";

  /* ============================================================= CONFIG */
  var SPEED = 90;                 // 1 real second = SPEED game seconds
  var SAVE_KEY = "astroEmpireSave_v1";
  var OFFLINE_CAP = 8 * 3600;     // cap offline accrual to 8 real hours
  var MAP_W = 6, MAP_H = 6;

  var STRUCT = {
    solar:    { name: "Solar Plant",     icon: "☀️", cost: 60,   f: 1.55, energy: function (l) { return 22 * l; }, desc: "Baseline power. Cheap, reliable energy." },
    gas:      { name: "Gas Plant",       icon: "🛢️", cost: 160,  f: 1.6,  energy: function (l) { return 55 * l; }, req: { energy: 1 }, desc: "More energy per slot than solar." },
    fusion:   { name: "Fusion Plant",    icon: "⚛️", cost: 520,  f: 1.7,  energy: function (l) { return 130 * l; }, req: { energy: 4 }, desc: "High-output power for large bases." },
    metro:    { name: "Metropolis",      icon: "🏙️", cost: 220,  f: 1.6,  credits: function (l) { return 48 * l; }, consume: function (l) { return 16 * l; }, desc: "Population & commerce — your main income." },
    spaceport:{ name: "Spaceport",       icon: "🛰️", cost: 320,  f: 1.6,  credits: function (l) { return 34 * l; }, consume: function (l) { return 12 * l; }, desc: "Trade income; supports fleet logistics." },
    lab:      { name: "Research Lab",    icon: "🔬", cost: 280,  f: 1.7,  research: function (l) { return 22 * l; }, consume: function (l) { return 20 * l; }, desc: "Generates research points each hour." },
    robotic:  { name: "Robotic Factory", icon: "🤖", cost: 200,  f: 1.6,  consume: function (l) { return 10 * l; }, build: function (l) { return 0.12 * l; }, desc: "Speeds up all construction at this base." },
    nanite:   { name: "Nanite Factory",  icon: "🧬", cost: 1400, f: 1.85, consume: function (l) { return 42 * l; }, build: function (l) { return 0.35 * l; }, req: { computer: 5 }, desc: "Dramatically faster construction." },
    shipyard: { name: "Shipyard",        icon: "🏗️", cost: 560,  f: 1.6,  consume: function (l) { return 25 * l; }, enables: "ships", desc: "Build warships. Higher level → bigger hulls." },
    terraform:{ name: "Terraform",       icon: "🌍", cost: 1800, f: 1.95, slots: function (l) { return 2 * l; }, req: { energy: 6 }, desc: "Adds building slots to this base." }
  };
  var STRUCT_ORDER = ["solar", "gas", "fusion", "metro", "spaceport", "lab", "robotic", "nanite", "shipyard", "terraform"];

  var TECH = {
    energy:   { name: "Energy",            icon: "⚡", cost: 220,  f: 1.8,  desc: "Unlocks advanced power plants; +4% plant output / level." },
    computer: { name: "Computer",          icon: "💾", cost: 260,  f: 1.8,  desc: "+1 build-queue slot every 2 levels; enables Nanite Factory." },
    laser:    { name: "Laser",             icon: "🔫", cost: 320,  f: 1.85, desc: "Core weapon tech; unlocks early warships." },
    plasma:   { name: "Plasma",            icon: "💥", cost: 680,  f: 2.0,  req: { laser: 5 }, desc: "Heavy weapons for capital ships." },
    shield:   { name: "Shielding",         icon: "🛡️", cost: 360,  f: 1.9,  desc: "+8% ship shields / level." },
    armour:   { name: "Armour",            icon: "🔩", cost: 320,  f: 1.9,  desc: "+8% ship hull / level." },
    warp:     { name: "Warp Drive",        icon: "🌀", cost: 420,  f: 1.9,  desc: "+5% fleet speed / level." },
    astro:    { name: "Astrophysics",      icon: "🔭", cost: 900,  f: 2.2,  desc: "+1 maximum base / level; enables Outpost Ships." },
    ai:       { name: "Artificial Intel.", icon: "🧠", cost: 1100, f: 2.1,  desc: "+5% total empire economy / level." }
  };
  var TECH_ORDER = ["energy", "computer", "laser", "plasma", "shield", "armour", "warp", "astro", "ai"];

  var SHIP = {
    scout:    { name: "Scout",        icon: "🛰️", cost: 70,   atk: 1,   arm: 3,   shd: 0,   hull: 5,   speed: 60, req: { shipyard: 1 }, desc: "Fast & cheap. Probes distant systems." },
    fighter:  { name: "Fighter",      icon: "🚀", cost: 130,  atk: 7,   arm: 3,   shd: 1,   hull: 7,   speed: 52, req: { shipyard: 1, laser: 1 }, desc: "Swarm attacker." },
    corvette: { name: "Corvette",     icon: "🛩️", cost: 320,  atk: 15,  arm: 9,   shd: 4,   hull: 15,  speed: 46, req: { shipyard: 2, laser: 2 }, desc: "Balanced light warship." },
    frigate:  { name: "Frigate",      icon: "✈️", cost: 760,  atk: 32,  arm: 20,  shd: 9,   hull: 32,  speed: 40, req: { shipyard: 3, laser: 4, shield: 2 }, desc: "Durable mid-class hull." },
    destroyer:{ name: "Destroyer",    icon: "🛸", cost: 1700, atk: 74,  arm: 44,  shd: 20,  hull: 74,  speed: 35, req: { shipyard: 5, plasma: 1, armour: 3 }, desc: "Heavy firepower." },
    cruiser:  { name: "Cruiser",      icon: "🦅", cost: 3600, atk: 158, arm: 95,  shd: 44,  hull: 158, speed: 32, req: { shipyard: 7, plasma: 4, shield: 5 }, desc: "Capital-class warship." },
    dread:    { name: "Dreadnought",  icon: "🌑", cost: 9200, atk: 420, arm: 250, shd: 120, hull: 420, speed: 28, req: { shipyard: 10, plasma: 8, armour: 8, shield: 8 }, desc: "Battlefield dominator." },
    colony:   { name: "Outpost Ship", icon: "🪐", cost: 2200, atk: 0,   arm: 24,  shd: 0,   hull: 44,  speed: 26, req: { shipyard: 3, astro: 1 }, colony: true, desc: "Founds a new base on an empty planet." }
  };
  var SHIP_ORDER = ["scout", "fighter", "corvette", "frigate", "destroyer", "cruiser", "dread", "colony"];

  var PLANET_TYPES = {
    terran:  { name: "Terran",   icon: "🌎", hab: true },
    ocean:   { name: "Ocean",    icon: "🌊", hab: true },
    jungle:  { name: "Jungle",   icon: "🌴", hab: true },
    desert:  { name: "Desert",   icon: "🏜️", hab: true },
    tundra:  { name: "Tundra",   icon: "🏔️", hab: true },
    gas:     { name: "Gas Giant", icon: "🪐", hab: false },
    asteroid:{ name: "Asteroid", icon: "🌑", hab: false },
    barren:  { name: "Barren",   icon: "⚫", hab: false }
  };

  /* ============================================================= RNG */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ============================================================= STATE */
  var S = null;

  function now() { return Date.now(); }

  function newGame(empireName) {
    var seed = (Math.random() * 1e9) | 0;
    var rng = mulberry32(seed);
    var st = {
      name: empireName || "Nova Imperium",
      credits: 1500, rp: 0,
      techs: {}, bases: [], fleets: [], nextBaseId: 1, nextFleetId: 1,
      map: { w: MAP_W, h: MAP_H, systems: {} },
      log: [], seed: seed, lastTick: now(), started: now(),
      ui: { view: "overview", sys: null, target: null, origin: null, sel: {}, mission: "attack" }
    };
    TECH_ORDER.forEach(function (k) { st.techs[k] = 0; });

    // generate galaxy
    var homeX = 1 + ((rng() * MAP_W) | 0), homeY = 1 + ((rng() * MAP_H) | 0);
    for (var x = 1; x <= MAP_W; x++) {
      for (var y = 1; y <= MAP_H; y++) {
        var key = x + ":" + y;
        var nP = 3 + ((rng() * 3) | 0);
        var planets = [];
        for (var p = 1; p <= nP; p++) {
          var roll = rng();
          var type;
          if (roll < 0.45) type = ["terran", "ocean", "jungle", "desert", "tundra"][(rng() * 5) | 0];
          else if (roll < 0.7) type = "gas";
          else if (roll < 0.85) type = "asteroid";
          else type = "barren";
          var hab = PLANET_TYPES[type].hab;
          planets.push({
            slot: p, type: type,
            size: hab ? 11 + ((rng() * 9) | 0) : 5 + ((rng() * 5) | 0),
            owner: "empty"
          });
        }
        st.map.systems[key] = { x: x, y: y, star: ["⭐", "🌟", "✨", "🔆"][(rng() * 4) | 0], planets: planets, known: false };
      }
    }
    // home base
    var hsys = st.map.systems[homeX + ":" + homeY];
    hsys.known = true;
    var hslot = 1;
    for (var i = 0; i < hsys.planets.length; i++) { if (PLANET_TYPES[hsys.planets[i].type].hab) { hslot = hsys.planets[i].slot; break; } }
    var hp = hsys.planets[hslot - 1];
    hp.type = "terran"; hp.size = 16;
    hp.owner = "you";
    var home = {
      id: st.nextBaseId++, name: "Homeworld", x: homeX, y: homeY, slot: hp.slot, size: hp.size,
      struct: { solar: 5, metro: 3, lab: 2, robotic: 2, shipyard: 1, spaceport: 1 }, queue: []
    };
    hp.baseId = home.id;
    st.bases.push(home);

    // scatter pirate bases (avoid home system)
    var pirates = 6 + ((rng() * 4) | 0);
    var keys = Object.keys(st.map.systems).filter(function (k) { return k !== homeX + ":" + homeY; });
    for (var pc = 0; pc < pirates && keys.length; pc++) {
      var ki = (rng() * keys.length) | 0; var sysk = keys.splice(ki, 1)[0];
      var sys = st.map.systems[sysk];
      var pl = sys.planets[(rng() * sys.planets.length) | 0];
      if (pl.owner !== "empty") continue;
      pl.owner = "pirate";
      var dist = Math.abs(sys.x - homeX) + Math.abs(sys.y - homeY);
      var tier = Math.max(1, Math.min(5, Math.round(dist / 2 + rng() * 1.5)));
      pl.def = pirateFleet(tier, rng);
      pl.loot = Math.round((600 + rng() * 1400) * tier);
      pl.tier = tier;
    }
    log(st, "Empire founded. Build your economy, research, and fleet.", "good");
    S = st;
    return st;
  }

  function pirateFleet(tier, rng) {
    var f = {};
    f.fighter = 4 + ((rng() * 6) | 0) * tier;
    if (tier >= 2) f.corvette = 2 + ((rng() * 4) | 0) * (tier - 1);
    if (tier >= 3) f.frigate = 1 + ((rng() * 3) | 0) * (tier - 2);
    if (tier >= 4) f.destroyer = 1 + ((rng() * 2) | 0) * (tier - 3);
    if (tier >= 5) f.cruiser = 1 + ((rng() * 2) | 0);
    return f;
  }

  function log(st, msg, cls) {
    st.log.unshift({ t: now(), m: msg, c: cls || "" });
    if (st.log.length > 60) st.log.length = 60;
  }

  /* ============================================================= SAVE / LOAD */
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {}
  }
  function load() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      var st = JSON.parse(raw);
      if (!st || !st.bases) return false;
      st.ui = st.ui || { view: "overview", sel: {}, mission: "attack" };
      st.ui.sel = st.ui.sel || {};
      S = st;
      return true;
    } catch (e) { return false; }
  }
  function wipe() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

  /* ============================================================= ECONOMY */
  function structLevel(base, key) { return base.struct[key] || 0; }
  function buildSpeed(base) { return 1 + 0.12 * structLevel(base, "robotic") + 0.35 * structLevel(base, "nanite"); }

  function baseEnergy(base) {
    var prod = 0, cons = 0, eBonus = 1 + 0.04 * (S.techs.energy || 0);
    STRUCT_ORDER.forEach(function (k) {
      var l = structLevel(base, k); if (!l) return; var d = STRUCT[k];
      if (d.energy) prod += d.energy(l) * eBonus;
      if (d.consume) cons += d.consume(l);
    });
    return { prod: Math.round(prod), cons: Math.round(cons) };
  }
  function baseEfficiency(base) {
    var e = baseEnergy(base);
    if (e.cons <= 0) return 1;
    return Math.max(0, Math.min(1, e.prod / e.cons));
  }
  function baseCredits(base) {
    var eff = baseEfficiency(base), c = 18; // small flat base income
    STRUCT_ORDER.forEach(function (k) { var d = STRUCT[k]; if (d.credits) c += d.credits(structLevel(base, k)) * eff; });
    return c;
  }
  function baseResearch(base) {
    var eff = baseEfficiency(base), r = 0;
    STRUCT_ORDER.forEach(function (k) { var d = STRUCT[k]; if (d.research) r += d.research(structLevel(base, k)) * eff; });
    return r;
  }
  function slotsUsed(base) { var u = 0; STRUCT_ORDER.forEach(function (k) { u += structLevel(base, k); }); return u; }
  function slotsMax(base) {
    var max = base.size;
    STRUCT_ORDER.forEach(function (k) { var d = STRUCT[k]; if (d.slots) max += d.slots(structLevel(base, k)); });
    return max;
  }

  function empireEconomy() {
    var c = 0; S.bases.forEach(function (b) { c += baseCredits(b); });
    c *= (1 + 0.05 * (S.techs.ai || 0));
    return c; // credits / hour
  }
  function empireResearch() { var r = 0; S.bases.forEach(function (b) { r += baseResearch(b); }); return r; }
  function maxBases() { return 1 + (S.techs.astro || 0); }
  function queueMax() { return 1 + Math.floor((S.techs.computer || 0) / 2); }

  function fleetPower(ships) {
    var p = 0; for (var k in ships) { if (SHIP[k]) p += ships[k] * (SHIP[k].atk + SHIP[k].arm + SHIP[k].shd + SHIP[k].hull); } return p;
  }
  function empireFleetPower() {
    var p = 0; S.bases.forEach(function (b) { p += fleetPower(b.fleet || {}); });
    S.fleets.forEach(function (f) { p += fleetPower(f.ships); });
    return p;
  }

  /* ============================================================= COSTS / REQS */
  function structCost(base, key) { var d = STRUCT[key]; return Math.round(d.cost * Math.pow(d.f, structLevel(base, key))); }
  function techCost(key) { var d = TECH[key]; return Math.round(d.cost * Math.pow(d.f, S.techs[key] || 0)); }
  function reqMet(req) {
    if (!req) return true;
    for (var k in req) {
      if (TECH[k]) { if ((S.techs[k] || 0) < req[k]) return false; }
    }
    return true;
  }
  function reqMetStruct(base, req) {
    if (!req) return true;
    for (var k in req) {
      if (TECH[k]) { if ((S.techs[k] || 0) < req[k]) return false; }
      else if (STRUCT[k]) { if (structLevel(base, k) < req[k]) return false; }
    }
    return true;
  }
  function reqText(req) {
    if (!req) return "";
    var parts = [];
    for (var k in req) {
      var nm = TECH[k] ? TECH[k].name : (STRUCT[k] ? STRUCT[k].name : k);
      parts.push(nm + " " + req[k]);
    }
    return parts.join(", ");
  }

  function structTime(base, key) {
    var cost = structCost(base, key);
    return Math.max(3, Math.sqrt(cost) * 0.95 / buildSpeed(base)); // real seconds
  }
  function shipTime(base, key) {
    var cost = SHIP[key].cost;
    return Math.max(2, Math.sqrt(cost) * 0.7 / buildSpeed(base));
  }
  function techTime(key) { return Math.max(3, Math.sqrt(techCost(key)) * 0.85); }

  /* ============================================================= ACTIONS */
  function queueStruct(baseId, key) {
    var base = baseById(baseId); if (!base) return fail("No base");
    if (base.queue.length >= queueMax()) return fail("Build queue full");
    if (!reqMetStruct(base, STRUCT[key].req)) return fail("Requires " + reqText(STRUCT[key].req));
    if (slotsUsed(base) + pendingSlots(base) >= slotsMax(base)) return fail("No free building slots");
    var cost = structCost(base, key);
    if (S.credits < cost) return fail("Not enough credits");
    S.credits -= cost;
    var t = structTime(base, key);
    base.queue.push({ kind: "struct", key: key, finishAt: queueStartAt(base) + t * 1000, dur: t });
    toast("Queued " + STRUCT[key].name);
    save(); return true;
  }
  function pendingSlots(base) { var n = 0; base.queue.forEach(function (q) { if (q.kind === "struct") n++; }); return n; }
  function queueStartAt(base) { return base.queue.length ? base.queue[base.queue.length - 1].finishAt : now(); }

  function queueShip(baseId, key, qty) {
    var base = baseById(baseId); if (!base) return fail("No base");
    if (structLevel(base, "shipyard") < 1) return fail("Build a Shipyard first");
    if (!reqMet(SHIP[key].req)) return fail("Requires " + reqText(SHIP[key].req));
    if (structLevel(base, "shipyard") < (SHIP[key].req.shipyard || 1)) return fail("Shipyard level too low");
    qty = Math.max(1, qty | 0);
    var unit = SHIP[key].cost, max = Math.floor(S.credits / unit);
    qty = Math.min(qty, max);
    if (qty < 1) return fail("Not enough credits");
    if (base.queue.length >= queueMax() && !base.queue.some(function (q) { return q.kind === "ship" && q.key === key; })) {
      return fail("Build queue full");
    }
    S.credits -= qty * unit;
    var t = shipTime(base, key);
    base.queue.push({ kind: "ship", key: key, qty: qty, unit: t, finishAt: queueStartAt(base) + t * 1000, dur: t });
    toast("Building " + qty + "× " + SHIP[key].name);
    save(); return true;
  }

  function cancelQueue(baseId, idx) {
    var base = baseById(baseId); if (!base || !base.queue[idx]) return;
    var q = base.queue[idx];
    // refund
    if (q.kind === "struct") S.credits += Math.round(structCost(base, q.key) * 0.9);
    else if (q.kind === "ship") S.credits += Math.round(SHIP[q.key].cost * q.qty * 0.9);
    base.queue.splice(idx, 1);
    // re-chain finish times after the removed item
    rechain(base);
    save();
  }
  function rechain(base) {
    var start = now();
    base.queue.forEach(function (q) { q.finishAt = start + q.dur * 1000; start = q.finishAt; });
  }

  function startResearch(key) {
    if (S.research) return fail("Already researching");
    if (!reqMet(TECH[key].req)) return fail("Requires " + reqText(TECH[key].req));
    var cost = techCost(key);
    if (S.rp < cost) return fail("Not enough research points");
    S.rp -= cost;
    var t = techTime(key);
    S.research = { key: key, finishAt: now() + t * 1000, dur: t };
    toast("Researching " + TECH[key].name);
    save(); return true;
  }
  function cancelResearch() {
    if (!S.research) return;
    S.rp += Math.round(techCost(S.research.key) * 0.9);
    S.research = null; save();
  }

  /* fleet sending */
  function distance(ax, ay, bx, by) { return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)); }
  function fleetSpeed(ships) {
    var min = Infinity; for (var k in ships) { if (ships[k] > 0) min = Math.min(min, SHIP[k].speed); }
    if (!isFinite(min)) min = 30;
    return min * (1 + 0.05 * (S.techs.warp || 0));
  }
  function travelTime(fromX, fromY, toX, toY, ships) {
    var d = distance(fromX, fromY, toX, toY);
    return Math.max(3, d / fleetSpeed(ships) * 240); // real seconds
  }

  function sendFleet(originBaseId, target, mission, ships) {
    var base = baseById(originBaseId); if (!base) return fail("No origin base");
    var any = false;
    for (var k in ships) { if (ships[k] > 0) { any = true; if ((base.fleet && base.fleet[k] || 0) < ships[k]) return fail("Not enough " + SHIP[k].name); } }
    if (!any) return fail("Select ships to send");
    var sys = S.map.systems[target.x + ":" + target.y]; if (!sys) return fail("Bad target");
    var planet = sys.planets[target.slot - 1]; if (!planet) return fail("Bad target");

    if (mission === "colonize") {
      if (!(ships.colony > 0)) return fail("Need an Outpost Ship to colonize");
      if (planet.owner !== "empty") return fail("Planet is not empty");
      if (!PLANET_TYPES[planet.type].hab) return fail("Planet is not habitable");
      if (S.bases.length + countColonizing() >= maxBases()) return fail("Max bases reached (research Astrophysics)");
    }
    if (mission === "attack" && planet.owner !== "pirate") return fail("No hostile base there");
    if (mission === "attack" && fleetPower(ships) <= 0) return fail("Need warships to attack");

    // deduct ships from base
    for (var k2 in ships) { if (ships[k2] > 0) base.fleet[k2] -= ships[k2]; }
    var tt = travelTime(base.x, base.y, sys.x, sys.y, ships);
    S.fleets.push({
      id: S.nextFleetId++, origin: base.id, ox: base.x, oy: base.y,
      tx: sys.x, ty: sys.y, slot: target.slot, mission: mission, ships: cleanShips(ships),
      phase: "out", arriveAt: now() + tt * 1000, leg: tt
    });
    toast("Fleet dispatched to " + sys.x + ":" + sys.y + ":" + target.slot);
    S.ui.sel = {};
    save(); return true;
  }
  function cleanShips(s) { var o = {}; for (var k in s) { if (s[k] > 0) o[k] = s[k]; } return o; }
  function countColonizing() { var n = 0; S.fleets.forEach(function (f) { if (f.mission === "colonize" && f.phase === "out") n++; }); return n; }

  function recallFleet(id) {
    var f = fleetById(id); if (!f || f.phase !== "out") return;
    f.phase = "back"; f.arriveAt = now() + f.leg * 1000; f.mission = "return";
    save();
  }

  /* ============================================================= COMBAT */
  function effStats(key, techs) {
    var s = SHIP[key];
    var aMul = 1 + 0.06 * ((techs.laser || 0) + (techs.plasma || 0));
    var sMul = 1 + 0.08 * (techs.shield || 0);
    var hMul = 1 + 0.08 * (techs.armour || 0);
    return { atk: s.atk * aMul, hp: s.hull * hMul + s.arm * hMul + s.shd * sMul };
  }
  function expand(ships, techs) {
    var arr = [];
    for (var k in ships) { for (var i = 0; i < ships[k]; i++) { var e = effStats(k, techs); arr.push({ key: k, hp: e.hp, atk: e.atk }); } }
    return arr;
  }
  function applyDamage(side, dmg) {
    // focus fire weakest-first; returns destroyed count by key
    side.sort(function (a, b) { return a.hp - b.hp; });
    var i = 0;
    while (dmg > 0 && i < side.length) {
      if (side[i].hp <= dmg) { dmg -= side[i].hp; side[i].hp = 0; i++; }
      else { side[i].hp -= dmg; dmg = 0; }
    }
  }
  function survivors(side) {
    var o = {}; side.forEach(function (s) { if (s.hp > 0) o[s.key] = (o[s.key] || 0) + 1; }); return o;
  }
  function resolveCombat(attShips, defShips, attTechs, defTechs) {
    var att = expand(attShips, attTechs), def = expand(defShips, defTechs || {});
    var rounds = 0;
    while (rounds < 8 && att.some(function (s) { return s.hp > 0; }) && def.some(function (s) { return s.hp > 0; })) {
      var aDmg = att.reduce(function (a, s) { return a + (s.hp > 0 ? s.atk : 0); }, 0) * (0.9 + Math.random() * 0.2);
      var dDmg = def.reduce(function (a, s) { return a + (s.hp > 0 ? s.atk : 0); }, 0) * (0.9 + Math.random() * 0.2);
      att = att.filter(function (s) { return s.hp > 0; });
      def = def.filter(function (s) { return s.hp > 0; });
      applyDamage(def, aDmg); applyDamage(att, dDmg);
      att = att.filter(function (s) { return s.hp > 0; });
      def = def.filter(function (s) { return s.hp > 0; });
      rounds++;
    }
    return { attSurv: survivors(att), defSurv: survivors(def), attWin: !def.some(function (s) { return s.hp > 0; }) };
  }

  /* ============================================================= TICK */
  function tick(t) {
    t = t || now();
    var elapsed = Math.min(OFFLINE_CAP, Math.max(0, (t - S.lastTick) / 1000));
    var changed = false;

    // continuous accrual
    S.credits += empireEconomy() / 3600 * SPEED * elapsed;
    S.rp += empireResearch() / 3600 * SPEED * elapsed;

    // build queues
    S.bases.forEach(function (base) {
      base.fleet = base.fleet || {};
      var guard = 0;
      while (base.queue.length && base.queue[0].finishAt <= t && guard++ < 500) {
        var q = base.queue[0];
        if (q.kind === "struct") {
          base.struct[q.key] = (base.struct[q.key] || 0) + 1;
          log(S, base.name + ": " + STRUCT[q.key].name + " → level " + base.struct[q.key], "good");
          base.queue.shift(); changed = true;
        } else if (q.kind === "ship") {
          base.fleet[q.key] = (base.fleet[q.key] || 0) + 1;
          q.qty -= 1;
          if (q.qty <= 0) { log(S, base.name + ": " + SHIP[q.key].name + " built", ""); base.queue.shift(); }
          else { q.finishAt = q.finishAt + q.unit * 1000; }
          changed = true;
        } else base.queue.shift();
      }
    });

    // research
    if (S.research && S.research.finishAt <= t) {
      var key = S.research.key;
      S.techs[key] = (S.techs[key] || 0) + 1;
      log(S, "Research complete: " + TECH[key].name + " → level " + S.techs[key], "good");
      S.research = null; changed = true;
    }

    // fleets
    for (var i = S.fleets.length - 1; i >= 0; i--) {
      var f = S.fleets[i];
      if (f.arriveAt > t) continue;
      if (f.phase === "out") { resolveArrival(f); changed = true; }
      else { // returning
        depositFleet(f); S.fleets.splice(i, 1); changed = true;
      }
    }

    S.lastTick = t;
    return changed;
  }

  function depositFleet(f) {
    var base = baseById(f.origin) || S.bases[0];
    if (!base) return;
    base.fleet = base.fleet || {};
    for (var k in f.ships) { base.fleet[k] = (base.fleet[k] || 0) + f.ships[k]; }
  }

  function resolveArrival(f) {
    var sys = S.map.systems[f.tx + ":" + f.ty];
    if (sys) sys.known = true;
    var planet = sys ? sys.planets[f.slot - 1] : null;
    var coord = f.tx + ":" + f.ty + ":" + f.slot;

    if (f.mission === "probe") {
      log(S, "Scouted system " + f.tx + ":" + f.ty + ".", "");
      f.phase = "back"; f.arriveAt = now() + f.leg * 1000; f.mission = "return"; return;
    }

    if (f.mission === "colonize") {
      if (planet && planet.owner === "empty" && PLANET_TYPES[planet.type].hab && S.bases.length < maxBases()) {
        planet.owner = "you";
        var nb = { id: S.nextBaseId++, name: "Colony " + (S.bases.length), x: f.tx, y: f.ty, slot: f.slot, size: planet.size,
          struct: { solar: 2, metro: 1 }, queue: [], fleet: {} };
        planet.baseId = nb.id;
        // colony ship consumed; return escorts
        var escorts = {}; for (var k in f.ships) { if (k !== "colony") escorts[k] = f.ships[k]; }
        S.bases.push(nb);
        log(S, "New base founded at " + coord + " — " + nb.name + "!", "good");
        if (Object.keys(escorts).length) { f.ships = escorts; f.phase = "back"; f.arriveAt = now() + f.leg * 1000; f.mission = "return"; }
        else { removeFleet(f); }
      } else {
        log(S, "Colonization failed at " + coord + " (occupied or limit). Fleet returning.", "warn");
        f.phase = "back"; f.arriveAt = now() + f.leg * 1000; f.mission = "return";
      }
      return;
    }

    if (f.mission === "attack") {
      if (!planet || planet.owner !== "pirate") {
        log(S, "Target at " + coord + " no longer hostile. Fleet returning.", "");
        f.phase = "back"; f.arriveAt = now() + f.leg * 1000; f.mission = "return"; return;
      }
      var res = resolveCombat(f.ships, planet.def, S.techs, {});
      if (res.attWin) {
        var loot = planet.loot || 0;
        S.credits += loot;
        planet.owner = "empty"; planet.def = null; planet.loot = 0; planet.tier = 0;
        log(S, "Victory at " + coord + "! Pirate base destroyed. Looted " + fmt(loot) + " ₡.", "good");
        f.ships = res.attSurv;
      } else {
        planet.def = res.defSurv;
        log(S, "Defeat at " + coord + ". Fleet wiped out by pirate defenses.", "bad");
        f.ships = res.attSurv; // possibly empty
      }
      if (Object.keys(cleanShips(f.ships)).length === 0) { removeFleet(f); return; }
      f.phase = "back"; f.arriveAt = now() + f.leg * 1000; f.mission = "return";
      return;
    }
    // default
    f.phase = "back"; f.arriveAt = now() + f.leg * 1000; f.mission = "return";
  }
  function removeFleet(f) { var i = S.fleets.indexOf(f); if (i >= 0) S.fleets.splice(i, 1); }

  /* ============================================================= HELPERS */
  function baseById(id) { for (var i = 0; i < S.bases.length; i++) if (S.bases[i].id === id) return S.bases[i]; return null; }
  function fleetById(id) { for (var i = 0; i < S.fleets.length; i++) if (S.fleets[i].id === id) return S.fleets[i]; return null; }

  function fmt(n) {
    n = Math.round(n);
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + "k";
    return n.toLocaleString("en-US");
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return h + "h " + m + "m";
    if (m) return m + "m " + (s < 10 ? "0" : "") + s + "s";
    return s + "s";
  }

  /* expose simulation for headless testing */
  var Game = {
    newGame: newGame, save: save, load: load, wipe: wipe, tick: tick,
    state: function () { return S; }, setState: function (x) { S = x; },
    queueStruct: queueStruct, queueShip: queueShip, startResearch: startResearch,
    sendFleet: sendFleet, recallFleet: recallFleet, resolveCombat: resolveCombat,
    empireEconomy: empireEconomy, empireResearch: empireResearch, fmt: fmt,
    structCost: structCost, techCost: techCost, baseById: baseById
  };
  if (typeof window !== "undefined") window.__ASTRO = Game;

  /* ============================================================= UI */
  var failMsg = null;
  function fail(m) { failMsg = m; toast(m, true); return false; }

  var toastTimer = null;
  function toast(msg, bad) {
    if (typeof document === "undefined") return;
    var el = document.getElementById("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
    el.className = "toast" + (bad ? " bad" : ""); el.textContent = msg; el.style.display = "block";
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.style.display = "none"; }, 2200);
  }

  if (typeof document === "undefined") return; // headless: stop here

  var app, mainEl;

  var NAV = [
    { v: "overview", ic: "🛰️", t: "Overview" },
    { v: "bases", ic: "🏙️", t: "Bases" },
    { v: "research", ic: "🔬", t: "Research" },
    { v: "shipyard", ic: "🏗️", t: "Shipyard" },
    { v: "map", ic: "🌌", t: "Local Map" },
    { v: "fleets", ic: "🚀", t: "Fleets" },
    { v: "galaxygen", ic: "🌠", t: "Galaxy Gen" },
    { v: "galaxymap", ic: "🗺️", t: "Galaxy map" }
  ];

  function boot() {
    app = document.getElementById("app");
    var stars = document.createElement("canvas"); stars.className = "stars"; document.body.appendChild(stars);
    drawStars(stars);
    window.addEventListener("resize", function () { drawStars(stars); });

    if (!load()) { introScreen(); return; }
    // offline catch-up
    tick(now());
    buildShell();
    setView(S.ui.view || "overview");
    startLoop();
  }

  function introScreen() {
    app.innerHTML =
      '<div class="intro"><div class="introbox">' +
      '<div class="logo">🌌</div><h2>Astro Empire</h2>' +
      '<p>Forge a galactic empire. Grow your economy, climb the tech tree, build a fleet, ' +
      'colonize new worlds and crush pirate strongholds. Your empire runs in real time — even while you are away.</p>' +
      '<input id="empName" maxlength="22" placeholder="Name your empire" value="Nova Imperium">' +
      '<button class="btn big" id="startBtn">⟶ Found Empire</button>' +
      '</div></div>';
    document.getElementById("startBtn").addEventListener("click", function () {
      var nm = (document.getElementById("empName").value || "Nova Imperium").trim().slice(0, 22) || "Nova Imperium";
      newGame(nm); save(); buildShell(); setView("overview"); startLoop();
    });
    document.getElementById("empName").addEventListener("keydown", function (e) { if (e.key === "Enter") document.getElementById("startBtn").click(); });
  }

  function buildShell() {
    app.innerHTML =
      '<div class="shell">' +
        '<header class="topbar">' +
          '<div class="brand"><div class="logo">🌌</div><div>' +
            '<h1>' + esc(S.name) + '</h1><div class="sub">Astro Empire</div></div></div>' +
          '<div class="stats">' +
            statCard("credits", "Credits", "st-credits", "credits") +
            statCard("research", "Research", "st-rp", "research") +
            statCard("", "Economy", "st-econ") +
            statCard("", "Research/h", "st-res") +
            statCard("", "Bases", "st-bases") +
            statCard("", "Fleet Pwr", "st-power") +
          '</div>' +
        '</header>' +
        '<div class="body">' +
          '<nav class="side" id="side"></nav>' +
          '<main class="main" id="main"></main>' +
        '</div>' +
      '</div>';
    mainEl = document.getElementById("main");
    renderNav();
    app.addEventListener("click", onClick);
    app.addEventListener("change", onChange);
    if (window.GalaxyGen) GalaxyGen.init({ getState: function () { return S; }, save: save, rerender: renderMain, setView: setView });
  }

  function statCard(cls, k, id, c2) {
    return '<div class="stat ' + (c2 || "") + '"><div class="k">' + k + '</div><div class="v" id="' + id + '">—</div></div>';
  }

  function renderNav() {
    var side = document.getElementById("side"); var h = "";
    NAV.forEach(function (n) {
      h += '<div class="navbtn' + (S.ui.view === n.v ? " active" : "") + '" data-action="view" data-view="' + n.v + '">' +
        '<span class="ic">' + n.ic + '</span>' + n.t + '</div>';
    });
    h += '<div class="spacer"></div>';
    h += '<div class="mini">Speed <b>×' + SPEED + '</b> · runs in real time</div>';
    h += '<div class="navbtn" data-action="newgame" style="color:var(--red)"><span class="ic">⟲</span>New Game</div>';
    side.innerHTML = h;
  }

  function setView(v) { S.ui.view = v; renderNav(); renderMain(); save(); }

  function renderMain() {
    var v = S.ui.view;
    if (v === "overview") mainEl.innerHTML = viewOverview();
    else if (v === "bases") mainEl.innerHTML = viewBases();
    else if (v === "research") mainEl.innerHTML = viewResearch();
    else if (v === "shipyard") mainEl.innerHTML = viewShipyard();
    else if (v === "map") mainEl.innerHTML = viewMap();
    else if (v === "fleets") mainEl.innerHTML = viewFleets();
    else if (v === "galaxygen" && window.GalaxyGen) mainEl.innerHTML = GalaxyGen.viewHtml(S);
    else if (v === "galaxymap" && window.GalaxyGen) mainEl.innerHTML = GalaxyGen.mapHtml(S);
    updateDynamic();
  }

  /* ---------------- views ---------------- */
  function viewOverview() {
    var econ = empireEconomy(), res = empireResearch();
    var h = '<div class="view-title">Empire Overview</div><div class="grid cols-3">';
    // empire summary
    h += '<div class="panel"><h3>Empire</h3>' +
      kv("Bases", S.bases.length + " / " + maxBases()) +
      kv("Economy", fmt(econ) + " ₡/h") +
      kv("Research", fmt(res) + " rp/h") +
      kv("Fleet power", fmt(empireFleetPower())) +
      kv("Fleets in transit", S.fleets.length) +
      kv("Build slots", "queue ≤ " + queueMax()) +
      '</div>';
    // bases quick
    var bl = '<div class="panel"><h3>Bases</h3>';
    S.bases.forEach(function (b) {
      var e = baseEnergy(b);
      bl += '<div class="row" data-action="gobase" data-base="' + b.id + '" style="cursor:pointer">' +
        '<div class="ic">🏙️</div><div class="nm"><div class="t">' + esc(b.name) + ' <span class="coordtag">' + b.x + ':' + b.y + ':' + b.slot + '</span></div>' +
        '<div class="d">Econ ' + fmt(baseCredits(b)) + ' ₡/h · Energy ' + e.prod + '/' + e.cons + (e.prod < e.cons ? ' ⚠' : '') + '</div></div>' +
        '<div class="lvl">' + slotsUsed(b) + '/' + slotsMax(b) + '</div></div>';
    });
    bl += '</div>'; h += bl;
    // log
    h += '<div class="panel"><h3>Event Log</h3>' + logHtml() + '</div>';
    h += '</div>';
    return h;
  }

  function viewBases() {
    if (!S.ui.baseSel || !baseById(S.ui.baseSel)) S.ui.baseSel = S.bases[0].id;
    var tabs = '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px">';
    S.bases.forEach(function (b) {
      tabs += '<button class="btn ' + (b.id === S.ui.baseSel ? "" : "ghost") + '" data-action="seltab" data-base="' + b.id + '">' + esc(b.name) + '</button>';
    });
    tabs += '</div>';
    var base = baseById(S.ui.baseSel);
    var e = baseEnergy(base), eff = baseEfficiency(base);
    var h = '<div class="view-title">Base · ' + esc(base.name) + ' <span class="coordtag">' + base.x + ':' + base.y + ':' + base.slot + '</span></div>' + tabs;
    h += '<div class="grid cols-2">';
    // structures
    var sh = '<div class="panel"><h3>Structures <span class="tag">' + slotsUsed(base) + '/' + slotsMax(base) + ' slots</span></h3>';
    STRUCT_ORDER.forEach(function (k) {
      var d = STRUCT[k], lvl = structLevel(base, k), ok = reqMetStruct(base, d.req);
      var cost = structCost(base, k), afford = S.credits >= cost;
      var slotsFull = slotsUsed(base) + pendingSlots(base) >= slotsMax(base);
      sh += '<div class="row' + (ok ? "" : " locked") + '">' +
        '<div class="ic">' + d.icon + '</div>' +
        '<div class="nm"><div class="t">' + d.name + '</div><div class="d">' + d.desc +
          (ok ? "" : ' <span class="tag2 lock">🔒 ' + reqText(d.req) + '</span>') + '</div></div>' +
        '<div class="lvl">L' + lvl + '</div>' +
        '<div style="text-align:right"><div class="cost">' + fmt(cost) + ' ₡</div>' +
        '<button class="btn sm" style="margin-top:5px" data-action="upgrade" data-base="' + base.id + '" data-key="' + k + '"' +
          (ok && afford && !slotsFull ? "" : " disabled") + '>Upgrade</button></div>' +
        '</div>';
    });
    sh += '</div>';
    // energy + queue
    var rp = '<div class="panel"><h3>Power & Economy</h3>' +
      kv("Energy output", e.prod) +
      kvWarn("Energy used", e.cons, e.cons > e.prod) +
      kvWarn("Efficiency", Math.round(eff * 100) + "%", eff < 1) +
      kv("Credits", fmt(baseCredits(base)) + " ₡/h") +
      kv("Research", fmt(baseResearch(base)) + " rp/h") +
      kv("Build speed", "×" + buildSpeed(base).toFixed(2)) +
      '</div>';
    rp += '<div class="panel"><h3>Build Queue <span class="tag">' + base.queue.length + '/' + queueMax() + '</span></h3>' + queueHtml(base) + '</div>';
    h += sh + '<div>' + rp + '</div>';
    h += '</div>';
    return h;
  }

  function viewResearch() {
    var h = '<div class="view-title">Research Laboratory</div>';
    h += '<div class="grid cols-2"><div class="panel"><h3>Technologies</h3>';
    TECH_ORDER.forEach(function (k) {
      var d = TECH[k], lvl = S.techs[k] || 0, ok = reqMet(d.req), cost = techCost(k), afford = S.rp >= cost;
      var busy = !!S.research;
      h += '<div class="row' + (ok ? "" : " locked") + '">' +
        '<div class="ic">' + d.icon + '</div>' +
        '<div class="nm"><div class="t">' + d.name + '</div><div class="d">' + d.desc +
          (ok ? "" : ' <span class="tag2 lock">🔒 ' + reqText(d.req) + '</span>') + '</div></div>' +
        '<div class="lvl">L' + lvl + '</div>' +
        '<div style="text-align:right"><div class="cost"><span class="rp">' + fmt(cost) + ' rp</span></div>' +
        '<button class="btn sm" style="margin-top:5px" data-action="research" data-key="' + k + '"' +
          (ok && afford && !busy ? "" : " disabled") + '>Research</button></div>' +
        '</div>';
    });
    h += '</div>';
    // active + info
    var rp = '<div class="panel"><h3>Active Research</h3>';
    if (S.research) {
      rp += '<div class="qitem"><div class="ic">' + TECH[S.research.key].icon + '</div>' +
        '<div class="qt"><b>' + TECH[S.research.key].name + '</b> → L' + ((S.techs[S.research.key] || 0) + 1) + '</div>' +
        '<div class="qtimer" data-finish="' + S.research.finishAt + '"></div>' +
        '<button class="btn sm danger" data-action="cancelres">✕</button></div>' +
        '<div class="bar"><span data-bar="' + S.research.finishAt + '" data-dur="' + S.research.dur + '"></span></div>';
    } else rp += '<div class="empty">No active research. Pick a technology to advance.</div>';
    rp += '</div>';
    rp += '<div class="panel"><h3>Research Output</h3>' +
      kv("Stockpile", fmt(S.rp) + " rp") + kv("Income", fmt(empireResearch()) + " rp/h") + '</div>';
    h += '<div>' + rp + '</div></div>';
    return h;
  }

  function viewShipyard() {
    var bases = S.bases.filter(function (b) { return structLevel(b, "shipyard") >= 1; });
    if (!bases.length) return '<div class="view-title">Shipyard</div><div class="panel"><div class="empty">No base has a Shipyard yet. Build one in the Bases tab.</div></div>';
    if (!S.ui.yard || !baseById(S.ui.yard) || structLevel(baseById(S.ui.yard), "shipyard") < 1) S.ui.yard = bases[0].id;
    var base = baseById(S.ui.yard);
    var tabs = '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px">';
    bases.forEach(function (b) { tabs += '<button class="btn ' + (b.id === S.ui.yard ? "" : "ghost") + '" data-action="selyard" data-base="' + b.id + '">' + esc(b.name) + ' · SY' + structLevel(b, "shipyard") + '</button>'; });
    tabs += '</div>';
    var h = '<div class="view-title">Shipyard · ' + esc(base.name) + '</div>' + tabs + '<div class="grid cols-2">';
    var sh = '<div class="panel"><h3>Construction</h3>';
    SHIP_ORDER.forEach(function (k) {
      var d = SHIP[k], ok = reqMet(d.req) && structLevel(base, "shipyard") >= (d.req.shipyard || 1);
      var cost = d.cost, afford = S.credits >= cost;
      var es = effStats(k, S.techs);
      sh += '<div class="row' + (ok ? "" : " locked") + '">' +
        '<div class="ic">' + d.icon + '</div>' +
        '<div class="nm"><div class="t">' + d.name + (d.colony ? ' <span class="tag2 ok">colony</span>' : '') + '</div>' +
        '<div class="d">' + d.desc + '<br>⚔ ' + Math.round(es.atk) + ' · ❤ ' + Math.round(es.hp) + ' · 🚀 ' + d.speed +
          (ok ? "" : ' <span class="tag2 lock">🔒 ' + reqText(d.req) + '</span>') + '</div></div>' +
        '<div style="text-align:right"><div class="cost">' + fmt(cost) + ' ₡</div>' +
        '<div style="display:flex;gap:5px;margin-top:5px;justify-content:flex-end">' +
          '<button class="btn sm" data-action="buildship" data-base="' + base.id + '" data-key="' + k + '" data-qty="1"' + (ok && afford ? "" : " disabled") + '>+1</button>' +
          '<button class="btn sm" data-action="buildship" data-base="' + base.id + '" data-key="' + k + '" data-qty="5"' + (ok && afford ? "" : " disabled") + '>+5</button>' +
        '</div></div></div>';
    });
    sh += '</div>';
    var rp = '<div class="panel"><h3>Build Queue <span class="tag">' + base.queue.length + '/' + queueMax() + '</span></h3>' + queueHtml(base) + '</div>';
    rp += '<div class="panel"><h3>Garrison · ' + esc(base.name) + '</h3>' + fleetList(base.fleet) + '</div>';
    h += sh + '<div>' + rp + '</div></div>';
    return h;
  }

  function viewMap() {
    var h = '<div class="view-title">Local Map</div><div class="mapwrap">';
    // galaxy grid
    var g = '<div><div class="galaxy" style="grid-template-columns:repeat(' + S.map.w + ',1fr)">';
    for (var y = 1; y <= S.map.h; y++) {
      for (var x = 1; x <= S.map.w; x++) {
        var sys = S.map.systems[x + ":" + y];
        var sel = S.ui.sys === (x + ":" + y);
        var youHere = sys.planets.some(function (p) { return p.owner === "you"; });
        var pirate = sys.planets.some(function (p) { return p.owner === "pirate"; });
        var coloniz = sys.known && sys.planets.some(function (p) { return p.owner === "empty" && PLANET_TYPES[p.type].hab; });
        var dots = '';
        if (sys.known) {
          if (youHere) dots += '<span class="dot you"></span>';
          if (pirate) dots += '<span class="dot pirate"></span>';
          if (coloniz) dots += '<span class="dot colonizable"></span>';
        }
        g += '<div class="sys' + (sel ? ' sel' : '') + (sys.known ? '' : ' unknown') + '" data-action="opensys" data-sys="' + x + ':' + y + '">' +
          '<span class="coord">' + x + ':' + y + '</span>' +
          '<span class="star">' + (sys.known ? sys.star : '·') + '</span>' +
          '<span class="dots">' + dots + '</span></div>';
      }
    }
    g += '</div><div class="legend">' +
      '<span><i style="background:var(--cyan)"></i>Your base</span>' +
      '<span><i style="background:var(--red)"></i>Pirate</span>' +
      '<span><i style="background:var(--green)"></i>Colonizable</span>' +
      '<span><i style="background:#33486b"></i>Unscouted/empty</span></div></div>';
    // system detail + planner
    var d = '<div>';
    if (S.ui.sys) {
      var sys2 = S.map.systems[S.ui.sys];
      d += '<div class="panel"><h3>System ' + S.ui.sys + (sys2.known ? '' : ' <span class="tag" style="color:var(--red)">unscouted</span>') + '</h3>';
      if (!sys2.known) {
        d += '<div class="empty">Send a Scout (Probe) here to reveal its planets.</div>';
        d += plannerHtml({ x: sys2.x, y: sys2.y, slot: 1 }, sys2, null);
      } else {
        sys2.planets.forEach(function (p) {
          var t = PLANET_TYPES[p.type];
          var badge = p.owner === "you" ? '<span class="tag2 ok">your base</span>' :
            p.owner === "pirate" ? '<span class="tag2 lock">pirate T' + (p.tier || 1) + '</span>' :
            (t.hab ? '<span class="tag2 ok">colonizable</span>' : '<span class="tag2">' + t.name + '</span>');
          d += '<div class="planet"><div class="pic">' + t.icon + '</div>' +
            '<div class="pn"><div class="t">' + t.name + ' <span class="coordtag">' + sys2.x + ':' + sys2.y + ':' + p.slot + '</span></div>' +
            '<div class="d">Size ' + p.size + ' · ' + badge +
              (p.owner === "pirate" ? ' · loot ~' + fmt(p.loot) + ' ₡' : '') + '</div></div>' +
            '<button class="btn sm ghost" data-action="target" data-x="' + sys2.x + '" data-y="' + sys2.y + '" data-slot="' + p.slot + '">Target</button>' +
            '</div>';
        });
        d += plannerHtml(S.ui.target, sys2, null);
      }
      d += '</div>';
    } else {
      d += '<div class="panel"><h3>System</h3><div class="empty">Select a system on the map.</div></div>';
    }
    d += '</div>';
    h += g + d + '</div>';
    return h;
  }

  function plannerHtml(target, sys) {
    if (!S.bases.length) return '';
    if (!S.ui.origin || !baseById(S.ui.origin)) S.ui.origin = S.bases[0].id;
    var origin = baseById(S.ui.origin);
    target = target || (sys ? { x: sys.x, y: sys.y, slot: 1 } : null);
    var h = '<div class="planner" style="margin-top:12px;border-top:1px solid var(--line);padding-top:10px">';
    h += '<div style="font-size:12px;color:var(--dim);margin-bottom:6px">Mission planner';
    if (target) h += ' → <span class="coordtag">' + target.x + ':' + target.y + ':' + target.slot + '</span>';
    h += '</div>';
    // origin select
    if (S.bases.length > 1) {
      h += '<select class="btn ghost" data-action="origin" style="width:100%;margin-bottom:8px">';
      S.bases.forEach(function (b) { h += '<option value="' + b.id + '"' + (b.id === origin.id ? ' selected' : '') + '>From: ' + esc(b.name) + '</option>'; });
      h += '</select>';
    }
    // mission buttons
    h += '<div class="missionbtns">';
    [["attack", "⚔ Attack"], ["colonize", "🪐 Colonize"], ["probe", "🛰 Probe"]].forEach(function (m) {
      h += '<button class="btn sm ' + (S.ui.mission === m[0] ? '' : 'ghost') + '" data-action="mission" data-m="' + m[0] + '">' + m[1] + '</button>';
    });
    h += '</div>';
    // ship steppers from origin garrison
    var fleet = origin.fleet || {};
    var any = false;
    SHIP_ORDER.forEach(function (k) {
      var have = fleet[k] || 0; if (!have) return; any = true;
      var sel = S.ui.sel[k] || 0;
      h += '<div class="stepper"><div class="nm">' + SHIP[k].icon + ' ' + SHIP[k].name + ' <small>(' + have + ')</small></div>' +
        '<button class="sx" data-action="sel" data-key="' + k + '" data-d="-1">−</button>' +
        '<span class="qty">' + sel + '</span>' +
        '<button class="sx" data-action="sel" data-key="' + k + '" data-d="1">+</button>' +
        '<button class="sx" data-action="selmax" data-key="' + k + '" title="all">≫</button></div>';
    });
    if (!any) h += '<div class="empty">No ships at ' + esc(origin.name) + '. Build some in the Shipyard.</div>';
    var canSend = any && target && Object.keys(cleanShips(S.ui.sel)).length;
    h += '<button class="btn big" style="width:100%;margin-top:10px" data-action="send"' + (canSend ? '' : ' disabled') + '>🚀 Launch Fleet</button>';
    h += '</div>';
    return h;
  }

  function viewFleets() {
    var h = '<div class="view-title">Fleets in Transit</div><div class="grid cols-2"><div class="panel"><h3>Active Missions</h3>';
    if (!S.fleets.length) h += '<div class="empty">No fleets in transit. Launch one from the Galaxy Map.</div>';
    S.fleets.forEach(function (f) {
      var mi = f.mission === "attack" ? "⚔" : f.mission === "colonize" ? "🪐" : f.mission === "probe" ? "🛰" : "↩";
      var label = f.phase === "back" ? "Returning to base" : (f.mission.charAt(0).toUpperCase() + f.mission.slice(1)) + " " + f.tx + ":" + f.ty + ":" + f.slot;
      h += '<div class="qitem"><div class="ic">' + mi + '</div>' +
        '<div class="qt"><b>' + label + '</b><br><small style="color:var(--dim)">' + fleetSummary(f.ships) + ' · pwr ' + fmt(fleetPower(f.ships)) + '</small></div>' +
        '<div class="qtimer" data-finish="' + f.arriveAt + '"></div>' +
        (f.phase === "out" ? '<button class="btn sm ghost" data-action="recall" data-id="' + f.id + '">Recall</button>' : '') +
        '</div>';
    });
    h += '</div>';
    h += '<div class="panel"><h3>Garrisons</h3>';
    S.bases.forEach(function (b) {
      h += '<div style="margin-bottom:10px"><div style="font-size:12px;color:var(--cyan);margin-bottom:4px">' + esc(b.name) + ' <span class="coordtag">' + b.x + ':' + b.y + ':' + b.slot + '</span></div>' +
        fleetList(b.fleet) + '</div>';
    });
    h += '</div></div>';
    return h;
  }

  /* ---------------- small html helpers ---------------- */
  function kv(k, v) { return '<div class="kv"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }
  function kvWarn(k, v, warn) { return '<div class="kv"><span class="k">' + k + '</span><span class="v' + (warn ? ' warnv' : '') + '">' + v + '</span></div>'; }
  function queueHtml(base) {
    if (!base.queue.length) return '<div class="empty">Idle. Queue a structure or ship.</div>';
    var h = '';
    base.queue.forEach(function (q, i) {
      var nm = q.kind === "struct" ? STRUCT[q.key].name + " → L" + (structLevel(base, q.key) + 1) : (q.qty + "× " + SHIP[q.key].name);
      var ic = q.kind === "struct" ? STRUCT[q.key].icon : SHIP[q.key].icon;
      h += '<div class="qitem"><div class="ic">' + ic + '</div>' +
        '<div class="qt"><b>' + nm + '</b></div>' +
        '<div class="qtimer" data-finish="' + q.finishAt + '"></div>' +
        '<button class="btn sm danger" data-action="cancel" data-base="' + base.id + '" data-idx="' + i + '">✕</button></div>';
      if (i === 0) h += '<div class="bar"><span data-bar="' + q.finishAt + '" data-dur="' + q.dur + '"></span></div>';
    });
    return h;
  }
  function fleetList(fleet) {
    fleet = fleet || {}; var items = SHIP_ORDER.filter(function (k) { return fleet[k] > 0; });
    if (!items.length) return '<div class="empty">No ships stationed here.</div>';
    var h = '';
    items.forEach(function (k) {
      h += '<div class="kv"><span class="k">' + SHIP[k].icon + ' ' + SHIP[k].name + '</span><span class="v">' + fleet[k] + '</span></div>';
    });
    return h;
  }
  function fleetSummary(ships) {
    var parts = []; SHIP_ORDER.forEach(function (k) { if (ships[k]) parts.push(ships[k] + " " + SHIP[k].name); });
    return parts.join(", ") || "empty";
  }
  function logHtml() {
    if (!S.log.length) return '<div class="empty">No events yet.</div>';
    var h = '<div class="log">';
    S.log.slice(0, 22).forEach(function (e) {
      h += '<div class="e ' + e.c + '"><span class="ts">' + clock(e.t) + '</span>' + esc(e.m) + '</div>';
    });
    return h + '</div>';
  }
  function clock(t) { var d = new Date(t); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  /* ---------------- dynamic refresh (no full re-render) ---------------- */
  function updateDynamic() {
    setTxt("st-credits", fmt(S.credits) + " ₡");
    setTxt("st-rp", fmt(S.rp) + " rp");
    setTxt("st-econ", fmt(empireEconomy()) + "<small> /h</small>");
    setTxt("st-res", fmt(empireResearch()) + "<small> /h</small>");
    setTxt("st-bases", S.bases.length + " / " + maxBases());
    setTxt("st-power", fmt(empireFleetPower()));
    var t = now();
    var timers = document.querySelectorAll("[data-finish]");
    for (var i = 0; i < timers.length; i++) {
      timers[i].textContent = fmtTime((parseFloat(timers[i].getAttribute("data-finish")) - t) / 1000);
    }
    var bars = document.querySelectorAll("[data-bar]");
    for (var j = 0; j < bars.length; j++) {
      var fin = parseFloat(bars[j].getAttribute("data-bar")), dur = parseFloat(bars[j].getAttribute("data-dur")) * 1000;
      var pct = dur > 0 ? (1 - (fin - t) / dur) : 1;
      bars[j].style.width = Math.max(0, Math.min(100, pct * 100)) + "%";
    }
  }
  function setTxt(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }

  /* ---------------- events ---------------- */
  function onClick(e) {
    var el = e.target.closest("[data-action]"); if (!el) return;
    var a = el.getAttribute("data-action");
    if (a === "view") { setView(el.getAttribute("data-view")); return; }
    if (a === "newgame") { if (confirm("Abandon this empire and start a new game?")) { wipe(); location.reload(); } return; }
    if (a === "gobase") { S.ui.baseSel = +el.getAttribute("data-base"); setView("bases"); return; }
    if (a === "seltab") { S.ui.baseSel = +el.getAttribute("data-base"); renderMain(); return; }
    if (a === "selyard") { S.ui.yard = +el.getAttribute("data-base"); renderMain(); return; }
    if (a === "upgrade") { queueStruct(+el.getAttribute("data-base"), el.getAttribute("data-key")); renderMain(); return; }
    if (a === "buildship") { queueShip(+el.getAttribute("data-base"), el.getAttribute("data-key"), +el.getAttribute("data-qty")); renderMain(); return; }
    if (a === "cancel") { cancelQueue(+el.getAttribute("data-base"), +el.getAttribute("data-idx")); renderMain(); return; }
    if (a === "research") { startResearch(el.getAttribute("data-key")); renderMain(); return; }
    if (a === "cancelres") { cancelResearch(); renderMain(); return; }
    if (a === "opensys") { S.ui.sys = el.getAttribute("data-sys"); renderMain(); return; }
    if (a === "target") {
      S.ui.target = { x: +el.getAttribute("data-x"), y: +el.getAttribute("data-y"), slot: +el.getAttribute("data-slot") };
      // auto-pick sensible mission
      var sys = S.map.systems[S.ui.target.x + ":" + S.ui.target.y]; var p = sys.planets[S.ui.target.slot - 1];
      if (p.owner === "pirate") S.ui.mission = "attack";
      else if (p.owner === "empty" && PLANET_TYPES[p.type].hab) S.ui.mission = "colonize";
      else S.ui.mission = "probe";
      renderMain(); return;
    }
    if (a === "mission") { S.ui.mission = el.getAttribute("data-m"); renderMain(); return; }
    if (a === "sel") {
      var k = el.getAttribute("data-key"), d = +el.getAttribute("data-d");
      var origin = baseById(S.ui.origin) || S.bases[0]; var have = (origin.fleet && origin.fleet[k]) || 0;
      S.ui.sel[k] = Math.max(0, Math.min(have, (S.ui.sel[k] || 0) + d));
      renderMain(); return;
    }
    if (a === "selmax") {
      var k2 = el.getAttribute("data-key"); var origin2 = baseById(S.ui.origin) || S.bases[0];
      S.ui.sel[k2] = (origin2.fleet && origin2.fleet[k2]) || 0; renderMain(); return;
    }
    if (a === "send") {
      var origin3 = baseById(S.ui.origin) || S.bases[0];
      if (sendFleet(origin3.id, S.ui.target, S.ui.mission, S.ui.sel)) { renderMain(); }
      return;
    }
    if (a === "recall") { recallFleet(+el.getAttribute("data-id")); renderMain(); return; }
  }
  function onChange(e) {
    var el = e.target.closest("[data-action]"); if (!el) return;
    if (el.getAttribute("data-action") === "origin") { S.ui.origin = +el.value; S.ui.sel = {}; renderMain(); }
  }

  /* ---------------- main loop ---------------- */
  var loopRef = null;
  function startLoop() {
    if (loopRef) clearInterval(loopRef);
    loopRef = setInterval(function () {
      var changed = tick(now());
      if (changed) { renderNav(); renderMain(); save(); }
      else updateDynamic();
    }, 1000);
  }

  /* ---------------- starfield ---------------- */
  function drawStars(cv) {
    var w = cv.width = window.innerWidth, h = cv.height = window.innerHeight;
    var ctx = cv.getContext("2d"); ctx.clearRect(0, 0, w, h);
    var n = Math.min(220, (w * h) / 9000);
    for (var i = 0; i < n; i++) {
      var x = Math.random() * w, y = Math.random() * h, r = Math.random() * 1.3;
      ctx.globalAlpha = 0.3 + Math.random() * 0.6;
      ctx.fillStyle = Math.random() < 0.2 ? "#7fd0ff" : "#cdd9ee";
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
