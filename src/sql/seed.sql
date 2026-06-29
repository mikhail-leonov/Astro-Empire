-- ============================================================
-- Astro Empire – Seed Data (with Alien Bases)
-- ============================================================
-- This seed creates a 6x6 galaxy, a test player ("test" / "password"),
-- a home base, and numerous pirate/alien outposts for testing.
-- ============================================================

-- Disable FK checks for clean truncation
SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE logs;
TRUNCATE TABLE research_queue;
TRUNCATE TABLE fleets;
TRUNCATE TABLE bases;
TRUNCATE TABLE planets;
TRUNCATE TABLE systems;
TRUNCATE TABLE players;

SET FOREIGN_KEY_CHECKS = 1;

-- ------------------------------------------------------------
-- 1. Test player account
--    username: test
--    password: password (bcrypt hash)
--    seed: 12345 (deterministic galaxy generation)
-- ------------------------------------------------------------
INSERT INTO players (
    id, username, email, password_hash, credits, research_points, techs, seed, created_at 
) VALUES (
    1, 'test', 'test@example.com', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 1500.00, 0.00, '{"energy":0,"computer":0,"laser":0,"plasma":0,"shield":0,"armour":0,"warp":0,"astro":0,"ai":0}', 12345, NOW() 
);

-- ------------------------------------------------------------
-- 2. Galaxy systems (6×6 grid)
--    Star types: ⭐ 🌟 ✨ 🔆
-- ------------------------------------------------------------
INSERT INTO systems (x, y, star) VALUES
(1,1,'⭐'),(1,2,'🌟'),(1,3,'✨'),(1,4,'🔆'),(1,5,'⭐'),(1,6,'🌟'),
(2,1,'🌟'),(2,2,'✨'),(2,3,'🔆'),(2,4,'⭐'),(2,5,'🌟'),(2,6,'✨'),
(3,1,'✨'),(3,2,'🔆'),(3,3,'⭐'),(3,4,'🌟'),(3,5,'✨'),(3,6,'🔆'),
(4,1,'🔆'),(4,2,'⭐'),(4,3,'🌟'),(4,4,'✨'),(4,5,'🔆'),(4,6,'⭐'),
(5,1,'🌟'),(5,2,'✨'),(5,3,'🔆'),(5,4,'⭐'),(5,5,'🌟'),(5,6,'✨'),
(6,1,'✨'),(6,2,'🔆'),(6,3,'⭐'),(6,4,'🌟'),(6,5,'✨'),(6,6,'🔆');

-- ------------------------------------------------------------
-- 3. Planets per system (including alien/pirate bases)
--    Each system has 3–5 planets.
--    Alien bases are marked is_pirate=1 with tier, loot, and def.
-- ------------------------------------------------------------

-- System (1,1): 3 planets
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(1,1,1,'arid',85,0,0,0,NULL),
(1,1,2,'gas',10,0,0,0,NULL),
(1,1,3,'asteroid',65,0,0,0,NULL);

-- System (1,2): 4 planets – ADD Alien base (slot 1)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(1,2,1,'terran',90,1,2,1500,'{"fighter":12,"corvette":4}'),
(1,2,2,'ocean',80,0,0,0,NULL),
(1,2,3,'gas',12,0,0,0,NULL),
(1,2,4,'barren',50,0,0,0,NULL);

-- System (1,3): 4 planets – existing pirate (slot 2)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(1,3,1,'desert',85,0,0,0,NULL),
(1,3,2,'tundra',80,1,2,1200,'{"fighter":12,"corvette":4}'),
(1,3,3,'asteroid',60,0,0,0,NULL),
(1,3,4,'gas',9,0,0,0,NULL);

-- System (1,4): 3 planets – ADD Alien base (slot 1)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(1,4,1,'crystalline',75,1,3,2500,'{"fighter":20,"corvette":6,"frigate":2}'),
(1,4,2,'magma',80,0,0,0,NULL),
(1,4,3,'barren',45,0,0,0,NULL);

