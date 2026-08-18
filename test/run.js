// Wrapper ข้าม platform สำหรับรัน db.test.js ผ่าน Electron's Node runtime
// (better-sqlite3 ถูก rebuild ให้ตรง ABI ของ Electron ตอน postinstall จึงรันด้วย
// plain `node` ไม่ได้ — ต้องใช้ ELECTRON_RUN_AS_NODE=1 กับ electron binary แทน
// เขียนเป็น .js แทนการ set env var ใน shell script เพื่อให้ทำงานเหมือนกันทั้ง
// Windows (cmd/PowerShell) และ macOS/Linux (bash) โดยไม่ต้องพึ่ง cross-env)
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const electronPath = require('electron');

const result = spawnSync(electronPath, [path.join(__dirname, 'db.test.js')], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
process.exit(result.status === null ? 1 : result.status);
