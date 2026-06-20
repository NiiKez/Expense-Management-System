-- ============================================================
-- Expense Management System — Stored Procedures
-- Run this against the target database after schema.sql.
-- ============================================================

-- ============================================================
-- sp_approve_expense
-- Approves a PENDING expense with optimistic concurrency check.
-- Wraps status update + audit log insert in a transaction.
--
-- Parameters:
--   p_expense_id   — ID of the expense to approve
--   p_approved_by  — user ID of the manager/admin approving
--   p_version      — expected version (optimistic lock)
--   p_ip_address   — IP of the requester (for audit trail)
--
-- Returns:
--   result_code:
--     'SUCCESS'           — expense approved
--     'NOT_FOUND'         — expense does not exist
--     'NOT_PENDING'       — expense is not in PENDING status
--     'VERSION_CONFLICT'  — version mismatch (concurrent update)
-- ============================================================
DROP PROCEDURE IF EXISTS sp_approve_expense;

DELIMITER $$

CREATE PROCEDURE sp_approve_expense(
    IN p_expense_id   INT UNSIGNED,
    IN p_approved_by  INT UNSIGNED,
    IN p_version      INT UNSIGNED,
    IN p_ip_address   VARCHAR(45)
)
BEGIN
    DECLARE v_current_status  VARCHAR(10);
    DECLARE v_current_version INT UNSIGNED;
    DECLARE v_result          VARCHAR(20);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'An error occurred while approving the expense';
    END;

    START TRANSACTION;

    -- Lock the row for update
    SELECT status, version
    INTO v_current_status, v_current_version
    FROM expenses
    WHERE id = p_expense_id AND deleted_at IS NULL
    FOR UPDATE;

    -- Check if expense exists
    IF v_current_status IS NULL THEN
        SET v_result = 'NOT_FOUND';
        ROLLBACK;
    -- Check if expense is PENDING
    ELSEIF v_current_status != 'PENDING' THEN
        SET v_result = 'NOT_PENDING';
        ROLLBACK;
    -- Check optimistic concurrency version
    ELSEIF v_current_version != p_version THEN
        SET v_result = 'VERSION_CONFLICT';
        ROLLBACK;
    ELSE
        -- Update expense status
        UPDATE expenses
        SET status      = 'APPROVED',
            approved_by = p_approved_by,
            version     = version + 1
        WHERE id = p_expense_id;

        -- Insert audit log entry
        INSERT INTO audit_logs (expense_id, action, performed_by, old_status, new_status, details, ip_address)
        VALUES (
            p_expense_id,
            'APPROVED',
            p_approved_by,
            'PENDING',
            'APPROVED',
            JSON_OBJECT('version_before', p_version, 'version_after', p_version + 1),
            p_ip_address
        );

        SET v_result = 'SUCCESS';
        COMMIT;
    END IF;

    SELECT v_result AS result_code;
END$$

DELIMITER ;

-- ============================================================
-- sp_reject_expense
-- Rejects a PENDING expense with optimistic concurrency check.
-- Requires a rejection reason.
--
-- Parameters:
--   p_expense_id       — ID of the expense to reject
--   p_rejected_by      — user ID of the manager/admin rejecting
--   p_version          — expected version (optimistic lock)
--   p_rejection_reason — reason for rejection (required)
--   p_ip_address       — IP of the requester (for audit trail)
--
-- Returns:
--   result_code:
--     'SUCCESS'           — expense rejected
--     'NOT_FOUND'         — expense does not exist
--     'NOT_PENDING'       — expense is not in PENDING status
--     'VERSION_CONFLICT'  — version mismatch (concurrent update)
-- ============================================================
DROP PROCEDURE IF EXISTS sp_reject_expense;

DELIMITER $$

