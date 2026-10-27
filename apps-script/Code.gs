// ════════════════════════════════════════════════════════════════════════════
// SRI SAI SPECIALITY DENTAL CARE — GOOGLE APPS SCRIPT BACKEND  v3
// ════════════════════════════════════════════════════════════════════════════
// What's new in v3 (see docs/AUDIT.md, docs/MIGRATION.md):
//  • Server-side login: salted+iterated password hashes, sessions with idle and
//    absolute expiry, failed-login lockout, password change, user management.
//  • Every request is POST (no patient data in URLs) and is checked for a valid
//    session AND role permission here on the server (not just hidden buttons).
//  • Audit log of every change, login, failure and permission denial.
//  • Bills: server validates every line, discount limit, totals and payment
//    split; sequential bill numbers; duplicate-proof (bill ID + request ID).
//  • Batch-wise stock with FEFO (first expiry, first out); expired stock is
//    never sold; every stock change is written to the StockMovements register.
//  • Nothing is deleted any more: bills/purchases are CANCELLED (stock restored),
//    other records are marked Deleted/Inactive and hidden from the app.
//  • Backups: one-click + daily/weekly/monthly automatic copies, verified,
//    with e-mail alert on failure.
//
// FIRST-TIME SETUP (owner, from the Apps Script editor):
//   1. Paste this file, Save.
//   2. Select function  migrateToV3DryRun  → Run → read the log.
//   3. Select function  migrateToV3        → Run (makes a backup first).
//   4. Select function  installTriggers    → Run (daily backup + stock e-mail).
//   5. Deploy → Manage deployments → Edit → New version → Deploy.
// ════════════════════════════════════════════════════════════════════════════

var VERSION = '3.0.0';
var SCHEMA_VERSION = 3;
var DEFAULT_SS_ID = "1rOwubjghrsuWiGXR8X1A1841_8yd-cmMQIj44QBqNaA";  // override with Script Property SS_ID (staging copy)

var IDLE_MINUTES      = 180;   // session ends after 3 h without any request
var ABSOLUTE_HOURS    = 12;    // session ends 12 h after login regardless
var MAX_FAILED_LOGINS = 5;     // then account locked …
var LOCK_MINUTES      = 15;    // … for 15 minutes
var HASH_ROUNDS       = 500;
var DEFAULT_STAFF_MAX_DISCOUNT_PCT = 10;
var CACHE_TTL_SECONDS = 600;
var CACHE_CHUNK       = 30000;
var STAFF_BILL_DAYS   = 3;     // staff see only recent bills (for reprint)

var OWNER = 'OWNER', STAFF = 'STAFF', ANY = 'ANY';

// ── Schema ──────────────────────────────────────────────────────────────────
var BASE_HEADERS = {
  Medicines:         ['ID','Name','Stock','Unit Price','Cost Price','Expiry','Date & Time'],
  Bills:             ['Bill ID','Patient Name','Doctor','Phone','Date','Subtotal','Discount','Total','Cost Total','Payment Mode','Date & Time'],
  BillItems:         ['Bill ID','Medicine ID','Medicine Name','Quantity','Unit Price','Cost Price','Amount','Date & Time'],
  Purchases:         ['ID','Date','Supplier','Medicine ID','Medicine Name','Quantity','Cost Price','Total Cost','Date & Time'],
  TreatmentReceipts: ['Receipt No','Date','Patient','Doctor','Amount','Amount in Words','Treatments','Saved At'],
  Prescriptions:     ['Date','Patient Name','Age','Sex','Prescription','Saved At'],
  Patients:          ['ID','Name','Phone','Age','Sex','Doctor','Treatment','Balance','Medical Alerts','Status','Last Visit','Added On'],
  Appointments:      ['ID','Patient','Phone','Date','Time','Reason','Doctor','Status','Booked At'],
  ExamForms:         ['Date','Patient','Age','Sex','Doctor','Phone','Swelling','TMJ','Lymph Nodes','Oral Hygiene','Gingiva','Dental Caries','Missing Teeth','Stains','Calculus','Provisional Diagnosis','Final Diagnosis','Treatment Plan','Treatment Notes','Upper Arch','Lower Arch','Saved At'],
  Settings:          ['Key','Value','Updated At'],
  Expenses:          ['ID','Date','Category','Amount','Vendor','Notes','Payment Mode','Added At'],
  // new in v3
  Users:             ['Username','Role','Password Hash','Salt','Active','Must Change Password','Failed Attempts','Locked Until','Created At','Last Login At','Display Name'],
  AuditLog:          ['Timestamp','User','Role','Action','Target ID','Details','Result'],
  StockMovements:    ['Movement ID','Timestamp','Medicine ID','Medicine Name','Batch ID','Qty Change','Type','Reference','User','Reason','Stock After'],
  Batches:           ['Batch ID','Medicine ID','Batch No','Expiry','Qty Received','Qty Available','Cost Price','MRP','Supplier','Purchase ID','Received At','Status']
};
// Columns appended to the RIGHT of existing sheets (old columns never move)
var EXTRA_COLS = {
  Medicines:         ['Min Stock','Status'],
  Bills:             ['Status','Bill No','Created By','Payment Ref','Cash Amount','UPI Amount','Card Amount','Cancelled At','Cancelled By','Cancel Reason'],
  BillItems:         ['Batch Allocation'],
  Purchases:         ['Batch No','Expiry','Batch ID','Status','Created By','Cancelled At','Cancelled By','Cancel Reason','Invoice No','MRP'],
  TreatmentReceipts: ['Payment Mode','Record ID','Created By','Status'],
  Prescriptions:     ['Record ID','Created By','Status'],
  Patients:          ['Created By','Updated At'],
  Appointments:      ['Created By','Updated At'],
  ExamForms:         ['Record ID','Created By','Status'],
  Expenses:          ['Created By','Status']
};

// ── Permissions (enforced here, on the server) ─────────────────────────────
var STAFF_SETTING_KEYS = { wa_templates: 1 };
var PERMS = {
  whoami: ANY, logout: ANY, changePassword: ANY, getAllData: ANY, getSettings: ANY,
  reserveReceiptNo: ANY,
  saveBill: ANY, cancelBill: OWNER, deleteBill: OWNER,
  addMedicine: OWNER, updateMedicine: OWNER, deleteMedicine: OWNER,
  adjustStock: OWNER, getStockMovements: OWNER,
  addPurchase: OWNER, cancelPurchase: OWNER, deletePurchase: OWNER,
  saveTreatmentReceipt: ANY, deleteTreatmentReceipt: OWNER,
  savePrescription: ANY, deletePrescription: OWNER,
  savePatient: ANY, deletePatient: OWNER,
  saveAppointment: ANY, updateAppointmentStatus: ANY, deleteAppointment: OWNER,
  saveExamForm: ANY, deleteExamForm: OWNER,
  saveSettings: function (s, req) { return s.r === OWNER || !!STAFF_SETTING_KEYS[String(req.settingKey || '')]; },
  saveExpense: OWNER, deleteExpense: OWNER, getExpenses: OWNER,
  listUsers: OWNER, createUser: OWNER, resetUserPassword: OWNER, setUserActive: OWNER,
  getAuditLog: OWNER, backupNow: OWNER, listBackups: OWNER, validateData: OWNER
};
var READ_ONLY = { whoami: 1, getAllData: 1, getSettings: 1, getExpenses: 1, getStockMovements: 1,
  listUsers: 1, getAuditLog: 1, listBackups: 1, validateData: 1, logout: 1 };

// ════════════════════════════════════════════════════════════════════════════
// SMALL HELPERS
// ════════════════════════════════════════════════════════════════════════════
function tz_() { return Session.getScriptTimeZone(); }
function nowStr_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'); }
function todayStr_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function daysAgoStr_(n) { return Utilities.formatDate(new Date(Date.now() - n * 86400000), tz_(), 'yyyy-MM-dd'); }
function r2_(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function num_(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }
function str_(x, max) { var s = (x === null || x === undefined) ? '' : String(x).trim(); return max ? s.slice(0, max) : s; }
function uid_(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase(); }
function props_() { return PropertiesService.getScriptProperties(); }
function cache_() { return CacheService.getScriptCache(); }
function ok_(o) { o = o || {}; o.success = true; return o; }
function fail_(code, msg, extra) { var o = extra || {}; o.success = false; o.code = code; o.error = msg; return o; }
function json_(o) {
  var text = (o && o.__raw) ? o.__raw : JSON.stringify(o);
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}
// kept for old helper functions below
function sendJSON(data) { return json_(data); }
function getCurrentDateTime() { return nowStr_(); }

function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, tz_(), 'yyyy-MM-dd');
  }
  var s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  try {
    var d = new Date(s);
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
  } catch (e) {}
  return '';
}

function formatTime(value) {
  if (!value && value !== 0) return '';
  if (typeof value === 'string' && /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(value.trim())) return value.trim().toUpperCase();
  var h, m;
  if (typeof value === 'number' && value >= 0 && value < 1) {
    var totalMins = Math.round(value * 24 * 60); h = Math.floor(totalMins / 60); m = totalMins % 60;
  } else if (value instanceof Date) {
    h = value.getHours(); m = value.getMinutes();
  } else if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim())) {
    var parts = value.split(':'); h = parseInt(parts[0], 10); m = parseInt(parts[1], 10);
  }
  if (h === undefined) return String(value);
  // Legacy rows were stored as sheet time values; snap them to the 30-min slot grid.
  var snapM = m < 15 ? 0 : m < 45 ? 30 : 0;
  var snapH = m >= 45 ? h + 1 : h;
  if (snapH >= 24) snapH = 23;
  var ampm = snapH < 12 ? 'AM' : 'PM';
  var h12 = snapH % 12 || 12;
  return ('0' + h12).slice(-2) + ':' + (snapM === 0 ? '00' : '30') + ' ' + ampm;
}

// ── Spreadsheet access (one open per execution) ────────────────────────────
var _ss = null, _hdr = {};
function ssId_() { return props_().getProperty('SS_ID') || DEFAULT_SS_ID; }
function ss_() { return _ss || (_ss = SpreadsheetApp.openById(ssId_())); }
function sh_(name) { return ss_().getSheetByName(name); }
function styleHeaderRow(sheet, numCols) {
  var range = sheet.getRange(1, 1, 1, numCols);
  range.setBackground('#1e3f5a'); range.setFontColor('#ffffff'); range.setFontWeight('bold');
  sheet.setFrozenRows(1);
}
function getOrCreateSheet(name, headers) {
  var sheet = sh_(name);
  if (!sheet) {
    sheet = ss_().insertSheet(name);
    sheet.appendRow(headers || BASE_HEADERS[name]);
    styleHeaderRow(sheet, (headers || BASE_HEADERS[name]).length);
    delete _hdr[name];
  }
  return sheet;
}
// header name → 1-based column (read once per execution)
function hdr_(name) {
  if (_hdr[name]) return _hdr[name];
  var sheet = sh_(name), map = {};
  if (sheet && sheet.getLastColumn() > 0) {
    var row = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (var i = 0; i < row.length; i++) if (row[i] !== '' && map[String(row[i]).trim()] === undefined) map[String(row[i]).trim()] = i + 1;
  }
  return (_hdr[name] = map);
}
function ensureCols_(name, cols) {
  var sheet = sh_(name); if (!sheet) return;
  var map = hdr_(name), last = Math.max(sheet.getLastColumn(), BASE_HEADERS[name] ? BASE_HEADERS[name].length : 0);
  cols.forEach(function (c) {
    if (!map[c]) { last++; sheet.getRange(1, last, 1, 1).setValues([[c]]); map[c] = last; }
  });
  styleHeaderRow(sheet, last);
}
function values_(name) {
  var sheet = sh_(name);
  if (!sheet || sheet.getLastRow() < 1) return [];
  return sheet.getDataRange().getValues();
}
// Column number for a field. ORIGINAL columns are always addressed by POSITION
// (exactly like the old script, whatever their heading text says); columns added
// in v3 are found by their heading.
function colOf_(name, col) {
  var base = BASE_HEADERS[name], i = base ? base.indexOf(col) : -1;
  if (i !== -1 && !(EXTRA_COLS[name] && EXTRA_COLS[name].indexOf(col) !== -1)) return i + 1;
  return hdr_(name)[col] || 0;
}
// value of a named column in a data row (row = array from getValues)
function cell_(name, row, col) { var c = colOf_(name, col); return c ? row[c - 1] : ''; }
// build a full-width row array from {field: value}
function rowFrom_(name, obj) {
  var map = hdr_(name), width = (BASE_HEADERS[name] || []).length, k;
  for (k in map) width = Math.max(width, map[k]);
  var row = []; for (var i = 0; i < width; i++) row.push('');
  for (k in obj) { var c = colOf_(name, k); if (c) row[c - 1] = obj[k]; }
  return row;
}
function appendRows_(name, rows) {
  if (!rows.length) return;
  var sheet = sh_(name), width = 0;
  rows.forEach(function (r) { width = Math.max(width, r.length); });
  rows = rows.map(function (r) { while (r.length < width) r.push(''); return r; });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, width).setValues(rows);
}
function setCells_(name, rowIndex, obj) {   // rowIndex = 1-based sheet row
  var sheet = sh_(name);
  for (var k in obj) { var c = colOf_(name, k); if (c) sheet.getRange(rowIndex, c, 1, 1).setValues([[obj[k]]]); }
}
function findRow_(name, colName, value) {   // → 1-based sheet row or -1
  var data = values_(name), c = colOf_(name, colName);
  if (!c) return -1;
  for (var i = 1; i < data.length; i++) if (String(data[i][c - 1]) === String(value)) return i + 1;
  return -1;
}
function findRowById(sheet, id, col) {     // legacy helper
  col = col || 1;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) if (String(data[i][col - 1]) === String(id)) return i + 1;
  return -1;
}

