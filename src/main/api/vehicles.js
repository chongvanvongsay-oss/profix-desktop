'use strict';

const crypto = require('crypto');
const session = require('../session');

function uuid() { return crypto.randomUUID(); }

function list(db, { branchId, statusCode, search } = {}) {
    session.requirePermission('vehicle.view');
    const clauses = [];
    const params = {};
    if (branchId) { clauses.push('v.branch_id = @branchId'); params.branchId = branchId; }
    if (statusCode) { clauses.push('vs.code = @statusCode'); params.statusCode = statusCode; }
    if (search) {
        clauses.push('(v.model LIKE @search OR v.license_plate LIKE @search OR v.vin LIKE @search)');
        params.search = `%${search}%`;
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`
        SELECT v.id, v.branch_id, v.model, v.year, v.mileage, v.color, v.license_plate, v.vin,
               v.listing_price, v.acquisition_date, v.sold_date,
               vs.code AS status_code, COALESCE(vst.name, vs.code) AS status_name,
               COALESCE(vm.code, v.make_other) AS make_name
        FROM vehicles v
        JOIN vehicle_statuses vs ON vs.id = v.status_id
        LEFT JOIN vehicle_status_translations vst ON vst.status_id = vs.id AND vst.lang_code = 'lo'
        LEFT JOIN vehicle_makes vm ON vm.id = v.make_id
        ${where}
        ORDER BY v.created_at DESC
    `).all(params);
}

function get(db, { id }) {
    session.requirePermission('vehicle.view');
    const vehicle = db.prepare(`
        SELECT v.*, vs.code AS status_code, COALESCE(vm.code, v.make_other) AS make_name,
               vst.code AS source_type_code
        FROM vehicles v
        JOIN vehicle_statuses vs ON vs.id = v.status_id
        JOIN vehicle_source_types vst ON vst.id = v.source_type_id
        LEFT JOIN vehicle_makes vm ON vm.id = v.make_id
        WHERE v.id = ?
    `).get(id);
    if (!vehicle) return null;

    const result = { ...vehicle };

    if (session.can('vehicle.view_cost')) {
        result.costs = db.prepare(`
            SELECT vc.id, vc.amount, vc.description, vc.cost_date, ct.code AS cost_type_code
            FROM vehicle_costs vc
            JOIN vehicle_cost_types ct ON ct.id = vc.cost_type_id
            WHERE vc.vehicle_id = ?
            ORDER BY vc.cost_date DESC
        `).all(id);
        result.totalCost = result.costs.reduce((sum, c) => sum + c.amount, 0);
    }

    if (session.can('vehicle.view_profit')) {
        result.profit = db.prepare('SELECT * FROM v_vehicle_profit WHERE vehicle_id = ?').get(id) || null;
    }

    result.statusHistory = db.prepare(`
        SELECT h.changed_at, h.note, fs.code AS from_status_code, ts.code AS to_status_code
        FROM vehicle_status_history h
        LEFT JOIN vehicle_statuses fs ON fs.id = h.from_status_id
        JOIN vehicle_statuses ts ON ts.id = h.to_status_id
        WHERE h.vehicle_id = ?
        ORDER BY h.changed_at DESC
    `).all(id);

    return result;
}

