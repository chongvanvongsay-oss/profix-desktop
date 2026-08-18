'use strict';

const crypto = require('crypto');
const session = require('../session');

function uuid() { return crypto.randomUUID(); }
function today() { return new Date().toISOString().slice(0, 10); }

function list(db, { branchId, from, to } = {}) {
    session.requirePermission('sales.view');
    const clauses = [];
    const params = {};
    if (branchId) { clauses.push('s.branch_id = @branchId'); params.branchId = branchId; }
    if (from) { clauses.push('s.sale_date >= @from'); params.from = from; }
    if (to) { clauses.push('s.sale_date <= @to'); params.to = to; }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`
        SELECT s.id, s.sale_date, s.sale_price, s.status, v.model, v.year,
               c.full_name AS customer_name, u.full_name AS sales_user_name, pt.code AS payment_type_code
        FROM sales s
        JOIN vehicles v ON v.id = s.vehicle_id
        JOIN customers c ON c.id = s.customer_id
        JOIN users u ON u.id = s.sales_user_id
        JOIN payment_types pt ON pt.id = s.payment_type_id
        ${where}
        ORDER BY s.sale_date DESC, s.created_at DESC
    `).all(params);
}

function get(db, { id }) {
    session.requirePermission('sales.view');
    const sale = db.prepare(`
        SELECT s.*, pt.code AS payment_type_code
        FROM sales s JOIN payment_types pt ON pt.id = s.payment_type_id
        WHERE s.id = ?
    `).get(id);
    if (!sale) return null;
    if (session.can('vehicle.view_profit')) {
        sale.profit = db.prepare('SELECT * FROM v_vehicle_profit WHERE vehicle_id = ?').get(sale.vehicle_id) || null;
    }
    return sale;
}

/**
 * บันทึกการขาย (Business Rule 5): รถ 1 คันขายได้ 1 ครั้งต่อ record ที่ active
 * - เปลี่ยนสถานะรถเป็น SOLD พร้อมบันทึกประวัติ
 * - ถ้ามี trade-in: สร้างรถคันใหม่เข้าสต็อกจากการรับแลก (source_type = TRADE_IN)
 *   แล้วผูกกลับผ่าน sales.trade_in_vehicle_id
 */
