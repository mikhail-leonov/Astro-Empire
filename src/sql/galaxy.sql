-- ============================================================
-- Astro Empire – Generated galaxy tables
-- Populated by the Galaxy Gen feature (POST /api/galaxy/generate).
-- These are dedicated tables so "Generate" can safely clear them
-- (TRUNCATE) without touching players / bases / fleets.
-- Run after schema.sql:  mysql astro_empire < src/sql/galaxy.sql
-- ============================================================

USE astro_empire;

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
