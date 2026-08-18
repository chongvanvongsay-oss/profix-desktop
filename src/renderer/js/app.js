'use strict';

/* ============================================================
 * Pro Fix — Renderer app (vanilla JS, no bundler)
 * ทุกการเรียกข้อมูลผ่าน window.api.* (contextBridge จาก preload.js)
 * ============================================================ */

const state = {
  user: null,
  lookups: null,
  route: { view: 'dashboard', params: {} },
};

const root = document.getElementById('app');

// ---------- Helpers ----------
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtMoney(n) {
  if (n === null || n === undefined) return '-';
  return Number(n).toLocaleString() + ' ₭';
}
function fmtDate(s) { return s ? String(s).slice(0, 10) : '-'; }
function fmtDateTime(s) { return s ? String(s).slice(0, 16).replace('T', ' ') : '-'; }
function can(code) { return !!(state.user && state.user.permissions.includes(code)); }
function nameOf(list, code) {
  const item = (list || []).find((x) => x.code === code);
  return item ? item.name : code;
}
function toast(message, isError) {
  const div = document.createElement('div');
  div.className = 'toast' + (isError ? ' error' : '');
  div.textContent = message;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3200);
}
function humanizeError(err) {
  const known = {
    INVALID_CREDENTIALS: t('login_error'),
    MISSING_FIELDS: t('common_required'),
    VEHICLE_ALREADY_SOLD: 'รถคันนี้ถูกขายไปแล้ว',
    FORBIDDEN: 'คุณไม่มีสิทธิ์ทำรายการนี้',
  };
  return known[err.code] || err.message || String(err);
}

function openModal(titleHtml, bodyHtml) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal"><h2>${titleHtml}</h2><div class="modal-body">${bodyHtml}</div></div>`;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
  return {
    root: backdrop,
    body: backdrop.querySelector('.modal-body'),
    close: () => backdrop.remove(),
  };
}

async function withLoadingButton(btn, fn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('common_loading');
  try {
    await fn();
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ---------- Bootstrap ----------
async function boot() {
  const needsSetup = await window.api.auth.needsSetup();
  if (needsSetup) return renderSetup();
  const user = await window.api.auth.currentUser();
  if (user) {
    state.user = user;
    setLang(user.preferredLanguage || 'lo');
    await loadLookups();
    return renderShell();
  }
  return renderLogin();
}

async function loadLookups() {
  state.lookups = await window.api.lookups.all(currentLang);
}

// ---------- Auth screens ----------
function renderSetup() {
  root.innerHTML = `
    <div class="auth-shell"><div class="auth-card">
      <div class="pf-logo">${logoMark()}<span class="wordmark"><span class="pro">Pro</span><span class="fix">Fix</span></span></div>
      <h1>${t('setup_title')}</h1>
      <p class="subtitle">${t('setup_subtitle')}</p>
      <div id="setup-error"></div>
      <form id="setup-form">
        <div class="field"><label>${t('setup_branchName')}</label><input type="text" id="s-branchName" required></div>
        <div class="field-row">
          <div class="field"><label>${t('setup_branchCode')} ${t('common_optional')}</label><input type="text" id="s-branchCode" placeholder="BR001"></div>
          <div class="field"><label>${t('setup_language')}</label>
            <select id="s-lang">
              <option value="lo">ລາວ</option><option value="th">ไทย</option><option value="en">English</option><option value="zh">中文</option>
            </select>
          </div>
        </div>
        <div class="field"><label>${t('setup_fullName')}</label><input type="text" id="s-fullName" required></div>
        <div class="field"><label>${t('setup_username')}</label><input type="text" id="s-username" required></div>
        <div class="field"><label>${t('setup_password')}</label><input type="password" id="s-password" required minlength="6"></div>
        <button class="btn" type="submit" style="width:100%">${t('setup_submit')}</button>
      </form>
    </div></div>`;

  document.getElementById('s-lang').addEventListener('change', (e) => { setLang(e.target.value); renderSetup(); });

  document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById('setup-error');
    errorBox.innerHTML = '';
    try {
      const user = await window.api.auth.setup({
        branchName: document.getElementById('s-branchName').value.trim(),
        branchCode: document.getElementById('s-branchCode').value.trim(),
        fullName: document.getElementById('s-fullName').value.trim(),
        username: document.getElementById('s-username').value.trim(),
        password: document.getElementById('s-password').value,
        preferredLanguage: document.getElementById('s-lang').value,
      });
      state.user = user;
      setLang(user.preferredLanguage);
      await loadLookups();
      renderShell();
    } catch (err) {
      errorBox.innerHTML = `<div class="auth-error">${escapeHtml(humanizeError(err))}</div>`;
    }
  });
}

function renderLogin() {
  root.innerHTML = `
    <div class="auth-shell"><div class="auth-card">
      <div class="pf-logo">${logoMark()}<span class="wordmark"><span class="pro">Pro</span><span class="fix">Fix</span></span></div>
      <h1>${t('login_title')}</h1>
      <p class="subtitle">${t('setup_subtitle')}</p>
      <div id="login-error"></div>
      <form id="login-form">
        <div class="field"><label>${t('login_username')}</label><input type="text" id="l-username" required autofocus></div>
        <div class="field"><label>${t('login_password')}</label><input type="password" id="l-password" required></div>
        <button class="btn" type="submit" style="width:100%">${t('login_submit')}</button>
      </form>
    </div></div>`;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById('login-error');
    errorBox.innerHTML = '';
    try {
      const user = await window.api.auth.login({
        username: document.getElementById('l-username').value.trim(),
        password: document.getElementById('l-password').value,
      });
      state.user = user;
      setLang(user.preferredLanguage || 'lo');
      await loadLookups();
      renderShell();
    } catch (err) {
      errorBox.innerHTML = `<div class="auth-error">${escapeHtml(humanizeError(err))}</div>`;
    }
  });
}

// ---------- Icons (line icons, น้ำหนักเส้นเดียวกับโลโก้) ----------
const ICONS = {
  dashboard: '<path d="M3 11l9-7 9 7"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/>',
  vehicles: '<circle cx="6" cy="17" r="2"/><path d="M6 15V11c0-1.5 1-2 2-2h4c1.5 0 2-1 2-2V4"/><path d="M11 7l3-3 3 3"/>',
  customers: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 2.5-5 6-5s6 2 6 5"/><circle cx="17.5" cy="8.5" r="2.3"/><path d="M15.7 15.3c2.2.4 3.8 2.1 4.3 4.7"/>',
  sales: '<path d="M3 6h2l2 11h10l2-8H7"/><circle cx="9" cy="20" r="1.2"/><circle cx="16" cy="20" r="1.2"/>',
  expenses: '<path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5V3z"/><path d="M9 8h6M9 12h6"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-7"/><path d="M2 20h20"/>',
  users: '<circle cx="10" cy="8" r="3.2"/><path d="M4 20c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6"/><path d="M18 8v4M16 10h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.97 7.97 0 0 0 0-2l2-1.6-2-3.4-2.4.8a8 8 0 0 0-1.7-1L15 3h-4l-.3 2.5a8 8 0 0 0-1.7 1l-2.4-.8-2 3.4L6.6 11a7.97 7.97 0 0 0 0 2l-2 1.6 2 3.4 2.4-.8a8 8 0 0 0 1.7 1L11 21h4l.3-2.5a8 8 0 0 0 1.7-1l2.4.8 2-3.4-2-1.6z"/>',
  // ---- ไอคอนย่อยของกลุ่ม "รถ" — วาดด้วยเทคนิคเดียวกับไอคอนเดิมทุกประการ (24x24, stroke=currentColor,
  // stroke-width 1.8, ปลายเส้นมน) เพราะยังไม่เคยมีไอคอนสำหรับสถานะเหล่านี้ในโปรเจกต์มาก่อน
  running: '<path d="M3 12h4M3 8h3M3 16h3"/><path d="M11 12l7-5v10z"/>',
  waiting: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  inspect: '<circle cx="10" cy="10" r="6"/><path d="M14.3 14.3L20 20"/>',
};
function iconSvg(name) {
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}
function logoMark() {
  return `<div class="mark"><img src="assets/logo.png" alt="Pro Fix" /></div>`;
}

