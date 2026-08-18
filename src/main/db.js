'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const Database = require('better-sqlite3');

/**
 * ตำแหน่งไฟล์ฐานข้อมูล — เก็บใน userData directory ของแต่ละเครื่อง
 * (Windows: %APPDATA%/profit-desktop, macOS: ~/Library/Application Support/profit-desktop)
 * นี่คือกลไก "offline-first" หลัก — ข้อมูลทั้งหมดอยู่ในเครื่อง ไม่ต้องพึ่ง server
 */
function getDbPath() {
    const userDataDir = app.getPath('userData');
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
    return path.join(userDataDir, 'profit.db');
}

function getMigrationsDir() {
    // dev: src/main/../db/migrations  |  packaged: resourcesPath/db/migrations (ดู extraResources ใน package.json)
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'db', 'migrations');
    }
    return path.join(__dirname, '..', 'db', 'migrations');
}

let dbInstance = null;

function runMigrations(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
    const dir = getMigrationsDir();
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
        if (applied.has(file)) continue;
        const sql = fs.readFileSync(path.join(dir, file), 'utf8');
        const applyOne = db.transaction(() => {
            db.exec(sql);
            db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(file);
        });
        applyOne();
        console.log(`[db] applied migration ${file}`);
    }
}

function getDb() {
    if (dbInstance) return dbInstance;
    const dbPath = getDbPath();
    dbInstance = new Database(dbPath);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
    runMigrations(dbInstance);
    return dbInstance;
}

module.exports = { getDb, getDbPath };
