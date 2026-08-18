'use strict';

/**
 * Session ปัจจุบันของแอป (desktop เดี่ยว — มี user login ได้ทีละคนต่อ instance)
 * เก็บ user + effective permission set ไว้ในหน่วยความจำของ main process
 * (ไม่ใช่ renderer) เพื่อให้การตรวจสิทธิ์สำคัญๆ ทำที่ main process เสมอ
 * ตรงตามหลักการ PHASE 2 หัวข้อ 3.0:
 *   effective = user_permissions[user, perm] ?? role_permissions[user.role, perm] ?? false
 */

let current = null; // { user, roleCode, permissions: Set<string> }

function computeEffectivePermissions(db, userId, roleId) {
    const roleCodes = db.prepare(
        `SELECT p.code FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = ?`
    ).all(roleId).map(r => r.code);

    const overrides = db.prepare(
        `SELECT p.code, up.is_allowed FROM user_permissions up
         JOIN permissions p ON p.id = up.permission_id
         WHERE up.user_id = ?`
    ).all(userId);

    const effective = new Set(roleCodes);
    for (const o of overrides) {
        if (o.is_allowed) effective.add(o.code);
        else effective.delete(o.code);
    }
    return effective;
}

function setSession(db, user) {
    const role = db.prepare('SELECT code FROM roles WHERE id = ?').get(user.role_id);
    const permissions = computeEffectivePermissions(db, user.id, user.role_id);
    current = { user, roleCode: role ? role.code : null, permissions };
    return current;
}

function clearSession() {
    current = null;
}

function getSession() {
    return current;
}

function requireLogin() {
    if (!current) {
        const err = new Error('NOT_AUTHENTICATED');
        err.code = 'NOT_AUTHENTICATED';
        throw err;
    }
    return current;
}

function can(permissionCode) {
    if (!current) return false;
    return current.permissions.has(permissionCode);
}

function requirePermission(permissionCode) {
    requireLogin();
    if (!can(permissionCode)) {
        const err = new Error(`FORBIDDEN: missing permission ${permissionCode}`);
        err.code = 'FORBIDDEN';
        throw err;
    }
}

module.exports = {
    setSession,
    clearSession,
    getSession,
    requireLogin,
    can,
    requirePermission,
    computeEffectivePermissions,
};
