-- ============================================================
-- Migration: comments, notifications, and the RESUBMITTED audit action
-- ============================================================
-- schema.sql is the source of truth for fresh databases (and is what the
-- Docker/e2e init applies). This additive migration upgrades an EXISTING
-- database in place — run it once against a dev/prod DB created before these
-- features. All statements are additive and non-destructive.
--
--   mysql -h <host> -u <user> -p <db> < database/migrations/2026-06-11_comments-notifications-resubmit.sql
-- ============================================================

-- 1) Allow the reject -> fix -> resubmit flow in the audit trail.
ALTER TABLE audit_logs
    MODIFY COLUMN action ENUM(
        'SUBMITTED', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'OVERRIDDEN', 'UPDATED', 'DELETED'
    ) NOT NULL;

-- 2) Expense comment thread.
CREATE TABLE IF NOT EXISTS comments (
    id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
    expense_id      INT UNSIGNED    NOT NULL,
    author_id       INT UNSIGNED    NOT NULL,
    body            VARCHAR(2000)   NOT NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    KEY idx_comments_expense (expense_id, created_at),

    CONSTRAINT fk_comments_expense
        FOREIGN KEY (expense_id) REFERENCES expenses (id) ON DELETE CASCADE,
    CONSTRAINT fk_comments_author
        FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 3) In-app notifications (no email).
CREATE TABLE IF NOT EXISTS notifications (
    id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
    user_id         INT UNSIGNED    NOT NULL,
    type            ENUM(
                        'EXPENSE_SUBMITTED',
                        'EXPENSE_RESUBMITTED',
                        'EXPENSE_APPROVED',
                        'EXPENSE_REJECTED',
                        'EXPENSE_COMMENT'
                    )               NOT NULL,
    expense_id      INT UNSIGNED    NULL,
    actor_id        INT UNSIGNED    NULL,
    message         VARCHAR(500)    NOT NULL,
    is_read         BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    KEY idx_notifications_recipient (user_id, is_read, created_at),

    CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_expense
        FOREIGN KEY (expense_id) REFERENCES expenses (id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_actor
        FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;
