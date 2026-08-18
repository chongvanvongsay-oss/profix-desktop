'use strict';

const crypto = require('crypto');
const session = require('../session');

function uuid() { return crypto.randomUUID(); }

function list(db, { branchId, from, to, categoryCode } = {}) {
    session.requirePermission('expense.view');
    const clauses = [];
    const params = {};
    if (branchId) { clauses.push('e.branch_id = @branchId'); params.branchId = branchId; }
    if (from) { clauses.push('e.expense_date >= @from'); params.from = from; }
    if (to) { clauses.push('e.expense_date <= @to'); params.to = to; }
    if (categoryCode) { clauses.push('ec.code = @categoryCode'); params.categoryCode = categoryCode; }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`
        SELECT e.id, e.amount, e.expense_date, e.description, ec.code AS category_code,
               u.full_name AS created_by_name
        FROM expenses e
        JOIN expense_categories ec ON ec.id = e.category_id
        JOIN users u ON u.id = e.created_by
        ${where}
        ORDER BY e.expense_date DESC
    `).all(params);
}

function create(db, payload) {
    session.requirePermission('expense.manage');
    const sess = session.requireLogin();
    const branchId = payload.branchId || sess.user.branch_id;
    if (!branchId) throw Object.assign(new Error('BRANCH_REQUIRED'), { code: 'BRANCH_REQUIRED' });
    const category = db.prepare('SELECT id FROM expense_categories WHERE code = ?').get(payload.categoryCode);
    if (!category) throw Object.assign(new Error('INVALID_CATEGORY'), { code: 'INVALID_CATEGORY' });

    const id = uuid();
    db.prepare(`
        INSERT INTO expenses (id, branch_id, category_id, amount, expense_date, description, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, branchId, category.id, payload.amount, payload.expenseDate || new Date().toISOString().slice(0, 10),
           payload.description || null, sess.user.id);
    return db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
}

function setBudget(db, { branchId, year, month, categoryCode, budgetedAmount }) {
    session.requirePermission('expense.manage');
    const sess = session.requireLogin();
    const bId = branchId || sess.user.branch_id;
    const category = categoryCode ? db.prepare('SELECT id FROM expense_categories WHERE code = ?').get(categoryCode) : null;
    const categoryId = category ? category.id : null;

    const existing = db.prepare(`
        SELECT id FROM budgets WHERE branch_id = ? AND year = ? AND month = ?
        AND (category_id IS ? OR category_id = ?)
    `).get(bId, year, month, categoryId, categoryId);

    if (existing) {
        db.prepare('UPDATE budgets SET budgeted_amount = ? WHERE id = ?').run(budgetedAmount, existing.id);
        return db.prepare('SELECT * FROM budgets WHERE id = ?').get(existing.id);
    }
    const id = uuid();
    db.prepare(`
        INSERT INTO budgets (id, branch_id, year, month, category_id, budgeted_amount)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, bId, year, month, categoryId, budgetedAmount);
    return db.prepare('SELECT * FROM budgets WHERE id = ?').get(id);
}

function vsBudget(db, { branchId, year, month }) {
    session.requirePermission('expense.view');
    return db.prepare(`
        SELECT * FROM v_expense_vs_budget WHERE branch_id = ? AND year = ? AND month = ?
    `).all(branchId, year, month);
}

function register(ipcMain, db) {
    ipcMain.handle('expenses:list', (e, args) => list(db, args));
    ipcMain.handle('expenses:create', (e, args) => create(db, args));
    ipcMain.handle('expenses:setBudget', (e, args) => setBudget(db, args));
    ipcMain.handle('expenses:vsBudget', (e, args) => vsBudget(db, args));
}

module.exports = { register, list, create, setBudget, vsBudget };
