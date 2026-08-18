'use strict';

const crypto = require('crypto');
const session = require('../session');

function uuid() { return crypto.randomUUID(); }

function list(db, { branchId, search, assignedToMe } = {}) {
    session.requirePermission('customer.view');
    const sess = session.requireLogin();
    const clauses = [];
    const params = {};
    if (branchId) { clauses.push('c.branch_id = @branchId'); params.branchId = branchId; }
    if (search) {
        clauses.push('(c.full_name LIKE @search OR c.phone LIKE @search)');
        params.search = `%${search}%`;
    }
    if (assignedToMe) { clauses.push('c.assigned_sales_user_id = @userId'); params.userId = sess.user.id; }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`
        SELECT c.id, c.full_name, c.phone, c.email, c.assigned_sales_user_id,
               ls.code AS lead_status_code, src.code AS lead_source_code,
               u.full_name AS assigned_sales_name
        FROM customers c
        JOIN lead_statuses ls ON ls.id = c.lead_status_id
        LEFT JOIN lead_sources src ON src.id = c.lead_source_id
        LEFT JOIN users u ON u.id = c.assigned_sales_user_id
        ${where}
        ORDER BY c.updated_at DESC
    `).all(params);
}

function get(db, { id }) {
    session.requirePermission('customer.view');
    const customer = db.prepare(`
        SELECT c.*, ls.code AS lead_status_code, src.code AS lead_source_code
        FROM customers c
        JOIN lead_statuses ls ON ls.id = c.lead_status_id
        LEFT JOIN lead_sources src ON src.id = c.lead_source_id
        WHERE c.id = ?
    `).get(id);
    if (!customer) return null;

    customer.interests = db.prepare(`
        SELECT cvi.id, cvi.budget_amount, cvi.condition_type, cvi.interest_level,
               v.id AS vehicle_id, v.model, v.year
        FROM customer_vehicle_interests cvi
        JOIN vehicles v ON v.id = cvi.vehicle_id
        WHERE cvi.customer_id = ?
    `).all(id);

    customer.followUps = db.prepare(`
        SELECT f.id, f.scheduled_at, f.channel, f.status, f.result_notes, f.completed_at,
               u.full_name AS assigned_to_name
        FROM follow_ups f
        JOIN users u ON u.id = f.assigned_to_user_id
        WHERE f.customer_id = ?
        ORDER BY f.scheduled_at DESC
    `).all(id);

    customer.purchaseHistory = db.prepare(`
        SELECT s.id, s.sale_date, s.sale_price, s.status, v.model, v.year
        FROM sales s JOIN vehicles v ON v.id = s.vehicle_id
        WHERE s.customer_id = ?
        ORDER BY s.sale_date DESC
    `).all(id);

    return customer;
}

function create(db, payload) {
    session.requirePermission('customer.manage');
    const sess = session.requireLogin();
    const id = uuid();
    const branchId = payload.branchId || sess.user.branch_id;
    if (!branchId) throw Object.assign(new Error('BRANCH_REQUIRED'), { code: 'BRANCH_REQUIRED' });

    const leadStatus = db.prepare('SELECT id FROM lead_statuses WHERE code = ?').get(payload.leadStatusCode || 'INTERESTED');
    const leadSource = payload.leadSourceCode
        ? db.prepare('SELECT id FROM lead_sources WHERE code = ?').get(payload.leadSourceCode)
        : null;

    db.prepare(`
        INSERT INTO customers (id, branch_id, full_name, phone, email, address, id_card_no,
            lead_source_id, lead_status_id, assigned_sales_user_id, notes)
        VALUES (@id, @branchId, @fullName, @phone, @email, @address, @idCardNo,
            @leadSourceId, @leadStatusId, @assignedSalesUserId, @notes)
    `).run({
        id, branchId,
        fullName: payload.fullName,
        phone: payload.phone || null,
        email: payload.email || null,
        address: payload.address || null,
        idCardNo: payload.idCardNo || null,
        leadSourceId: leadSource ? leadSource.id : null,
        leadStatusId: leadStatus.id,
        assignedSalesUserId: payload.assignedSalesUserId || sess.user.id,
        notes: payload.notes || null,
    });
    return get(db, { id });
}

function addFollowUp(db, payload) {
    session.requirePermission('customer.manage');
    const sess = session.requireLogin();
    const id = uuid();
    db.prepare(`
        INSERT INTO follow_ups (id, customer_id, vehicle_id, assigned_to_user_id, scheduled_at,
            channel, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `).run(id, payload.customerId, payload.vehicleId || null, payload.assignedToUserId || sess.user.id,
           payload.scheduledAt, payload.channel || null, sess.user.id);
    return db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(id);
}

function completeFollowUp(db, { id, resultNotes, outcomeStatus }) {
    session.requirePermission('customer.manage');
    db.prepare(`
        UPDATE follow_ups SET status = ?, result_notes = ?, completed_at = datetime('now')
        WHERE id = ?
    `).run(outcomeStatus || 'DONE', resultNotes || null, id);
    return db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(id);
}

function listDueFollowUps(db, { assignedToUserId } = {}) {
    session.requirePermission('customer.view');
    // Business Rule 6: follow-up ที่เลยกำหนด ต้อง flag เด่นชัด
    const clauses = ["f.status = 'PENDING'", "f.scheduled_at < datetime('now')"];
    const params = {};
    if (assignedToUserId) { clauses.push('f.assigned_to_user_id = @assignedToUserId'); params.assignedToUserId = assignedToUserId; }
    return db.prepare(`
        SELECT f.id, f.scheduled_at, c.full_name AS customer_name, c.phone
        FROM follow_ups f JOIN customers c ON c.id = f.customer_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY f.scheduled_at ASC
    `).all(params);
}

function register(ipcMain, db) {
    ipcMain.handle('customers:list', (e, args) => list(db, args));
    ipcMain.handle('customers:get', (e, args) => get(db, args));
    ipcMain.handle('customers:create', (e, args) => create(db, args));
    ipcMain.handle('followups:create', (e, args) => addFollowUp(db, args));
    ipcMain.handle('followups:complete', (e, args) => completeFollowUp(db, args));
    ipcMain.handle('followups:due', (e, args) => listDueFollowUps(db, args));
}

module.exports = { register, list, get, create, addFollowUp, completeFollowUp, listDueFollowUps };