CREATE PROCEDURE sp_reject_expense(
    IN p_expense_id       INT UNSIGNED,
    IN p_rejected_by      INT UNSIGNED,
    IN p_version          INT UNSIGNED,
    IN p_rejection_reason VARCHAR(500),
    IN p_ip_address       VARCHAR(45)
)
BEGIN
    DECLARE v_current_status  VARCHAR(10);
    DECLARE v_current_version INT UNSIGNED;
    DECLARE v_result          VARCHAR(20);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'An error occurred while rejecting the expense';
    END;

    START TRANSACTION;

    -- Lock the row for update
    SELECT status, version
    INTO v_current_status, v_current_version
    FROM expenses
    WHERE id = p_expense_id AND deleted_at IS NULL
    FOR UPDATE;

    -- Check if expense exists
    IF v_current_status IS NULL THEN
        SET v_result = 'NOT_FOUND';
        ROLLBACK;
    -- Check if expense is PENDING
    ELSEIF v_current_status != 'PENDING' THEN
        SET v_result = 'NOT_PENDING';
        ROLLBACK;
    -- Check optimistic concurrency version
    ELSEIF v_current_version != p_version THEN
        SET v_result = 'VERSION_CONFLICT';
        ROLLBACK;
    ELSE
        -- Update expense status with rejection reason
        UPDATE expenses
        SET status           = 'REJECTED',
            approved_by      = p_rejected_by,
            rejection_reason = p_rejection_reason,
            version          = version + 1
        WHERE id = p_expense_id;

        -- Insert audit log entry
        INSERT INTO audit_logs (expense_id, action, performed_by, old_status, new_status, details, ip_address)
        VALUES (
            p_expense_id,
            'REJECTED',
            p_rejected_by,
            'PENDING',
            'REJECTED',
            JSON_OBJECT(
                'rejection_reason', p_rejection_reason,
                'version_before', p_version,
                'version_after', p_version + 1
            ),
            p_ip_address
        );

        SET v_result = 'SUCCESS';
        COMMIT;
    END IF;

    SELECT v_result AS result_code;
END$$

DELIMITER ;

-- ============================================================
-- sp_get_team_expenses
-- Returns all expenses submitted by direct reports of a manager.
-- Supports optional status filter and pagination.
--
-- Parameters:
--   p_manager_id  — user ID of the manager
--   p_status      — optional status filter (NULL = all statuses)
--   p_limit       — page size
--   p_offset      — offset for pagination
-- ============================================================
DROP PROCEDURE IF EXISTS sp_get_team_expenses;

DELIMITER $$

CREATE PROCEDURE sp_get_team_expenses(
    IN p_manager_id INT UNSIGNED,
    IN p_status     VARCHAR(10),
    IN p_limit      INT UNSIGNED,
    IN p_offset     INT UNSIGNED
)
BEGIN
    -- Return expenses from direct reports with optional status filter
    SELECT
        e.id,
        e.submitted_by,
        e.title,
        e.description,
        e.amount,
        e.currency,
        e.category,
        e.expense_date,
        e.status,
        e.approved_by,
        e.rejection_reason,
        e.version,
        e.created_at,
        e.updated_at,
        u.display_name AS submitter_name,
        u.email        AS submitter_email
    FROM expenses e
    INNER JOIN users u ON u.id = e.submitted_by
    WHERE u.manager_id = p_manager_id
      AND e.deleted_at IS NULL
      AND (p_status IS NULL OR e.status = p_status)
    ORDER BY e.created_at DESC
    LIMIT p_limit OFFSET p_offset;

    -- Return total count for pagination
    SELECT COUNT(*) AS total_count
    FROM expenses e
    INNER JOIN users u ON u.id = e.submitted_by
    WHERE u.manager_id = p_manager_id
      AND e.deleted_at IS NULL
      AND (p_status IS NULL OR e.status = p_status);
END$$

DELIMITER ;

-- ============================================================
-- sp_override_expense
-- Admin override: change the status of any expense regardless
-- of current status. Used for admin corrections.
--
-- Parameters:
--   p_expense_id   — ID of the expense
--   p_admin_id     — user ID of the admin performing override
--   p_new_status   — target status ('APPROVED' or 'REJECTED')
--   p_reason       — reason for override (stored in audit details)
--   p_version      — expected version (optimistic lock)
--   p_ip_address   — IP of the requester
--
-- Returns:
--   result_code:
--     'SUCCESS'           — expense overridden
--     'NOT_FOUND'         — expense does not exist
--     'SAME_STATUS'       — expense already in target status
--     'VERSION_CONFLICT'  — version mismatch
-- ============================================================
DROP PROCEDURE IF EXISTS sp_override_expense;

DELIMITER $$