// ---------- Shell ----------
// กลุ่มเมนูหลัก 4 ปุ่ม + กลุ่มย่อย "รถ" 4 ปุ่ม (filter ของ vehicles.list ที่มีอยู่แล้ว)
// ตามที่ระบุ — ส่วนเมนูเดิมที่เหลือ (การขาย/ค่าใช้จ่าย/ผู้ใช้งาน/ตั้งค่า) ยังอยู่ครบใน
// กลุ่มที่ 3 แบบไม่มีหัวข้อ เพื่อไม่ตัดฟังก์ชันเดิมออกไป
const NAV_GROUP_MAIN = [
  { view: 'dashboard', icon: 'dashboard', label: 'nav_dashboard' },
  { view: 'vehicles', icon: 'vehicles', label: 'nav_vehicles' },
  { view: 'customers', icon: 'customers', label: 'nav_customers' },
  { view: 'reports', icon: 'reports', label: 'nav_reports' },
];
const NAV_GROUP_VEHICLES = [
  { view: 'vehicles', icon: 'vehicles', label: 'veh_all', statusCode: null },
  { view: 'vehicles', icon: 'running', label: 'veh_running', statusCode: 'AVAILABLE' },
  { view: 'vehicles', icon: 'waiting', label: 'veh_waiting', statusCode: 'PREPARING' },
  { view: 'vehicles', icon: 'inspect', label: 'veh_inspect', statusCode: 'WITHDRAWN', alert: true },
];
const NAV_GROUP_OTHER = [
  { view: 'sales', icon: 'sales', label: 'nav_sales' },
  { view: 'expenses', icon: 'expenses', label: 'nav_expenses' },
  { view: 'users', icon: 'users', label: 'nav_users', permission: 'user.manage' },
  { view: 'settings', icon: 'settings', label: 'nav_settings' },
];

function navItemHtml(item) {
  const cls = ['nav-item'];
  if (item.alert) cls.push('status-alert');
  const dataStatus = item.statusCode ? ` data-status="${item.statusCode}"` : '';
  return `<div class="${cls.join(' ')}" data-view="${item.view}"${dataStatus}>${iconSvg(item.icon)}<span>${t(item.label)}</span></div>`;
}

function renderShell() {
  root.innerHTML = `
    <div class="layout">
      <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
      <aside class="sidebar" id="sidebar">
        <div class="brand"><div class="pf-logo">${logoMark()}<span class="wordmark"><span class="pro">Pro</span><span class="fix">Fix</span></span></div></div>
        <nav id="sidebar-nav"></nav>
        <div class="footer"><div class="u-name">${escapeHtml(state.user.fullName)}</div>${escapeHtml(state.user.roleCode)}</div>
      </aside>
      <div class="main">
        <div class="topbar">
          <div class="left">
            <button class="hamburger" id="hamburger-btn" aria-label="menu">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
            </button>
            <div class="title" id="topbar-title"></div>
          </div>
          <div class="right">
            <select class="lang-select" id="topbar-lang">
              <option value="lo">ລາວ</option><option value="th">ไทย</option><option value="en">English</option><option value="zh">中文</option>
            </select>
            <button class="btn secondary" id="logout-btn">${t('nav_logout')}</button>
          </div>
        </div>
        <div class="content" id="content"></div>
      </div>
    </div>`;

  const nav = document.getElementById('sidebar-nav');
  const otherAllowed = NAV_GROUP_OTHER.filter((item) => !item.permission || can(item.permission));
  nav.innerHTML = `
    <div class="nav-group">
      <div class="nav-group-label">${t('nav_group_main')}</div>
      ${NAV_GROUP_MAIN.map(navItemHtml).join('')}
    </div>
    <div class="nav-group">
      <div class="nav-group-label">${t('nav_vehicles')}</div>
      ${NAV_GROUP_VEHICLES.map(navItemHtml).join('')}
    </div>
    ${otherAllowed.length ? `<div class="nav-group">${otherAllowed.map(navItemHtml).join('')}</div>` : ''}
  `;
  nav.querySelectorAll('.nav-item').forEach((elm) => {
    elm.addEventListener('click', () => {
      const status = elm.dataset.status || undefined;
      navigate(elm.dataset.view, elm.dataset.view === 'vehicles' ? { statusCode: status } : {});
      closeSidebarDrawer();
    });
  });

  document.getElementById('hamburger-btn').addEventListener('click', toggleSidebarDrawer);
  document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebarDrawer);

  document.getElementById('topbar-lang').value = currentLang;
  document.getElementById('topbar-lang').addEventListener('change', async (e) => {
    setLang(e.target.value);
    await loadLookups();
    renderShell();
  });
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await window.api.auth.logout();
    state.user = null;
    renderLogin();
  });

  navigate(state.route.view || 'dashboard', state.route.params || {});
}

function toggleSidebarDrawer() {
  document.getElementById('sidebar').classList.toggle('expanded');
  document.getElementById('sidebar-backdrop').classList.toggle('open');
}
function closeSidebarDrawer() {
  document.getElementById('sidebar').classList.remove('expanded');
  document.getElementById('sidebar-backdrop').classList.remove('open');
}

const VIEW_RENDERERS = {}; // ผูก view name -> async render(container, params) — ประกาศด้านล่าง

function navigate(view, params = {}) {
  state.route = { view, params };
  document.querySelectorAll('.nav-item').forEach((elm) => {
    const matchesView = elm.dataset.view === view;
    const matchesStatus = (elm.dataset.status || '') === (params.statusCode || '');
    elm.classList.toggle('active', matchesView && matchesStatus);
  });
  const titleKey = { dashboard: 'dashboard_title', vehicles: 'vehicles_title', customers: 'customers_title',
                      sales: 'sales_title', expenses: 'expenses_title', reports: 'reports_title',
                      users: 'users_title', settings: 'settings_title' }[view] || view;
  document.getElementById('topbar-title').textContent = t(titleKey);
  const container = document.getElementById('content');
  container.innerHTML = `<div class="empty-state">${t('common_loading')}</div>`;
  const renderer = VIEW_RENDERERS[view];
  if (renderer) renderer(container, params).catch((err) => {
    console.error(err);
    container.innerHTML = `<div class="auth-error">${escapeHtml(humanizeError(err))}</div>`;
  });
}

// ============================================================
// Dashboard — สรุปภาพรวม + แผนที่ติดตามรถ (illustrative) + รายการที่ต้องติดตาม
// ============================================================
const MAP_PIN_POSITIONS = [[18, 62], [34, 30], [50, 72], [63, 22], [78, 55], [88, 78]];

