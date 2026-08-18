-- ============================================================
-- Pro Fix — Desktop (offline-first, SQLite)
-- Migration 001: full schema
-- แปลจาก docs/PHASE2_Database_Design.md (ต้นฉบับออกแบบไว้สำหรับ PostgreSQL)
-- คำแปลงหลักจาก Postgres -> SQLite:
--   UUID          -> TEXT   (แอปสร้างค่าเองด้วย crypto.randomUUID() ก่อน insert)
--   TIMESTAMP     -> TEXT   (ISO 8601, DEFAULT (datetime('now')))
--   BOOLEAN       -> INTEGER (0/1)
--   BIGINT/SMALLINT -> INTEGER (SQLite INTEGER เป็น 8-byte เพียงพอสำหรับกีบ)
--   JSONB         -> TEXT
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- 0. Core / System
-- ------------------------------------------------------------
CREATE TABLE branches (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    address     TEXT,
    phone       TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE languages (
    code        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_languages_single_default ON languages (is_default) WHERE is_default = 1;

CREATE TABLE roles (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE role_translations (
    role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    lang_code   TEXT NOT NULL REFERENCES languages(code),
    name        TEXT NOT NULL,
    PRIMARY KEY (role_id, lang_code)
);

CREATE TABLE permissions (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE role_permissions (
    role_id       TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
    id                  TEXT PRIMARY KEY,
    branch_id           TEXT REFERENCES branches(id), -- NULL = เข้าถึงได้ทุกสาขา (Owner)
    role_id             TEXT NOT NULL REFERENCES roles(id),
    username            TEXT NOT NULL UNIQUE,
    password_hash       TEXT NOT NULL,
    full_name           TEXT NOT NULL,
    email               TEXT,
    phone               TEXT,
    preferred_language  TEXT NOT NULL DEFAULT 'lo' REFERENCES languages(code),
    is_active           INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER trg_users_updated_at AFTER UPDATE ON users
BEGIN
    UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TABLE user_permissions (
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    is_allowed    INTEGER NOT NULL,
    PRIMARY KEY (user_id, permission_id)
);

CREATE TABLE system_settings (
    id          TEXT PRIMARY KEY,
    branch_id   TEXT REFERENCES branches(id),
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (branch_id, key)
);

CREATE TABLE audit_logs (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id),
    branch_id     TEXT REFERENCES branches(id),
    entity_type   TEXT NOT NULL,
    entity_id     TEXT NOT NULL,
    action        TEXT NOT NULL CHECK (action IN ('create','update','delete')),
    changes_json  TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at);

CREATE TABLE attachments (
    id           TEXT PRIMARY KEY,
    entity_type  TEXT NOT NULL CHECK (entity_type IN ('vehicle','customer','sale','expense')),
    entity_id    TEXT NOT NULL,
    file_path    TEXT NOT NULL,
    file_type    TEXT NOT NULL CHECK (file_type IN ('image','document')),
    caption      TEXT,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    uploaded_by  TEXT NOT NULL REFERENCES users(id),
    uploaded_at  TEXT NOT NULL DEFAULT (datetime('now')),
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attachments_entity ON attachments (entity_type, entity_id);

-- ------------------------------------------------------------
-- Module 2 lookups ต้องมาก่อน customers, และ customers ต้องมาก่อน vehicles
-- (vehicles.reserved_by_customer_id อ้างถึง customers) เพื่อเลี่ยง forward FK
-- ------------------------------------------------------------
CREATE TABLE lead_sources (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE CHECK (code IN ('FACEBOOK','LINE','WALK_IN','REFERRAL','SIGNBOARD','OTHER')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE lead_source_translations (
    lead_source_id TEXT NOT NULL REFERENCES lead_sources(id) ON DELETE CASCADE,
    lang_code      TEXT NOT NULL REFERENCES languages(code),
    name           TEXT NOT NULL,
    PRIMARY KEY (lead_source_id, lang_code)
);

CREATE TABLE lead_statuses (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE CHECK (code IN ('INTERESTED','DECIDING','READY_TO_BUY','REJECTED')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE lead_status_translations (
    lead_status_id TEXT NOT NULL REFERENCES lead_statuses(id) ON DELETE CASCADE,
    lang_code      TEXT NOT NULL REFERENCES languages(code),
    name           TEXT NOT NULL,
    PRIMARY KEY (lead_status_id, lang_code)
);

CREATE TABLE customers (
    id                       TEXT PRIMARY KEY,
    branch_id                TEXT NOT NULL REFERENCES branches(id),
    full_name                TEXT NOT NULL,
    phone                    TEXT,
    email                    TEXT,
    address                  TEXT,
    id_card_no               TEXT,
    lead_source_id           TEXT REFERENCES lead_sources(id),
    lead_status_id           TEXT NOT NULL REFERENCES lead_statuses(id),
    assigned_sales_user_id   TEXT REFERENCES users(id),
    notes                    TEXT,
    created_at               TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER trg_customers_updated_at AFTER UPDATE ON customers
BEGIN
    UPDATE customers SET updated_at = datetime('now') WHERE id = NEW.id;
END;
CREATE INDEX idx_customers_branch_sales_owner ON customers (branch_id, assigned_sales_user_id);
CREATE INDEX idx_customers_phone ON customers (phone);

-- ------------------------------------------------------------
-- Module 1: Vehicle
-- ------------------------------------------------------------
CREATE TABLE vehicle_makes (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE vehicle_make_translations (
    make_id     TEXT NOT NULL REFERENCES vehicle_makes(id) ON DELETE CASCADE,
    lang_code   TEXT NOT NULL REFERENCES languages(code),
    name        TEXT NOT NULL,
    PRIMARY KEY (make_id, lang_code)
);

CREATE TABLE vehicle_statuses (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE CHECK (code IN ('PREPARING','AVAILABLE','RESERVED','SOLD','WITHDRAWN')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE vehicle_status_translations (
    status_id   TEXT NOT NULL REFERENCES vehicle_statuses(id) ON DELETE CASCADE,
    lang_code   TEXT NOT NULL REFERENCES languages(code),
    name        TEXT NOT NULL,
    PRIMARY KEY (status_id, lang_code)
);

CREATE TABLE vehicle_source_types (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE CHECK (code IN ('PURCHASE','AUCTION','CONSIGNMENT','TRADE_IN')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE vehicle_source_type_translations (
    source_type_id TEXT NOT NULL REFERENCES vehicle_source_types(id) ON DELETE CASCADE,
    lang_code      TEXT NOT NULL REFERENCES languages(code),
    name           TEXT NOT NULL,
    PRIMARY KEY (source_type_id, lang_code)
);

CREATE TABLE vehicle_cost_types (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE CHECK (code IN
        ('PURCHASE','REPAIR','PAINT','SERVICE_CHECK','TRANSFER_TAX','SALES_COMMISSION','TRANSPORT','OTHER')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE vehicle_cost_type_translations (
    cost_type_id TEXT NOT NULL REFERENCES vehicle_cost_types(id) ON DELETE CASCADE,
    lang_code    TEXT NOT NULL REFERENCES languages(code),
    name         TEXT NOT NULL,
    PRIMARY KEY (cost_type_id, lang_code)
);

CREATE TABLE consignors (
    id                 TEXT PRIMARY KEY,
    branch_id          TEXT NOT NULL REFERENCES branches(id),
    full_name          TEXT NOT NULL,
    phone              TEXT,
    id_card_no         TEXT,
    address            TEXT,
    bank_account_info  TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE vehicles (
    id                        TEXT PRIMARY KEY,
    branch_id                 TEXT NOT NULL REFERENCES branches(id),
    vin                       TEXT UNIQUE,
    license_plate             TEXT,
    make_id                   TEXT REFERENCES vehicle_makes(id),
    make_other                TEXT,
    model                     TEXT NOT NULL,
    year                      INTEGER,
    mileage                   INTEGER,
    color                     TEXT,
    engine_no                 TEXT,
    source_type_id            TEXT NOT NULL REFERENCES vehicle_source_types(id),
    consignor_id              TEXT REFERENCES consignors(id),
    status_id                 TEXT NOT NULL REFERENCES vehicle_statuses(id),
    listing_price              INTEGER,
    reserved_until              TEXT,
    reserved_by_customer_id     TEXT REFERENCES customers(id),
    acquisition_date            TEXT NOT NULL,
    sold_date                   TEXT,
    notes                       TEXT,
    created_by                  TEXT NOT NULL REFERENCES users(id),
    created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER trg_vehicles_updated_at AFTER UPDATE ON vehicles
BEGIN
    UPDATE vehicles SET updated_at = datetime('now') WHERE id = NEW.id;
END;
CREATE INDEX idx_vehicles_branch_status ON vehicles (branch_id, status_id);
CREATE INDEX idx_vehicles_license_plate ON vehicles (license_plate);
CREATE INDEX idx_vehicles_make_id ON vehicles (make_id);

CREATE TABLE vehicle_costs (
    id            TEXT PRIMARY KEY,
    vehicle_id    TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    cost_type_id  TEXT NOT NULL REFERENCES vehicle_cost_types(id),
    description   TEXT,
    amount        INTEGER NOT NULL CHECK (amount >= 0),
    cost_date     TEXT NOT NULL,
    created_by    TEXT NOT NULL REFERENCES users(id),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vehicle_costs_vehicle_id ON vehicle_costs (vehicle_id);
CREATE INDEX idx_vehicle_costs_cost_type_id ON vehicle_costs (cost_type_id);

CREATE TABLE vehicle_status_history (
    id              TEXT PRIMARY KEY,
    vehicle_id      TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    from_status_id  TEXT REFERENCES vehicle_statuses(id),
    to_status_id    TEXT NOT NULL REFERENCES vehicle_statuses(id),
    changed_by      TEXT NOT NULL REFERENCES users(id),
    changed_at      TEXT NOT NULL DEFAULT (datetime('now')),
    note            TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vehicle_status_history_vehicle_changed ON vehicle_status_history (vehicle_id, changed_at);

CREATE TABLE customer_vehicle_interests (
    id               TEXT PRIMARY KEY,
    customer_id      TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    vehicle_id       TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    budget_amount    INTEGER,
    condition_type   TEXT CHECK (condition_type IN ('CASH','INSTALLMENT','TRADE_IN')),
    interest_level   TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (customer_id, vehicle_id)
);
CREATE INDEX idx_customer_vehicle_interests_vehicle_id ON customer_vehicle_interests (vehicle_id);

CREATE TABLE follow_ups (
    id                   TEXT PRIMARY KEY,
    customer_id          TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    vehicle_id           TEXT REFERENCES vehicles(id),
    assigned_to_user_id  TEXT NOT NULL REFERENCES users(id),
    scheduled_at         TEXT NOT NULL,
    channel              TEXT CHECK (channel IN ('PHONE','LINE','WALK_IN','OTHER')),
    status               TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DONE','MISSED','CANCELLED')),
    result_notes         TEXT,
    completed_at         TEXT,
    created_by           TEXT NOT NULL REFERENCES users(id),
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_follow_ups_assignee_status_scheduled ON follow_ups (assigned_to_user_id, status, scheduled_at);
CREATE INDEX idx_follow_ups_customer_id ON follow_ups (customer_id);

-- ------------------------------------------------------------
-- Module 3: Sales
-- ------------------------------------------------------------
CREATE TABLE payment_types (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE CHECK (code IN ('CASH','INSTALLMENT','FINANCE','TRADE_IN')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE payment_type_translations (
    payment_type_id TEXT NOT NULL REFERENCES payment_types(id) ON DELETE CASCADE,
    lang_code       TEXT NOT NULL REFERENCES languages(code),
    name            TEXT NOT NULL,
    PRIMARY KEY (payment_type_id, lang_code)
);

CREATE TABLE sales (
    id                        TEXT PRIMARY KEY,
    branch_id                 TEXT NOT NULL REFERENCES branches(id),
    vehicle_id                TEXT NOT NULL REFERENCES vehicles(id),
    customer_id                TEXT NOT NULL REFERENCES customers(id),
    sales_user_id               TEXT NOT NULL REFERENCES users(id),
    sale_date                   TEXT NOT NULL,
    sale_price                  INTEGER NOT NULL CHECK (sale_price >= 0),
    payment_type_id             TEXT NOT NULL REFERENCES payment_types(id),
    finance_institution_name    TEXT,
    down_payment                INTEGER,
    trade_in_vehicle_id         TEXT REFERENCES vehicles(id),
    status                      TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PENDING','COMPLETED','CANCELLED')),
    created_by                  TEXT NOT NULL REFERENCES users(id),
    created_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Business Rule 5: รถ 1 คันขายได้ 1 ครั้งต่อ record ที่ "active" (ไม่รวมรายการที่ถูกยกเลิก)
CREATE UNIQUE INDEX uq_sales_vehicle_active ON sales (vehicle_id) WHERE status <> 'CANCELLED';
CREATE INDEX idx_sales_branch_date ON sales (branch_id, sale_date);
CREATE INDEX idx_sales_customer_id ON sales (customer_id);
CREATE INDEX idx_sales_sales_user_id ON sales (sales_user_id);

CREATE TABLE sale_documents (
    id             TEXT PRIMARY KEY,
    sale_id        TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    doc_type       TEXT NOT NULL CHECK (doc_type IN ('QUOTATION','CONTRACT','RECEIPT')),
    language_code  TEXT NOT NULL REFERENCES languages(code),
    file_path      TEXT,
    generated_by   TEXT NOT NULL REFERENCES users(id),
    generated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- Module 5: Expense
-- ------------------------------------------------------------
CREATE TABLE expense_categories (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE expense_category_translations (
    category_id  TEXT NOT NULL REFERENCES expense_categories(id) ON DELETE CASCADE,
    lang_code    TEXT NOT NULL REFERENCES languages(code),
    name         TEXT NOT NULL,
    PRIMARY KEY (category_id, lang_code)
);

CREATE TABLE expenses (
    id             TEXT PRIMARY KEY,
    branch_id      TEXT NOT NULL REFERENCES branches(id),
    category_id    TEXT NOT NULL REFERENCES expense_categories(id),
    amount         INTEGER NOT NULL CHECK (amount >= 0),
    expense_date   TEXT NOT NULL,
    description    TEXT,
    approved_by    TEXT REFERENCES users(id),
    created_by     TEXT NOT NULL REFERENCES users(id),
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_expenses_branch_date_category ON expenses (branch_id, expense_date, category_id);

CREATE TABLE budgets (
    id                TEXT PRIMARY KEY,
    branch_id         TEXT NOT NULL REFERENCES branches(id),
    year              INTEGER NOT NULL,
    month             INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    category_id       TEXT REFERENCES expense_categories(id),
    budgeted_amount   INTEGER NOT NULL CHECK (budgeted_amount >= 0),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (branch_id, year, month, category_id)
);
CREATE UNIQUE INDEX uq_budgets_total_per_branch_month ON budgets (branch_id, year, month) WHERE category_id IS NULL;

-- ------------------------------------------------------------
-- Views — Module 4/6/7 (คำนวณ, ไม่ใช่ตารางเก็บข้อมูล)
-- ------------------------------------------------------------
CREATE VIEW v_vehicle_profit AS
SELECT
    v.id AS vehicle_id,
    v.branch_id,
    COALESCE(SUM(vc.amount), 0) AS total_cost,
    s.sale_price,
    s.sale_price - COALESCE(SUM(vc.amount), 0) AS gross_profit,
    CASE WHEN s.sale_price > 0
         THEN ROUND((s.sale_price - COALESCE(SUM(vc.amount), 0)) * 1.0 / s.sale_price * 100, 2)
         ELSE NULL END AS margin_pct
FROM vehicles v
LEFT JOIN vehicle_costs vc ON vc.vehicle_id = v.id
LEFT JOIN sales s ON s.vehicle_id = v.id AND s.status = 'COMPLETED'
GROUP BY v.id, v.branch_id, s.sale_price;

CREATE VIEW v_monthly_sales_summary AS
SELECT
    branch_id,
    strftime('%Y-%m', sale_date) AS sales_month,
    COUNT(*) AS units_sold,
    SUM(sale_price) AS total_revenue
FROM sales
WHERE status = 'COMPLETED'
GROUP BY branch_id, strftime('%Y-%m', sale_date);

CREATE VIEW v_vehicle_aging AS
SELECT
    v.id AS vehicle_id,
    v.branch_id,
    v.status_id,
    vs.code AS status_code,
    v.acquisition_date,
    CAST(julianday('now') - julianday(v.acquisition_date) AS INTEGER) AS days_in_stock
FROM vehicles v
JOIN vehicle_statuses vs ON vs.id = v.status_id
WHERE vs.code IN ('PREPARING','AVAILABLE');

CREATE VIEW v_sales_rep_performance AS
WITH sales_agg AS (
    SELECT sales_user_id, branch_id, COUNT(*) AS units_sold, SUM(sale_price) AS total_revenue
    FROM sales WHERE status = 'COMPLETED'
    GROUP BY sales_user_id, branch_id
),
leads_agg AS (
    SELECT assigned_sales_user_id AS user_id, COUNT(*) AS leads_assigned
    FROM customers WHERE assigned_sales_user_id IS NOT NULL
    GROUP BY assigned_sales_user_id
)
SELECT
    u.id AS sales_user_id,
    u.branch_id,
    COALESCE(sa.units_sold, 0) AS units_sold,
    COALESCE(sa.total_revenue, 0) AS total_revenue,
    COALESCE(la.leads_assigned, 0) AS leads_assigned,
    ROUND(COALESCE(sa.units_sold, 0) * 1.0 / NULLIF(la.leads_assigned, 0) * 100, 2) AS conversion_rate_pct
FROM users u
LEFT JOIN sales_agg sa ON sa.sales_user_id = u.id
LEFT JOIN leads_agg la ON la.user_id = u.id;

CREATE VIEW v_lead_source_effectiveness AS
SELECT
    ls.id AS lead_source_id,
    ls.code AS lead_source_code,
    c.branch_id,
    COUNT(DISTINCT c.id) AS total_leads,
    COUNT(DISTINCT s.customer_id) AS converted_customers,
    ROUND(COUNT(DISTINCT s.customer_id) * 1.0 / NULLIF(COUNT(DISTINCT c.id), 0) * 100, 2) AS conversion_rate_pct
FROM lead_sources ls
LEFT JOIN customers c ON c.lead_source_id = ls.id
LEFT JOIN sales s ON s.customer_id = c.id AND s.status = 'COMPLETED'
GROUP BY ls.id, ls.code, c.branch_id;

CREATE VIEW v_expense_vs_budget AS
WITH actual_by_category AS (
    SELECT branch_id, category_id, CAST(strftime('%Y', expense_date) AS INTEGER) AS year,
           CAST(strftime('%m', expense_date) AS INTEGER) AS month, SUM(amount) AS actual_amount
    FROM expenses
    GROUP BY branch_id, category_id, strftime('%Y', expense_date), strftime('%m', expense_date)
),
actual_total AS (
    SELECT branch_id, CAST(strftime('%Y', expense_date) AS INTEGER) AS year,
           CAST(strftime('%m', expense_date) AS INTEGER) AS month, SUM(amount) AS actual_amount
    FROM expenses
    GROUP BY branch_id, strftime('%Y', expense_date), strftime('%m', expense_date)
)
SELECT
    b.id AS budget_id, b.branch_id, b.year, b.month, b.category_id, b.budgeted_amount,
    COALESCE(CASE WHEN b.category_id IS NULL THEN at.actual_amount ELSE ac.actual_amount END, 0) AS actual_amount,
    b.budgeted_amount - COALESCE(CASE WHEN b.category_id IS NULL THEN at.actual_amount ELSE ac.actual_amount END, 0) AS variance
FROM budgets b
LEFT JOIN actual_by_category ac ON ac.branch_id = b.branch_id AND ac.category_id = b.category_id
    AND ac.year = b.year AND ac.month = b.month
LEFT JOIN actual_total at ON at.branch_id = b.branch_id AND at.year = b.year AND at.month = b.month;