// ── Data version → cache invalidation ──────────────────────────────────────
function getDataVersion_() { return props_().getProperty('DATA_VER') || '0'; }
function bumpDataVersion_() { props_().setProperty('DATA_VER', String(Date.now())); }
function clearDataCache() { bumpDataVersion_(); }
function onEdit(e) { try { bumpDataVersion_(); } catch (err) {} }
function schemaVersion_() { return parseInt(props_().getProperty('SCHEMA_VERSION') || '0', 10); }

// ── Settings helpers ───────────────────────────────────────────────────────
function getSetting_(key, dflt) {
  var data = values_('Settings');
  for (var i = 1; i < data.length; i++) if (String(data[i][0]) === key) return String(data[i][1]);
  return dflt;
}
function staffMaxDiscountPct_() {
  var v = parseFloat(getSetting_('staff_max_discount_pct', ''));
  return isFinite(v) && v >= 0 && v <= 100 ? v : DEFAULT_STAFF_MAX_DISCOUNT_PCT;
}

// ── Sequences (call inside the write lock) ─────────────────────────────────
function nextSeq_(key, seedFn) {
  var p = props_(), cur = p.getProperty(key);
  var n = cur === null ? (seedFn ? seedFn() : 0) : parseInt(cur, 10);
  n = (isFinite(n) ? n : 0) + 1;
  p.setProperty(key, String(n));
  return n;
}

// ════════════════════════════════════════════════════════════════════════════
// AUTHENTICATION
// ════════════════════════════════════════════════════════════════════════════
function hex_(bytes) {
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length < 2 ? '0' + v : v; }).join('');
}
function hashPassword_(password, salt) {
  var h = salt + '|' + password;
  for (var i = 0; i < HASH_ROUNDS; i++) {
    h = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + '|' + salt, Utilities.Charset.UTF_8));
  }
  return h;
}
function passwordProblem_(pw, username) {
  pw = String(pw || '');
  if (pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.toLowerCase() === String(username || '').toLowerCase()) return 'Password cannot be the same as the username';
  if (/^(\d)\1+$/.test(pw) || ['12345678', '123456789', 'password', 'password1', 'srisai123', '11111111', '123.456', 'qwerty123'].indexOf(pw.toLowerCase()) !== -1)
    return 'Password is too easy to guess';
  return '';
}
function usersData_() { return values_('Users'); }
function findUser_(username) {
  var data = usersData_(), u = String(username || '').trim().toLowerCase();
  for (var i = 1; i < data.length; i++) if (String(data[i][0]).trim().toLowerCase() === u) return { row: i + 1, v: data[i] };
  return null;
}
function userObj_(f) {
  var v = f.v;
  return { username: String(v[0]), role: String(v[1]).toUpperCase() === OWNER ? OWNER : STAFF, hash: String(v[2]), salt: String(v[3]),
    active: v[4] === true || String(v[4]).toUpperCase() === 'TRUE', mustChange: v[5] === true || String(v[5]).toUpperCase() === 'TRUE',
    failed: parseInt(v[6], 10) || 0, lockedUntil: v[7] ? new Date(v[7]).getTime() || 0 : 0, displayName: String(v[10] || v[0]) };
}
function sessGen_(username) { return props_().getProperty('SGEN_' + String(username).toLowerCase()) || '0'; }
function bumpSessGen_(username) { props_().setProperty('SGEN_' + String(username).toLowerCase(), String(Date.now())); }

function createUserRow_(username, role, password, mustChange, displayName) {
  var salt = Utilities.getUuid();
  appendRows_('Users', [[username, role, hashPassword_(password, salt), salt, true, !!mustChange, 0, '', nowStr_(), '', displayName || username]]);
}

function login_(req) {
  var username = str_(req.username, 60), password = String(req.password || '');
  if (!username || !password) return fail_('VALIDATION', 'Enter username and password');
  if (!rateLimit_('login_' + username.toLowerCase(), 20, 600)) return fail_('RATE_LIMIT', 'Too many attempts. Wait 10 minutes.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var f = findUser_(username);
    if (!f) { audit_({ u: username, r: '' }, 'login', username, 'Unknown user', 'FAILED'); return fail_('LOGIN_FAILED', 'Incorrect username or password'); }
    var u = userObj_(f);
    if (!u.active) { audit_({ u: u.username, r: u.role }, 'login', u.username, 'Inactive account', 'FAILED'); return fail_('LOGIN_FAILED', 'This account is disabled. Ask the owner.'); }
    if (u.lockedUntil > Date.now()) {
      var mins = Math.ceil((u.lockedUntil - Date.now()) / 60000);
      return fail_('LOCKED', 'Too many wrong passwords. Try again in ' + mins + ' minute(s).');
    }
    if (hashPassword_(password, u.salt) !== u.hash) {
      var failed = u.failed + 1, lockUntil = '';
      if (failed >= MAX_FAILED_LOGINS) { lockUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString(); failed = 0; }
      setCells_('Users', f.row, { 'Failed Attempts': failed, 'Locked Until': lockUntil });
      audit_({ u: u.username, r: u.role }, 'login', u.username, lockUntil ? 'Wrong password — account locked ' + LOCK_MINUTES + ' min' : 'Wrong password', 'FAILED');
      return fail_(lockUntil ? 'LOCKED' : 'LOGIN_FAILED', lockUntil ? 'Too many wrong passwords. Account locked for ' + LOCK_MINUTES + ' minutes.' : 'Incorrect username or password');
    }
    setCells_('Users', f.row, { 'Failed Attempts': 0, 'Locked Until': '', 'Last Login At': nowStr_() });
    var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    var s = { u: u.username, r: u.role, n: u.displayName, mc: u.mustChange, iat: Date.now(), last: Date.now(), g: sessGen_(u.username) };
    cache_().put('S_' + token, JSON.stringify(s), 21600);
    audit_(s, 'login', u.username, '', 'OK');
    return ok_({ token: token, user: { username: u.username, role: u.role, displayName: u.displayName, mustChangePassword: u.mustChange },
      idleMinutes: IDLE_MINUTES, version: VERSION });
  } finally { lock.releaseLock(); }
}

function getSession_(token) {
  if (!token || typeof token !== 'string' || token.length < 32 || token.length > 100) return null;
  var c = cache_(), raw = c.get('S_' + token);
  if (!raw) return null;
  var s; try { s = JSON.parse(raw); } catch (e) { return null; }
  var t = Date.now();
  if (t - s.last > IDLE_MINUTES * 60000 || t - s.iat > ABSOLUTE_HOURS * 3600000 || s.g !== sessGen_(s.u)) {
    c.remove('S_' + token); return null;
  }
  if (t - s.last > 60000) { s.last = t; c.put('S_' + token, JSON.stringify(s), 21600); }
  s.token = token;
  return s;
}

function rateLimit_(key, limit, windowSec) {
  var c = cache_(), k = 'RL_' + key, n = (parseInt(c.get(k), 10) || 0) + 1;
  if (n > limit) return false;
  c.put(k, String(n), windowSec);
  return true;
}

function logout_(req, s) {
  cache_().remove('S_' + s.token);
  audit_(s, 'logout', s.u, '', 'OK');
  return ok_();
}
function whoami_(req, s) { return ok_({ user: { username: s.u, role: s.r, displayName: s.n, mustChangePassword: !!s.mc }, version: VERSION }); }

function changePassword_(req, s) {
  var f = findUser_(s.u); if (!f) return fail_('AUTH_REQUIRED', 'Please log in again');
  var u = userObj_(f);
  if (hashPassword_(String(req.oldPassword || ''), u.salt) !== u.hash) return fail_('VALIDATION', 'Current password is wrong');
  var problem = passwordProblem_(req.newPassword, u.username); if (problem) return fail_('VALIDATION', problem);
  if (String(req.newPassword) === String(req.oldPassword)) return fail_('VALIDATION', 'New password must be different');
  var salt = Utilities.getUuid();
  setCells_('Users', f.row, { 'Password Hash': hashPassword_(String(req.newPassword), salt), 'Salt': salt, 'Must Change Password': false });
  bumpSessGen_(u.username);                       // ends every other session of this user
  var ns = { u: u.username, r: u.role, n: u.displayName, mc: false, iat: Date.now(), last: Date.now(), g: sessGen_(u.username) };
  cache_().put('S_' + s.token, JSON.stringify(ns), 21600);   // this device stays logged in
  audit_(s, 'changePassword', u.username, '', 'OK');
  return ok_();
}

function listUsers_() {
  var data = usersData_(), out = [];
  for (var i = 1; i < data.length; i++) {
    var u = userObj_({ v: data[i] });
    out.push({ username: u.username, role: u.role, active: u.active, mustChangePassword: u.mustChange,
      locked: u.lockedUntil > Date.now(), lastLogin: String(data[i][9] || ''), displayName: u.displayName });
  }
  return ok_({ users: out });
}
function createUser_(req, s) {
  var username = str_(req.username, 40).toLowerCase(), role = String(req.role || STAFF).toUpperCase() === OWNER ? OWNER : STAFF;
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return fail_('VALIDATION', 'Username: 3–40 letters/numbers (no spaces)');
  if (findUser_(username)) return fail_('VALIDATION', 'That username already exists');
  var problem = passwordProblem_(req.password, username); if (problem) return fail_('VALIDATION', problem);
  createUserRow_(username, role, String(req.password), true, str_(req.displayName, 60) || username);
  audit_(s, 'createUser', username, 'Role ' + role, 'OK');
  return ok_();
}
function resetUserPassword_(req, s) {
  var f = findUser_(req.username); if (!f) return fail_('VALIDATION', 'User not found');
  var u = userObj_(f), problem = passwordProblem_(req.newPassword, u.username); if (problem) return fail_('VALIDATION', problem);
  var salt = Utilities.getUuid();
  setCells_('Users', f.row, { 'Password Hash': hashPassword_(String(req.newPassword), salt), 'Salt': salt, 'Must Change Password': true, 'Failed Attempts': 0, 'Locked Until': '' });
  bumpSessGen_(u.username);
  audit_(s, 'resetUserPassword', u.username, 'Temporary password set', 'OK');
  return ok_();
}
function setUserActive_(req, s) {
  var f = findUser_(req.username); if (!f) return fail_('VALIDATION', 'User not found');
  var active = req.active === true || String(req.active).toLowerCase() === 'true';
  if (!active && String(f.v[0]).toLowerCase() === String(s.u).toLowerCase()) return fail_('VALIDATION', 'You cannot disable your own account');
  if (!active && String(f.v[1]).toUpperCase() === OWNER) {
    var owners = usersData_().slice(1).filter(function (r) { return String(r[1]).toUpperCase() === OWNER && (r[4] === true || String(r[4]).toUpperCase() === 'TRUE'); });
    if (owners.length <= 1) return fail_('VALIDATION', 'At least one active owner is required');
  }
  setCells_('Users', f.row, { 'Active': active });
  bumpSessGen_(f.v[0]);
  audit_(s, 'setUserActive', String(f.v[0]), active ? 'Enabled' : 'Disabled', 'OK');
  return ok_();
}

