'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('../session');

function uuid() { return crypto.randomUUID(); }

function list(db, { branchId } = {}) {
    session.requirePermission('user.manage');
    const clauses = [];
    const params = {};
    if (branchId) { clauses.push('u.branch_id = @branchId'); params.branchId = branchId; }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`
        SELECT u.id, u.username, u.full_name, u.email, u.phone, u.is_active, u.preferred_language,
               r.code AS role_code
        FROM users u JOIN roles r ON r.id = u.role_id
        ${where}
        ORDER BY u.created_at ASC
    `).all(params);
}

function create(db, payload) {
    session.requirePermission('user.manage');
    const sess = session.requireLogin();
    if (!payload.username || !payload.password || !payload.fullName) {
        throw Object.assign(new Error('MISSING_FIELDS'), { code: 'MISSING_FIELDS' });
    }
    if (payload.password.length < 6) {
        throw Object.assign(new Error('PASSWORD_TOO_SHORT'), { code: 'PASSWORD_TOO_SHORT' });
    }
    const role = db.prepare('SELECT id FROM roles WHERE code = ?').get(payload.roleCode);
    if (!role) throw Object.assign(new Error('INVALID_ROLE'), { code: 'INVALID_ROLE' });

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(payload.username);
    if (existing) throw Object.assign(new Error('USERNAME_TAKEN'), { code: 'USERNAME_TAKEN' });

    const id = uuid();
    const branchId = 'branchId' in payload ? payload.branchId : sess.user.branch_id;
    db.prepare(`
        INSERT INTO users (id, branch_id, role_id, username, password_hash, full_name, email, phone, preferred_language)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, branchId || null, role.id, payload.username, bcrypt.hashSync(payload.password, 10),
           payload.fullName, payload.email || null, payload.phone || null, payload.preferredLanguage || 'lo');
    return db.prepare('SELECT id, username, full_name, is_active FROM users WHERE id = ?').get(id);
}

function setActive(db, { id, isActive }) {
    session.requirePermission('user.manage');
    const sess = session.requireLogin();
    if (id === sess.user.id && !isActive) {
        throw Object.assign(new Error('CANNOT_DEACTIVATE_SELF'), { code: 'CANNOT_DEACTIVATE_SELF' });
    }
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id);
    return db.prepare('SELECT id, username, is_active FROM users WHERE id = ?').get(id);
}

function register(ipcMain, db) {
    ipcMain.handle('users:list', (e, args) => list(db, args));
    ipcMain.handle('users:create', (e, args) => create(db, args));
    ipcMain.handle('users:setActive', (e, args) => setActive(db, args));
}

module.exports = { register, list, create, setActive };