function create(db, payload) {
    session.requirePermission('vehicle.manage');
    const sess = session.requireLogin();
    const id = uuid();
    const branchId = payload.branchId || sess.user.branch_id;
    if (!branchId) throw Object.assign(new Error('BRANCH_REQUIRED'), { code: 'BRANCH_REQUIRED' });

    const statusRow = db.prepare("SELECT id FROM vehicle_statuses WHERE code = 'PREPARING'").get();
    const sourceType = db.prepare('SELECT id FROM vehicle_source_types WHERE code = ?').get(payload.sourceTypeCode || 'PURCHASE');
    if (!sourceType) throw Object.assign(new Error('INVALID_SOURCE_TYPE'), { code: 'INVALID_SOURCE_TYPE' });

    const tx = db.transaction(() => {
        db.prepare(`
            INSERT INTO vehicles (id, branch_id, vin, license_plate, make_id, make_other, model, year,
                mileage, color, engine_no, source_type_id, status_id, listing_price, acquisition_date,
                notes, created_by)
            VALUES (@id, @branchId, @vin, @licensePlate, @makeId, @makeOther, @model, @year,
                @mileage, @color, @engineNo, @sourceTypeId, @statusId, @listingPrice, @acquisitionDate,
                @notes, @createdBy)
        `).run({
            id, branchId,
            vin: payload.vin || null,
            licensePlate: payload.licensePlate || null,
            makeId: payload.makeId || null,
            makeOther: payload.makeOther || null,
            model: payload.model,
            year: payload.year || null,
            mileage: payload.mileage || null,
            color: payload.color || null,
            engineNo: payload.engineNo || null,
            sourceTypeId: sourceType.id,
            statusId: statusRow.id,
            listingPrice: payload.listingPrice || null,
            acquisitionDate: payload.acquisitionDate || new Date().toISOString().slice(0, 10),
            notes: payload.notes || null,
            createdBy: sess.user.id,
        });

        db.prepare(`
            INSERT INTO vehicle_status_history (id, vehicle_id, from_status_id, to_status_id, changed_by, note)
            VALUES (?, ?, NULL, ?, ?, 'สร้างรถใหม่เข้าสต็อก')
        `).run(uuid(), id, statusRow.id, sess.user.id);

        if (payload.purchaseCost && session.can('vehicle.manage')) {
            const purchaseCostType = db.prepare("SELECT id FROM vehicle_cost_types WHERE code = 'PURCHASE'").get();
            db.prepare(`
                INSERT INTO vehicle_costs (id, vehicle_id, cost_type_id, description, amount, cost_date, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(uuid(), id, purchaseCostType.id, 'ราคาซื้อเข้า', payload.purchaseCost,
                   payload.acquisitionDate || new Date().toISOString().slice(0, 10), sess.user.id);
        }
    });
    tx();
    return get(db, { id });
}

function updateStatus(db, { id, statusCode, note, reservedUntil, reservedByCustomerId }) {
    session.requirePermission('vehicle.manage');
    const sess = session.requireLogin();
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
    if (!vehicle) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    const newStatus = db.prepare('SELECT id FROM vehicle_statuses WHERE code = ?').get(statusCode);
    if (!newStatus) throw Object.assign(new Error('INVALID_STATUS'), { code: 'INVALID_STATUS' });

    const tx = db.transaction(() => {
        db.prepare(`
            UPDATE vehicles SET status_id = ?, reserved_until = ?, reserved_by_customer_id = ?,
                sold_date = CASE WHEN ? = 'SOLD' THEN date('now') ELSE sold_date END
            WHERE id = ?
        `).run(newStatus.id, reservedUntil || null, reservedByCustomerId || null, statusCode, id);

        db.prepare(`
            INSERT INTO vehicle_status_history (id, vehicle_id, from_status_id, to_status_id, changed_by, note)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(uuid(), id, vehicle.status_id, newStatus.id, sess.user.id, note || null);
    });
    tx();
    return get(db, { id });
}

function addCost(db, { vehicleId, costTypeCode, description, amount, costDate }) {
    session.requirePermission('vehicle.manage');
    const sess = session.requireLogin();
    const costType = db.prepare('SELECT id FROM vehicle_cost_types WHERE code = ?').get(costTypeCode);
    if (!costType) throw Object.assign(new Error('INVALID_COST_TYPE'), { code: 'INVALID_COST_TYPE' });
    const id = uuid();
    db.prepare(`
        INSERT INTO vehicle_costs (id, vehicle_id, cost_type_id, description, amount, cost_date, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, vehicleId, costType.id, description || null, amount, costDate || new Date().toISOString().slice(0, 10), sess.user.id);
    return get(db, { id: vehicleId });
}

function register(ipcMain, db) {
    ipcMain.handle('vehicles:list', (e, args) => list(db, args));
    ipcMain.handle('vehicles:get', (e, args) => get(db, args));
    ipcMain.handle('vehicles:create', (e, args) => create(db, args));
    ipcMain.handle('vehicles:updateStatus', (e, args) => updateStatus(db, args));
    ipcMain.handle('vehicles:addCost', (e, args) => addCost(db, args));
}

module.exports = { register, list, get, create, updateStatus, addCost };