// Owner recovery: run from the Apps Script editor (only the Google account that
// owns the script can do this). Sets a random temporary password and e-mails it.
function emergencyResetOwnerPassword() {
  var data = usersData_(), row = -1, name = '';
  for (var i = 1; i < data.length; i++) if (String(data[i][1]).toUpperCase() === OWNER) { row = i + 1; name = String(data[i][0]); break; }
  if (row < 0) throw new Error('No owner account found');
  var temp = 'Ssdc-' + Utilities.getUuid().slice(0, 8);
  var salt = Utilities.getUuid();
  setCells_('Users', row, { 'Password Hash': hashPassword_(temp, salt), 'Salt': salt, 'Must Change Password': true, 'Failed Attempts': 0, 'Locked Until': '', 'Active': true });
  bumpSessGen_(name);
  audit_({ u: 'script-editor', r: OWNER }, 'emergencyResetOwnerPassword', name, '', 'OK');
  var email = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(email, 'SSDC billing — temporary owner password', 'Username: ' + name + '\nTemporary password: ' + temp + '\n\nYou will be asked to change it after logging in.');
  Logger.log('Temporary password e-mailed to ' + email);
}

// ── Audit log ──────────────────────────────────────────────────────────────
function audit_(s, action, target, details, result) {
  try {
    var sheet = sh_('AuditLog'); if (!sheet) return;
    sheet.appendRow([nowStr_(), (s && s.u) || '', (s && s.r) || '', action, str_(target, 100), str_(details, 500), result || 'OK']);
  } catch (e) {}
}
function getAuditLog_(req) {
  var limit = Math.min(Math.max(parseInt(req.limit, 10) || 300, 1), 2000);
  var data = values_('AuditLog'), out = [];
  for (var i = data.length - 1; i >= 1 && out.length < limit; i--) {
    var r = data[i];
    out.push({ at: String(r[0] instanceof Date ? Utilities.formatDate(r[0], tz_(), 'yyyy-MM-dd HH:mm:ss') : r[0]), user: String(r[1]), role: String(r[2]),
      action: String(r[3]), target: String(r[4]), details: String(r[5]), result: String(r[6]) });
  }
  return ok_({ entries: out });
}

// ════════════════════════════════════════════════════════════════════════════
// REQUEST ENTRY POINTS
// ════════════════════════════════════════════════════════════════════════════
function doGet(e) {
  var a = e && e.parameter && e.parameter.action;
  if (a === 'ping') return json_(ok_({ app: 'SSDC', version: VERSION, schema: schemaVersion_() }));
  return json_(fail_('USE_POST', 'This server needs the updated app (secure login). Please refresh the app.'));
}

function doPost(e) {
  var req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_(fail_('BAD_REQUEST', 'Invalid request')); }
  try { return json_(handle_(req)); }
  catch (err2) { return json_(fail_('SERVER_ERROR', String(err2 && err2.message || err2))); }
}

var ACTIONS = {};   // filled at the bottom of the file

function handle_(req) {
  var action = str_(req.action, 40);
  if (action === 'ping') return ok_({ app: 'SSDC', version: VERSION, schema: schemaVersion_() });
  if (schemaVersion_() < SCHEMA_VERSION) return fail_('MIGRATION_REQUIRED', 'Server update not finished: the owner must run migrateToV3 in Apps Script.');
  if (action === 'login') return login_(req);

  var s = getSession_(req.token);
  if (!s) return fail_('AUTH_REQUIRED', 'Your session has ended. Please log in again.');
  if (!rateLimit_('u_' + s.u.toLowerCase(), 300, 300)) return fail_('RATE_LIMIT', 'Too many requests — slow down for a minute.');
  if (s.mc && action !== 'changePassword' && action !== 'logout' && action !== 'whoami')
    return fail_('MUST_CHANGE_PASSWORD', 'Please set a new password first.');

  var rule = PERMS[action], fn = ACTIONS[action];
  if (!rule || !fn) return fail_('UNKNOWN_ACTION', 'Unknown action: ' + action);
  var allowed = typeof rule === 'function' ? rule(s, req) : (rule === ANY || s.r === rule);
  if (!allowed) { audit_(s, action, req.id || req.billId || '', 'Permission denied', 'DENIED'); return fail_('FORBIDDEN', 'Only the owner can do this.'); }

  if (READ_ONLY[action]) return fn(req, s);

  // ── writes: idempotent by request ID, serialized by lock ──
  var reqId = str_(req.reqId, 64), c = cache_();
  if (reqId) { var prev = c.get('RQ_' + reqId); if (prev) return JSON.parse(prev); }
  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (e) { return fail_('BUSY', 'Server busy, please retry.'); }
  try {
    if (reqId) { var prev2 = c.get('RQ_' + reqId); if (prev2) return JSON.parse(prev2); }
    var res = fn(req, s);
    if (res && res.success !== false) {
      bumpDataVersion_();
      if (reqId) c.put('RQ_' + reqId, JSON.stringify(res), 21600);
    } else if (res && (res.code === 'VALIDATION' || res.code === 'DUPLICATE')) {
      audit_(s, action, req.billId || req.id || req.recordId || '', res.error, 'REJECTED');   // possible mistake or tampering
    }
    return res;
  } catch (err) {
    audit_(s, action, req.id || req.billId || '', String(err && err.message || err), 'ERROR');
    return fail_('SERVER_ERROR', String(err && err.message || err));
  } finally { lock.releaseLock(); }
}

// ════════════════════════════════════════════════════════════════════════════
// INVENTORY: BATCHES, FEFO, STOCK MOVEMENTS
// ════════════════════════════════════════════════════════════════════════════
function loadBatches_() {
  var data = values_('Batches'), list = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i]; if (!r[0]) continue;
    list.push({ row: i + 1, batchId: String(r[0]), medicineId: String(r[1]), batchNo: String(r[2] || ''), expiry: formatDate(r[3]),
      received: num_(r[4]), avail: num_(r[5]), cost: num_(r[6]), mrp: num_(r[7]), supplier: String(r[8] || ''),
      purchaseId: String(r[9] || ''), receivedAt: String(r[10] || ''), status: String(r[11] || 'Active'), dirty: false });
  }
  return list;
}
function saveBatches_(list) {   // writes Qty Available + Status of changed rows (one call per column)
  var sheet = sh_('Batches'); if (!sheet || sheet.getLastRow() < 2) return;
  var n = sheet.getLastRow() - 1;
  var qtyR = sheet.getRange(2, 6, n, 1), stR = sheet.getRange(2, 12, n, 1);
  var q = qtyR.getValues(), st = stR.getValues(), changed = false;
  list.forEach(function (b) { if (b.dirty && b.row >= 2) { q[b.row - 2][0] = b.avail; st[b.row - 2][0] = b.status; changed = true; } });
  if (changed) { qtyR.setValues(q); stR.setValues(st); }
}
function isSellable_(b, today) { return b.status === 'Active' && b.avail > 0 && (!b.expiry || b.expiry >= today); }
function fefoSort_(a, b) {
  if (a.expiry !== b.expiry) { if (!a.expiry) return 1; if (!b.expiry) return -1; return a.expiry < b.expiry ? -1 : 1; }
  return a.row - b.row;
}
// Allocate qty from the earliest-expiring sellable batches.
function allocateFefo_(batches, medicineId, qty, today) {
  var cands = batches.filter(function (b) { return b.medicineId === String(medicineId) && isSellable_(b, today); }).sort(fefoSort_);
  var allocs = [], left = qty;
  for (var i = 0; i < cands.length && left > 0; i++) {
    var take = Math.min(cands[i].avail, left);
    cands[i].avail = r2_(cands[i].avail - take); cands[i].dirty = true;
    allocs.push({ b: cands[i].batchId, q: take, c: cands[i].cost });
    left -= take;
  }
  return { allocs: allocs, short: left };
}
function loadMedicines_() {
  var data = values_('Medicines'), map = {}, list = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i]; if (!r[0]) continue;
    var m = { row: i + 1, id: String(r[0]), name: String(r[1] || ''), stock: num_(r[2]), price: num_(r[3]), costPrice: num_(r[4]),
      expiry: formatDate(r[5]), minStock: num_(cell_('Medicines', r, 'Min Stock')), status: String(cell_('Medicines', r, 'Status') || 'Active') };
    map[m.id] = m; list.push(m);
  }
  return { map: map, list: list };
}
// Recompute Stock (= total available, incl. expired) and Expiry (= earliest available batch) for the given medicines.
function syncMedicineStock_(meds, batches, ids) {
  var sheet = sh_('Medicines'); if (!sheet || sheet.getLastRow() < 2) return;
  var n = sheet.getLastRow() - 1, stockR = sheet.getRange(2, 3, n, 1), expR = sheet.getRange(2, 6, n, 1);
  var st = stockR.getValues(), ex = expR.getValues();
  ids.forEach(function (id) {
    var m = meds.map[String(id)]; if (!m) return;
    var mine = batches.filter(function (b) { return b.medicineId === m.id && b.status === 'Active' && b.avail > 0; });
    var total = 0, earliest = '';
    mine.forEach(function (b) { total += b.avail; if (b.expiry && (!earliest || b.expiry < earliest)) earliest = b.expiry; });
    m.stock = r2_(total); if (earliest) m.expiry = earliest;
    st[m.row - 2][0] = m.stock; if (earliest) ex[m.row - 2][0] = earliest;
  });
  stockR.setValues(st); expR.setValues(ex);
}
function movementRow_(medId, medName, batchId, qty, type, ref, user, reason, stockAfter) {
  return [uid_('MV-'), nowStr_(), medId, medName, batchId, qty, type, ref, user, reason || '', stockAfter];
}
function newBatchRow_(o) {
  return [o.batchId, o.medicineId, o.batchNo || '', o.expiry || '', o.qty, o.qty, o.cost || 0, o.mrp || '', o.supplier || '', o.purchaseId || '', nowStr_(), 'Active'];
}

// ════════════════════════════════════════════════════════════════════════════
// GET ALL DATA (cached per role)
// ════════════════════════════════════════════════════════════════════════════
function getAllData_(req, s) {
  var c = cache_(), ver = getDataVersion_(), prefix = 'AD' + s.r.charAt(0) + '_' + ver + '_';
  try {
    var n = parseInt(c.get(prefix + 'n'), 10);
    if (n > 0) {
      var keys = []; for (var k = 0; k < n; k++) keys.push(prefix + k);
      var got = c.getAll(keys), parts = [];
      for (var k2 = 0; k2 < n; k2++) { if (got[keys[k2]] == null) { parts = null; break; } parts.push(got[keys[k2]]); }
      if (parts) return { __raw: parts.join('') };
    }
  } catch (e) {}
  var result = buildAllData_(s.r), json = JSON.stringify(result);
  if (getDataVersion_() === ver) {
    try {
      var entries = {}, count = 0;
      for (var p = 0; p < json.length; p += CACHE_CHUNK) entries[prefix + (count++)] = json.substring(p, p + CACHE_CHUNK);
      entries[prefix + 'n'] = String(count);
      c.putAll(entries, CACHE_TTL_SECONDS);
    } catch (e2) {}
  }
  return { __raw: json };
}

