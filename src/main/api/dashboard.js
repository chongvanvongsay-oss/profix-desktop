'use strict';

const session = require('../session');

function summary(db, { branchId } = {}) {
    session.requireLogin();
    const bClause = branchId ? 'AND branch_id = @branchId' : '';
    const params = { branchId };

    const stockByStatus = db.prepare(`
        SELECT vs.code AS status_code, COUNT(*) AS n
        FROM vehicles v JOIN vehicle_statuses vs ON vs.id = v.status_id
        WHERE 1=1 ${branchId ? 'AND v.branch_id = @branchId' : ''}
        GROUP BY vs.code
    `).all(params);

    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const monthlySales = db.prepare(`
        SELECT units_sold, total_revenue FROM v_monthly_sales_summary
        WHERE sales_month = ? ${branchId ? 'AND branch_id = @branchId' : ''}
    `).get(currentMonth, params) || { units_sold: 0, total_revenue: 0 };

    const dueFollowUps = db.prepare(`
        SELECT COUNT(*) AS n FROM follow_ups
        WHERE status = 'PENDING' AND scheduled_at < datetime('now')
    `).get();

    const agingStock = db.prepare(`
        SELECT COUNT(*) AS n FROM v_vehicle_aging
        WHERE days_in_stock > 60 ${branchId ? 'AND branch_id = @branchId' : ''}
    `).get(params);

    const result = {
        stockByStatus,
        monthlySales,
        dueFollowUpsCount: dueFollowUps.n,
        agingStockCount: agingStock.n,
    };

    if (session.can('report.view_financial')) {
        const currentMonthNum = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();
        result.expenseVsBudget = db.prepare(`
            SELECT * FROM v_expense_vs_budget WHERE year = ? AND month = ? ${branchId ? 'AND branch_id = @branchId' : ''}
        `).all(currentYear, currentMonthNum, params);

        const monthProfit = db.prepare(`
            SELECT COALESCE(SUM(gross_profit), 0) AS total_profit
            FROM v_vehicle_profit p
            JOIN sales s ON s.vehicle_id = p.vehicle_id AND s.status = 'COMPLETED'
            WHERE strftime('%Y-%m', s.sale_date) = ? ${branchId ? 'AND p.branch_id = @branchId' : ''}
        `).get(currentMonth, params);
        result.monthProfit = monthProfit.total_profit;
    }

    return result;
}

function register(ipcMain, db) {
    ipcMain.handle('dashboard:summary', (e, args) => summary(db, args));
}

module.exports = { register, summary };
