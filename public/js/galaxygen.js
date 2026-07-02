/* public/js/galaxygen.js — Astro Empire · Galaxy Generation
   --------------------------------------------------------------------------
   A deterministic, seeded galaxy generator and its setup page.

   Location scheme (AstroEmpires style):  B11:22:33:45
       B   server / galaxy prefix  (A-Alpha, B-Betta, C-Cappa, …)
       11  galaxy number           (01–99)
       22  region                  (the sector, numbered across the galaxy)
       33  system                  (the 1–100 slot inside the region's 10×10)
       4   orbital
       5   position of the astro within that orbital

   The galaxy map is drawn flat: an N×N galaxy becomes a (N·10)×(N·10) field of
   rectangles, visually grouped into N×N blocks of 10×10. A star is shown where
   a system exists; clicking it opens that system and lists every astro.

   Generation is lazy and reproducible: every level derives a child seed from
   its parents and its coordinates, so any system can be produced on demand
   from (masterSeed, location) without materialising the whole galaxy. The same
   inputs always yield the same entities. The simulation core is DOM-free;
   the page layer reuses the existing app shell, classes and event style.

   ---- Fix notes (this build) ----
   1. Generating a galaxy now grants the player 100,000,000 credits (see
      doGenerate()) so bases/ships/colonization are immediately affordable.
   2. Astro ownership is now driven by real game state (S.colonized, set by
      app.js when an Outpost Ship actually lands) rather than only the
      cosmetic per-astro "hasBase" flag used for flavor/NPC bases. An Outpost
      Ship en route is never shown as owning its destination.
   3. The astro detail card now offers "Send Outpost Ship" for any
      uncolonized, non-gas astro, which calls window.__ASTRO.sendColonize().
   ========================================================================== */
