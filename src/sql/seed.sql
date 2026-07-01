-- ============================================================
-- Astro Empire – Seed Data (with Alien Bases)
-- ============================================================
-- Creates the default account tiers, one admin web account, a test
-- commander ("test" / "password") with a private 6x6 local galaxy
-- (systems + planets), a home base with structures/garrison as normalized
-- rows, several pirate outposts, and a stationed Outpost Ship — every value
-- a plain relational row, nothing as JSON.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE gx_claims;
TRUNCATE TABLE logs;
TRUNCATE TABLE research_queue;
TRUNCATE TABLE player_research;
TRUNCATE TABLE player_techs;
TRUNCATE TABLE fleet_ships;
TRUNCATE TABLE fleets;
TRUNCATE TABLE base_queue;
TRUNCATE TABLE base_structures;
TRUNCATE TABLE pirate_defense;
TRUNCATE TABLE planets;
TRUNCATE TABLE bases;
TRUNCATE TABLE systems;
TRUNCATE TABLE players;
TRUNCATE TABLE users;

SET FOREIGN_KEY_CHECKS = 1;

-- ------------------------------------------------------------
-- 0. Account tiers are seeded by schema.sql. Nothing further needed here.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 3. Player 1's local galaxy systems (6×6 grid)
--    Star types: ⭐ 🌟 ✨ 🔆
-- ------------------------------------------------------------
INSERT INTO systems (player_id, x, y, star, known) VALUES
(1,1,1,'⭐',0),(1,1,2,'🌟',0),(1,1,3,'✨',0),(1,1,4,'🔆',0),(1,1,5,'⭐',0),(1,1,6,'🌟',0),
(1,2,1,'🌟',0),(1,2,2,'✨',0),(1,2,3,'🔆',0),(1,2,4,'⭐',0),(1,2,5,'🌟',0),(1,2,6,'✨',0),
(1,3,1,'✨',0),(1,3,2,'🔆',0),(1,3,3,'⭐',1),(1,3,4,'🌟',0),(1,3,5,'✨',0),(1,3,6,'🔆',0),
(1,4,1,'🔆',0),(1,4,2,'⭐',0),(1,4,3,'🌟',0),(1,4,4,'✨',0),(1,4,5,'🔆',0),(1,4,6,'⭐',0),
(1,5,1,'🌟',0),(1,5,2,'✨',0),(1,5,3,'🔆',0),(1,5,4,'⭐',0),(1,5,5,'🌟',0),(1,5,6,'✨',0),
(1,6,1,'✨',0),(1,6,2,'🔆',0),(1,6,3,'⭐',0),(1,6,4,'🌟',0),(1,6,5,'✨',0),(1,6,6,'🔆',0);

-- ------------------------------------------------------------
-- 4. Planets per system (including alien/pirate bases). Each system has
--    3–5 planets. Pirate garrisons live in `pirate_defense`, one row per
--    ship type, below.
-- ------------------------------------------------------------

INSERT INTO planets (player_id, x, y, slot, type, size, owner, pirate_tier, pirate_loot) VALUES
(1,1,1,1,'arid',85,'empty',NULL,NULL),
(1,1,1,2,'gas',10,'empty',NULL,NULL),
(1,1,1,3,'asteroid',65,'empty',NULL,NULL),

(1,1,2,1,'terran',90,'pirate',2,1500),
(1,1,2,2,'ocean',80,'empty',NULL,NULL),
(1,1,2,3,'gas',12,'empty',NULL,NULL),
(1,1,2,4,'barren',50,'empty',NULL,NULL),

(1,1,3,1,'desert',85,'empty',NULL,NULL),
(1,1,3,2,'tundra',80,'pirate',2,1200),
(1,1,3,3,'asteroid',60,'empty',NULL,NULL),
(1,1,3,4,'gas',9,'empty',NULL,NULL),

(1,1,4,1,'crystalline',75,'pirate',3,2500),
(1,1,4,2,'magma',80,'empty',NULL,NULL),
(1,1,4,3,'barren',45,'empty',NULL,NULL),

(1,1,5,1,'metallic',85,'empty',NULL,NULL),
(1,1,5,2,'gas',11,'empty',NULL,NULL),
(1,1,5,3,'terran',88,'pirate',4,3800),
(1,1,5,4,'ocean',78,'empty',NULL,NULL),
(1,1,5,5,'asteroid',62,'empty',NULL,NULL),

(1,1,6,1,'rocky',85,'empty',NULL,NULL),
(1,1,6,2,'gas',10,'empty',NULL,NULL),
(1,1,6,3,'barren',40,'empty',NULL,NULL),