-- System (1,5): 5 planets – ADD Alien base (slot 3)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(1,5,1,'metallic',85,0,0,0,NULL),
(1,5,2,'gas',11,0,0,0,NULL),
(1,5,3,'terran',88,1,4,3800,'{"fighter":30,"corvette":10,"frigate":3,"destroyer":1}'),
(1,5,4,'ocean',78,0,0,0,NULL),
(1,5,5,'asteroid',62,0,0,0,NULL);

-- System (1,6): 3 planets
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(1,6,1,'rocky',85,0,0,0,NULL),
(1,6,2,'gas',10,0,0,0,NULL),
(1,6,3,'barren',40,0,0,0,NULL);

-- System (2,1): 4 planets – ADD Alien base (slot 1)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(2,1,1,'tundra',90,1,2,1600,'{"fighter":10,"corvette":5}'),
(2,1,2,'asteroid',68,0,0,0,NULL),
(2,1,3,'gas',11,0,0,0,NULL),
(2,1,4,'desert',82,0,0,0,NULL);

-- System (2,2): 4 planets – existing pirate (slot 3)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(2,2,1,'gaia',88,0,0,0,NULL),
(2,2,2,'ocean',76,0,0,0,NULL),
(2,2,3,'crater',85,1,3,2500,'{"fighter":20,"corvette":6,"frigate":2}'),
(2,2,4,'gas',12,0,0,0,NULL);

-- System (2,3): 3 planets – ADD Alien base (slot 1)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(2,3,1,'radioactive',90,1,3,2200,'{"fighter":18,"corvette":5,"frigate":1}'),
(2,3,2,'barren',45,0,0,0,NULL),
(2,3,3,'gas',9,0,0,0,NULL);

-- System (2,4): 4 planets
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(2,4,1,'toxic',88,0,0,0,NULL),
(2,4,2,'terran',84,0,0,0,NULL),
(2,4,3,'asteroid',60,0,0,0,NULL),
(2,4,4,'gas',10,0,0,0,NULL);

-- System (2,5): 5 planets – existing pirate (slot 5)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(2,5,1,'arid',92,0,0,0,NULL),
(2,5,2,'ocean',74,0,0,0,NULL),
(2,5,3,'gas',13,0,0,0,NULL),
(2,5,4,'barren',48,0,0,0,NULL),
(2,5,5,'metallic',80,1,4,3800,'{"fighter":30,"corvette":10,"frigate":4,"destroyer":1}');

-- System (2,6): 3 planets – ADD Alien base (slot 1)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(2,6,1,'jungle',82,1,1,900,'{"fighter":8,"corvette":2}'),
(2,6,2,'asteroid',65,0,0,0,NULL),
(2,6,3,'gas',11,0,0,0,NULL);

-- System (3,1): 4 planets – ADD Alien base (slot 1)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(3,1,1,'rocky',86,1,5,5500,'{"fighter":45,"corvette":15,"frigate":6,"destroyer":3,"cruiser":1}'),
(3,1,2,'ocean',72,0,0,0,NULL),
(3,1,3,'barren',42,0,0,0,NULL),
(3,1,4,'gas',12,0,0,0,NULL);

-- System (3,2): 4 planets – existing pirate (slot 2)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(3,2,1,'terran',92,0,0,0,NULL),
(3,2,2,'crater',80,1,5,5000,'{"fighter":40,"corvette":12,"frigate":5,"destroyer":2,"cruiser":1}'),
(3,2,3,'gas',9,0,0,0,NULL),
(3,2,4,'asteroid',55,0,0,0,NULL);

-- System (3,3) – HOME SYSTEM for test player
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(3,3,1,'terran',16,0,0,0,NULL),   -- home base
(3,3,2,'ocean',14,0,0,0,NULL),
(3,3,3,'gas',10,0,0,0,NULL),
(3,3,4,'barren',5,0,0,0,NULL);

