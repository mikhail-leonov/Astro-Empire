-- ============================================================
-- Astro Empire — Full schema (MySQL 8 / MariaDB 10.4+)
-- ============================================================
-- Every piece of live game state — commanders (players), local-galaxy
-- systems/planets, bases, structures, garrisoned & in-transit fleets/ships,
-- the research queue and the event log — lives in these tables as plain
-- relational rows. No column anywhere stores JSON; anything that used to be
-- a "map" (structure levels, tech levels, garrisoned ships, pirate defense
-- fleets) or a "list" (the build queue) is its own child table instead.
--
-- Import with:
--   mysql -u root -p < src/sql/schema.sql
--   mysql -u root -p astro_empire < src/sql/galaxy.sql   (procedural Galaxy Gen tables)
-- ============================================================

DROP DATABASE IF EXISTS ae;

CREATE DATABASE ae
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

GRANT ALL PRIVILEGES ON ae.* TO 'ae'@'%';
FLUSH PRIVILEGES;


USE ae;

-- ------------------------------------------------------------
-- account_tiers — the tier levels a user account can hold (Free, Bronze,
-- Silver, Gold, ...). Admins can create/edit/delete tiers from /admin.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_tiers (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    code        VARCHAR(20)  NOT NULL UNIQUE,
    name        VARCHAR(40)  NOT NULL,
    max_bases   INT          NOT NULL DEFAULT 3,
    max_queue   INT          NOT NULL DEFAULT 1,
    description VARCHAR(255) NOT NULL DEFAULT '',
    sort_order  INT          NOT NULL DEFAULT 0
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ------------------------------------------------------------
-- users — web login accounts (register/login/account pages), each with a
-- role (user/admin) and an account tier.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    username      VARCHAR(32)  NOT NULL UNIQUE,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          ENUM('user','admin') NOT NULL DEFAULT 'user',
    tier_id       INT NOT NULL DEFAULT 1,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_tier FOREIGN KEY (tier_id) REFERENCES account_tiers(id),
    INDEX idx_username (username),
    INDEX idx_email (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- sessions — server-side session store (express-mysql-session).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    expires    INT UNSIGNED NOT NULL,
    data       MEDIUMTEXT COLLATE utf8mb4_bin,
    PRIMARY KEY (session_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ------------------------------------------------------------
-- players — one game "commander" / empire per web account.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS players (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    user_id         INT NULL UNIQUE,
    username        VARCHAR(64)  NOT NULL,
    email           VARCHAR(255) NULL,
    password_hash   VARCHAR(255) NULL,
    credits         DECIMAL(20,2) NOT NULL DEFAULT 1500.00,
    research_points DECIMAL(20,2) NOT NULL DEFAULT 0.00,
    seed            INT NOT NULL DEFAULT 0,
    last_tick       BIGINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_players_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ------------------------------------------------------------
-- player_techs — one row per researched technology level (absence = 0).
-- Replaces the old `players.techs` JSON column.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_techs (
    player_id INT NOT NULL,
    tech_key  VARCHAR(20) NOT NULL,
    level     INT NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, tech_key),
    CONSTRAINT fk_ptechs_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ------------------------------------------------------------
-- player_research — the single *active* research item, if any. Replaces the
-- old `players.active_research` JSON column; a row here means "researching",
-- no row means idle.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_research (
    player_id   INT PRIMARY KEY,
    tech_key    VARCHAR(20) NOT NULL,
    finish_at   BIGINT NOT NULL,
    dur_seconds FLOAT NOT NULL,
    CONSTRAINT fk_presearch_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ------------------------------------------------------------
-- research_queue — completed-research history (one row appended per level).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS research_queue (
    id           INT PRIMARY KEY AUTO_INCREMENT,
    player_id    INT NOT NULL,
    tech_key     VARCHAR(20) NOT NULL,
    level        INT NOT NULL,
    completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_research_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ------------------------------------------------------------
-- systems — each player's private local 6x6 galaxy grid.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS systems (
    player_id INT NOT NULL,
    x         TINYINT NOT NULL,
    y         TINYINT NOT NULL,
    star      VARCHAR(8) NOT NULL,
    known     TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, x, y),
    CONSTRAINT fk_systems_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ------------------------------------------------------------
-- planets — every planet slot inside a player's local systems.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS planets (
    player_id   INT NOT NULL,
    x           TINYINT NOT NULL,
    y           TINYINT NOT NULL,
    slot        TINYINT NOT NULL,
    type        VARCHAR(16) NOT NULL,
    size        SMALLINT NOT NULL,
    owner       ENUM('empty','you','pirate') NOT NULL DEFAULT 'empty',
    pirate_tier TINYINT NULL,
    pirate_loot INT NULL,
    base_id     INT NULL,
    PRIMARY KEY (player_id, x, y, slot),
    CONSTRAINT fk_planets_system FOREIGN KEY (player_id, x, y) REFERENCES systems(player_id, x, y) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ------------------------------------------------------------
-- pirate_defense — a pirate planet's garrison, one row per ship type.
-- Replaces the old `planets.pirate_def` JSON column.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pirate_defense (
    player_id INT NOT NULL,
    x         TINYINT NOT NULL,
    y         TINYINT NOT NULL,
    slot      TINYINT NOT NULL,
    ship_key  VARCHAR(20) NOT NULL,
    qty       INT NOT NULL,
    PRIMARY KEY (player_id, x, y, slot, ship_key),
    CONSTRAINT fk_piratedef_planet FOREIGN KEY (player_id, x, y, slot) REFERENCES planets(player_id, x, y, slot) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ------------------------------------------------------------
-- bases — a player's colonies (local, x/y/slot; or remote, on a Galaxy-Gen
-- astro via `address`). Structures and the build queue are separate child
-- tables (below); garrisoned ships live in `fleets`/`fleet_ships` (further
-- down) as each base's one "garrison" fleet — see the note there.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bases (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    player_id  INT NOT NULL,
    name       VARCHAR(64) NOT NULL,
    x          TINYINT NULL,
    y          TINYINT NULL,
    slot       TINYINT NULL,
    address    VARCHAR(28) NULL,
    size       SMALLINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_bases_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_local_base (player_id, x, y, slot),
    UNIQUE KEY uniq_remote_base (player_id, address)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

ALTER TABLE planets
  ADD CONSTRAINT fk_planets_base FOREIGN KEY (base_id) REFERENCES bases(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- base_structures — one row per built structure level at a base.
-- Replaces the old `bases.structures` JSON column.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS base_structures (
    base_id    INT NOT NULL,
    struct_key VARCHAR(20) NOT NULL,
    level      INT NOT NULL DEFAULT 0,
    PRIMARY KEY (base_id, struct_key),
    CONSTRAINT fk_bstruct_base FOREIGN KEY (base_id) REFERENCES bases(id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ------------------------------------------------------------
-- base_queue — the ordered build queue at a base (structures and ships).
-- Replaces the old `bases.queue` JSON array column; order is `seq`.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS base_queue (
    id           INT PRIMARY KEY AUTO_INCREMENT,
    base_id      INT NOT NULL,
    seq          INT NOT NULL,
    kind         ENUM('struct','ship') NOT NULL,
    item_key     VARCHAR(20) NOT NULL,
    qty          INT NULL,
    unit_seconds FLOAT NULL,
    finish_at    BIGINT NOT NULL,
    dur_seconds  FLOAT NOT NULL,
    CONSTRAINT fk_bqueue_base FOREIGN KEY (base_id) REFERENCES bases(id) ON DELETE CASCADE,
    INDEX idx_bqueue_base_seq (base_id, seq)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ------------------------------------------------------------
-- fleets — ships currently in transit. Ships carried are in `fleet_ships`
-- (below) instead of a JSON column.
-- ------------------------------------------------------------
-- ------------------------------------------------------------
-- fleets — every group of ships a commander owns: either "in transit"
-- (mission attack/colonize/probe/return/colonize-remote, phase out/back)
-- or permanently stationed at a base as its garrison (mission='garrison',
-- phase='garrison'). There is no separate "ships sitting at a base" table —
-- every ship, whether flying or docked, belongs to exactly one fleets row
-- and is listed in fleet_ships (below). `garrison_of` is set to a base's id
-- only on that base's one garrison fleet (NULL for every other fleet), and
-- the unique key guarantees a base can never end up with two garrisons.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fleets (
    id             INT PRIMARY KEY AUTO_INCREMENT,
    player_id      INT NOT NULL,
    origin_base_id INT NULL,
    mission        VARCHAR(20) NOT NULL,
    ox TINYINT NULL, oy TINYINT NULL,
    tx TINYINT NULL, ty TINYINT NULL, slot TINYINT NULL,
    addr           VARCHAR(28) NULL,
    astro_size     SMALLINT NULL,
    phase          VARCHAR(10) NOT NULL DEFAULT 'out',
    garrison_of    INT NULL,
    arrive_at      BIGINT NOT NULL,
    leg            FLOAT NOT NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_fleets_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    CONSTRAINT fk_fleets_base FOREIGN KEY (origin_base_id) REFERENCES bases(id) ON DELETE SET NULL,
    CONSTRAINT fk_fleets_garrison_base FOREIGN KEY (garrison_of) REFERENCES bases(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_garrison_per_base (garrison_of)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ------------------------------------------------------------
-- fleet_ships — ships carried by an in-transit fleet.
-- Replaces the old `fleets.ships` JSON column.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fleet_ships (
    fleet_id INT NOT NULL,
    ship_key VARCHAR(20) NOT NULL,
    qty      INT NOT NULL,
    PRIMARY KEY (fleet_id, ship_key),
    CONSTRAINT fk_fships_fleet FOREIGN KEY (fleet_id) REFERENCES fleets(id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ------------------------------------------------------------
-- logs — the in-game event log, one row per event.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS logs (
    id        INT PRIMARY KEY AUTO_INCREMENT,
    player_id INT NOT NULL,
    ts        BIGINT NOT NULL,
    message   VARCHAR(255) NOT NULL,
    cls       VARCHAR(10) NOT NULL DEFAULT '',
    CONSTRAINT fk_logs_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    INDEX idx_logs_player_ts (player_id, ts DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ------------------------------------------------------------
-- gx_claims — global registry of which Galaxy-Gen astros are colonized.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gx_claims (
    server     CHAR(1)     NOT NULL,
    galaxy     SMALLINT    NOT NULL,
    address    VARCHAR(28) NOT NULL,
    player_id  INT NOT NULL,
    base_id    INT NOT NULL,
    claimed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (address),
    INDEX idx_gxclaims_galaxy (server, galaxy),
    CONSTRAINT fk_gxclaims_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    CONSTRAINT fk_gxclaims_base FOREIGN KEY (base_id) REFERENCES bases(id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ------------------------------------------------------------
-- Seed the default account tiers (idempotent).
-- ------------------------------------------------------------
INSERT INTO account_tiers (id, code, name, max_bases, max_queue, description, sort_order) VALUES
    (1, 'free',   'Free',   3, 1, 'Default tier for every new account.', 1),
    (2, 'bronze', 'Bronze', 5, 2, 'A few more bases and a second build slot.', 2),
    (3, 'silver', 'Silver', 8, 3, 'Serious commanders: more bases, faster queues.', 3),
    (4, 'gold',   'Gold',   15, 5, 'Top tier: maximum bases and build throughput.', 4)
ON DUPLICATE KEY UPDATE name = VALUES(name), max_bases = VALUES(max_bases),
    max_queue = VALUES(max_queue), description = VALUES(description), sort_order = VALUES(sort_order);


-- One row per occupied system slot (a star).
CREATE TABLE IF NOT EXISTS gx_systems (
    server    CHAR(1)     NOT NULL,                -- galaxy prefix (A,B,C,…)
    galaxy    SMALLINT    NOT NULL,                -- galaxy number (1..99)
    region    SMALLINT    NOT NULL,                -- region index across the galaxy
    `system`  SMALLINT    NOT NULL,                -- system slot 1..100 within the region
    sx        TINYINT     NOT NULL,                -- region column (1..size)
    sy        TINYINT     NOT NULL,                -- region row (1..size)
    subx      TINYINT     NOT NULL,                -- sub-cell column (0..9)
    suby      TINYINT     NOT NULL,                -- sub-cell row (0..9)
    sun_size  VARCHAR(10) NOT NULL,                -- small/medium/big/huge
    address   VARCHAR(24) NOT NULL,                -- e.g. B01:07:33
    PRIMARY KEY (server, galaxy, region, `system`),
    INDEX idx_region (server, galaxy, region),
    INDEX idx_xy (server, galaxy, sx, sy)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per astro (planet / moon / asteroid / gas giant) in a system.
CREATE TABLE IF NOT EXISTS gx_astros (
    server    CHAR(1)     NOT NULL,
    galaxy    SMALLINT    NOT NULL,
    region    SMALLINT    NOT NULL,
    `system`  SMALLINT    NOT NULL,
    orbital   TINYINT     NOT NULL,
    position  TINYINT     NOT NULL,
    kind      VARCHAR(10) NOT NULL,                -- planet/moon/asteroid/gas
    type      VARCHAR(16) NOT NULL,                -- rocky/gaia/asteroid/… ('gas' for gas giants)
    type_name VARCHAR(24) NOT NULL,
    area      SMALLINT    NOT NULL DEFAULT 0,
    solar     TINYINT     NOT NULL DEFAULT 0,
    fertility TINYINT     NOT NULL DEFAULT 0,
    metal     TINYINT     NOT NULL DEFAULT 0,
    gas       TINYINT     NOT NULL DEFAULT 0,
    crystal   TINYINT     NOT NULL DEFAULT 0,
    size      INT         NOT NULL DEFAULT 0,
    has_base  TINYINT     NOT NULL DEFAULT 0,
    address   VARCHAR(28) NOT NULL,                -- e.g. B01:07:33:45
    PRIMARY KEY (server, galaxy, region, `system`, orbital, position),
    INDEX idx_sys (server, galaxy, region, `system`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;




-- ------------------------------------------------------------
-- 1. Web accounts
--    admin / password   — role=admin, Gold tier, can manage tiers & users
--    test  / password   — role=user,  Free tier, owns the commander below
-- ------------------------------------------------------------
INSERT INTO users (id, username, email, password_hash, role, tier_id) VALUES
    (1, 'Cruzaderx2', 'mikecommon@gmail.com', '1bbd886460827015e5d605ed44252251', 'admin', 4);



-- ------------------------------------------------------------
-- 2. Test commander (player_id = 1), owned by user 'test' (id 2)
--    Starts with 100,000,000 credits, same as any freshly Generated galaxy.
-- ------------------------------------------------------------
INSERT INTO players (id, user_id, username, email, password_hash, credits, research_points, seed, last_tick, created_at) VALUES
    (1, 1, 'Cruzaderx2', 'mikecommon@gmail.com', '1bbd886460827015e5d605ed44252251', 100000000.00, 0.00, 12345, UNIX_TIMESTAMP() * 1000, NOW());