(1,2,1,1,'tundra',90,'pirate',2,1600),
(1,2,1,2,'asteroid',68,'empty',NULL,NULL),
(1,2,1,3,'gas',11,'empty',NULL,NULL),
(1,2,1,4,'desert',82,'empty',NULL,NULL),

(1,2,2,1,'gaia',88,'empty',NULL,NULL),
(1,2,2,2,'ocean',76,'empty',NULL,NULL),
(1,2,2,3,'craters',85,'pirate',3,2500),
(1,2,2,4,'gas',12,'empty',NULL,NULL),

(1,2,3,1,'radioactive',90,'pirate',3,2200),
(1,2,3,2,'barren',45,'empty',NULL,NULL),
(1,2,3,3,'gas',9,'empty',NULL,NULL),

(1,2,4,1,'toxic',88,'empty',NULL,NULL),
(1,2,4,2,'terran',84,'empty',NULL,NULL),
(1,2,4,3,'asteroid',60,'empty',NULL,NULL),
(1,2,4,4,'gas',10,'empty',NULL,NULL),

(1,2,5,1,'arid',92,'empty',NULL,NULL),
(1,2,5,2,'ocean',74,'empty',NULL,NULL),
(1,2,5,3,'gas',13,'empty',NULL,NULL),
(1,2,5,4,'barren',48,'empty',NULL,NULL),
(1,2,5,5,'metallic',80,'pirate',4,3800),

(1,2,6,1,'jungle',82,'pirate',1,900),
(1,2,6,2,'asteroid',65,'empty',NULL,NULL),
(1,2,6,3,'gas',11,'empty',NULL,NULL),

(1,3,1,1,'rocky',86,'pirate',5,5500),
(1,3,1,2,'ocean',72,'empty',NULL,NULL),
(1,3,1,3,'barren',42,'empty',NULL,NULL),
(1,3,1,4,'gas',12,'empty',NULL,NULL),

(1,3,2,1,'terran',92,'empty',NULL,NULL),
(1,3,2,2,'craters',80,'pirate',5,5000),
(1,3,2,3,'gas',9,'empty',NULL,NULL),
(1,3,2,4,'asteroid',55,'empty',NULL,NULL),

(1,3,3,1,'terran',16,'you',NULL,NULL),   -- home base (base_id set below)
(1,3,3,2,'ocean',14,'empty',NULL,NULL),
(1,3,3,3,'gas',10,'empty',NULL,NULL),
(1,3,3,4,'barren',5,'empty',NULL,NULL),

(1,3,4,1,'toxic',88,'pirate',2,1700),
(1,3,4,2,'asteroid',60,'empty',NULL,NULL),
(1,3,4,3,'gas',11,'empty',NULL,NULL),

(1,3,5,1,'metallic',84,'empty',NULL,NULL),
(1,3,5,2,'ocean',78,'empty',NULL,NULL),
(1,3,5,3,'barren',44,'empty',NULL,NULL),
(1,3,5,4,'gas',10,'empty',NULL,NULL),

(1,3,6,1,'radioactive',90,'empty',NULL,NULL),
(1,3,6,2,'terran',86,'empty',NULL,NULL),
(1,3,6,3,'craters',82,'pirate',1,800),
(1,3,6,4,'gas',12,'empty',NULL,NULL),

(1,4,1,1,'gaia',90,'pirate',3,2800),
(1,4,1,2,'asteroid',62,'empty',NULL,NULL),
(1,4,1,3,'ocean',74,'empty',NULL,NULL),
(1,4,1,4,'gas',11,'empty',NULL,NULL),

(1,4,2,1,'volcanic',80,'pirate',3,2200),
(1,4,2,2,'barren',42,'empty',NULL,NULL),
(1,4,2,3,'gas',9,'empty',NULL,NULL),

(1,4,3,1,'arid',92,'pirate',4,3600),
(1,4,3,2,'desert',84,'empty',NULL,NULL),
(1,4,3,3,'asteroid',60,'empty',NULL,NULL),
(1,4,3,4,'gas',12,'empty',NULL,NULL),

(1,4,4,1,'crystalline',72,'empty',NULL,NULL),
(1,4,4,2,'ocean',76,'empty',NULL,NULL),
(1,4,4,3,'barren',40,'empty',NULL,NULL),
(1,4,4,4,'gas',11,'empty',NULL,NULL),
(1,4,4,5,'terran',88,'empty',NULL,NULL),

(1,4,5,1,'metallic',86,'empty',NULL,NULL),
(1,4,5,2,'gas',10,'empty',NULL,NULL),
(1,4,5,3,'asteroid',58,'empty',NULL,NULL),

(1,4,6,1,'tundra',90,'empty',NULL,NULL),
(1,4,6,2,'ocean',72,'empty',NULL,NULL),
(1,4,6,3,'gas',13,'empty',NULL,NULL),
(1,4,6,4,'magma',78,'pirate',2,1500),

