'use strict';

// รายการ lookup ทั้งหมดที่ต้องใช้ dropdown ในหน้าจอต่างๆ — ผูก table+translation table
// ตามหลักการ "ตาราง code + ตารางคำแปล" ของ PHASE 2 หัวข้อ 1
const LOOKUPS = {
    vehicleMakes:      { table: 'vehicle_makes',        transTable: 'vehicle_make_translations',        fk: 'make_id' },
    vehicleStatuses:   { table: 'vehicle_statuses',      transTable: 'vehicle_status_translations',      fk: 'status_id' },
    sourceTypes:       { table: 'vehicle_source_types',  transTable: 'vehicle_source_type_translations',  fk: 'source_type_id' },
    costTypes:         { table: 'vehicle_cost_types',    transTable: 'vehicle_cost_type_translations',    fk: 'cost_type_id' },
    leadSources:       { table: 'lead_sources',          transTable: 'lead_source_translations',          fk: 'lead_source_id' },
    leadStatuses:      { table: 'lead_statuses',          transTable: 'lead_status_translations',          fk: 'lead_status_id' },
    paymentTypes:      { table: 'payment_types',          transTable: 'payment_type_translations',         fk: 'payment_type_id' },
    expenseCategories: { table: 'expense_categories',    transTable: 'expense_category_translations',      fk: 'category_id' },
    roles:             { table: 'roles',                  transTable: 'role_translations',                 fk: 'role_id' },
};

function fetchOne(db, def, lang) {
    return db.prepare(`
        SELECT t.id, t.code, COALESCE(tr.name, tr_en.name, t.code) AS name
        FROM ${def.table} t
        LEFT JOIN ${def.transTable} tr ON tr.${def.fk} = t.id AND tr.lang_code = ?
        LEFT JOIN ${def.transTable} tr_en ON tr_en.${def.fk} = t.id AND tr_en.lang_code = 'en'
        ORDER BY t.code
    `).all(lang);
}

function fetchAll(db, lang) {
    const out = {};
    for (const [key, def] of Object.entries(LOOKUPS)) {
        out[key] = fetchOne(db, def, lang);
    }
    out.languages = db.prepare('SELECT code, name, is_default FROM languages ORDER BY code').all();
    return out;
}

function register(ipcMain, db) {
    ipcMain.handle('lookups:all', (event, { lang }) => fetchAll(db, lang || 'lo'));
}

module.exports = { register, fetchAll };
