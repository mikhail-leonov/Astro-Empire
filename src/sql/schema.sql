-- ============================================================
-- Astro Empire — Authentication schema (MySQL 8 / MariaDB 10.4+)
-- ============================================================
-- Import with:
--   mysql -u root -p < src/sql/schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS astro_empire
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE astro_empire;

-- ------------------------------------------------------------
-- users — one row per account
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    username      VARCHAR(32)  NOT NULL UNIQUE,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,            -- bcrypt hash
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_email (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- sessions — server-side session store (express-mysql-session)
-- The app can auto-create this table, but it is included here so a
-- locked-down DB user without CREATE rights still works.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    expires    INT UNSIGNED NOT NULL,
    data       MEDIUMTEXT COLLATE utf8mb4_bin,
    PRIMARY KEY (session_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
