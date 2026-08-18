# Pro Fix Desktop

แอปพลิเคชันเดสก์ท็อปจริง (ติดตั้งได้บน **Windows** และ **macOS**) ของระบบติดตามรถและจัดการข้อมูลลูกค้า
สร้างจาก [`docs/PHASE2_Database_Design.md`](../docs/PHASE2_Database_Design.md) — offline-first,
ข้อมูลทั้งหมดเก็บในเครื่องผู้ใช้ ไม่ต้องมี server แยก (ชื่อโค้ด/โฟลเดอร์เดิมมาจาก "PROFIT" ก่อน rebrand
เป็น "Pro Fix" — ฐานข้อมูล/ตัวแปรภายในบางจุดยังใช้ชื่อเดิม แต่ไม่กระทบการใช้งาน)

## สแตกที่ใช้

| ส่วน | เทคโนโลยี | เหตุผล |
|---|---|---|
| Shell | [Electron](https://www.electronjs.org/) | แพ็กเป็นตัวติดตั้งได้ทั้ง `.exe` (Windows/NSIS) และ `.dmg` (macOS) จากโค้ดเดียว |
| ฐานข้อมูล | SQLite ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)) | embedded ในเครื่อง — ไม่ต้องติดตั้ง/รัน DB server แยก ตอบโจทย์ offline-first ของ PHASE 1 |
| Renderer | HTML/CSS/JS ล้วน (ไม่มี bundler/framework) | ลดความเสี่ยงจาก build tool chain, เปิดไฟล์ตรงๆ ก็ debug ได้ |
| Password hashing | bcryptjs | pure JS ไม่ต้อง compile native เพิ่ม |
| Packaging | electron-builder | ออก `.dmg` (mac, x64+arm64) และ NSIS `.exe` (Windows x64) |

โครงสร้าง schema เป็นการแปลง [`database/`](../database/) (PostgreSQL, เดิมออกแบบไว้สำหรับ server)
มาเป็น SQLite สำหรับใช้งานเดี่ยวบนเครื่อง — ดูรายละเอียดการแปลงที่หัวไฟล์
[`src/db/migrations/001_init.sql`](src/db/migrations/001_init.sql)

## โครงสร้างโค้ด

```
app/
├── src/
│   ├── main/            Electron main process (Node) — db, auth, session, IPC handlers
│   │   ├── api/          vehicles.js, customers.js, sales.js, expenses.js, dashboard.js, lookups.js, users.js, reports.js
│   │   └── updater.js    electron-updater + GitHub Releases (ดู RELEASING.md)
│   ├── preload/          contextBridge — เปิดเฉพาะ window.api.* ให้ renderer เรียก (ไม่เปิด Node เต็ม)
│   ├── renderer/          SPA (vanilla JS, hash-less router ผ่าน state)
│   │   ├── js/            i18n.js (lo/th/en/zh), app.js (ทุก view รวมแผง "ตรวจสอบอัปเดต" ใน Settings)
│   │   └── assets/        logo.png (โลโก้ที่ใช้ใน sidebar/login/setup)
│   └── db/
│       └── migrations/    001_init.sql (schema), 002_seed.sql (lookup 4 ภาษา)
├── scripts/
│   ├── bump-version.js    บั๊มเวอร์ชัน major-only ก่อน build ทุกครั้ง (1.0.0 -> 2.0.0)
│   ├── clean-unpacked.js  ล้างโฟลเดอร์ unpacked เก่าใน release/ ก่อน build
│   └── prune-releases.js  เก็บ release/ ไว้แค่ 2 เวอร์ชันล่าสุด
├── test/
│   ├── db.test.js         ทดสอบ schema + business rules จริงด้วย better-sqlite3 (18 assertions)
│   └── run.js              wrapper รัน test ผ่าน Electron's Node runtime (ข้าม platform)
├── RELEASING.md          ขั้นตอน one-time setup + publish อัปเดตขึ้น GitHub Releases
└── .github/workflows/build.yml   CI: build .dmg + .exe บน runner จริงของแต่ละ OS
```

## รันตอนพัฒนา (dev)

```bash
cd app
npm install
npm start
```

