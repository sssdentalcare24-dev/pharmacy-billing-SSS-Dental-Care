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
// New in v3.1 (see docs/PROGRESS.md):
//  • Money: part payments / pay later on bills and dental receipts, collecting
//    balances later, returns + refunds (stock back to its batch), payment
//    history, patient outstanding, daily cash closing + UPI/card reconciliation.
//  • Suppliers: master, multi-line purchase invoices (paid / credit), supplier
//    payments, ledger + outstanding, purchase returns, invoice attachments.
//  • Clinic: medical/dental history + allergies, treatment price list, patient
//    treatment records, follow-ups, prescription/exam history from the server.
//  • Reports: inventory valuation, expiry loss, dead/slow stock, batch history,
//    report data for any period (older data is loaded on demand).
//  • Device data key (patient data cached on phones is encrypted), health
//    check, restore drill, faster refresh (unchanged data is not re-sent).
//
// UPDATE FROM v3.0 (owner, from the Apps Script editor):
//   1. Paste this file, Save.
//   2. Select function  migrateToV31DryRun → Run → read the log (changes nothing).
//   3. Select function  migrateToV31       → Run (verified backup first; only ADDS tabs/columns).
//   4. Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy.
//
// FIRST-TIME SETUP on an empty / v2 spreadsheet:
//   migrateToV3DryRun → migrateToV3 → migrateToV31 → installTriggers → Deploy.
// ════════════════════════════════════════════════════════════════════════════

var VERSION = '3.1.0';
var SCHEMA_VERSION = 4;          // 3 = v3.0 tables, 4 = v3.1 tables (migrateToV31)
var MIN_SCHEMA = 3;              // the app works (without v3.1 features) from schema 3
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
var DEFAULT_WINDOW_DAYS = 365; // owner: bills/receipts/payments older than this load on demand (Settings: load_window_days)

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
  Batches:           ['Batch ID','Medicine ID','Batch No','Expiry','Qty Received','Qty Available','Cost Price','MRP','Supplier','Purchase ID','Received At','Status'],
  // new in v3.1
  Payments:          ['Payment ID','Payment No','Date','Type','Against Type','Against ID','Against No','Patient ID','Patient Name','Phone','Amount','Mode','Cash Amount','UPI Amount','Card Amount','Reference','Notes','Credit Value','Items','Cost Reversed','Created By','Created At','Status','Cancelled At','Cancelled By','Cancel Reason'],
  CashClosings:      ['Closing ID','Date','Opening Cash','Cash In','Cash Out','Expected Cash','Counted Cash','Difference','Deposited','UPI Total','Card Total','UPI Verified','Card Verified','Notes','Closed By','Closed At','Status','Details'],
  Suppliers:         ['Supplier ID','Name','Phone','Contact Person','Address','Notes','Opening Balance','Status','Created At','Created By','Updated At'],
  SupplierLedger:    ['Entry ID','Date','Supplier ID','Supplier Name','Type','Reference','Debit','Credit','Mode','Notes','Created By','Created At','Status','Cancelled At','Cancelled By','Cancel Reason'],
  PurchaseInvoices:  ['Invoice ID','Date','Supplier ID','Supplier Name','Invoice No','Lines','Items Total','Adjustment','Total','Paid Amount','Payment Mode','Payment Ref','Notes','Attachment URL','Attachment ID','Status','Created By','Created At','Cancelled At','Cancelled By','Cancel Reason'],
  PurchaseReturns:   ['Return ID','Date','Supplier ID','Supplier Name','Medicine ID','Medicine Name','Batch ID','Batch No','Qty','Rate','Amount','Reason','Created By','Created At','Status'],
  TreatmentMaster:   ['Treatment ID','Name','Category','Price','Duration (min)','Notes','Status','Updated At','Updated By'],
  PatientTreatments: ['Record ID','Date','Patient ID','Patient Name','Phone','Doctor','Treatment ID','Treatment','Tooth','Price','Status','Notes','Receipt No','Created By','Created At','Updated At','Completed On'],
  FollowUps:         ['Follow-up ID','Patient ID','Patient Name','Phone','Due Date','Reason','Doctor','Source','Status','Notes','Created By','Created At','Done At','Done By']
};
var V31_SHEETS = ['Payments','CashClosings','Suppliers','SupplierLedger','PurchaseInvoices','PurchaseReturns','TreatmentMaster','PatientTreatments','FollowUps'];
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
// Columns added by v3.1 (also appended to the right; nothing moves)
var EXTRA_COLS_V31 = {
  Medicines:         ['Barcode','Generic Name','Category','Manufacturer'],
  Bills:             ['Paid Amount','Balance Due','Payment Status','Patient ID','Returned Value','Refunded Amount'],
  TreatmentReceipts: ['Paid Amount','Balance Due','Payment Status','Patient ID','Returned Value','Refunded Amount','Cash Amount','UPI Amount','Card Amount','Discount','Payment Ref','Items'],
  Purchases:         ['Supplier ID','Invoice ID','Free Qty'],
  Prescriptions:     ['Patient ID','Doctor','Follow-up Date'],
  Patients:          ['Medical History','Dental History','Allergies','Medications','Blood Group','Address','Emergency Contact','Date of Birth'],
  Appointments:      ['Patient ID'],
  ExamForms:         ['Patient ID']
};
(function () {   // colOf_() finds v3.1 columns by their heading, like the v3.0 ones
  Object.keys(EXTRA_COLS_V31).forEach(function (n) { EXTRA_COLS[n] = (EXTRA_COLS[n] || []).concat(EXTRA_COLS_V31[n]); });
})();

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
  getAuditLog: OWNER, backupNow: OWNER, listBackups: OWNER, validateData: OWNER,
  // v3.1
  recordPayment: ANY, cancelPayment: OWNER, returnRefund: OWNER, getPayments: ANY,
  getCashSummary: ANY, saveCashClosing: ANY, getCashClosings: OWNER,
  saveSupplier: OWNER, deleteSupplier: OWNER, recordSupplierPayment: OWNER, cancelSupplierEntry: OWNER, getSupplierLedger: OWNER,
  addPurchaseInvoice: OWNER, cancelPurchaseInvoice: OWNER, uploadInvoiceAttachment: OWNER, purchaseReturn: OWNER,
  saveTreatment: OWNER, savePatientTreatment: ANY, setPatientTreatmentStatus: ANY, deletePatientTreatment: OWNER,
  saveFollowUp: ANY, setFollowUpStatus: ANY, deleteFollowUp: OWNER,
  getPatientHistory: ANY, getRecentRecords: ANY, getBills: ANY,
  getBatchHistory: OWNER, getInventoryReport: OWNER, getReportData: OWNER,
  healthCheck: OWNER, restoreDrill: OWNER
};
var READ_ONLY = { whoami: 1, getAllData: 1, getSettings: 1, getExpenses: 1, getStockMovements: 1,
  listUsers: 1, getAuditLog: 1, listBackups: 1, validateData: 1, logout: 1,
  getPayments: 1, getCashSummary: 1, getCashClosings: 1, getSupplierLedger: 1, getPatientHistory: 1, getRecentRecords: 1, getBills: 1,
  getBatchHistory: 1, getInventoryReport: 1, getReportData: 1, healthCheck: 1 };
// Actions that need the v3.1 tables (migrateToV31)
var V31_ACTIONS = { recordPayment: 1, cancelPayment: 1, returnRefund: 1, getPayments: 1, getCashSummary: 1, saveCashClosing: 1, getCashClosings: 1,
  saveSupplier: 1, deleteSupplier: 1, recordSupplierPayment: 1, cancelSupplierEntry: 1, getSupplierLedger: 1,
  addPurchaseInvoice: 1, cancelPurchaseInvoice: 1, uploadInvoiceAttachment: 1, purchaseReturn: 1,
  saveTreatment: 1, savePatientTreatment: 1, setPatientTreatmentStatus: 1, deletePatientTreatment: 1,
  saveFollowUp: 1, setFollowUpStatus: 1, deleteFollowUp: 1, getPatientHistory: 1, getRecentRecords: 1, getBills: 1,
  getBatchHistory: 1, getInventoryReport: 1, getReportData: 1, restoreDrill: 1 };
function v31_() { return schemaVersion_() >= 4; }

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
      idleMinutes: IDLE_MINUTES, version: VERSION, features: features_(), dataKey: v31_() ? dataKeyFor_(u.username) : '' });
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
function whoami_(req, s) { return ok_({ user: { username: s.u, role: s.r, displayName: s.n, mustChangePassword: !!s.mc }, version: VERSION,
  features: features_(), dataKey: v31_() ? dataKeyFor_(s.u) : '' }); }
function features_() { return { v31: v31_(), schema: schemaVersion_(), windowDays: windowDays_() }; }
function windowDays_() { var v = parseInt(getSetting_('load_window_days', ''), 10); return isFinite(v) && v >= 30 ? Math.min(v, 3650) : DEFAULT_WINDOW_DAYS; }
// Key for encrypting patient data cached on a device. Derived per user from a
// secret that never leaves the server; the app keeps it only for the session.
function localKeySecret_() {
  var p = props_(), k = p.getProperty('LOCAL_KEY_SECRET');
  if (!k) { k = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('LOCAL_KEY_SECRET', k); }
  return k;
}
function dataKeyFor_(username) {
  return Utilities.base64Encode(Utilities.computeHmacSha256Signature('ssdc-local-v1|' + String(username).toLowerCase(), localKeySecret_()));
}

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
  if (schemaVersion_() < MIN_SCHEMA) return fail_('MIGRATION_REQUIRED', 'Server update not finished: the owner must run migrateToV3 in Apps Script.');
  if (action === 'login') return login_(req);

  var s = getSession_(req.token);
  if (!s) return fail_('AUTH_REQUIRED', 'Your session has ended. Please log in again.');
  if (!rateLimit_('u_' + s.u.toLowerCase(), 300, 300)) return fail_('RATE_LIMIT', 'Too many requests — slow down for a minute.');
  if (s.mc && action !== 'changePassword' && action !== 'logout' && action !== 'whoami')
    return fail_('MUST_CHANGE_PASSWORD', 'Please set a new password first.');

  var rule = PERMS[action], fn = ACTIONS[action];
  if (!rule || !fn) return fail_('UNKNOWN_ACTION', 'Unknown action: ' + action);
  if (V31_ACTIONS[action] && !v31_()) return fail_('MIGRATION_REQUIRED', 'This needs the v3.1 server update: the owner must run migrateToV31 in Apps Script.');
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
      expiry: formatDate(r[5]), minStock: num_(cell_('Medicines', r, 'Min Stock')), status: String(cell_('Medicines', r, 'Status') || 'Active'),
      barcode: String(cell_('Medicines', r, 'Barcode') || ''), genericName: String(cell_('Medicines', r, 'Generic Name') || ''),
      category: String(cell_('Medicines', r, 'Category') || ''), manufacturer: String(cell_('Medicines', r, 'Manufacturer') || '') };
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
  // The app already has this exact data → tiny answer instead of everything again.
  if (req.ifVersion && String(req.ifVersion) === s.r.charAt(0) + ver) return ok_({ unchanged: true, dataVersion: s.r.charAt(0) + ver });
  try {
    var n = parseInt(c.get(prefix + 'n'), 10);
    if (n > 0) {
      var keys = []; for (var k = 0; k < n; k++) keys.push(prefix + k);
      var got = c.getAll(keys), parts = [];
      for (var k2 = 0; k2 < n; k2++) { if (got[keys[k2]] == null) { parts = null; break; } parts.push(got[keys[k2]]); }
      if (parts) return { __raw: parts.join('') };
    }
  } catch (e) {}
  var result = buildAllData_(s.r); result.dataVersion = s.r.charAt(0) + ver;
  var json = JSON.stringify(result);
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
  var v31 = v31_(), win = windowDays_(), ownerFrom = daysAgoStr_(win), from = isOwner ? ownerFrom : staffFrom;
  var receivables = [];
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
      price: m.price, expiry: nextExp || m.expiry, minStock: m.minStock,
      barcode: m.barcode, genericName: m.genericName, category: m.category, manufacturer: m.manufacturer,
      batchNos: mine.map(function (b) { return b.batchNo; }).filter(String).join(' ') };
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
  var validModes = { cash: 'Cash', upi: 'UPI', card: 'Card', split: 'Split', credit: 'Credit', cheque: 'Cheque', online: 'Online', neft: 'NEFT', rtgs: 'RTGS' };
  for (var i = 1; i < bData.length; i++) {
    var br = bData[i]; if (!br[0]) continue;
    var id = String(br[0]), date = formatDate(br[4]);
    var bStatus = String(cell_('Bills', br, 'Status') || 'Active');
    if (v31 && bStatus !== 'Cancelled') { var mo = invMoney_('BILL', br); if (mo.balance > 0.009) receivables.push(receivableOf_('BILL', br, mo)); }
    if (date < from) continue;
    var pm = validModes[String(br[9] || '').trim().toLowerCase()] || 'Cash';
    var b = { billId: id, billNo: String(cell_('Bills', br, 'Bill No') || ''), patientName: br[1], doctor: br[2], phone: String(br[3] || ''), date: date,
      subtotal: num_(br[5]), discount: num_(br[6]), total: num_(br[7]), paymentMode: pm,
      cashAmount: num_(cell_('Bills', br, 'Cash Amount')), upiAmount: num_(cell_('Bills', br, 'UPI Amount')), cardAmount: num_(cell_('Bills', br, 'Card Amount')),
      paymentRef: String(cell_('Bills', br, 'Payment Ref') || ''), createdBy: String(cell_('Bills', br, 'Created By') || ''),
      items: allItems[id] || [] };
    if (v31) { var bm = invMoney_('BILL', br); b.paidAmount = bm.paid; b.balanceDue = bm.balance; b.paymentStatus = bm.status;
      b.returnedValue = bm.returned; b.refundedAmount = bm.refunded; b.patientId = String(cell_('Bills', br, 'Patient ID') || ''); }
    if (isOwner) b.costTotal = num_(br[8]);
    var status = bStatus;
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
      if (formatDate(pr[1]) < ownerFrom) continue;
      purchases.push({ supplierId: String(cell_('Purchases', pr, 'Supplier ID') || ''), invoiceId: String(cell_('Purchases', pr, 'Invoice ID') || ''),
        freeQty: num_(cell_('Purchases', pr, 'Free Qty')), mrp: num_(cell_('Purchases', pr, 'MRP')),
        id: String(pr[0]), date: formatDate(pr[1]), supplier: pr[2], medicineId: pr[3], medicineName: pr[4],
        qty: num_(pr[5]), costPrice: num_(pr[6]), totalCost: num_(pr[7]),
        batchNo: String(cell_('Purchases', pr, 'Batch No') || ''), expiry: formatDate(cell_('Purchases', pr, 'Expiry')),
        invoiceNo: String(cell_('Purchases', pr, 'Invoice No') || ''), batchId: String(cell_('Purchases', pr, 'Batch ID') || '') });
    }
  }

  // ── patients ──
  var patients = [], ptData = values_('Patients');
  for (var q = 1; q < ptData.length; q++) {
    var p = ptData[q]; if (!p[0] || String(p[9]) === 'Deleted') continue;
    var po = { id: p[0], name: p[1], phone: String(p[2] || ''), age: p[3], sex: p[4], doctor: p[5], treatment: p[6],
      balance: num_(p[7]), alerts: p[8], status: p[9], lastVisit: formatDate(p[10]), addedOn: formatDate(p[11]) };
    if (v31) {
      PATIENT_FIELDS.forEach(function (f) { po[f[0]] = String(cell_('Patients', p, f[1]) || ''); });
      if (po.balance > 0.009) receivables.push({ type: 'OPENING', id: String(p[0]), no: 'Old balance', date: po.addedOn, patientId: String(p[0]),
        patientName: String(p[1] || ''), phone: po.phone, total: po.balance, paid: 0, returned: 0, refunded: 0, balance: r2_(po.balance) });
    }
    patients.push(po);
  }

  // ── appointments ──
  var appointments = [], aData = values_('Appointments');
  for (var a = 1; a < aData.length; a++) {
    var ar = aData[a]; if (!ar[0] || String(ar[7]) === 'Deleted') continue;
    appointments.push({ id: ar[0], patient: ar[1], phone: String(ar[2] || ''), date: formatDate(ar[3]), time: formatTime(ar[4]),
      reason: ar[5], doctor: ar[6], status: ar[7], bookedAt: String(ar[8] || ''), patientId: String(cell_('Appointments', ar, 'Patient ID') || '') });
  }

  // ── treatment receipts (dental revenue) ──
  var treatmentReceipts = [], tData = values_('TreatmentReceipts');
  for (var t = 1; t < tData.length; t++) {
    var tr = tData[t]; if (!tr[0] && !tr[2]) continue;
    if (String(cell_('TreatmentReceipts', tr, 'Status') || '') === 'Deleted') continue;
    var tDate = formatDate(tr[1]);
    if (v31) { var tmo = invMoney_('RECEIPT', tr); if (tmo.balance > 0.009) receivables.push(receivableOf_('RECEIPT', tr, tmo)); }
    if (tDate < from) continue;
    treatmentReceipts.push({ no: String(tr[0]), date: tDate, patient: String(tr[2] || ''), doctor: String(tr[3] || ''), amount: num_(tr[4]),
      amountWords: String(tr[5] || ''), treatments: String(tr[6] || ''), savedAt: String(tr[7] || ''),
      paymentMode: String(cell_('TreatmentReceipts', tr, 'Payment Mode') || ''), recordId: String(cell_('TreatmentReceipts', tr, 'Record ID') || '') });
    if (v31) { var rr = treatmentReceipts[treatmentReceipts.length - 1], rm = invMoney_('RECEIPT', tr);
      rr.paidAmount = rm.paid; rr.balanceDue = rm.balance; rr.paymentStatus = rm.status; rr.returnedValue = rm.returned; rr.refundedAmount = rm.refunded;
      rr.patientId = String(cell_('TreatmentReceipts', tr, 'Patient ID') || ''); rr.discount = num_(cell_('TreatmentReceipts', tr, 'Discount'));
      rr.cashAmount = num_(cell_('TreatmentReceipts', tr, 'Cash Amount')); rr.upiAmount = num_(cell_('TreatmentReceipts', tr, 'UPI Amount'));
      rr.cardAmount = num_(cell_('TreatmentReceipts', tr, 'Card Amount')); rr.paymentRef = String(cell_('TreatmentReceipts', tr, 'Payment Ref') || ''); }
  }

  // ── expenses (owner) ──
  var expenses = isOwner ? readExpenses_().filter(function (e) { return e.date >= ownerFrom; }) : [];

  var out = { success: true, version: VERSION, role: role, today: today, serverTime: nowStr_(),
    staffMaxDiscountPct: staffMaxDiscountPct_(), features: features_(), loadedFrom: from,
    medicines: medicines, bills: bills, cancelledBills: cancelledBills, purchases: purchases, patients: patients,
    appointments: appointments, treatmentReceipts: treatmentReceipts, expenses: expenses };
  if (v31) extendAllData_(out, role, from, receivables);
  return out;
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

  // ── payment (v3.1: the patient may pay part now, or later) ──
  var pay = paymentSplit_(req, total, s, warnings);
  if (pay.error) return fail_('VALIDATION', pay.error);
  var mode = pay.mode, cash = pay.cash, upi = pay.upi, card = pay.card;

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
    'Cash Amount': cash, 'UPI Amount': upi, 'Card Amount': card,
    'Paid Amount': pay.paid, 'Balance Due': r2_(total - pay.paid), 'Payment Status': payStatus_(total, 0, pay.paid, 0),
    'Patient ID': str_(req.patientId, 60) || linkPatient_(patient, req.phone), 'Returned Value': 0, 'Refunded Amount': 0 })]);
  appendRows_('BillItems', itemRows.map(function (r) { var o = {}; ['Bill ID','Medicine ID','Medicine Name','Quantity','Unit Price','Cost Price','Amount','Date & Time','Batch Allocation'].forEach(function (h, k) { o[h] = r[k]; }); return rowFrom_('BillItems', o); }));
  saveBatches_(batches);
  syncMedicineStock_(meds, batches, Object.keys(touched));
  appendRows_('StockMovements', movements.map(function (m) { return movementRow_(m.med.id, m.med.name, m.batch, m.qty, m.type, billId, s.u, m.reason, meds.map[m.med.id].stock); }));
  audit_(s, 'saveBill', billId, billNo + ' · ₹' + total + ' · ' + mode + (pay.paid < total ? ' · paid ₹' + pay.paid + ', due ₹' + r2_(total - pay.paid) : '') + (warnings.length ? ' · ' + warnings.join('; ') : ''), warnings.length ? 'WARN' : 'OK');
  return ok_({ billId: billId, billNo: billNo, subtotal: subtotal, discount: discount, total: total, costTotal: costTotal, warnings: warnings,
    paidAmount: pay.paid, balanceDue: r2_(total - pay.paid) });
}

