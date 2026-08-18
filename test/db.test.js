// สคริปต์ทดสอบ DB layer แบบ standalone (รันผ่าน Electron's Node runtime ด้วย ELECTRON_RUN_AS_NODE=1
// เพราะ better-sqlite3 ถูก rebuild ให้ตรงกับ ABI ของ Electron ไปแล้วตอน postinstall)
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const tmpFile = path.join(os.tmpdir(), `profit-test-${Date.now()}.db`);
const db = new Database(tmpFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function runMigrations() {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    const dir = path.join(__dirname, '..', 'src', 'db', 'migrations');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
        const sql = fs.readFileSync(path.join(dir, file), 'utf8');
        db.transaction(() => {
            db.exec(sql);
            db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(file);
        })();
        console.log(`applied ${file}`);
    }
}

function uuid() { return crypto.randomUUID(); }
let failures = 0;
function assertEq(actual, expected, label) {
    if (actual !== expected) { console.error(`FAIL ${label}: expected ${expected}, got ${actual}`); failures++; }
    else console.log(`OK   ${label} = ${actual}`);
}

runMigrations();

// --- table/view counts ---
const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations') AS tables,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='view') AS views
`).get();
assertEq(counts.tables, 38, 'table count');
assertEq(counts.views, 6, 'view count');

// --- seed sanity ---
const ownerRole = db.prepare("SELECT id FROM roles WHERE code='OWNER'").get();
assertEq(!!ownerRole, true, 'OWNER role seeded');
const ownerPerms = db.prepare('SELECT COUNT(*) AS n FROM role_permissions WHERE role_id = ?').get(ownerRole.id).n;
assertEq(ownerPerms, 14, 'OWNER permission count');

// --- create a branch + owner user (simulating first-run setup) ---
const branchId = uuid();
const userId = uuid();
db.prepare(`INSERT INTO branches (id, code, name) VALUES (?, 'BR001', 'ສາຂາຫຼັກ')`).run(branchId);
db.prepare(`
    INSERT INTO users (id, branch_id, role_id, username, password_hash, full_name)
    VALUES (?, NULL, ?, 'owner', ?, 'ທ່ານເຈົ້າຂອງ')
`).run(userId, ownerRole.id, bcrypt.hashSync('secret123', 10));

const loginOk = bcrypt.compareSync('secret123', db.prepare('SELECT password_hash FROM users WHERE id=?').get(userId).password_hash);
assertEq(loginOk, true, 'password hash roundtrip');

// --- vehicle lifecycle: create -> add cost -> sell -> check profit view ---
const makeId = db.prepare("SELECT id FROM vehicle_makes WHERE code='TOYOTA'").get().id;
const sourceType = db.prepare("SELECT id FROM vehicle_source_types WHERE code='PURCHASE'").get().id;
const preparingStatus = db.prepare("SELECT id FROM vehicle_statuses WHERE code='PREPARING'").get().id;
const availableStatus = db.prepare("SELECT id FROM vehicle_statuses WHERE code='AVAILABLE'").get().id;
const soldStatus = db.prepare("SELECT id FROM vehicle_statuses WHERE code='SOLD'").get().id;

const vehicleId = uuid();
db.prepare(`
    INSERT INTO vehicles (id, branch_id, make_id, model, year, source_type_id, status_id, listing_price, acquisition_date, created_by)
    VALUES (?, ?, ?, 'Hilux Revo', 2020, ?, ?, 150000000, '2026-01-01', ?)
`).run(vehicleId, branchId, makeId, sourceType, preparingStatus, userId);

const purchaseCostType = db.prepare("SELECT id FROM vehicle_cost_types WHERE code='PURCHASE'").get().id;
const repairCostType = db.prepare("SELECT id FROM vehicle_cost_types WHERE code='REPAIR'").get().id;
db.prepare(`INSERT INTO vehicle_costs (id, vehicle_id, cost_type_id, amount, cost_date, created_by) VALUES (?, ?, ?, 120000000, '2026-01-01', ?)`).run(uuid(), vehicleId, purchaseCostType, userId);
db.prepare(`INSERT INTO vehicle_costs (id, vehicle_id, cost_type_id, amount, cost_date, created_by) VALUES (?, ?, ?, 5000000, '2026-01-05', ?)`).run(uuid(), vehicleId, repairCostType, userId);

db.prepare('UPDATE vehicles SET status_id = ? WHERE id = ?').run(availableStatus, vehicleId);

// customer + sale
const leadStatus = db.prepare("SELECT id FROM lead_statuses WHERE code='READY_TO_BUY'").get().id;
const customerId = uuid();
db.prepare(`INSERT INTO customers (id, branch_id, full_name, lead_status_id) VALUES (?, ?, 'ນາງ ສົມໃຈ', ?)`).run(customerId, branchId, leadStatus);

const paymentType = db.prepare("SELECT id FROM payment_types WHERE code='CASH'").get().id;
const saleId = uuid();
db.prepare(`
    INSERT INTO sales (id, branch_id, vehicle_id, customer_id, sales_user_id, sale_date, sale_price, payment_type_id, created_by)
    VALUES (?, ?, ?, ?, ?, '2026-02-01', 148000000, ?, ?)
