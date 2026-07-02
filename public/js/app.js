/* public/js/app.js — Astro Empire (thin, DB-backed client)
   ---------------------------------------------------------------------------
   Every piece of live game state — commanders, local-galaxy systems/planets,
   bases, garrisoned & in-transit fleets/ships, the active research item and
   the event log — lives in the DB (see src/sql/schema.sql) and is served by
   /api/galaxy/*. This file no longer simulates the game or persists anything
   to localStorage: it fetches state, renders it, and POSTs player actions,
   then re-fetches the authoritative result. A ship is only ever "in a base's
   garrison" (server-side JSON), "in a fleets row" (in transit), or gone —
   never only in the browser.

   Client-side copies of the STRUCT/TECH/SHIP/PLANET_TYPES tables exist only
   to *display* names, icons, descriptions and indicative costs/timers before
   an action is attempted; the server independently recomputes and enforces
   every cost, requirement and outcome, so a stale or tampered client copy
   can't grant anything it shouldn't.
*/
(function () {
  "use strict";

  var API = "/api/galaxy";

  /* ============================================================= DISPLAY DATA
     (icons/desc/cost formulas — cosmetic + indicative only; server is
     authoritative for every actual mutation.) */
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
    laser:    { name: "Laser",             icon: "🔴", cost: 320,  f: 1.85, desc: "Core weapon tech; unlocks early warships." },
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
    corvette: { name: "Corvette",     icon: "🛸", cost: 320,  atk: 15,  arm: 9,   shd: 4,   hull: 15,  speed: 46, req: { shipyard: 2, laser: 2 }, desc: "Balanced light warship." },
    frigate:  { name: "Frigate",      icon: "✈️", cost: 760,  atk: 32,  arm: 20,  shd: 9,   hull: 32,  speed: 40, req: { shipyard: 3, laser: 4, shield: 2 }, desc: "Durable mid-class hull." },
    destroyer:{ name: "Destroyer",    icon: "🚢", cost: 1700, atk: 74,  arm: 44,  shd: 20,  hull: 74,  speed: 35, req: { shipyard: 5, plasma: 1, armour: 3 }, desc: "Heavy firepower." },
    cruiser:  { name: "Cruiser",      icon: "🛳️", cost: 3600, atk: 158, arm: 95,  shd: 44,  hull: 158, speed: 32, req: { shipyard: 7, plasma: 4, shield: 5 }, desc: "Capital-class warship." },
    dread:    { name: "Dreadnought",  icon: "🌑", cost: 9200, atk: 420, arm: 250, shd: 120, hull: 420, speed: 28, req: { shipyard: 10, plasma: 8, armour: 8, shield: 8 }, desc: "Battlefield dominator." },
    colony:   { name: "Outpost Ship", icon: "🪐", cost: 2200, atk: 0,   arm: 24,  shd: 0,   hull: 44,  speed: 26, req: { shipyard: 3, astro: 1 }, colony: true, desc: "Founds a new base — is not a base itself until it lands." }
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

  function fmt(n) {
    n = Math.round(n);
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + "k";
    return Math.round(n).toLocaleString("en-US");
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return h + "h " + m + "m";
    if (m) return m + "m " + (s < 10 ? "0" : "") + s + "s";
    return s + "s";
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function structLevel(struct, key) { return (struct && struct[key]) || 0; }
  function structCostDisplay(struct, key) { var d = STRUCT[key]; return Math.round(d.cost * Math.pow(d.f, structLevel(struct, key))); }
  function techCostDisplay(techs, key) { var d = TECH[key]; return Math.round(d.cost * Math.pow(d.f, (techs && techs[key]) || 0)); }
  function reqMet(techs, req) { if (!req) return true; for (var k in req) if (TECH[k] && ((techs && techs[k]) || 0) < req[k]) return false; return true; }
  function reqMetStruct(struct, techs, req) {
    if (!req) return true;
    for (var k in req) {
      if (TECH[k]) { if (((techs && techs[k]) || 0) < req[k]) return false; }
      else if (STRUCT[k]) { if (structLevel(struct, k) < req[k]) return false; }
    }
    return true;
  }
  function reqText(req) {
    if (!req) return "";
    var parts = [];
    for (var k in req) parts.push((TECH[k] ? TECH[k].name : (STRUCT[k] ? STRUCT[k].name : k)) + " " + req[k]);
    return parts.join(", ");
  }
  function slotsUsed(struct) { var u = 0; STRUCT_ORDER.forEach(function (k) { u += structLevel(struct, k); }); return u; }
  function slotsMax(struct, size) {
    var max = size;
    STRUCT_ORDER.forEach(function (k) { var d = STRUCT[k]; if (d.slots) max += d.slots(structLevel(struct, k)); });
    return max;
  }
  function baseEnergyDisplay(struct, techs) {
    var prod = 0, cons = 0, eBonus = 1 + 0.04 * ((techs && techs.energy) || 0);
    STRUCT_ORDER.forEach(function (k) {
      var l = structLevel(struct, k); if (!l) return; var d = STRUCT[k];
      if (d.energy) prod += d.energy(l) * eBonus;
      if (d.consume) cons += d.consume(l);
    });
    return { prod: Math.round(prod), cons: Math.round(cons) };
  }
  function baseEfficiencyDisplay(struct, techs) {
    var e = baseEnergyDisplay(struct, techs);
    if (e.cons <= 0) return 1;
    return Math.max(0, Math.min(1, e.prod / e.cons));
  }
  function baseCreditsDisplay(struct, techs) {
    var eff = baseEfficiencyDisplay(struct, techs), c = 18;
    STRUCT_ORDER.forEach(function (k) { var d = STRUCT[k]; if (d.credits) c += d.credits(structLevel(struct, k)) * eff; });
    return c;
  }
  function baseResearchDisplay(struct, techs) {
    var eff = baseEfficiencyDisplay(struct, techs), r = 0;
    STRUCT_ORDER.forEach(function (k) { var d = STRUCT[k]; if (d.research) r += d.research(structLevel(struct, k)) * eff; });
    return r;
  }
  function fleetPower(ships) {
    var p = 0; for (var k in ships) if (SHIP[k]) p += ships[k] * (SHIP[k].atk + SHIP[k].arm + SHIP[k].shd + SHIP[k].hull); return p;
  }
  function empireEconomy(S) {
    var c = 0; S.bases.forEach(function (b) { c += baseCreditsDisplay(b.struct, S.techs); });
    return c * (1 + 0.05 * ((S.techs && S.techs.ai) || 0));
  }
  function empireResearch(S) { var r = 0; S.bases.forEach(function (b) { r += baseResearchDisplay(b.struct, S.techs); }); return r; }
  function empireFleetPower(S) {
    var p = 0; S.bases.forEach(function (b) { p += fleetPower(b.fleet || {}); }); S.fleets.forEach(function (f) { p += fleetPower(f.ships); }); return p;
  }
  function cleanShips(s) { var o = {}; for (var k in s) if (s[k] > 0) o[k] = s[k]; return o; }
  function effStatsDisplay(key, techs) {
    var s = SHIP[key];
    var aMul = 1 + 0.06 * (((techs && techs.laser) || 0) + ((techs && techs.plasma) || 0));
    var sMul = 1 + 0.08 * ((techs && techs.shield) || 0);
    var hMul = 1 + 0.08 * ((techs && techs.armour) || 0);
    return { atk: s.atk * aMul, hp: s.hull * hMul + s.arm * hMul + s.shd * sMul };
  }

  /* ============================================================= API LAYER */
  function api(method, path, body) {
    var opts = { method: method, headers: { "Content-Type": "application/json" } };
    if (window.__CSRF__) opts.headers["x-csrf-token"] = window.__CSRF__;
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + path, opts).then(function (r) { return r.json(); });
  }

  var S = null;          // last-fetched server game state
  var GG_STATE = {};      // persistent client-only Galaxy-Gen exploration UI state

  function fetchState() { return api("GET", "/state").then(function (r) { if (r.ok) S = r.state; return r; }); }
  function refreshState() { return fetchState(); }

  var Game = {
    fmt: fmt,
    state: function () { return S; },
    sendColonize: function (address, size) {
      return api("POST", "/colonize", { address: address, size: size }).then(function (r) {
        if (!r.ok) { toast(r.error || "Failed", true); return false; }
        return true;
      });
    }
  };
  if (typeof window !== "undefined") window.__ASTRO = Game;

  if (typeof document === "undefined") return; // headless guard

  var app, mainEl;
  var UI = { view: "overview", baseSel: null, yard: null, sys: null, target: null, origin: null, sel: {}, mission: "attack" };

  var NAV = [
    { v: "overview", ic: "🛰️", t: "Overview" },
    { v: "bases", ic: "🏙️", t: "Bases" },
    { v: "research", ic: "🔬", t: "Research" },
    { v: "shipyard", ic: "🏗️", t: "Shipyard" },
    { v: "map", ic: "🌎", t: "Local Map" },
    { v: "fleets", ic: "🚀", t: "Fleets" },
    { v: "galaxygen", ic: "🌌", t: "Galaxy Gen" },
    { v: "galaxymap", ic: "🗺️", t: "Galaxy map" }
  ];

  var toastTimer = null;
  function toast(msg, bad) {
    var el = document.getElementById("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
    el.className = "toast" + (bad ? " bad" : ""); el.textContent = msg; el.style.display = "block";
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.style.display = "none"; }, 2200);
  }

  function boot() {
    app = document.getElementById("astro-game");
    if (!app) return; // this page doesn't host the game (login/register/setup/etc.)

    var stars = document.createElement("canvas"); stars.className = "stars"; document.body.appendChild(stars);
    drawStars(stars); window.addEventListener("resize", function () { drawStars(stars); });

    app.innerHTML = '<div class="intro"><div class="introbox"><div class="logo">🌌</div><h2>Astro Empire</h2><p>Loading your empire…</p></div></div>';
    fetchState().then(function (r) {
      if (!r.ok) { app.innerHTML = '<div class="intro"><div class="introbox"><h2>Could not load empire</h2><p>' + esc(r.error || '') + '</p></div></div>'; return; }
      buildShell();
      setView("overview");
      startLoop();
    });
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
    if (window.GalaxyGen) {
      window.GalaxyGen.init({
        getState: function () { S.gg = GG_STATE; S.ui = { view: UI.view }; return S; },
        save: function () { /* Galaxy-Gen exploration UI is not persisted server-side */ },
        rerender: renderMain,
        setView: setView,
        refreshState: refreshState
      });
    }
  }

  function statCard(cls, k, id, c2) {
    return '<div class="stat ' + (c2 || "") + '"><div class="k">' + k + '</div><div class="v" id="' + id + '">—</div></div>';
  }

  function renderNav() {
    var side = document.getElementById("side"); var h = "";
    NAV.forEach(function (n) {
      h += '<div class="navbtn' + (UI.view === n.v ? " active" : "") + '" data-action="view" data-view="' + n.v + '">' +
        '<span class="ic">' + n.ic + '</span>' + n.t + '</div>';
    });
    h += '<div class="spacer"></div>';
    h += '<div class="mini">Runs server-side · autosaved in the DB</div>';
    h += '<div class="navbtn" data-action="newgame" style="color:var(--red)"><span class="ic">⏻</span>New Game</div>';
    side.innerHTML = h;
  }

  function setView(v) { UI.view = v; renderNav(); renderMain(); }

  function renderMain() {
    var v = UI.view;
    if (v === "overview") mainEl.innerHTML = viewOverview();
    else if (v === "bases") mainEl.innerHTML = viewBases();
    else if (v === "research") mainEl.innerHTML = viewResearch();
    else if (v === "shipyard") mainEl.innerHTML = viewShipyard();
    else if (v === "map") mainEl.innerHTML = viewMap();
    else if (v === "fleets") mainEl.innerHTML = viewFleets();
    else if (v === "galaxygen" && window.GalaxyGen) { S.gg = GG_STATE; S.ui = { view: UI.view }; mainEl.innerHTML = window.GalaxyGen.viewHtml(S); }
    else if (v === "galaxymap" && window.GalaxyGen) { S.gg = GG_STATE; S.ui = { view: UI.view }; mainEl.innerHTML = window.GalaxyGen.mapHtml(S); }
    updateDynamic();
  }

  /* ---------------- views (rendering only — identical layout to before) ---------------- */
  function viewOverview() {
    var econ = empireEconomy(S), res = empireResearch(S);
    var h = '<div class="view-title">Empire Overview</div><div class="grid cols-3">';
    h += '<div class="panel"><h3>Empire</h3>' +
      kv("Bases", S.bases.length + " / " + S.maxBases) +
      kv("Economy", fmt(econ) + " ₤/h") +
      kv("Research", fmt(res) + " rp/h") +
      kv("Fleet power", fmt(empireFleetPower(S))) +
      kv("Fleets in transit", S.fleets.length) +
      kv("Build slots", "queue ≤ " + S.queueMax) +
      '</div>';
    var bl = '<div class="panel"><h3>Bases</h3>';
    S.bases.forEach(function (b) {
      var e = baseEnergyDisplay(b.struct, S.techs);
      var coord = b.address || (b.x + ':' + b.y + ':' + b.slot);
      bl += '<div class="row" data-action="gobase" data-base="' + b.id + '" style="cursor:pointer">' +
        '<div class="ic">🏙️</div><div class="nm"><div class="t">' + esc(b.name) + ' <span class="coordtag">' + coord + '</span></div>' +
        '<div class="d">Econ ' + fmt(baseCreditsDisplay(b.struct, S.techs)) + ' ₤/h · Energy ' + e.prod + '/' + e.cons + (e.prod < e.cons ? ' ⚠' : '') + '</div></div>' +
        '<div class="lvl">' + slotsUsed(b.struct) + '/' + slotsMax(b.struct, b.size) + '</div></div>';
    });
    bl += '</div>'; h += bl;
    h += '<div class="panel"><h3>Event Log</h3>' + logHtml() + '</div>';
    h += '</div>';
    return h;
  }

  function findBase(id) { for (var i = 0; i < S.bases.length; i++) if (S.bases[i].id === id) return S.bases[i]; return null; }

  function viewBases() {
    if (!UI.baseSel || !findBase(UI.baseSel)) UI.baseSel = S.bases[0].id;
    var tabs = '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px">';
    S.bases.forEach(function (b) {
      tabs += '<button class="btn ' + (b.id === UI.baseSel ? "" : "ghost") + '" data-action="seltab" data-base="' + b.id + '">' + esc(b.name) + '</button>';
    });
    tabs += '</div>';
    var base = findBase(UI.baseSel);
    var e = baseEnergyDisplay(base.struct, S.techs), eff = baseEfficiencyDisplay(base.struct, S.techs);
    var coordb = base.address || (base.x + ':' + base.y + ':' + base.slot);
    var h = '<div class="view-title">Base · ' + esc(base.name) + ' <span class="coordtag">' + coordb + '</span></div>' + tabs;
    h += '<div class="grid cols-2">';
    var sh = '<div class="panel"><h3>Structures <span class="tag">' + slotsUsed(base.struct) + '/' + slotsMax(base.struct, base.size) + ' slots</span></h3>';
    STRUCT_ORDER.forEach(function (k) {
      var d = STRUCT[k], lvl = structLevel(base.struct, k), okReq = reqMetStruct(base.struct, S.techs, d.req);
      var cost = structCostDisplay(base.struct, k), afford = S.credits >= cost;
      var pendingSlots = base.queue.filter(function (q) { return q.kind === "struct"; }).length;
      var slotsFull = slotsUsed(base.struct) + pendingSlots >= slotsMax(base.struct, base.size);
      sh += '<div class="row' + (okReq ? "" : " locked") + '">' +
        '<div class="ic">' + d.icon + '</div>' +
        '<div class="nm"><div class="t">' + d.name + '</div><div class="d">' + d.desc +
          (okReq ? "" : ' <span class="tag2 lock">🔒 ' + reqText(d.req) + '</span>') + '</div></div>' +
        '<div class="lvl">L' + lvl + '</div>' +
        '<div style="text-align:right"><div class="cost">' + fmt(cost) + ' ₤</div>' +
        '<button class="btn sm" style="margin-top:5px" data-action="upgrade" data-base="' + base.id + '" data-key="' + k + '"' +
          (okReq && afford && !slotsFull ? "" : " disabled") + '>Upgrade</button></div>' +
        '</div>';
    });
    sh += '</div>';
    var rp = '<div class="panel"><h3>Power &amp; Economy</h3>' +
      kv("Energy output", e.prod) +
      kvWarn("Energy used", e.cons, e.cons > e.prod) +
      kvWarn("Efficiency", Math.round(eff * 100) + "%", eff < 1) +
      kv("Credits", fmt(baseCreditsDisplay(base.struct, S.techs)) + " ₤/h") +
      kv("Research", fmt(baseResearchDisplay(base.struct, S.techs)) + " rp/h") +
      '</div>';
    rp += '<div class="panel"><h3>Build Queue <span class="tag">' + base.queue.length + '/' + S.queueMax + '</span></h3>' + queueHtml(base) + '</div>';
    h += sh + '<div>' + rp + '</div>';
    h += '</div>';
    return h;
  }

  function viewResearch() {
    var h = '<div class="view-title">Research Laboratory</div>';
    h += '<div class="grid cols-2"><div class="panel"><h3>Technologies</h3>';
    TECH_ORDER.forEach(function (k) {
      var d = TECH[k], lvl = (S.techs && S.techs[k]) || 0, okReq = reqMet(S.techs, d.req), cost = techCostDisplay(S.techs, k), afford = S.rp >= cost;
      var busy = !!S.research;
      h += '<div class="row' + (okReq ? "" : " locked") + '">' +
        '<div class="ic">' + d.icon + '</div>' +
        '<div class="nm"><div class="t">' + d.name + '</div><div class="d">' + d.desc +
          (okReq ? "" : ' <span class="tag2 lock">🔒 ' + reqText(d.req) + '</span>') + '</div></div>' +
        '<div class="lvl">L' + lvl + '</div>' +
        '<div style="text-align:right"><div class="cost"><span class="rp">' + fmt(cost) + ' rp</span></div>' +
        '<button class="btn sm" style="margin-top:5px" data-action="research" data-key="' + k + '"' +
          (okReq && afford && !busy ? "" : " disabled") + '>Research</button></div>' +
        '</div>';
    });
    h += '</div>';
    var rp = '<div class="panel"><h3>Active Research</h3>';
    if (S.research) {
      var k = S.research.key;
      rp += '<div class="qitem"><div class="ic">' + TECH[k].icon + '</div>' +
        '<div class="qt"><b>' + TECH[k].name + '</b> → L' + (((S.techs && S.techs[k]) || 0) + 1) + '</div>' +
        '<div class="qtimer" data-finish="' + S.research.finishAt + '"></div>' +
        '<button class="btn sm danger" data-action="cancelres">✗</button></div>' +
        '<div class="bar"><span data-bar="' + S.research.finishAt + '" data-dur="' + S.research.dur + '"></span></div>';
    } else rp += '<div class="empty">No active research. Pick a technology to advance.</div>';
    rp += '</div>';
    rp += '<div class="panel"><h3>Research Output</h3>' +
      kv("Stockpile", fmt(S.rp) + " rp") + kv("Income", fmt(empireResearch(S)) + " rp/h") + '</div>';
    h += '<div>' + rp + '</div></div>';
    return h;
  }

  function viewShipyard() {
    var bases = S.bases.filter(function (b) { return structLevel(b.struct, "shipyard") >= 1; });
    if (!bases.length) return '<div class="view-title">Shipyard</div><div class="panel"><div class="empty">No base has a Shipyard yet. Build one in the Bases tab.</div></div>';
    if (!UI.yard || !findBase(UI.yard) || structLevel(findBase(UI.yard).struct, "shipyard") < 1) UI.yard = bases[0].id;
    var base = findBase(UI.yard);
    var tabs = '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px">';
    bases.forEach(function (b) { tabs += '<button class="btn ' + (b.id === UI.yard ? "" : "ghost") + '" data-action="selyard" data-base="' + b.id + '">' + esc(b.name) + ' · SY' + structLevel(b.struct, "shipyard") + '</button>'; });
    tabs += '</div>';
    var h = '<div class="view-title">Shipyard · ' + esc(base.name) + '</div>' + tabs + '<div class="grid cols-2">';
    var sh = '<div class="panel"><h3>Construction</h3>';
    SHIP_ORDER.forEach(function (k) {
      var d = SHIP[k], okReq = reqMet(S.techs, d.req) && structLevel(base.struct, "shipyard") >= (d.req.shipyard || 1);
      var cost = d.cost, afford = S.credits >= cost;
      var es = effStatsDisplay(k, S.techs);
      sh += '<div class="row' + (okReq ? "" : " locked") + '">' +
        '<div class="ic">' + d.icon + '</div>' +
        '<div class="nm"><div class="t">' + d.name + (d.colony ? ' <span class="tag2 ok">colony</span>' : '') + '</div>' +
        '<div class="d">' + d.desc + '<br>⚔ ' + Math.round(es.atk) + ' · ❤ ' + Math.round(es.hp) + ' · 🚀 ' + d.speed +
          (okReq ? "" : ' <span class="tag2 lock">🔒 ' + reqText(d.req) + '</span>') + '</div></div>' +
        '<div style="text-align:right"><div class="cost">' + fmt(cost) + ' ₤</div>' +
        '<div style="display:flex;gap:5px;margin-top:5px;justify-content:flex-end">' +
          '<button class="btn sm" data-action="buildship" data-base="' + base.id + '" data-key="' + k + '" data-qty="1"' + (okReq && afford ? "" : " disabled") + '>+1</button>' +
          '<button class="btn sm" data-action="buildship" data-base="' + base.id + '" data-key="' + k + '" data-qty="5"' + (okReq && afford ? "" : " disabled") + '>+5</button>' +
        '</div></div></div>';
    });
    sh += '</div>';
    var rp = '<div class="panel"><h3>Build Queue <span class="tag">' + base.queue.length + '/' + S.queueMax + '</span></h3>' + queueHtml(base) + '</div>';
    rp += '<div class="panel"><h3>Garrison · ' + esc(base.name) + '</h3>' + fleetList(base.fleet) + '</div>';
    h += sh + '<div>' + rp + '</div></div>';
    return h;
  }

  function viewMap() {
    var h = '<div class="view-title">Local Map</div><div class="mapwrap">';
    var g = '<div><div class="galaxy" style="grid-template-columns:repeat(' + S.map.w + ',1fr)">';
    for (var y = 1; y <= S.map.h; y++) {
      for (var x = 1; x <= S.map.w; x++) {
        var sys = S.map.systems[x + ":" + y];
        var sel = UI.sys === (x + ":" + y);
        var youHere = sys.planets.some(function (p) { return p.owner === "you"; });
        var pirate = sys.planets.some(function (p) { return p.owner === "pirate"; });
        var coloniz = sys.known && sys.planets.some(function (p) { return p.owner === "empty" && PLANET_TYPES[p.type].hab; });
        var dots = "";
        if (sys.known) {
          if (youHere) dots += '<span class="dot you"></span>';
          if (pirate) dots += '<span class="dot pirate"></span>';
          if (coloniz) dots += '<span class="dot colonizable"></span>';
        }
        g += '<div class="sys' + (sel ? " sel" : "") + (sys.known ? "" : " unknown") + '" data-action="opensys" data-sys="' + x + ':' + y + '">' +
          '<span class="coord">' + x + ':' + y + '</span>' +
          '<span class="star">' + (sys.known ? sys.star : "·") + '</span>' +
          '<span class="dots">' + dots + '</span></div>';
      }
    }
    g += '</div><div class="legend">' +
      '<span><i style="background:var(--cyan)"></i>Your base</span>' +
      '<span><i style="background:var(--red)"></i>Pirate</span>' +
      '<span><i style="background:var(--green)"></i>Colonizable</span>' +
      '<span><i style="background:#33486b"></i>Unscouted/empty</span></div></div>';
    var d = '<div>';
    if (UI.sys) {
      var sys2 = S.map.systems[UI.sys];
      d += '<div class="panel"><h3>System ' + UI.sys + (sys2.known ? '' : ' <span class="tag" style="color:var(--red)">unscouted</span>') + '</h3>';
      if (!sys2.known) {
        d += '<div class="empty">Send a Scout (Probe) here to reveal its planets.</div>';
        d += plannerHtml({ x: sys2.x, y: sys2.y, slot: 1 });
      } else {
        sys2.planets.forEach(function (p) {
          var t = PLANET_TYPES[p.type];
          var badge = p.owner === "you" ? '<span class="tag2 ok">your base</span>' :
            p.owner === "pirate" ? '<span class="tag2 lock">pirate T' + (p.tier || 1) + '</span>' :
            (t.hab ? '<span class="tag2 ok">colonizable</span>' : '<span class="tag2">' + t.name + '</span>');
          d += '<div class="planet"><div class="pic">' + t.icon + '</div>' +
            '<div class="pn"><div class="t">' + t.name + ' <span class="coordtag">' + sys2.x + ':' + sys2.y + ':' + p.slot + '</span></div>' +
            '<div class="d">Size ' + p.size + ' · ' + badge +
              (p.owner === "pirate" ? ' · loot ~' + fmt(p.loot) + ' ₤' : '') + '</div></div>' +
            '<button class="btn sm ghost" data-action="target" data-x="' + sys2.x + '" data-y="' + sys2.y + '" data-slot="' + p.slot + '">Target</button>' +
            '</div>';
        });
        d += plannerHtml(UI.target || { x: sys2.x, y: sys2.y, slot: 1 });
      }
      d += '</div>';
    } else {
      d += '<div class="panel"><h3>System</h3><div class="empty">Select a system on the map.</div></div>';
    }
    d += '</div>';
    h += g + d + '</div>';
    return h;
  }

  function plannerHtml(target) {
    if (!S.bases.length) return '';
    if (!UI.origin || !findBase(UI.origin)) UI.origin = S.bases[0].id;
    var origin = findBase(UI.origin);
    var h = '<div class="planner" style="margin-top:12px;border-top:1px solid var(--line);padding-top:10px">';
    h += '<div style="font-size:12px;color:var(--dim);margin-bottom:6px">Mission planner';
    if (target) h += ' → <span class="coordtag">' + target.x + ':' + target.y + ':' + target.slot + '</span>';
    h += '</div>';
    if (S.bases.length > 1) {
      h += '<select class="btn ghost" data-action="origin" style="width:100%;margin-bottom:8px">';
      S.bases.forEach(function (b) { h += '<option value="' + b.id + '"' + (b.id === origin.id ? ' selected' : '') + '>From: ' + esc(b.name) + '</option>'; });
      h += '</select>';
    }
    h += '<div class="missionbtns">';
    [["attack", "⚔ Attack"], ["colonize", "🪐 Colonize"], ["probe", "🛰 Probe"]].forEach(function (m) {
      h += '<button class="btn sm ' + (UI.mission === m[0] ? '' : 'ghost') + '" data-action="mission" data-m="' + m[0] + '">' + m[1] + '</button>';
    });
    h += '</div>';
    var fleet = origin.fleet || {};
    var any = false;
    SHIP_ORDER.forEach(function (k) {
      var have = fleet[k] || 0; if (!have) return; any = true;
      var sel = UI.sel[k] || 0;
      h += '<div class="stepper"><div class="nm">' + SHIP[k].icon + ' ' + SHIP[k].name + ' <small>(' + have + ')</small></div>' +
        '<button class="sx" data-action="sel" data-key="' + k + '" data-d="-1">−</button>' +
        '<span class="qty">' + sel + '</span>' +
        '<button class="sx" data-action="sel" data-key="' + k + '" data-d="1">+</button>' +
        '<button class="sx" data-action="selmax" data-key="' + k + '" title="all">≡</button></div>';
    });
    if (!any) h += '<div class="empty">No ships at ' + esc(origin.name) + '. Build some in the Shipyard.</div>';
    var canSend = any && target && Object.keys(cleanShips(UI.sel)).length;
    h += '<button class="btn big" style="width:100%;margin-top:10px" data-action="send"' + (canSend ? '' : ' disabled') + '>🚀 Launch Fleet</button>';
    h += '</div>';
    return h;
  }

  function viewFleets() {
    var h = '<div class="view-title">Fleets in Transit</div><div class="grid cols-2"><div class="panel"><h3>Active Missions</h3>';
    if (!S.fleets.length) h += '<div class="empty">No fleets in transit. Launch one from the Galaxy Map.</div>';
    S.fleets.forEach(function (f) {
      var mi = f.mission === "attack" ? "⚔" : (f.mission === "colonize" || f.mission === "colonize-remote") ? "🪐" : f.mission === "probe" ? "🛰" : "↩";
      var label;
      if (f.phase === "back") label = "Returning to base";
      else if (f.mission === "colonize-remote") label = "Colonizing " + f.addr;
      else label = (f.mission.charAt(0).toUpperCase() + f.mission.slice(1)) + " " + f.tx + ":" + f.ty + ":" + f.slot;
      h += '<div class="qitem"><div class="ic">' + mi + '</div>' +
        '<div class="qt"><b>' + label + '</b><br><small style="color:var(--dim)">' + fleetSummary(f.ships) + ' · pwr ' + fmt(fleetPower(f.ships)) + '</small></div>' +
        '<div class="qtimer" data-finish="' + f.arriveAt + '"></div>' +
        (f.phase === "out" ? '<button class="btn sm ghost" data-action="recall" data-id="' + f.id + '">Recall</button>' : '') +
        '</div>';
    });
    h += '</div>';
    h += '<div class="panel"><h3>Garrisons</h3>';
    S.bases.forEach(function (b) {
      var coord = b.address || (b.x + ':' + b.y + ':' + b.slot);
      h += '<div style="margin-bottom:10px"><div style="font-size:12px;color:var(--cyan);margin-bottom:4px">' + esc(b.name) + ' <span class="coordtag">' + coord + '</span></div>' +
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
    var h = "";
    base.queue.forEach(function (q, i) {
      var nm = q.kind === "struct" ? STRUCT[q.key].name + " → L" + (structLevel(base.struct, q.key) + 1) : (q.qty + "×" + SHIP[q.key].name);
      var ic = q.kind === "struct" ? STRUCT[q.key].icon : SHIP[q.key].icon;
      h += '<div class="qitem"><div class="ic">' + ic + '</div>' +
        '<div class="qt"><b>' + nm + '</b></div>' +
        '<div class="qtimer" data-finish="' + q.finishAt + '"></div>' +
        '<button class="btn sm danger" data-action="cancel" data-base="' + base.id + '" data-idx="' + i + '">✗</button></div>';
      if (i === 0) h += '<div class="bar"><span data-bar="' + q.finishAt + '" data-dur="' + q.dur + '"></span></div>';
    });
    return h;
  }
  function fleetList(fleet) {
    fleet = fleet || {}; var items = SHIP_ORDER.filter(function (k) { return fleet[k] > 0; });
    if (!items.length) return '<div class="empty">No ships stationed here.</div>';
    var h = "";
    items.forEach(function (k) { h += '<div class="kv"><span class="k">' + SHIP[k].icon + ' ' + SHIP[k].name + '</span><span class="v">' + fleet[k] + '</span></div>'; });
    return h;
  }
  function fleetSummary(ships) {
    var parts = []; SHIP_ORDER.forEach(function (k) { if (ships[k]) parts.push(ships[k] + " " + SHIP[k].name); });
    return parts.join(", ") || "empty";
  }
  function logHtml() {
    if (!S.log.length) return '<div class="empty">No events yet.</div>';
    var h = '<div class="log">';
    S.log.slice(0, 22).forEach(function (e) { h += '<div class="e ' + e.c + '"><span class="ts">' + clock(e.t) + '</span>' + esc(e.m) + '</div>'; });
    return h + '</div>';
  }
  function clock(t) { var d = new Date(t); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }

  /* ---------------- dynamic refresh (timers only; no full re-render) ---------------- */
  function updateDynamic() {
    setTxt("st-credits", fmt(S.credits) + " ₤");
    setTxt("st-rp", fmt(S.rp) + " rp");
    setTxt("st-econ", fmt(empireEconomy(S)) + "<small> /h</small>");
    setTxt("st-res", fmt(empireResearch(S)) + "<small> /h</small>");
    setTxt("st-bases", S.bases.length + " / " + S.maxBases);
    setTxt("st-power", fmt(empireFleetPower(S)));
    var t = Date.now();
    var timers = document.querySelectorAll("[data-finish]");
    for (var i = 0; i < timers.length; i++) timers[i].textContent = fmtTime((parseFloat(timers[i].getAttribute("data-finish")) - t) / 1000);
    var bars = document.querySelectorAll("[data-bar]");
    for (var j = 0; j < bars.length; j++) {
      var fin = parseFloat(bars[j].getAttribute("data-bar")), dur = parseFloat(bars[j].getAttribute("data-dur")) * 1000;
      var pct = dur > 0 ? (1 - (fin - t) / dur) : 1;
      bars[j].style.width = Math.max(0, Math.min(100, pct * 100)) + "%";
    }
  }
  function setTxt(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }

  /* ---------------- actions: call the API, then refresh + re-render ---------------- */
  function after(promise) {
    return promise.then(function (r) {
      if (!r.ok) { toast(r.error || "Action failed", true); return r; }
      return refreshState().then(function () { renderNav(); renderMain(); return r; });
    });
  }

  /* ---------------- events ---------------- */
  function onClick(e) {
    var el = e.target.closest("[data-action]"); if (!el) return;
    var a = el.getAttribute("data-action");
    if (a === "view") { setView(el.getAttribute("data-view")); return; }
    if (a === "newgame") {
      if (confirm("Abandon this empire and start a new game?")) {
        after(api("POST", "/newgame", { name: S.name }));
      }
      return;
    }
    if (a === "gobase") { UI.baseSel = +el.getAttribute("data-base"); setView("bases"); return; }
    if (a === "seltab") { UI.baseSel = +el.getAttribute("data-base"); renderMain(); return; }
    if (a === "selyard") { UI.yard = +el.getAttribute("data-base"); renderMain(); return; }
    if (a === "upgrade") { after(api("POST", "/struct/upgrade", { baseId: +el.getAttribute("data-base"), key: el.getAttribute("data-key") })); return; }
    if (a === "buildship") { after(api("POST", "/ship/build", { baseId: +el.getAttribute("data-base"), key: el.getAttribute("data-key"), qty: +el.getAttribute("data-qty") })); return; }
    if (a === "cancel") { after(api("POST", "/queue/cancel", { baseId: +el.getAttribute("data-base"), idx: +el.getAttribute("data-idx") })); return; }
    if (a === "research") { after(api("POST", "/research/start", { key: el.getAttribute("data-key") })); return; }
    if (a === "cancelres") { after(api("POST", "/research/cancel", {})); return; }
    if (a === "opensys") { UI.sys = el.getAttribute("data-sys"); renderMain(); return; }
    if (a === "target") {
      UI.target = { x: +el.getAttribute("data-x"), y: +el.getAttribute("data-y"), slot: +el.getAttribute("data-slot") };
      var sys = S.map.systems[UI.target.x + ":" + UI.target.y]; var p = sys.planets[UI.target.slot - 1];
      if (p.owner === "pirate") UI.mission = "attack";
      else if (p.owner === "empty" && PLANET_TYPES[p.type].hab) UI.mission = "colonize";
      else UI.mission = "probe";
      renderMain(); return;
    }
    if (a === "mission") { UI.mission = el.getAttribute("data-m"); renderMain(); return; }
    if (a === "sel") {
      var k = el.getAttribute("data-key"), d = +el.getAttribute("data-d");
      var origin = findBase(UI.origin) || S.bases[0]; var have = (origin.fleet && origin.fleet[k]) || 0;
      UI.sel[k] = Math.max(0, Math.min(have, (UI.sel[k] || 0) + d));
      renderMain(); return;
    }
    if (a === "selmax") {
      var k2 = el.getAttribute("data-key"); var origin2 = findBase(UI.origin) || S.bases[0];
      UI.sel[k2] = (origin2.fleet && origin2.fleet[k2]) || 0; renderMain(); return;
    }
    if (a === "send") {
      var origin3 = findBase(UI.origin) || S.bases[0];
      after(api("POST", "/fleet/send", { originBaseId: origin3.id, target: UI.target, mission: UI.mission, ships: UI.sel })).then(function (r) {
        if (r.ok) UI.sel = {};
      });
      return;
    }
    if (a === "recall") { after(api("POST", "/fleet/recall", { fleetId: +el.getAttribute("data-id") })); return; }
  }
  function onChange(e) {
    var el = e.target.closest("[data-action]"); if (!el) return;
    if (el.getAttribute("data-action") === "origin") { UI.origin = +el.value; UI.sel = {}; renderMain(); }
  }

  /* ---------------- main loop: cheap local countdown + periodic server sync ---------------- */
  var fastRef = null, slowRef = null;
  function startLoop() {
    if (fastRef) clearInterval(fastRef);
    if (slowRef) clearInterval(slowRef);
    fastRef = setInterval(updateDynamic, 1000);
    slowRef = setInterval(function () { refreshState().then(function () { renderNav(); renderMain(); }); }, 4000);
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