function cancelBill_(req, s) {
  var billId = str_(req.billId, 60), reason = str_(req.reason, 300) || (req.action === 'deleteBill' ? 'Removed from the app' : '');
  if (!billId) return fail_('VALIDATION', 'Bill ID required');
  if (reason.length < 3) return fail_('VALIDATION', 'Please give a reason for cancelling');
  var row = findRow_('Bills', 'Bill ID', billId);
  if (row < 0) return fail_('VALIDATION', 'Bill not found');
  var bRow = sh_('Bills').getRange(row, 1, 1, sh_('Bills').getLastColumn()).getValues()[0];
  if (String(cell_('Bills', bRow, 'Status')) === 'Cancelled') return ok_({ billId: billId, alreadyCancelled: true });
  if (v31_() && linkedPayments_('BILL', billId).length) return fail_('VALIDATION', 'This bill has later payments or returns. Use Return / Refund instead of cancelling.');
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
  var id = Date.now(), expiry = formatDate(req.expiry), barcode = str_(req.barcode, 60);
  if (barcode && meds.list.some(function (m) { return m.status !== 'Inactive' && m.barcode === barcode; })) return fail_('VALIDATION', 'Another medicine already has barcode ' + barcode);
  appendRows_('Medicines', [rowFrom_('Medicines', { 'ID': id, 'Name': name, 'Stock': stock, 'Unit Price': price, 'Cost Price': cost, 'Expiry': expiry,
    'Date & Time': nowStr_(), 'Min Stock': num_(req.minStock) || 10, 'Status': 'Active',
    'Barcode': barcode, 'Generic Name': str_(req.genericName, 120), 'Category': str_(req.category, 60), 'Manufacturer': str_(req.manufacturer, 120) })]);
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
  if (req.barcode !== undefined) {
    var bc = str_(req.barcode, 60);
    if (bc && loadMedicines_().list.some(function (m) { return m.status !== 'Inactive' && m.barcode === bc && m.id !== String(req.id); })) return fail_('VALIDATION', 'Another medicine already has barcode ' + bc);
    upd['Barcode'] = bc; changes.push('barcode');
  }
  if (req.genericName !== undefined) upd['Generic Name'] = str_(req.genericName, 120);
  if (req.category !== undefined) upd['Category'] = str_(req.category, 60);
  if (req.manufacturer !== undefined) upd['Manufacturer'] = str_(req.manufacturer, 120);
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
  var amount = num_(req.amount); if (amount < 0 || amount > 10000000) return fail_('VALIDATION', 'Invalid amount');
  if (!str_(req.patient)) return fail_('VALIDATION', 'Patient name is required');
  amount = r2_(amount);
  var warnings = [], pay = paymentSplit_(req, amount, s, warnings, true);
  if (pay.error) return fail_('VALIDATION', pay.error);
  var obj = { 'Receipt No': str_(req.receiptNo, 30), 'Date': formatDate(req.date) || todayStr_(),
    'Patient': str_(req.patient, 120), 'Doctor': str_(req.doctor, 80), 'Amount': amount, 'Amount in Words': str_(req.amountWords, 300),
    'Treatments': str_(req.treatments, 1000), 'Saved At': nowStr_(), 'Payment Mode': pay.legacyMode, 'Record ID': recordId, 'Created By': s.u, 'Status': 'Active' };
  if (v31_()) {
    obj['Paid Amount'] = pay.paid; obj['Balance Due'] = r2_(amount - pay.paid); obj['Payment Status'] = payStatus_(amount, 0, pay.paid, 0);
    obj['Patient ID'] = str_(req.patientId, 60) || linkPatient_(req.patient, req.phone); obj['Returned Value'] = 0; obj['Refunded Amount'] = 0;
    obj['Cash Amount'] = pay.cash; obj['UPI Amount'] = pay.upi; obj['Card Amount'] = pay.card; obj['Discount'] = r2_(req.discount);
    obj['Payment Ref'] = str_(req.paymentRef, 80); obj['Items'] = str_(typeof req.items === 'string' ? req.items : JSON.stringify(req.items || ''), 4000);
  }
  appendRows_('TreatmentReceipts', [rowFrom_('TreatmentReceipts', obj)]);
  if (v31_() && req.treatmentRecordIds) linkTreatmentsToReceipt_(req.treatmentRecordIds, str_(req.receiptNo, 30) || recordId);
  audit_(s, 'saveTreatmentReceipt', str_(req.receiptNo) || recordId, str_(req.patient, 60) + ' · ₹' + amount + (pay.paid < amount ? ' · paid ₹' + pay.paid : ''), 'OK');
  return ok_({ paidAmount: pay.paid, balanceDue: r2_(amount - pay.paid), warnings: warnings });
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
    'Sex': str_(req.sex, 10), 'Prescription': str_(req.prescription || req.rxText, 5000), 'Saved At': nowStr_(), 'Record ID': recordId, 'Created By': s.u, 'Status': 'Active',
    'Patient ID': str_(req.patientId, 60) || (v31_() ? linkPatient_(req.patientName, req.phone) : ''), 'Doctor': str_(req.doctor, 80), 'Follow-up Date': formatDate(req.followUpDate) })]);
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
    'Record ID': recordId, 'Created By': s.u, 'Status': 'Active', 'Patient ID': str_(req.patientId, 60) || (v31_() ? linkPatient_(req.patient, req.phone) : '') })]);
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
  PATIENT_FIELDS.forEach(function (f) { if (req[f[0]] !== undefined) obj[f[1]] = str_(req[f[0]], f[2]); });   // older app versions don't send these → kept
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
  if (req.patientId !== undefined) obj['Patient ID'] = str_(req.patientId, 60);
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
var KEEP = { daily: 14, weekly: 8, monthly: 12, manual: 30, 'pre-migration': 10, 'pre-restore': 10, drill: 3 };

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
  if (v31_()) {
    // every bill's paid / returned / refunded totals must match its payment records
    var pays = {}; paymentsData_().slice(1).forEach(function (r) {
      if (!r[0] || String(r[22] || 'Active') !== 'Active') return;
      var k = String(r[4]) + '|' + String(r[5]), o = pays[k] = pays[k] || { coll: 0, ref: 0, cred: 0 };
      if (String(r[3]) === 'COLLECTION') o.coll += num_(r[10]); else { o.ref += num_(r[10]); o.cred += num_(r[17]); }
    });
    var chk = function (type, row) {
      var sp = INV[type], id = invId_(type, row), mo = invMoney_(type, row), p = pays[type + '|' + id] || { coll: 0, ref: 0, cred: 0 };
      if (String(cell_(sp.sheet, row, 'Status') || 'Active') === 'Cancelled') return;
      var c = num_(cell_(sp.sheet, row, 'Cash Amount')), u = num_(cell_(sp.sheet, row, 'UPI Amount')), k = num_(cell_(sp.sheet, row, 'Card Amount'));
      if ((c || u || k) && Math.abs(r2_(c + u + k + p.coll) - mo.paid) > 0.05) issues.push('Payments of ' + sp.label + ' ' + (cell_(sp.sheet, row, sp.no) || id) + ' do not add up (paid ₹' + mo.paid + ', records ₹' + r2_(c + u + k + p.coll) + ')');
      if (Math.abs(mo.refunded - p.ref) > 0.05 || Math.abs(mo.returned - p.cred) > 0.05) issues.push('Returns/refunds of ' + sp.label + ' ' + (cell_(sp.sheet, row, sp.no) || id) + ' do not match the refund records');
      if (mo.balance < -0.05) issues.push(sp.label + ' ' + (cell_(sp.sheet, row, sp.no) || id) + ' has a negative balance (₹' + mo.balance + ')');
    };
    values_('Bills').slice(1).forEach(function (r) { if (r[0]) chk('BILL', r); });
    values_('TreatmentReceipts').slice(1).forEach(function (r) { if ((r[0] || r[2]) && String(cell_('TreatmentReceipts', r, 'Status') || '') !== 'Deleted') chk('RECEIPT', r); });
    var sups = loadSuppliers_().map;
    values_('SupplierLedger').slice(1).forEach(function (r) { if (r[0] && !sups[String(r[2])]) issues.push('Supplier ledger entry ' + r[0] + ' has an unknown supplier'); });
    var invIds = {}; values_('PurchaseInvoices').slice(1).forEach(function (r) { if (r[0]) invIds[String(r[0])] = 1; });
    values_('Purchases').slice(1).forEach(function (r) { var iv = String(cell_('Purchases', r, 'Invoice ID') || ''); if (iv && !invIds[iv]) issues.push('Purchase ' + r[0] + ' points to a missing invoice ' + iv); });
  }
  return ok_({ issues: issues.slice(0, 500), count: issues.length });
}

// ════════════════════════════════════════════════════════════════════════════
// MIGRATION v2 → v3 (run from the editor; safe to re-run)
// ════════════════════════════════════════════════════════════════════════════
function v30Cols_(n) { var v31 = EXTRA_COLS_V31[n] || []; return EXTRA_COLS[n].filter(function (c) { return v31.indexOf(c) === -1; }); }
function migrationPlan_() {
  var plan = [], meds = loadMedicines_();
  Object.keys(BASE_HEADERS).forEach(function (n) { if (!sh_(n) && V31_SHEETS.indexOf(n) === -1) plan.push('Create tab ' + n); });
  Object.keys(EXTRA_COLS).forEach(function (n) {
    if (!sh_(n)) return; var map = hdr_(n);
    var missing = v30Cols_(n).filter(function (c) { return !map[c]; });
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

    Object.keys(BASE_HEADERS).forEach(function (n) { if (V31_SHEETS.indexOf(n) === -1) getOrCreateSheet(n, BASE_HEADERS[n]); });
    Object.keys(EXTRA_COLS).forEach(function (n) { ensureCols_(n, v30Cols_(n)); });

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
    if (schemaVersion_() < 3) props_().setProperty('SCHEMA_VERSION', '3');
    bumpDataVersion_();
    audit_({ u: 'system', r: 'SYSTEM' }, 'migrateToV3', '', plan.join(' | ') + ' | backup ' + backup.fileId, 'OK');
    Logger.log('✅ Migration complete. Backup: ' + backup.url);
  } finally { lock.releaseLock(); }
}

// Fresh install (empty spreadsheet): creates every tab with headers.
function setupSheets() {
  Object.keys(BASE_HEADERS).forEach(function (n) { getOrCreateSheet(n, BASE_HEADERS[n]); });
  Object.keys(EXTRA_COLS).forEach(function (n) { ensureCols_(n, EXTRA_COLS[n]); });
  Logger.log('All sheets created/verified. Now run migrateToV3, then migrateToV31.');
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
// v3.1 — MONEY: PART PAYMENTS, COLLECTIONS, RETURNS / REFUNDS, CASH CLOSING
// ════════════════════════════════════════════════════════════════════════════
// Every invoice (pharmacy bill or dental receipt) carries:
//   Total (T) · Returned Value (R) · Paid Amount (P) · Refunded Amount (F)
//   Balance Due = (T − R) − (P − F)
// Rows written before v3.1 have no Paid Amount and count as paid in full.
var PATIENT_FIELDS = [['medicalHistory', 'Medical History', 2000], ['dentalHistory', 'Dental History', 2000], ['allergies', 'Allergies', 500],
  ['medications', 'Medications', 1000], ['bloodGroup', 'Blood Group', 10], ['address', 'Address', 300], ['emergencyContact', 'Emergency Contact', 120],
  ['dob', 'Date of Birth', 20]];
var PAY_MODES = { cash: 'Cash', upi: 'UPI', card: 'Card', split: 'Split', credit: 'Credit' };
var INV = {
  BILL:    { sheet: 'Bills', key: 'Bill ID', alt: '', total: 'Total', name: 'Patient Name', phone: 'Phone', date: 'Date', no: 'Bill No', label: 'bill' },
  RECEIPT: { sheet: 'TreatmentReceipts', key: 'Record ID', alt: 'Receipt No', total: 'Amount', name: 'Patient', phone: '', date: 'Date', no: 'Receipt No', label: 'dental receipt' }
};
function pad5_(n) { return ('00000' + n).slice(-5); }
function normPhone_(p) { var d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : d; }
function bool_(v) { return v === true || String(v).toLowerCase() === 'true' || String(v) === '1' || String(v).toLowerCase() === 'yes'; }
function ts_(v) { return v instanceof Date ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm:ss') : String(v || ''); }
function jsonArr_(raw) {
  if (Array.isArray(raw)) return raw;
  try { var v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v : null; } catch (e) { return null; }
}
// {header: value} for a data row of a sheet (all columns, by heading)
function rowObj_(name, row) {
  var map = hdr_(name), o = {};
  for (var k in map) o[k] = row[map[k] - 1];
  return o;
}

// Payment for a bill/receipt: how much now, and how. Returns {error} or the split.
function paymentSplit_(req, total, s, warnings, lenient) {
  var raw = str_(req.paymentMode, 20) || 'Cash', mode = PAY_MODES[raw.toLowerCase()];
  if (!mode) { if (!lenient) return { error: 'Unknown payment mode' }; mode = 'Cash'; }
  var paidReq = (req.paidAmount === undefined || req.paidAmount === null || req.paidAmount === '') ? null : Number(req.paidAmount);
  if (paidReq !== null && !isFinite(paidReq)) return { error: 'Invalid amount paid' };
  var paid = mode === 'Credit' ? 0 : (paidReq === null ? total : r2_(paidReq));
  if (paid < 0 || paid > total + 0.01) return { error: 'Amount paid now must be between ₹0 and the total' };
  paid = r2_(Math.min(paid, total));
  if (paid < total - 0.009) {
    if (!v31_()) return { error: 'Part payments need the v3.1 server update (owner: run migrateToV31)' };
    if (s && s.r !== OWNER && String(getSetting_('staff_credit_allowed', 'yes')).toLowerCase() === 'no') return { error: 'Only the owner can let a patient pay later' };
  }
  var cash = 0, upi = 0, card = 0;
  if (mode === 'Cash') cash = paid; else if (mode === 'UPI') upi = paid; else if (mode === 'Card') card = paid;
  else if (mode === 'Split') {
    cash = r2_(req.cashAmount); upi = r2_(req.upiAmount); card = r2_(req.cardAmount);
    if (cash < 0 || upi < 0 || card < 0) return { error: 'Invalid split amounts' };
    if (cash + upi + card === 0) warnings.push('Split payment without amounts (old app version)');
    else if (Math.abs(cash + upi + card - paid) > 0.5) {
      if (lenient && !v31_()) warnings.push('Split amounts do not add up');
      else return { error: paid < total ? 'Split amounts must add up to the amount paid now' : 'Split amounts must add up to the total' };
    }
  }
  if (mode === 'Credit' && paid === 0 && total === 0) mode = 'Cash';
  return { mode: mode, legacyMode: mode === 'Cash' && raw && !PAY_MODES[raw.toLowerCase()] ? raw : mode, paid: paid, cash: cash, upi: upi, card: card };
}
function payStatus_(total, returned, paid, refunded) {
  var net = r2_(total - returned), got = r2_(paid - refunded), bal = r2_(net - got);
  if (net <= 0.009 && returned > 0) return 'Returned';
  if (bal <= 0.009) return 'Paid';
  return got > 0.009 ? 'Partial' : 'Unpaid';
}
function invMoney_(type, row) {
  var sp = INV[type], total = r2_(num_(cell_(sp.sheet, row, sp.total)));
  var pc = cell_(sp.sheet, row, 'Paid Amount');
  var paid = (pc === '' || pc === null || pc === undefined) ? total : num_(pc);
  var returned = num_(cell_(sp.sheet, row, 'Returned Value')), refunded = num_(cell_(sp.sheet, row, 'Refunded Amount'));
  return { total: total, paid: r2_(paid), returned: r2_(returned), refunded: r2_(refunded),
    balance: r2_(total - returned - (paid - refunded)), status: payStatus_(total, returned, paid, refunded) };
}
function invId_(type, row) {
  var sp = INV[type];
  return String(cell_(sp.sheet, row, sp.key) || (sp.alt ? cell_(sp.sheet, row, sp.alt) : '') || '');
}
function receivableOf_(type, row, mo) {
  var sp = INV[type];
  return { type: type, id: invId_(type, row), no: String(cell_(sp.sheet, row, sp.no) || ''), date: formatDate(cell_(sp.sheet, row, sp.date)),
    patientId: String(cell_(sp.sheet, row, 'Patient ID') || ''), patientName: String(cell_(sp.sheet, row, sp.name) || ''),
    phone: sp.phone ? String(cell_(sp.sheet, row, sp.phone) || '') : '', doctor: String(row[type === 'BILL' ? 2 : 3] || ''),
    total: mo.total, paid: mo.paid, returned: mo.returned, refunded: mo.refunded, balance: mo.balance };
}
function findInvoice_(type, id) {
  var sp = INV[type]; if (!sp || !id) return null;
  var data = values_(sp.sheet), k = colOf_(sp.sheet, sp.key), a = sp.alt ? colOf_(sp.sheet, sp.alt) : 0, hit = -1;
  for (var i = 1; i < data.length; i++) if (k && String(data[i][k - 1]) === String(id)) { hit = i; break; }
  if (hit < 0 && a) for (var j = 1; j < data.length; j++) if (String(data[j][a - 1]) === String(id) && !String(data[j][k - 1] || '')) { hit = j; break; }
  if (hit < 0) return null;
  var row = data[hit];
  return { type: type, sp: sp, rowIndex: hit + 1, row: row, money: invMoney_(type, row), status: String(cell_(sp.sheet, row, 'Status') || 'Active') };
}
function setInvMoney_(inv, paid, returned, refunded) {
  var t = inv.money.total;
  setCells_(inv.sp.sheet, inv.rowIndex, { 'Paid Amount': r2_(paid), 'Returned Value': r2_(returned), 'Refunded Amount': r2_(refunded),
    'Balance Due': r2_(t - returned - (paid - refunded)), 'Payment Status': payStatus_(t, returned, paid, refunded) });
  return r2_(t - returned - (paid - refunded));
}
function paymentsData_() { return sh_('Payments') ? values_('Payments') : []; }
function payObj_(r) {
  return { id: String(r[0]), no: String(r[1] || ''), date: formatDate(r[2]), type: String(r[3]), againstType: String(r[4]), againstId: String(r[5]),
    againstNo: String(r[6] || ''), patientId: String(r[7] || ''), patientName: String(r[8] || ''), phone: String(r[9] || ''), amount: num_(r[10]),
    mode: String(r[11] || ''), cashAmount: num_(r[12]), upiAmount: num_(r[13]), cardAmount: num_(r[14]), ref: String(r[15] || ''), notes: String(r[16] || ''),
    creditValue: num_(r[17]), items: jsonArr_(r[18]) || [], costReversed: num_(r[19]), createdBy: String(r[20] || ''), createdAt: ts_(r[21]),
    status: String(r[22] || 'Active'), cancelReason: String(r[25] || '') };
}
function linkedPayments_(type, id) {
  return paymentsData_().slice(1).filter(function (r) { return r[0] && String(r[4]) === type && String(r[5]) === String(id) && String(r[22] || 'Active') === 'Active'; }).map(payObj_);
}
// Link a record to a patient when name AND phone match exactly one saved patient.
function linkPatient_(name, phone) {
  if (!v31_()) return '';
  var n = str_(name).toLowerCase(), ph = normPhone_(phone);
  if (!n || ph.length < 10) return '';
  var data = values_('Patients'), hit = '';
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0] || String(data[i][9]) === 'Deleted') continue;
    if (String(data[i][1]).trim().toLowerCase() === n && normPhone_(data[i][2]) === ph) { if (hit) return ''; hit = String(data[i][0]); }
  }
  return hit;
}
function seqNo_(prefix) { var yy = todayStr_().slice(2, 4); return prefix + '-' + yy + '-' + pad5_(nextSeq_('SEQ_' + prefix + '_' + yy)); }

