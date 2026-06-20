-- ============================================================
-- Expense Management System — Database Schema
-- Run this against the target database. Docker Compose creates/selects the
-- MYSQL_DATABASE value before executing this file during container init.
-- ============================================================

-- ============================================================
-- USERS
-- Synced from Entra ID on first login. Role managed in-app.
-- ============================================================
CREATE TABLE users (
    id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
    entra_id        VARCHAR(36)     NOT NULL,                   -- Entra Object ID (GUID)
    email           VARCHAR(255)    NOT NULL,
    display_name    VARCHAR(255)    NOT NULL,
    role            ENUM('EMPLOYEE', 'MANAGER', 'ADMIN')
                                    NOT NULL DEFAULT 'EMPLOYEE',
    manager_id      INT UNSIGNED    NULL,                       -- FK -> users.id (cached from Graph API)
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,

    -- In-app user preferences. Identity (name/email/role/manager) stays
    -- Entra-owned; only these self-service settings live in-app.
    default_currency    CHAR(3)     NULL,                       -- preferred currency for new expenses (NULL = USD fallback)
    notify_on_submission  BOOLEAN   NOT NULL DEFAULT TRUE,      -- manager: notify when a report submits/resubmits
    notify_on_decision    BOOLEAN   NOT NULL DEFAULT TRUE,      -- submitter: notify when their expense is approved/rejected
    notify_on_comment     BOOLEAN   NOT NULL DEFAULT TRUE,      -- notify on new comments on my expenses

    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_entra_id (entra_id),
    UNIQUE KEY uk_email (email),
    KEY idx_manager_id (manager_id),
    KEY idx_role (role),

    CONSTRAINT fk_users_manager
        FOREIGN KEY (manager_id) REFERENCES users (id)
        ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================================
-- EXPENSES
-- Core business entity. version column enables optimistic
-- concurrency control in stored procedures.
-- ============================================================
CREATE TABLE expenses (
    id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
    submitted_by    INT UNSIGNED    NOT NULL,                   -- FK -> users.id
    title           VARCHAR(255)    NOT NULL,
    description     TEXT            NULL,
    amount          DECIMAL(10,2)   NOT NULL,                   -- max 99,999,999.99
    currency        CHAR(3)         NOT NULL DEFAULT 'USD',     -- ISO 4217
    category        ENUM(
                        'TRAVEL',
                        'MEALS',
                        'SUPPLIES',
                        'EQUIPMENT',
                        'SOFTWARE',
                        'TRAINING',
                        'OTHER'
                    )               NOT NULL,
    expense_date    DATE            NOT NULL,                   -- when the expense occurred
    status          ENUM('PENDING', 'APPROVED', 'REJECTED')
                                    NOT NULL DEFAULT 'PENDING',
    approved_by     INT UNSIGNED    NULL,                       -- FK -> users.id (manager/admin who acted)
    rejection_reason VARCHAR(500)   NULL,
    version         INT UNSIGNED    NOT NULL DEFAULT 1,         -- optimistic concurrency
    deleted_at      TIMESTAMP       NULL,
    deleted_by      INT UNSIGNED    NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    KEY idx_submitted_by (submitted_by),
    KEY idx_approved_by (approved_by),
    KEY idx_status (status),
    KEY idx_deleted_at (deleted_at),
    KEY idx_expense_date (expense_date),
    KEY idx_category (category),
    KEY idx_status_submitted (status, submitted_by),            -- manager queries: pending for a user
    -- Dashboard query: "my active expenses ordered by date" (Dashboard.tsx).
    -- The leftmost-prefix submitted_by lets MySQL filter by owner first,
    -- then deleted_at IS NULL, then sort by created_at without a filesort.
    KEY idx_submitter_active (submitted_by, deleted_at, created_at),

    CONSTRAINT fk_expenses_submitted_by
        FOREIGN KEY (submitted_by) REFERENCES users (id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_expenses_approved_by
        FOREIGN KEY (approved_by) REFERENCES users (id)
        ON DELETE SET NULL,
    CONSTRAINT fk_expenses_deleted_by
        FOREIGN KEY (deleted_by) REFERENCES users (id)
        ON DELETE SET NULL,
    CONSTRAINT chk_amount_positive
        CHECK (amount > 0),
    CONSTRAINT chk_rejection_reason
        CHECK (
            (status = 'REJECTED' AND rejection_reason IS NOT NULL)
            OR status != 'REJECTED'
        )
) ENGINE=InnoDB;

-- ============================================================
-- RECEIPTS
-- One expense can have multiple receipt files (Phase 8).
-- ============================================================
CREATE TABLE receipts (
    id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
    expense_id      INT UNSIGNED    NOT NULL,                   -- FK -> expenses.id
    file_name       VARCHAR(255)    NOT NULL,                   -- original upload name
    file_path       VARCHAR(500)    NOT NULL,                   -- server-side storage path
    mime_type       VARCHAR(100)    NOT NULL,                   -- e.g. image/png, application/pdf
    file_size       INT UNSIGNED    NOT NULL,                   -- bytes
    uploaded_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    KEY idx_expense_id (expense_id),

    CONSTRAINT fk_receipts_expense
        FOREIGN KEY (expense_id) REFERENCES expenses (id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- COMMENTS
-- Discussion thread on an expense. Lets submitters and approvers communicate
-- (e.g. ask for clarification, explain a rejection) instead of the prior
-- one-shot rejection_reason dead-end. Anyone who can view the expense can post.
-- ============================================================
CREATE TABLE comments (
    id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
    expense_id      INT UNSIGNED    NOT NULL,                   -- FK -> expenses.id
    author_id       INT UNSIGNED    NOT NULL,                   -- FK -> users.id
    body            VARCHAR(2000)   NOT NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    KEY idx_comments_expense (expense_id, created_at),

    CONSTRAINT fk_comments_expense
        FOREIGN KEY (expense_id) REFERENCES expenses (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_comments_author
        FOREIGN KEY (author_id) REFERENCES users (id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- NOTIFICATIONS
-- In-app notifications (no email/SMTP). Generated on expense lifecycle events
-- (approve/reject/submit/resubmit) and new comments. Read state is per-user.
-- ============================================================
CREATE TABLE notifications (
    id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
    user_id         INT UNSIGNED    NOT NULL,                   -- recipient (FK -> users.id)
    type            ENUM(
                        'EXPENSE_SUBMITTED',
                        'EXPENSE_RESUBMITTED',
                        'EXPENSE_APPROVED',
                        'EXPENSE_REJECTED',
                        'EXPENSE_COMMENT'
                    )               NOT NULL,
    expense_id      INT UNSIGNED    NULL,                       -- related expense (FK -> expenses.id)
    actor_id        INT UNSIGNED    NULL,                       -- who triggered it (FK -> users.id)
    message         VARCHAR(500)    NOT NULL,
    is_read         BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    KEY idx_notifications_recipient (user_id, is_read, created_at),

    CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_notifications_expense
        FOREIGN KEY (expense_id) REFERENCES expenses (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_notifications_actor
        FOREIGN KEY (actor_id) REFERENCES users (id)
        ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================================
-- AUDIT LOGS
-- Append-only trail. Written by stored procedures on approve/reject and by
-- application code on submit/update/delete. Note: not enforced as immutable
-- at the DB layer — for true append-only, restrict UPDATE/DELETE privileges
-- on this table for the application DB user (`REVOKE UPDATE, DELETE ON
-- audit_logs FROM expense_app@'%'`) or add a BEFORE UPDATE/DELETE trigger
-- that SIGNALs failure. The application's expenseModel.delete() preserves
-- the audit row for soft-deleted expenses; hard deletes only happen if a
-- DBA intervenes manually.
-- ============================================================
CREATE TABLE audit_logs (
    id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
    expense_id      INT UNSIGNED    NOT NULL,                   -- FK -> expenses.id
    action          ENUM('SUBMITTED', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'OVERRIDDEN', 'UPDATED', 'DELETED')
                                    NOT NULL,
    performed_by    INT UNSIGNED    NOT NULL,                   -- FK -> users.id
    old_status      ENUM('PENDING', 'APPROVED', 'REJECTED')
                                    NULL,                       -- NULL on SUBMITTED
    new_status      ENUM('PENDING', 'APPROVED', 'REJECTED')
                                    NULL,                       -- NULL on DELETED
    details         JSON            NULL,                       -- freeform metadata
    ip_address      VARCHAR(45)     NULL,                       -- IPv4 or IPv6
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    KEY idx_expense_id (expense_id),
    KEY idx_performed_by (performed_by),
    KEY idx_action (action),
    KEY idx_created_at (created_at),

    CONSTRAINT fk_audit_expense
        FOREIGN KEY (expense_id) REFERENCES expenses (id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_audit_performed_by
        FOREIGN KEY (performed_by) REFERENCES users (id)
        ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Enforce append-only audit rows at the database layer. Application users
-- should also be denied UPDATE/DELETE on this table where possible.
DROP TRIGGER IF EXISTS trg_audit_logs_no_update;
DROP TRIGGER IF EXISTS trg_audit_logs_no_delete;

DELIMITER $$

CREATE TRIGGER trg_audit_logs_no_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'audit_logs is append-only';
END$$

CREATE TRIGGER trg_audit_logs_no_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'audit_logs is append-only';
END$$

DELIMITER ;