(1,5,1,1,'rocky',88,'pirate',2,1800),
(1,5,1,2,'barren',42,'empty',NULL,NULL),
(1,5,1,3,'gas',11,'empty',NULL,NULL),

(1,5,2,1,'toxic',86,'empty',NULL,NULL),
(1,5,2,2,'asteroid',62,'empty',NULL,NULL),
(1,5,2,3,'terran',80,'empty',NULL,NULL),
(1,5,2,4,'gas',12,'empty',NULL,NULL),

(1,5,3,1,'crystalline',74,'empty',NULL,NULL),
(1,5,3,2,'ocean',76,'empty',NULL,NULL),
(1,5,3,3,'barren',40,'empty',NULL,NULL),
(1,5,3,4,'gas',9,'empty',NULL,NULL),

(1,5,4,1,'arid',90,'empty',NULL,NULL),
(1,5,4,2,'desert',84,'empty',NULL,NULL),
(1,5,4,3,'asteroid',60,'empty',NULL,NULL),
(1,5,4,4,'gas',13,'empty',NULL,NULL),
(1,5,4,5,'metallic',82,'pirate',3,3000),

(1,5,5,1,'radioactive',88,'pirate',5,6000),
(1,5,5,2,'gas',10,'empty',NULL,NULL),
(1,5,5,3,'barren',44,'empty',NULL,NULL),

(1,5,6,1,'terran',82,'empty',NULL,NULL),
(1,5,6,2,'ocean',70,'empty',NULL,NULL),
(1,5,6,3,'gas',11,'empty',NULL,NULL),
(1,5,6,4,'asteroid',55,'empty',NULL,NULL),

(1,6,1,1,'rocky',84,'pirate',3,2400),
(1,6,1,2,'barren',38,'empty',NULL,NULL),
(1,6,1,3,'gas',12,'empty',NULL,NULL),
(1,6,1,4,'desert',80,'empty',NULL,NULL),

(1,6,2,1,'gaia',86,'empty',NULL,NULL),
(1,6,2,2,'ocean',74,'empty',NULL,NULL),
(1,6,2,3,'craters',78,'pirate',4,3500),

(1,6,3,1,'metallic',82,'empty',NULL,NULL),
(1,6,3,2,'gas',10,'empty',NULL,NULL),
(1,6,3,3,'asteroid',58,'empty',NULL,NULL),
(1,6,3,4,'terran',84,'empty',NULL,NULL),

(1,6,4,1,'crystalline',70,'pirate',4,3400),
(1,6,4,2,'barren',42,'empty',NULL,NULL),
(1,6,4,3,'gas',11,'empty',NULL,NULL),
(1,6,4,4,'ocean',72,'empty',NULL,NULL),

(1,6,5,1,'radioactive',88,'empty',NULL,NULL),
(1,6,5,2,'asteroid',60,'empty',NULL,NULL),
(1,6,5,3,'gas',10,'empty',NULL,NULL),

(1,6,6,1,'arid',90,'empty',NULL,NULL),
(1,6,6,2,'magma',80,'pirate',2,1100),
(1,6,6,3,'gas',12,'empty',NULL,NULL),
(1,6,6,4,'barren',40,'empty',NULL,NULL);