// ── extra data for the app (getAllData) ──
function extendAllData_(out, role, from, receivables) {
  var isOwner = role === OWNER, today = todayStr_();
  var byId = {}; (out.patients || []).forEach(function (p) { byId[String(p.id)] = p; });
  receivables.forEach(function (r) { var p = byId[r.patientId]; if (p && !r.phone) r.phone = p.phone; });
  receivables.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  out.receivables = receivables;

  out.payments = paymentsData_().slice(1).filter(function (r) { return r[0] && formatDate(r[2]) >= from; }).map(payObj_);
  out.treatmentMaster = treatmentMaster_();
  out.patientTreatments = values_('PatientTreatments').slice(1).filter(function (r) {
    if (!r[0] || String(r[10]) === 'Deleted') return false;
    return String(r[10]) === 'Planned' || String(r[10]) === 'In progress' || formatDate(r[1]) >= from;
  }).map(ptObj_);
  var fuFrom = daysAgoStr_(30);
  out.followUps = values_('FollowUps').slice(1).filter(function (r) {
    if (!r[0] || String(r[8]) === 'Deleted') return false;
    return String(r[8]) === 'Pending' || formatDate(r[4]) >= fuFrom;
  }).map(fuObj_);
  var ccFrom = isOwner ? daysAgoStr_(90) : daysAgoStr_(STAFF_BILL_DAYS);
  out.cashClosings = values_('CashClosings').slice(1).filter(function (r) { return r[0] && String(r[16]) === 'Active' && formatDate(r[1]) >= ccFrom; }).map(ccObj_);
  out.settings = { staffCreditAllowed: String(getSetting_('staff_credit_allowed', 'yes')).toLowerCase() !== 'no' };
  if (isOwner) {
    var bal = supplierBalances_();
    out.suppliers = loadSuppliers_().list.map(function (su) { var b = bal[su.id] || {}; return supplierOut_(su, b); });
    out.purchaseInvoices = values_('PurchaseInvoices').slice(1).filter(function (r) { return r[0] && formatDate(r[1]) >= from; }).map(pinvObj_);
    out.purchaseReturns = values_('PurchaseReturns').slice(1).filter(function (r) { return r[0] && formatDate(r[1]) >= from; }).map(prObj_);
  }
}

// ── collect a balance later ──
function recordPayment_(req, s) {
  var type = String(req.againstType || '').toUpperCase(), id = str_(req.againstId, 60);
  var paymentId = str_(req.paymentId, 60) || uid_('PAY-');
  if (findRow_('Payments', 'Payment ID', paymentId) > 0) return ok_({ paymentId: paymentId, duplicate: true });
  var amount = r2_(req.amount);
  if (!(amount > 0) || amount > 10000000) return fail_('VALIDATION', 'Enter the amount received');
  var date = formatDate(req.date) || todayStr_();
  if (date > todayStr_()) return fail_('VALIDATION', 'Payment date cannot be in the future');
  if (String(req.mode || req.paymentMode || '').toLowerCase() === 'credit') return fail_('VALIDATION', 'Choose how the money was received');
  var warnings = [], pay = paymentSplit_({ paymentMode: req.mode || req.paymentMode, cashAmount: req.cashAmount, upiAmount: req.upiAmount, cardAmount: req.cardAmount, paidAmount: amount }, amount, s, warnings);
  if (pay.error) return fail_('VALIDATION', pay.error);
  if (pay.mode === 'Credit') return fail_('VALIDATION', 'Choose how the money was received');
  var name, phone, patientId, no, after;
  if (type === 'OPENING') {
    var pr = findRow_('Patients', 'ID', id); if (pr < 0) return fail_('VALIDATION', 'Patient not found');
    var prow = sh_('Patients').getRange(pr, 1, 1, Math.max(12, sh_('Patients').getLastColumn())).getValues()[0], old = num_(prow[7]);
    if (amount > old + 0.01) return fail_('VALIDATION', 'Old balance is only ₹' + r2_(old));
    after = r2_(old - amount);
    setCells_('Patients', pr, { 'Balance': after, 'Updated At': nowStr_() });
    name = String(prow[1]); phone = String(prow[2] || ''); patientId = id; no = 'Old balance';
  } else if (INV[type]) {
    var inv = findInvoice_(type, id); if (!inv) return fail_('VALIDATION', 'That ' + INV[type].label + ' was not found');
    if (inv.status === 'Cancelled' || inv.status === 'Deleted') return fail_('VALIDATION', 'That ' + INV[type].label + ' is cancelled');
    if (amount > inv.money.balance + 0.01) return fail_('VALIDATION', inv.money.balance > 0 ? 'Only ₹' + inv.money.balance + ' is due on this ' + INV[type].label : 'Nothing is due on this ' + INV[type].label);
    after = setInvMoney_(inv, inv.money.paid + amount, inv.money.returned, inv.money.refunded);
    name = String(cell_(inv.sp.sheet, inv.row, inv.sp.name) || ''); phone = inv.sp.phone ? String(cell_(inv.sp.sheet, inv.row, inv.sp.phone) || '') : str_(req.phone, 20);
    patientId = String(cell_(inv.sp.sheet, inv.row, 'Patient ID') || ''); no = String(cell_(inv.sp.sheet, inv.row, inv.sp.no) || '');
  } else return fail_('VALIDATION', 'Unknown bill type');
  var payNo = seqNo_('PAY');
  appendRows_('Payments', [rowFrom_('Payments', { 'Payment ID': paymentId, 'Payment No': payNo, 'Date': date, 'Type': 'COLLECTION', 'Against Type': type,
    'Against ID': id, 'Against No': no, 'Patient ID': patientId, 'Patient Name': name, 'Phone': phone, 'Amount': amount, 'Mode': pay.mode,
    'Cash Amount': pay.cash, 'UPI Amount': pay.upi, 'Card Amount': pay.card, 'Reference': str_(req.ref, 80), 'Notes': str_(req.notes, 300),
    'Created By': s.u, 'Created At': nowStr_(), 'Status': 'Active' })]);
  audit_(s, 'recordPayment', payNo, type + ' ' + (no || id) + ' · ₹' + amount + ' ' + pay.mode + ' · due now ₹' + after, 'OK');
  return ok_({ paymentId: paymentId, paymentNo: payNo, amount: amount, balance: after, patientName: name, warnings: warnings });
}

function cancelPayment_(req, s) {
  var id = str_(req.paymentId, 60), reason = str_(req.reason, 300);
  if (reason.length < 3) return fail_('VALIDATION', 'Please give a reason');
  var row = findRow_('Payments', 'Payment ID', id); if (row < 0) return fail_('VALIDATION', 'Payment not found');
  var p = payObj_(sh_('Payments').getRange(row, 1, 1, sh_('Payments').getLastColumn()).getValues()[0]);
  if (p.status === 'Cancelled') return ok_({ alreadyCancelled: true });
  if (p.type !== 'COLLECTION') return fail_('VALIDATION', 'Refunds cannot be cancelled (stock has moved). Make a new bill instead.');
  if (p.againstType === 'OPENING') {
    var pr = findRow_('Patients', 'ID', p.againstId);
    if (pr > 0) { var old = num_(sh_('Patients').getRange(pr, 8, 1, 1).getValues()[0][0]); setCells_('Patients', pr, { 'Balance': r2_(old + p.amount), 'Updated At': nowStr_() }); }
  } else {
    var inv = findInvoice_(p.againstType, p.againstId); if (!inv) return fail_('VALIDATION', 'The bill of this payment was not found');
    if (inv.money.paid - p.amount < inv.money.refunded - 0.01) return fail_('VALIDATION', 'Money was refunded on this bill after this payment — cannot cancel it');
    setInvMoney_(inv, inv.money.paid - p.amount, inv.money.returned, inv.money.refunded);
  }
  setCells_('Payments', row, { 'Status': 'Cancelled', 'Cancelled At': nowStr_(), 'Cancelled By': s.u, 'Cancel Reason': reason });
  audit_(s, 'cancelPayment', p.no || id, '₹' + p.amount + ' · ' + reason, 'OK');
  return ok_();
}

// Return goods and/or reduce what the patient owes; pays back any overpayment.
function returnRefund_(req, s) {
  var type = String(req.againstType || 'BILL').toUpperCase(), id = str_(req.againstId, 60);
  var refundId = str_(req.refundId, 60) || uid_('RF-');
  if (findRow_('Payments', 'Payment ID', refundId) > 0) return ok_({ refundId: refundId, duplicate: true });
  var reason = str_(req.reason, 300); if (reason.length < 3) return fail_('VALIDATION', 'Please give a reason for the return / refund');
  var inv = findInvoice_(type, id); if (!inv) return fail_('VALIDATION', 'Bill not found');
  if (inv.status === 'Cancelled' || inv.status === 'Deleted') return fail_('VALIDATION', 'That bill is cancelled');
  var items = jsonArr_(req.items); if (items === null) return fail_('VALIDATION', 'Return items are unreadable');
  if (type !== 'BILL' && items.length) return fail_('VALIDATION', 'Only pharmacy bills have items to return');
  var allowance = r2_(req.allowance); if (allowance < 0) return fail_('VALIDATION', 'Invalid amount');
  var restock = !(req.restock === false || String(req.restock) === 'false');
  var meds = loadMedicines_(), batches = loadBatches_(), byBatch = {}; batches.forEach(function (b) { byBatch[b.batchId] = b; });
  var lines = [], itemsValue = 0, costReversed = 0, movements = [], touched = {};
  if (items.length) {
    var sold = {}, iData = values_('BillItems');
    for (var i = 1; i < iData.length; i++) {
      var r = iData[i]; if (String(r[0]) !== id) continue;
      var k = String(r[1]), al = []; try { al = JSON.parse(cell_('BillItems', r, 'Batch Allocation') || '[]') || []; } catch (e) {}
      var o = sold[k] = sold[k] || { qty: 0, price: num_(r[4]), name: String(r[2]), allocs: [], returned: 0, back: {} };
      o.qty += num_(r[3]); o.allocs = o.allocs.concat(al);
    }
    linkedPayments_('BILL', id).forEach(function (p) {
      if (p.type !== 'REFUND') return;
      p.items.forEach(function (it) { var o = sold[String(it.medicineId)]; if (!o) return; o.returned += num_(it.qty); (it.batches || []).forEach(function (x) { o.back[x.b] = (o.back[x.b] || 0) + num_(x.q); }); });
    });
    var sub = num_(inv.row[5]), disc = num_(inv.row[6]), ratio = sub > 0 ? Math.max(0, 1 - disc / sub) : 1;
    var seen = {};
    for (var j = 0; j < items.length; j++) {
      var mid = str_(items[j].medicineId, 60), q = Number(items[j].qty), o2 = sold[mid];
      if (!o2) return fail_('VALIDATION', 'That medicine is not on this bill');
      if (seen[mid]) return fail_('VALIDATION', 'Each medicine once, please'); seen[mid] = 1;
      if (!isFinite(q) || q <= 0 || Math.floor(q) !== q) return fail_('VALIDATION', 'Invalid return quantity for ' + o2.name);
      if (q > o2.qty - o2.returned) return fail_('VALIDATION', 'Only ' + (o2.qty - o2.returned) + ' of ' + o2.name + ' can still be returned');
      var value = r2_(q * o2.price * ratio), back = [];
      var med = meds.map[mid];
      if (restock && med) {
        var left = q;
        for (var a = o2.allocs.length - 1; a >= 0 && left > 0; a--) {      // newest allocation first
          var al2 = o2.allocs[a], room = num_(al2.q) - (o2.back[al2.b] || 0), b = byBatch[al2.b];
          if (!b || room <= 0) continue;
          var t = Math.min(room, left);
          b.avail = r2_(b.avail + t); if (b.status !== 'Active') b.status = 'Active'; b.dirty = true;
          o2.back[al2.b] = (o2.back[al2.b] || 0) + t; back.push({ b: b.batchId, q: t }); costReversed += t * b.cost; left -= t;
          movements.push({ med: med, batch: b.batchId, qty: t });
        }
        if (left > 0) {          // bill from before batches: back to the earliest-expiring active batch, or a RETURN batch
          var target = batches.filter(function (x) { return x.medicineId === med.id && x.status === 'Active'; }).sort(fefoSort_)[0];
          if (target) { target.avail = r2_(target.avail + left); target.dirty = true; back.push({ b: target.batchId, q: left }); costReversed += left * target.cost; movements.push({ med: med, batch: target.batchId, qty: left }); }
          else {
            var nb = uid_('B-');
            appendRows_('Batches', [newBatchRow_({ batchId: nb, medicineId: med.id, batchNo: 'RETURN', expiry: med.expiry, qty: left, cost: med.costPrice })]);
            back.push({ b: nb, q: left }); costReversed += left * med.costPrice; movements.push({ med: med, batch: nb, qty: left });
          }
        }
        touched[med.id] = 1;
      }
      itemsValue += value;
      lines.push({ medicineId: mid, name: o2.name, qty: q, value: value, batches: back });
    }
  }
  var credit = r2_(itemsValue + allowance);
  if (credit <= 0) return fail_('VALIDATION', 'Choose items to return or enter an amount to give back');
  var m = inv.money;
  if (m.returned + credit > m.total + 0.01) return fail_('VALIDATION', 'That is more than the bill total (₹' + r2_(m.total - m.returned) + ' left)');
  var netNew = r2_(m.total - m.returned - credit), refundMoney = r2_(Math.max(0, (m.paid - m.refunded) - netNew));
  var pay = { mode: 'None', cash: 0, upi: 0, card: 0 };
  if (refundMoney > 0) {
    pay = paymentSplit_({ paymentMode: req.mode || req.paymentMode || 'Cash', cashAmount: req.cashAmount, upiAmount: req.upiAmount, cardAmount: req.cardAmount, paidAmount: refundMoney }, refundMoney, s, []);
    if (pay.error) return fail_('VALIDATION', pay.error.replace('paid now', 'given back'));
    if (pay.mode === 'Credit') return fail_('VALIDATION', 'Choose how the money is given back');
  }
  // ── write ──
  if (restock && lines.length) { saveBatches_(batches); syncMedicineStock_(meds, batches, Object.keys(touched)); }
  var after = setInvMoney_(inv, m.paid, m.returned + credit, m.refunded + refundMoney);
  var no = seqNo_('RF'), date = todayStr_();
  appendRows_('Payments', [rowFrom_('Payments', { 'Payment ID': refundId, 'Payment No': no, 'Date': date, 'Type': 'REFUND', 'Against Type': type,
    'Against ID': id, 'Against No': String(cell_(inv.sp.sheet, inv.row, inv.sp.no) || ''), 'Patient ID': String(cell_(inv.sp.sheet, inv.row, 'Patient ID') || ''),
    'Patient Name': String(cell_(inv.sp.sheet, inv.row, inv.sp.name) || ''), 'Phone': inv.sp.phone ? String(cell_(inv.sp.sheet, inv.row, inv.sp.phone) || '') : '',
    'Amount': refundMoney, 'Mode': pay.mode, 'Cash Amount': pay.cash, 'UPI Amount': pay.upi, 'Card Amount': pay.card, 'Reference': str_(req.ref, 80),
    'Notes': reason + (restock ? '' : ' · not put back in stock'), 'Credit Value': credit, 'Items': lines.length ? JSON.stringify(lines) : '',
    'Cost Reversed': r2_(costReversed), 'Created By': s.u, 'Created At': nowStr_(), 'Status': 'Active' })]);
  appendRows_('StockMovements', movements.map(function (mv) { return movementRow_(mv.med.id, mv.med.name, mv.batch, mv.qty, 'CUSTOMER_RETURN', refundId, s.u, reason, meds.map[mv.med.id].stock); }));
  audit_(s, 'returnRefund', no, type + ' ' + id + ' · credit ₹' + credit + ' · paid back ₹' + refundMoney + (lines.length ? ' · ' + lines.map(function (l) { return l.name + ' ×' + l.qty; }).join(', ') : '') + ' · ' + reason, 'OK');
  return ok_({ refundId: refundId, refundNo: no, creditValue: credit, refundAmount: refundMoney, balance: after, costReversed: r2_(costReversed) });
}