function buildAllData_(role) {
  var isOwner = role === OWNER, today = todayStr_(), staffFrom = daysAgoStr_(STAFF_BILL_DAYS);
  var meds = loadMedicines_(), batches = loadBatches_();

  // ── medicines (+ batches for owner) ──
  var medicines = [];
  meds.list.forEach(function (m) {
    if (m.status === 'Inactive') return;
    var mine = batches.filter(function (b) { return b.medicineId === m.id && b.status === 'Active' && b.avail > 0; }).sort(fefoSort_);
    var sellable = 0, expired = 0, nextExp = '';
    mine.forEach(function (b) { if (!b.expiry || b.expiry >= today) { sellable += b.avail; if (b.expiry && !nextExp) nextExp = b.expiry; } else expired += b.avail; });
    var o = { id: isFinite(Number(m.id)) && m.id !== '' ? Number(m.id) : m.id, name: m.name,
      stock: mine.length ? r2_(sellable) : m.stock, expiredStock: r2_(expired),
      price: m.price, expiry: nextExp || m.expiry, minStock: m.minStock };
    if (isOwner) {
      o.costPrice = m.costPrice;
      o.batches = mine.map(function (b) { return { batchId: b.batchId, batchNo: b.batchNo, expiry: b.expiry, qty: b.avail, cost: b.cost, mrp: b.mrp, supplier: b.supplier }; });
    }
    medicines.push(o);
  });

  // ── bill items ──
  var allItems = {}, iData = values_('BillItems');
  for (var j = 1; j < iData.length; j++) {
    var ir = iData[j]; if (!ir[0]) continue;
    var bId = String(ir[0]);
    (allItems[bId] = allItems[bId] || []).push(isOwner
      ? { medicineId: ir[1], medicineName: ir[2], qty: num_(ir[3]), price: num_(ir[4]), costPrice: num_(ir[5]), amount: num_(ir[6]) }
      : { medicineId: ir[1], medicineName: ir[2], qty: num_(ir[3]), price: num_(ir[4]), amount: num_(ir[6]) });
  }

  // ── bills ──
  var bills = [], cancelledBills = [], bData = values_('Bills');
  var validModes = { cash: 'Cash', upi: 'UPI', card: 'Card', split: 'Split', cheque: 'Cheque', online: 'Online', neft: 'NEFT', rtgs: 'RTGS' };
  for (var i = 1; i < bData.length; i++) {
    var br = bData[i]; if (!br[0]) continue;
    var id = String(br[0]), date = formatDate(br[4]);
    if (!isOwner && date < staffFrom) continue;
    var pm = validModes[String(br[9] || '').trim().toLowerCase()] || 'Cash';
    var b = { billId: id, billNo: String(cell_('Bills', br, 'Bill No') || ''), patientName: br[1], doctor: br[2], phone: String(br[3] || ''), date: date,
      subtotal: num_(br[5]), discount: num_(br[6]), total: num_(br[7]), paymentMode: pm,
      cashAmount: num_(cell_('Bills', br, 'Cash Amount')), upiAmount: num_(cell_('Bills', br, 'UPI Amount')), cardAmount: num_(cell_('Bills', br, 'Card Amount')),
      paymentRef: String(cell_('Bills', br, 'Payment Ref') || ''), createdBy: String(cell_('Bills', br, 'Created By') || ''),
      items: allItems[id] || [] };
    if (isOwner) b.costTotal = num_(br[8]);
    var status = String(cell_('Bills', br, 'Status') || 'Active');
    if (status === 'Cancelled') {
      if (isOwner) { b.status = 'Cancelled'; b.cancelledAt = String(cell_('Bills', br, 'Cancelled At') || ''); b.cancelledBy = String(cell_('Bills', br, 'Cancelled By') || ''); b.cancelReason = String(cell_('Bills', br, 'Cancel Reason') || ''); cancelledBills.push(b); }
    } else bills.push(b);
  }

  // ── purchases (owner) ──
  var purchases = [];
  if (isOwner) {
    var pData = values_('Purchases');
    for (var pi = 1; pi < pData.length; pi++) {
      var pr = pData[pi]; if (!pr[0]) continue;
      if (String(cell_('Purchases', pr, 'Status') || 'Active') === 'Cancelled') continue;
      purchases.push({ id: String(pr[0]), date: formatDate(pr[1]), supplier: pr[2], medicineId: pr[3], medicineName: pr[4],
        qty: num_(pr[5]), costPrice: num_(pr[6]), totalCost: num_(pr[7]),
        batchNo: String(cell_('Purchases', pr, 'Batch No') || ''), expiry: formatDate(cell_('Purchases', pr, 'Expiry')),
        invoiceNo: String(cell_('Purchases', pr, 'Invoice No') || ''), batchId: String(cell_('Purchases', pr, 'Batch ID') || '') });
    }
  }

  // ── patients ──
  var patients = [], ptData = values_('Patients');
  for (var q = 1; q < ptData.length; q++) {
    var p = ptData[q]; if (!p[0] || String(p[9]) === 'Deleted') continue;
    patients.push({ id: p[0], name: p[1], phone: String(p[2] || ''), age: p[3], sex: p[4], doctor: p[5], treatment: p[6],
      balance: num_(p[7]), alerts: p[8], status: p[9], lastVisit: formatDate(p[10]), addedOn: formatDate(p[11]) });
  }

  // ── appointments ──
  var appointments = [], aData = values_('Appointments');
  for (var a = 1; a < aData.length; a++) {
    var ar = aData[a]; if (!ar[0] || String(ar[7]) === 'Deleted') continue;
    appointments.push({ id: ar[0], patient: ar[1], phone: String(ar[2] || ''), date: formatDate(ar[3]), time: formatTime(ar[4]),
      reason: ar[5], doctor: ar[6], status: ar[7], bookedAt: String(ar[8] || '') });
  }

  // ── treatment receipts (dental revenue) ──
  var treatmentReceipts = [], tData = values_('TreatmentReceipts');
  for (var t = 1; t < tData.length; t++) {
    var tr = tData[t]; if (!tr[0] && !tr[2]) continue;
    if (String(cell_('TreatmentReceipts', tr, 'Status') || '') === 'Deleted') continue;
    var tDate = formatDate(tr[1]);
    if (!isOwner && tDate < staffFrom) continue;
    treatmentReceipts.push({ no: String(tr[0]), date: tDate, patient: String(tr[2] || ''), doctor: String(tr[3] || ''), amount: num_(tr[4]),
      amountWords: String(tr[5] || ''), treatments: String(tr[6] || ''), savedAt: String(tr[7] || ''),
      paymentMode: String(cell_('TreatmentReceipts', tr, 'Payment Mode') || ''), recordId: String(cell_('TreatmentReceipts', tr, 'Record ID') || '') });
  }

  // ── expenses (owner) ──
  var expenses = isOwner ? readExpenses_() : [];

  return { success: true, version: VERSION, role: role, today: today, serverTime: nowStr_(),
    staffMaxDiscountPct: staffMaxDiscountPct_(),
    medicines: medicines, bills: bills, cancelledBills: cancelledBills, purchases: purchases, patients: patients,
    appointments: appointments, treatmentReceipts: treatmentReceipts, expenses: expenses };
}

function readExpenses_() {
  var out = [], data = values_('Expenses');
  for (var i = 1; i < data.length; i++) {
    var r = data[i]; if (!r[0] || String(cell_('Expenses', r, 'Status') || '') === 'Deleted') continue;
    out.push({ id: String(r[0]), date: formatDate(r[1]), category: String(r[2] || ''), amount: num_(r[3]), vendor: String(r[4] || ''),
      notes: String(r[5] || ''), mode: String(r[6] || 'Cash'), addedAt: String(r[7] || '') });
  }
  return out;
}
function getExpenses_() { return ok_({ expenses: readExpenses_() }); }

// ════════════════════════════════════════════════════════════════════════════
// BILLS
// ════════════════════════════════════════════════════════════════════════════
function parseItems_(raw) {
  if (Array.isArray(raw)) return raw;
  try { var v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return null; }
}

function saveBill_(req, s) {
  var billId = str_(req.billId, 60);
  if (!/^[A-Za-z0-9_-]{4,60}$/.test(billId)) return fail_('VALIDATION', 'Invalid bill ID');
  var patient = str_(req.patientName, 120);
  if (!patient) return fail_('VALIDATION', 'Patient name is required');
  var items = parseItems_(req.items);
  if (items === null) return fail_('VALIDATION', 'Bill items are unreadable');
  if (!items.length) return fail_('VALIDATION', 'A bill needs at least one item');
  if (items.length > 200) return fail_('VALIDATION', 'Too many items in one bill');

  // ── duplicate protection (retries / double taps) ──
  var bills = values_('Bills'), billNoCol = colOf_('Bills', 'Bill No');
  for (var d = bills.length - 1; d >= 1; d--) {
    if (String(bills[d][0]) === billId) return ok_({ billId: billId, billNo: billNoCol ? String(bills[d][billNoCol - 1] || '') : '', duplicate: true });
  }

  // ── validate every line and recompute totals on the server ──
  var meds = loadMedicines_(), warnings = [], subtotal = 0, clean = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {}, qty = Number(it.qty), price = Number(it.price);
    var label = str_(it.medicineName || it.name, 120) || ('item ' + (i + 1));
    if (!isFinite(qty) || qty <= 0 || Math.floor(qty) !== qty || qty > 100000) return fail_('VALIDATION', 'Invalid quantity for ' + label);
    if (!isFinite(price) || price < 0 || price > 1000000) return fail_('VALIDATION', 'Invalid price for ' + label);
    var amount = r2_(qty * price);
    if (it.amount !== undefined && it.amount !== '' && Math.abs(num_(it.amount) - amount) > 0.011) return fail_('VALIDATION', 'Line total does not match qty × price for ' + label);
    var mid = str_(it.medicineId, 60), med = mid ? meds.map[mid] : null;
    if (mid && !med) return fail_('VALIDATION', label + ' is not in the medicine list (refresh the app)');
    if (med && Math.abs(med.price - price) > 0.001) warnings.push(label + ': billed at ₹' + price + ', list price ₹' + med.price);
    subtotal += amount;
    clean.push({ medicineId: mid, name: med ? med.name : label, qty: qty, price: price, amount: amount, med: med });
  }
  subtotal = r2_(subtotal);
  if (req.subtotal !== undefined && req.subtotal !== '' && Math.abs(num_(req.subtotal) - subtotal) > 0.011) return fail_('VALIDATION', 'Subtotal does not match the items');
  var discount = r2_(req.discount);
  if (discount < 0 || discount > subtotal) return fail_('VALIDATION', 'Invalid discount');
  var maxPct = s.r === OWNER ? 100 : staffMaxDiscountPct_();
  if (discount > r2_(subtotal * maxPct / 100) + 0.01) return fail_('VALIDATION', 'Discount above the allowed ' + maxPct + '% — ask the owner');
  var total = r2_(subtotal - discount);
  if (req.total !== undefined && req.total !== '' && Math.abs(num_(req.total) - total) > 0.011) return fail_('VALIDATION', 'Total does not match subtotal − discount');

  // ── payment ──
  var modeMap = { cash: 'Cash', upi: 'UPI', card: 'Card', split: 'Split' };
  var mode = modeMap[String(req.paymentMode || 'Cash').toLowerCase()];
  if (!mode) return fail_('VALIDATION', 'Unknown payment mode');
  var cash = 0, upi = 0, card = 0;
  if (mode === 'Cash') cash = total; else if (mode === 'UPI') upi = total; else if (mode === 'Card') card = total;
  else {
    cash = r2_(req.cashAmount); upi = r2_(req.upiAmount); card = r2_(req.cardAmount);
    if (cash < 0 || upi < 0 || card < 0) return fail_('VALIDATION', 'Invalid split amounts');
    if (cash + upi + card === 0) warnings.push('Split payment without amounts (old app version)');
    else if (Math.abs(cash + upi + card - total) > 0.5) return fail_('VALIDATION', 'Split amounts must add up to the total');
  }

  // ── FEFO stock allocation ──
  var batches = loadBatches_(), today = todayStr_(), costTotal = 0, movements = [], touched = {}, itemRows = [], dt = nowStr_();
  clean.forEach(function (c) {
    var allocJson = '', cost = 0;
    if (c.med) {
      var al = allocateFefo_(batches, c.med.id, c.qty, today);
      al.allocs.forEach(function (a) { cost += a.q * a.c; movements.push({ med: c.med, batch: a.b, qty: -a.q, type: 'SALE' }); });
      if (al.short > 0) {
        cost += al.short * c.med.costPrice;
        movements.push({ med: c.med, batch: '', qty: -al.short, type: 'SALE_UNALLOCATED', reason: 'Not enough unexpired stock' });
        warnings.push(c.name + ': only ' + (c.qty - al.short) + ' in stock — ' + al.short + ' recorded as shortfall');
      }
      allocJson = JSON.stringify(al.allocs.map(function (a) { return { b: a.b, q: a.q }; }));
      touched[c.med.id] = 1;
    }
    cost = r2_(cost); costTotal += cost;
    itemRows.push([billId, c.medicineId, c.name, c.qty, c.price, c.qty ? r2_(cost / c.qty) : 0, c.amount, dt, allocJson]);
  });
  costTotal = r2_(costTotal);

  // ── bill number ──
  var yy = today.slice(2, 4);
  var billNo = 'SSDC-' + yy + '-' + ('00000' + nextSeq_('SEQ_BILL_' + yy)).slice(-5);

  // ── write everything ──
  appendRows_('Bills', [rowFrom_('Bills', {
    'Bill ID': billId, 'Patient Name': patient, 'Doctor': str_(req.doctor, 80), 'Phone': str_(req.phone, 20), 'Date': today,
    'Subtotal': subtotal, 'Discount': discount, 'Total': total, 'Cost Total': costTotal, 'Payment Mode': mode, 'Date & Time': dt,
    'Status': 'Active', 'Bill No': billNo, 'Created By': s.u, 'Payment Ref': str_(req.paymentRef, 80),
    'Cash Amount': cash, 'UPI Amount': upi, 'Card Amount': card })]);
  appendRows_('BillItems', itemRows.map(function (r) { var o = {}; ['Bill ID','Medicine ID','Medicine Name','Quantity','Unit Price','Cost Price','Amount','Date & Time','Batch Allocation'].forEach(function (h, k) { o[h] = r[k]; }); return rowFrom_('BillItems', o); }));
  saveBatches_(batches);
  syncMedicineStock_(meds, batches, Object.keys(touched));
  appendRows_('StockMovements', movements.map(function (m) { return movementRow_(m.med.id, m.med.name, m.batch, m.qty, m.type, billId, s.u, m.reason, meds.map[m.med.id].stock); }));
  audit_(s, 'saveBill', billId, billNo + ' · ₹' + total + ' · ' + mode + (warnings.length ? ' · ' + warnings.join('; ') : ''), warnings.length ? 'WARN' : 'OK');
  return ok_({ billId: billId, billNo: billNo, subtotal: subtotal, discount: discount, total: total, costTotal: costTotal, warnings: warnings });
}

