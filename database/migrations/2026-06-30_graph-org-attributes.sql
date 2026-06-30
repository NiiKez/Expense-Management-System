-- ============================================================
-- Migration: Microsoft Graph org attributes + Entra group memberships
-- ============================================================
-- schema.sql is the source of truth for fresh databases (and is what the
-- Docker/e2e init applies). This additive migration upgrades an EXISTING
-- database in place — run it once against a dev/prod DB created before this
-- feature. All statements are additive and non-destructive.
--
--   mysql -h <host> -u <user> -p <db> < database/migrations/2026-06-30_graph-org-attributes.sql
--
-- Identity (name/email/role/manager) stays Entra-owned. These org attributes
-- and group memberships are read-through caches refreshed from Microsoft Graph
-- on directory/profile reads, exactly like manager_id — never a source of truth.
-- ============================================================

-- Org profile attributes, $select-ed from Graph alongside the existing
-- displayName/mail on /me, /me/manager and /me/directReports.
ALTER TABLE users
    ADD COLUMN department      VARCHAR(128) NULL AFTER display_name,
    ADD COLUMN job_title       VARCHAR(128) NULL AFTER department,
    ADD COLUMN employee_id     VARCHAR(64)  NULL AFTER job_title,
    ADD COLUMN office_location VARCHAR(128) NULL AFTER employee_id,
    ADD KEY idx_users_department (department);

-- Entra security/Microsoft 365 group memberships, sourced from /me/memberOf
-- (delegated GroupMember.Read.All). Self-synced: each user's rows are refreshed
-- when that user loads their own profile. Powers cost-center display today and
-- group-based approval routing later. group_id is the Entra group Object ID.
CREATE TABLE user_groups (
    user_id    INT UNSIGNED NOT NULL,                              -- FK -> users.id
    group_id   VARCHAR(36)  NOT NULL,                              -- Entra group Object ID (GUID)
    group_name VARCHAR(256) NULL,                                  -- displayName at sync time (may be NULL)
    synced_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id, group_id),
    KEY idx_user_groups_group (group_id),

    CONSTRAINT fk_user_groups_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE
) ENGINE=InnoDB;