function getPayments_(req, s) {
  var id = str_(req.againstId, 60), pid = str_(req.patientId, 60), from = formatDate(req.from) || '', to = formatDate(req.to) || '9999';
  if (s.r !== OWNER && !id && !pid) from = from > daysAgoStr_(STAFF_BILL_DAYS) ? from : daysAgoStr_(STAFF_BILL_DAYS);
  var out = paymentsData_().slice(1).filter(function (r) {
    if (!r[0]) return false;
    if (id && String(r[5]) !== id) return false;
    if (pid && String(r[7]) !== pid) return false;
    var d = formatDate(r[2]); return d >= from && d <= to;
  }).map(payObj_);
  return ok_({ payments: out });
}

// ── daily cash closing ──
function cashSummary_(date) {
  var z = function () { return { cash: 0, upi: 0, card: 0, other: 0 }; };
  var r = { date: date, bills: z(), receipts: z(), collections: z(), refunds: z(), expenses: z(), suppliers: z(), counts: { bills: 0, receipts: 0, collections: 0, refunds: 0, expenses: 0, suppliers: 0 } };
  var add = function (bucket, mode, amt, c, u, k) {   // explicit split amounts win; else by mode
    if (c || u || k) { bucket.cash += c; bucket.upi += u; bucket.card += k; return; }
    var m = String(mode || '').toLowerCase();
    if (m === 'cash') bucket.cash += amt; else if (m === 'upi') bucket.upi += amt; else if (m === 'card') bucket.card += amt; else if (amt) bucket.other += amt;
  };
  values_('Bills').slice(1).forEach(function (b) {
    if (!b[0] || formatDate(b[4]) !== date || String(cell_('Bills', b, 'Status') || 'Active') === 'Cancelled') return;
    var mo = invMoney_('BILL', b), initial = r2_(mo.paid - collectedOn_(b[0]));
    add(r.bills, b[9], initial, num_(cell_('Bills', b, 'Cash Amount')), num_(cell_('Bills', b, 'UPI Amount')), num_(cell_('Bills', b, 'Card Amount'))); r.counts.bills++;
  });
  values_('TreatmentReceipts').slice(1).forEach(function (t) {
    if ((!t[0] && !t[2]) || formatDate(t[1]) !== date || String(cell_('TreatmentReceipts', t, 'Status') || '') === 'Deleted') return;
    var mo = invMoney_('RECEIPT', t), initial = r2_(mo.paid - collectedOn_(invId_('RECEIPT', t)));
    add(r.receipts, cell_('TreatmentReceipts', t, 'Payment Mode'), initial, num_(cell_('TreatmentReceipts', t, 'Cash Amount')), num_(cell_('TreatmentReceipts', t, 'UPI Amount')), num_(cell_('TreatmentReceipts', t, 'Card Amount'))); r.counts.receipts++;
  });
  paymentsData_().slice(1).forEach(function (p) {
    if (!p[0] || formatDate(p[2]) !== date || String(p[22] || 'Active') !== 'Active') return;
    var o = payObj_(p), bucket = o.type === 'REFUND' ? r.refunds : r.collections;
    add(bucket, o.mode, o.amount, o.cashAmount, o.upiAmount, o.cardAmount); r.counts[o.type === 'REFUND' ? 'refunds' : 'collections']++;
  });
  readExpenses_().forEach(function (e) { if (e.date === date) { add(r.expenses, e.mode, e.amount, 0, 0, 0); r.counts.expenses++; } });
  if (sh_('SupplierLedger')) values_('SupplierLedger').slice(1).forEach(function (l) {
    if (!l[0] || formatDate(l[1]) !== date || String(l[4]) !== 'PAYMENT' || String(l[12] || 'Active') !== 'Active') return;
    add(r.suppliers, l[8], num_(l[6]), 0, 0, 0); r.counts.suppliers++;
  });
  ['bills', 'receipts', 'collections', 'refunds', 'expenses', 'suppliers'].forEach(function (k) { ['cash', 'upi', 'card', 'other'].forEach(function (m) { r[k][m] = r2_(r[k][m]); }); });
  r.cashIn = r2_(r.bills.cash + r.receipts.cash + r.collections.cash);
  r.cashOut = r2_(r.refunds.cash + r.expenses.cash + r.suppliers.cash);
  r.upiIn = r2_(r.bills.upi + r.receipts.upi + r.collections.upi - r.refunds.upi);
  r.cardIn = r2_(r.bills.card + r.receipts.card + r.collections.card - r.refunds.card);
  return r;
}
// collections recorded later against an invoice (not part of the money taken when it was made)
var _collCache = null;
function collectedOn_(invoiceId) {
  if (!_collCache) {
    _collCache = {};
    paymentsData_().slice(1).forEach(function (p) { if (p[0] && String(p[3]) === 'COLLECTION' && String(p[22] || 'Active') === 'Active') _collCache[String(p[5])] = (_collCache[String(p[5])] || 0) + num_(p[10]); });
  }
  return _collCache[String(invoiceId)] || 0;
}
function ccObj_(r) {
  return { id: String(r[0]), date: formatDate(r[1]), openingCash: num_(r[2]), cashIn: num_(r[3]), cashOut: num_(r[4]), expectedCash: num_(r[5]),
    countedCash: num_(r[6]), difference: num_(r[7]), deposited: num_(r[8]), upiTotal: num_(r[9]), cardTotal: num_(r[10]),
    upiVerified: bool_(r[11]), cardVerified: bool_(r[12]), notes: String(r[13] || ''), closedBy: String(r[14] || ''), closedAt: ts_(r[15]), status: String(r[16] || '') };
}
function closingsData_() { return values_('CashClosings').slice(1).filter(function (r) { return r[0] && String(r[16]) === 'Active'; }).map(ccObj_); }
function getCashSummary_(req, s) {
  var date = formatDate(req.date) || todayStr_();
  if (s.r !== OWNER && date < daysAgoStr_(STAFF_BILL_DAYS)) return fail_('FORBIDDEN', 'Staff can see the last ' + STAFF_BILL_DAYS + ' days only');
  _collCache = null;
  var sum = cashSummary_(date), all = closingsData_(), prev = null, cur = null;
  all.forEach(function (c) { if (c.date < date && (!prev || c.date > prev.date)) prev = c; if (c.date === date) cur = c; });
  return ok_({ summary: sum, suggestedOpening: prev ? r2_(prev.countedCash - prev.deposited) : 0, previous: prev, closing: cur });
}
function saveCashClosing_(req, s) {
  var date = formatDate(req.date) || todayStr_();
  if (date > todayStr_()) return fail_('VALIDATION', 'Cannot close a future day');
  if (s.r !== OWNER && date < daysAgoStr_(STAFF_BILL_DAYS)) return fail_('FORBIDDEN', 'Ask the owner to close older days');
  var opening = r2_(req.openingCash), counted = r2_(req.countedCash), deposited = r2_(req.deposited);
  if (opening < 0 || counted < 0 || deposited < 0) return fail_('VALIDATION', 'Amounts cannot be negative');
  if (deposited > counted + 0.01) return fail_('VALIDATION', 'Cannot deposit more than the cash counted');
  if (req.countedCash === undefined || req.countedCash === '') return fail_('VALIDATION', 'Enter the cash counted in the drawer');
  var data = values_('CashClosings'), old = -1;
  for (var i = 1; i < data.length; i++) if (data[i][0] && formatDate(data[i][1]) === date && String(data[i][16]) === 'Active') old = i + 1;
  if (old > 0 && s.r !== OWNER) return fail_('VALIDATION', 'This day is already closed. Ask the owner to change it.');
  _collCache = null;
  var sum = cashSummary_(date), expected = r2_(opening + sum.cashIn - sum.cashOut), diff = r2_(counted - expected);
  if (old > 0) setCells_('CashClosings', old, { 'Status': 'Superseded' });
  var id = uid_('CC-');
  appendRows_('CashClosings', [rowFrom_('CashClosings', { 'Closing ID': id, 'Date': date, 'Opening Cash': opening, 'Cash In': sum.cashIn, 'Cash Out': sum.cashOut,
    'Expected Cash': expected, 'Counted Cash': counted, 'Difference': diff, 'Deposited': deposited, 'UPI Total': sum.upiIn, 'Card Total': sum.cardIn,
    'UPI Verified': bool_(req.upiVerified), 'Card Verified': bool_(req.cardVerified), 'Notes': str_(req.notes, 500), 'Closed By': s.u, 'Closed At': nowStr_(),
    'Status': 'Active', 'Details': JSON.stringify(sum) })]);
  audit_(s, 'saveCashClosing', date, 'Expected ₹' + expected + ' · counted ₹' + counted + ' · difference ₹' + diff + (old > 0 ? ' · replaced earlier closing' : ''), Math.abs(diff) > 0.009 ? 'WARN' : 'OK');
  return ok_({ closingId: id, expectedCash: expected, difference: diff, summary: sum });
}
function getCashClosings_(req) {
  var from = formatDate(req.from) || daysAgoStr_(90), to = formatDate(req.to) || '9999';
  return ok_({ closings: closingsData_().filter(function (c) { return c.date >= from && c.date <= to; }) });
}