VIEW_RENDERERS.dashboard = async (container) => {
  const [summary, vehicles, dueFollowUps] = await Promise.all([
    window.api.dashboard.summary({ branchId: state.user.branchId }),
    window.api.vehicles.list({ branchId: state.user.branchId }),
    window.api.followUps.due({ assignedToUserId: undefined }),
  ]);

  const stockMap = {};
  (summary.stockByStatus || []).forEach((s) => { stockMap[s.status_code] = s.n; });
  const activeVehicles = (stockMap.AVAILABLE || 0) + (stockMap.RESERVED || 0);

  const trackedVehicles = vehicles
    .filter((v) => ['AVAILABLE', 'RESERVED', 'PREPARING', 'WITHDRAWN'].includes(v.status_code))
    .slice(0, 6);

  const pins = trackedVehicles.map((v, i) => {
    const pos = MAP_PIN_POSITIONS[i % MAP_PIN_POSITIONS.length];
    const color = v.status_code === 'WITHDRAWN' ? 'red' : 'blue';
    return `<div class="map-pin ${color}" style="left:${pos[0]}%; top:${pos[1]}%" title="${escapeHtml(v.model)}"><div class="dot"></div></div>`;
  }).join('');

  container.innerHTML = `
    <div class="grid cols-4">
      <div class="card stat-card">
        <div class="top-row"><div class="label">${t('dashboard_activeVehicles')}</div><div class="icon-badge blue">${iconSvg('vehicles')}</div></div>
        <div class="value">${activeVehicles}</div>
      </div>
      <div class="card stat-card">
        <div class="top-row"><div class="label">${t('dashboard_monthlySales')}</div><div class="icon-badge green">${iconSvg('sales')}</div></div>
        <div class="value">${summary.monthlySales.units_sold || 0} <span style="font-size:13px;font-weight:400">${t('dashboard_units')}</span></div>
      </div>
      <div class="card stat-card">
        <div class="top-row"><div class="label">${t('dashboard_customersWaiting')}</div><div class="icon-badge red">${iconSvg('customers')}</div></div>
        <div class="value ${summary.dueFollowUpsCount > 0 ? 'danger' : ''}">${summary.dueFollowUpsCount}</div>
      </div>
      <div class="card stat-card">
        <div class="top-row"><div class="label">${t('dashboard_agingStock')}</div><div class="icon-badge amber">${iconSvg('reports')}</div></div>
        <div class="value ${summary.agingStockCount > 0 ? 'warn' : ''}">${summary.agingStockCount}</div>
      </div>
    </div>

    ${'monthProfit' in summary ? `
    <div class="section-title">${t('dashboard_monthProfit')}</div>
    <div class="card stat-card" style="max-width:260px">
      <div class="value">${fmtMoney(summary.monthProfit)}</div>
    </div>` : ''}

    <div class="section-title">${t('dashboard_map')}</div>
    <div class="card map-panel">
      <div class="map-header">
        <span class="muted" style="font-size:12px">${t('vehicles_title')}: ${trackedVehicles.length}</span>
      </div>
      <div class="map-canvas">
        <svg viewBox="0 0 400 260" preserveAspectRatio="none">
          <rect width="400" height="260" fill="#EAF2FB"/>
          <path d="M0 60 H400 M0 140 H400 M0 200 H400" stroke="#D3E3F5" stroke-width="6"/>
          <path d="M60 0 V260 M180 0 V260 M300 0 V260" stroke="#D3E3F5" stroke-width="6"/>
          <path d="M0 30 Q200 120 400 40" stroke="#C3D9F0" stroke-width="10" fill="none"/>
        </svg>
        ${pins}
      </div>
      <div class="map-legend">
        <div class="item"><span class="swatch blue"></span>${t('dashboard_activeVehicles')}</div>
        <div class="item"><span class="swatch red"></span>${nameOf(state.lookups.vehicleStatuses, 'WITHDRAWN')}</div>
      </div>
    </div>

    <div class="grid cols-2">
      <div>
        <div class="section-title">${t('dashboard_vehiclesToTrack')} <span class="count-pill">${trackedVehicles.length}</span></div>
        <div class="card">
          <div class="mini-list">
            ${trackedVehicles.length ? trackedVehicles.map((v) => `
              <div class="mini-row" data-id="${v.id}">
                <div><div class="primary-text">${escapeHtml(v.model)} ${v.year || ''}</div><div class="secondary-text">${escapeHtml(v.license_plate || '-')}</div></div>
                <span class="badge status-${v.status_code}"><span class="dot"></span>${escapeHtml(v.status_name)}</span>
              </div>`).join('') : `<div class="empty-state">${t('common_empty')}</div>`}
          </div>
        </div>
      </div>
      <div>
        <div class="section-title">${t('dashboard_customersToTrack')} <span class="count-pill">${dueFollowUps.length}</span></div>
        <div class="card">
          <div class="mini-list">
            ${dueFollowUps.length ? dueFollowUps.map((f) => `
              <div class="mini-row">
                <div><div class="primary-text">${escapeHtml(f.customer_name)}</div><div class="secondary-text">${escapeHtml(f.phone || '-')}</div></div>
                <span class="secondary-text">${fmtDateTime(f.scheduled_at)}</span>
              </div>`).join('') : `<div class="empty-state">${t('common_empty')}</div>`}
          </div>
        </div>
      </div>
    </div>`;

  container.querySelectorAll('.mini-row[data-id]').forEach((row) => {
    row.addEventListener('click', () => navigate('vehicles', { id: row.dataset.id }));
  });
};

// ============================================================
// Vehicles
// ============================================================
VIEW_RENDERERS.vehicles = async (container, params) => {
  if (params.id) return renderVehicleDetail(container, params.id);

  const rows = await window.api.vehicles.list({ branchId: state.user.branchId, search: params.search, statusCode: params.statusCode });
  container.innerHTML = `
    <div class="toolbar">
      <input type="text" id="v-search" placeholder="${t('common_search')}" style="max-width:260px" value="${escapeHtml(params.search || '')}">
      ${can('vehicle.manage') ? `<button class="btn" id="v-add">${t('vehicles_add')}</button>` : ''}
    </div>
    <table>
      <thead><tr>
        <th>${t('vehicles_model')}</th><th>${t('vehicles_make')}</th><th>${t('vehicles_year')}</th>
        <th>${t('vehicles_licensePlate')}</th><th>${t('common_status')}</th><th class="num">${t('vehicles_listingPrice')}</th>
      </tr></thead>
      <tbody>
        ${rows.length ? rows.map((v) => `
          <tr data-id="${v.id}">
            <td>${escapeHtml(v.model)}</td><td>${escapeHtml(v.make_name || '-')}</td><td>${v.year || '-'}</td>
            <td>${escapeHtml(v.license_plate || '-')}</td>
            <td><span class="badge status-${v.status_code}">${escapeHtml(v.status_name)}</span></td>
            <td class="num">${fmtMoney(v.listing_price)}</td>
          </tr>`).join('') : `<tr><td colspan="6" class="empty-state">${t('common_empty')}</td></tr>`}
      </tbody>
    </table>`;

  container.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => navigate('vehicles', { id: tr.dataset.id }));
  });
  let searchTimer;
  document.getElementById('v-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => navigate('vehicles', { search: e.target.value, statusCode: params.statusCode }), 300);
  });
  const addBtn = document.getElementById('v-add');
  if (addBtn) addBtn.addEventListener('click', openAddVehicleModal);
};

