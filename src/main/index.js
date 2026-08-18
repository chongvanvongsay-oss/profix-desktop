'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { getDb } = require('./db');
const auth = require('./auth');
const session = require('./session');
const lookups = require('./api/lookups');
const vehicles = require('./api/vehicles');
const customers = require('./api/customers');
const sales = require('./api/sales');
const expenses = require('./api/expenses');
const dashboard = require('./api/dashboard');
const users = require('./api/users');
const reports = require('./api/reports');
const updater = require('./updater');

let mainWindow = null;

function wrapHandler(fn) {
    // ห่อ error ให้เป็น plain object ที่ serialize ผ่าน IPC ได้ปลอดภัย พร้อม error code
    return async (...args) => {
        try {
            return { ok: true, data: await fn(...args) };
        } catch (err) {
            console.error('[ipc-error]', err);
            return { ok: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message } };
        }
    };
}

function registerAuthHandlers(db) {
    ipcMain.handle('auth:needsSetup', wrapHandler(async () => auth.needsSetup(db)));
    ipcMain.handle('auth:setup', wrapHandler(async (event, payload) => {
        const sess = auth.setup(db, payload);
        return auth.publicUser(sess);
    }));
    ipcMain.handle('auth:login', wrapHandler(async (event, payload) => {
        const sess = auth.login(db, payload);
        return auth.publicUser(sess);
    }));
    ipcMain.handle('auth:logout', wrapHandler(async () => {
        auth.logout();
        return true;
    }));
    ipcMain.handle('auth:currentUser', wrapHandler(async () => auth.publicUser(session.getSession())));
}

function registerModule(mod, ...args) {
    // ห่อทุก handler ที่ module ลงทะเบียนด้วย wrapHandler โดย proxy ipcMain.handle ชั่วคราว
    const originalHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, fn) => originalHandle(channel, wrapHandler(fn));
    mod.register(ipcMain, ...args);
    ipcMain.handle = originalHandle;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 1024,
        minHeight: 700,
        title: 'Pro Fix — ระบบติดตามรถและจัดการข้อมูลลูกค้า',
        backgroundColor: '#F5F8FC',
        icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
    const db = getDb();
    registerAuthHandlers(db);
    registerModule(lookups, db);
    registerModule(vehicles, db);
    registerModule(customers, db);
    registerModule(sales, db);
    registerModule(expenses, db);
    registerModule(dashboard, db);
    registerModule(users, db);
    registerModule(reports, db);
    registerModule(updater, app, () => mainWindow);

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // เช็คอัปเดตอัตโนมัติหลังเปิดแอปสักครู่ (เฉพาะ build ที่ package แล้ว) — ดีเลย์ให้
    // renderer โหลดเสร็จและ subscribe "updater:status" ก่อน event จะได้ไม่ตกหล่น
    if (app.isPackaged) {
        setTimeout(() => {
            updater.autoUpdater.checkForUpdatesAndNotify().catch((err) => {
                console.error('[updater] startup check failed', err);
            });
        }, 3000);
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
