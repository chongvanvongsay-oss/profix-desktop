'use strict';

// Auto-update ผ่าน electron-updater + GitHub Releases — ทำแบบเดียวกับที่ใช้ใน
// cs-inventory-desktop (โปรแกรมก่อนหน้า): เช็คอัตโนมัติหลังเปิดแอป + ปุ่ม
// "ตรวจสอบอัปเดต" ใน Settings ให้เช็คเองได้ตลอด
//
// ต้องมี repo จริงบน GitHub ตรงกับ owner/repo ด้านล่าง พร้อม release ที่แนบไฟล์
// installer (.exe / .dmg) + latest.yml / latest-mac.yml — ดูขั้นตอนสร้าง/publish
// ทั้งหมดใน RELEASING.md (ยังไม่มี repo นี้จริงตอนเขียนโค้ดนี้ — ต้องสร้างก่อนใช้งานจริง)
const { autoUpdater } = require('electron-updater');
const { shell } = require('electron');

const UPDATE_OWNER = 'chongvanvongsay-oss';
const UPDATE_REPO = 'profix-desktop';
const RELEASES_URL = `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function register(ipcMain, app, getWindow) {
    function sendStatus(payload) {
        console.log('[updater]', JSON.stringify(payload));
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send('updater:status', payload);
    }

    autoUpdater.on('checking-for-update', () => sendStatus({ state: 'checking' }));
    autoUpdater.on('update-available', (info) => sendStatus({ state: 'available', version: info.version }));
    autoUpdater.on('update-not-available', (info) => sendStatus({ state: 'not-available', version: info.version }));
    autoUpdater.on('download-progress', (progress) => sendStatus({
        state: 'downloading',
        percent: Math.round(progress.percent),
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
    }));
    autoUpdater.on('update-downloaded', (info) => sendStatus({ state: 'downloaded', version: info.version }));
    autoUpdater.on('error', (err) => {
        const message = String(err && err.message ? err.message : err);
        sendStatus({ state: 'error', message });
        // build ของ Mac ยังไม่ได้เซ็น Apple Developer ID (build.mac.identity = null
        // ใน package.json) — ตัวติดตั้งอัปเดตฝั่ง Mac (Squirrel.Mac) ต้องตรวจลายเซ็น
        // ก่อนแทนที่แอปที่รันอยู่เสมอ แอปที่ไม่ได้เซ็นจะ error ตรงจุดนี้แน่ๆ ถึงแม้ขั้นตอน
        // เช็คว่ามีเวอร์ชันใหม่ไหมจะผ่านปกติก็ตาม จึง fallback ไปเปิดหน้า GitHub Releases
        // ให้ผู้ใช้โหลด/ติดตั้งเองแทนการปล่อย error ดิบๆ ไว้
        if (process.platform === 'darwin') {
            sendStatus({ state: 'mac-fallback', message, releasesUrl: RELEASES_URL });
        }
    });

    function checkForUpdates() {
        // electron-updater อ่านไฟล์ app-update.yml จาก resources ของแอปที่ติดตั้งแล้ว
        // เท่านั้น — รันผ่าน `npm start` (unpacked) จะไม่มีไฟล์นี้ จึงตอบสถานะ dev-mode
        // ไปตรงๆ แทนที่จะปล่อยให้ error ดิบๆ ออกไป
        if (!app.isPackaged) {
            sendStatus({ state: 'dev-mode' });
            return Promise.resolve();
        }
        return autoUpdater.checkForUpdates().catch((err) => {
            sendStatus({ state: 'error', message: String(err && err.message ? err.message : err) });
        });
    }

    ipcMain.handle('updater:check', () => checkForUpdates());
    ipcMain.handle('updater:quitAndInstall', () => autoUpdater.quitAndInstall());
    ipcMain.handle('updater:openReleases', () => shell.openExternal(RELEASES_URL));
    ipcMain.handle('app:getVersion', () => app.getVersion());
}

module.exports = { register, autoUpdater, RELEASES_URL };