function openAddVehicleModal() {
  const lk = state.lookups;
  const modal = openModal(t('vehicles_add'), `
    <form id="add-vehicle-form">
      <div class="field-row">
        <div class="field"><label>${t('vehicles_make')}</label>
          <select id="av-make"><option value="">-</option>${lk.vehicleMakes.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>${t('vehicles_model')} *</label><input type="text" id="av-model" required></div>
      </div>
      <div class="field-row">
        <div class="field"><label>${t('vehicles_year')}</label><input type="number" id="av-year" min="1980" max="2100"></div>
        <div class="field"><label>${t('vehicles_mileage')}</label><input type="number" id="av-mileage" min="0"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>${t('vehicles_color')}</label><input type="text" id="av-color"></div>
        <div class="field"><label>${t('vehicles_licensePlate')}</label><input type="text" id="av-plate"></div>
      </div>
      <div class="field"><label>${t('vehicles_vin')}</label><input type="text" id="av-vin"></div>
      <div class="field-row">
        <div class="field"><label>${t('vehicles_sourceType')}</label>
          <select id="av-source">${lk.sourceTypes.map((s) => `<option value="${s.code}">${escapeHtml(s.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>${t('vehicles_acquisitionDate')}</label><input type="date" id="av-date" value="${new Date().toISOString().slice(0,10)}"></div>
      </div>
      <div class="field"><label>${t('vehicles_listingPrice')}</label><input type="number" id="av-listing" min="0"></div>
      ${can('vehicle.view_cost') ? `<div class="field"><label>${t('vehicles_purchaseCost')}</label><input type="number" id="av-purchase" min="0"></div>` : ''}
      <div class="actions">
        <button type="button" class="btn secondary" id="av-cancel">${t('common_cancel')}</button>
        <button type="submit" class="btn">${t('common_save')}</button>
      </div>
    </form>`);

  modal.body.querySelector('#av-cancel').addEventListener('click', modal.close);
  modal.body.querySelector('#add-vehicle-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    await withLoadingButton(btn, async () => {
      try {
        await window.api.vehicles.create({
          branchId: state.user.branchId,
          makeId: modal.body.querySelector('#av-make').value || null,
          model: modal.body.querySelector('#av-model').value.trim(),
          year: Number(modal.body.querySelector('#av-year').value) || null,
          mileage: Number(modal.body.querySelector('#av-mileage').value) || null,
          color: modal.body.querySelector('#av-color').value.trim() || null,
          licensePlate: modal.body.querySelector('#av-plate').value.trim() || null,
          vin: modal.body.querySelector('#av-vin').value.trim() || null,
          sourceTypeCode: modal.body.querySelector('#av-source').value,
          acquisitionDate: modal.body.querySelector('#av-date').value,
          listingPrice: Number(modal.body.querySelector('#av-listing').value) || null,
          purchaseCost: modal.body.querySelector('#av-purchase') ? (Number(modal.body.querySelector('#av-purchase').value) || null) : null,
        });
        modal.close();
        toast('บันทึกแล้ว');
        navigate('vehicles');
      } catch (err) {
        toast(humanizeError(err), true);
      }
    });
  });
}

async function renderVehicleDetail(container, id) {
  const v = await window.api.vehicles.get(id);
  if (!v) { container.innerHTML = `<div class="empty-state">${t('common_empty')}</div>`; return; }

  container.innerHTML = `
    <button class="btn secondary" id="back-btn" style="margin-bottom:14px">← ${t('vehicles_title')}</button>
    <div class="grid cols-2">
      <div class="card">
        <div class="section-title" style="margin-top:0">${escapeHtml(v.model)} ${v.year ? `(${v.year})` : ''}</div>
        <p><span class="badge status-${v.status_code}">${escapeHtml(v.status_code)}</span></p>
        <p class="muted">${t('vehicles_licensePlate')}: ${escapeHtml(v.license_plate || '-')} · ${t('vehicles_vin')}: ${escapeHtml(v.vin || '-')}</p>
        <p class="muted">${t('vehicles_color')}: ${escapeHtml(v.color || '-')} · ${t('vehicles_mileage')}: ${v.mileage || '-'}</p>
        <p class="muted">${t('vehicles_acquisitionDate')}: ${fmtDate(v.acquisition_date)}</p>
        <p><b>${t('vehicles_listingPrice')}:</b> ${fmtMoney(v.listing_price)}</p>
        ${can('vehicle.manage') ? `<button class="btn secondary" id="v-status-btn">${t('vehicles_changeStatus')}</button>` : ''}
      </div>

      <div class="card">
        <div class="section-title" style="margin-top:0">${t('vehicles_costs')} / ${t('vehicles_profit')}</div>
        ${v.costs ? `
          <table style="margin-bottom:10px"><tbody>
            ${v.costs.map((c) => `<tr><td>${escapeHtml(nameOf(state.lookups.costTypes, c.cost_type_code))}</td><td>${fmtDate(c.cost_date)}</td><td class="num">${fmtMoney(c.amount)}</td></tr>`).join('') || `<tr><td class="empty-state">${t('common_empty')}</td></tr>`}
          </tbody></table>
          <p><b>${t('vehicles_totalCost')}:</b> ${fmtMoney(v.totalCost)}</p>
          ${can('vehicle.manage') ? `<button class="btn secondary" id="v-addcost-btn">${t('vehicles_addCost')}</button>` : ''}
        ` : `<p class="locked-note">${t('locked_field')} (vehicle.view_cost)</p>`}
        ${v.profit ? `<p style="margin-top:12px"><b>${t('vehicles_profit')}:</b> ${fmtMoney(v.profit.gross_profit)} (${v.profit.margin_pct !== null ? v.profit.margin_pct + '%' : '-'})</p>`
                    : `<p class="locked-note">${t('locked_field')} (vehicle.view_profit)</p>`}
      </div>
    </div>

    <div class="section-title">${t('vehicles_statusHistory')}</div>
    <table><tbody>
      ${v.statusHistory.map((h) => `<tr><td>${fmtDateTime(h.changed_at)}</td><td>${escapeHtml(h.from_status_code || '-')} → ${escapeHtml(h.to_status_code)}</td><td>${escapeHtml(h.note || '')}</td></tr>`).join('') || `<tr><td class="empty-state">${t('common_empty')}</td></tr>`}
    </tbody></table>`;

  document.getElementById('back-btn').addEventListener('click', () => navigate('vehicles'));

  const statusBtn = document.getElementById('v-status-btn');
  if (statusBtn) statusBtn.addEventListener('click', () => openChangeStatusModal(v));

  const addCostBtn = document.getElementById('v-addcost-btn');
  if (addCostBtn) addCostBtn.addEventListener('click', () => openAddCostModal(v));
}

function openChangeStatusModal(vehicle) {
  const statuses = state.lookups.vehicleStatuses;
  const modal = openModal(t('vehicles_changeStatus'), `
    <form id="status-form">
      <div class="field"><label>${t('common_status')}</label>
        <select id="cs-status">${statuses.map((s) => `<option value="${s.code}" ${s.code === vehicle.status_code ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>${t('common_notes')}</label><textarea id="cs-note" rows="2"></textarea></div>
      <div class="actions">
        <button type="button" class="btn secondary" id="cs-cancel">${t('common_cancel')}</button>
        <button type="submit" class="btn">${t('common_save')}</button>
      </div>
    </form>`);
  modal.body.querySelector('#cs-cancel').addEventListener('click', modal.close);
  modal.body.querySelector('#status-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await window.api.vehicles.updateStatus({
        id: vehicle.id,
        statusCode: modal.body.querySelector('#cs-status').value,
        note: modal.body.querySelector('#cs-note').value.trim() || null,
      });
      modal.close();
      toast('อัปเดตสถานะแล้ว');
      navigate('vehicles', { id: vehicle.id });
    } catch (err) { toast(humanizeError(err), true); }
  });
}