function cancelBill_(req, s) {
  var billId = str_(req.billId, 60), reason = str_(req.reason, 300) || (req.action === 'deleteBill' ? 'Removed from the app' : '');
  if (!billId) return fail_('VALIDATION', 'Bill ID required');
  if (reason.length < 3) return fail_('VALIDATION', 'Please give a reason for cancelling');
  var row = findRow_('Bills', 'Bill ID', billId);
  if (row < 0) return fail_('VALIDATION', 'Bill not found');
  var bRow = sh_('Bills').getRange(row, 1, 1, sh_('Bills').getLastColumn()).getValues()[0];
  if (String(cell_('Bills', bRow, 'Status')) === 'Cancelled') return ok_({ billId: billId, alreadyCancelled: true });
  var restore = !(req.restoreStock === false || String(req.restoreStock) === 'false');

  var movements = [], meds = loadMedicines_(), batches = loadBatches_(), touched = {};
  if (restore) {
    var items = values_('BillItems'), byId = {}; batches.forEach(function (b) { byId[b.batchId] = b; });
    for (var i = 1; i < items.length; i++) {
      var r = items[i]; if (String(r[0]) !== billId) continue;
      var med = meds.map[String(r[1])]; if (!med) continue;
      var allocs = []; try { allocs = JSON.parse(cell_('BillItems', r, 'Batch Allocation') || '[]'); } catch (e) {}
      var qty = num_(r[3]), restored = 0;
      allocs.forEach(function (a) { var b = byId[a.b]; if (b) { b.avail = r2_(b.avail + a.q); if (b.status !== 'Active') b.status = 'Active'; b.dirty = true; restored += a.q; movements.push({ med: med, batch: b.batchId, qty: a.q }); } });
      var rest = r2_(qty - restored);
      if (rest > 0 && !allocs.length) {   // bill made before v3: return to the earliest-expiring active batch
        var target = batches.filter(function (b) { return b.medicineId === med.id && b.status === 'Active'; }).sort(fefoSort_)[0];
        if (target) { target.avail = r2_(target.avail + rest); target.dirty = true; movements.push({ med: med, batch: target.batchId, qty: rest }); }
        else {
          var nb = uid_('B-'); appendRows_('Batches', [newBatchRow_({ batchId: nb, medicineId: med.id, batchNo: 'RETURN', expiry: med.expiry, qty: rest, cost: med.costPrice })]);
          batches.push({ row: -1, batchId: nb, medicineId: med.id, expiry: med.expiry, avail: rest, status: 'Active', cost: med.costPrice });
          movements.push({ med: med, batch: nb, qty: rest });
        }
      }
      touched[med.id] = 1;
    }
    saveBatches_(batches);
    syncMedicineStock_(meds, batches, Object.keys(touched));
  }
  setCells_('Bills', row, { 'Status': 'Cancelled', 'Cancelled At': nowStr_(), 'Cancelled By': s.u, 'Cancel Reason': reason });
  appendRows_('StockMovements', movements.map(function (m) { return movementRow_(m.med.id, m.med.name, m.batch, m.qty, 'BILL_CANCEL', billId, s.u, reason, meds.map[m.med.id].stock); }));
  audit_(s, 'cancelBill', billId, reason + (restore ? ' · stock restored' : ' · stock NOT restored'), 'OK');
  return ok_({ billId: billId });
}

// ════════════════════════════════════════════════════════════════════════════
// MEDICINES, PURCHASES, STOCK ADJUSTMENTS
// ════════════════════════════════════════════════════════════════════════════
function addMedicine_(req, s) {
  var name = str_(req.name, 120), price = num_(req.price), cost = num_(req.costPrice), stock = num_(req.stock);
  if (!name) return fail_('VALIDATION', 'Medicine name is required');
  if (price < 0 || cost < 0 || price > 1000000) return fail_('VALIDATION', 'Invalid price');
  if (stock < 0 || Math.floor(stock) !== stock) return fail_('VALIDATION', 'Invalid opening stock');
  var meds = loadMedicines_();
  var dup = meds.list.filter(function (m) { return m.status !== 'Inactive' && m.name.trim().toLowerCase() === name.toLowerCase(); })[0];
  if (dup) return ok_({ medicineId: Number(dup.id) || dup.id, duplicate: true });
  var id = Date.now(), expiry = formatDate(req.expiry);
  appendRows_('Medicines', [rowFrom_('Medicines', { 'ID': id, 'Name': name, 'Stock': stock, 'Unit Price': price, 'Cost Price': cost, 'Expiry': expiry,
    'Date & Time': nowStr_(), 'Min Stock': num_(req.minStock) || 10, 'Status': 'Active' })]);
  if (stock > 0) {
    var bid = uid_('B-');
    appendRows_('Batches', [newBatchRow_({ batchId: bid, medicineId: String(id), batchNo: str_(req.batchNo, 40) || 'OPENING', expiry: expiry, qty: stock, cost: cost })]);
    appendRows_('StockMovements', [movementRow_(id, name, bid, stock, 'OPENING', String(id), s.u, 'Opening stock', stock)]);
  }
  audit_(s, 'addMedicine', String(id), name + ' · ₹' + price, 'OK');
  return ok_({ medicineId: id });
}

function updateMedicine_(req, s) {
  var row = findRow_('Medicines', 'ID', req.id); if (row < 0) return fail_('VALIDATION', 'Medicine not found');
  var upd = {}, changes = [];
  if (req.name !== undefined && str_(req.name)) { upd['Name'] = str_(req.name, 120); changes.push('name'); }
  if (req.price !== undefined && req.price !== '') { var p = num_(req.price); if (p < 0) return fail_('VALIDATION', 'Invalid price'); upd['Unit Price'] = p; changes.push('price ₹' + p); }
  if (req.costPrice !== undefined && req.costPrice !== '') { var cp = num_(req.costPrice); if (cp < 0) return fail_('VALIDATION', 'Invalid cost'); upd['Cost Price'] = cp; changes.push('cost ₹' + cp); }
  if (req.minStock !== undefined && req.minStock !== '') { upd['Min Stock'] = Math.max(0, num_(req.minStock)); changes.push('min stock'); }
  if (req.stock !== undefined && req.stock !== '') return fail_('VALIDATION', 'Stock can only be changed with a stock adjustment (so it is recorded)');
  upd['Date & Time'] = nowStr_();
  setCells_('Medicines', row, upd);
  audit_(s, 'updateMedicine', String(req.id), changes.join(', '), 'OK');
  return ok_();
}

function deleteMedicine_(req, s) {   // never erased: marked Inactive (keeps bill history intact)
  var row = findRow_('Medicines', 'ID', req.id); if (row < 0) return ok_();
  setCells_('Medicines', row, { 'Status': 'Inactive', 'Date & Time': nowStr_() });
  audit_(s, 'deleteMedicine', String(req.id), 'Marked inactive', 'OK');
  return ok_();
}

function addPurchase_(req, s) {
  var id = str_(req.id, 60) || uid_('PUR-');
  if (findRow_('Purchases', 'ID', id) > 0) return ok_({ id: id, duplicate: true });
  var meds = loadMedicines_(), med = meds.map[str_(req.medicineId, 60)];
  if (!med) return fail_('VALIDATION', 'Medicine not found — refresh the app and try again');
  var qty = Number(req.qty), cost = num_(req.costPrice), freeQty = num_(req.freeQty);
  if (!isFinite(qty) || qty <= 0 || Math.floor(qty) !== qty) return fail_('VALIDATION', 'Invalid quantity');
  if (freeQty < 0 || Math.floor(freeQty) !== freeQty) return fail_('VALIDATION', 'Invalid free quantity');
  if (cost < 0) return fail_('VALIDATION', 'Invalid cost price');
  var batchNo = str_(req.batchNo, 40), expiry = formatDate(req.expiry), invoiceNo = str_(req.invoiceNo, 60), supplier = str_(req.supplier, 120);
  if (invoiceNo && batchNo) {   // same invoice + medicine + batch entered twice?
    var pd = values_('Purchases');
    for (var i = 1; i < pd.length; i++) {
      if (String(cell_('Purchases', pd[i], 'Status') || 'Active') === 'Cancelled') continue;
      if (String(cell_('Purchases', pd[i], 'Invoice No')) === invoiceNo && String(pd[i][3]) === med.id && String(cell_('Purchases', pd[i], 'Batch No')) === batchNo)
        return fail_('DUPLICATE', 'This invoice line (' + invoiceNo + ', batch ' + batchNo + ') is already entered');
    }
  }
  var totalQty = qty + freeQty, batchId = uid_('B-'), effCost = r2_(qty * cost / totalQty);
  var date = formatDate(req.date) || todayStr_();
  appendRows_('Purchases', [rowFrom_('Purchases', { 'ID': id, 'Date': date, 'Supplier': supplier, 'Medicine ID': med.id, 'Medicine Name': med.name,
    'Quantity': totalQty, 'Cost Price': cost, 'Total Cost': r2_(qty * cost), 'Date & Time': nowStr_(),
    'Batch No': batchNo, 'Expiry': expiry, 'Batch ID': batchId, 'Status': 'Active', 'Created By': s.u, 'Invoice No': invoiceNo, 'MRP': num_(req.mrp) || '' })]);
  appendRows_('Batches', [newBatchRow_({ batchId: batchId, medicineId: med.id, batchNo: batchNo, expiry: expiry, qty: totalQty, cost: effCost, mrp: num_(req.mrp) || '', supplier: supplier, purchaseId: id })]);
  var batches = loadBatches_();
  syncMedicineStock_(meds, batches, [med.id]);
  setCells_('Medicines', med.row, { 'Cost Price': cost });
  appendRows_('StockMovements', [movementRow_(med.id, med.name, batchId, totalQty, 'PURCHASE', id, s.u, (freeQty ? freeQty + ' free · ' : '') + (invoiceNo ? 'Invoice ' + invoiceNo : ''), meds.map[med.id].stock)]);
  audit_(s, 'addPurchase', id, med.name + ' × ' + totalQty + ' @ ₹' + cost + (batchNo ? ' · batch ' + batchNo : ''), 'OK');
  return ok_({ id: id, batchId: batchId });
}