// ════════════════════════════════════════════════════════════════════════════
// v3.1 — SUPPLIERS, PURCHASE INVOICES, SUPPLIER PAYMENTS, PURCHASE RETURNS
// ════════════════════════════════════════════════════════════════════════════
// SupplierLedger: Credit = we owe more (opening, purchase); Debit = we owe less (payment, return).
// Balance owed to a supplier = Opening Balance + Σ credit − Σ debit. Purchases from before v3.1 count as paid.
function loadSuppliers_() {
  var data = sh_('Suppliers') ? values_('Suppliers') : [], list = [], map = {};
  for (var i = 1; i < data.length; i++) {
    var r = data[i]; if (!r[0]) continue;
    var o = { row: i + 1, id: String(r[0]), name: String(r[1] || ''), phone: String(r[2] || ''), contact: String(r[3] || ''), address: String(r[4] || ''),
      notes: String(r[5] || ''), opening: num_(r[6]), status: String(r[7] || 'Active') };
    list.push(o); map[o.id] = o;
  }
  return { list: list, map: map };
}
function supplierOut_(su, b) {
  return { id: su.id, name: su.name, phone: su.phone, contact: su.contact, address: su.address, notes: su.notes, openingBalance: su.opening, status: su.status,
    purchases: r2_(b.purchases || 0), payments: r2_(b.payments || 0), returns: r2_(b.returns || 0), balance: r2_(su.opening + (b.credit || 0) - (b.debit || 0)) };
}
function supplierBalances_() {
  var map = {};
  if (!sh_('SupplierLedger')) return map;
  values_('SupplierLedger').slice(1).forEach(function (r) {
    if (!r[0] || String(r[12] || 'Active') !== 'Active') return;
    var o = map[String(r[2])] = map[String(r[2])] || { credit: 0, debit: 0, purchases: 0, payments: 0, returns: 0 };
    var d = num_(r[6]), c = num_(r[7]), t = String(r[4]);
    o.credit += c; o.debit += d;
    if (t === 'PURCHASE') o.purchases += c; else if (t === 'PAYMENT') o.payments += d; else if (t === 'RETURN') o.returns += d;
  });
  return map;
}
function findSupplierByName_(list, name) {
  var n = str_(name).toLowerCase(); if (!n) return null;
  return list.filter(function (x) { return x.status !== 'Inactive' && x.name.trim().toLowerCase() === n; })[0] || null;
}
function findOrCreateSupplier_(s, supplierId, supplierName) {
  var sups = loadSuppliers_();
  if (supplierId) { var su = sups.map[str_(supplierId, 60)]; if (su) return su; }
  var byName = findSupplierByName_(sups.list, supplierName); if (byName) return byName;
  var name = str_(supplierName, 120); if (!name) return null;
  var id = uid_('SUP-');
  appendRows_('Suppliers', [rowFrom_('Suppliers', { 'Supplier ID': id, 'Name': name, 'Opening Balance': 0, 'Status': 'Active', 'Created At': nowStr_(), 'Created By': s.u, 'Updated At': nowStr_() })]);
  return { id: id, name: name, opening: 0, status: 'Active' };
}
function ledgerRow_(o, s) {
  return rowFrom_('SupplierLedger', { 'Entry ID': o.id || uid_('SL-'), 'Date': o.date, 'Supplier ID': o.supplierId, 'Supplier Name': o.supplierName, 'Type': o.type,
    'Reference': o.ref || '', 'Debit': r2_(o.debit || 0), 'Credit': r2_(o.credit || 0), 'Mode': o.mode || '', 'Notes': o.notes || '',
    'Created By': s.u, 'Created At': nowStr_(), 'Status': 'Active' });
}
function saveSupplier_(req, s) {
  var name = str_(req.name, 120); if (!name) return fail_('VALIDATION', 'Supplier name is required');
  var sups = loadSuppliers_(), id = str_(req.id, 60), opening = r2_(req.openingBalance);
  var dup = sups.list.filter(function (x) { return x.status !== 'Inactive' && x.id !== id && x.name.trim().toLowerCase() === name.toLowerCase(); })[0];
  if (dup) return fail_('DUPLICATE', 'A supplier called ' + dup.name + ' already exists');
  var obj = { 'Name': name, 'Phone': str_(req.phone, 20), 'Contact Person': str_(req.contact, 80), 'Address': str_(req.address, 300), 'Notes': str_(req.notes, 500),
    'Opening Balance': opening, 'Status': str_(req.status, 20) === 'Inactive' ? 'Inactive' : 'Active', 'Updated At': nowStr_() };
  if (id && sups.map[id]) {
    setCells_('Suppliers', sups.map[id].row, obj);
    audit_(s, 'saveSupplier', id, name + ' · updated', 'OK');
    return ok_({ id: id });
  }
  id = id || uid_('SUP-'); obj['Supplier ID'] = id; obj['Created At'] = nowStr_(); obj['Created By'] = s.u;
  appendRows_('Suppliers', [rowFrom_('Suppliers', obj)]);
  audit_(s, 'saveSupplier', id, name + ' · created', 'OK');
  return ok_({ id: id });
}
function deleteSupplier_(req, s) {
  var su = loadSuppliers_().map[str_(req.id, 60)]; if (!su) return ok_();
  setCells_('Suppliers', su.row, { 'Status': 'Inactive', 'Updated At': nowStr_() });
  audit_(s, 'deleteSupplier', su.id, su.name + ' · marked inactive', 'OK');
  return ok_();
}
function recordSupplierPayment_(req, s) {
  var su = loadSuppliers_().map[str_(req.supplierId, 60)]; if (!su) return fail_('VALIDATION', 'Supplier not found');
  var amount = r2_(req.amount); if (!(amount > 0)) return fail_('VALIDATION', 'Enter the amount paid');
  var entryId = str_(req.entryId, 60) || uid_('SL-');
  if (findRow_('SupplierLedger', 'Entry ID', entryId) > 0) return ok_({ entryId: entryId, duplicate: true });
  var mode = PAY_MODES[String(req.mode || 'Cash').toLowerCase()] || str_(req.mode, 20) || 'Cash';
  if (mode === 'Credit' || mode === 'Split') return fail_('VALIDATION', 'Choose Cash, UPI, Card or Bank');
  var date = formatDate(req.date) || todayStr_(); if (date > todayStr_()) return fail_('VALIDATION', 'Date cannot be in the future');
  var b = supplierBalances_()[su.id] || {}, owed = r2_(su.opening + (b.credit || 0) - (b.debit || 0)), warnings = [];
  if (amount > owed + 0.01) warnings.push('Paid ₹' + r2_(amount - owed) + ' more than owed — recorded as an advance');
  appendRows_('SupplierLedger', [ledgerRow_({ id: entryId, date: date, supplierId: su.id, supplierName: su.name, type: 'PAYMENT', ref: str_(req.ref, 80) || str_(req.invoiceId, 60),
    debit: amount, mode: mode, notes: str_(req.notes, 300) }, s)]);
  audit_(s, 'recordSupplierPayment', su.id, su.name + ' · ₹' + amount + ' ' + mode, 'OK');
  return ok_({ entryId: entryId, balance: r2_(owed - amount), warnings: warnings });
}
function cancelSupplierEntry_(req, s) {
  var id = str_(req.entryId, 60), reason = str_(req.reason, 300);
  if (reason.length < 3) return fail_('VALIDATION', 'Please give a reason');
  var row = findRow_('SupplierLedger', 'Entry ID', id); if (row < 0) return fail_('VALIDATION', 'Entry not found');
  var r = sh_('SupplierLedger').getRange(row, 1, 1, sh_('SupplierLedger').getLastColumn()).getValues()[0];
  if (String(r[12]) === 'Cancelled') return ok_({ alreadyCancelled: true });
  if (['PAYMENT', 'ADJUSTMENT'].indexOf(String(r[4])) === -1) return fail_('VALIDATION', 'Purchases and returns are cancelled from their own screen (they move stock)');
  setCells_('SupplierLedger', row, { 'Status': 'Cancelled', 'Cancelled At': nowStr_(), 'Cancelled By': s.u, 'Cancel Reason': reason });
  audit_(s, 'cancelSupplierEntry', id, String(r[3]) + ' · ' + String(r[4]) + ' ₹' + (num_(r[6]) || num_(r[7])) + ' · ' + reason, 'OK');
  return ok_();
}
function slObj_(r) {
  return { id: String(r[0]), date: formatDate(r[1]), supplierId: String(r[2]), supplierName: String(r[3] || ''), type: String(r[4]), ref: String(r[5] || ''),
    debit: num_(r[6]), credit: num_(r[7]), mode: String(r[8] || ''), notes: String(r[9] || ''), createdBy: String(r[10] || ''), createdAt: ts_(r[11]),
    status: String(r[12] || 'Active'), cancelReason: String(r[15] || '') };
}
function pinvObj_(r) {
  return { id: String(r[0]), date: formatDate(r[1]), supplierId: String(r[2]), supplierName: String(r[3] || ''), invoiceNo: String(r[4] || ''), lines: num_(r[5]),
    itemsTotal: num_(r[6]), adjustment: num_(r[7]), total: num_(r[8]), paidAmount: num_(r[9]), paymentMode: String(r[10] || ''), paymentRef: String(r[11] || ''),
    notes: String(r[12] || ''), attachmentUrl: String(r[13] || ''), attachmentId: String(r[14] || ''), status: String(r[15] || 'Active'), createdBy: String(r[16] || ''),
    createdAt: ts_(r[17]), cancelReason: String(r[20] || '') };
}
function prObj_(r) {
  return { id: String(r[0]), date: formatDate(r[1]), supplierId: String(r[2]), supplierName: String(r[3] || ''), medicineId: String(r[4]), medicineName: String(r[5] || ''),
    batchId: String(r[6] || ''), batchNo: String(r[7] || ''), qty: num_(r[8]), rate: num_(r[9]), amount: num_(r[10]), reason: String(r[11] || ''),
    createdBy: String(r[12] || ''), createdAt: ts_(r[13]), status: String(r[14] || 'Active') };
}
function getSupplierLedger_(req) {
  var sups = loadSuppliers_(), su = sups.map[str_(req.supplierId, 60)]; if (!su) return fail_('VALIDATION', 'Supplier not found');
  var entries = values_('SupplierLedger').slice(1).filter(function (r) { return r[0] && String(r[2]) === su.id; }).map(slObj_);
  entries.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt < b.createdAt ? -1 : 1); });
  var bal = su.opening;
  entries.forEach(function (e) { if (e.status === 'Active') bal = r2_(bal + e.credit - e.debit); e.balanceAfter = bal; });
  var invoices = values_('PurchaseInvoices').slice(1).filter(function (r) { return r[0] && String(r[2]) === su.id; }).map(pinvObj_);
  var returns = values_('PurchaseReturns').slice(1).filter(function (r) { return r[0] && String(r[2]) === su.id; }).map(prObj_);
  var legacy = values_('Purchases').slice(1).filter(function (r) { return r[0] && !cell_('Purchases', r, 'Invoice ID') && (String(cell_('Purchases', r, 'Supplier ID')) === su.id || String(r[2] || '').trim().toLowerCase() === su.name.toLowerCase()) && String(cell_('Purchases', r, 'Status') || 'Active') !== 'Cancelled'; })
    .map(function (r) { return { id: String(r[0]), date: formatDate(r[1]), medicineName: String(r[4] || ''), qty: num_(r[5]), totalCost: num_(r[7]), invoiceNo: String(cell_('Purchases', r, 'Invoice No') || '') }; });
  var b = supplierBalances_()[su.id] || {};
  return ok_({ supplier: supplierOut_(su, b), entries: entries, invoices: invoices, returns: returns, olderPurchases: legacy });
}

// One supplier invoice with many lines → batches, stock, ledger (+ payment made with it)
function addPurchaseInvoice_(req, s) {
  var id = str_(req.id, 60) || uid_('PINV-');
  if (findRow_('PurchaseInvoices', 'Invoice ID', id) > 0) return ok_({ id: id, duplicate: true });
  var lines = jsonArr_(req.lines);
  if (lines === null) return fail_('VALIDATION', 'Invoice lines are unreadable');
  if (!lines.length) return fail_('VALIDATION', 'Add at least one medicine');
  if (lines.length > 150) return fail_('VALIDATION', 'Too many lines in one invoice (max 150)');
  var invoiceNo = str_(req.invoiceNo, 60), date = formatDate(req.date) || todayStr_();
  if (date > todayStr_()) return fail_('VALIDATION', 'Invoice date cannot be in the future');
  var su = findOrCreateSupplier_(s, req.supplierId, req.supplierName); if (!su) return fail_('VALIDATION', 'Choose or type the supplier');
  if (invoiceNo) {
    var dupInv = values_('PurchaseInvoices').slice(1).filter(function (r) { return r[0] && String(r[2]) === su.id && String(r[4]).trim().toLowerCase() === invoiceNo.toLowerCase() && String(r[15] || 'Active') !== 'Cancelled'; })[0];
    if (dupInv) return fail_('DUPLICATE', 'Invoice ' + invoiceNo + ' from ' + su.name + ' is already entered (' + formatDate(dupInv[1]) + ')');
  }
  var meds = loadMedicines_(), clean = [], itemsTotal = 0;
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i] || {}, med = meds.map[str_(l.medicineId, 60)], n = i + 1;
    if (!med) return fail_('VALIDATION', 'Line ' + n + ': medicine not found — refresh the app');
    var qty = Number(l.qty), free = Number(l.freeQty || 0), cost = Number(l.costPrice), mrp = num_(l.mrp);
    if (!isFinite(qty) || qty <= 0 || Math.floor(qty) !== qty) return fail_('VALIDATION', 'Line ' + n + ' (' + med.name + '): invalid quantity');
    if (!isFinite(free) || free < 0 || Math.floor(free) !== free) return fail_('VALIDATION', 'Line ' + n + ' (' + med.name + '): invalid free quantity');
    if (!isFinite(cost) || cost < 0 || cost > 1000000) return fail_('VALIDATION', 'Line ' + n + ' (' + med.name + '): invalid cost price');
    var exp = l.expiry ? formatDate(l.expiry) : '';
    if (l.expiry && !exp) return fail_('VALIDATION', 'Line ' + n + ' (' + med.name + '): invalid expiry date');
    if (exp && exp < date) return fail_('VALIDATION', 'Line ' + n + ' (' + med.name + '): already expired on ' + exp);
    var lt = r2_(qty * cost); itemsTotal += lt;
    clean.push({ med: med, qty: qty, free: free, cost: r2_(cost), mrp: mrp, batchNo: str_(l.batchNo, 40), expiry: exp, lineTotal: lt });
  }
  itemsTotal = r2_(itemsTotal);
  var adjustment = r2_(req.adjustment), total = r2_(itemsTotal + adjustment);
  if (total < 0) return fail_('VALIDATION', 'Invoice total cannot be negative');
  if (req.total !== undefined && req.total !== '' && Math.abs(num_(req.total) - total) > 0.011) return fail_('VALIDATION', 'Invoice total does not match the lines');
  var paid = r2_(req.paidAmount); if (paid < 0 || paid > total + 0.01) return fail_('VALIDATION', 'Paid amount must be between ₹0 and the invoice total');
  var mode = paid > 0 ? (PAY_MODES[String(req.paymentMode || 'Cash').toLowerCase()] || str_(req.paymentMode, 20) || 'Cash') : '';
  if (paid > 0 && (mode === 'Credit' || mode === 'Split')) return fail_('VALIDATION', 'Choose how the supplier was paid');
  var factor = itemsTotal > 0 ? total / itemsTotal : 1, batchRows = [], purRows = [], mv = [], dt = nowStr_();
  clean.forEach(function (c, k) {
    var batchId = uid_('B-'), pid = id + '-' + (k + 1), totalQty = c.qty + c.free, eff = totalQty ? r2_(c.lineTotal * factor / totalQty) : 0;
    purRows.push(rowFrom_('Purchases', { 'ID': pid, 'Date': date, 'Supplier': su.name, 'Medicine ID': c.med.id, 'Medicine Name': c.med.name, 'Quantity': totalQty,
      'Cost Price': c.cost, 'Total Cost': c.lineTotal, 'Date & Time': dt, 'Batch No': c.batchNo, 'Expiry': c.expiry, 'Batch ID': batchId, 'Status': 'Active',
      'Created By': s.u, 'Invoice No': invoiceNo, 'MRP': c.mrp || '', 'Supplier ID': su.id, 'Invoice ID': id, 'Free Qty': c.free }));
    batchRows.push(newBatchRow_({ batchId: batchId, medicineId: c.med.id, batchNo: c.batchNo, expiry: c.expiry, qty: totalQty, cost: eff, mrp: c.mrp || '', supplier: su.name, purchaseId: pid }));
    mv.push({ med: c.med, batch: batchId, qty: totalQty, ref: pid, note: (c.free ? c.free + ' free · ' : '') + (invoiceNo ? 'Invoice ' + invoiceNo : 'Invoice') });
  });
  appendRows_('PurchaseInvoices', [rowFrom_('PurchaseInvoices', { 'Invoice ID': id, 'Date': date, 'Supplier ID': su.id, 'Supplier Name': su.name, 'Invoice No': invoiceNo,
    'Lines': clean.length, 'Items Total': itemsTotal, 'Adjustment': adjustment, 'Total': total, 'Paid Amount': paid, 'Payment Mode': mode, 'Payment Ref': str_(req.paymentRef, 80),
    'Notes': str_(req.notes, 500), 'Status': 'Active', 'Created By': s.u, 'Created At': dt })]);
  appendRows_('Purchases', purRows);
  appendRows_('Batches', batchRows);
  var batches = loadBatches_(), ids = {};
  clean.forEach(function (c) { ids[c.med.id] = 1; });
  syncMedicineStock_(meds, batches, Object.keys(ids));
  clean.forEach(function (c) { setCells_('Medicines', c.med.row, { 'Cost Price': c.cost }); });
  appendRows_('StockMovements', mv.map(function (m) { return movementRow_(m.med.id, m.med.name, m.batch, m.qty, 'PURCHASE', m.ref, s.u, m.note, meds.map[m.med.id].stock); }));
  var led = [ledgerRow_({ date: date, supplierId: su.id, supplierName: su.name, type: 'PURCHASE', ref: id, credit: total, notes: invoiceNo ? 'Invoice ' + invoiceNo : 'Invoice' }, s)];
  if (paid > 0) led.push(ledgerRow_({ date: date, supplierId: su.id, supplierName: su.name, type: 'PAYMENT', ref: id, debit: paid, mode: mode, notes: 'Paid with invoice' }, s));
  appendRows_('SupplierLedger', led);
  audit_(s, 'addPurchaseInvoice', id, su.name + (invoiceNo ? ' · ' + invoiceNo : '') + ' · ' + clean.length + ' line(s) · ₹' + total + ' · paid ₹' + paid, 'OK');
  return ok_({ id: id, supplierId: su.id, total: total, paid: paid, due: r2_(total - paid) });
}
function cancelPurchaseInvoice_(req, s) {
  var id = str_(req.id, 60), reason = str_(req.reason, 300);
  if (reason.length < 3) return fail_('VALIDATION', 'Please give a reason');
  var row = findRow_('PurchaseInvoices', 'Invoice ID', id); if (row < 0) return fail_('VALIDATION', 'Invoice not found');
  var inv = pinvObj_(sh_('PurchaseInvoices').getRange(row, 1, 1, sh_('PurchaseInvoices').getLastColumn()).getValues()[0]);
  if (inv.status === 'Cancelled') return ok_({ alreadyCancelled: true });
  var pData = values_('Purchases'), lines = [], batches = loadBatches_(), byId = {}; batches.forEach(function (b) { byId[b.batchId] = b; });
  for (var i = 1; i < pData.length; i++) if (String(cell_('Purchases', pData[i], 'Invoice ID')) === id && String(cell_('Purchases', pData[i], 'Status') || 'Active') !== 'Cancelled') lines.push({ rowIndex: i + 1, r: pData[i] });
  var problems = [];
  lines.forEach(function (l) { var b = byId[String(cell_('Purchases', l.r, 'Batch ID'))]; var q = num_(l.r[5]); if (b && b.avail < q - 0.001) problems.push(String(l.r[4]) + ': ' + r2_(q - b.avail) + ' already sold/used'); });
  if (problems.length) return fail_('VALIDATION', 'Cannot cancel — ' + problems.join('; ') + '. Use a purchase return for what is left.');
  var meds = loadMedicines_(), mv = [], touched = {};
  lines.forEach(function (l) {
    var b = byId[String(cell_('Purchases', l.r, 'Batch ID'))], q = num_(l.r[5]), med = meds.map[String(l.r[3])];
    if (b) { b.avail = 0; b.status = 'Cancelled'; b.dirty = true; }
    if (med) { touched[med.id] = 1; mv.push({ med: med, batch: b ? b.batchId : '', qty: -q, ref: String(l.r[0]) }); }
    setCells_('Purchases', l.rowIndex, { 'Status': 'Cancelled', 'Cancelled At': nowStr_(), 'Cancelled By': s.u, 'Cancel Reason': reason });
  });
  saveBatches_(batches); syncMedicineStock_(meds, batches, Object.keys(touched));
  appendRows_('StockMovements', mv.map(function (m) { return movementRow_(m.med.id, m.med.name, m.batch, m.qty, 'PURCHASE_CANCEL', m.ref, s.u, reason, meds.map[m.med.id].stock); }));
  var lData = values_('SupplierLedger');
  for (var j = 1; j < lData.length; j++) {
    var lr = lData[j];
    if (String(lr[5]) === id && String(lr[12] || 'Active') === 'Active' && (String(lr[4]) === 'PURCHASE' || (String(lr[4]) === 'PAYMENT' && String(lr[9]) === 'Paid with invoice')))
      setCells_('SupplierLedger', j + 1, { 'Status': 'Cancelled', 'Cancelled At': nowStr_(), 'Cancelled By': s.u, 'Cancel Reason': reason });
  }
  setCells_('PurchaseInvoices', row, { 'Status': 'Cancelled', 'Cancelled At': nowStr_(), 'Cancelled By': s.u, 'Cancel Reason': reason });
  audit_(s, 'cancelPurchaseInvoice', id, inv.supplierName + ' ' + inv.invoiceNo + ' · ' + reason, 'OK');
  return ok_();
}
var ATTACH_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
function uploadInvoiceAttachment_(req, s) {
  var id = str_(req.invoiceId, 60), row = findRow_('PurchaseInvoices', 'Invoice ID', id); if (row < 0) return fail_('VALIDATION', 'Invoice not found');
  var mime = String(req.mimeType || '').toLowerCase(); if (!ATTACH_TYPES[mime]) return fail_('VALIDATION', 'Only photos (JPG/PNG/WebP) or PDF files');
  var data = String(req.data || '').replace(/^data:[^,]*,/, '');
  if (!data) return fail_('VALIDATION', 'No file received');
  if (data.length > 7000000) return fail_('VALIDATION', 'File is too large (max about 5 MB)');
  var bytes; try { bytes = Utilities.base64Decode(data); } catch (e) { return fail_('VALIDATION', 'File is damaged'); }
  var inv = pinvObj_(sh_('PurchaseInvoices').getRange(row, 1, 1, sh_('PurchaseInvoices').getLastColumn()).getValues()[0]);
  var name = ('Invoice ' + inv.supplierName + ' ' + (inv.invoiceNo || inv.id) + ' ' + inv.date).replace(/[^\w .-]/g, '_').slice(0, 120) + '.' + ATTACH_TYPES[mime];
  var it = DriveApp.getFoldersByName('SSDC Purchase Invoices'), folder = it.hasNext() ? it.next() : DriveApp.createFolder('SSDC Purchase Invoices');
  var file = folder.createFile(Utilities.newBlob(bytes, mime, name));
  setCells_('PurchaseInvoices', row, { 'Attachment URL': file.getUrl(), 'Attachment ID': file.getId() });
  audit_(s, 'uploadInvoiceAttachment', id, name, 'OK');
  return ok_({ url: file.getUrl(), fileId: file.getId() });
}
function purchaseReturn_(req, s) {
  var id = str_(req.id, 60) || uid_('PRET-');
  if (findRow_('PurchaseReturns', 'Return ID', id) > 0) return ok_({ id: id, duplicate: true });
  var reason = str_(req.reason, 300); if (reason.length < 3) return fail_('VALIDATION', 'Please give a reason (e.g. expired, damaged, wrong item)');
  var meds = loadMedicines_(), med = meds.map[str_(req.medicineId, 60)]; if (!med) return fail_('VALIDATION', 'Medicine not found');
  var batches = loadBatches_(), b = batches.filter(function (x) { return x.batchId === str_(req.batchId, 40) && x.medicineId === med.id; })[0];
  if (!b) return fail_('VALIDATION', 'Choose the batch being returned');
  var qty = Number(req.qty); if (!isFinite(qty) || qty <= 0 || Math.floor(qty) !== qty) return fail_('VALIDATION', 'Quantity must be a whole number');
  if (b.avail < qty) return fail_('VALIDATION', 'This batch has only ' + b.avail + ' units');
  var rate = (req.rate === undefined || req.rate === '') ? b.cost : r2_(req.rate); if (rate < 0) return fail_('VALIDATION', 'Invalid rate');
  var su = findOrCreateSupplier_(s, req.supplierId, req.supplierName || b.supplier); if (!su) return fail_('VALIDATION', 'Choose the supplier');
  var amount = r2_(qty * rate), date = formatDate(req.date) || todayStr_();
  b.avail = r2_(b.avail - qty); b.dirty = true;
  saveBatches_(batches); syncMedicineStock_(meds, batches, [med.id]);
  appendRows_('StockMovements', [movementRow_(med.id, med.name, b.batchId, -qty, 'PURCHASE_RETURN', id, s.u, su.name + ' · ' + reason, meds.map[med.id].stock)]);
  appendRows_('PurchaseReturns', [rowFrom_('PurchaseReturns', { 'Return ID': id, 'Date': date, 'Supplier ID': su.id, 'Supplier Name': su.name, 'Medicine ID': med.id,
    'Medicine Name': med.name, 'Batch ID': b.batchId, 'Batch No': b.batchNo, 'Qty': qty, 'Rate': rate, 'Amount': amount, 'Reason': reason,
    'Created By': s.u, 'Created At': nowStr_(), 'Status': 'Active' })]);
  appendRows_('SupplierLedger', [ledgerRow_({ date: date, supplierId: su.id, supplierName: su.name, type: 'RETURN', ref: id, debit: amount, notes: med.name + ' ×' + qty + ' · ' + reason }, s)]);
  audit_(s, 'purchaseReturn', id, su.name + ' · ' + med.name + ' ×' + qty + ' · ₹' + amount + ' · ' + reason, 'OK');
  return ok_({ id: id, amount: amount, stock: meds.map[med.id].stock });
}