-- System (3,4): 3 planets – ADD Alien base (slot 1)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(3,4,1,'toxic',88,1,2,1700,'{"fighter":14,"corvette":4}'),
(3,4,2,'asteroid',60,0,0,0,NULL),
(3,4,3,'gas',11,0,0,0,NULL);

-- System (3,5): 4 planets
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(3,5,1,'metallic',84,0,0,0,NULL),
(3,5,2,'ocean',78,0,0,0,NULL),
(3,5,3,'barren',44,0,0,0,NULL),
(3,5,4,'gas',10,0,0,0,NULL);

-- System (3,6): 4 planets – existing pirate (slot 3)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(3,6,1,'radioactive',90,0,0,0,NULL),
(3,6,2,'terran',86,0,0,0,NULL),
(3,6,3,'crater',82,1,1,800,'{"fighter":8,"corvette":2}'),
(3,6,4,'gas',12,0,0,0,NULL);

-- System (4,1): 4 planets – ADD Alien base (slot 1)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(4,1,1,'gaia',90,1,3,2800,'{"fighter":22,"corvette":7,"frigate":2}'),
(4,1,2,'asteroid',62,0,0,0,NULL),
(4,1,3,'ocean',74,0,0,0,NULL),
(4,1,4,'gas',11,0,0,0,NULL);

-- System (4,2): 3 planets – existing pirate (slot 1)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(4,2,1,'volcanic',80,1,3,2200,'{"fighter":15,"corvette":5,"frigate":1}'),
(4,2,2,'barren',42,0,0,0,NULL),
(4,2,3,'gas',9,0,0,0,NULL);

-- System (4,3): 4 planets – ADD Alien base (slot 1)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(4,3,1,'arid',92,1,4,3600,'{"fighter":28,"corvette":9,"frigate":3,"destroyer":1}'),
(4,3,2,'desert',84,0,0,0,NULL),
(4,3,3,'asteroid',60,0,0,0,NULL),
(4,3,4,'gas',12,0,0,0,NULL);

-- System (4,4): 5 planets
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(4,4,1,'crystalline',72,0,0,0,NULL),
(4,4,2,'ocean',76,0,0,0,NULL),
(4,4,3,'barren',40,0,0,0,NULL),
(4,4,4,'gas',11,0,0,0,NULL),
(4,4,5,'terran',88,0,0,0,NULL);

-- System (4,5): 3 planets
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(4,5,1,'metallic',86,0,0,0,NULL),
(4,5,2,'gas',10,0,0,0,NULL),
(4,5,3,'asteroid',58,0,0,0,NULL);

-- System (4,6): 4 planets – existing pirate (slot 4)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(4,6,1,'tundra',90,0,0,0,NULL),
(4,6,2,'ocean',72,0,0,0,NULL),
(4,6,3,'gas',13,0,0,0,NULL),
(4,6,4,'magma',78,1,2,1500,'{"fighter":10,"corvette":3,"frigate":1}');

-- System (5,1): 3 planets – ADD Alien base (slot 1)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(5,1,1,'rocky',88,1,2,1800,'{"fighter":12,"corvette":5}'),
(5,1,2,'barren',42,0,0,0,NULL),
(5,1,3,'gas',11,0,0,0,NULL);

-- System (5,2): 4 planets
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(5,2,1,'toxic',86,0,0,0,NULL),
(5,2,2,'asteroid',62,0,0,0,NULL),
(5,2,3,'terran',80,0,0,0,NULL),
(5,2,4,'gas',12,0,0,0,NULL);

-- System (5,3): 4 planets
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(5,3,1,'crystalline',74,0,0,0,NULL),
(5,3,2,'ocean',76,0,0,0,NULL),
(5,3,3,'barren',40,0,0,0,NULL),
(5,3,4,'gas',9,0,0,0,NULL);

