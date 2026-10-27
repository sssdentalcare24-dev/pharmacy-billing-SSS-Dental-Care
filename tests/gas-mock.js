// In-memory simulation of the Google Apps Script services used by Code.gs.
// Lets the real backend code run in Node for automated tests.
'use strict';
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const path = require('path');

function createGas(opts = {}) {
  const TZ = 'Asia/Kolkata';
  const spreadsheets = {};          // id → Spreadsheet
  const driveFiles = {};            // id → {name, folder, trashed}
  const folders = {};               // name → folder
  const props = {};
  const cache = {};                 // key → {v, exp}
  const mails = [];
  const logs = [];
  const triggers = [];
  const stats = { reads: 0, writes: 0 };
  let failNextCopy = false;

  // ── Sheets ──
  class Range {
    constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
    getValues() {
      stats.reads++;
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = this.sheet.rows[this.r - 1 + i] || [];
        const o = [];
        for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v === undefined || v === null ? '' : v); }
        out.push(o);
      }
      return out;
    }
    setValues(vals) {
      stats.writes++;
      if (vals.length !== this.nr || vals.some(r => r.length !== this.nc)) throw new Error(`setValues size mismatch on ${this.sheet.name}: range ${this.nr}x${this.nc}, data ${vals.length}x${vals[0] && vals[0].length}`);
      vals.forEach((row, i) => row.forEach((v, j) => {
        const R = this.r - 1 + i; this.sheet.rows[R] = this.sheet.rows[R] || [];
        this.sheet.rows[R][this.c - 1 + j] = v;
      }));
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
    getValue() { return this.getValues()[0][0]; }
    setNumberFormat() { return this; } setBackground() { return this; } setFontColor() { return this; } setFontWeight() { return this; }
  }
  class Sheet {
    constructor(name, rows) { this.name = name; this.rows = rows || []; }
    getName() { return this.name; }
    getLastRow() { for (let i = this.rows.length - 1; i >= 0; i--) if ((this.rows[i] || []).some(v => v !== '' && v !== undefined && v !== null)) return i + 1; return 0; }
    getLastColumn() { let m = 0; this.rows.forEach(r => (r || []).forEach((v, j) => { if (v !== '' && v !== undefined && v !== null) m = Math.max(m, j + 1); })); return m; }
    getRange(r, c, nr = 1, nc = 1) { if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error(`bad range ${r},${c},${nr},${nc} on ${this.name}`); return new Range(this, r, c, nr, nc); }
    getDataRange() { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
    appendRow(row) { stats.writes++; this.rows[this.getLastRow()] = row.slice(); return this; }
    deleteRow(i) { stats.writes++; this.rows.splice(i - 1, 1); }
    setFrozenRows() {}
  }
  class Spreadsheet {
    constructor(id, sheets) { this.id = id; this.sheets = sheets || []; }
    getId() { return this.id; }
    getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
    insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
    getSheets() { return this.sheets.slice(); }
  }
  function addSpreadsheet(id, data) {
    const s = new Spreadsheet(id, Object.entries(data || {}).map(([n, rows]) => new Sheet(n, rows.map(r => r.slice()))));
    spreadsheets[id] = s; driveFiles[id] = { name: 'SSDC data', folder: null, trashed: false };
    return s;
  }
  function cloneSpreadsheet(src, newId) {
    const s = new Spreadsheet(newId, src.sheets.map(sh => new Sheet(sh.name, sh.rows.map(r => (r || []).slice()))));
    spreadsheets[newId] = s; return s;
  }

  // ── Drive ──
  function iter(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }
  function fileObj(id) {
    return {
      getId: () => id, getName: () => driveFiles[id].name, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
      setTrashed: (t) => { driveFiles[id].trashed = !!t; },
      makeCopy: (name, folder) => {
        if (failNextCopy) { failNextCopy = false; throw new Error('Drive quota exceeded (simulated)'); }
        const nid = 'COPY_' + crypto.randomBytes(6).toString('hex');
        cloneSpreadsheet(spreadsheets[id], nid);
        driveFiles[nid] = { name, folder: folder ? folder.name : null, trashed: false };
        return fileObj(nid);
      }
    };
  }
  function folderObj(name) {
    folders[name] = folders[name] || { name };
    return { name, getFiles: () => iter(Object.keys(driveFiles).filter(id => driveFiles[id].folder === name && !driveFiles[id].trashed).map(fileObj)),
      createFile: (blob) => { const id = 'FILE_' + crypto.randomBytes(6).toString('hex'); driveFiles[id] = { name: blob.name, folder: name, trashed: false, blob }; return fileObj(id); } };
  }

  // ── Utilities ──
  function fmt(d, tz, pattern) {
    const parts = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .formatToParts(d).forEach(p => { parts[p.type] = p.value; });
    if (parts.hour === '24') parts.hour = '00';
    const H = parseInt(parts.hour, 10), h12 = H % 12 || 12;
    const mon = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'short' }).format(d);
    return pattern.replace('yyyy', parts.year).replace('MMM', mon).replace('MM', parts.month).replace('dd', parts.day)
      .replace('HH', parts.hour).replace('hh', String(h12).padStart(2, '0')).replace('mm', parts.minute).replace('ss', parts.second)
      .replace(/\ba\b/, H < 12 ? 'AM' : 'PM');
  }
  const Utilities = {
    formatDate: (d, tz, p) => fmt(d, tz, p),
    getUuid: () => crypto.randomUUID(),
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, value) => Array.from(crypto.createHash('sha256').update(String(value), 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
    computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac('sha256', String(key)).update(String(value), 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
    base64Encode: (bytes) => Buffer.from((typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes.map(b => b < 0 ? b + 256 : b))).toString('base64'),
    base64Decode: (str) => { if (!/^[A-Za-z0-9+/=\s]*$/.test(str)) throw new Error('Could not decode string.'); return Array.from(Buffer.from(str, 'base64')).map(b => b > 127 ? b - 256 : b); },
    newBlob: (bytes, mime, name) => ({ bytes, mime, name, getBytes: () => bytes, getContentType: () => mime, getName: () => name }),
  };

  const sandbox = {
    console, JSON, Math, Date, String, Number, Array, Object, RegExp, Error, isFinite, isNaN, parseInt, parseFloat, encodeURIComponent,
    SpreadsheetApp: { openById: (id) => { if (!spreadsheets[id]) throw new Error('Spreadsheet not found: ' + id); return spreadsheets[id]; }, flush() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({
      get: k => { const e = cache[k]; if (!e || e.exp < Date.now()) return null; return e.v; },
      put: (k, v, ttl) => { cache[k] = { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }; },
      putAll: (o, ttl) => { Object.keys(o).forEach(k => { cache[k] = { v: String(o[k]), exp: Date.now() + (ttl || 600) * 1000 }; }); },
      getAll: ks => { const out = {}; ks.forEach(k => { const e = cache[k]; if (e && e.exp >= Date.now()) out[k] = e.v; }); return out; },
      remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
    ContentService: { createTextOutput: (t) => ({ text: t, setMimeType() { return this; }, getContent() { return this.text; } }), MimeType: { JSON: 'json' } },
    Utilities,
    Session: { getScriptTimeZone: () => TZ, getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }), getActiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    Logger: { log: (m) => logs.push(String(m)) },
    MailApp: { sendEmail: (to, subj, body) => mails.push({ to, subj, body }) },
    GmailApp: { sendEmail: (to, subj, body, o) => mails.push({ to, subj, body, html: o && o.htmlBody }) },
    DriveApp: {
      getFileById: (id) => { if (!driveFiles[id]) throw new Error('No file ' + id); return fileObj(id); },
      getFoldersByName: (n) => iter(folders[n] ? [folderObj(n)] : []),
      createFolder: (n) => folderObj(n),
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.map(t => ({ getHandlerFunction: () => t })),
      newTrigger: (fn) => { const ch = { timeBased: () => ch, everyDays: () => ch, atHour: () => ch, create: () => { triggers.push(fn); } }; return ch; }
    },
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(opts.codePath || path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'Code.gs' });

  function post(body) {
    sandbox._ss = null;                      // new "execution": fresh spreadsheet handle + header cache
    vm.runInContext('_ss = null; _hdr = {};', sandbox);
    const out = sandbox.doPost({ postData: { contents: JSON.stringify(body) } });
    return JSON.parse(out.text);
  }
  function get(params) {
    vm.runInContext('_ss = null; _hdr = {};', sandbox);
    return JSON.parse(sandbox.doGet({ parameter: params }).text);
  }
  function run(fnName, ...args) {
    vm.runInContext('_ss = null; _hdr = {};', sandbox);
    return sandbox[fnName](...args);
  }
  return { sandbox, post, get, run, addSpreadsheet, spreadsheets, driveFiles, props, cache, mails, logs, triggers, stats,
    failNextCopy: () => { failNextCopy = true; } };
}

// A realistic "before upgrade" spreadsheet (v2 layout, exactly as the old script wrote it)
function legacyData() {
  return {
    Medicines: [
      ['ID', 'Name', 'Stock', 'Unit Price', 'Cost Price', 'Expiry', 'Date & Time'],
      [1001, 'Paracetamol 500mg', 100, 10, 4, '2027-06-30', '2026-01-02 10:00:00'],
      [1002, 'Amoxicillin 500mg', 40, 25, 12, '2027-01-31', '2026-01-02 10:00:00'],
      [1003, 'Chlorhexidine Mouthwash', 0, 120, 70, '2026-12-31', '2026-01-02 10:00:00'],
    ],
    Bills: [
      ['Bill ID', 'Patient Name', 'Doctor', 'Phone', 'Date', 'Subtotal', 'Discount', 'Total', 'Cost Total', 'Payment Mode', 'Date & Time'],
      ['BILL-1700000000001', 'Ravi Kumar', 'Dr. T. Venkat Rao', '9876543210', '2026-10-01', 50, 0, 50, 20, 'Cash', '2026-10-01 11:00:00'],
      ['BILL-1700000000002', 'Lakshmi', 'Dr. T. Sai Vakula', '9123456780', '2026-10-02', 100, 10, 90, 48, 'UPI', '2026-10-02 12:00:00'],
    ],
    BillItems: [
      ['Bill ID', 'Medicine ID', 'Medicine Name', 'Quantity', 'Unit Price', 'Cost Price', 'Amount', 'Date & Time'],
      ['BILL-1700000000001', 1001, 'Paracetamol 500mg', 5, 10, 4, 50, '2026-10-01 11:00:00'],
      ['BILL-1700000000002', 1002, 'Amoxicillin 500mg', 4, 25, 12, 100, '2026-10-02 12:00:00'],
    ],
    Purchases: [
      ['ID', 'Date', 'Supplier', 'Medicine ID', 'Medicine Name', 'Quantity', 'Cost Price', 'Total Cost', 'Date & Time'],
      ['PUR-1', '2026-09-01', 'Sai Pharma', 1001, 'Paracetamol 500mg', 100, 4, 400, '2026-09-01 10:00:00'],
    ],
    TreatmentReceipts: [
      ['Receipt No', 'Date', 'Patient', 'Doctor', 'Amount', 'Amount in Words', 'Treatments', 'Saved At'],
      ['2026-0007', '2026-10-05', 'Ravi Kumar', 'Dr. T. Venkat Rao', 3500, 'Three thousand five hundred', 'Root Canal Therapy', '2026-10-05 17:00:00'],
    ],
    Prescriptions: [['Date', 'Patient Name', 'Age', 'Sex', 'Prescription', 'Saved At'], ['2026-10-05', 'Ravi Kumar', '34', 'M', 'Tab Paracetamol 500mg TDS x 3 days', '2026-10-05 17:05:00']],
    Patients: [
      ['ID', 'Name', 'Phone', 'Age', 'Sex', 'Doctor', 'Treatment', 'Balance', 'Medical Alerts', 'Status', 'Last Visit', 'Added On'],
      ['PT-1', 'Ravi Kumar', '9876543210', '34', 'M', 'Dr. T. Venkat Rao', 'RCT', 0, '', 'Active', '2026-10-05', '2026-09-01'],
    ],
    Appointments: [
      ['ID', 'Patient', 'Phone', 'Date', 'Time', 'Reason', 'Doctor', 'Status', 'Booked At'],
      ['A1', 'Ravi Kumar', '9876543210', '2026-11-02', '10:30 AM', 'RCT sitting 2', 'Dr. T. Venkat Rao', 'Confirmed', '2026-10-05T12:00:00Z'],
    ],
    ExamForms: [['Date', 'Patient', 'Age', 'Sex', 'Doctor', 'Phone', 'Swelling', 'TMJ', 'Lymph Nodes', 'Oral Hygiene', 'Gingiva', 'Dental Caries', 'Missing Teeth', 'Stains', 'Calculus', 'Provisional Diagnosis', 'Final Diagnosis', 'Treatment Plan', 'Treatment Notes', 'Upper Arch', 'Lower Arch', 'Saved At']],
    Settings: [['Key', 'Value', 'Updated At'], ['wa_templates', '{}', '2026-10-01 10:00:00']],
    Expenses: [['ID', 'Date', 'Category', 'Amount', 'Vendor', 'Notes', 'Payment Mode', 'Added At'], ['EXP-1', '2026-10-03', 'Rent', 25000, 'Landlord', 'October', 'UPI', '2026-10-03 10:00:00']],
  };
}

module.exports = { createGas, legacyData };