CREATE PROCEDURE sp_override_expense(
    IN p_expense_id   INT UNSIGNED,
    IN p_admin_id     INT UNSIGNED,
    IN p_new_status   VARCHAR(10),
    IN p_reason       VARCHAR(500),
    IN p_version      INT UNSIGNED,
    IN p_ip_address   VARCHAR(45)
)
BEGIN
    DECLARE v_current_status  VARCHAR(10);
    DECLARE v_current_version INT UNSIGNED;
    DECLARE v_result          VARCHAR(20);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'An error occurred while overriding the expense';
    END;

    START TRANSACTION;

    SELECT status, version
    INTO v_current_status, v_current_version
    FROM expenses
    WHERE id = p_expense_id AND deleted_at IS NULL
    FOR UPDATE;

    IF v_current_status IS NULL THEN
        SET v_result = 'NOT_FOUND';
        ROLLBACK;
    ELSEIF v_current_status = p_new_status THEN
        SET v_result = 'SAME_STATUS';
        ROLLBACK;
    ELSEIF v_current_version != p_version THEN
        SET v_result = 'VERSION_CONFLICT';
        ROLLBACK;
    ELSE
        -- Update expense
        UPDATE expenses
        SET status           = p_new_status,
            approved_by      = p_admin_id,
            rejection_reason = CASE WHEN p_new_status = 'REJECTED' THEN p_reason ELSE NULL END,
            version          = version + 1
        WHERE id = p_expense_id;

        -- Insert audit log
        INSERT INTO audit_logs (expense_id, action, performed_by, old_status, new_status, details, ip_address)
        VALUES (
            p_expense_id,
            'OVERRIDDEN',
            p_admin_id,
            v_current_status,
            p_new_status,
            JSON_OBJECT(
                'reason', p_reason,
                'override_from', v_current_status,
                'override_to', p_new_status,
                'version_before', p_version,
                'version_after', p_version + 1
            ),
            p_ip_address
        );

        SET v_result = 'SUCCESS';
        COMMIT;
    END IF;

    SELECT v_result AS result_code;
END$$

DELIMITER ;

-- ============================================================
-- sp_submit_expense
-- Creates audit log entry when a new expense is submitted.
-- Called by application code after INSERT into expenses.
--
-- Parameters:
--   p_expense_id   — ID of the newly created expense
--   p_submitted_by — user ID of the submitter
--   p_ip_address   — IP of the requester
-- ============================================================
DROP PROCEDURE IF EXISTS sp_submit_expense;

DELIMITER $$

CREATE PROCEDURE sp_submit_expense(
    IN p_expense_id   INT UNSIGNED,
    IN p_submitted_by INT UNSIGNED,
    IN p_ip_address   VARCHAR(45)
)
BEGIN
    INSERT INTO audit_logs (expense_id, action, performed_by, old_status, new_status, details, ip_address)
    VALUES (
        p_expense_id,
        'SUBMITTED',
        p_submitted_by,
        NULL,
        'PENDING',
        NULL,
        p_ip_address
    );
END$$

DELIMITER ;

-- ============================================================
-- sp_delete_expense
-- Soft-deletes a PENDING expense and appends an immutable audit log.
-- Only the submitter can delete their own
-- PENDING expenses.
--
-- Parameters:
--   p_expense_id   — ID of the expense to delete
--   p_user_id      — user ID requesting deletion (must be submitter)
--   p_ip_address   — IP of the requester
--
-- Returns:
--   result_code:
--     'SUCCESS'       — expense deleted
--     'NOT_FOUND'     — expense does not exist
--     'NOT_PENDING'   — expense is not in PENDING status
--     'NOT_OWNER'     — user is not the submitter
-- ============================================================
DROP PROCEDURE IF EXISTS sp_delete_expense;

DELIMITER $$

CREATE PROCEDURE sp_delete_expense(
    IN p_expense_id INT UNSIGNED,
    IN p_user_id    INT UNSIGNED,
    IN p_ip_address VARCHAR(45)
)
BEGIN
    DECLARE v_current_status VARCHAR(10);
    DECLARE v_submitted_by   INT UNSIGNED;
    DECLARE v_title          VARCHAR(255);
    DECLARE v_amount         DECIMAL(10,2);
    DECLARE v_result         VARCHAR(20);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'An error occurred while deleting the expense';
    END;

    START TRANSACTION;

    SELECT status, submitted_by, title, amount
    INTO v_current_status, v_submitted_by, v_title, v_amount
    FROM expenses
    WHERE id = p_expense_id AND deleted_at IS NULL
    FOR UPDATE;

    IF v_current_status IS NULL THEN
        SET v_result = 'NOT_FOUND';
        ROLLBACK;
    ELSEIF v_submitted_by != p_user_id THEN
        SET v_result = 'NOT_OWNER';
        ROLLBACK;
    ELSEIF v_current_status != 'PENDING' THEN
        SET v_result = 'NOT_PENDING';
        ROLLBACK;
    ELSE
        INSERT INTO audit_logs (expense_id, action, performed_by, old_status, new_status, details, ip_address)
        VALUES (
            p_expense_id,
            'DELETED',
            p_user_id,
            'PENDING',
            NULL,
            JSON_OBJECT('title', v_title, 'amount', v_amount),
            p_ip_address
        );

        UPDATE expenses
        SET deleted_at = CURRENT_TIMESTAMP,
            deleted_by = p_user_id,
            version    = version + 1
        WHERE id = p_expense_id;

        SET v_result = 'SUCCESS';
        COMMIT;
    END IF;

    SELECT v_result AS result_code;
END$$

DELIMITER ;
