-- ============================================================
-- Migration: Public demo sandbox mode
-- ============================================================
-- Adds ephemeral, per-session demo workspaces. Additive and non-destructive.
-- Apply on top of an existing database; a fresh install already gets these
-- changes from schema.sql.
--
--   mysql -h <host> -P <port> -u <user> -p --ssl <db> < database/migrations/2026-06-27_demo-sandbox.sql
--
-- Aiven-safe: no DEFINER clauses, no SET GLOBAL, no privilege escalation.
-- ============================================================

-- 1) Mark demo users and stamp each ephemeral workspace with an expiry.
--    demo_session_id groups the manager + seeded employees of one workspace.
ALTER TABLE users
    ADD COLUMN is_demo          BOOLEAN      NOT NULL DEFAULT FALSE  AFTER is_active,
    ADD COLUMN demo_expires_at  TIMESTAMP    NULL                    AFTER is_demo,
    ADD COLUMN demo_session_id  VARCHAR(36)  NULL                    AFTER demo_expires_at,
    ADD KEY idx_demo (is_demo, demo_expires_at),
    ADD KEY idx_demo_session (demo_session_id);

-- 2) Make the audit-log delete guard demo-aware so expired demo workspaces can
--    be reaped. Real activity stays append-only; only rows whose performer is an
--    ephemeral demo user may be deleted (always alongside their demo expenses).
DROP TRIGGER IF EXISTS trg_audit_logs_no_delete;

DELIMITER $$

CREATE TRIGGER trg_audit_logs_no_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM users WHERE id = OLD.performed_by AND is_demo = TRUE
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'audit_logs is append-only';
    END IF;
END$$

DELIMITER ;
