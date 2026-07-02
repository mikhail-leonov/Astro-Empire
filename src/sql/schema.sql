-- src/sql/schema.sql — Astro Empire table definitions.
--
-- FIX (was broken): this file used to open with
--   DROP DATABASE IF EXISTS ae; CREATE DATABASE ae; GRANT ALL PRIVILEGES ...;
--   FLUSH PRIVILEGES; USE ae;
-- hardcoded to a literal database named "ae", completely independent of
-- whatever name the user entered in the /setup wizard. Every fresh install
-- therefore created its tables inside "ae" (destroying any pre-existing
-- database of that name) while the app's own connection pool pointed at the
-- real chosen database, which stayed empty forever. The GRANT/FLUSH
-- statements also required privileges most setup-time DB users don't have,
-- so the script often failed outright.
--
-- Database creation is now handled entirely by ensureDatabase() in
-- src/db/index.ts, which always targets the real configured database name.
-- This file contains ONLY table definitions and is executed after that
-- database has already been created and selected.
--
-- FIX (was broken): this file also used to seed a fake "admin" user with a
-- real-looking name/email and a password hash that was not a valid bcrypt
-- hash (so it could never actually log in) — real-looking PII shipped in
-- source for no functional benefit. No user rows are created here; run the
-- app and register normally, or use src/sql/seed.sql for local dev data.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------- versioning
-- Tracks which schema version this database was last built from. Read/written
-- by ensureDatabase() in src/db/index.ts (see SCHEMA_VERSION there): on boot,
-- a database with no schema_meta row (or a version older than the running
-- code's SCHEMA_VERSION) is dropped and rebuilt from this file rather than
-- migrated in place — there are no incremental migration scripts.
CREATE TABLE IF NOT EXISTS schema_meta (
  id          TINYINT NOT NULL PRIMARY KEY,
  version     INT NOT NULL,
  applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------- accounts
CREATE TABLE IF NOT EXISTS account_tiers (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(32)  NOT NULL UNIQUE,
  name          VARCHAR(64)  NOT NULL,
  description   VARCHAR(255) NOT NULL DEFAULT '',
  max_bases     INT NOT NULL DEFAULT 3,
  max_queue     INT NOT NULL DEFAULT 1,
  sort_order    INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO account_tiers (id, code, name, description, max_bases, max_queue, sort_order) VALUES
  (1, 'free',   'Free',   'Default tier for every new commander.', 3, 1, 0),
  (2, 'bronze', 'Bronze', 'More bases and a longer build queue.',  5, 2, 1),
  (3, 'silver', 'Silver', 'Serious empire builders.',              8, 3, 2),
  (4, 'gold',   'Gold',   'Maximum bases and build throughput.',  12, 4, 3)
ON DUPLICATE KEY UPDATE code = VALUES(code);

CREATE TABLE IF NOT EXISTS users (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  username       VARCHAR(20)  NOT NULL UNIQUE,
  email          VARCHAR(255) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  role           ENUM('user','admin') NOT NULL DEFAULT 'user',
  tier_id        INT NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tier_id) REFERENCES account_tiers(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- express-mysql-session also auto-creates this table on first connect
-- (createDatabaseTable: true in src/session/store.ts); declared here too so
-- a fresh install has it immediately without waiting on that first request.
CREATE TABLE IF NOT EXISTS sessions (
  session_id  VARCHAR(128) NOT NULL PRIMARY KEY,
  expires     INT UNSIGNED NOT NULL,
  data        MEDIUMTEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------- players
CREATE TABLE IF NOT EXISTS players (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_id          INT NOT NULL UNIQUE,
  username         VARCHAR(64) NOT NULL,
  credits          DOUBLE NOT NULL DEFAULT 0,
  research_points  DOUBLE NOT NULL DEFAULT 0,
  seed             INT NOT NULL DEFAULT 0,
  last_tick        BIGINT NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS player_techs (
  player_id  INT NOT NULL,
  tech_key   VARCHAR(32) NOT NULL,
  level      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, tech_key),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS player_research (
  player_id    INT NOT NULL PRIMARY KEY,
  tech_key     VARCHAR(32) NOT NULL,
  finish_at    BIGINT NOT NULL,
  dur_seconds  DOUBLE NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS research_queue (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  player_id  INT NOT NULL,
  tech_key   VARCHAR(32) NOT NULL,
  level      INT NOT NULL,
  finished_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------- local galaxy
CREATE TABLE IF NOT EXISTS systems (
  player_id  INT NOT NULL,
  x          INT NOT NULL,
  y          INT NOT NULL,
  star       VARCHAR(8) NOT NULL,
  known      TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, x, y),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS planets (
  player_id    INT NOT NULL,
  x            INT NOT NULL,
  y            INT NOT NULL,
  slot         INT NOT NULL,
  type         VARCHAR(16) NOT NULL,
  size         INT NOT NULL,
  owner        ENUM('empty','you','pirate') NOT NULL DEFAULT 'empty',
  pirate_tier  INT NULL,
  pirate_loot  INT NULL,
  base_id      INT NULL,
  PRIMARY KEY (player_id, x, y, slot),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pirate_defense (
  player_id  INT NOT NULL,
  x          INT NOT NULL,
  y          INT NOT NULL,
  slot       INT NOT NULL,
  ship_key   VARCHAR(16) NOT NULL,
  qty        INT NOT NULL,
  PRIMARY KEY (player_id, x, y, slot, ship_key),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------- bases
CREATE TABLE IF NOT EXISTS bases (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  player_id  INT NOT NULL,
  name       VARCHAR(64) NOT NULL,
  x          INT NULL,
  y          INT NULL,
  slot       INT NULL,
  address    VARCHAR(32) NULL,
  size       INT NOT NULL DEFAULT 12,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_bases_address ON bases (address);

CREATE TABLE IF NOT EXISTS base_structures (
  base_id     INT NOT NULL,
  struct_key  VARCHAR(16) NOT NULL,
  level       INT NOT NULL DEFAULT 0,
  PRIMARY KEY (base_id, struct_key),
  FOREIGN KEY (base_id) REFERENCES bases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS base_queue (
  base_id       INT NOT NULL,
  seq           INT NOT NULL,
  kind          ENUM('struct','ship') NOT NULL,
  item_key      VARCHAR(16) NOT NULL,
  qty           INT NULL,
  unit_seconds  DOUBLE NULL,
  finish_at     BIGINT NOT NULL,
  dur_seconds   DOUBLE NOT NULL,
  PRIMARY KEY (base_id, seq),
  FOREIGN KEY (base_id) REFERENCES bases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------- fleets
CREATE TABLE IF NOT EXISTS fleets (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  player_id       INT NOT NULL,
  origin_base_id  INT NULL,
  mission         VARCHAR(24) NOT NULL,
  ox              INT NULL,
  oy              INT NULL,
  tx              INT NULL,
  ty              INT NULL,
  slot            INT NULL,
  addr            VARCHAR(32) NULL,
  astro_size      INT NULL,
  phase           VARCHAR(16) NOT NULL DEFAULT 'out',
  garrison_of     INT NULL,
  arrive_at       BIGINT NOT NULL DEFAULT 0,
  leg             DOUBLE NOT NULL DEFAULT 0,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY (origin_base_id) REFERENCES bases(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE UNIQUE INDEX idx_fleets_garrison_of ON fleets (garrison_of);

CREATE TABLE IF NOT EXISTS fleet_ships (
  fleet_id  INT NOT NULL,
  ship_key  VARCHAR(16) NOT NULL,
  qty       INT NOT NULL,
  PRIMARY KEY (fleet_id, ship_key),
  FOREIGN KEY (fleet_id) REFERENCES fleets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------- log
CREATE TABLE IF NOT EXISTS logs (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  player_id  INT NOT NULL,
  ts         BIGINT NOT NULL,
  message    VARCHAR(500) NOT NULL,
  cls        VARCHAR(16) NOT NULL DEFAULT '',
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_logs_player_ts ON logs (player_id, ts DESC);

-- ---------------------------------------------------------------- galaxy gen
CREATE TABLE IF NOT EXISTS gx_claims (
  address    VARCHAR(32) NOT NULL PRIMARY KEY,
  server     VARCHAR(4) NOT NULL,
  galaxy     INT NOT NULL,
  player_id  INT NOT NULL,
  base_id    INT NOT NULL,
  claimed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY (base_id) REFERENCES bases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS gx_systems (
  server    VARCHAR(4) NOT NULL,
  galaxy    INT NOT NULL,
  region    INT NOT NULL,
  system    INT NOT NULL,
  sx        INT NOT NULL,
  sy        INT NOT NULL,
  subx      INT NOT NULL,
  suby      INT NOT NULL,
  sun_size  VARCHAR(16) NOT NULL,
  address   VARCHAR(32) NOT NULL,
  PRIMARY KEY (server, galaxy, region, system)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_gx_systems_addr ON gx_systems (address);

CREATE TABLE IF NOT EXISTS gx_astros (
  server     VARCHAR(4) NOT NULL,
  galaxy     INT NOT NULL,
  region     INT NOT NULL,
  system     INT NOT NULL,
  orbital    INT NOT NULL,
  position   INT NOT NULL,
  kind       VARCHAR(16) NOT NULL,
  type       VARCHAR(24) NOT NULL,
  type_name  VARCHAR(32) NOT NULL,
  area       INT NOT NULL DEFAULT 0,
  solar      INT NOT NULL DEFAULT 0,
  fertility  INT NOT NULL DEFAULT 0,
  metal      INT NOT NULL DEFAULT 0,
  gas        INT NOT NULL DEFAULT 0,
  crystal    INT NOT NULL DEFAULT 0,
  size       INT NOT NULL DEFAULT 0,
  has_base   TINYINT(1) NOT NULL DEFAULT 0,
  address    VARCHAR(32) NOT NULL,
  PRIMARY KEY (server, galaxy, region, system, orbital, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE UNIQUE INDEX idx_gx_astros_addr ON gx_astros (address);

