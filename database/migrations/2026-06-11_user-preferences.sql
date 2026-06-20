-- ============================================================
-- Migration: in-app user preferences (settings page)
-- ============================================================
-- schema.sql is the source of truth for fresh databases (and is what the
-- Docker/e2e init applies). This additive migration upgrades an EXISTING
-- database in place — run it once against a dev/prod DB created before this
-- feature. All statements are additive and non-destructive.
--
--   mysql -h <host> -u <user> -p <db> < database/migrations/2026-06-11_user-preferences.sql
--
-- Identity (name/email/role/manager) remains Entra-owned; only these
-- self-service settings live in-app.
-- ============================================================

ALTER TABLE users
    ADD COLUMN default_currency     CHAR(3)  NULL                AFTER is_active,
    ADD COLUMN notify_on_submission BOOLEAN  NOT NULL DEFAULT TRUE AFTER default_currency,
    ADD COLUMN notify_on_decision   BOOLEAN  NOT NULL DEFAULT TRUE AFTER notify_on_submission,
    ADD COLUMN notify_on_comment    BOOLEAN  NOT NULL DEFAULT TRUE AFTER notify_on_decision;