function openAddCostModal(vehicle) {
  const costTypes = state.lookups.costTypes;
  const modal = openModal(t('vehicles_addCost'), `
    <form id="cost-form">
      <div class="field"><label>${t('vehicles_costType')}</label>
        <select id="ac-type">${costTypes.map((c) => `<option value="${c.code}">${escapeHtml(c.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>${t('common_amount')}</label><input type="number" id="ac-amount" min="0" required></div>
      <div class="field"><label>${t('common_date')}</label><input type="date" id="ac-date" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="field"><label>${t('common_description')}</label><input type="text" id="ac-desc"></div>
      <div class="actions">
        <button type="button" class="btn secondary" id="ac-cancel">${t('common_cancel')}</button>
        <button type="submit" class="btn">${t('common_save')}</button>
      </div>
    </form>`);
  modal.body.querySelector('#ac-cancel').addEventListener('click', modal.close);
  modal.body.querySelector('#cost-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await window.api.vehicles.addCost({
        vehicleId: vehicle.id,
        costTypeCode: modal.body.querySelector('#ac-type').value,
        amount: Number(modal.body.querySelector('#ac-amount').value),
        costDate: modal.body.querySelector('#ac-date').value,
        description: modal.body.querySelector('#ac-desc').value.trim() || null,
      });
      modal.close();
      toast('เพิ่มต้นทุนแล้ว');
      navigate('vehicles', { id: vehicle.id });
    } catch (err) { toast(humanizeError(err), true); }
  });
}

// ============================================================
// Customers
// ============================================================
VIEW_RENDERERS.customers = async (container, params) => {
  if (params.id) return renderCustomerDetail(container, params.id);

  const rows = await window.api.customers.list({ branchId: state.user.branchId, search: params.search });
  container.innerHTML = `
    <div class="toolbar">
      <input type="text" id="c-search" placeholder="${t('common_search')}" style="max-width:260px" value="${escapeHtml(params.search || '')}">
      ${can('customer.manage') ? `<button class="btn" id="c-add">${t('customers_add')}</button>` : ''}
    </div>
    <table>
      <thead><tr><th>${t('customers_fullName')}</th><th>${t('customers_phone')}</th><th>${t('customers_leadStatus')}</th><th>${t('customers_assignedTo')}</th></tr></thead>
      <tbody>
        ${rows.length ? rows.map((c) => `
          <tr data-id="${c.id}">
            <td>${escapeHtml(c.full_name)}</td><td>${escapeHtml(c.phone || '-')}</td>
            <td><span class="badge status-${c.lead_status_code}">${escapeHtml(nameOf(state.lookups.leadStatuses, c.lead_status_code))}</span></td>
            <td>${escapeHtml(c.assigned_sales_name || '-')}</td>
          </tr>`).join('') : `<tr><td colspan="4" class="empty-state">${t('common_empty')}</td></tr>`}
      </tbody>
    </table>`;

  container.querySelectorAll('tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', () => navigate('customers', { id: tr.dataset.id })));
  let searchTimer;
  document.getElementById('c-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => navigate('customers', { search: e.target.value }), 300);
  });
  const addBtn = document.getElementById('c-add');
  if (addBtn) addBtn.addEventListener('click', openAddCustomerModal);
};

function openAddCustomerModal() {
  const lk = state.lookups;
  const modal = openModal(t('customers_add'), `
    <form id="add-customer-form">
      <div class="field"><label>${t('customers_fullName')} *</label><input type="text" id="ac-name" required></div>
      <div class="field-row">
        <div class="field"><label>${t('customers_phone')}</label><input type="text" id="ac-phone"></div>
        <div class="field"><label>${t('customers_email')}</label><input type="text" id="ac-email"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>${t('customers_leadSource')}</label>
          <select id="ac-source"><option value="">-</option>${lk.leadSources.map((s) => `<option value="${s.code}">${escapeHtml(s.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>${t('customers_leadStatus')}</label>
          <select id="ac-status">${lk.leadStatuses.map((s) => `<option value="${s.code}">${escapeHtml(s.name)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="field"><label>${t('common_notes')}</label><textarea id="ac-notes" rows="2"></textarea></div>
      <div class="actions">
        <button type="button" class="btn secondary" id="ac-cancel">${t('common_cancel')}</button>
        <button type="submit" class="btn">${t('common_save')}</button>
      </div>
    </form>`);
  modal.body.querySelector('#ac-cancel').addEventListener('click', modal.close);
  modal.body.querySelector('#add-customer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await window.api.customers.create({
        branchId: state.user.branchId,
        fullName: modal.body.querySelector('#ac-name').value.trim(),
        phone: modal.body.querySelector('#ac-phone').value.trim() || null,
        email: modal.body.querySelector('#ac-email').value.trim() || null,
        leadSourceCode: modal.body.querySelector('#ac-source').value || null,
        leadStatusCode: modal.body.querySelector('#ac-status').value,
        notes: modal.body.querySelector('#ac-notes').value.trim() || null,
      });
      modal.close();
      toast('บันทึกแล้ว');
      navigate('customers');
    } catch (err) { toast(humanizeError(err), true); }
  });
}

async function renderCustomerDetail(container, id) {
  const c = await window.api.customers.get(id);
  if (!c) { container.innerHTML = `<div class="empty-state">${t('common_empty')}</div>`; return; }

  container.innerHTML = `
    <button class="btn secondary" id="back-btn" style="margin-bottom:14px">← ${t('customers_title')}</button>
    <div class="card">
      <div class="section-title" style="margin-top:0">${escapeHtml(c.full_name)}</div>
      <p class="muted">${t('customers_phone')}: ${escapeHtml(c.phone || '-')} · ${t('customers_email')}: ${escapeHtml(c.email || '-')}</p>
      <p><span class="badge status-${c.lead_status_code}">${escapeHtml(c.lead_status_code)}</span></p>
      ${can('customer.manage') ? `<button class="btn secondary" id="add-followup-btn">${t('customers_addFollowUp')}</button>` : ''}
    </div>

    <div class="section-title">${t('customers_followUps')}</div>
    <table><tbody>
      ${c.followUps.length ? c.followUps.map((f) => `
        <tr data-fid="${f.id}">
          <td>${fmtDateTime(f.scheduled_at)}</td>
          <td><span class="badge status-${f.status}">${escapeHtml(f.status)}</span></td>
          <td>${escapeHtml(f.assigned_to_name)}</td>
          <td>${escapeHtml(f.result_notes || '')}</td>
          <td>${f.status === 'PENDING' && can('customer.manage') ? `<button class="btn secondary complete-fu-btn" data-fid="${f.id}">${t('customers_complete')}</button>` : ''}</td>
        </tr>`).join('') : `<tr><td colspan="5" class="empty-state">${t('common_empty')}</td></tr>`}
    </tbody></table>

    <div class="section-title">${t('customers_purchaseHistory')}</div>
    <table><tbody>
      ${c.purchaseHistory.length ? c.purchaseHistory.map((s) => `<tr><td>${fmtDate(s.sale_date)}</td><td>${escapeHtml(s.model)}</td><td class="num">${fmtMoney(s.sale_price)}</td><td><span class="badge status-${s.status}">${escapeHtml(s.status)}</span></td></tr>`).join('') : `<tr><td colspan="4" class="empty-state">${t('common_empty')}</td></tr>`}
    </tbody></table>`;

  document.getElementById('back-btn').addEventListener('click', () => navigate('customers'));
  const addFuBtn = document.getElementById('add-followup-btn');
  if (addFuBtn) addFuBtn.addEventListener('click', () => openAddFollowUpModal(c));
  container.querySelectorAll('.complete-fu-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const notes = prompt(t('common_notes') + '?') || '';
      try {
        await window.api.followUps.complete({ id: btn.dataset.fid, resultNotes: notes, outcomeStatus: 'DONE' });
        toast('บันทึกแล้ว');
        navigate('customers', { id });
      } catch (err) { toast(humanizeError(err), true); }
    });
  });
}

function openAddFollowUpModal(customer) {
  const modal = openModal(t('customers_addFollowUp'), `
    <form id="fu-form">
      <div class="field"><label>${t('customers_scheduledAt')}</label><input type="datetime-local" id="fu-when" required></div>
      <div class="field"><label>${t('customers_channel')}</label>
        <select id="fu-channel"><option value="PHONE">Phone</option><option value="LINE">LINE</option><option value="WALK_IN">Walk-in</option><option value="OTHER">Other</option></select>
      </div>
      <div class="actions">
        <button type="button" class="btn secondary" id="fu-cancel">${t('common_cancel')}</button>
        <button type="submit" class="btn">${t('common_save')}</button>
      </div>
    </form>`);
  modal.body.querySelector('#fu-cancel').addEventListener('click', modal.close);
  modal.body.querySelector('#fu-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await window.api.followUps.create({
        customerId: customer.id,
        scheduledAt: modal.body.querySelector('#fu-when').value,
        channel: modal.body.querySelector('#fu-channel').value,
      });
      modal.close();
      toast('นัดหมายแล้ว');
      navigate('customers', { id: customer.id });
    } catch (err) { toast(humanizeError(err), true); }
  });
}

// ============================================================
// Sales
// ============================================================
VIEW_RENDERERS.sales = async (container) => {
  const rows = await window.api.sales.list({ branchId: state.user.branchId });
  container.innerHTML = `
    <div class="toolbar">
      <div></div>
      ${can('sales.manage') ? `<button class="btn" id="s-add">${t('sales_add')}</button>` : ''}
    </div>
    <table>
      <thead><tr><th>${t('common_date')}</th><th>${t('sales_vehicle')}</th><th>${t('sales_customer')}</th><th class="num">${t('sales_salePrice')}</th><th>${t('common_status')}</th></tr></thead>
      <tbody>
        ${rows.length ? rows.map((s) => `<tr><td>${fmtDate(s.sale_date)}</td><td>${escapeHtml(s.model)} ${s.year || ''}</td><td>${escapeHtml(s.customer_name)}</td><td class="num">${fmtMoney(s.sale_price)}</td><td><span class="badge status-${s.status}">${escapeHtml(s.status)}</span></td></tr>`).join('') : `<tr><td colspan="5" class="empty-state">${t('common_empty')}</td></tr>`}
      </tbody>
    </table>`;
  const addBtn = document.getElementById('s-add');
  if (addBtn) addBtn.addEventListener('click', openAddSaleModal);
};

async function openAddSaleModal() {
  const [vehicles, customers] = await Promise.all([
    window.api.vehicles.list({ branchId: state.user.branchId }),
    window.api.customers.list({ branchId: state.user.branchId }),
  ]);
  const availableVehicles = vehicles.filter((v) => v.status_code === 'AVAILABLE' || v.status_code === 'RESERVED');
  const lk = state.lookups;

  const modal = openModal(t('sales_add'), `
    <form id="sale-form">
      <div class="field"><label>${t('sales_vehicle')}</label>
        <select id="sl-vehicle" required>${availableVehicles.map((v) => `<option value="${v.id}">${escapeHtml(v.model)} ${v.year || ''} - ${escapeHtml(v.license_plate || '')}</option>`).join('')}</select>
      </div>
      <div class="field"><label>${t('sales_customer')}</label>
        <select id="sl-customer" required>${customers.map((c) => `<option value="${c.id}">${escapeHtml(c.full_name)}</option>`).join('')}</select>
      </div>
      <div class="field-row">
        <div class="field"><label>${t('sales_salePrice')}</label><input type="number" id="sl-price" min="0" required></div>
        <div class="field"><label>${t('sales_saleDate')}</label><input type="date" id="sl-date" value="${new Date().toISOString().slice(0,10)}"></div>
      </div>
      <div class="field"><label>${t('sales_paymentType')}</label>
        <select id="sl-payment">${lk.paymentTypes.map((p) => `<option value="${p.code}">${escapeHtml(p.name)}</option>`).join('')}</select>
      </div>
      ${can('vehicle.manage') ? `<div class="field"><label>${t('sales_commission')} ${t('common_optional')}</label><input type="number" id="sl-commission" min="0"></div>` : ''}
      <div class="actions">
        <button type="button" class="btn secondary" id="sl-cancel">${t('common_cancel')}</button>
        <button type="submit" class="btn">${t('common_save')}</button>
      </div>
    </form>`);

  modal.body.querySelector('#sl-cancel').addEventListener('click', modal.close);
  modal.body.querySelector('#sale-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!availableVehicles.length) { toast('ไม่มีรถที่พร้อมขาย', true); return; }
    try {
      await window.api.sales.create({
        vehicleId: modal.body.querySelector('#sl-vehicle').value,
        customerId: modal.body.querySelector('#sl-customer').value,
        salePrice: Number(modal.body.querySelector('#sl-price').value),
        saleDate: modal.body.querySelector('#sl-date').value,
        paymentTypeCode: modal.body.querySelector('#sl-payment').value,
        salesCommission: modal.body.querySelector('#sl-commission') ? (Number(modal.body.querySelector('#sl-commission').value) || null) : null,
      });
      modal.close();
      toast('บันทึกการขายแล้ว');
      navigate('sales');
    } catch (err) { toast(humanizeError(err), true); }
  });
}

// ============================================================
// Expenses
// ============================================================
VIEW_RENDERERS.expenses = async (container) => {
  const rows = await window.api.expenses.list({ branchId: state.user.branchId });
  container.innerHTML = `
    <div class="toolbar">
      <div></div>
      ${can('expense.manage') ? `<button class="btn" id="e-add">${t('expenses_add')}</button>` : ''}
    </div>
    <table>
      <thead><tr><th>${t('common_date')}</th><th>${t('expenses_category')}</th><th>${t('common_description')}</th><th class="num">${t('common_amount')}</th></tr></thead>
      <tbody>
        ${rows.length ? rows.map((ex) => `<tr><td>${fmtDate(ex.expense_date)}</td><td>${escapeHtml(nameOf(state.lookups.expenseCategories, ex.category_code))}</td><td>${escapeHtml(ex.description || '-')}</td><td class="num">${fmtMoney(ex.amount)}</td></tr>`).join('') : `<tr><td colspan="4" class="empty-state">${t('common_empty')}</td></tr>`}
      </tbody>
    </table>`;
  const addBtn = document.getElementById('e-add');
  if (addBtn) addBtn.addEventListener('click', openAddExpenseModal);
};

function openAddExpenseModal() {
  const lk = state.lookups;
  const modal = openModal(t('expenses_add'), `
    <form id="expense-form">
      <div class="field"><label>${t('expenses_category')}</label>
        <select id="ex-cat">${lk.expenseCategories.map((c) => `<option value="${c.code}">${escapeHtml(c.name)}</option>`).join('')}</select>
      </div>
      <div class="field-row">
        <div class="field"><label>${t('common_amount')}</label><input type="number" id="ex-amount" min="0" required></div>
        <div class="field"><label>${t('common_date')}</label><input type="date" id="ex-date" value="${new Date().toISOString().slice(0,10)}"></div>
      </div>
      <div class="field"><label>${t('common_description')}</label><input type="text" id="ex-desc"></div>
      <div class="actions">
        <button type="button" class="btn secondary" id="ex-cancel">${t('common_cancel')}</button>
        <button type="submit" class="btn">${t('common_save')}</button>
      </div>
    </form>`);
  modal.body.querySelector('#ex-cancel').addEventListener('click', modal.close);
  modal.body.querySelector('#expense-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await window.api.expenses.create({
        branchId: state.user.branchId,
        categoryCode: modal.body.querySelector('#ex-cat').value,
        amount: Number(modal.body.querySelector('#ex-amount').value),
        expenseDate: modal.body.querySelector('#ex-date').value,
        description: modal.body.querySelector('#ex-desc').value.trim() || null,
      });
      modal.close();
      toast('บันทึกแล้ว');
      navigate('expenses');
    } catch (err) { toast(humanizeError(err), true); }
  });
}

// ============================================================
// Settings
// ============================================================
VIEW_RENDERERS.settings = async (container) => {
  container.innerHTML = `
    <div class="card" style="max-width:480px">
      <div class="section-title" style="margin-top:0">${t('settings_currentUser')}</div>
      <p>${escapeHtml(state.user.fullName)} (@${escapeHtml(state.user.username)})</p>
      <p class="muted">${t('settings_role')}: ${escapeHtml(state.user.roleCode)}</p>
      <div class="section-title">${t('settings_language')}</div>
      <select id="settings-lang">
        <option value="lo">ລາວ</option><option value="th">ไทย</option><option value="en">English</option><option value="zh">中文</option>
      </select>
    </div>
    <div class="card" style="max-width:480px; margin-top:16px" id="update-panel"></div>`;
  document.getElementById('settings-lang').value = currentLang;
  document.getElementById('settings-lang').addEventListener('change', async (e) => {
    setLang(e.target.value);
    await loadLookups();
    renderShell();
    navigate('settings');
  });
  initUpdatePanel(document.getElementById('update-panel'));
};

// ============================================================
// Auto-update — electron-updater + GitHub Releases (ทำแบบเดียวกับ cs-inventory-desktop)
// ขับเคลื่อนด้วย event "updater:status" ที่ main process ส่งมาทั้งหมด (ดู
// src/main/updater.js) — window.api.updater มีเฉพาะใน Electron เท่านั้น
// ============================================================
let _updateUnsubscribe = null;

async function initUpdatePanel(container) {
  if (_updateUnsubscribe) { _updateUnsubscribe(); _updateUnsubscribe = null; }

  let currentVersion = '';
  try { currentVersion = await window.api.updater.getVersion(); } catch (e) { /* ignore */ }

  let status = null;
  const render = () => { container.innerHTML = updatePanelHtml(currentVersion, status); wireUpdatePanel(container); };
  render();

  _updateUnsubscribe = window.api.updater.onStatus((payload) => { status = payload; render(); });
}

function updatePanelHtml(currentVersion, status) {
  const state_ = status && status.state;
  const busy = state_ === 'checking' || state_ === 'downloading';

  let body = '';
  if (state_ === 'checking') {
    body = `<div class="update-row muted">${t('updateChecking')}</div>`;
  } else if (state_ === 'available') {
    body = `<div class="update-row" style="color:var(--blue); font-weight:700">${t('updateAvailable')}${status.version ? ' v' + escapeHtml(status.version) : ''}</div>`;
  } else if (state_ === 'downloading') {
    const pct = status.percent ?? 0;
    body = `
      <div class="update-row"><span>${t('updateDownloading')}</span><span style="font-variant-numeric:tabular-nums">${pct}%</span></div>
      <div class="update-progress-track"><div class="update-progress-fill" style="width:${pct}%"></div></div>`;
  } else if (state_ === 'downloaded') {
    body = `
      <div class="update-row" style="color:var(--success); font-weight:700">${t('updateDownloaded')}${status.version ? ' v' + escapeHtml(status.version) : ''}</div>
      <button type="button" class="btn" id="update-restart-btn" style="margin-top:8px">${t('restartToInstall')}</button>`;
  } else if (state_ === 'not-available') {
    body = `<div class="update-row" style="color:var(--success); font-weight:700">${t('updateUpToDate')}</div>`;
  } else if (state_ === 'mac-fallback') {
    body = `
      <div class="callout-warning">${t('updateMacUnsignedNote')}</div>
      <button type="button" class="btn secondary" id="update-open-releases-btn" style="margin-top:8px">${t('openDownloadPage')}</button>`;
  } else if (state_ === 'error') {
    body = `<div class="callout-warning">${t('updateError')}${status && status.message ? ': ' + escapeHtml(status.message) : ''}</div>`;
  } else if (state_ === 'dev-mode') {
    body = `<div class="update-row muted">${t('updateDevModeNote')}</div>`;
  }

  return `
    <div class="section-title" style="margin-top:0">${t('checkForUpdates')}</div>
    <p class="muted" style="margin-top:-8px">${t('updateSectionDesc')}</p>
    ${currentVersion ? `<div class="update-row muted">${t('currentVersion')}: v${escapeHtml(currentVersion)}</div>` : ''}
    ${body}
    <button type="button" class="btn secondary" id="update-check-btn" style="margin-top:12px" ${busy ? 'disabled' : ''}>${t('checkForUpdates')}</button>
  `;
}

function wireUpdatePanel(container) {
  const checkBtn = container.querySelector('#update-check-btn');
  if (checkBtn) checkBtn.addEventListener('click', () => window.api.updater.check());
  const restartBtn = container.querySelector('#update-restart-btn');
  if (restartBtn) restartBtn.addEventListener('click', () => window.api.updater.quitAndInstall());
  const openBtn = container.querySelector('#update-open-releases-btn');
  if (openBtn) openBtn.addEventListener('click', () => window.api.updater.openReleases());
}

// ============================================================
// Reports — อ่านจาก VIEW ที่มีอยู่แล้วใน schema (v_monthly_sales_summary ฯลฯ)
// ============================================================
VIEW_RENDERERS.reports = async (container) => {
  const branchId = state.user.branchId;
  const [monthly, aging, perf, leadSrc] = await Promise.all([
    window.api.reports.monthlySales({ branchId }),
    window.api.reports.vehicleAging({ branchId }),
    window.api.reports.salesRepPerformance({ branchId }),
    window.api.reports.leadSourceEffectiveness({ branchId }),
  ]);

  let budgetHtml = '';
  if (can('report.view_financial')) {
    const budget = await window.api.reports.expenseVsBudget({ branchId });
    budgetHtml = `
      <div class="section-title">${t('reports_expenseBudget')}</div>
      <div class="table-wrap"><table><thead><tr><th>${t('expenses_category')}</th><th class="num">${t('common_amount')}</th><th class="num">Actual</th><th class="num">Variance</th></tr></thead>
      <tbody>${budget.length ? budget.map((b) => {
        const cat = state.lookups.expenseCategories.find((c) => c.id === b.category_id);
        return `<tr><td>${escapeHtml(cat ? cat.name : 'Total')}</td><td class="num">${fmtMoney(b.budgeted_amount)}</td><td class="num">${fmtMoney(b.actual_amount)}</td><td class="num">${fmtMoney(b.variance)}</td></tr>`;
      }).join('') : `<tr><td colspan="4" class="empty-state">${t('common_empty')}</td></tr>`}</tbody></table></div>`;
  }

  container.innerHTML = `
    <div class="section-title">${t('reports_monthlySales')}</div>
    <div class="table-wrap"><table><thead><tr><th>Month</th><th class="num">${t('dashboard_units')}</th><th class="num">${t('dashboard_revenue')}</th></tr></thead>
    <tbody>${monthly.length ? monthly.map((m) => `<tr><td>${escapeHtml(m.sales_month)}</td><td class="num">${m.units_sold}</td><td class="num">${fmtMoney(m.total_revenue)}</td></tr>`).join('') : `<tr><td colspan="3" class="empty-state">${t('common_empty')}</td></tr>`}</tbody></table></div>

    <div class="section-title">${t('reports_vehicleAging')}</div>
    <div class="table-wrap"><table><thead><tr><th>${t('vehicles_title')}</th><th>${t('common_status')}</th><th class="num">Days</th></tr></thead>
    <tbody>${aging.length ? aging.map((a) => `<tr><td>${a.vehicle_id.slice(0, 8)}</td><td><span class="badge status-${a.status_code}"><span class="dot"></span>${escapeHtml(nameOf(state.lookups.vehicleStatuses, a.status_code))}</span></td><td class="num">${a.days_in_stock}</td></tr>`).join('') : `<tr><td colspan="3" class="empty-state">${t('common_empty')}</td></tr>`}</tbody></table></div>

    <div class="section-title">${t('reports_salesPerformance')}</div>
    <div class="table-wrap"><table><thead><tr><th>User</th><th class="num">${t('dashboard_units')}</th><th class="num">${t('dashboard_revenue')}</th><th class="num">Leads</th><th class="num">Conv. %</th></tr></thead>
    <tbody>${perf.length ? perf.map((p) => `<tr><td>${p.sales_user_id.slice(0, 8)}</td><td class="num">${p.units_sold}</td><td class="num">${fmtMoney(p.total_revenue)}</td><td class="num">${p.leads_assigned}</td><td class="num">${p.conversion_rate_pct ?? '-'}</td></tr>`).join('') : `<tr><td colspan="5" class="empty-state">${t('common_empty')}</td></tr>`}</tbody></table></div>

    <div class="section-title">${t('reports_leadSource')}</div>
    <div class="table-wrap"><table><thead><tr><th>${t('customers_leadSource')}</th><th class="num">Total</th><th class="num">Converted</th><th class="num">Conv. %</th></tr></thead>
    <tbody>${leadSrc.length ? leadSrc.map((l) => `<tr><td>${escapeHtml(nameOf(state.lookups.leadSources, l.lead_source_code))}</td><td class="num">${l.total_leads}</td><td class="num">${l.converted_customers}</td><td class="num">${l.conversion_rate_pct ?? '-'}</td></tr>`).join('') : `<tr><td colspan="4" class="empty-state">${t('common_empty')}</td></tr>`}</tbody></table></div>

    ${budgetHtml}`;
};

// ============================================================
// Users — จัดการผู้ใช้งาน (ต้องมีสิทธิ์ user.manage)
// ============================================================
VIEW_RENDERERS.users = async (container) => {
  const rows = await window.api.users.list({ branchId: state.user.branchId });
  container.innerHTML = `
    <div class="toolbar">
      <div></div>
      <button class="btn" id="u-add">${t('users_add')}</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>${t('users_username')}</th><th>${t('users_fullName')}</th><th>${t('users_role')}</th><th>${t('common_status')}</th></tr></thead>
      <tbody>
        ${rows.map((u) => `
          <tr data-id="${u.id}">
            <td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.full_name)}</td><td>${escapeHtml(u.role_code)}</td>
            <td><span class="badge ${u.is_active ? 'status-AVAILABLE' : 'status-WITHDRAWN'}"><span class="dot"></span>${u.is_active ? t('users_active') : t('users_inactive')}</span></td>
          </tr>`).join('')}
      </tbody>
    </table></div>`;
  document.getElementById('u-add').addEventListener('click', openAddUserModal);
  container.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', async () => {
      const row = rows.find((u) => u.id === tr.dataset.id);
      if (!row) return;
      if (!confirm(`${row.is_active ? t('users_inactive') : t('users_active')}: ${row.username}?`)) return;
      try {
        await window.api.users.setActive({ id: row.id, isActive: !row.is_active });
        navigate('users');
      } catch (err) { toast(humanizeError(err), true); }
    });
  });
};

function openAddUserModal() {
  const roles = state.lookups.roles;
  const modal = openModal(t('users_add'), `
    <form id="user-form">
      <div class="field"><label>${t('users_fullName')}</label><input type="text" id="u-fullname" required></div>
      <div class="field-row">
        <div class="field"><label>${t('users_username')}</label><input type="text" id="u-username" required></div>
        <div class="field"><label>${t('users_password')}</label><input type="password" id="u-password" required minlength="6"></div>
      </div>
      <div class="field"><label>${t('users_role')}</label>
        <select id="u-role">${roles.map((r) => `<option value="${r.code}">${escapeHtml(r.name)}</option>`).join('')}</select>
      </div>
      <div class="actions">
        <button type="button" class="btn secondary" id="u-cancel">${t('common_cancel')}</button>
        <button type="submit" class="btn">${t('common_save')}</button>
      </div>
    </form>`);
  modal.body.querySelector('#u-cancel').addEventListener('click', modal.close);
  modal.body.querySelector('#user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await window.api.users.create({
        fullName: modal.body.querySelector('#u-fullname').value.trim(),
        username: modal.body.querySelector('#u-username').value.trim(),
        password: modal.body.querySelector('#u-password').value,
        roleCode: modal.body.querySelector('#u-role').value,
      });
      modal.close();
      toast('บันทึกแล้ว');
      navigate('users');
    } catch (err) { toast(humanizeError(err), true); }
  });
}

// ---------- Go ----------
boot().catch((err) => {
  console.error(err);
  root.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
});
