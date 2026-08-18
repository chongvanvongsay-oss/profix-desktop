'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('./session');

function uuid() {
    return crypto.randomUUID();
}

function needsSetup(db) {
    const row = db.prepare('SELECT COUNT(*) AS n FROM users').get();
    return row.n === 0;
}

/**
 * ตั้งค่าระบบครั้งแรก — สร้างสาขาแรก + บัญชีเจ้าของ (OWNER)
 * ตั้งใจไม่ seed บัญชีนี้มาล่วงหน้าใน migration/seed (ดู database/README.md ของ PHASE 2)
 * เพื่อไม่ให้มี credential ตั้งต้นฝังอยู่ในตัวติดตั้ง
 */
function setup(db, { branchName, branchCode, fullName, username, password, preferredLanguage }) {
    if (!branchName || !username || !password || !fullName) {
        throw Object.assign(new Error('MISSING_FIELDS'), { code: 'MISSING_FIELDS' });
    }
    if (password.length < 6) {
        throw Object.assign(new Error('PASSWORD_TOO_SHORT'), { code: 'PASSWORD_TOO_SHORT' });
    }

    const ownerRole = db.prepare("SELECT id FROM roles WHERE code = 'OWNER'").get();
    if (!ownerRole) throw new Error('OWNER role not seeded — run migrations first');

    const branchId = uuid();
    const userId = uuid();
    const passwordHash = bcrypt.hashSync(password, 10);
    const lang = preferredLanguage || 'lo';

    const tx = db.transaction(() => {
        db.prepare(
            `INSERT INTO branches (id, code, name, is_active) VALUES (?, ?, ?, 1)`
        ).run(branchId, branchCode || 'BR001', branchName);

        db.prepare(
            `INSERT INTO users (id, branch_id, role_id, username, password_hash, full_name, preferred_language)
             VALUES (?, NULL, ?, ?, ?, ?, ?)` // branch_id = NULL: Owner เข้าถึงได้ทุกสาขา
        ).run(userId, ownerRole.id, username, passwordHash, fullName, lang);

        db.prepare(
            `INSERT INTO audit_logs (id, user_id, branch_id, entity_type, entity_id, action, changes_json)
             VALUES (?, ?, ?, 'branch', ?, 'create', ?)`
        ).run(uuid(), userId, branchId, branchId, JSON.stringify({ name: branchName, code: branchCode || 'BR001' }));
    });
    tx();

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    return session.setSession(db, user);
}

function login(db, { username, password }) {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !user.is_active) {
        throw Object.assign(new Error('INVALID_CREDENTIALS'), { code: 'INVALID_CREDENTIALS' });
    }
    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) {
        throw Object.assign(new Error('INVALID_CREDENTIALS'), { code: 'INVALID_CREDENTIALS' });
    }
    return session.setSession(db, user);
}

function logout() {
    session.clearSession();
}

function publicUser(sess) {
    if (!sess) return null;
    const { user, roleCode, permissions } = sess;
    return {
        id: user.id,
        branchId: user.branch_id,
        username: user.username,
        fullName: user.full_name,
        preferredLanguage: user.preferred_language,
        roleCode,
        permissions: Array.from(permissions),
    };
}

module.exports = { needsSetup, setup, login, logout, publicUser, uuid };