หน้าจอแรกที่เจอคือ **"ตั้งค่าระบบครั้งแรก"** — กรอกชื่อสาขา + สร้างบัญชีเจ้าของ (Owner) เอง
(ตั้งใจไม่ seed บัญชีมาให้ล่วงหน้า เพื่อไม่ให้มี credential ตั้งต้นฝังอยู่ในตัวติดตั้ง)

## ทดสอบ

```bash
npm test
```

รัน `test/db.test.js` ผ่าน Electron's Node runtime (จำเป็นเพราะ `better-sqlite3` ถูก
rebuild ให้ตรงกับ ABI ของ Electron ตอน `postinstall`) — ครอบคลุม schema, seed data,
permission-override logic, และบั๊ก 3 จุดที่เคยแก้ไว้ตอนทำ [`database/`](../database/README.md)
(partial unique index ของ `sales`/`budgets`, cartesian-join ใน view รายงาน)

## Build ตัวติดตั้ง

```bash
npm run dist:mac    # -> release/Pro Fix-<version>.dmg (x64) และ -arm64.dmg
npm run dist:win    # -> release/Pro Fix Setup <version>.exe
npm run dist:all    # ทั้งคู่ในคำสั่งเดียว
```

**อัปเดต:** ก่อนหน้านี้เอกสารนี้เคยระบุว่า build `.exe` ข้าม OS จาก macOS ต้องมี Wine — ทดสอบจริงแล้วว่า
**ไม่จำเป็น** electron-builder รุ่นนี้ (24.13.3) มี `makensis` แบบพกพาสำหรับ macOS มาในตัว จึง
`npm run dist:win` รันบนเครื่อง macOS เครื่องนี้ได้ตรงๆ สำเร็จ ได้ไฟล์ `.exe` จริง (PE32 NSIS installer,
ตรวจด้วย `file` แล้ว) โดยไม่ต้องพึ่ง Windows หรือ Wine เลย — ยังคงเก็บ [`.github/workflows/build.yml`](.github/workflows/build.yml)
ไว้เป็นทางเลือกสำรอง (build บน runner จริงของแต่ละ OS ผ่าน GitHub Actions) เผื่อเครื่อง dev อื่นไม่มี
ความสามารถนี้

**หมายเหตุ:** ทุกครั้งที่สลับ build platform (`--mac` ↔ `--win`) electron-builder จะ rebuild
`better-sqlite3` (native module) ให้ตรงกับ platform ปลายทางนั้น ซึ่งจะทำให้รัน `npm start`/`npm test`
บนเครื่อง dev ไม่ได้ชั่วคราว (native binary ไม่ตรง arch) — รัน `npx electron-builder install-app-deps`
เพื่อ rebuild กลับให้ตรงกับเครื่องตัวเองก่อนกลับไป dev ต่อ

### ผลทดสอบ build จริงบนเครื่องนี้ (macOS, arm64)

รัน `npx electron-builder --mac` แล้ว mount `.dmg` ที่ได้ตรวจสอบว่า:
- ได้ `Pro Fix.app` (Mach-O, ad-hoc signed) จริง ลากไป `/Applications` ได้ตามปกติของ macOS
- เปิดแอปจากใน `.dmg` ตรงๆ แล้วขึ้นหน้าจอ "ตั้งค่าระบบครั้งแรก" ถูกต้อง, เมนูบาร์แสดงชื่อ "Pro Fix" ตาม `productName`
- **ไม่ได้เซ็นด้วย Apple Developer certificate** (ไม่มีบัญชี Apple Developer ให้ใช้ในสภาพแวดล้อมนี้) —
  เมื่อผู้ใช้เปิดแอปครั้งแรกบนเครื่อง Mac อื่น macOS Gatekeeper จะเตือนว่า "ไม่รู้จักนักพัฒนา"
  ต้องคลิกขวา → Open (แทนดับเบิลคลิก) ในครั้งแรกเท่านั้น — เป็นพฤติกรรมปกติของแอปที่ไม่ได้ notarize