// ════════════════════════════════════════════════════════════════════════════
// v3.1 — CLINIC: TREATMENT PRICE LIST, PATIENT TREATMENTS, FOLLOW-UPS, HISTORY
// ════════════════════════════════════════════════════════════════════════════
var DEFAULT_TREATMENTS = [['Consultation', 'Consultation'], ['Scaling & Polishing', 'Preventive'], ['Filling (Composite)', 'Restorative'],
  ['Filling (GIC / Amalgam)', 'Restorative'], ['Root Canal Treatment', 'Endodontics'], ['Pulpectomy (child)', 'Pediatric'], ['Crown (Metal / PFM)', 'Prosthodontics'],
  ['Crown (Zirconia)', 'Prosthodontics'], ['Bridge (per unit)', 'Prosthodontics'], ['Complete Denture', 'Prosthodontics'], ['Partial Denture', 'Prosthodontics'],
  ['Extraction', 'Oral Surgery'], ['Surgical / Wisdom Tooth Extraction', 'Oral Surgery'], ['Flap Surgery', 'Periodontics'], ['Dental Implant', 'Implants'],
  ['Orthodontic Treatment (Braces)', 'Orthodontics'], ['Teeth Whitening', 'Cosmetic'], ['X-Ray (IOPA)', 'Diagnostics']];
var PT_STATUS = ['Planned', 'In progress', 'Completed', 'Cancelled'];
var FU_STATUS = ['Pending', 'Done', 'Cancelled'];
function treatmentMaster_() {
  return values_('TreatmentMaster').slice(1).filter(function (r) { return r[0]; }).map(function (r) {
    return { id: String(r[0]), name: String(r[1] || ''), category: String(r[2] || ''), price: num_(r[3]), duration: num_(r[4]), notes: String(r[5] || ''), status: String(r[6] || 'Active') };
  });
}
function saveTreatment_(req, s) {
  var name = str_(req.name, 120); if (!name) return fail_('VALIDATION', 'Treatment name is required');
  var price = r2_(req.price); if (price < 0 || price > 10000000) return fail_('VALIDATION', 'Invalid price');
  var id = str_(req.id, 60), list = treatmentMaster_();
  if (list.some(function (t) { return t.id !== id && t.status !== 'Inactive' && t.name.toLowerCase() === name.toLowerCase(); })) return fail_('DUPLICATE', name + ' is already in the price list');
  var obj = { 'Name': name, 'Category': str_(req.category, 60), 'Price': price, 'Duration (min)': num_(req.duration) || '', 'Notes': str_(req.notes, 300),
    'Status': str_(req.status, 20) === 'Inactive' ? 'Inactive' : 'Active', 'Updated At': nowStr_(), 'Updated By': s.u };
  var row = id ? findRow_('TreatmentMaster', 'Treatment ID', id) : -1;
  if (row > 0) setCells_('TreatmentMaster', row, obj);
  else { id = id || uid_('TRT-'); obj['Treatment ID'] = id; appendRows_('TreatmentMaster', [rowFrom_('TreatmentMaster', obj)]); }
  audit_(s, 'saveTreatment', id, name + ' · ₹' + price + (obj.Status === 'Inactive' ? ' · inactive' : ''), 'OK');
  return ok_({ id: id });
}
function ptObj_(r) {
  return { id: String(r[0]), date: formatDate(r[1]), patientId: String(r[2] || ''), patientName: String(r[3] || ''), phone: String(r[4] || ''), doctor: String(r[5] || ''),
    treatmentId: String(r[6] || ''), treatment: String(r[7] || ''), tooth: String(r[8] || ''), price: num_(r[9]), status: String(r[10] || 'Planned'),
    notes: String(r[11] || ''), receiptNo: String(r[12] || ''), createdBy: String(r[13] || ''), completedOn: formatDate(r[16]) };
}
function savePatientTreatment_(req, s) {
  var id = str_(req.id, 60); if (!id) return fail_('VALIDATION', 'Record ID required');
  var name = str_(req.patientName, 120); if (!name) return fail_('VALIDATION', 'Patient name is required');
  var status = str_(req.status, 20) || 'Planned'; if (PT_STATUS.indexOf(status) === -1) return fail_('VALIDATION', 'Invalid status');
  var tm = null, tid = str_(req.treatmentId, 60);
  if (tid) tm = treatmentMaster_().filter(function (t) { return t.id === tid; })[0] || null;
  var treatment = str_(req.treatment, 200) || (tm ? tm.name : ''); if (!treatment) return fail_('VALIDATION', 'Choose a treatment');
  var price = (req.price === undefined || req.price === '') ? (tm ? tm.price : 0) : r2_(req.price);
  if (price < 0 || price > 10000000) return fail_('VALIDATION', 'Invalid price');
  var obj = { 'Date': formatDate(req.date) || todayStr_(), 'Patient ID': str_(req.patientId, 60) || linkPatient_(name, req.phone), 'Patient Name': name,
    'Phone': str_(req.phone, 20), 'Doctor': str_(req.doctor, 80), 'Treatment ID': tid, 'Treatment': treatment, 'Tooth': str_(req.tooth, 60), 'Price': price,
    'Status': status, 'Notes': str_(req.notes, 1000), 'Updated At': nowStr_() };
  if (req.receiptNo !== undefined) obj['Receipt No'] = str_(req.receiptNo, 40);
  if (status === 'Completed') obj['Completed On'] = formatDate(req.completedOn) || todayStr_();
  var row = findRow_('PatientTreatments', 'Record ID', id);
  if (row > 0) setCells_('PatientTreatments', row, obj);
  else { obj['Record ID'] = id; obj['Created By'] = s.u; obj['Created At'] = nowStr_(); appendRows_('PatientTreatments', [rowFrom_('PatientTreatments', obj)]); }
  audit_(s, 'savePatientTreatment', id, name + ' · ' + treatment + ' · ' + status + ' · ₹' + price, 'OK');
  return ok_({ id: id });
}
function setPatientTreatmentStatus_(req, s) {
  var row = findRow_('PatientTreatments', 'Record ID', str_(req.id, 60)); if (row < 0) return fail_('VALIDATION', 'Treatment record not found');
  var st = str_(req.status, 20); if (PT_STATUS.indexOf(st) === -1) return fail_('VALIDATION', 'Invalid status');
  var upd = { 'Status': st, 'Updated At': nowStr_() };
  if (st === 'Completed') upd['Completed On'] = todayStr_();
  if (req.receiptNo !== undefined) upd['Receipt No'] = str_(req.receiptNo, 40);
  setCells_('PatientTreatments', row, upd);
  audit_(s, 'setPatientTreatmentStatus', str_(req.id), st, 'OK');
  return ok_();
}
function deletePatientTreatment_(req, s) {
  var row = findRow_('PatientTreatments', 'Record ID', str_(req.id, 60)); if (row < 0) return ok_();
  setCells_('PatientTreatments', row, { 'Status': 'Deleted', 'Updated At': nowStr_() });
  audit_(s, 'deletePatientTreatment', str_(req.id), 'Marked deleted', 'OK');
  return ok_();
}
function linkTreatmentsToReceipt_(ids, receiptNo) {
  var list = jsonArr_(ids) || String(ids).split(',');
  list.forEach(function (id) { var row = findRow_('PatientTreatments', 'Record ID', str_(id, 60)); if (row > 0) setCells_('PatientTreatments', row, { 'Receipt No': receiptNo, 'Updated At': nowStr_() }); });
}
function fuObj_(r) {
  return { id: String(r[0]), patientId: String(r[1] || ''), patientName: String(r[2] || ''), phone: String(r[3] || ''), dueDate: formatDate(r[4]),
    reason: String(r[5] || ''), doctor: String(r[6] || ''), source: String(r[7] || ''), status: String(r[8] || 'Pending'), notes: String(r[9] || ''),
    createdBy: String(r[10] || ''), doneAt: ts_(r[12]), doneBy: String(r[13] || '') };
}
function saveFollowUp_(req, s) {
  var id = str_(req.id, 60); if (!id) return fail_('VALIDATION', 'Follow-up ID required');
  var name = str_(req.patientName, 120); if (!name) return fail_('VALIDATION', 'Patient name is required');
  var due = formatDate(req.dueDate); if (!due) return fail_('VALIDATION', 'Choose the follow-up date');
  var status = str_(req.status, 20) || 'Pending'; if (FU_STATUS.indexOf(status) === -1) return fail_('VALIDATION', 'Invalid status');
  var obj = { 'Patient ID': str_(req.patientId, 60) || linkPatient_(name, req.phone), 'Patient Name': name, 'Phone': str_(req.phone, 20), 'Due Date': due,
    'Reason': str_(req.reason, 300), 'Doctor': str_(req.doctor, 80), 'Source': str_(req.source, 40), 'Status': status, 'Notes': str_(req.notes, 500) };
  var row = findRow_('FollowUps', 'Follow-up ID', id);
  if (row > 0) setCells_('FollowUps', row, obj);
  else { obj['Follow-up ID'] = id; obj['Created By'] = s.u; obj['Created At'] = nowStr_(); appendRows_('FollowUps', [rowFrom_('FollowUps', obj)]); }
  audit_(s, 'saveFollowUp', id, name + ' · ' + due, 'OK');
  return ok_({ id: id });
}
function setFollowUpStatus_(req, s) {
  var row = findRow_('FollowUps', 'Follow-up ID', str_(req.id, 60)); if (row < 0) return fail_('VALIDATION', 'Follow-up not found');
  var st = str_(req.status, 20); if (FU_STATUS.indexOf(st) === -1) return fail_('VALIDATION', 'Invalid status');
  var upd = { 'Status': st };
  if (st === 'Done') { upd['Done At'] = nowStr_(); upd['Done By'] = s.u; }
  if (req.notes !== undefined) upd['Notes'] = str_(req.notes, 500);
  setCells_('FollowUps', row, upd);
  audit_(s, 'setFollowUpStatus', str_(req.id), st, 'OK');
  return ok_();
}
function deleteFollowUp_(req, s) {
  var row = findRow_('FollowUps', 'Follow-up ID', str_(req.id, 60)); if (row < 0) return ok_();
  setCells_('FollowUps', row, { 'Status': 'Deleted' });
  audit_(s, 'deleteFollowUp', str_(req.id), '', 'OK');
  return ok_();
}
var EXAM_FIELDS = [['date', 'Date'], ['patient', 'Patient'], ['age', 'Age'], ['sex', 'Sex'], ['doctor', 'Doctor'], ['phone', 'Phone'], ['swelling', 'Swelling'], ['tmj', 'TMJ'],
  ['lymph', 'Lymph Nodes'], ['oral_hygiene', 'Oral Hygiene'], ['gingiva', 'Gingiva'], ['caries', 'Dental Caries'], ['missing_teeth', 'Missing Teeth'], ['stains', 'Stains'],
  ['calculus', 'Calculus'], ['prov_diag', 'Provisional Diagnosis'], ['final_diag', 'Final Diagnosis'], ['treatments', 'Treatment Plan'], ['tp_notes', 'Treatment Notes'],
  ['upper_teeth', 'Upper Arch'], ['lower_teeth', 'Lower Arch'], ['savedAt', 'Saved At'], ['recordId', 'Record ID'], ['createdBy', 'Created By'], ['patientId', 'Patient ID']];