function cancelPurchase_(req, s) {
  var id = str_(req.id, 60), reason = str_(req.reason, 300) || (req.action === 'deletePurchase' ? 'Removed from the app' : '');
  if (reason.length < 3) return fail_('VALIDATION', 'Please give a reason');
  var row = findRow_('Purchases', 'ID', id); if (row < 0) return fail_('VALIDATION', 'Purchase not found');
  var sheet = sh_('Purchases'), pr = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (String(cell_('Purchases', pr, 'Status')) === 'Cancelled') return ok_({ alreadyCancelled: true });
  var meds = loadMedicines_(), med = meds.map[String(pr[3])], batches = loadBatches_(), batchId = String(cell_('Purchases', pr, 'Batch ID') || '');
  var qty = num_(pr[5]), batch = batches.filter(function (b) { return b.batchId === batchId; })[0], mv = [];
  if (batch) {
    if (batch.avail < qty) return fail_('VALIDATION', (qty - batch.avail) + ' units from this purchase were already sold. Use a stock adjustment / purchase return instead.');
    batch.avail = 0; batch.status = 'Cancelled'; batch.dirty = true;
    saveBatches_(batches);
    if (med) { syncMedicineStock_(meds, batches, [med.id]); mv.push(movementRow_(med.id, med.name, batchId, -qty, 'PURCHASE_CANCEL', id, s.u, reason, meds.map[med.id].stock)); }
  } else if (med) {   // purchase made before v3 (no batch): remove from the medicine's batches FEFO
    var al = allocateFefo_(batches, med.id, qty, '0000-00-00');
    if (al.short > 0) return fail_('VALIDATION', 'Not enough stock left to cancel this purchase (' + al.short + ' short). Use a stock adjustment.');
    saveBatches_(batches); syncMedicineStock_(meds, batches, [med.id]);
    al.allocs.forEach(function (a) { mv.push(movementRow_(med.id, med.name, a.b, -a.q, 'PURCHASE_CANCEL', id, s.u, reason, meds.map[med.id].stock)); });
  }
  setCells_('Purchases', row, { 'Status': 'Cancelled', 'Cancelled At': nowStr_(), 'Cancelled By': s.u, 'Cancel Reason': reason });
  appendRows_('StockMovements', mv);
  audit_(s, 'cancelPurchase', id, reason, 'OK');
  return ok_();
}

var ADJ_TYPES = { ADJUSTMENT: 1, EXPIRED: -1, DAMAGED: -1, OPENING: 1, CUSTOMER_RETURN: 1, PURCHASE_RETURN: -1 };
function adjustStock_(req, s) {
  var type = String(req.type || 'ADJUSTMENT').toUpperCase(); if (!ADJ_TYPES[type]) return fail_('VALIDATION', 'Unknown adjustment type');
  var reason = str_(req.reason, 300); if (reason.length < 3) return fail_('VALIDATION', 'A reason is required for every stock change');
  var qty = Number(req.qty); if (!isFinite(qty) || qty === 0 || Math.floor(qty) !== qty) return fail_('VALIDATION', 'Quantity must be a whole number (not 0)');
  if (ADJ_TYPES[type] === -1 && qty > 0) qty = -qty;
  if (type !== 'ADJUSTMENT' && ADJ_TYPES[type] === 1 && qty < 0) return fail_('VALIDATION', 'Quantity must be positive for ' + type);
  var meds = loadMedicines_(), med = meds.map[str_(req.medicineId, 60)]; if (!med) return fail_('VALIDATION', 'Medicine not found');
  var batches = loadBatches_(), batchId = str_(req.batchId, 40), mv = [], ref = uid_('ADJ-');
  if (qty > 0) {
    var target = batchId ? batches.filter(function (b) { return b.batchId === batchId && b.medicineId === med.id; })[0] : null;
    if (batchId && !target) return fail_('VALIDATION', 'Batch not found');
    if (target) { target.avail = r2_(target.avail + qty); target.status = 'Active'; target.dirty = true; saveBatches_(batches); }
    else {
      target = { batchId: uid_('B-') };
      appendRows_('Batches', [newBatchRow_({ batchId: target.batchId, medicineId: med.id, batchNo: str_(req.batchNo, 40) || type, expiry: formatDate(req.expiry) || med.expiry, qty: qty, cost: med.costPrice })]);
      batches = loadBatches_();
    }
    syncMedicineStock_(meds, batches, [med.id]);
    mv.push(movementRow_(med.id, med.name, target.batchId, qty, type, ref, s.u, reason, meds.map[med.id].stock));
  } else {
    var need = -qty, sources;
    if (batchId) {
      var b = batches.filter(function (x) { return x.batchId === batchId && x.medicineId === med.id; })[0];
      if (!b) return fail_('VALIDATION', 'Batch not found');
      if (b.avail < need) return fail_('VALIDATION', 'Batch has only ' + b.avail + ' units');
      b.avail = r2_(b.avail - need); b.dirty = true; sources = [{ b: b.batchId, q: need }];
    } else {
      var al = allocateFefo_(batches, med.id, need, type === 'EXPIRED' ? '0000-00-00' : todayStr_());
      if (al.short > 0) return fail_('VALIDATION', 'Only ' + (need - al.short) + ' units available');
      sources = al.allocs;
    }
    saveBatches_(batches); syncMedicineStock_(meds, batches, [med.id]);
    sources.forEach(function (a) { mv.push(movementRow_(med.id, med.name, a.b, -a.q, type, ref, s.u, reason, meds.map[med.id].stock)); });
  }
  appendRows_('StockMovements', mv);
  audit_(s, 'adjustStock', med.id, type + ' ' + qty + ' · ' + reason, 'OK');
  return ok_({ stock: meds.map[med.id].stock });
}

function getStockMovements_(req) {
  var mid = str_(req.medicineId, 60), limit = Math.min(parseInt(req.limit, 10) || 200, 2000), data = values_('StockMovements'), out = [];
  for (var i = data.length - 1; i >= 1 && out.length < limit; i--) {
    var r = data[i]; if (mid && String(r[2]) !== mid) continue;
    out.push({ id: r[0], at: String(r[1] instanceof Date ? Utilities.formatDate(r[1], tz_(), 'yyyy-MM-dd HH:mm:ss') : r[1]), medicineId: String(r[2]), medicineName: String(r[3]),
      batchId: String(r[4]), qty: num_(r[5]), type: String(r[6]), ref: String(r[7]), user: String(r[8]), reason: String(r[9]), stockAfter: num_(r[10]) });
  }
  return ok_({ movements: out });
}

// ════════════════════════════════════════════════════════════════════════════
// CLINIC RECORDS (soft delete everywhere)
// ════════════════════════════════════════════════════════════════════════════
function seedReceiptSeq_(year) {
  return function () {
    var data = values_('TreatmentReceipts'), max = 0, re = new RegExp('^' + year + '-(\\d+)$');
    for (var i = 1; i < data.length; i++) { var m = String(data[i][0]).match(re); if (m) max = Math.max(max, parseInt(m[1], 10)); }
    return max;
  };
}
function reserveReceiptNo_(req, s) {
  var year = todayStr_().slice(0, 4), n = nextSeq_('SEQ_RCPT_' + year, seedReceiptSeq_(year));
  return ok_({ receiptNo: year + '-' + ('0000' + n).slice(-4) });
}

function saveTreatmentReceipt_(req, s) {
  getOrCreateSheet('TreatmentReceipts'); ensureCols_('TreatmentReceipts', EXTRA_COLS.TreatmentReceipts);
  var recordId = str_(req.recordId, 60);
  if (recordId && findRow_('TreatmentReceipts', 'Record ID', recordId) > 0) return ok_({ duplicate: true });
  var amount = num_(req.amount); if (amount < 0) return fail_('VALIDATION', 'Invalid amount');
  if (!str_(req.patient)) return fail_('VALIDATION', 'Patient name is required');
  appendRows_('TreatmentReceipts', [rowFrom_('TreatmentReceipts', { 'Receipt No': str_(req.receiptNo, 30), 'Date': formatDate(req.date) || todayStr_(),
    'Patient': str_(req.patient, 120), 'Doctor': str_(req.doctor, 80), 'Amount': r2_(amount), 'Amount in Words': str_(req.amountWords, 300),
    'Treatments': str_(req.treatments, 1000), 'Saved At': nowStr_(), 'Payment Mode': str_(req.paymentMode, 20), 'Record ID': recordId, 'Created By': s.u, 'Status': 'Active' })]);
  audit_(s, 'saveTreatmentReceipt', str_(req.receiptNo) || recordId, str_(req.patient, 60) + ' · ₹' + r2_(amount), 'OK');
  return ok_();
}
function softDeleteBy_(sheetName, s, action, keyCol, keyVal, label) {
  if (!keyVal) return fail_('VALIDATION', 'This older record has no ID — remove it directly in Google Sheets if needed.');
  var data = values_(sheetName), c = colOf_(sheetName, keyCol), rows = [];
  for (var i = 1; i < data.length; i++) if (c && String(data[i][c - 1]) === String(keyVal) && String(cell_(sheetName, data[i], 'Status')) !== 'Deleted') rows.push(i + 1);
  if (!rows.length) return ok_({ notFound: true });
  if (rows.length > 1) return fail_('VALIDATION', 'More than one record matches ' + keyVal + ' — not removed. Edit in Google Sheets.');
  setCells_(sheetName, rows[0], { 'Status': 'Deleted' });
  audit_(s, action, String(keyVal), label || '', 'OK');
  return ok_();
}
function deleteTreatmentReceipt_(req, s) {
  return req.recordId ? softDeleteBy_('TreatmentReceipts', s, 'deleteTreatmentReceipt', 'Record ID', str_(req.recordId), '')
                      : softDeleteBy_('TreatmentReceipts', s, 'deleteTreatmentReceipt', 'Receipt No', str_(req.no), '');
}

function savePrescription_(req, s) {
  getOrCreateSheet('Prescriptions'); ensureCols_('Prescriptions', EXTRA_COLS.Prescriptions);
  var recordId = str_(req.recordId, 60);
  if (recordId && findRow_('Prescriptions', 'Record ID', recordId) > 0) return ok_({ duplicate: true });
  appendRows_('Prescriptions', [rowFrom_('Prescriptions', { 'Date': str_(req.date, 20), 'Patient Name': str_(req.patientName, 120), 'Age': str_(req.age, 10),
    'Sex': str_(req.sex, 10), 'Prescription': str_(req.prescription || req.rxText, 5000), 'Saved At': nowStr_(), 'Record ID': recordId, 'Created By': s.u, 'Status': 'Active' })]);
  audit_(s, 'savePrescription', recordId, str_(req.patientName, 60), 'OK');
  return ok_();
}
function deletePrescription_(req, s) { return softDeleteBy_('Prescriptions', s, 'deletePrescription', 'Record ID', str_(req.recordId), str_(req.patientName, 60)); }

function saveExamForm_(req, s) {
  getOrCreateSheet('ExamForms'); ensureCols_('ExamForms', EXTRA_COLS.ExamForms);
  var recordId = str_(req.recordId, 60);
  if (recordId && findRow_('ExamForms', 'Record ID', recordId) > 0) return ok_({ duplicate: true });
  var f = function (k) { return str_(req[k], 2000); };
  appendRows_('ExamForms', [rowFrom_('ExamForms', { 'Date': f('date'), 'Patient': f('patient'), 'Age': f('age'), 'Sex': f('sex'), 'Doctor': f('doctor'), 'Phone': f('phone'),
    'Swelling': f('swelling'), 'TMJ': f('tmj'), 'Lymph Nodes': f('lymph'), 'Oral Hygiene': f('oral_hygiene'), 'Gingiva': f('gingiva'), 'Dental Caries': f('caries'),
    'Missing Teeth': f('missing_teeth'), 'Stains': f('stains'), 'Calculus': f('calculus'), 'Provisional Diagnosis': f('prov_diag'), 'Final Diagnosis': f('final_diag'),
    'Treatment Plan': f('treatments'), 'Treatment Notes': f('tp_notes'), 'Upper Arch': f('upper_teeth'), 'Lower Arch': f('lower_teeth'), 'Saved At': nowStr_(),
    'Record ID': recordId, 'Created By': s.u, 'Status': 'Active' })]);
  audit_(s, 'saveExamForm', recordId, f('patient').slice(0, 60), 'OK');
  return ok_();
}
function deleteExamForm_(req, s) { return softDeleteBy_('ExamForms', s, 'deleteExamForm', 'Record ID', str_(req.recordId), str_(req.patientName, 60)); }