- **`.exe` ไม่ได้เซ็นด้วย code-signing certificate ของ Windows เช่นกัน** — Windows SmartScreen อาจเตือน
  "Unknown publisher" ตอนรันครั้งแรก ต้องกด "More info" → "Run anyway" เพื่อเลี่ยงต้องซื้อ Windows
  code-signing certificate มาเซ็นเพิ่ม (และฝั่ง mac ต้องมีบัญชี Apple Developer Program แบบเสียเงินรายปี
  มาเซ็น+notarize ถ้าจะเลี่ยงคำเตือนของ Gatekeeper) — ทั้งสองอย่างยังไม่ได้ตั้งค่าไว้ในโปรเจกต์นี้

## อัปเดตอัตโนมัติ (Auto-update)

แอปเช็คอัปเดตอัตโนมัติหลังเปิดใช้งาน (แค่ build ที่ package แล้ว ไม่ใช่ `npm start`) และมีปุ่ม
**"ตรวจสอบอัปเดต"** ให้เช็คเองได้ที่หน้า Settings — ใช้ [`electron-updater`](https://www.electron.build/auto-update)
อ่านจาก GitHub Releases ตามแบบเดียวกับ `cs-inventory-desktop` (โปรแกรมก่อนหน้า) เป๊ะๆ

**✅ ใช้งานได้จริงแล้ว** — repo [`chongvanvongsay-oss/profix-desktop`](https://github.com/chongvanvongsay-oss/profix-desktop)
มี release `v2.0.0` เผยแพร่จริงอยู่ (พร้อม `.exe`/`.dmg`/`latest.yml`/`latest-mac.yml` ครบ) ตรวจสอบผ่าน
GitHub API แล้วว่ามีจริง — แอปเวอร์ชันเก่ากว่านี้ (เช่น v1.0.0 ที่เคย build ไว้ก่อนหน้า) เปิดขึ้นมาจะเจอ
อัปเดตให้โหลดทันที ครั้งต่อไปที่จะออกเวอร์ชันใหม่ ดูขั้นตอนใน [`RELEASING.md`](RELEASING.md)

## ขอบเขตฟีเจอร์ในเวอร์ชันนี้ (v0.1.0)

ครอบคลุม 7 โมดูลใน PHASE 1: จัดการรถ (สร้าง/ต้นทุน/เปลี่ยนสถานะ), CRM (ลูกค้า/ติดตาม),
การขาย (บันทึกขาย/trade-in/ยกเลิก), ต้นทุน-กำไรต่อคัน, ค่าใช้จ่าย, รายงาน (Module 6-7 ผ่าน view SQL),
Dashboard สรุป, จัดการผู้ใช้งานเบื้องต้น, สิทธิ์แบบ Role+Override ตาม PHASE 2

**ยังไม่ทำในเวอร์ชันนี้** (โครงสร้างฐานข้อมูลรองรับไว้แล้ว แต่ยังไม่มี UI):
- พิมพ์เอกสาร (ใบเสนอราคา/สัญญา/ใบเสร็จ) — ตาราง `sale_documents` มีแล้ว รอ template จริงจาก PHASE 1 ข้อ 7.4
- อัปโหลดรูปภาพ/ไฟล์แนบ — ตาราง `attachments` มีแล้ว รอ UI
- แก้ไข/ปิดใช้งานสิทธิ์รายคนผ่าน UI (override `user_permissions`) — ตอนนี้ทำได้แค่ผ่าน role ที่กำหนดตอนสร้างผู้ใช้
- Multi-branch UI (สลับสาขา, มุมมองรวมของ Owner) — schema รองรับ (`branch_id` ทุกตาราง) แต่ UI ยังเป็นสาขาเดียว
- Scheduled job auto-revert สถานะจองที่หมดอายุ (Business Rule 2)
- แผนที่ติดตามรถใน Dashboard เป็นภาพประกอบ (illustrative) ยังไม่ใช่แผนที่จริงที่ผูกกับ GPS — ระบบยังไม่มีข้อมูลตำแหน่งจริง
- จัดการผู้ใช้/สิทธิ์ผ่าน UI (ตอนนี้มีแค่บัญชี Owner จาก setup — เพิ่มผู้ใช้อื่นต้องเขียนลง DB ตรงๆ)