function examObj_(r) { var o = {}; EXAM_FIELDS.forEach(function (f) { var v = cell_('ExamForms', r, f[1]); o[f[0]] = f[0] === 'date' ? (formatDate(v) || String(v || '')) : (f[0] === 'savedAt' ? ts_(v) : String(v === undefined || v === null ? '' : v)); }); return o; }
function rxObj_(r) {
  return { date: formatDate(r[0]) || String(r[0] || ''), patientName: String(r[1] || ''), age: String(r[2] || ''), sex: String(r[3] || ''), prescription: String(r[4] || ''),
    savedAt: ts_(r[5]), recordId: String(cell_('Prescriptions', r, 'Record ID') || ''), createdBy: String(cell_('Prescriptions', r, 'Created By') || ''),
    patientId: String(cell_('Prescriptions', r, 'Patient ID') || ''), doctor: String(cell_('Prescriptions', r, 'Doctor') || ''), followUpDate: formatDate(cell_('Prescriptions', r, 'Follow-up Date')) };
}
function rcObj_(r, isOwner) {
  var mo = invMoney_('RECEIPT', r);
  return { no: String(r[0] || ''), date: formatDate(r[1]), patient: String(r[2] || ''), doctor: String(r[3] || ''), amount: num_(r[4]), amountWords: String(r[5] || ''),
    treatments: String(r[6] || ''), savedAt: ts_(r[7]), paymentMode: String(cell_('TreatmentReceipts', r, 'Payment Mode') || ''), recordId: String(cell_('TreatmentReceipts', r, 'Record ID') || ''),
    patientId: String(cell_('TreatmentReceipts', r, 'Patient ID') || ''), paidAmount: mo.paid, balanceDue: mo.balance, paymentStatus: mo.status, discount: num_(cell_('TreatmentReceipts', r, 'Discount')) };
}
// Is this record about this patient? Patient ID first; else same name (and same phone when both have one).
function samePatient_(p, recId, recName, recPhone) {
  if (p.id && recId) return String(recId) === String(p.id);
  if (!p.name || String(recName || '').trim().toLowerCase() !== p.name) return false;
  var a = normPhone_(recPhone); return !(a && p.phone && a !== p.phone);
}
function getPatientHistory_(req, s) {
  var p = { id: str_(req.patientId, 60), name: str_(req.name, 120).toLowerCase(), phone: normPhone_(req.phone) };
  if (p.id && (!p.name || !p.phone)) {
    var pr = findRow_('Patients', 'ID', p.id);
    if (pr > 0) { var row = sh_('Patients').getRange(pr, 1, 1, sh_('Patients').getLastColumn()).getValues()[0]; p.name = p.name || String(row[1]).trim().toLowerCase(); p.phone = p.phone || normPhone_(row[2]); }
  }
  if (!p.id && !p.name) return fail_('VALIDATION', 'Choose a patient');
  var isOwner = s.r === OWNER, out = { bills: [], receipts: [], payments: [], prescriptions: [], exams: [], treatments: [], followUps: [], appointments: [] };
  var items = {}, iData = values_('BillItems');
  for (var j = 1; j < iData.length; j++) { var ir = iData[j]; if (ir[0]) (items[String(ir[0])] = items[String(ir[0])] || []).push({ medicineId: String(ir[1]), medicineName: String(ir[2]), qty: num_(ir[3]), price: num_(ir[4]), amount: num_(ir[6]) }); }
  values_('Bills').slice(1).forEach(function (b) {
    if (!b[0] || !samePatient_(p, cell_('Bills', b, 'Patient ID'), b[1], b[3])) return;
    var mo = invMoney_('BILL', b);
    out.bills.push({ billId: String(b[0]), billNo: String(cell_('Bills', b, 'Bill No') || ''), date: formatDate(b[4]), doctor: String(b[2] || ''), total: num_(b[7]),
      discount: num_(b[6]), paymentMode: String(b[9] || ''), status: String(cell_('Bills', b, 'Status') || 'Active'), paidAmount: mo.paid, balanceDue: mo.balance,
      paymentStatus: mo.status, returnedValue: mo.returned, refundedAmount: mo.refunded, items: items[String(b[0])] || [] });
  });
  values_('TreatmentReceipts').slice(1).forEach(function (t) {
    if ((!t[0] && !t[2]) || String(cell_('TreatmentReceipts', t, 'Status') || '') === 'Deleted') return;
    if (samePatient_(p, cell_('TreatmentReceipts', t, 'Patient ID'), t[2], '')) out.receipts.push(rcObj_(t, isOwner));
  });
  paymentsData_().slice(1).forEach(function (r) { if (r[0] && samePatient_(p, r[7], r[8], r[9])) out.payments.push(payObj_(r)); });
  values_('Prescriptions').slice(1).forEach(function (r) {
    if ((!r[1] && !r[4]) || String(cell_('Prescriptions', r, 'Status') || '') === 'Deleted') return;
    if (samePatient_(p, cell_('Prescriptions', r, 'Patient ID'), r[1], '')) out.prescriptions.push(rxObj_(r));
  });
  values_('ExamForms').slice(1).forEach(function (r) {
    if (!r[1] || String(cell_('ExamForms', r, 'Status') || '') === 'Deleted') return;
    if (samePatient_(p, cell_('ExamForms', r, 'Patient ID'), r[1], r[5])) out.exams.push(examObj_(r));
  });
  values_('PatientTreatments').slice(1).forEach(function (r) { if (r[0] && String(r[10]) !== 'Deleted' && samePatient_(p, r[2], r[3], r[4])) out.treatments.push(ptObj_(r)); });
  values_('FollowUps').slice(1).forEach(function (r) { if (r[0] && String(r[8]) !== 'Deleted' && samePatient_(p, r[1], r[2], r[3])) out.followUps.push(fuObj_(r)); });
  values_('Appointments').slice(1).forEach(function (a) {
    if (!a[0] || String(a[7]) === 'Deleted') return;
    if (samePatient_(p, cell_('Appointments', a, 'Patient ID'), a[1], a[2])) out.appointments.push({ id: String(a[0]), date: formatDate(a[3]), time: formatTime(a[4]), reason: String(a[5] || ''), doctor: String(a[6] || ''), status: String(a[7] || '') });
  });
  ['bills', 'receipts', 'payments', 'prescriptions', 'exams', 'treatments', 'appointments'].forEach(function (k) { out[k].sort(function (a, b) { return String(b.date) < String(a.date) ? -1 : String(b.date) > String(a.date) ? 1 : 0; }); });
  out.followUps.sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; });
  out.outstanding = r2_(out.bills.filter(function (b) { return b.status !== 'Cancelled'; }).reduce(function (a, b) { return a + b.balanceDue; }, 0)
    + out.receipts.reduce(function (a, r) { return a + r.balanceDue; }, 0));
  return ok_(out);
}
// Server-side pages of clinic records (newest first). cursor = sheet row to continue below.
function getRecentRecords_(req, s) {
  var kind = str_(req.kind, 20), limit = Math.min(Math.max(parseInt(req.limit, 10) || 50, 1), 200), q = str_(req.q, 60).toLowerCase();
  var sheet = { prescriptions: 'Prescriptions', exams: 'ExamForms', receipts: 'TreatmentReceipts' }[kind]; if (!sheet) return fail_('VALIDATION', 'Unknown record type');
  var data = values_(sheet), start = Math.min(parseInt(req.cursor, 10) || data.length, data.length) - 1, out = [], i;
  var staffFrom = s.r === OWNER ? '' : daysAgoStr_(STAFF_BILL_DAYS);
  for (i = start; i >= 1 && out.length < limit; i--) {
    var r = data[i]; if (String(cell_(sheet, r, 'Status') || '') === 'Deleted') continue;
    var o = kind === 'prescriptions' ? rxObj_(r) : kind === 'exams' ? examObj_(r) : rcObj_(r, s.r === OWNER);
    if (kind === 'prescriptions' && !o.patientName && !o.prescription) continue;
    if (kind === 'exams' && !o.patient) continue;
    if (kind === 'receipts' && (!o.no && !o.patient)) continue;
    if (staffFrom && kind === 'receipts' && o.date < staffFrom) break;
    if (q && JSON.stringify(o).toLowerCase().indexOf(q) === -1) continue;
    out.push(o);
  }
  return ok_({ records: out, cursor: i >= 1 ? i + 1 : 0 });
}
// Older bills, a page at a time (the app keeps only recent ones in memory)
function getBills_(req, s) {
  var before = formatDate(req.before) || '9999-12-31', limit = Math.min(Math.max(parseInt(req.limit, 10) || 100, 1), 300), q = str_(req.q, 60).toLowerCase();
  var isOwner = s.r === OWNER, staffFrom = daysAgoStr_(STAFF_BILL_DAYS), list = [];
  values_('Bills').slice(1).forEach(function (b) {
    if (!b[0]) return; var d = formatDate(b[4]);
    if (d >= before || (!isOwner && d < staffFrom)) return;
    if (q && (String(b[0]) + ' ' + String(cell_('Bills', b, 'Bill No')) + ' ' + b[1] + ' ' + b[3]).toLowerCase().indexOf(q) === -1) return;
    list.push(b);
  });
  list.sort(function (a, b) { var x = formatDate(a[4]), y = formatDate(b[4]); return x < y ? 1 : x > y ? -1 : 0; });
  var page = list.slice(0, limit), ids = {}; page.forEach(function (b) { ids[String(b[0])] = []; });
  values_('BillItems').slice(1).forEach(function (ir) { var k = String(ir[0]); if (ids[k]) ids[k].push(isOwner ? { medicineId: ir[1], medicineName: ir[2], qty: num_(ir[3]), price: num_(ir[4]), costPrice: num_(ir[5]), amount: num_(ir[6]) } : { medicineId: ir[1], medicineName: ir[2], qty: num_(ir[3]), price: num_(ir[4]), amount: num_(ir[6]) }); });
  var bills = page.map(function (b) {
    var mo = invMoney_('BILL', b), o = { billId: String(b[0]), billNo: String(cell_('Bills', b, 'Bill No') || ''), patientName: String(b[1] || ''), doctor: String(b[2] || ''),
      phone: String(b[3] || ''), date: formatDate(b[4]), subtotal: num_(b[5]), discount: num_(b[6]), total: num_(b[7]), paymentMode: String(b[9] || 'Cash'),
      status: String(cell_('Bills', b, 'Status') || 'Active'), paidAmount: mo.paid, balanceDue: mo.balance, paymentStatus: mo.status, returnedValue: mo.returned,
      refundedAmount: mo.refunded, patientId: String(cell_('Bills', b, 'Patient ID') || ''), items: ids[String(b[0])] || [] };
    if (isOwner) o.costTotal = num_(b[8]);
    return o;
  });
  return ok_({ bills: bills, more: list.length > limit, nextBefore: page.length ? bills[bills.length - 1].date : '' });
}

// ════════════════════════════════════════════════════════════════════════════
// v3.1 — INVENTORY REPORTS, REPORT DATA FOR ANY PERIOD
// ════════════════════════════════════════════════════════════════════════════
function mvObj_(r) {
  return { id: String(r[0]), at: ts_(r[1]), medicineId: String(r[2]), medicineName: String(r[3] || ''), batchId: String(r[4] || ''), qty: num_(r[5]),
    type: String(r[6] || ''), ref: String(r[7] || ''), user: String(r[8] || ''), reason: String(r[9] || ''), stockAfter: num_(r[10]) };
}
function getBatchHistory_(req) {
  var mid = str_(req.medicineId, 60), med = loadMedicines_().map[mid]; if (!med) return fail_('VALIDATION', 'Medicine not found');
  var today = todayStr_();
  var batches = loadBatches_().filter(function (b) { return b.medicineId === mid; }).sort(fefoSort_).map(function (b) {
    return { batchId: b.batchId, batchNo: b.batchNo, expiry: b.expiry, received: b.received, available: b.avail, cost: b.cost, mrp: b.mrp, supplier: b.supplier,
      purchaseId: b.purchaseId, receivedAt: b.receivedAt, status: b.status, expired: !!(b.expiry && b.expiry < today) };
  });
  var movements = values_('StockMovements').slice(1).filter(function (r) { return r[0] && String(r[2]) === mid; }).map(mvObj_).reverse();
  var sums = {}; movements.forEach(function (m) { sums[m.type] = r2_((sums[m.type] || 0) + m.qty); });
  return ok_({ medicine: { id: med.id, name: med.name, price: med.price, costPrice: med.costPrice, barcode: med.barcode }, batches: batches, movements: movements, totals: sums });
}
function getInventoryReport_(req) {
  var today = todayStr_(), deadDays = Math.max(parseInt(req.deadDays, 10) || 90, 7), deadFrom = daysAgoStr_(deadDays), d30 = daysAgoStr_(30), d90 = daysAgoStr_(90), soon = Utilities.formatDate(new Date(Date.now() + 90 * 86400000), tz_(), 'yyyy-MM-dd');
  var meds = loadMedicines_(), batches = loadBatches_(), bById = {}; batches.forEach(function (b) { bById[b.batchId] = b; });
  var stat = {};
  meds.list.forEach(function (m) { if (m.status !== 'Inactive') stat[m.id] = { id: m.id, name: m.name, price: m.price, minStock: m.minStock, category: m.category, sellable: 0, expired: 0, costValue: 0, saleValue: 0, expiredValue: 0, lastSale: '', sold30: 0, sold90: 0, firstIn: '', expiringSoon: 0, expiringValue: 0 }; });
  batches.forEach(function (b) {
    var o = stat[b.medicineId]; if (!o || b.status !== 'Active') return;
    var known = b.purchaseId || ['OPENING', 'ADJUSTMENT', 'RETURN'].indexOf(b.batchNo) === -1;   // age of opening/found stock is unknown
    var rd = known ? String(b.receivedAt || '').slice(0, 10) : ''; if (rd && (!o.firstIn || rd < o.firstIn)) o.firstIn = rd;
    if (b.avail <= 0) return;
    if (b.expiry && b.expiry < today) { o.expired += b.avail; o.expiredValue += b.avail * b.cost; }
    else { o.sellable += b.avail; o.costValue += b.avail * b.cost; o.saleValue += b.avail * o.price; if (b.expiry && b.expiry <= soon) { o.expiringSoon += b.avail; o.expiringValue += b.avail * b.cost; } }
  });
  // sales from the bills themselves (covers bills from before the stock register)
  var billDate = {};
  values_('Bills').slice(1).forEach(function (b) { if (b[0] && String(cell_('Bills', b, 'Status') || 'Active') !== 'Cancelled') billDate[String(b[0])] = formatDate(b[4]); });
  values_('BillItems').slice(1).forEach(function (ir) {
    var d = billDate[String(ir[0])], o = stat[String(ir[1])]; if (!d || !o) return;
    var q = num_(ir[3]); if (d > o.lastSale) o.lastSale = d; if (d >= d30) o.sold30 += q; if (d >= d90) o.sold90 += q;
  });
  var lossByMonth = {}, lossByMed = {}, lossTotal = 0, lossRows = [];
  values_('StockMovements').slice(1).forEach(function (r) {
    if (!r[0]) return;
    var t = String(r[6]), d = ts_(r[1]).slice(0, 10), mid = String(r[2]), q = num_(r[5]), o = stat[mid];
    if (t === 'CUSTOMER_RETURN' && o) { if (d >= d30) o.sold30 -= q; if (d >= d90) o.sold90 -= q; }
    if ((t === 'EXPIRED' || t === 'DAMAGED') && q < 0) {
      var b = bById[String(r[4])], m = meds.map[mid], cost = b ? b.cost : (m ? m.costPrice : 0), v = r2_(-q * cost), mon = d.slice(0, 7);
      lossByMonth[mon] = r2_((lossByMonth[mon] || 0) + v); lossByMed[String(r[3])] = r2_((lossByMed[String(r[3])] || 0) + v); lossTotal += v;
      lossRows.push({ date: d, medicineName: String(r[3]), type: t, qty: -q, value: v, reason: String(r[9] || ''), batchId: String(r[4] || '') });
    }
  });
  var list = Object.keys(stat).map(function (k) {
    var o = stat[k]; ['sellable', 'expired', 'costValue', 'saleValue', 'expiredValue', 'expiringValue'].forEach(function (f) { o[f] = r2_(o[f]); });
    o.sold30 = r2_(o.sold30); o.sold90 = r2_(o.sold90);
    var perDay = o.sold90 / 90; o.daysCover = perDay > 0 ? Math.round(o.sellable / perDay) : (o.sellable > 0 ? null : 0);
    o.dead = o.sellable > 0 && (!o.lastSale || o.lastSale < deadFrom) && (!o.firstIn || o.firstIn < deadFrom);
    o.slow = !o.dead && o.sellable > 0 && o.sold90 > 0 && o.daysCover > 180;
    return o;
  });
  var tot = { costValue: 0, saleValue: 0, expiredValue: 0, expiringValue: 0, deadValue: 0 };
  list.forEach(function (o) { tot.costValue += o.costValue; tot.saleValue += o.saleValue; tot.expiredValue += o.expiredValue; tot.expiringValue += o.expiringValue; if (o.dead) tot.deadValue += o.costValue; });
  Object.keys(tot).forEach(function (k) { tot[k] = r2_(tot[k]); });
  return ok_({ today: today, deadDays: deadDays, medicines: list, totals: tot,
    expiryLoss: { total: r2_(lossTotal), byMonth: lossByMonth, byMedicine: lossByMed, rows: lossRows.reverse().slice(0, 500) } });
}
// Everything a report needs for one period (owner). Cached until the data changes.
function getReportData_(req, s) {
  var from = formatDate(req.from), to = formatDate(req.to);
  if (!from || !to || to < from) return fail_('VALIDATION', 'Choose a valid period');
  var span = (new Date(to) - new Date(from)) / 86400000; if (span > 1100) return fail_('VALIDATION', 'Choose a period of at most 3 years');
  return cachedJson_('RD_' + from + '_' + to, function () { return buildReportData_(from, to); });
}
function cachedJson_(key, build) {
  var c = cache_(), prefix = key + '_' + getDataVersion_() + '_', ver = getDataVersion_();
  try {
    var n = parseInt(c.get(prefix + 'n'), 10);
    if (n > 0) { var keys = []; for (var k = 0; k < n; k++) keys.push(prefix + k); var got = c.getAll(keys), parts = [];
      for (var k2 = 0; k2 < n; k2++) { if (got[keys[k2]] == null) { parts = null; break; } parts.push(got[keys[k2]]); } if (parts) return { __raw: parts.join('') }; }
  } catch (e) {}
  var json = JSON.stringify(build());
  if (getDataVersion_() === ver) {
    try { var entries = {}, count = 0; for (var p = 0; p < json.length; p += CACHE_CHUNK) entries[prefix + (count++)] = json.substring(p, p + CACHE_CHUNK);
      entries[prefix + 'n'] = String(count); c.putAll(entries, CACHE_TTL_SECONDS); } catch (e2) {}
  }
  return { __raw: json };
}
function buildReportData_(from, to) {
  var inR = function (d) { return d >= from && d <= to; };
  var items = {}, iData = values_('BillItems');
  for (var j = 1; j < iData.length; j++) { var ir = iData[j]; if (ir[0]) (items[String(ir[0])] = items[String(ir[0])] || []).push({ medicineId: String(ir[1]), medicineName: String(ir[2]), qty: num_(ir[3]), price: num_(ir[4]), costPrice: num_(ir[5]), amount: num_(ir[6]) }); }
  var bills = [];
  values_('Bills').slice(1).forEach(function (b) {
    if (!b[0] || !inR(formatDate(b[4]))) return;
    var mo = invMoney_('BILL', b);
    bills.push({ billId: String(b[0]), billNo: String(cell_('Bills', b, 'Bill No') || ''), patientName: String(b[1] || ''), doctor: String(b[2] || ''), phone: String(b[3] || ''),
      date: formatDate(b[4]), subtotal: num_(b[5]), discount: num_(b[6]), total: num_(b[7]), costTotal: num_(b[8]), paymentMode: String(b[9] || 'Cash'),
      cashAmount: num_(cell_('Bills', b, 'Cash Amount')), upiAmount: num_(cell_('Bills', b, 'UPI Amount')), cardAmount: num_(cell_('Bills', b, 'Card Amount')),
      status: String(cell_('Bills', b, 'Status') || 'Active'), createdBy: String(cell_('Bills', b, 'Created By') || ''), paidAmount: mo.paid, balanceDue: mo.balance,
      paymentStatus: mo.status, returnedValue: mo.returned, refundedAmount: mo.refunded, patientId: String(cell_('Bills', b, 'Patient ID') || ''), items: items[String(b[0])] || [] });
  });
  var receipts = values_('TreatmentReceipts').slice(1).filter(function (t) { return (t[0] || t[2]) && String(cell_('TreatmentReceipts', t, 'Status') || '') !== 'Deleted' && inR(formatDate(t[1])); }).map(function (t) { return rcObj_(t, true); });
  var payments = paymentsData_().slice(1).filter(function (r) { return r[0] && inR(formatDate(r[2])); }).map(payObj_);
  var expenses = readExpenses_().filter(function (e) { return inR(e.date); });
  var purchases = values_('Purchases').slice(1).filter(function (r) { return r[0] && inR(formatDate(r[1])) && String(cell_('Purchases', r, 'Status') || 'Active') !== 'Cancelled'; }).map(function (r) {
    return { id: String(r[0]), date: formatDate(r[1]), supplier: String(r[2] || ''), supplierId: String(cell_('Purchases', r, 'Supplier ID') || ''), medicineId: String(r[3]), medicineName: String(r[4] || ''),
      qty: num_(r[5]), freeQty: num_(cell_('Purchases', r, 'Free Qty')), costPrice: num_(r[6]), totalCost: num_(r[7]), invoiceNo: String(cell_('Purchases', r, 'Invoice No') || ''), invoiceId: String(cell_('Purchases', r, 'Invoice ID') || '') };
  });
  var invoices = values_('PurchaseInvoices').slice(1).filter(function (r) { return r[0] && inR(formatDate(r[1])); }).map(pinvObj_);
  var returns = values_('PurchaseReturns').slice(1).filter(function (r) { return r[0] && inR(formatDate(r[1])); }).map(prObj_);
  var ledger = values_('SupplierLedger').slice(1).filter(function (r) { return r[0] && inR(formatDate(r[1])); }).map(slObj_);
  var closings = closingsData_().filter(function (c) { return inR(c.date); });
  var batches = loadBatches_(), bCost = {}; batches.forEach(function (b) { bCost[b.batchId] = b.cost; });
  var medCost = {}; loadMedicines_().list.forEach(function (m) { medCost[m.id] = m.costPrice; });
  var stockLoss = values_('StockMovements').slice(1).filter(function (r) { var t = String(r[6]); return r[0] && (t === 'EXPIRED' || t === 'DAMAGED' || t === 'ADJUSTMENT' || t === 'OPENING') && inR(ts_(r[1]).slice(0, 10)); })
    .map(function (r) { var o = mvObj_(r); o.date = o.at.slice(0, 10); o.value = r2_(o.qty * (bCost[o.batchId] !== undefined ? bCost[o.batchId] : (medCost[o.medicineId] || 0))); return o; });
  return { success: true, from: from, to: to, bills: bills, receipts: receipts, payments: payments, expenses: expenses, purchases: purchases, purchaseInvoices: invoices,
    purchaseReturns: returns, supplierLedger: ledger, cashClosings: closings, stockChanges: stockLoss, treatments: values_('PatientTreatments').slice(1).filter(function (r) { return r[0] && String(r[10]) !== 'Deleted' && inR(formatDate(r[1])); }).map(ptObj_) };
}