(function () {
  "use strict";

  /* ============================================================= NAMES */
  // A–Z galaxy prefixes. First three keep the spec's spellings.
  var PREFIX_NAMES = [
    "Alpha", "Betta", "Cappa", "Delta", "Epsilon", "Zeta", "Eta", "Theta",
    "Iota", "Kappa", "Lambda", "Mu", "Nu", "Xi", "Omicron", "Pi", "Rho",
    "Sigma", "Tau", "Upsilon", "Phi", "Chi", "Psi", "Omega", "Nova", "Zenith"
  ];
  function prefixLetter(i) { return String.fromCharCode(65 + i); }      // 0→A
  function prefixIndex(letter) { return letter.charCodeAt(0) - 65; }

  /* ============================================================= TUNING
     Every choice below is the *average*. Real entity sizes/counts are jittered
     by ±variate (default 10%) during generation. */

  // Average stars (systems) per sector — out of its 100 sub-squares.
  var STARS = { low: 6, mid: 15, high: 30 };

  // Body counts per star (min/max, inclusive) before jitter.
  var PLANETS   = { low: [1, 3], medium: [3, 5], high: [5, 8], veryhigh: [8, 12] };
  var MOONS     = { low: [0, 2], medium: [2, 5], high: [5, 9], veryhigh: [9, 14] };
  var ASTEROIDS = { low: [0, 3], medium: [3, 8], high: [8, 16] };
  var GAS       = { low: [0, 1], medium: [1, 3] };

  // Size presets → building "space" units (jittered ±variate).
  // Sun size is a visual/energy scale, not building space.
  var SUN_SIZE      = { huge: 120, big: 80, medium: 50, small: 28 };
  var PLANET_SIZE   = { big: 14, medium: 10, small: 7, tiny: 4 };
  var MOON_SIZE     = { big: 10, medium: 7, small: 5, tiny: 3 };   // a bit less than a planet
  var ASTEROID_SIZE = { medium: 5, small: 3, tiny: 2 };            // a bit less than a moon
  var GAS_SCALE     = { big: 20, huge: 30 };                       // visual only — gas has NO space

  // Star glyphs by sun-size bucket (purely cosmetic).
  var SUN_GLYPH = { huge: "🌟", big: "⭐", medium: "✨", small: "🔆" };

  var BODY = {
    planet:   { name: "Planet",     icon: "🪐", hab: true },
    moon:     { name: "Moon",       icon: "🌙", hab: false },
    asteroid: { name: "Asteroid",   icon: "🪨", hab: false },
    gas:      { name: "Gas Planet", icon: "🌫️", hab: false }
  };

  // Resource yields adjusted per built unit. Each rolls -1 / 0 / +1.
  var YIELD_KEYS = ["habitation", "gas", "minerals", "metal", "crystal"];
  var YIELD_META = {
    habitation: { icon: "👥", label: "Habitation", note: "people / habitation unit" },
    gas:        { icon: "🔥", label: "Gas",        note: "energy" },
    minerals:   { icon: "⛏️", label: "Minerals",   note: "building constructions" },
    metal:      { icon: "🔩", label: "Metal",      note: "construction units" },
    crystal:    { icon: "💎", label: "Crystal",    note: "trade" }
  };

  /* ============================================================= ASTROS
     Real colonisable astros, modelled on Astro Empire's astro types. Metal,
     Gas, Crystal and the planet/moon Area are canonical to each type. Fertility
     is not published as a per-type number, so the values below are derived from
     each type's written description (Gaia/Earthly very fertile, Crystalline /
     production types barren, etc.) on a 0–3 scale.

     Per-orbital rules applied on top of the base stats:
       Solar     = max(0, 5 − orbital)        (orbital 1→4, 2→3 … 5→0)
       Fertility += 1 on orbitals 2 and 3
       Gas       += 1 on orbitals 4 and 5
       Metal / Crystal — fixed by type, no orbital effect
     Asteroids have no Moon sub-type (Moon Area 0) and a single 65 area. */
  var ASTRO = {
    arid:        { name: "Arid",        glyph: "🟤", metal: 2, gas: 2, crystal: 0, fert: 2, pArea: 95, mArea: 83 },
    asteroid:    { name: "Asteroid",    glyph: "🪨", metal: 3, gas: 1, crystal: 2, fert: 0, pArea: 65, mArea: 0 },
    craters:     { name: "Craters",     glyph: "🌑", metal: 3, gas: 1, crystal: 1, fert: 0, pArea: 85, mArea: 75 },
    earthly:     { name: "Earthly",     glyph: "🌍", metal: 3, gas: 2, crystal: 0, fert: 3, pArea: 85, mArea: 75 },
    gaia:        { name: "Gaia",        glyph: "🌎", metal: 2, gas: 2, crystal: 0, fert: 3, pArea: 90, mArea: 79 },
    glacial:     { name: "Glacial",     glyph: "🧊", metal: 1, gas: 2, crystal: 0, fert: 2, pArea: 95, mArea: 83 },
    magma:       { name: "Magma",       glyph: "🌋", metal: 2, gas: 4, crystal: 1, fert: 1, pArea: 85, mArea: 75 },
    metallic:    { name: "Metallic",    glyph: "⚙️", metal: 3, gas: 2, crystal: 1, fert: 0, pArea: 85, mArea: 75 },
    oceanic:     { name: "Oceanic",     glyph: "🌊", metal: 1, gas: 2, crystal: 0, fert: 2, pArea: 80, mArea: 71 },
    radioactive: { name: "Radioactive", glyph: "☢️", metal: 2, gas: 3, crystal: 0, fert: 1, pArea: 90, mArea: 79 },
    rocky:       { name: "Rocky",       glyph: "⛰️", metal: 4, gas: 3, crystal: 0, fert: 2, pArea: 85, mArea: 75 },
    toxic:       { name: "Toxic",       glyph: "🧪", metal: 2, gas: 4, crystal: 0, fert: 1, pArea: 90, mArea: 79 },
    tundra:      { name: "Tundra",      glyph: "❄️", metal: 2, gas: 2, crystal: 0, fert: 2, pArea: 95, mArea: 83 },
    volcanic:    { name: "Volcanic",    glyph: "🔥", metal: 2, gas: 4, crystal: 0, fert: 1, pArea: 80, mArea: 71 },
    crystalline: { name: "Crystalline", glyph: "💠", metal: 2, gas: 1, crystal: 3, fert: 0, pArea: 80, mArea: 71 }
  };

  // Sphere colours for the system map (cosmetic; the wiki's astro art is
  // copyrighted, so astros are drawn as tinted CSS spheres instead).
  var ASTRO_COL = {
    arid: "#c79a5b", asteroid: "#8a8f99", craters: "#9aa0a6", earthly: "#5a9e6f",
    gaia: "#3fb87c", glacial: "#bfe0ef", magma: "#e2622f", metallic: "#9fb0c3",
    oceanic: "#3f7fd6", radioactive: "#b6d24a", rocky: "#b08d63", toxic: "#7fb53b",
    tundra: "#cfe3ec", volcanic: "#c2402f", crystalline: "#b07fe6"
  };

  // Astro artwork: original local SVGs, one per type, served from
  // /public/img/astros/<type>.svg. No external requests, no CDN fallback.
  var ASTRO_IMG_LOCAL = "/public/img/astros/";
  function astroImgLocal(type) { return ASTRO_IMG_LOCAL + type + ".svg"; }
  function astroImg(type, cls) {
    return '<img class="' + cls + '" loading="lazy" alt="' + type +
      '" src="' + astroImgLocal(type) + '">';
  }

  // Weighted pool of planet/moon types. Rocky and (especially) Crystalline are
  // deliberately rare, as in the source material.
  var ASTRO_POOL = (function () {
    var w = {
      arid: 8, tundra: 8, glacial: 7, oceanic: 7, craters: 8, metallic: 7,
      earthly: 6, gaia: 5, magma: 6, radioactive: 6, toxic: 6, volcanic: 6,
      rocky: 3, crystalline: 1
    };
    var pool = [];
    for (var k in w) for (var i = 0; i < w[k]; i++) pool.push(k);
    return pool;
  })();
  function pickAstroType(rng) { return ASTRO_POOL[(rng() * ASTRO_POOL.length) | 0]; }

  function solarByOrbital(o) { return Math.max(0, 5 - o); }

  // Resolve a type + sub-type + orbital into a concrete stat block.
  function astroStats(typeKey, subtype, orbital) {
    var t = ASTRO[typeKey];
    var area = (subtype === "moon" && t.mArea > 0) ? t.mArea : t.pArea;
    return {
      type: typeKey, typeName: t.name, glyph: t.glyph, subtype: subtype,
      area: area,
      solar: solarByOrbital(orbital),
      fertility: t.fert + ((orbital === 2 || orbital === 3) ? 1 : 0),
      metal: t.metal,
      gas: t.gas + ((orbital === 4 || orbital === 5) ? 1 : 0),
      crystal: t.crystal
    };
  }

  /* ============================================================= RNG / HASH */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Mix integers into a new 32-bit seed (order-sensitive).
  function mix() {
    var h = 0x811c9dc5 | 0;
    for (var i = 0; i < arguments.length; i++) {
      h = Math.imul(h ^ (arguments[i] | 0), 0x01000193) | 0;
      h ^= h >>> 13;
    }
    return h >>> 0;
  }
  function randInt(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }
  function pickYield(rng) { return [-1, 0, 1][(rng() * 3) | 0]; }
  function jitter(rng, base, variate) {
    var v = base * (1 + (rng() * 2 - 1) * variate);
    return Math.max(base > 0 ? 1 : 0, Math.round(v));
  }

  /* ============================================================= ADDRESS */
  function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }
  function address(prefix, number, sx, sy, subX, subY) {
    return prefix + ":" + pad(number, 2) + ":" + pad(sx, 2) + ":" + pad(sy, 2) +
      ":" + String(subX) + String(subY);
  }

  /* AstroEmpires-style location:  B11:22:33:45
       B   server / prefix
       11  galaxy number
       22  region   (= the sector, numbered across the galaxy)
       33  system   (= the sub-cell within the region, 1–100)
       4   orbital
       5   position of the astro within that orbital            */
  function regionNo(sx, sy, size) { return (sy - 1) * size + sx; }
  function systemNo(subX, subY) { return subY * 10 + subX + 1; }
  function systemAddress(prefix, number, sx, sy, subX, subY, size) {
    return prefix + pad(number, 2) + ":" + pad(regionNo(sx, sy, size), 2) +
      ":" + pad(systemNo(subX, subY), 2);
  }
  function astroAddress(prefix, number, sx, sy, subX, subY, size, orbital, position) {
    var tail = (orbital < 10 && position < 10)
      ? ("" + orbital + position) : (orbital + "-" + position);
    return systemAddress(prefix, number, sx, sy, subX, subY, size) + ":" + tail;
  }

  /* ============================================================= GEN CORE */

  function galaxySeed(master, prefix, number) {
    return mix(master, prefixIndex(prefix) + 1, number, 0x6A1);
  }

  // Which of a sector's 100 sub-squares hold a star, plus the star count.
  // Deterministic from the sector seed and the star-density setting.
  function sectorStars(gSeed, sx, sy, density, variate) {
    var rng = mulberry32(mix(gSeed, sx, sy, 0x57C));
    var avg = STARS[density] || STARS.mid;
    var count = jitter(rng, avg, variate);
    if (count > 100) count = 100;
    var taken = {}, cells = [];
    var guard = 0;
    while (cells.length < count && guard++ < 1000) {
      var subX = (rng() * 10) | 0, subY = (rng() * 10) | 0;
      var key = subX * 10 + subY;
      if (taken[key]) continue;
      taken[key] = true;
      cells.push({ subX: subX, subY: subY });
    }
    return cells;
  }

  // Build one full star system (the real entities) at a sub-square.
  function generateSystem(cfg, prefix, number, sx, sy, subX, subY) {
    var gSeed = galaxySeed(cfg.master, prefix, number);
    var seed = mix(gSeed, sx, sy, subX * 10 + subY, 0x9E3);
    var rng = mulberry32(seed);
    var V = cfg.variate;

    var sun = {
      glyph: SUN_GLYPH[cfg.sunSize] || "⭐",
      sizeName: cfg.sunSize,
      size: jitter(rng, SUN_SIZE[cfg.sunSize] || 50, V)
    };

    // How many of each body this star gets.
    var nPlanet = randInt(rng, PLANETS[cfg.planets][0], PLANETS[cfg.planets][1]);
    var nGas    = randInt(rng, GAS[cfg.gas][0], GAS[cfg.gas][1]);
    var nMoon   = randInt(rng, MOONS[cfg.moons][0], MOONS[cfg.moons][1]);
    var nAst    = randInt(rng, ASTEROIDS[cfg.asteroids][0], ASTEROIDS[cfg.asteroids][1]);

    var bodies = [];
    var orbit = 0;
    var MAX_ORBITS = 9, MAX_PER_ORBIT = 6, MAX_MOONS = MAX_PER_ORBIT - 1; // planet + 5 moons

    // Planets and gas planets share outward orbital slots (one per orbital).
    var majors = [];
    for (var p = 0; p < nPlanet; p++) majors.push("planet");
    for (var g = 0; g < nGas; g++) majors.push("gas");
    shuffle(majors, rng);
    if (majors.length > MAX_ORBITS) majors = majors.slice(0, MAX_ORBITS);

    majors.forEach(function (kind) {
      orbit++;
      if (kind === "planet") {
        bodies.push(makePlanet(rng, orbit, cfg, V));
      } else {
        bodies.push(makeGas(rng, orbit, cfg, V));
      }
    });

    // Distribute moons among existing planets (moons share the planet's orbital,
    // taking successive positions after the planet at position 1, max 6 per orbit).
    var planetBodies = bodies.filter(function (b) { return b.kind === "planet"; });
    for (var m = 0; m < nMoon; m++) {
      var avail = planetBodies.filter(function (b) { return b.moons.length < MAX_MOONS; });
      if (!avail.length) break;
      var host = avail[(rng() * avail.length) | 0];
      var mn = makeMoon(rng, host.orbit, cfg, V);
      mn.position = host.moons.length + 2;
      host.moons.push(mn);
    }

    // Asteroids ride their own outer orbits, filling whatever orbital slots
    // remain under the 9-orbital cap.
    var astRoom = Math.max(0, MAX_ORBITS - orbit);
    var nAstPlaced = Math.min(nAst, astRoom);
    for (var a = 0; a < nAstPlaced; a++) {
      orbit++;
      bodies.push(makeAsteroid(rng, orbit, cfg, V));
    }

    // Stamp every astro with its AstroEmpires-style location, and a
    // deterministic "is colonised" flag (other players'/NPC bases you'd see
    // when scouting a system). Gas giants are never colonisable.
    function stampBase(b) {
      if (b.kind === "gas") { b.hasBase = false; return; }
      b.hasBase = (mix(seed, 0xBA5E, b.orbit, b.position) % 100) < 13;
    }
    bodies.forEach(function (b) {
      b.address = astroAddress(prefix, number, sx, sy, subX, subY, cfg.size, b.orbit, b.position);
      stampBase(b);
      (b.moons || []).forEach(function (mn) {
        mn.address = astroAddress(prefix, number, sx, sy, subX, subY, cfg.size, mn.orbit, mn.position);
        stampBase(mn);
      });
    });

    return {
      address: systemAddress(prefix, number, sx, sy, subX, subY, cfg.size),
      sx: sx, sy: sy, subX: subX, subY: subY,
      sun: sun,
      bodies: bodies,
      totals: bodyTotals(bodies)
    };
  }

  function makeYields(rng) {
    var y = {};
    YIELD_KEYS.forEach(function (k) { y[k] = pickYield(rng); });
    return y;
  }

  // Habitation value from orbit: peaks in the mid (goldilocks) band, 1 close
  // … 8 far. Returns 0–100. Far / non-planet bodies trend toward 0.
  function habFromOrbit(orbit) {
    var d = orbit - 3.5;                       // sweet spot ≈ orbits 3–4
    var v = 100 * Math.exp(-(d * d) / 6.5);
    return Math.max(0, Math.round(v));
  }

  function makePlanet(rng, orbit, cfg, V) {
    var astro = astroStats(pickAstroType(rng), "planet", orbit);
    astro.area = jitter(rng, astro.area, V);            // variation slider still bites
    return {
      kind: "planet", orbit: orbit, position: 1, sizeName: cfg.planetSize,
      space: astro.area, size: jitter(rng, PLANET_SIZE[cfg.planetSize], V),
      habitability: habFromOrbit(orbit),
      astro: astro, yields: makeYields(rng), moons: []
    };
  }
  function makeGas(rng, orbit, cfg, V) {
    return {
      kind: "gas", orbit: orbit, position: 1, sizeName: cfg.gasSize,
      space: 0,                                 // gas giants: not colonisable
      size: jitter(rng, GAS_SCALE[cfg.gasSize], V),
      habitability: 0,
      yields: makeYields(rng), moons: []
    };
  }
  function makeMoon(rng, orbit, cfg, V) {
    var astro = astroStats(pickAstroType(rng), "moon", orbit);
    astro.area = jitter(rng, astro.area, V);
    return {
      kind: "moon", orbit: orbit, position: 2, sizeName: cfg.moonSize,
      space: astro.area, size: jitter(rng, MOON_SIZE[cfg.moonSize], V),
      habitability: Math.round(habFromOrbit(orbit) * 0.4),
      astro: astro, yields: makeYields(rng)
    };
  }
  function makeAsteroid(rng, orbit, cfg, V) {
    var astro = astroStats("asteroid", "asteroid", orbit);
    astro.area = jitter(rng, astro.area, V);
    return {
      kind: "asteroid", orbit: orbit, position: 1, sizeName: cfg.asteroidSize,
      space: astro.area, size: jitter(rng, ASTEROID_SIZE[cfg.asteroidSize], V),
      habitability: 0,
      astro: astro, yields: makeYields(rng)
    };
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = (rng() * (i + 1)) | 0; var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function bodyTotals(bodies) {
    var t = { planet: 0, gas: 0, asteroid: 0, moon: 0, space: 0 };
    bodies.forEach(function (b) {
      t[b.kind]++; t.space += b.space || 0;
      (b.moons || []).forEach(function (mn) { t.moon++; t.space += mn.space || 0; });
    });
    return t;
  }

  /* ============================================================= AGGREGATE
     Exact star count per galaxy (cheap: one int per sector). Body totals use
     expected values (mean count × stars) so even a full 16×16 high-density
     galaxy summarises instantly. */
  function meanOf(range) { return (range[0] + range[1]) / 2; }

  function galaxyStats(cfg, prefix, number) {
    var gSeed = galaxySeed(cfg.master, prefix, number);
    var stars = 0, sectors = cfg.size * cfg.size;
    for (var sx = 1; sx <= cfg.size; sx++) {
      for (var sy = 1; sy <= cfg.size; sy++) {
        stars += sectorStars(gSeed, sx, sy, cfg.stars, cfg.variate).length;
      }
    }
    var perStar = {
      planets: meanOf(PLANETS[cfg.planets]),
      gas: meanOf(GAS[cfg.gas]),
      moons: meanOf(MOONS[cfg.moons]),
      asteroids: meanOf(ASTEROIDS[cfg.asteroids])
    };
    return {
      sectors: sectors,
      stars: stars,
      planets: Math.round(stars * perStar.planets),
      gas: Math.round(stars * perStar.gas),
      moons: Math.round(stars * perStar.moons),
      asteroids: Math.round(stars * perStar.asteroids),
      perStar: perStar
    };
  }

  function selectedGalaxies(cfg) {
    var prefixes = cfg.prefix === "ALL"
      ? PREFIX_NAMES.map(function (_, i) { return prefixLetter(i); })
      : [cfg.prefix];
    var numbers = cfg.number === "ALL"
      ? Array.apply(null, { length: 99 }).map(function (_, i) { return i + 1; })
      : [cfg.number];
    return { prefixes: prefixes, numbers: numbers, count: prefixes.length * numbers.length };
  }

  // Full run summary. For "All" selections we report one representative galaxy
  // and scale totals by the galaxy count (every galaxy uses the same density).
  function runStats(cfg) {
    var sel = selectedGalaxies(cfg);
    var rep = galaxyStats(cfg, sel.prefixes[0], sel.numbers[0]);
    var scaled = {};
    ["sectors", "stars", "planets", "gas", "moons", "asteroids"].forEach(function (k) {
      scaled[k] = rep[k] * sel.count;
    });
    return {
      galaxies: sel.count,
      perGalaxy: rep,
      total: scaled,
      sel: sel
    };
  }

  /* ============================================================= STATE */
  function defaults(S) {
    var master = (S && S.seed) || ((Math.random() * 1e9) | 0);
    return {
      prefix: "B", number: 1, size: 8,
      stars: "mid",
      planets: "medium", moons: "medium", asteroids: "medium", gas: "low",
      sunSize: "medium", planetSize: "medium", moonSize: "small",
      asteroidSize: "small", gasSize: "big",
      variate: 0.10,
      master: master,
      // explorer / ui
      region: null, system: null, result: null,
      page: "galaxy",          // "galaxy" (NxN) | "region" (10x10) | "system"
      source: "local",         // "db" once Generate has populated the database
      map: null,               // occupied systems, grouped by region
      systemData: null,        // the currently opened system's astros
      astroSel: null,          // the astro whose detail is open
      baseOpen: false,         // base screen open over the planet detail
      baseTab: "overview", baseSub: null, baseSel: null,
      loading: false
    };
  }
  function ensure(S) {
    if (!S.gg) S.gg = defaults(S);
    // backfill any missing keys (forward-compat with old saves)
    var d = defaults(S);
    for (var k in d) if (!(k in S.gg)) S.gg[k] = d[k];
    return S.gg;
  }

  /* ============================================================= PAGE */
  var ctx = null, wired = false;

  function init(context) {
    ctx = context;
    if (wired) return;
    wired = true;
    document.addEventListener("click", onClick, false);
    document.addEventListener("change", onChange, false);
    document.addEventListener("input", onInput, false);
  }
  function S() { return ctx.getState(); }
  function rerender() { ctx.rerender(); }
  function persist() { ctx.save(); }
  function navTo(v) { if (ctx && typeof ctx.setView === "function") ctx.setView(v); else rerender(); }

  // Real ownership (this playthrough actually colonized this address), kept
  // distinct from the astro's cosmetic/NPC "hasBase" flavor flag.
  function isPlayerOwned(addr) {
    var st = S();
    return !!(st && st.colonized && st.colonized[addr]);
  }

  /* ---------------- controls ---------------- */
  var SEG = {
    stars: ["low", "mid", "high"],
    planets: ["low", "medium", "high", "veryhigh"],
    moons: ["low", "medium", "high", "veryhigh"],
    asteroids: ["low", "medium", "high"],
    gas: ["low", "medium"],
    sunSize: ["small", "medium", "big", "huge"],
    planetSize: ["tiny", "small", "medium", "big"],
    moonSize: ["tiny", "small", "medium", "big"],
    asteroidSize: ["tiny", "small", "medium"],
    gasSize: ["big", "huge"]
  };
  var SEG_LABEL = { veryhigh: "very high", mid: "middle" };
  function segLabel(v) { return SEG_LABEL[v] || v; }

  function seg(field, gg) {
    var opts = SEG[field], cur = gg[field];
    var h = '<div class="seg" role="group">';
    opts.forEach(function (o) {
      h += '<button class="segbtn' + (o === cur ? " on" : "") + '" data-gg="seg" ' +
        'data-field="' + field + '" data-val="' + o + '">' + segLabel(o) + '</button>';
    });
    return h + "</div>";
  }
  function row(label, hint, control) {
    return '<div class="ggrow"><div class="gglabel">' + label +
      (hint ? '<span class="gghint">' + hint + "</span>" : "") +
      "</div>" + control + "</div>";
  }

  function viewHtml(state) {
    var gg = ensure(state);

    var h = '<div class="view-title">Galaxy Generation ' +
      '<span class="coordtag">' + sampleAddress(gg) + "</span></div>";
    h += '<div class="grid cols-2">';

    /* ----- left: setup ----- */
    var L = '<div class="panel"><h3>Galaxy</h3>';
    L += row("Prefix", "letter", prefixSelect(gg));
    L += row("Number", "01–99", numberSelect(gg));
    L += row("Size", gg.size + "×" + gg.size + " sectors",
      '<input class="ggrange" type="range" min="1" max="16" value="' + gg.size +
      '" data-gg="size"><span class="ggval" id="gg-size">' + gg.size + "×" + gg.size + "</span>");
    L += '<div class="ggnote">Each region holds a 10×10 grid of system slots ' +
      "(100 possible stars). The galaxy map draws every slot as a rectangle, " +
      "grouped into 10×10 blocks. Locations read " +
      "<b>server+galaxy : region : system : orbital+position</b> " +
      "(e.g. <b>B11:22:33:45</b>).</div>";

    L += '<h3 style="margin-top:16px">Density</h3>';
    L += row("Average stars", "per sector", seg("stars", gg));
    L += row("Planets / star", "", seg("planets", gg));
    L += row("Moons / star", "", seg("moons", gg));
    L += row("Asteroids / star", "", seg("asteroids", gg));
    L += row("Gas planets / star", "", seg("gas", gg));
    L += "</div>";

    /* ----- right: sizes + seed + action ----- */
    var R = '<div class="panel"><h3>Sizes</h3>';
    R += row("Sun", "", seg("sunSize", gg));
    R += row("Planets", "", seg("planetSize", gg));
    R += row("Moons", "less than a planet", seg("moonSize", gg));
    R += row("Asteroids", "less than a moon", seg("asteroidSize", gg));
    R += row("Gas planets", "no building space", seg("gasSize", gg));
    R += row("Size variation", "±" + Math.round(gg.variate * 100) + "%",
      '<input class="ggrange" type="range" min="0" max="40" value="' +
      Math.round(gg.variate * 100) + '" data-gg="variate">' +
      '<span class="ggval" id="gg-variate">±' + Math.round(gg.variate * 100) + "%</span>");

    R += '<h3 style="margin-top:16px">Generation</h3>';
    R += row("Master seed", "deterministic",
      '<input class="gginput" type="number" value="' + gg.master + '" data-gg="master">');
    R += '<div class="ggnote">Every planet, moon and asteroid is a real astro ' +
      "with a type (Rocky, Gaia, Crystalline …). Metal, Gas, Crystal and Area come " +
      "from the type; Solar, Fertility and the Gas bonus come from the orbital " +
      "(Solar = 5 − orbital; +1 Fertility on orbitals 2–3; +1 Gas on orbitals 4–5). " +
      "Click a star on the map to inspect its astros. Generating grants " +
      "<b>100,000,000</b> credits to build with.</div>";
    R += '<div class="ggactions">' +
      '<button class="btn big" data-gg="generate">✨ Generate Galaxy</button>' +
      '<button class="btn ghost" data-gg="reseed">🎲 Reseed</button></div>';
    R += "</div>";

    h += L + R + "</div>";

    /* ----- summary only; the generated map lives on the Galaxy map tab ----- */
    if (gg.result) {
      h += summaryHtml(gg);
      h += '<div class="panel gomap"><div class="ggnote" style="margin:0">' +
        (gg.loading ? "Building the galaxy…"
          : "Galaxy ready — open the <b>Galaxy map</b> tab to explore it.") + "</div>" +
        (gg.loading ? "" :
          '<button class="btn primary" data-gg="gomap">Open Galaxy map ▸</button>') +
        "</div>";
    }
    return h;
  }

  // Galaxy map tab: the generated, explorable map (and the system / base views).
  function mapHtml(state) {
    var gg = ensure(state);
    if (gg.result && gg.page === "system" && gg.system) return systemPage(gg);

    var h = '<div class="view-title">Galaxy Map' +
      (gg.result ? ' <span class="srcbadge ' + gg.source + '">' +
        (gg.source === "db" ? "from database" : "local preview") + "</span>" : "") +
      "</div>";

    if (!gg.result) {
      return h + '<div class="panel"><div class="ggempty">No galaxy yet. ' +
        'Open the <b>Galaxy Gen</b> tab, set it up and press <b>Generate</b> — ' +
        "the map appears here.</div></div>";
    }
    return h + mapPanelHtml(gg);
  }

  function prefixSelect(gg) {
    var h = '<select class="ggselect" data-gg="prefix">';
    h += '<option value="ALL"' + (gg.prefix === "ALL" ? " selected" : "") +
      ">All prefixes</option>";
    PREFIX_NAMES.forEach(function (nm, i) {
      var L = prefixLetter(i);
      h += '<option value="' + L + '"' + (gg.prefix === L ? " selected" : "") +
        ">" + L + " — " + nm + "</option>";
    });
    return h + "</select>";
  }
  function numberSelect(gg) {
    var h = '<select class="ggselect" data-gg="number">';
    h += '<option value="ALL"' + (gg.number === "ALL" ? " selected" : "") +
      ">All numbers</option>";
    for (var n = 1; n <= 99; n++) {
      h += '<option value="' + n + '"' + (gg.number === n ? " selected" : "") +
        ">" + pad(n, 2) + "</option>";
    }
    return h + "</select>";
  }
  function sampleAddress(gg) {
    var p = gg.prefix === "ALL" ? "A" : gg.prefix;
    var n = gg.number === "ALL" ? 1 : gg.number;
    var sx = Math.min(2, gg.size), sy = Math.min(3, gg.size);
    return systemAddress(p, n, sx, sy, 2, 3, gg.size);
  }

  /* ---------------- results + explorer ---------------- */
  function summaryHtml(gg) {
    var r = gg.result;
    var h = '<div class="panel"><h3>Run Summary</h3><div class="kvwrap">';
    if (r.galaxies > 1) {
      h += kv("Galaxies", fmt(r.galaxies));
      h += kv("Total sectors", fmt(r.total.sectors));
      h += kv("Total stars", fmt(r.total.stars));
      h += kv("Total planets", "≈ " + fmt(r.total.planets));
      h += kv("Total moons", "≈ " + fmt(r.total.moons));
      h += kv("Total asteroids", "≈ " + fmt(r.total.asteroids));
      h += kv("Total gas giants", "≈ " + fmt(r.total.gas));
    } else {
      h += kv("Regions", fmt(r.perGalaxy.sectors));
      h += kv("Stars", fmt(mapStarCount(gg)));
      h += kv("Planets", "≈ " + fmt(r.perGalaxy.planets));
      h += kv("Moons", "≈ " + fmt(r.perGalaxy.moons));
      h += kv("Asteroids", "≈ " + fmt(r.perGalaxy.asteroids));
      h += kv("Gas giants", "≈ " + fmt(r.perGalaxy.gas));
    }
    h += "</div>";
    if (r.galaxies > 1)
      h += '<div class="ggnote">Map shows one representative galaxy; every ' +
        "selected galaxy uses the same density.</div>";
    return h + "</div>";
  }

  function mapPanelHtml(gg) {
    // stage 1: galaxy regions, or stage 2: one region's systems
    if (gg.loading || !gg.map) {
      return '<div class="panel"><h3>Galaxy Map</h3>' +
        '<div class="ggloading">Generating &amp; loading…</div></div>';
    }
    if (gg.page === "region" && gg.region) {
      return '<div class="panel"><h3>Region <span class="tag">' +
        pad(regionNo(gg.region.sx, gg.region.sy, gg.size), 2) + "</span></h3>" +
        '<button class="btn ghost" data-gg="nav" data-to="galaxy">← Galaxy</button>' +
        regionGrid(gg) +
        '<div class="ggnote">10×10 systems in this region. ✨ marks a star — ' +
        "click one to open its system.</div></div>";
    }
    return '<div class="panel galaxypanel"><h3>Galaxy <span class="tag">' + gg.size + "×" +
      gg.size + " regions · " + mapStarCount(gg) + " stars</span></h3>" + galaxyTiles(gg) + "</div>";
  }

  function repGalaxy(gg) {
    return {
      prefix: gg.prefix === "ALL" ? "A" : gg.prefix,
      number: gg.number === "ALL" ? 1 : gg.number
    };
  }

  /* ----------------------------------------------------------- DATA LAYER
     The display reads from gg.map. After Generate, gg.map is loaded from the
     database (source "db"); if the API is unreachable (e.g. the static demo
     with no server/DB), it is built locally with the same deterministic engine
     so the feature still works. Both produce the identical shape:
       { size, regions: { "sx,sy": [ { subX, subY }, … ] } }                */

  function regionKey(sx, sy) { return sx + "," + sy; }

  function buildLocalMap(gg) {
    var rep = repGalaxy(gg);
    var gSeed = galaxySeed(gg.master, rep.prefix, rep.number);
    var regions = {};
    for (var sy = 1; sy <= gg.size; sy++) {
      for (var sx = 1; sx <= gg.size; sx++) {
        var cells = sectorStars(gSeed, sx, sy, gg.stars, gg.variate);
        if (cells.length) regions[regionKey(sx, sy)] =
          cells.map(function (c) { return { subX: c.subX, subY: c.subY }; });
      }
    }
    return { size: gg.size, regions: regions };
  }

  function mapRowsToMap(gg, rows) {
    var regions = {};
    rows.forEach(function (r) {
      var k = regionKey(r.sx, r.sy);
      (regions[k] = regions[k] || []).push({ subX: r.subx, subY: r.suby });
    });
    return { size: gg.size, regions: regions };
  }

  function mapStarCount(gg) {
    if (!gg.map) return 0;
    var n = 0, R = gg.map.regions;
    for (var k in R) n += R[k].length;
    return n;
  }

  // --- API (used when a server + DB are present) ---
  function api(path, opts) {
    if (typeof fetch === "undefined")
      return Promise.reject(new Error("no fetch"));
    return Promise.resolve()
      .then(function () { return fetch(path, opts); })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      }).then(function (j) {
        if (j && j.ok === false) throw new Error(j.error || "api error");
        return j;
      });
  }
  function genPayload(gg) {
    return {
      master: gg.master, size: gg.size,
      prefix: gg.prefix === "ALL" ? "A" : gg.prefix,
      number: gg.number === "ALL" ? 1 : gg.number,
      stars: gg.stars, planets: gg.planets, moons: gg.moons,
      asteroids: gg.asteroids, gas: gg.gas, sunSize: gg.sunSize,
      planetSize: gg.planetSize, moonSize: gg.moonSize,
      asteroidSize: gg.asteroidSize, gasSize: gg.gasSize, variate: gg.variate
    };
  }
  function apiGenerate(gg) {
    var headers = { "Content-Type": "application/json" };
    if (window.__CSRF__) headers["x-csrf-token"] = window.__CSRF__;
    return api("/api/galaxy/generate", {
      method: "POST", headers: headers,
      body: JSON.stringify(genPayload(gg))
    });
  }
  function apiMap(gg) {
    var rep = repGalaxy(gg);
    return api("/api/galaxy/map?server=" + rep.prefix + "&galaxy=" + rep.number)
      .then(function (j) { return mapRowsToMap(gg, j.systems || []); });
  }
  function apiSystem(gg, sx, sy, subX, subY) {
    var rep = repGalaxy(gg);
    var region = regionNo(sx, sy, gg.size), system = systemNo(subX, subY);
    return api("/api/galaxy/system/" + rep.prefix + "/" + rep.number +
      "/" + region + "/" + system).then(function (j) { return j.system; });
  }
  function localSystem(gg, sx, sy, subX, subY) {
    var rep = repGalaxy(gg);
    return generateSystem(gg, rep.prefix, rep.number, sx, sy, subX, subY);
  }

  // --- renderers ---

  // Stage 1: the whole galaxy as one continuous starfield over a faint region
  // grid. Every star sits in its true region sub-slot; hovering a grid cell
  // shows the region code, clicking it opens that region's 10×10 systems.
  function galaxyTiles(gg) {
    var rep = repGalaxy(gg), size = gg.size, V = 1000, R = gg.map.regions;
    var code = rep.prefix + pad(rep.number, 2);

    // stars + densest region (used as the "current location" marker)
    var stars = "", maxN = -1, cur = null;
    for (var sy = 1; sy <= size; sy++) {
      for (var sx = 1; sx <= size; sx++) {
        var list = R[regionKey(sx, sy)] || [];
        if (list.length > maxN) { maxN = list.length; cur = { sx: sx, sy: sy }; }
        for (var i = 0; i < list.length; i++) {
          var c = list[i];
          var x = ((sx - 1) + (c.subX + 0.5) / 10) / size * V;
          var y = ((sy - 1) + (c.subY + 0.5) / 10) / size * V;
          var hsh = mix(0x57A8, sx, sy, c.subX * 10 + c.subY);
          var r = (0.7 + (hsh % 10) / 10 * 1.7).toFixed(2);
          var op = (0.4 + ((hsh >> 4) % 10) / 10 * 0.6).toFixed(2);
          stars += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) +
            '" r="' + r + '" opacity="' + op + '"/>';
        }
      }
    }
    // grid lines
    var grid = "";
    for (var k = 0; k <= size; k++) {
      var p = (k / size * V).toFixed(1);
      grid += '<line x1="' + p + '" y1="0" x2="' + p + '" y2="' + V + '"/>' +
        '<line x1="0" y1="' + p + '" x2="' + V + '" y2="' + p + '"/>';
    }
    var svg = '<svg class="ggstars" viewBox="0 0 ' + V + " " + V +
      '" preserveAspectRatio="xMidYMid meet"><defs>' +
      '<radialGradient id="ggvig" cx="50%" cy="50%" r="62%">' +
      '<stop offset="52%" stop-color="#060c16" stop-opacity="0"/>' +
      '<stop offset="100%" stop-color="#04070e"/></radialGradient></defs>' +
      '<g class="ggrid">' + grid + "</g>" +
      '<g class="ggstar">' + stars + "</g>" +
      '<rect width="' + V + '" height="' + V + '" fill="url(#ggvig)"/></svg>';

    // interactive region cells (hover tooltip + click to drill in)
    var hit = '<div class="gghit" style="grid-template-columns:repeat(' + size +
      ',1fr);grid-template-rows:repeat(' + size + ',1fr)">';
    for (var sy2 = 1; sy2 <= size; sy2++) {
      for (var sx2 = 1; sx2 <= size; sx2++) {
        var rc = code + ":" + pad(regionNo(sx2, sy2, size), 2);
        var n = (R[regionKey(sx2, sy2)] || []).length;
        var isCur = cur && cur.sx === sx2 && cur.sy === sy2;
        hit += '<i class="ggcell' + (isCur ? " cur" : "") +
          '" data-gg="region" data-sx="' + sx2 + '" data-sy="' + sy2 +
          '" title="Region: ' + rc + " · " + n + ' stars">' +
          '<span class="rtip">Region: <b>' + rc + "</b></span>" +
          (isCur ? '<span class="curtag">' + n + '</span><span class="curbox"></span>' : "") +
          "</i>";
      }
    }
    hit += "</div>";

    var curRc = cur ? code + ":" + pad(regionNo(cur.sx, cur.sy, size), 2) : "—";
    return '<div class="ggalaxy">' + galaxySide(code, curRc) +
      '<div class="ggfield">' + svg + hit + "</div></div>";
  }

  function galaxySide(code, curRc) {
    return '<div class="ggside"><div class="ggside-h">Current Location</div>' +
      '<div class="ggtoggle"><span class="on">Galaxy ' + code + "</span>" +
      '<span class="dim">Region</span></div>' +
      '<div class="ggsearch"><input value="' + code + '" readonly>' +
      '<button title="go" disabled>⏎</button></div>' +
      '<div class="ggfilt on"><span>Bases</span><i class="cb on"></i></div>' +
      '<div class="ggfilt"><span>Top Portals</span><i class="cb"></i></div>' +
      '<div class="ggfilt"><span>Guilds</span><i class="cb"></i></div>' +
      '<div class="ggside-f">Hover a cell for its region · click to open it.' +
      (curRc !== "—" ? "<br>Densest region: <b>" + curRc + "</b>" : "") + "</div></div>";
  }

  // Stage 2: one region's 10×10 systems with clickable, frameless stars.
  function regionGrid(gg) {
    var rep = repGalaxy(gg), sx = gg.region.sx, sy = gg.region.sy;
    var list = gg.map.regions[regionKey(sx, sy)] || [];
    var occ = {};
    list.forEach(function (c) { occ[c.subX * 10 + c.subY] = true; });
    var h = '<div class="regiongrid">';
    for (var y = 0; y < 10; y++) {
      for (var x = 0; x < 10; x++) {
        if (occ[x * 10 + y]) {
          h += '<i class="gcell star" data-gg="system" data-sx="' + sx +
            '" data-sy="' + sy + '" data-subx="' + x + '" data-suby="' + y +
            '" title="' + systemAddress(rep.prefix, rep.number, sx, sy, x, y, gg.size) +
            '">✨</i>';
        } else {
          h += '<i class="gcell"></i>';
        }
      }
    }
    return h + "</div>";
  }

  // Standalone system page: sun at the left, orbitals laid out rightward, the
  // astros of each orbital stacked by position — mirroring the in-game view.
  function systemPage(gg) {
    var rep = repGalaxy(gg);
    var sys = gg.systemData ||
      generateSystem(gg, rep.prefix, rep.number,
        gg.system.sx, gg.system.sy, gg.system.subX, gg.system.subY);
    var server = rep.prefix, gx = pad(rep.number, 2);
    var region = pad(regionNo(gg.system.sx, gg.system.sy, gg.size), 2);
    var system = pad(systemNo(gg.system.subX, gg.system.subY), 2);
    var code = server + gx + ":" + region + ":" + system;
    var t = sys.totals;

    var h = '<div class="sysbar">' +
      '<button class="btn ghost" data-gg="nav" data-to="region">← Region</button>' +
      '<span class="bc"><span class="bcg" data-gg="nav" data-to="galaxy">Galaxy ' +
      server + gx + '</span> › <span class="bcg" data-gg="nav" data-to="region">Region ' +
      region + '</span> › <span class="bcw">System ' + system + '</span> ' +
      '<span class="bccode">(' + code + ')</span></span></div>';

    if (gg.loading) return h + '<div class="ggloading">Loading system…</div>';

    // Group every astro by orbital.
    var orbits = {};
    function add(o, a) { (orbits[o] = orbits[o] || []).push(a); }
    sys.bodies.forEach(function (b) {
      add(b.orbit, b);
      (b.moons || []).forEach(function (mn) { add(mn.orbit, mn); });
    });
    var nums = Object.keys(orbits).map(Number).sort(function (a, b) { return a - b; });

    h += '<div class="sysmap"><div class="sun-limb" title="' + segLabel(gg.sunSize) +
      ' sun"></div><div class="orbits">';
    nums.forEach(function (o) {
      var list = orbits[o].slice().sort(function (a, b) { return a.position - b.position; });
      h += '<div class="orbit">';
      list.forEach(function (a) { h += astroMark(a); });
      h += "</div>";
    });
    h += "</div></div>";
    h += '<div class="sysmeta" style="margin-top:10px">' +
      (t.planet + t.moon + t.asteroid) + " colonisable astros · " + t.planet +
      " planets · " + t.moon + " moons · " + t.asteroid + " asteroids" +
      (t.gas ? " · " + t.gas + " gas giants" : "") + "</div>";

    // open astro detail (planet/moon/asteroid/gas image, with base if colonised)
    if (gg.astroSel) {
      var body = findBody(sys, gg.astroSel.orbit, gg.astroSel.pos);
      if (body) h += astroDetail(gg, body);
    }
    return h;
  }

  function astroTitle(a) {
    var owned = a.hasBase || isPlayerOwned(a.address);
    if (a.kind === "gas") return "Gas Giant · " + a.address + " · uncolonisable";
    var s = a.astro;
    return s.typeName + " " + (a.kind === "asteroid" ? "Asteroid"
      : (a.kind === "moon" ? "Moon" : "Planet")) + " · " + a.address +
      " · Area " + s.area + " Solar " + s.solar + " Fert " + s.fertility +
      " Metal " + s.metal + " Gas " + s.gas + " Crystal " + s.crystal +
      (owned ? " · BASE" : "");
  }
  function tail(addr) { var p = addr.split(":"); return p[p.length - 1]; }

  function astroMark(a) {
    var owned = a.hasBase || isPlayerOwned(a.address);
    var ttl = astroTitle(a), code = tail(a.address);
    var data = ' data-gg="astro" data-orbit="' + a.orbit + '" data-pos="' + a.position + '"';
    var badge = owned ? '<span class="basebadge" title="Colonised — base present">⌂</span>' : "";

    if (a.kind === "gas") {
      return '<div class="amark"' + data + ' title="' + ttl + '"><div class="disc gas">' +
        '<span class="ring"></span>' + badge + '</div><div class="alabel">Gas Giant' +
        '<span class="acode">' + code + "</span></div></div>";
    }
    var s = a.astro;
    var cls = a.kind === "moon" ? "disc moon" : a.kind === "asteroid" ? "disc asteroid" : "disc planet";
    var name = a.kind === "asteroid" ? "Asteroid" : s.typeName;
    return '<div class="amark' + (owned ? " owned" : "") + '"' + data + ' title="' + ttl +
      '">' + astroImg(s.type, cls) + badge + '<div class="alabel">' + name +
      '<span class="acode">' + code + "</span></div></div>";
  }

  // Detail when an astro is clicked: a planet card with stats. If the astro is
  // colonised (by the player OR by cosmetic NPC flavor) it carries a base
  // marker and a "View base" link into the full base screen. Otherwise, for
  // real colonisable astros, a "Send Outpost Ship" action is offered.
  function astroDetail(gg, a) {
    var isGas = a.kind === "gas";
    var owned = a.hasBase || isPlayerOwned(a.address);
    if (owned && !isGas && gg.baseOpen) return baseView(gg, a);

    var name = isGas ? "Gas Giant" : (a.kind === "asteroid" ? a.astro.typeName + " Asteroid"
      : a.astro.typeName + (a.kind === "moon" ? " Moon" : " Planet"));
    var img = isGas
      ? '<div class="disc gas big"><span class="ring"></span></div>'
      : astroImg(a.astro.type, "astro-photo");

    var h = '<div class="astro-modal" data-gg="astro-close">' +
      '<div class="astro-card" data-gg="stop"><button class="amclose" data-gg="astro-close">✗</button>' +
      '<div class="astro-figure">' + img +
      (owned ? '<span class="base-flag" title="Colonised">⌂</span>' : "") + "</div>";
    h += '<div class="astro-info"><div class="astro-name">' + name +
      '<span class="astro-addr">' + a.address + "</span></div>";
    h += '<div class="astro-sub">' + (isGas ? "Uncolonisable gas giant"
      : "Orbital " + a.orbit + " · position " + a.position +
        (owned ? ' · <span class="base-tag">⌂ base present</span>'
          : ' · <span class="free-tag">uncolonised</span>')) + "</div>";
    if (!isGas) {
      var s = a.astro;
      h += '<div class="statgrid">' +
        statCell("Area", s.area) + statCell("Solar", s.solar) +
        statCell("Fertility", s.fertility) + statCell("Metal", s.metal) +
        statCell("Gas", s.gas) + statCell("Crystal", s.crystal) + "</div>";
      if (owned) {
        h += '<button class="btn primary bv-open" data-gg="open-base">View base ▸</button>';
      } else {
        h += '<button class="btn primary bv-open" data-gg="colonize" data-addr="' + a.address +
          '" data-size="' + a.astro.area + '">🚀 Send Outpost Ship</button>';
      }
    } else {
      h += '<div class="base-note">Gas giants have no surface to build on.</div>';
    }
    return h + "</div></div></div>";
  }

  /* ============================================= BASE SCREEN (colonised) */
  var OWNERS = ["Cruzaderx2", "Nyx Dominus", "Ironhawk", "Vega Prime", "Korr Veld",
    "Aurelia", "Dust Reaper", "Helios IX", "Mara Sol", "Tycho Rell", "Zedran",
    "Orinthal", "Saber Wing", "Lumen", "Caldris", "Vance Oreku"];
  function baseOwner(addr) { return OWNERS[hashStr(addr) % OWNERS.length]; }
  function hashStr(s) { var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // Catalogs (original descriptions; structure/ship/tech names are functional).
  var CATA = {
    facilities: [
      { id: "lab", name: "Research Labs", eff: [["Research", "+8"]], desc: "Raises this base's research output each level and unlocks new technologies." },
      { id: "metal", name: "Metal Refineries", eff: [["Metal", "+3"], ["Construct", "+1"]], desc: "Adds metal production and a little construction speed each level." },
      { id: "robotic", name: "Robotic Factories", eff: [["Construct", "+2"], ["Produce", "+1"]], desc: "Speeds up structure construction at this base each level." },
      { id: "shipyard", name: "Shipyards", eff: [["Build", "+2"], ["Produce", "+1"]], desc: "Speeds ship production and unlocks larger hull classes." },
      { id: "spaceport", name: "Spaceports", eff: [["Docking", "+2"]], desc: "Expands docking capacity for stationed fleets each level." },
      { id: "urban", name: "Urban Structures", eff: [["Pop", "+fert"]], desc: "Raises population capacity by the astro's fertility each level." },
      { id: "crystal", name: "Crystal Mines", eff: [["Economy", "+cry"]], desc: "Turns the astro's crystals into extra economy each level." }
    ],
    support: [
      { id: "command", name: "Command Center", eff: [["Core", "—"]], desc: "The colony's core structure; required before most others." },
      { id: "solar", name: "Solar Plants", eff: [["Power", "+solar"]], desc: "Converts the astro's solar rating into power each level." },
      { id: "gas", name: "Gas Plants", eff: [["Power", "+gas"]], desc: "Converts core gas into usable power each level." },
      { id: "fusion", name: "Fusion Plants", eff: [["Power", "+12"]], desc: "High-output power that doesn't depend on solar or gas." },
      { id: "metro", name: "Metropolis", eff: [["Pop", "+5"]], desc: "Adds population capacity beyond urban structures." },
      { id: "terraform", name: "Terraform", eff: [["Area", "+5"]], desc: "Reclaims additional building area on the surface." },
      { id: "mlp", name: "Multi-level Platforms", eff: [["Area", "+5"]], desc: "Stacks platforms to add area where land is scarce." },
      { id: "jump", name: "Jump Gate", eff: [["Travel", "instant"]], desc: "Opens a jump link for instant fleet travel between gates." }
    ],
    defenses: [
      { id: "barracks", name: "Barracks", eff: [["Troops", "+10"]], desc: "Trains the troops needed to hold or capture ground." },
      { id: "laser", name: "Laser Turrets", eff: [["Defense", "+2"]], desc: "Ground battery that fires on hostile fleets in orbit." },
      { id: "plasma", name: "Plasma Turrets", eff: [["Defense", "+4"]], desc: "Heavier battery, effective against shielded hulls." },
      { id: "ion", name: "Ion Turrets", eff: [["Defense", "+6"]], desc: "Long-range battery that punches through armour." },
      { id: "photon", name: "Photon Turrets", eff: [["Defense", "+9"]], desc: "Top-tier battery with the highest single-shot damage." },
      { id: "ring", name: "Planetary Ring", eff: [["Defense", "+15%"]], desc: "Orbital ring that boosts the base's defensive fire." },
      { id: "shield", name: "Planetary Shield", eff: [["Shield", "+20%"]], desc: "Planetary shield that absorbs incoming damage." },
      { id: "fortress", name: "Fortress", eff: [["Defense", "+25%"]], desc: "Hardened bunker that strengthens all defenses." }
    ],
    light: [
      { id: "fighter", name: "Fighters", cost: 5, eff: [["Atk", "2"], ["Def", "2"]], req: "Shipyards 1 + Laser 1", desc: "Cheap strike craft, strong against unshielded ships; needs hangars to travel between astros." },
      { id: "bomber", name: "Bombers", cost: 10, eff: [["Atk", "5"], ["Def", "2"]], req: "Shipyards 2 + Plasma 1", desc: "Heavy striker that tears into structures and large hulls." },
      { id: "scout", name: "Scouts", cost: 3, eff: [["Atk", "0"], ["Def", "1"]], req: "Shipyards 1", desc: "Fast, cheap probe for revealing distant systems." },
      { id: "corvette", name: "Corvettes", cost: 8, eff: [["Atk", "3"], ["Def", "3"]], req: "Shipyards 2 + Laser 2", desc: "Light escort with balanced attack and shielding." }
    ],
    logistics: [
      { id: "transport", name: "Transports", cost: 12, eff: [["Cargo", "50"]], req: "Shipyards 1", desc: "Hauls resources between your bases." },
      { id: "outpost", name: "Outpost Ship", cost: 40, eff: [["Colony", "1"]], req: "Shipyards 2 + Astro 1", desc: "Colony ship used to claim a new astro." },
      { id: "recycler", name: "Recyclers", cost: 16, eff: [["Salvage", "30"]], req: "Shipyards 2", desc: "Collects the debris left after battles." },
      { id: "carrier", name: "Carriers", cost: 60, eff: [["Hangar", "20"]], req: "Shipyards 4", desc: "Mobile hangar that ferries strike craft." }
    ],
    heavy: [
      { id: "frigate", name: "Frigates", cost: 30, eff: [["Atk", "8"], ["Def", "8"]], req: "Shipyards 3 + Laser 2", desc: "Workhorse warship with solid attack and shielding." },
      { id: "destroyer", name: "Destroyers", cost: 60, eff: [["Atk", "16"], ["Def", "14"]], req: "Shipyards 4 + Plasma 2", desc: "Line warship that anchors a battle fleet." },
      { id: "cruiser", name: "Cruisers", cost: 120, eff: [["Atk", "34"], ["Def", "30"]], req: "Shipyards 6 + Ion 2", desc: "Heavy hull built to trade blows with capitals." },
      { id: "battleship", name: "Battleships", cost: 240, eff: [["Atk", "70"], ["Def", "60"]], req: "Shipyards 8 + Photon 2", desc: "Capital ship that dominates direct engagements." },
      { id: "titan", name: "Titans", cost: 600, eff: [["Atk", "160"], ["Def", "150"]], req: "Shipyards 10 + AI 4", desc: "Apex hull; few bases can build or stop one." }
    ],
    rsupport: [
      { id: "energy", name: "Energy", eff: [["Energy", "+5%"]], desc: "Each level raises every base's energy output." },
      { id: "computer", name: "Computer", eff: [["Fleet", "+1"]], desc: "Each level grants an extra fleet command slot." },
      { id: "armour", name: "Armour", eff: [["Hull", "+5%"]], desc: "Adds hull strength to all of your ships." },
      { id: "shielding", name: "Shielding", eff: [["Shield", "+5%"]], desc: "Improves shields across the whole fleet." },
      { id: "warp", name: "Warp Drive", eff: [["Speed", "+10%"]], desc: "Increases fleet travel speed between systems." },
      { id: "ai", name: "Artificial Intelligence", eff: [["Efficiency", "+1"]], desc: "Automates production and improves base efficiency." },
      { id: "astro", name: "Astrophysics", eff: [["Colonise", "+1"]], desc: "Unlocks colonisation of more distant, exotic astros." }
    ],
    rcombat: [
      { id: "laser", name: "Laser", eff: [["Laser", "+1"]], desc: "Improves the damage of laser weapon systems." },
      { id: "plasma", name: "Plasma", eff: [["Plasma", "+1"]], desc: "Improves the damage of plasma weapon systems." },
      { id: "ion", name: "Ion", eff: [["Ion", "+1"]], desc: "Improves the damage of ion weapon systems." },
      { id: "photon", name: "Photon", eff: [["Photon", "+1"]], desc: "Improves the damage of photon weapon systems." },
      { id: "disruptor", name: "Disruptor", eff: [["Disruptor", "+1"]], desc: "Improves the damage of disruptor weapon systems." }
    ]
  };
  var SUBS = {
    structures: [["facilities", "Facilities"], ["support", "Support"], ["defenses", "Defenses"]],
    production: [["light", "Light"], ["logistics", "Logistics"], ["heavy", "Heavy"]],
    research: [["rsupport", "Support"], ["rcombat", "Combat"]]
  };
  var DEFSUB = { structures: "facilities", production: "light", research: "rsupport" };

  // Deterministic base contents.
  function makeBase(a) {
    var s = a.astro, seed = hashStr(a.address);
    function lv(id, max) { return mix(seed, hashStr(id)) % (max + 1); }
    var L = {
      lab: lv("lab", 6), metal: lv("metal", 6), robotic: lv("robotic", 6),
      shipyard: lv("shipyard", 6), spaceport: lv("spaceport", 6), urban: lv("urban", 8),
      crystal: s.crystal ? lv("crystal", 5) : 0,
      command: 1, solar: lv("solar", 6), gas: s.gas ? lv("gas", 5) : 0, fusion: lv("fusion", 4),
      metro: lv("metro", 4), terraform: lv("terraform", 3), mlp: lv("mlp", 3), jump: lv("jump", 1),
      barracks: lv("barracks", 4), laserT: lv("laserT", 6), plasmaT: lv("plasmaT", 4),
      ionT: lv("ionT", 3), photonT: lv("photonT", 2), ring: lv("ring", 3),
      shield: lv("shield", 3), fortress: lv("fortress", 2)
    };
    var R = {
      energy: lv("energy", 8), computer: lv("computer", 6), armour: lv("armour", 6),
      shielding: lv("shielding", 5), warp: lv("warp", 5), ai: lv("ai", 4), astro: lv("astro", 6),
      laser: lv("rlaser", 6), plasma: lv("rplasma", 4), ion: lv("rion", 3),
      photon: lv("rphoton", 2), disruptor: lv("rdisruptor", 2)
    };
    // structure id -> stored level (turrets share names with research, keep separate)
    var levelOf = {
      lab: L.lab, metal: L.metal, robotic: L.robotic, shipyard: L.shipyard, spaceport: L.spaceport,
      urban: L.urban, crystal: L.crystal, command: L.command, solar: L.solar, gas: L.gas,
      fusion: L.fusion, metro: L.metro, terraform: L.terraform, mlp: L.mlp, jump: L.jump,
      barracks: L.barracks, laser: L.laserT, plasma: L.plasmaT, ion: L.ionT, photon: L.photonT,
      ring: L.ring, shield: L.shield, fortress: L.fortress
    };
    var used = 0; for (var k in levelOf) used += levelOf[k];
    used = Math.min(s.area, used + 4);
    return {
      owner: baseOwner(a.address), levelOf: levelOf, research: R,
      areaUsed: used, areaTotal: s.area,
      rates: { metal: s.metal * L.metal, gas: s.gas * (L.gas + L.fusion), crystal: s.crystal * L.crystal, research: L.lab * 8 },
      pop: { cur: Math.min(s.fertility * L.urban, used), max: s.fertility * (L.urban + 1) + L.metro * 5 },
      energy: { cur: s.solar * L.solar + s.gas * L.gas + L.fusion * 12, max: s.solar * (L.solar + 1) + s.gas * (L.gas + 1) + L.fusion * 12 + 2 }
    };
  }

  function baseView(gg, a) {
    var s = a.astro, name = s.typeName + (a.kind === "moon" ? " Moon" : " Planet");
    var base = makeBase(a);
    var tab = gg.baseTab || "overview";

    var h = '<div class="astro-modal" data-gg="astro-close">' +
      '<div class="base-screen" data-gg="stop"><button class="amclose" data-gg="astro-close">✗</button>';

    // top bar: name + address + vitals + economy
    h += '<div class="bv-top"><div class="bv-headl">' +
      '<button class="bv-back" data-gg="close-base" title="Back to planet">‹</button>' +
      '<div class="bv-name">' + name + '<span class="bv-addr">' + a.address + "</span></div></div>" +
      '<div class="bv-res">' +
        resChip("👤", "Population", base.pop.cur + "/" + base.pop.max, "#8ef0a0") +
        resChip("⚡", "Energy", base.energy.cur + "/" + base.energy.max, "#ffd76a") +
        resChip("▬", "Area", base.areaUsed + "/" + base.areaTotal, "#7fd1ff") +
        resChip("⛏", "Metal", "+" + base.rates.metal, "#cdd6e3") +
        resChip("◔", "Gas", "+" + base.rates.gas, "#ff9e6a") +
        resChip("◆", "Crystal", "+" + base.rates.crystal, "#c9a6ff") +
        resChip("⚗", "Research", "+" + base.rates.research, "#9ad0ff") +
      "</div></div>";

    // main tabs
    var TABS = [["overview", "Overview"], ["structures", "Structures"],
      ["production", "Production"], ["research", "Research"], ["trade", "Trade"]];
    h += '<div class="bv-tabs">' + TABS.map(function (t) {
      return '<span class="bv-tab' + (t[0] === tab ? " on" : "") +
        '" data-gg="base-tab" data-to="' + t[0] + '">' + t[1] + "</span>";
    }).join("") + "</div>";

    // body per tab
    if (tab === "overview") {
      h += '<div class="bv-stage">' + baseSurface(a) +
        '<div class="bv-owner"><span class="bv-ol">Owner</span><span class="bv-on">' + base.owner +
        '</span><span class="bv-os">colony established</span></div></div>';
    } else if (tab === "trade") {
      h += '<div class="bv-trade"><div class="bv-empty">No trade routes from this base yet. ' +
        "Routes move resources to your other colonies once Spaceports are built.</div></div>";
    } else {
      h += bvCatalogTab(gg, tab, base);
    }
    return h + "</div></div>";
  }
  function resChip(glyph, label, val, col) {
    return '<span class="bv-chip" title="' + label + '"><i style="color:' + col + '">' +
      glyph + "</i>" + val + "</span>";
  }

  // Structures / Production / Research share a list + detail layout.
  function bvCatalogTab(gg, tab, base) {
    var sub = gg.baseSub || DEFSUB[tab];
    if (!SUBS[tab].some(function (x) { return x[0] === sub; })) sub = DEFSUB[tab];
    var list = CATA[sub] || [];
    var selId = gg.baseSel;
    if (!list.some(function (it) { return it.id === selId; })) selId = list[0] && list[0].id;
    var sel = list.filter(function (it) { return it.id === selId; })[0];
    var owned = (tab !== "production");
    var cat = sub;

    var h = '<div class="bv-sub">' + SUBS[tab].map(function (x) {
      return '<span class="bv-subtab' + (x[0] === sub ? " on" : "") +
        '" data-gg="base-sub" data-to="' + x[0] + '">' + x[1] + "</span>";
    }).join("") + "</div>";

    h += '<div class="bv-panes"><div class="bv-list">';
    list.forEach(function (it) {
      var lvl = owned ? lvlFor(tab, base, it.id) : null;
      var time = owned ? mmss((lvl + 1) * 175) : mmss(it.cost * 12);
      h += '<div class="bvrow' + (it.id === selId ? " on" : "") + '" data-gg="base-sel" data-id="' + it.id + '">' +
        '<div class="bvicon">' + catIcon(cat, false) + "</div>" +
        '<div class="bvmain"><div class="bvname">' + it.name + "</div>" +
        '<div class="bvmeta">' + (owned ? '<b>' + lvl + "</b> · " + time
          : '<span class="bvcost">⚉ ' + it.cost + "</span> · " + time) + "</div></div>" +
        '<div class="bveff">' + effChips(it.eff) + "</div></div>";
    });
    h += "</div>";

    // detail
    h += '<div class="bv-detail">';
    if (sel) {
      var lvl2 = owned ? lvlFor(tab, base, sel.id) : null;
      h += '<div class="bvd-head">' + sel.name +
        (owned ? ' <span class="bvd-lvl">' + lvl2 + "</span>" : "") + "</div>" +
        '<div class="bvd-img">' + catIcon(cat, true) + "</div>" +
        '<div class="bvd-eff">' + effChips(sel.eff) + "</div>" +
        '<div class="bvd-desc">' + sel.desc + "</div>" +
        (sel.req ? '<div class="bvd-req">Requires: <b>' + sel.req + "</b></div>" : "");
      if (tab === "production")
        h += '<div class="bvd-act"><span class="bvd-cost">Cost ⚉ ' + sel.cost +
          '</span><button class="btn sm primary" disabled>Build</button></div>';
      else
        h += '<div class="bvd-act"><span class="bvd-q">Next level in ' +
          mmss((lvl2 + 1) * 175) + '</span><button class="btn sm primary" disabled>Upgrade</button></div>';
    } else h += '<div class="bv-empty">Select an item.</div>';
    h += "</div></div>";
    return h;
  }
  function lvlFor(tab, base, id) {
    return tab === "research" ? (base.research[id] || 0) : (base.levelOf[id] || 0);
  }
  function effChips(list) {
    return (list || []).map(function (e) {
      return '<span class="effchip">' + e[0] + ' <b>' + e[1] + "</b></span>";
    }).join("");
  }
  function mmss(sec) { var m = Math.floor(sec / 60), s = sec % 60; return (m ? m + "m " : "") + s + "s"; }

  // Original category icons (no third-party art).
  function catIcon(cat, big) {
    var sz = big ? 132 : 40;
    var svg = '<svg viewBox="0 0 64 64" width="' + sz + '" height="' + sz + '" class="cati">';
    if (cat === "light" || cat === "logistics" || cat === "heavy") {
      svg += '<path d="M8 40 L40 22 L56 30 L40 34 L24 46 Z" fill="#aebccb" stroke="#2b3a52"/>' +
        '<path d="M40 22 L44 14 L48 30 Z" fill="#7f8ea6"/>' +
        '<circle cx="20" cy="40" r="2.4" fill="#7fd1ff"/>';
    } else if (cat === "defenses") {
      svg += '<rect x="22" y="34" width="20" height="18" rx="2" fill="#8a98ad" stroke="#2b3a52"/>' +
        '<rect x="28" y="16" width="8" height="22" rx="3" fill="#9fb0c8" stroke="#2b3a52"/>' +
        '<circle cx="32" cy="14" r="4" fill="#ff9e6a"/>';
    } else if (cat === "rsupport" || cat === "rcombat") {
      svg += '<circle cx="32" cy="32" r="14" fill="#33204a" stroke="#7a5fb0"/>' +
        '<ellipse cx="32" cy="32" rx="20" ry="8" fill="none" stroke="#c9a6ff" stroke-width="1.6"/>' +
        '<ellipse cx="32" cy="32" rx="20" ry="8" fill="none" stroke="#9ad0ff" stroke-width="1.2" transform="rotate(60 32 32)"/>' +
        '<circle cx="32" cy="32" r="4" fill="#eafaff"/>';
    } else {
      svg += '<path d="M14 46 L14 30 Q32 14 50 30 L50 46 Z" fill="#9fb0c8" stroke="#2b3a52"/>' +
        '<rect x="10" y="46" width="44" height="8" rx="2" fill="#7f8ea6" stroke="#2b3a52"/>';
      for (var y = 30; y < 44; y += 6) for (var x = 20; x < 46; x += 7)
        svg += '<rect x="' + x + '" y="' + y + '" width="3" height="3" fill="#bfe9ff" opacity="0.8"/>';
    }
    return svg + "</svg>";
  }
  var TERRAIN = {
    gaia:    ["#0c2b3a", "#16465a", "#2f7d3f", "#1f5a2c", "#3a6b46", "#1f6f86"],
    earthly: ["#0c2b3a", "#1c4a55", "#3a7d44", "#286031", "#4a6b4a", "#206f80"],
    rocky:   ["#241a14", "#4a3320", "#7a5a39", "#5a4129", "#6b513a", "#3a5566"],
    arid:    ["#2a1f12", "#5a4322", "#9a7338", "#6f5226", "#7a5e3a", "#4a6066"],
    tundra:  ["#16283a", "#2c4a63", "#9fb4c0", "#7892a0", "#aebccb", "#2f6f86"],
    glacial: ["#13283f", "#27506f", "#bcd6e6", "#8fb3c8", "#cfe0ee", "#2f7fa6"],
    oceanic: ["#0a2436", "#134a63", "#2f6f7a", "#1f5560", "#3a6b6f", "#1f87a6"],
    craters: ["#1a1a20", "#36363f", "#6f6f78", "#52525a", "#5a5a64", "#33424f"],
    metallic:["#161a20", "#323a47", "#6f7a8a", "#525a66", "#5a6675", "#33424f"],
    magma:   ["#1c0c0c", "#3a1410", "#5a2418", "#3a1410", "#6b2a1f", "#7a2f14"],
    volcanic:["#1c0c0c", "#33160f", "#4a2018", "#301410", "#5a261c", "#6b2a14"],
    toxic:   ["#14200c", "#2a3a14", "#5a6f2a", "#41521f", "#536b2f", "#4a6620"],
    radioactive:["#141c0c","#2c3a14","#6f8a2a","#52661f","#6b8a2f","#4a6620"],
    crystalline:["#1a1228","#33204a","#6a4f9a","#4a3470","#7a5fb0","#4f3a86"]
  };
  function terrain(t) { return TERRAIN[t] || TERRAIN.arid; }

  // Original SVG surface: tinted sky, mountain silhouettes, ground, water, and
  // a deterministic spread of stylised structures with a marked command base.
  function baseSurface(a) {
    var p = terrain(a.astro.type);
    var seed = hashStr(a.address);
    var rng = mulberry32(seed);
    function r(n) { return (rng() * n) | 0; }

    var W = 760, H = 360, horizon = 150;
    var svg = '<svg class="bv-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice">';
    svg += '<defs>' +
      '<linearGradient id="bvsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + p[0] +
        '"/><stop offset="1" stop-color="' + p[1] + '"/></linearGradient>' +
      '<linearGradient id="bvgnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + p[2] +
        '"/><stop offset="1" stop-color="' + p[3] + '"/></linearGradient></defs>';
    svg += '<rect width="' + W + '" height="' + H + '" fill="url(#bvsky)"/>';
    // stars
    for (var i = 0; i < 40; i++) svg += '<circle cx="' + r(W) + '" cy="' + r(horizon - 20) +
      '" r="' + (rng() < 0.2 ? 1.3 : 0.7) + '" fill="#dff1ff" opacity="' + (0.3 + rng() * 0.5).toFixed(2) + '"/>';
    // far mountains (two layers)
    svg += mountainPath(W, horizon + 26, 6, seed + 1, p[4], 0.65);
    svg += mountainPath(W, horizon + 10, 8, seed + 7, p[4], 1);
    // ground
    svg += '<rect x="0" y="' + horizon + '" width="' + W + '" height="' + (H - horizon) + '" fill="url(#bvgnd)"/>';
    svg += '<ellipse cx="' + (W * 0.5) + '" cy="' + (horizon + 6) + '" rx="' + (W * 0.7) +
      '" ry="22" fill="' + p[2] + '" opacity="0.5"/>';
    // water corner
    svg += '<path d="M0 ' + (H - 70) + ' Q ' + (W * 0.22) + ' ' + (H - 96) + ' ' + (W * 0.34) + ' ' + H +
      ' L 0 ' + H + ' Z" fill="' + p[5] + '" opacity="0.85"/>';

    // structures: spread along mid-ground; a central command base with marker.
    var spots = [[120, 250, 0.9], [300, 232, 0.8], [610, 236, 0.9], [470, 300, 1.05]];
    spots.forEach(function (sp, idx) {
      svg += building(sp[0], sp[1], sp[2], p, rng, idx === 3);
    });
    // command marker "1"
    svg += '<g transform="translate(470,318)"><path d="M0 -14 L12 -7 L12 7 L0 14 L-12 7 L-12 -7 Z" ' +
      'fill="#1f7fb0" stroke="#bfe9ff" stroke-width="1.5"/><text x="0" y="4" text-anchor="middle" ' +
      'font-size="13" fill="#eaf7ff" font-family="monospace">1</text></g>';
    return svg + "</svg>";
  }
  function mountainPath(W, baseY, peaks, seed, col, op) {
    var rng = mulberry32(seed), d = "M0 " + baseY, step = W / peaks;
    for (var i = 0; i <= peaks; i++) {
      var x = i * step, y = baseY - 30 - (rng() * 64);
      d += " L " + x.toFixed(0) + " " + y.toFixed(0) + " L " + (x + step / 2).toFixed(0) + " " + baseY;
    }
    d += " L " + W + " " + baseY + " Z";
    return '<path d="' + d + '" fill="' + col + '" opacity="' + op + '"/>';
  }
  function building(x, y, scale, p, rng, isMain) {
    var w = (isMain ? 78 : 52) * scale, bh = (isMain ? 46 : 30) * scale;
    var g = '<g transform="translate(' + x + ',' + y + ') scale(' + scale + ')">';
    // platform
    g += '<ellipse cx="0" cy="' + (bh * 0.5) + '" rx="' + (w * 0.62) + '" ry="' + (bh * 0.22) +
      '" fill="#0a1322" opacity="0.5"/>';
    if (isMain) {
      g += '<path d="M-30 6 L-30 -8 Q0 -40 30 -8 L30 6 Z" fill="#9fb0c8" stroke="#2b3a52"/>' +
        '<rect x="-34" y="6" width="68" height="12" rx="3" fill="#7f8ea6" stroke="#2b3a52"/>' +
        '<rect x="-6" y="-30" width="3" height="20" fill="#cfd9ea"/>' +
        '<circle cx="22" cy="2" r="6" fill="#bfe9ff" opacity="0.85"/>';
    } else {
      var bw = w * 0.7;
      g += '<rect x="' + (-bw / 2) + '" y="' + (-bh) + '" width="' + bw + '" height="' + bh +
        '" rx="2" fill="#8a98ad" stroke="#2b3a52"/>';
      // windows
      for (var wy = -bh + 4; wy < -4; wy += 6)
        for (var wx = -bw / 2 + 4; wx < bw / 2 - 3; wx += 6)
          g += '<rect x="' + wx.toFixed(0) + '" y="' + wy.toFixed(0) + '" width="3" height="3" fill="' +
            (rng() < 0.5 ? "#ffd76a" : "#33424f") + '"/>';
      g += '<rect x="' + (-bw / 2 - 4) + '" y="-6" width="' + (bw + 8) + '" height="8" rx="2" fill="#6f7a8a"/>';
    }
    return g + "</g>";
  }
  function statCell(label, val) {
    return '<div class="scell"><span class="sl">' + label + '</span><span class="sv">' +
      val + "</span></div>";
  }

  function findBody(sys, orbit, pos) {
    var found = null;
    sys.bodies.forEach(function (b) {
      if (b.orbit === orbit && b.position === pos) found = b;
      (b.moons || []).forEach(function (mn) {
        if (mn.orbit === orbit && mn.position === pos) found = mn;
      });
    });
    return found;
  }

  function kv(k, v) {
    return '<div class="kv"><span class="k">' + k + '</span><span class="v">' +
      v + "</span></div>";
  }
  function fmt(n) {
    n = Math.round(n);
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + "k";
    return n.toLocaleString("en-US");
  }

  /* ---------------- events ---------------- */
  function onClick(e) {
    var el = e.target.closest("[data-gg]"); if (!el) return;
    var _v = S().ui.view; if (_v !== "galaxygen" && _v !== "galaxymap") return;
    var a = el.getAttribute("data-gg"), gg = ensure(S());

    if (a === "seg") {
      gg[el.getAttribute("data-field")] = el.getAttribute("data-val");
      rerender(); persist(); return;
    }
    if (a === "prefix" || a === "number") return; // handled on change
    if (a === "reseed") { gg.master = (Math.random() * 1e9) | 0; rerender(); persist(); return; }

    if (a === "gomap") { navTo("galaxymap"); return; }
    if (a === "generate") { doGenerate(gg); return; }

    if (a === "stop") return;                 // clicks inside the modal card
    if (a === "astro-close") {
      gg.astroSel = null; gg.baseOpen = false; gg.baseTab = "overview";
      gg.baseSub = null; gg.baseSel = null; rerender(); persist(); return;
    }
    if (a === "open-base") {
      gg.baseOpen = true; gg.baseTab = "overview"; gg.baseSub = null; gg.baseSel = null;
      rerender(); persist(); return;
    }
    if (a === "close-base") { gg.baseOpen = false; rerender(); persist(); return; }
    if (a === "base-tab") {
      gg.baseTab = el.getAttribute("data-to"); gg.baseSub = null; gg.baseSel = null;
      rerender(); persist(); return;
    }
    if (a === "base-sub") { gg.baseSub = el.getAttribute("data-to"); gg.baseSel = null; rerender(); persist(); return; }
    if (a === "base-sel") { gg.baseSel = el.getAttribute("data-id"); rerender(); persist(); return; }
    if (a === "colonize") {
      var addr = el.getAttribute("data-addr"), size = +el.getAttribute("data-size");
      if (window.__ASTRO && window.__ASTRO.sendColonize) {
        window.__ASTRO.sendColonize(addr, size).then(function (okSent) {
          if (!okSent) return;
          gg.astroSel = null;
          var refreshed = ctx && ctx.refreshState ? ctx.refreshState() : Promise.resolve();
          refreshed.then(function () { rerender(); persist(); });
        });
      }
      return;
    }
    if (a === "astro") {
      gg.astroSel = { orbit: +el.getAttribute("data-orbit"), pos: +el.getAttribute("data-pos") };
      gg.baseOpen = false; gg.baseTab = "overview"; gg.baseSub = null; gg.baseSel = null;
      rerender(); persist(); return;
    }

    if (a === "nav") {
      var to = el.getAttribute("data-to");
      gg.astroSel = null; gg.baseOpen = false;
      if (to === "galaxy") { gg.page = "galaxy"; gg.region = null; gg.system = null; }
      else if (to === "region") { gg.page = gg.region ? "region" : "galaxy"; gg.system = null; }
      rerender(); persist(); return;
    }
    if (a === "region") {
      gg.region = { sx: +el.getAttribute("data-sx"), sy: +el.getAttribute("data-sy") };
      gg.system = null; gg.astroSel = null; gg.baseOpen = false; gg.page = "region"; rerender(); persist(); return;
    }
    if (a === "system") { openSystem(gg, el); return; }
  }

  // Generate: clear + populate the database, then load the map from it. If no
  // server/DB is reachable, fall back to the deterministic local engine.
  // The server grants the commander 100,000,000 credits as part of
  // POST /api/galaxy/generate — the client just re-fetches authoritative
  // state afterwards rather than assuming/duplicating that number locally.
  function doGenerate(gg) {
    gg.result = runStats(gg);
    gg.page = "galaxy"; gg.region = null; gg.system = null; gg.systemData = null;
    gg.loading = true; gg.map = null;
    rerender();
    Promise.resolve()
      .then(function () { return apiGenerate(gg); })
      .then(function () { return apiMap(gg); })
      .then(function (map) { gg.map = map; gg.source = "db"; })
      .catch(function () { gg.map = buildLocalMap(gg); gg.source = "local"; })
      .then(function () {
        gg.loading = false;
        var refreshed = ctx && ctx.refreshState ? ctx.refreshState() : Promise.resolve();
        return refreshed.then(function () { rerender(); persist(); navTo("galaxymap"); });
      });
  }

  function openSystem(gg, el) {
    var sx = +el.getAttribute("data-sx"), sy = +el.getAttribute("data-sy"),
      subX = +el.getAttribute("data-subx"), subY = +el.getAttribute("data-suby");
    gg.system = { sx: sx, sy: sy, subX: subX, subY: subY };
    gg.page = "system"; gg.systemData = null; gg.astroSel = null; gg.baseOpen = false;
    if (gg.source === "db") {
      gg.loading = true; rerender();
      apiSystem(gg, sx, sy, subX, subY)
        .then(function (sys) { gg.systemData = sys; })
        .catch(function () { gg.systemData = localSystem(gg, sx, sy, subX, subY); })
        .then(function () { gg.loading = false; rerender(); persist(); });
    } else {
      gg.systemData = localSystem(gg, sx, sy, subX, subY);
      rerender(); persist();
    }
  }
  function onChange(e) {
    var el = e.target.closest("[data-gg]"); if (!el) return;
    var _v = S().ui.view; if (_v !== "galaxygen" && _v !== "galaxymap") return;
    var a = el.getAttribute("data-gg"), gg = ensure(S());
    if (a === "prefix") { gg.prefix = el.value === "ALL" ? "ALL" : el.value; rerender(); persist(); }
    else if (a === "number") { gg.number = el.value === "ALL" ? "ALL" : +el.value; rerender(); persist(); }
    else if (a === "master") { gg.master = (parseInt(el.value, 10) || 0) | 0; persist(); }
  }
  function onInput(e) {
    var el = e.target.closest("[data-gg]"); if (!el) return;
    var _v = S().ui.view; if (_v !== "galaxygen" && _v !== "galaxymap") return;
    var a = el.getAttribute("data-gg"), gg = ensure(S());
    if (a === "size") {
      gg.size = Math.max(1, Math.min(16, +el.value));
      var lab = document.getElementById("gg-size");
      if (lab) lab.textContent = gg.size + "×" + gg.size;
      gg.region = null; gg.system = null; persist();
    } else if (a === "variate") {
      gg.variate = Math.max(0, Math.min(40, +el.value)) / 100;
      var v = document.getElementById("gg-variate");
      if (v) v.textContent = "±" + Math.round(gg.variate * 100) + "%";
      persist();
    }
  }

  /* ============================================================= EXPORT */
  var GalaxyGen = {
    init: init, viewHtml: viewHtml, mapHtml: mapHtml, ensure: ensure, defaults: defaults,
    // engine (also handy for headless tests / a future server port)
    generateSystem: generateSystem, sectorStars: sectorStars,
    galaxyStats: galaxyStats, runStats: runStats,
    address: address, systemAddress: systemAddress, astroAddress: astroAddress,
    astroStats: astroStats, galaxySeed: galaxySeed,
    PREFIX_NAMES: PREFIX_NAMES, ASTRO: ASTRO, YIELD_KEYS: YIELD_KEYS
  };
  if (typeof window !== "undefined") window.GalaxyGen = GalaxyGen;
  if (typeof module !== "undefined" && module.exports) module.exports = GalaxyGen;
})();
