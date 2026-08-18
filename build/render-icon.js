// รัน SVG โลโก้เป็น PNG ความละเอียดสูง โดยใช้ Electron เอง rasterize (ไม่มี rsvg-convert/imagemagick
// ในเครื่องนี้) — รันแบบแอปจริง (ไม่ใช่ ELECTRON_RUN_AS_NODE) เพราะต้องใช้ BrowserWindow จริง
'use strict';
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const SIZE = 1024;

app.whenReady().then(async () => {
    const svg = fs.readFileSync(path.join(__dirname, 'icon-source.svg'), 'utf8');
    const html = `<!doctype html><html><head><style>
        html,body{margin:0;padding:0;width:${SIZE}px;height:${SIZE}px;background:transparent;}
        svg{width:${SIZE}px;height:${SIZE}px;display:block;}
    </style></head><body>${svg}</body></html>`;
    const tmpHtml = path.join(__dirname, '_icon_render.html');
    fs.writeFileSync(tmpHtml, html);

    const win = new BrowserWindow({
        width: SIZE, height: SIZE, show: false, transparent: true, frame: false,
        useContentSize: true, backgroundColor: '#00000000',
        webPreferences: { offscreen: false },
    });
    win.setContentSize(SIZE, SIZE);
    await win.loadFile(tmpHtml);
    await new Promise((r) => setTimeout(r, 200));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'icon.png'), image.toPNG());
    fs.unlinkSync(tmpHtml);
    console.log('wrote build/icon.png', image.getSize());
    app.quit();
});