// ════════════════════════════════════════════════════════════════════════════
// v3.1 — HEALTH CHECK + RESTORE DRILL
// ════════════════════════════════════════════════════════════════════════════
function healthCheck_(req, s) {
  var checks = [], add = function (name, ok, detail) { checks.push({ name: name, ok: !!ok, detail: detail || '' }); };
  var schema = schemaVersion_();
  add('Server version', true, VERSION);
  add('Database tables up to date', schema >= SCHEMA_VERSION, schema >= SCHEMA_VERSION ? 'schema ' + schema : 'schema ' + schema + ' — run migrateToV31');
  var missing = [];
  Object.keys(BASE_HEADERS).forEach(function (n) { if (!sh_(n)) missing.push(n); });
  add('All tabs present', !missing.length, missing.length ? 'missing: ' + missing.join(', ') : Object.keys(BASE_HEADERS).length + ' tabs');
  var missCols = [];
  Object.keys(EXTRA_COLS).forEach(function (n) { if (!sh_(n)) return; var map = hdr_(n); EXTRA_COLS[n].forEach(function (c) { if (!map[c]) missCols.push(n + '.' + c); }); });
  add('All columns present', !missCols.length, missCols.length ? missCols.slice(0, 12).join(', ') : 'OK');
  var trig = []; try { trig = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }); } catch (e) {}
  add('Daily backup scheduled', trig.indexOf('scheduledBackup') !== -1, trig.indexOf('scheduledBackup') !== -1 ? '~2 AM daily' : 'run installTriggers');
  add('Daily stock e-mail scheduled', trig.indexOf('sendDailyStockReport') !== -1, trig.indexOf('sendDailyStockReport') !== -1 ? '~8 AM daily' : 'run installTriggers');
  var last = null; try { last = JSON.parse(props_().getProperty('LAST_BACKUP') || 'null'); } catch (e2) {}
  var age = last && last.at ? (Date.now() - new Date(String(last.at).replace(' ', 'T') + '+05:30').getTime()) / 3600000 : null;
  add('Recent verified backup', last && last.verified && age !== null && age < 36, last ? (last.at + (last.verified ? ' · verified' : ' · NOT verified') + (age !== null ? ' · ' + Math.round(age) + ' h ago' : '')) : 'no backup yet');
  var drill = null; try { drill = JSON.parse(props_().getProperty('LAST_RESTORE_DRILL') || 'null'); } catch (e3) {}
  add('Restore drill passed', drill && drill.ok, drill ? drill.at + (drill.ok ? ' · backup opened and gave identical data' : ' · FAILED: ' + (drill.problems || []).join('; ')) : 'never run — Settings → Run restore drill');
  var owners = usersData_().slice(1).filter(function (r) { return String(r[1]).toUpperCase() === OWNER && bool_(r[4]); }).length;
  add('Owner login active', owners > 0, owners + ' owner account(s)');
  var weak = usersData_().slice(1).filter(function (r) { return bool_(r[4]) && bool_(r[5]); }).map(function (r) { return String(r[0]); });
  add('No one still on a temporary password', !weak.length, weak.length ? weak.join(', ') + ' must set a password' : 'OK');
  var issues = validateData_().count;
  add('Data check', issues === 0, issues ? issues + ' issue(s) — Settings → Data check' : 'no problems');
  var rows = {}; ss_().getSheets().forEach(function (sh) { rows[sh.getName()] = Math.max(0, sh.getLastRow() - 1); });
  return ok_({ ok: checks.every(function (c) { return c.ok; }), checks: checks, rows: rows, version: VERSION, schema: schema, checkedAt: nowStr_() });
}
// Proves a backup can really be used: copy the spreadsheet, check every cell, then
// run the app's own loader on the copy and compare with the live data.
function restoreDrillCore_() {
  var problems = [], cells = 0;
  var liveData = buildAllData_(OWNER), b = backupNow_('drill');
  var copy = SpreadsheetApp.openById(b.fileId);
  ss_().getSheets().forEach(function (sh) {
    var c = copy.getSheetByName(sh.getName()); if (!c) { problems.push('missing tab ' + sh.getName()); return; }
    var a1 = JSON.stringify(sh.getLastRow() ? sh.getDataRange().getValues() : []), a2 = JSON.stringify(c.getLastRow() ? c.getDataRange().getValues() : []);
    if (a1 !== a2) problems.push(sh.getName() + ' cells differ'); else cells += sh.getLastRow() * Math.max(sh.getLastColumn(), 1);
  });
  var savedSs = _ss, savedHdr = _hdr, copyData;
  try { _ss = copy; _hdr = {}; copyData = buildAllData_(OWNER); } finally { _ss = savedSs; _hdr = savedHdr; }
  ['serverTime'].forEach(function (k) { delete liveData[k]; delete copyData[k]; });
  if (JSON.stringify(liveData) !== JSON.stringify(copyData)) problems.push('app data from the backup is not identical');
  var result = { at: nowStr_(), ok: problems.length === 0, backup: b.name, backupUrl: b.url, cells: cells, problems: problems,
    bills: (liveData.bills || []).length, medicines: (liveData.medicines || []).length, patients: (liveData.patients || []).length };
  props_().setProperty('LAST_RESTORE_DRILL', JSON.stringify(result));
  return result;
}
function restoreDrill_(req, s) {
  try { var r = restoreDrillCore_(); audit_(s, 'restoreDrill', r.backup, r.ok ? 'OK · ' + r.cells + ' cells' : r.problems.join('; '), r.ok ? 'OK' : 'ERROR'); return ok_({ drill: r }); }
  catch (err) { audit_(s, 'restoreDrill', '', String(err), 'ERROR'); return fail_('DRILL_FAILED', String(err.message || err)); }
}
function restoreDrill() { Logger.log(JSON.stringify(restoreDrillCore_(), null, 2)); }   // run from the editor

// ════════════════════════════════════════════════════════════════════════════
// MIGRATION v3.0 → v3.1 (run from the editor; additive; safe to re-run)
// ════════════════════════════════════════════════════════════════════════════
function blankCount_(name, col, keyCol) {
  if (!sh_(name)) return 0;
  var data = values_(name), c = colOf_(name, col), k = keyCol ? colOf_(name, keyCol) : 1, n = 0;
  for (var i = 1; i < data.length; i++) if ((data[i][k - 1] || data[i][0] || data[i][2]) && (!c || data[i][c - 1] === '' || data[i][c - 1] === null)) n++;
  return n;
}
function newSupplierNames_() {
  var have = {}; loadSuppliers_().list.forEach(function (x) { have[x.name.trim().toLowerCase()] = 1; });
  var names = {}, out = [];
  values_('Purchases').slice(1).forEach(function (r) { var n = String(r[2] || '').trim(); if (n && !have[n.toLowerCase()] && !names[n.toLowerCase()]) { names[n.toLowerCase()] = 1; out.push(n); } });
  return out;
}
function migrationPlanV31_() {
  var plan = [];
  if (schemaVersion_() < 3) plan.push('⚠️ This spreadsheet is not on v3 yet — run migrateToV3 first.');
  V31_SHEETS.forEach(function (n) { if (!sh_(n)) plan.push('Create tab ' + n); });
  Object.keys(EXTRA_COLS_V31).forEach(function (n) {
    if (!sh_(n)) return; var map = hdr_(n), missing = EXTRA_COLS_V31[n].filter(function (c) { return !map[c]; });
    if (missing.length) plan.push('Add columns to ' + n + ': ' + missing.join(', '));
  });
  var nb = blankCount_('Bills', 'Paid Amount'); if (nb) plan.push('Mark ' + nb + ' existing bill(s) as paid in full (Paid Amount = Total, Balance Due = 0)');
  var nr = blankCount_('TreatmentReceipts', 'Paid Amount'); if (nr) plan.push('Mark ' + nr + ' existing dental receipt(s) as paid in full');
  var sn = newSupplierNames_(); if (sn.length) plan.push('Create ' + sn.length + ' supplier(s) from purchase history: ' + sn.slice(0, 10).join(', ') + (sn.length > 10 ? '…' : '') + ' (opening balance ₹0 — old purchases count as paid)');
  if (!sh_('TreatmentMaster') || sh_('TreatmentMaster').getLastRow() < 2) plan.push('Create a treatment price list with ' + DEFAULT_TREATMENTS.length + ' common treatments (price ₹0 — enter your prices in Settings)');
  plan.push('Create a secret key for encrypting patient data cached on phones/PCs (stays on the server)');
  plan.push('Existing rows and columns are never deleted, moved or changed. A verified backup copy is made first.');
  return plan;
}
function migrateToV31DryRun() { Logger.log('MIGRATION v3.1 PLAN (nothing changed):\n• ' + migrationPlanV31_().join('\n• ')); }
function fillMoneyCols_(name, totalCol) {
  var sh = sh_(name); if (!sh || sh.getLastRow() < 2) return 0;
  _hdr = {};
  var n = sh.getLastRow() - 1, cols = ['Paid Amount', 'Balance Due', 'Payment Status', 'Returned Value', 'Refunded Amount'].map(function (c) { return colOf_(name, c); });
  var tot = sh.getRange(2, colOf_(name, totalCol), n, 1).getValues(), key = sh.getRange(2, 1, n, 3).getValues();
  var ranges = cols.map(function (c) { return sh.getRange(2, c, n, 1); }), vals = ranges.map(function (r) { return r.getValues(); }), filled = 0;
  for (var i = 0; i < n; i++) {
    if (!(key[i][0] || key[i][2]) || vals[0][i][0] !== '') continue;
    var t = r2_(tot[i][0]); vals[0][i][0] = t; vals[1][i][0] = 0; vals[2][i][0] = 'Paid'; vals[3][i][0] = 0; vals[4][i][0] = 0; filled++;
  }
  if (filled) ranges.forEach(function (r, k) { r.setValues(vals[k]); });
  return filled;
}
function migrateToV31() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    if (schemaVersion_() < 3) throw new Error('Run migrateToV3 first (this spreadsheet is not on v3 yet).');
    var plan = migrationPlanV31_();
    Logger.log('Plan:\n• ' + plan.join('\n• '));
    var backup = backupNow_('pre-migration');     // throws (and stops) if the backup can't be verified
    Logger.log('Backup OK: ' + backup.url);
    V31_SHEETS.forEach(function (n) { getOrCreateSheet(n, BASE_HEADERS[n]); });
    Object.keys(EXTRA_COLS_V31).forEach(function (n) { if (sh_(n)) ensureCols_(n, EXTRA_COLS[n]); });
    _hdr = {};
    var fb = fillMoneyCols_('Bills', 'Total'), fr = fillMoneyCols_('TreatmentReceipts', 'Amount');
    // suppliers from purchase history; link old purchases to them
    var created = newSupplierNames_();
    if (created.length) appendRows_('Suppliers', created.map(function (n) { return rowFrom_('Suppliers', { 'Supplier ID': uid_('SUP-'), 'Name': n, 'Opening Balance': 0, 'Status': 'Active', 'Created At': nowStr_(), 'Created By': 'system', 'Updated At': nowStr_() }); }));
    var sups = loadSuppliers_(), ps = sh_('Purchases');
    if (ps.getLastRow() > 1) {
      var n = ps.getLastRow() - 1, names = ps.getRange(2, 3, n, 1).getValues(), idR = ps.getRange(2, colOf_('Purchases', 'Supplier ID'), n, 1), ids = idR.getValues(), ch = false;
      for (var i = 0; i < n; i++) if (!ids[i][0] && names[i][0]) { var su = findSupplierByName_(sups.list, names[i][0]); if (su) { ids[i][0] = su.id; ch = true; } }
      if (ch) idR.setValues(ids);
    }
    if (sh_('TreatmentMaster').getLastRow() < 2)
      appendRows_('TreatmentMaster', DEFAULT_TREATMENTS.map(function (t) { return rowFrom_('TreatmentMaster', { 'Treatment ID': uid_('TRT-'), 'Name': t[0], 'Category': t[1], 'Price': 0, 'Status': 'Active', 'Updated At': nowStr_(), 'Updated By': 'system' }); }));
    localKeySecret_();
    props_().setProperty('SCHEMA_VERSION', String(SCHEMA_VERSION));
    bumpDataVersion_();
    audit_({ u: 'system', r: 'SYSTEM' }, 'migrateToV31', '', 'bills marked paid: ' + fb + ' · receipts: ' + fr + ' · suppliers created: ' + created.length + ' | backup ' + backup.fileId, 'OK');
    Logger.log('✅ v3.1 update complete. Backup: ' + backup.url + '\nNow: Deploy → Manage deployments → Edit → New version → Deploy.');
  } finally { lock.releaseLock(); }
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
  getAuditLog: getAuditLog_, backupNow: backupNowApi_, listBackups: listBackups_, validateData: validateData_,
  // v3.1
  recordPayment: recordPayment_, cancelPayment: cancelPayment_, returnRefund: returnRefund_, getPayments: getPayments_,
  getCashSummary: getCashSummary_, saveCashClosing: saveCashClosing_, getCashClosings: getCashClosings_,
  saveSupplier: saveSupplier_, deleteSupplier: deleteSupplier_, recordSupplierPayment: recordSupplierPayment_, cancelSupplierEntry: cancelSupplierEntry_,
  getSupplierLedger: getSupplierLedger_, addPurchaseInvoice: addPurchaseInvoice_, cancelPurchaseInvoice: cancelPurchaseInvoice_,
  uploadInvoiceAttachment: uploadInvoiceAttachment_, purchaseReturn: purchaseReturn_,
  saveTreatment: saveTreatment_, savePatientTreatment: savePatientTreatment_, setPatientTreatmentStatus: setPatientTreatmentStatus_, deletePatientTreatment: deletePatientTreatment_,
  saveFollowUp: saveFollowUp_, setFollowUpStatus: setFollowUpStatus_, deleteFollowUp: deleteFollowUp_,
  getPatientHistory: getPatientHistory_, getRecentRecords: getRecentRecords_, getBills: getBills_,
  getBatchHistory: getBatchHistory_, getInventoryReport: getInventoryReport_, getReportData: getReportData_,
  healthCheck: healthCheck_, restoreDrill: restoreDrill_
};
