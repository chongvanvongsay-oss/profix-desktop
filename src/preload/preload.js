'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// เรียก IPC แล้วแกะ envelope {ok, data} / {ok:false, error} — โยน Error จริงถ้า main process error
// เพื่อให้โค้ด renderer ใช้ try/catch ปกติได้ ไม่ต้องเช็ค .ok ทุกจุด
async function invoke(channel, args) {
    const res = await ipcRenderer.invoke(channel, args);
    if (res && typeof res === 'object' && 'ok' in res) {
        if (!res.ok) {
            const err = new Error(res.error.message);
            err.code = res.error.code;
            throw err;
        }
        return res.data;
    }
    return res;
}

contextBridge.exposeInMainWorld('api', {
    auth: {
        needsSetup: () => invoke('auth:needsSetup'),
        setup: (payload) => invoke('auth:setup', payload),
        login: (payload) => invoke('auth:login', payload),
        logout: () => invoke('auth:logout'),
        currentUser: () => invoke('auth:currentUser'),
    },
    lookups: {
        all: (lang) => invoke('lookups:all', { lang }),
    },
    vehicles: {
        list: (args) => invoke('vehicles:list', args),
        get: (id) => invoke('vehicles:get', { id }),
        create: (payload) => invoke('vehicles:create', payload),
        updateStatus: (payload) => invoke('vehicles:updateStatus', payload),
        addCost: (payload) => invoke('vehicles:addCost', payload),
    },
    customers: {
        list: (args) => invoke('customers:list', args),
        get: (id) => invoke('customers:get', { id }),
        create: (payload) => invoke('customers:create', payload),
    },
    followUps: {
        create: (payload) => invoke('followups:create', payload),
        complete: (payload) => invoke('followups:complete', payload),
        due: (args) => invoke('followups:due', args),
    },
    sales: {
        list: (args) => invoke('sales:list', args),
        get: (id) => invoke('sales:get', { id }),
        create: (payload) => invoke('sales:create', payload),
        cancel: (payload) => invoke('sales:cancel', payload),
    },
    expenses: {
        list: (args) => invoke('expenses:list', args),
        create: (payload) => invoke('expenses:create', payload),
        setBudget: (payload) => invoke('expenses:setBudget', payload),
        vsBudget: (args) => invoke('expenses:vsBudget', args),
    },
    dashboard: {
        summary: (args) => invoke('dashboard:summary', args),
    },
    users: {
        list: (args) => invoke('users:list', args),
        create: (payload) => invoke('users:create', payload),
        setActive: (payload) => invoke('users:setActive', payload),
    },
    reports: {
        monthlySales: (args) => invoke('reports:monthlySales', args),
        vehicleAging: (args) => invoke('reports:vehicleAging', args),
        salesRepPerformance: (args) => invoke('reports:salesRepPerformance', args),
        leadSourceEffectiveness: (args) => invoke('reports:leadSourceEffectiveness', args),
        expenseVsBudget: (args) => invoke('reports:expenseVsBudget', args),
    },
    updater: {
        check: () => invoke('updater:check'),
        quitAndInstall: () => invoke('updater:quitAndInstall'),
        openReleases: () => invoke('updater:openReleases'),
        getVersion: () => invoke('app:getVersion'),
        // event ผลักจาก main process ตรงๆ (checking/available/downloading/downloaded/
        // not-available/error/mac-fallback/dev-mode) — ไม่ผ่าน invoke() เพราะเป็น push
        // event ไม่ใช่ request/response คืนฟังก์ชัน unsubscribe ให้เรียกตอน unmount
        onStatus: (callback) => {
            const handler = (event, payload) => callback(payload);
            ipcRenderer.on('updater:status', handler);
            return () => ipcRenderer.removeListener('updater:status', handler);
        },
    },
});