-- System (5,4): 5 planets – existing pirate (slot 5)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(5,4,1,'arid',90,0,0,0,NULL),
(5,4,2,'desert',84,0,0,0,NULL),
(5,4,3,'asteroid',60,0,0,0,NULL),
(5,4,4,'gas',13,0,0,0,NULL),
(5,4,5,'metallic',82,1,3,3000,'{"fighter":18,"corvette":6,"frigate":2,"destroyer":1}');

-- System (5,5): 3 planets – ADD Alien base (slot 1)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(5,5,1,'radioactive',88,1,5,6000,'{"fighter":50,"corvette":18,"frigate":7,"destroyer":4,"cruiser":2}'),
(5,5,2,'gas',10,0,0,0,NULL),
(5,5,3,'barren',44,0,0,0,NULL);

-- System (5,6): 4 planets
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(5,6,1,'terran',82,0,0,0,NULL),
(5,6,2,'ocean',70,0,0,0,NULL),
(5,6,3,'gas',11,0,0,0,NULL),
(5,6,4,'asteroid',55,0,0,0,NULL);

-- System (6,1): 4 planets – ADD Alien base (slot 1)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(6,1,1,'rocky',84,1,3,2400,'{"fighter":20,"corvette":6,"frigate":2}'),
(6,1,2,'barren',38,0,0,0,NULL),
(6,1,3,'gas',12,0,0,0,NULL),
(6,1,4,'desert',80,0,0,0,NULL);

-- System (6,2): 3 planets – existing pirate (slot 3)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(6,2,1,'gaia',86,0,0,0,NULL),
(6,2,2,'ocean',74,0,0,0,NULL),
(6,2,3,'crater',78,1,4,3500,'{"fighter":25,"corvette":8,"frigate":3,"destroyer":2}');

-- System (6,3): 4 planets
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(6,3,1,'metallic',82,0,0,0,NULL),
(6,3,2,'gas',10,0,0,0,NULL),
(6,3,3,'asteroid',58,0,0,0,NULL),
(6,3,4,'terran',84,0,0,0,NULL);

-- System (6,4): 4 planets – ADD Alien base (slot 1)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(6,4,1,'crystalline',70,1,4,3400,'{"fighter":26,"corvette":8,"frigate":3,"destroyer":1}'),
(6,4,2,'barren',42,0,0,0,NULL),
(6,4,3,'gas',11,0,0,0,NULL),
(6,4,4,'ocean',72,0,0,0,NULL);

-- System (6,5): 3 planets
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(6,5,1,'radioactive',88,0,0,0,NULL),
(6,5,2,'asteroid',60,0,0,0,NULL),
(6,5,3,'gas',10,0,0,0,NULL);

-- System (6,6): 4 planets – existing pirate (slot 2)
INSERT INTO planets (x, y, slot, type, size, is_pirate, pirate_tier, pirate_loot, pirate_def)
VALUES
(6,6,1,'arid',90,0,0,0,NULL),
(6,6,2,'magma',80,1,2,1100,'{"fighter":9,"corvette":3}'),
(6,6,3,'gas',12,0,0,0,NULL),
(6,6,4,'barren',40,0,0,0,NULL);

-- ------------------------------------------------------------
-- 4. Home base for test player at (3,3):1
-- ------------------------------------------------------------
UPDATE planets
SET owner_player_id = 1,
    is_pirate = 0
WHERE x = 3 AND y = 3 AND slot = 1;

INSERT INTO bases (
    id, player_id, name, x, y, slot, size, structures, fleet, queue, created_at 
) VALUES (
    1, 1, 'Homeworld', 3, 3, 1, 16, '{"solar":5,"metro":3,"lab":2,"robotic":2,"shipyard":1,"spaceport":1}', '{"fighter":5,"scout":2}', '[]', NOW()
);

UPDATE planets SET base_id = 1 WHERE x = 3 AND y = 3 AND slot = 1;

-- ------------------------------------------------------------
-- 5. Done
-- ------------------------------------------------------------