function savePatient_(req, s) {
  var id = str_(req.id, 60); if (!id) return fail_('VALIDATION', 'Patient ID required');
  var name = str_(req.name, 120); if (!name) return fail_('VALIDATION', 'Patient name is required');
  var rowIdx = findRow_('Patients', 'ID', id), existing = null;
  if (rowIdx > 0) existing = sh_('Patients').getRange(rowIdx, 1, 1, 12).getValues()[0];
  var status = str_(req.status, 20) || 'Active'; if (status === 'Deleted') status = 'Active';
  var obj = { 'ID': id, 'Name': name, 'Phone': str_(req.phone, 20), 'Age': str_(req.age, 10), 'Sex': str_(req.sex, 10), 'Doctor': str_(req.doctor, 80),
    'Treatment': str_(req.treatment, 300), 'Balance': r2_(req.balance), 'Medical Alerts': str_(req.alerts, 500), 'Status': status,
    'Last Visit': str_(req.lastVisit, 20), 'Added On': str_(req.addedOn, 20) || (existing ? existing[11] : todayStr_()), 'Updated At': nowStr_() };
  if (rowIdx > 0) setCells_('Patients', rowIdx, obj);
  else { obj['Created By'] = s.u; appendRows_('Patients', [rowFrom_('Patients', obj)]); }
  audit_(s, 'savePatient', id, rowIdx > 0 ? 'Updated' : 'Created', 'OK');
  return ok_();
}
function deletePatient_(req, s) {
  var rowIdx = findRow_('Patients', 'ID', req.id); if (rowIdx < 0) return ok_();
  setCells_('Patients', rowIdx, { 'Status': 'Deleted', 'Updated At': nowStr_() });
  audit_(s, 'deletePatient', str_(req.id), 'Marked deleted', 'OK');
  return ok_();
}

function saveAppointment_(req, s) {
  var id = str_(req.id, 60); if (!id) return fail_('VALIDATION', 'Appointment ID required');
  var date = formatDate(req.date), time = str_(req.time, 20), doctor = str_(req.doctor, 80), status = str_(req.status, 20) || 'Confirmed';
  if (!str_(req.patient) || !date || !time) return fail_('VALIDATION', 'Patient, date and time are required');
  if (status !== 'Cancelled' && String(req.allowDoubleBooking) !== 'true') {   // same doctor + same slot?
    var data = values_('Appointments');
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (String(r[0]) === id || ['Cancelled', 'Deleted'].indexOf(String(r[7])) !== -1) continue;
      if (formatDate(r[3]) === date && formatTime(r[4]) === formatTime(time) && String(r[6] || '') === doctor)
        return fail_('DUPLICATE', 'This doctor already has an appointment at ' + time + ' on ' + date);
    }
  }
  var obj = { 'ID': id, 'Patient': str_(req.patient, 120), 'Phone': str_(req.phone, 20), 'Date': date, 'Time': time, 'Reason': str_(req.reason, 300),
    'Doctor': doctor, 'Status': status, 'Booked At': str_(req.bookedAt, 40) || nowStr_(), 'Updated At': nowStr_() };
  var rowIdx = findRow_('Appointments', 'ID', id);
  if (rowIdx > 0) setCells_('Appointments', rowIdx, obj);
  else { obj['Created By'] = s.u; appendRows_('Appointments', [rowFrom_('Appointments', obj)]); rowIdx = sh_('Appointments').getLastRow(); }
  sh_('Appointments').getRange(rowIdx, 5, 1, 1).setNumberFormat('@STRING@');
  audit_(s, 'saveAppointment', id, date + ' ' + time, 'OK');
  return ok_();
}
function updateAppointmentStatus_(req, s) {
  var rowIdx = findRow_('Appointments', 'ID', req.id); if (rowIdx < 0) return fail_('VALIDATION', 'Appointment not found');
  var st = str_(req.status, 20); if (['Confirmed', 'Cancelled', 'Completed', 'No-show', 'Rescheduled'].indexOf(st) === -1) return fail_('VALIDATION', 'Invalid status');
  setCells_('Appointments', rowIdx, { 'Status': st, 'Updated At': nowStr_() });
  audit_(s, 'updateAppointmentStatus', str_(req.id), st, 'OK');
  return ok_();
}
function deleteAppointment_(req, s) {
  var rowIdx = findRow_('Appointments', 'ID', req.id); if (rowIdx < 0) return ok_();
  setCells_('Appointments', rowIdx, { 'Status': 'Deleted', 'Updated At': nowStr_() });
  audit_(s, 'deleteAppointment', str_(req.id), '', 'OK');
  return ok_();
}

function saveExpense_(req, s) {
  var id = str_(req.id, 60); if (!id) return fail_('VALIDATION', 'Expense ID required');
  var amount = num_(req.amount); if (amount <= 0) return fail_('VALIDATION', 'Amount must be more than 0');
  var obj = { 'ID': id, 'Date': formatDate(req.date) || todayStr_(), 'Category': str_(req.category, 60), 'Amount': r2_(amount), 'Vendor': str_(req.vendor, 120),
    'Notes': str_(req.notes, 500), 'Payment Mode': str_(req.mode, 20) || 'Cash', 'Added At': nowStr_(), 'Status': 'Active' };
  var rowIdx = findRow_('Expenses', 'ID', id);
  if (rowIdx > 0) setCells_('Expenses', rowIdx, obj);
  else { obj['Created By'] = s.u; appendRows_('Expenses', [rowFrom_('Expenses', obj)]); }
  audit_(s, 'saveExpense', id, obj.Category + ' · ₹' + obj.Amount, 'OK');
  return ok_();
}
function deleteExpense_(req, s) {
  var rowIdx = findRow_('Expenses', 'ID', req.id); if (rowIdx < 0) return ok_();
  setCells_('Expenses', rowIdx, { 'Status': 'Deleted' });
  audit_(s, 'deleteExpense', str_(req.id), '', 'OK');
  return ok_();
}

function saveSettings_(req, s) {
  var sheet = getOrCreateSheet('Settings', BASE_HEADERS.Settings);
  var key = str_(req.settingKey, 60), value = String(req.settingValue === undefined ? '' : req.settingValue).slice(0, 45000);
  if (!key) return fail_('VALIDATION', 'No key');
  if (key === 'staff_max_discount_pct') { var v = parseFloat(value); if (!isFinite(v) || v < 0 || v > 100) return fail_('VALIDATION', 'Enter 0–100'); }
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === key) { sheet.getRange(i + 1, 2, 1, 2).setValues([[value, nowStr_()]]); audit_(s, 'saveSettings', key, '', 'OK'); return ok_(); }
  }
  sheet.appendRow([key, value, nowStr_()]);
  audit_(s, 'saveSettings', key, '', 'OK');
  return ok_();
}
function getSettings_(req, s) {
  var key = str_(req.settingKey, 60), data = values_('Settings');
  for (var i = 1; i < data.length; i++) if (String(data[i][0]) === key) return ok_({ value: String(data[i][1] || '') });
  return ok_({ value: null });
}

// ════════════════════════════════════════════════════════════════════════════
// BACKUPS
// ════════════════════════════════════════════════════════════════════════════
var BACKUP_FOLDER = 'SSDC Backups';
var KEEP = { daily: 14, weekly: 8, monthly: 12, manual: 30, 'pre-migration': 10 };

function backupFolder_() {
  var it = DriveApp.getFoldersByName(BACKUP_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER);
}
// Copy the spreadsheet, then verify the copy has the same tabs and row counts.
function backupNow_(kind) {
  kind = kind || 'manual';
  var src = ss_(), stamp = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HHmm');
  var name = 'SSDC Backup ' + kind + ' ' + stamp;
  var file = DriveApp.getFileById(ssId_()).makeCopy(name, backupFolder_());
  var copy = SpreadsheetApp.openById(file.getId()), problems = [], counts = {};
  src.getSheets().forEach(function (sh) {
    var c = copy.getSheetByName(sh.getName());
    counts[sh.getName()] = sh.getLastRow();
    if (!c) problems.push('missing tab ' + sh.getName());
    else if (c.getLastRow() !== sh.getLastRow()) problems.push(sh.getName() + ' rows ' + c.getLastRow() + ' ≠ ' + sh.getLastRow());
  });
  var result = { name: name, fileId: file.getId(), url: file.getUrl(), verified: problems.length === 0, problems: problems, rows: counts, at: nowStr_() };
  props_().setProperty('LAST_BACKUP', JSON.stringify(result));
  if (problems.length) throw new Error('Backup verification failed: ' + problems.join('; '));
  return result;
}
function pruneBackups_() {
  var groups = {}, files = backupFolder_().getFiles();
  while (files.hasNext()) {
    var f = files.next(), m = f.getName().match(/^SSDC Backup (\S+) /);
    if (m) (groups[m[1]] = groups[m[1]] || []).push(f);
  }
  Object.keys(groups).forEach(function (k) {
    var keep = KEEP[k] || 30;
    groups[k].sort(function (a, b) { return b.getName() < a.getName() ? -1 : 1; })
      .slice(keep).forEach(function (f) { f.setTrashed(true); });   // goes to Drive trash (recoverable 30 days)
  });
}
// Time trigger (installTriggers): daily; Sundays also weekly; 1st of month also monthly.
function scheduledBackup() {
  var d = new Date(), kinds = ['daily'];
  if (d.getDay() === 0) kinds.push('weekly');
  if (d.getDate() === 1) kinds.push('monthly');
  try {
    kinds.forEach(function (k) { backupNow_(k); });
    pruneBackups_();
    audit_({ u: 'system', r: 'SYSTEM' }, 'scheduledBackup', kinds.join('+'), '', 'OK');
  } catch (err) {
    audit_({ u: 'system', r: 'SYSTEM' }, 'scheduledBackup', kinds.join('+'), String(err), 'ERROR');
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '⚠️ SSDC billing backup FAILED',
      'The automatic backup failed at ' + nowStr_() + ':\n\n' + err + '\n\nOpen Apps Script → Executions to see details, or run backupNowFromEditor.');
  }
}
function backupNowFromEditor() { Logger.log(JSON.stringify(backupNow_('manual'), null, 2)); }
function backupNowApi_(req, s) {
  try { var r = backupNow_('manual'); audit_(s, 'backupNow', r.name, '', 'OK'); return ok_({ backup: r }); }
  catch (err) { audit_(s, 'backupNow', '', String(err), 'ERROR'); return fail_('BACKUP_FAILED', String(err.message || err)); }
}
function listBackups_() {
  var out = [], files = backupFolder_().getFiles();
  while (files.hasNext()) { var f = files.next(); out.push({ name: f.getName(), url: f.getUrl(), id: f.getId() }); }
  out.sort(function (a, b) { return a.name < b.name ? 1 : -1; });
  var last = null; try { last = JSON.parse(props_().getProperty('LAST_BACKUP') || 'null'); } catch (e) {}
  return ok_({ backups: out.slice(0, 60), last: last });
}
// RESTORE (owner, from editor): point the app at a verified backup copy.
// The current spreadsheet is backed up first and is NOT modified.
function restoreFromBackup(backupFileId) {
  if (!backupFileId) throw new Error('Pass the backup file ID, e.g. restoreFromBackup("1AbC...")');
  SpreadsheetApp.openById(backupFileId);          // must open
  backupNow_('pre-restore');
  var old = ssId_();
  props_().setProperty('SS_ID', backupFileId);
  props_().setProperty('PREVIOUS_SS_ID', old);
  bumpDataVersion_();
  Logger.log('App now uses ' + backupFileId + ' (previous: ' + old + '). To undo: restoreFromBackup("' + old + '")');
}

function installTriggers() {
  var have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (have.indexOf('scheduledBackup') === -1) ScriptApp.newTrigger('scheduledBackup').timeBased().everyDays(1).atHour(2).create();
  if (have.indexOf('sendDailyStockReport') === -1) ScriptApp.newTrigger('sendDailyStockReport').timeBased().everyDays(1).atHour(8).create();
  Logger.log('Triggers installed: daily backup ~2 AM, stock report ~8 AM');
}

// ════════════════════════════════════════════════════════════════════════════
// DATA VALIDATION (owner) — duplicates, broken links, stock mismatches
// ════════════════════════════════════════════════════════════════════════════
function validateData_() {
  var issues = [], meds = loadMedicines_(), batches = loadBatches_(), seen = {};
  values_('Bills').slice(1).forEach(function (r) { var id = String(r[0]); if (!id) return; if (seen[id]) issues.push('Duplicate bill ID ' + id); seen[id] = 1; });
  var names = {};
  meds.list.forEach(function (m) {
    if (m.status === 'Inactive') return;
    var k = m.name.trim().toLowerCase(); if (names[k]) issues.push('Duplicate medicine name: ' + m.name); names[k] = 1;
    var sum = 0; batches.forEach(function (b) { if (b.medicineId === m.id && b.status === 'Active') sum += b.avail; });
    if (Math.abs(sum - m.stock) > 0.001) issues.push('Stock mismatch ' + m.name + ': sheet ' + m.stock + ' vs batches ' + r2_(sum));
    if (m.price < m.costPrice) issues.push('Selling below cost: ' + m.name);
  });
  values_('BillItems').slice(1).forEach(function (r) { if (r[1] && !meds.map[String(r[1])]) issues.push('Bill ' + r[0] + ' references unknown medicine ID ' + r[1]); });
  batches.forEach(function (b) { if (!meds.map[b.medicineId]) issues.push('Batch ' + b.batchId + ' has unknown medicine'); if (b.avail < 0) issues.push('Negative stock in batch ' + b.batchId); });
  return ok_({ issues: issues.slice(0, 500), count: issues.length });
}