-- ------------------------------------------------------------
-- 5. Pirate garrisons — one row per ship type per pirate planet, replacing
--    the old JSON pirate_def blob.
-- ------------------------------------------------------------
INSERT INTO pirate_defense (player_id, x, y, slot, ship_key, qty) VALUES
(1,1,2,1,'fighter',12),(1,1,2,1,'corvette',4),
(1,1,3,2,'fighter',12),(1,1,3,2,'corvette',4),
(1,1,4,1,'fighter',20),(1,1,4,1,'corvette',6),(1,1,4,1,'frigate',2),
(1,1,5,3,'fighter',30),(1,1,5,3,'corvette',10),(1,1,5,3,'frigate',3),(1,1,5,3,'destroyer',1),
(1,2,1,1,'fighter',10),(1,2,1,1,'corvette',5),
(1,2,2,3,'fighter',20),(1,2,2,3,'corvette',6),(1,2,2,3,'frigate',2),
(1,2,3,1,'fighter',18),(1,2,3,1,'corvette',5),(1,2,3,1,'frigate',1),
(1,2,5,5,'fighter',30),(1,2,5,5,'corvette',10),(1,2,5,5,'frigate',4),(1,2,5,5,'destroyer',1),
(1,2,6,1,'fighter',8),(1,2,6,1,'corvette',2),
(1,3,1,1,'fighter',45),(1,3,1,1,'corvette',15),(1,3,1,1,'frigate',6),(1,3,1,1,'destroyer',3),(1,3,1,1,'cruiser',1),
(1,3,2,2,'fighter',40),(1,3,2,2,'corvette',12),(1,3,2,2,'frigate',5),(1,3,2,2,'destroyer',2),(1,3,2,2,'cruiser',1),
(1,3,4,1,'fighter',14),(1,3,4,1,'corvette',4),
(1,3,6,3,'fighter',8),(1,3,6,3,'corvette',2),
(1,4,1,1,'fighter',22),(1,4,1,1,'corvette',7),(1,4,1,1,'frigate',2),
(1,4,2,1,'fighter',15),(1,4,2,1,'corvette',5),(1,4,2,1,'frigate',1),
(1,4,3,1,'fighter',28),(1,4,3,1,'corvette',9),(1,4,3,1,'frigate',3),(1,4,3,1,'destroyer',1),
(1,4,6,4,'fighter',10),(1,4,6,4,'corvette',3),(1,4,6,4,'frigate',1),
(1,5,1,1,'fighter',12),(1,5,1,1,'corvette',5),
(1,5,4,5,'fighter',18),(1,5,4,5,'corvette',6),(1,5,4,5,'frigate',2),(1,5,4,5,'destroyer',1),
(1,5,5,1,'fighter',50),(1,5,5,1,'corvette',18),(1,5,5,1,'frigate',7),(1,5,5,1,'destroyer',4),(1,5,5,1,'cruiser',2),
(1,6,1,1,'fighter',20),(1,6,1,1,'corvette',6),(1,6,1,1,'frigate',2),
(1,6,2,3,'fighter',25),(1,6,2,3,'corvette',8),(1,6,2,3,'frigate',3),(1,6,2,3,'destroyer',2),
(1,6,4,1,'fighter',26),(1,6,4,1,'corvette',8),(1,6,4,1,'frigate',3),(1,6,4,1,'destroyer',1),
(1,6,6,2,'fighter',9),(1,6,6,2,'corvette',3);

-- ------------------------------------------------------------
-- 6. Home base for the test commander at (3,3):1
-- ------------------------------------------------------------
INSERT INTO bases (id, player_id, name, x, y, slot, address, size, created_at) VALUES
    (1, 1, 'Homeworld', 3, 3, 1, NULL, 16, NOW());

UPDATE planets SET base_id = 1 WHERE player_id = 1 AND x = 3 AND y = 3 AND slot = 1;

INSERT INTO base_structures (base_id, struct_key, level) VALUES
    (1, 'solar', 5), (1, 'metro', 3), (1, 'lab', 2), (1, 'robotic', 2), (1, 'shipyard', 1), (1, 'spaceport', 1);

-- Garrison ships are not a bare per-base table — they are the base's own
-- "garrison" fleet (mission='garrison', phase='garrison', garrison_of=1),
-- and its ships live in fleet_ships like any other fleet's. The Outpost
-- Ship sits here as cargo: it only becomes a base once dispatched and
-- actually lands (see galaxyService.ts).
INSERT INTO fleets (id, player_id, origin_base_id, mission, ox, oy, phase, garrison_of, arrive_at, leg) VALUES
    (1, 1, 1, 'garrison', 3, 3, 'garrison', 1, 0, 0);

INSERT INTO fleet_ships (fleet_id, ship_key, qty) VALUES
    (1, 'fighter', 5), (1, 'scout', 2), (1, 'colony', 1);

-- ------------------------------------------------------------
-- 7. Done — commanders, systems, planets, bases, structures and every
--    garrisoned ship above are rows in the DB, never JSON, never client state.
-- ------------------------------------------------------------



-- 1. Ensure every player's home base has a garrison fleet to hold ships in.
INSERT INTO fleets (player_id, origin_base_id, mission, ox, oy, phase, garrison_of, arrive_at, leg)
SELECT home.player_id, home.base_id, 'garrison', b.x, b.y, 'garrison', home.base_id, 0, 0
FROM (
    SELECT player_id, MIN(id) AS base_id
    FROM bases
    GROUP BY player_id
) home
JOIN bases b ON b.id = home.base_id
WHERE NOT EXISTS (
    SELECT 1 FROM fleets f WHERE f.garrison_of = home.base_id
);

-- 2. Add (or increment) one Outpost Ship in that garrison fleet.
INSERT INTO fleet_ships (fleet_id, ship_key, qty)
SELECT f.id, 'colony', 1
FROM fleets f
JOIN (
    SELECT player_id, MIN(id) AS base_id
    FROM bases
    GROUP BY player_id
) home ON home.base_id = f.garrison_of
ON DUPLICATE KEY UPDATE qty = qty + 1;
