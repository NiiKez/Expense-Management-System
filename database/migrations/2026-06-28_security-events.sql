-- ============================================================
-- Migration: durable security-event trail
-- ============================================================
-- Adds a queryable record of authentication / authorization and privileged-admin
-- events: failed logins, owner-allowlist rejections, role changes, dev stub +
-- public demo session use, and audit-log exports. These cannot live in
-- audit_logs, which requires both an expense (FK) and a known performing user
-- (FK) — a failed login has neither. schema.sql is the source of truth for fresh
-- databases; this additive, non-destructive migration upgrades an EXISTING one.
--
--   mysql -h <host> -P <port> -u <user> -p --ssl <db> < database/migrations/2026-06-28_security-events.sql
--
-- Aiven-safe: no DEFINER clauses, no SET GLOBAL, no privilege escalation.
-- ============================================================

CREATE TABLE security_events (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    event_type      VARCHAR(64)     NOT NULL,                   -- AUTH_FAILURE, ACCESS_DENIED, ROLE_CHANGED, STUB_AUTH_USED, DEMO_SESSION_ISSUED, AUDIT_LOG_EXPORTED
    outcome         ENUM('SUCCESS', 'FAILURE')
                                    NOT NULL,
    user_id         INT UNSIGNED    NULL,                       -- FK -> users.id; NULL when no resolved user (e.g. failed login)
    entra_oid       VARCHAR(36)     NULL,                       -- Entra Object ID from the token subject, when available
    role            VARCHAR(16)     NULL,                       -- resolved role at the time of the event
    ip_address      VARCHAR(45)     NULL,                       -- IPv4 or IPv6
    request_id      VARCHAR(200)    NULL,                       -- correlation id (X-Request-Id)
    detail          VARCHAR(255)    NULL,                       -- short human-readable reason; NO secrets
    metadata        JSON            NULL,                       -- freeform structured context
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    KEY idx_sec_event_type (event_type),
    KEY idx_sec_user (user_id),
    KEY idx_sec_created (created_at),

    -- SET NULL (not RESTRICT) so deleting a user — e.g. reaping an expired demo
    -- workspace — never blocks, and the security history outlives the user row.
    CONSTRAINT fk_sec_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE SET NULL
) ENGINE=InnoDB;