// ════════════════════════════════════════════════════════════════════════════
// MIGRATION v2 → v3 (run from the editor; safe to re-run)
// ════════════════════════════════════════════════════════════════════════════
function migrationPlan_() {
  var plan = [], meds = loadMedicines_();
  Object.keys(BASE_HEADERS).forEach(function (n) { if (!sh_(n)) plan.push('Create tab ' + n); });
  Object.keys(EXTRA_COLS).forEach(function (n) {
    if (!sh_(n)) return; var map = hdr_(n);
    var missing = EXTRA_COLS[n].filter(function (c) { return !map[c]; });
    if (missing.length) plan.push('Add columns to ' + n + ': ' + missing.join(', '));
  });
  var batches = sh_('Batches') ? loadBatches_() : [], withBatch = {};
  batches.forEach(function (b) { withBatch[b.medicineId] = 1; });
  var opening = meds.list.filter(function (m) { return !withBatch[m.id]; });
  if (opening.length) plan.push('Create OPENING batch for ' + opening.length + ' medicine(s) from current stock/expiry (total ' + opening.reduce(function (a, m) { return a + m.stock; }, 0) + ' units)');
  if (!sh_('Users') || sh_('Users').getLastRow() < 2) plan.push('Create users "owner" and "staff" with random temporary passwords (shown in this log + e-mailed to you); both must set a new password at first login');
  var bills = values_('Bills'); plan.push('Mark ' + Math.max(0, bills.length - 1) + ' existing bill(s) Status = Active (nothing else changes)');
  plan.push('Existing rows are never deleted or moved. A verified backup copy is made first.');
  return plan;
}
function migrateToV3DryRun() { Logger.log('MIGRATION PLAN (nothing changed):\n• ' + migrationPlan_().join('\n• ')); }

function migrateToV3() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var plan = migrationPlan_();
    Logger.log('Plan:\n• ' + plan.join('\n• '));
    var backup = backupNow_('pre-migration');      // throws (and stops) if the backup can't be verified
    Logger.log('Backup OK: ' + backup.url);

    Object.keys(BASE_HEADERS).forEach(function (n) { getOrCreateSheet(n, BASE_HEADERS[n]); });
    Object.keys(EXTRA_COLS).forEach(function (n) { ensureCols_(n, EXTRA_COLS[n]); });

    // Users: random temporary passwords (the old ones were public). Shown in the
    // log and e-mailed to the script owner; both must be changed at first login.
    if (sh_('Users').getLastRow() < 2) {
      var tOwner = 'Ssdc-' + Utilities.getUuid().slice(0, 4) + '-' + Utilities.getUuid().slice(0, 4);
      var tStaff = 'Ssdc-' + Utilities.getUuid().slice(0, 4) + '-' + Utilities.getUuid().slice(0, 4);
      createUserRow_('owner', OWNER, tOwner, true, 'Owner');
      createUserRow_('staff', STAFF, tStaff, true, 'Staff');
      var msg = 'Temporary passwords (change at first login):\n  owner : ' + tOwner + '\n  staff : ' + tStaff;
      Logger.log(msg);
      try { MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'SSDC billing — temporary passwords', msg); } catch (mailErr) {}
    }
    // Bills: Status = Active where empty
    var bs = sh_('Bills'), bStatus = colOf_('Bills', 'Status');
    if (bs.getLastRow() > 1) {
      var r = bs.getRange(2, bStatus, bs.getLastRow() - 1, 1), v = r.getValues(), ch = false;
      v.forEach(function (x) { if (!x[0]) { x[0] = 'Active'; ch = true; } });
      if (ch) r.setValues(v);
    }
    // Medicines: Status/Min Stock defaults + OPENING batches
    var meds = loadMedicines_(), batches = loadBatches_(), withBatch = {}, newBatches = [], mv = [];
    batches.forEach(function (b) { withBatch[b.medicineId] = 1; });
    meds.list.forEach(function (m) {
      var upd = {}; if (!cell_('Medicines', sh_('Medicines').getRange(m.row, 1, 1, sh_('Medicines').getLastColumn()).getValues()[0], 'Status')) upd['Status'] = 'Active';
      if (!m.minStock) upd['Min Stock'] = 10;
      if (Object.keys(upd).length) setCells_('Medicines', m.row, upd);
      if (!withBatch[m.id]) {
        var bid = uid_('B-');
        newBatches.push(newBatchRow_({ batchId: bid, medicineId: m.id, batchNo: 'OPENING', expiry: m.expiry, qty: Math.max(0, m.stock), cost: m.costPrice }));
        mv.push(movementRow_(m.id, m.name, bid, Math.max(0, m.stock), 'OPENING', 'MIGRATION-V3', 'system', 'Opening stock at upgrade', Math.max(0, m.stock)));
      }
    });
    appendRows_('Batches', newBatches);
    appendRows_('StockMovements', mv);
    props_().setProperty('SCHEMA_VERSION', String(SCHEMA_VERSION));
    bumpDataVersion_();
    audit_({ u: 'system', r: 'SYSTEM' }, 'migrateToV3', '', plan.join(' | ') + ' | backup ' + backup.fileId, 'OK');
    Logger.log('✅ Migration complete. Backup: ' + backup.url);
  } finally { lock.releaseLock(); }
}

// Fresh install (empty spreadsheet): creates every tab with headers.
function setupSheets() {
  Object.keys(BASE_HEADERS).forEach(function (n) { getOrCreateSheet(n, BASE_HEADERS[n]); });
  Object.keys(EXTRA_COLS).forEach(function (n) { ensureCols_(n, EXTRA_COLS[n]); });
  Logger.log('All sheets created/verified. Now run migrateToV3.');
}

// ════════════════════════════════════════════════════════════════════════════
// DAILY STOCK REPORT EMAIL (batch-aware)
// ════════════════════════════════════════════════════════════════════════════
function sendDailyStockReport() {
  var meds = loadMedicines_(), batches = loadBatches_(), today = todayStr_(), now = Utilities.formatDate(new Date(), tz_(), 'dd MMM yyyy, hh:mm a');
  var out = [], low = [], expSoon = [], expired = [], good = [];
  meds.list.forEach(function (m) {
    if (m.status === 'Inactive') return;
    var mine = batches.filter(function (b) { return b.medicineId === m.id && b.status === 'Active' && b.avail > 0; });
    var sellable = 0, expiredQty = 0;
    mine.forEach(function (b) {
      if (b.expiry && b.expiry < today) { expiredQty += b.avail; expired.push({ name: m.name, batch: b.batchNo, expiry: b.expiry, qty: b.avail }); }
      else {
        sellable += b.avail;
        if (b.expiry) { var days = Math.ceil((new Date(b.expiry) - new Date(today)) / 86400000); if (days <= 90) expSoon.push({ name: m.name, batch: b.batchNo, expiry: b.expiry, qty: b.avail, days: days }); }
      }
    });
    var row = { name: m.name, stock: sellable, min: m.minStock || 10, price: m.price };
    if (sellable <= 0) out.push(row); else if (sellable < row.min) low.push(row); else good.push(row);
  });
  expSoon.sort(function (a, b) { return a.days - b.days; });
  var hasIssues = out.length || low.length || expSoon.length || expired.length;
  var subject = (hasIssues ? '⚠️' : '✅') + ' Daily Stock Report — Sri Sai Speciality Dental Care (' + today + ')';
  var html = '<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">'
    + '<div style="background:#1e3f5a;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0;"><h2 style="margin:0;">🦷 Sri Sai Speciality Dental Care</h2><div style="font-size:13px;opacity:.85;">Daily stock report · ' + now + '</div></div>'
    + _statRow([['Out of stock', out.length, '#e74c3c'], ['Low stock', low.length, '#f39c12'], ['Expiring ≤90 days', expSoon.length, '#e67e22'], ['Expired (remove)', expired.length, '#8e44ad'], ['OK', good.length, '#27ae60']]);
  html += _tbl('🔴 Out of stock', ['Medicine', 'Price'], out.map(function (m) { return [m.name, '₹' + m.price]; }));
  html += _tbl('🟡 Low stock (below minimum)', ['Medicine', 'Stock', 'Minimum'], low.map(function (m) { return [m.name, m.stock, m.min]; }));
  html += _tbl('🟠 Expiring within 90 days (FEFO: sold first)', ['Medicine', 'Batch', 'Expiry', 'Days', 'Qty'], expSoon.map(function (b) { return [b.name, b.batch, b.expiry, b.days, b.qty]; }));
  html += _tbl('🟣 Expired — not sellable, remove from shelf', ['Medicine', 'Batch', 'Expiry', 'Qty'], expired.map(function (b) { return [b.name, b.batch, b.expiry, b.qty]; }));
  if (!hasIssues) html += '<p style="background:#eafaf1;padding:14px;border-radius:8px;color:#1e8449;font-weight:700;text-align:center;">✅ All medicines are well-stocked — no alerts today.</p>';
  html += '</div>';
  GmailApp.sendEmail(Session.getEffectiveUser().getEmail(), subject, 'Open in an HTML e-mail viewer.', { htmlBody: html, name: 'Sri Sai Dental — Stock Report' });
}
function _statRow(items) {
  return '<div style="display:flex;gap:8px;flex-wrap:wrap;padding:12px;background:#f5f7fa;">' + items.map(function (i) {
    return '<div style="flex:1;min-width:100px;background:#fff;border-top:3px solid ' + i[2] + ';border-radius:6px;padding:8px;text-align:center;"><div style="font-size:22px;font-weight:800;color:' + i[2] + ';">' + i[1] + '</div><div style="font-size:11px;color:#666;">' + i[0] + '</div></div>';
  }).join('') + '</div>';
}
function _tbl(title, heads, rows) {
  if (!rows.length) return '';
  return '<h3 style="margin:16px 0 6px;font-size:15px;">' + title + ' (' + rows.length + ')</h3><table style="width:100%;border-collapse:collapse;font-size:13px;">'
    + '<tr>' + heads.map(function (h) { return '<th style="text-align:left;background:#eef3fb;padding:6px 8px;">' + h + '</th>'; }).join('') + '</tr>'
    + rows.map(function (r, i) { return '<tr style="background:' + (i % 2 ? '#fafafa' : '#fff') + ';">' + r.map(function (c) { return '<td style="padding:6px 8px;border-bottom:1px solid #eee;">' + String(c).replace(/</g, '&lt;') + '</td>'; }).join('') + '</tr>'; }).join('')
    + '</table>';
}

// ════════════════════════════════════════════════════════════════════════════
// ACTION TABLE
// ════════════════════════════════════════════════════════════════════════════
ACTIONS = {
  whoami: whoami_, logout: logout_, changePassword: changePassword_,
  getAllData: getAllData_, getSettings: getSettings_, getExpenses: getExpenses_,
  reserveReceiptNo: reserveReceiptNo_,
  saveBill: saveBill_, cancelBill: cancelBill_, deleteBill: cancelBill_,
  addMedicine: addMedicine_, updateMedicine: updateMedicine_, deleteMedicine: deleteMedicine_,
  adjustStock: adjustStock_, getStockMovements: getStockMovements_,
  addPurchase: addPurchase_, cancelPurchase: cancelPurchase_, deletePurchase: cancelPurchase_,
  saveTreatmentReceipt: saveTreatmentReceipt_, deleteTreatmentReceipt: deleteTreatmentReceipt_,
  savePrescription: savePrescription_, deletePrescription: deletePrescription_,
  savePatient: savePatient_, deletePatient: deletePatient_,
  saveAppointment: saveAppointment_, updateAppointmentStatus: updateAppointmentStatus_, deleteAppointment: deleteAppointment_,
  saveExamForm: saveExamForm_, deleteExamForm: deleteExamForm_,
  saveSettings: saveSettings_, saveExpense: saveExpense_, deleteExpense: deleteExpense_,
  listUsers: listUsers_, createUser: createUser_, resetUserPassword: resetUserPassword_, setUserActive: setUserActive_,
  getAuditLog: getAuditLog_, backupNow: backupNowApi_, listBackups: listBackups_, validateData: validateData_
};
