-- ============================================================
-- Expense Management System - Sample Seed Data
-- Development/demo data only. Do not load this into production.
-- Run this against the target database after schema.sql and
-- stored-procedures.sql. docker-compose.yml does not load it by default.
-- ============================================================

START TRANSACTION;

-- Insert sample users only into an empty users table.
INSERT INTO users (id, entra_id, email, display_name, role, manager_id)
SELECT *
FROM (
    SELECT 1 AS id, '00000000-0000-0000-0000-000000000001' AS entra_id, 'admin@contoso.com' AS email, 'Alice Admin' AS display_name, 'ADMIN' AS role, NULL AS manager_id
    UNION ALL SELECT 2, '00000000-0000-0000-0000-000000000002', 'manager.bob@contoso.com', 'Bob Manager', 'MANAGER', 1
    UNION ALL SELECT 3, '00000000-0000-0000-0000-000000000003', 'manager.carol@contoso.com', 'Carol Manager', 'MANAGER', 1
    UNION ALL SELECT 4, '00000000-0000-0000-0000-000000000004', 'dave@contoso.com', 'Dave Employee', 'EMPLOYEE', 2
    UNION ALL SELECT 5, '00000000-0000-0000-0000-000000000005', 'eve@contoso.com', 'Eve Employee', 'EMPLOYEE', 2
    UNION ALL SELECT 6, '00000000-0000-0000-0000-000000000006', 'frank@contoso.com', 'Frank Employee', 'EMPLOYEE', 3
    UNION ALL SELECT 7, '00000000-0000-0000-0000-000000000007', 'grace@contoso.com', 'Grace Employee', 'EMPLOYEE', 3
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM users);

-- Insert sample expenses only into an empty expenses table.
INSERT INTO expenses (id, submitted_by, title, description, amount, currency, category, expense_date, status, approved_by, rejection_reason, version)
SELECT *
FROM (
    SELECT 1 AS id, 4 AS submitted_by, 'Flight to NYC' AS title, 'Round-trip flight for client meeting' AS description, 450.00 AS amount, 'USD' AS currency, 'TRAVEL' AS category, '2026-03-10' AS expense_date, 'PENDING' AS status, NULL AS approved_by, NULL AS rejection_reason, 1 AS version
    UNION ALL SELECT 2, 4, 'Team lunch', 'Quarterly team lunch at downtown restaurant', 125.50, 'USD', 'MEALS', '2026-03-05', 'APPROVED', 2, NULL, 2
    UNION ALL SELECT 3, 5, 'Personal keyboard', 'Mechanical keyboard for home office', 299.99, 'USD', 'EQUIPMENT', '2026-03-08', 'REJECTED', 2, 'Equipment purchases over $200 require pre-approval from IT', 2
    UNION ALL SELECT 4, 6, 'AWS training course', 'Online AWS Solutions Architect course', 350.00, 'USD', 'TRAINING', '2026-03-12', 'PENDING', NULL, NULL, 1
    UNION ALL SELECT 5, 7, 'Office supplies', 'Notebooks, pens, and sticky notes', 45.75, 'USD', 'SUPPLIES', '2026-03-01', 'APPROVED', 3, NULL, 2
    UNION ALL SELECT 6, 5, 'JetBrains license', 'Annual IntelliJ IDEA subscription', 199.00, 'USD', 'SOFTWARE', '2026-03-15', 'PENDING', NULL, NULL, 1
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM expenses);

-- Insert matching sample audit rows only into an empty audit table.
INSERT INTO audit_logs (expense_id, action, performed_by, old_status, new_status, details, ip_address)
SELECT *
FROM (
    SELECT 1 AS expense_id, 'SUBMITTED' AS action, 4 AS performed_by, NULL AS old_status, 'PENDING' AS new_status, NULL AS details, '192.0.2.10' AS ip_address
    UNION ALL SELECT 2, 'SUBMITTED', 4, NULL, 'PENDING', NULL, '192.0.2.10'
    UNION ALL SELECT 2, 'APPROVED', 2, 'PENDING', 'APPROVED', JSON_OBJECT('version_before', 1, 'version_after', 2), '192.0.2.20'
    UNION ALL SELECT 3, 'SUBMITTED', 5, NULL, 'PENDING', NULL, '192.0.2.11'
    UNION ALL SELECT 3, 'REJECTED', 2, 'PENDING', 'REJECTED', JSON_OBJECT('rejection_reason', 'Equipment purchases over $200 require pre-approval from IT', 'version_before', 1, 'version_after', 2), '192.0.2.20'
    UNION ALL SELECT 4, 'SUBMITTED', 6, NULL, 'PENDING', NULL, '192.0.2.12'
    UNION ALL SELECT 5, 'SUBMITTED', 7, NULL, 'PENDING', NULL, '192.0.2.13'
    UNION ALL SELECT 5, 'APPROVED', 3, 'PENDING', 'APPROVED', JSON_OBJECT('version_before', 1, 'version_after', 2), '192.0.2.21'
    UNION ALL SELECT 6, 'SUBMITTED', 5, NULL, 'PENDING', NULL, '192.0.2.11'
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM audit_logs);

COMMIT;
