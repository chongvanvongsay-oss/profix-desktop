'use strict';

const session = require('../session');

// Module 6-7 ตาม PHASE 2 — ทุก query ด้านล่างอ่านจาก VIEW ที่มีอยู่แล้วใน schema
// (v_monthly_sales_summary, v_vehicle_aging, v_sales_rep_performance,
//  v_lead_source_effectiveness, v_expense_vs_budget) ไม่มี business logic ใหม่

function monthlySales(db, { branchId } = {}) {
    session.requirePermission('report.view');
    const clauses = branchId ? 'WHERE branch_id = @branchId' : '';
    return db.prepare(`SELECT * FROM v_monthly_sales_summary ${clauses} ORDER BY sales_month DESC LIMIT 12`).all({ branchId });
}

function vehicleAging(db, { branchId } = {}) {
    session.requirePermission('report.view');
    const clauses = branchId ? 'WHERE branch_id = @branchId' : '';
    return db.prepare(`SELECT * FROM v_vehicle_aging ${clauses} ORDER BY days_in_stock DESC LIMIT 50`).all({ branchId });
}

function salesRepPerformance(db, { branchId } = {}) {
    session.requirePermission('report.view');
    const clauses = branchId ? 'WHERE branch_id = @branchId' : '';
    return db.prepare(`SELECT * FROM v_sales_rep_performance ${clauses} ORDER BY units_sold DESC`).all({ branchId });
}

function leadSourceEffectiveness(db, { branchId } = {}) {
    session.requirePermission('report.view');
    const clauses = branchId ? 'WHERE branch_id = @branchId' : '';
    return db.prepare(`SELECT * FROM v_lead_source_effectiveness ${clauses} ORDER BY total_leads DESC`).all({ branchId });
}

function expenseVsBudget(db, { branchId, year, month } = {}) {
    session.requirePermission('report.view_financial');
    const y = year || new Date().getFullYear();
    const m = month || new Date().getMonth() + 1;
    const clauses = branchId ? 'AND branch_id = @branchId' : '';
    return db.prepare(`SELECT * FROM v_expense_vs_budget WHERE year = @y AND month = @m ${clauses}`).all({ branchId, y, m });
}

function register(ipcMain, db) {
    ipcMain.handle('reports:monthlySales', (e, args) => monthlySales(db, args));
    ipcMain.handle('reports:vehicleAging', (e, args) => vehicleAging(db, args));
    ipcMain.handle('reports:salesRepPerformance', (e, args) => salesRepPerformance(db, args));
    ipcMain.handle('reports:leadSourceEffectiveness', (e, args) => leadSourceEffectiveness(db, args));
    ipcMain.handle('reports:expenseVsBudget', (e, args) => expenseVsBudget(db, args));
}

module.exports = { register, monthlySales, vehicleAging, salesRepPerformance, leadSourceEffectiveness, expenseVsBudget };