function create(db, payload) {
    session.requirePermission('sales.manage');
    const sess = session.requireLogin();

    const vehicle = db.prepare('SELECT v.*, vs.code AS status_code FROM vehicles v JOIN vehicle_statuses vs ON vs.id = v.status_id WHERE v.id = ?').get(payload.vehicleId);
    if (!vehicle) throw Object.assign(new Error('VEHICLE_NOT_FOUND'), { code: 'VEHICLE_NOT_FOUND' });
    if (vehicle.status_code === 'SOLD') {
        throw Object.assign(new Error('VEHICLE_ALREADY_SOLD'), { code: 'VEHICLE_ALREADY_SOLD' });
    }

    const paymentType = db.prepare('SELECT id FROM payment_types WHERE code = ?').get(payload.paymentTypeCode);
    if (!paymentType) throw Object.assign(new Error('INVALID_PAYMENT_TYPE'), { code: 'INVALID_PAYMENT_TYPE' });

    const soldStatus = db.prepare("SELECT id FROM vehicle_statuses WHERE code = 'SOLD'").get();
    const saleId = uuid();

    const tx = db.transaction(() => {
        let tradeInVehicleId = null;
        if (payload.tradeIn && payload.tradeIn.model) {
            tradeInVehicleId = uuid();
            const tradeInSourceType = db.prepare("SELECT id FROM vehicle_source_types WHERE code = 'TRADE_IN'").get();
            const preparingStatus = db.prepare("SELECT id FROM vehicle_statuses WHERE code = 'PREPARING'").get();
            db.prepare(`
                INSERT INTO vehicles (id, branch_id, license_plate, make_other, model, year, mileage,
                    color, source_type_id, status_id, listing_price, acquisition_date, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(tradeInVehicleId, vehicle.branch_id, payload.tradeIn.licensePlate || null,
                   payload.tradeIn.make || null, payload.tradeIn.model, payload.tradeIn.year || null,
                   payload.tradeIn.mileage || null, payload.tradeIn.color || null,
                   tradeInSourceType.id, preparingStatus.id, payload.tradeIn.estimatedValue || null,
                   today(), sess.user.id);
            db.prepare(`
                INSERT INTO vehicle_status_history (id, vehicle_id, from_status_id, to_status_id, changed_by, note)
                VALUES (?, ?, NULL, ?, ?, 'รับเข้าจากการรับแลก (trade-in)')
            `).run(uuid(), tradeInVehicleId, preparingStatus.id, sess.user.id);
        }

        db.prepare(`
            INSERT INTO sales (id, branch_id, vehicle_id, customer_id, sales_user_id, sale_date,
                sale_price, payment_type_id, finance_institution_name, down_payment,
                trade_in_vehicle_id, status, created_by)
            VALUES (@id, @branchId, @vehicleId, @customerId, @salesUserId, @saleDate,
                @salePrice, @paymentTypeId, @financeInstitutionName, @downPayment,
                @tradeInVehicleId, 'COMPLETED', @createdBy)
        `).run({
            id: saleId,
            branchId: vehicle.branch_id,
            vehicleId: payload.vehicleId,
            customerId: payload.customerId,
            salesUserId: payload.salesUserId || sess.user.id,
            saleDate: payload.saleDate || today(),
            salePrice: payload.salePrice,
            paymentTypeId: paymentType.id,
            financeInstitutionName: payload.financeInstitutionName || null,
            downPayment: payload.downPayment || null,
            tradeInVehicleId,
            createdBy: sess.user.id,
        });

        if (payload.salesCommission) {
            const commissionType = db.prepare("SELECT id FROM vehicle_cost_types WHERE code = 'SALES_COMMISSION'").get();
            db.prepare(`
                INSERT INTO vehicle_costs (id, vehicle_id, cost_type_id, description, amount, cost_date, created_by)
                VALUES (?, ?, ?, 'ค่าคอมมิชชั่นพนักงานขาย', ?, ?, ?)
            `).run(uuid(), payload.vehicleId, commissionType.id, payload.salesCommission,
                   payload.saleDate || today(), sess.user.id);
        }

        db.prepare(`
            UPDATE vehicles SET status_id = ?, sold_date = ? WHERE id = ?
        `).run(soldStatus.id, payload.saleDate || today(), payload.vehicleId);

        db.prepare(`
            INSERT INTO vehicle_status_history (id, vehicle_id, from_status_id, to_status_id, changed_by, note)
            VALUES (?, ?, ?, ?, ?, 'ขายรถ')
        `).run(uuid(), payload.vehicleId, vehicle.status_id, soldStatus.id, sess.user.id);
    });
    tx();

    return get(db, { id: saleId });
}

function cancel(db, { id, reason }) {
    session.requirePermission('sales.manage');
    const sess = session.requireLogin();
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    if (!sale) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });

    const availableStatus = db.prepare("SELECT id FROM vehicle_statuses WHERE code = 'AVAILABLE'").get();
    const tx = db.transaction(() => {
        db.prepare("UPDATE sales SET status = 'CANCELLED' WHERE id = ?").run(id);
        const vehicle = db.prepare('SELECT status_id FROM vehicles WHERE id = ?').get(sale.vehicle_id);
        db.prepare('UPDATE vehicles SET status_id = ?, sold_date = NULL WHERE id = ?').run(availableStatus.id, sale.vehicle_id);
        db.prepare(`
            INSERT INTO vehicle_status_history (id, vehicle_id, from_status_id, to_status_id, changed_by, note)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(uuid(), sale.vehicle_id, vehicle.status_id, availableStatus.id, sess.user.id,
               `ยกเลิกการขาย: ${reason || ''}`);
    });
    tx();
    return get(db, { id });
}

function register(ipcMain, db) {
    ipcMain.handle('sales:list', (e, args) => list(db, args));
    ipcMain.handle('sales:get', (e, args) => get(db, args));
    ipcMain.handle('sales:create', (e, args) => create(db, args));
    ipcMain.handle('sales:cancel', (e, args) => cancel(db, args));
}

module.exports = { register, list, get, create, cancel };