`).run(saleId, branchId, vehicleId, customerId, userId, paymentType, userId);
db.prepare('UPDATE vehicles SET status_id = ?, sold_date = ? WHERE id = ?').run(soldStatus, '2026-02-01', vehicleId);

const profit = db.prepare('SELECT * FROM v_vehicle_profit WHERE vehicle_id = ?').get(vehicleId);
assertEq(profit.total_cost, 125000000, 'v_vehicle_profit total_cost');
assertEq(profit.gross_profit, 23000000, 'v_vehicle_profit gross_profit (148M - 125M)');
assertEq(profit.margin_pct, 15.54, 'v_vehicle_profit margin_pct');

// --- Business Rule 5 test: partial unique index allows re-sale after cancellation ---
db.prepare("UPDATE sales SET status = 'CANCELLED' WHERE id = ?").run(saleId);
let secondSaleOk = true;
try {
    db.prepare(`
        INSERT INTO sales (id, branch_id, vehicle_id, customer_id, sales_user_id, sale_date, sale_price, payment_type_id, created_by)
        VALUES (?, ?, ?, ?, ?, '2026-02-10', 149000000, ?, ?)
    `).run(uuid(), branchId, vehicleId, customerId, userId, paymentType, userId);
} catch (e) { secondSaleOk = false; console.error(e.message); }
assertEq(secondSaleOk, true, 'resell after cancelled sale allowed (partial unique index)');

// but a THIRD active sale on the same vehicle must fail
let thirdSaleBlocked = false;
try {
    db.prepare(`
        INSERT INTO sales (id, branch_id, vehicle_id, customer_id, sales_user_id, sale_date, sale_price, payment_type_id, created_by)
        VALUES (?, ?, ?, ?, ?, '2026-02-11', 149000000, ?, ?)
    `).run(uuid(), branchId, vehicleId, customerId, userId, paymentType, userId);
} catch (e) { thirdSaleBlocked = true; }
assertEq(thirdSaleBlocked, true, 'second ACTIVE sale on same vehicle blocked by unique index');

// --- v_sales_rep_performance: no cartesian double counting ---
// give the sales user 3 assigned leads, but only 1 real sale — units_sold must stay 1, not 3
for (let i = 0; i < 2; i++) {
    db.prepare(`INSERT INTO customers (id, branch_id, full_name, lead_status_id, assigned_sales_user_id) VALUES (?, ?, ?, ?, ?)`)
      .run(uuid(), branchId, `Lead ${i}`, leadStatus, userId);
}
db.prepare(`UPDATE customers SET assigned_sales_user_id = ? WHERE id = ?`).run(userId, customerId);
const perf = db.prepare('SELECT * FROM v_sales_rep_performance WHERE sales_user_id = ?').get(userId);
assertEq(perf.units_sold, 1, 'v_sales_rep_performance units_sold not inflated by cartesian join');
assertEq(perf.total_revenue, 149000000, 'v_sales_rep_performance total_revenue correct (not summed per-lead)');
assertEq(perf.leads_assigned, 3, 'v_sales_rep_performance leads_assigned counts all 3');

// --- budgets: total vs per-category, v_expense_vs_budget ---
const rentCat = db.prepare("SELECT id FROM expense_categories WHERE code='RENT'").get().id;
db.prepare(`INSERT INTO budgets (id, branch_id, year, month, category_id, budgeted_amount) VALUES (?, ?, 2026, 2, ?, 3000000)`).run(uuid(), branchId, rentCat);
db.prepare(`INSERT INTO budgets (id, branch_id, year, month, category_id, budgeted_amount) VALUES (?, ?, 2026, 2, NULL, 10000000)`).run(uuid(), branchId);
db.prepare(`INSERT INTO expenses (id, branch_id, category_id, amount, expense_date, created_by) VALUES (?, ?, ?, 3200000, '2026-02-05', ?)`).run(uuid(), branchId, rentCat, userId);
const salaryCat = db.prepare("SELECT id FROM expense_categories WHERE code='SALARY'").get().id;
db.prepare(`INSERT INTO expenses (id, branch_id, category_id, amount, expense_date, created_by) VALUES (?, ?, ?, 4000000, '2026-02-06', ?)`).run(uuid(), branchId, salaryCat, userId);

const vsBudget = db.prepare('SELECT * FROM v_expense_vs_budget WHERE branch_id = ? AND year=2026 AND month=2 ORDER BY category_id IS NULL DESC').all(branchId);
const rentRow = vsBudget.find(r => r.category_id === rentCat);
const totalRow = vsBudget.find(r => r.category_id === null);
assertEq(rentRow.actual_amount, 3200000, 'v_expense_vs_budget per-category actual');
assertEq(totalRow.actual_amount, 7200000, 'v_expense_vs_budget total actual = sum of ALL categories (3.2M+4M)');

// --- effective permission logic (role + override) ---
const session = require('../src/main/session');
const eff1 = session.computeEffectivePermissions(db, userId, ownerRole.id);
assertEq(eff1.has('vehicle.view_profit'), true, 'OWNER has vehicle.view_profit by default');

const salesRole = db.prepare("SELECT id FROM roles WHERE code='SALES'").get();
const salesUserId = uuid();
db.prepare(`INSERT INTO users (id, branch_id, role_id, username, password_hash, full_name) VALUES (?, ?, ?, 'saleschan', 'x', 'พนักงานขาย')`).run(salesUserId, branchId, salesRole.id);
let effSales = session.computeEffectivePermissions(db, salesUserId, salesRole.id);
assertEq(effSales.has('vehicle.view_profit'), false, 'SALES role has no view_profit by default');

const permRow = db.prepare("SELECT id FROM permissions WHERE code='vehicle.view_profit'").get();
db.prepare('INSERT INTO user_permissions (user_id, permission_id, is_allowed) VALUES (?, ?, 1)').run(salesUserId, permRow.id);
effSales = session.computeEffectivePermissions(db, salesUserId, salesRole.id);
assertEq(effSales.has('vehicle.view_profit'), true, 'per-user override GRANTS vehicle.view_profit to a SALES user');

db.close();
fs.unlinkSync(tmpFile);
try { fs.unlinkSync(tmpFile + '-wal'); fs.unlinkSync(tmpFile + '-shm'); } catch (e) {}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
