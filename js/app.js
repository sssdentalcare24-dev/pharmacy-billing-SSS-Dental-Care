/* ════════════════════════════════════════════════════════════════════
   Sri Sai Speciality Dental Care — billing app, all JavaScript in one
   file (one download = faster on slow mobile data).
   Sections are in load order; search for '══ FILE:' to jump between them.
   ════════════════════════════════════════════════════════════════════ */

;/* ══ FILE: 00-boot.js ══════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════
   00-boot.js — loads FIRST. Secure connection layer (v3):
   • API.login / API.call — POST + session token (no data in URLs)
   • Every older fetch(...?action=...) call is converted automatically
   • Offline queue with clear status per transaction:
       saved · pending sync · sync failed (with reason)
     Each write carries a unique request ID → server never duplicates it.
   • Sync status line, online/offline indicator, last sync time
   • Auto-logout after 30 minutes without use
   • Small shared helpers: esc(), todayLocal(), newId(), qrDataUrl()
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── shared helpers ────────────────────────────────────────────────
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  window.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); };
  // CSV cell: quoted, inner quotes doubled, and text starting with = + - @ cannot run as a spreadsheet formula
  window.csvQ = function (v) { var t = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
  window.todayLocal = function () { return new Date().toLocaleDateString('en-CA'); };   // YYYY-MM-DD in clinic's local time
  window.newId = function (prefix) { return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase(); };
  window.qrDataUrl = function (text, cell) {          // local QR (no third-party website)
    try { var q = qrcode(0, 'M'); q.addData(String(text)); q.make(); return q.createDataURL(cell || 5, 2); } catch (e) { return ''; }
  };

  var IDLE_LOGOUT_MIN = 30;
  var READS = { getAllData: 1, getSettings: 1, getExpenses: 1, whoami: 1, getStockMovements: 1, listUsers: 1, getAuditLog: 1,
    listBackups: 1, validateData: 1, login: 1, logout: 1, ping: 1,
    getPayments: 1, getCashSummary: 1, getCashClosings: 1, getSupplierLedger: 1, getPatientHistory: 1, getRecentRecords: 1, getBills: 1,
    getBatchHistory: 1, getInventoryReport: 1, getReportData: 1, healthCheck: 1 };
  var NO_QUEUE = { reserveReceiptNo: 1, changePassword: 1, createUser: 1, resetUserPassword: 1, setUserActive: 1, backupNow: 1,
    restoreDrill: 1, uploadInvoiceAttachment: 1, returnRefund: 1, cancelPayment: 1, addPurchaseInvoice: 1, cancelPurchaseInvoice: 1,
    purchaseReturn: 1, recordSupplierPayment: 1, cancelSupplierEntry: 1, saveSupplier: 1, deleteSupplier: 1, saveCashClosing: 1, saveTreatment: 1 };
  var LABELS = { saveBill: 'Bill', cancelBill: 'Cancel bill', deleteBill: 'Cancel bill', savePatient: 'Patient', deletePatient: 'Delete patient',
    saveAppointment: 'Appointment', updateAppointmentStatus: 'Appointment status', deleteAppointment: 'Delete appointment',
    saveTreatmentReceipt: 'Treatment receipt', savePrescription: 'Prescription', saveExamForm: 'Exam form', saveExpense: 'Expense',
    deleteExpense: 'Delete expense', addMedicine: 'New medicine', updateMedicine: 'Medicine edit', addPurchase: 'Purchase',
    cancelPurchase: 'Cancel purchase', deletePurchase: 'Cancel purchase', adjustStock: 'Stock adjustment', saveSettings: 'Settings',
    recordPayment: 'Payment received', savePatientTreatment: 'Treatment', setPatientTreatmentStatus: 'Treatment status', saveFollowUp: 'Follow-up',
    setFollowUpStatus: 'Follow-up status' };

  function storedApiUrl() {
    try { return (JSON.parse(localStorage.getItem('medistock_config') || '{}').apiUrl) || ''; } catch (e) { return ''; }
  }
  function apiUrl() { return (window.CONFIG && window.CONFIG.apiUrl) || storedApiUrl(); }
  function isApi(url) { return typeof url === 'string' && url.indexOf('script.google.com/macros/') !== -1; }
  function toast(msg, type) { if (typeof window.showToast === 'function') window.showToast(msg, type || 'success'); }
  function jsonResponse(obj) { return new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } }); }

  var nativeFetch = window.fetch.bind(window);

  // ── session ───────────────────────────────────────────────────────
  var SKEY = 'ssdc_session';
  var API = window.API = { session: null, lastSync: 0, lastResult: {} };
  API.loadSession = function () {
    try { API.session = JSON.parse(sessionStorage.getItem(SKEY) || 'null'); } catch (e) { API.session = null; }
    return API.session;
  };
  API.saveSession = function (s) {
    API.session = s;
    try { if (s) sessionStorage.setItem(SKEY, JSON.stringify(s)); else sessionStorage.removeItem(SKEY); } catch (e) {}
  };
  API.token = function () { return API.session && API.session.token; };
  API.user = function () { return API.session && API.session.user; };
  API.isOwner = function () { var u = API.user(); return !!u && u.role === 'OWNER'; };
  API.loadSession();

  API.ensureUrl = function () {
    if (apiUrl()) return true;
    var url = (prompt('First-time setup on this device:\n\nPaste your Google Apps Script Web App link\n(ends with /exec).') || '').trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
      if (url) alert('That does not look like an Apps Script link (https://script.google.com/macros/s/.../exec).');
      return false;
    }
    var cfg = {}; try { cfg = JSON.parse(localStorage.getItem('medistock_config') || '{}'); } catch (e) {}
    cfg.apiUrl = url; localStorage.setItem('medistock_config', JSON.stringify(cfg));
    if (window.CONFIG) window.CONFIG.apiUrl = url;
    return true;
  };

  function post(body) {
    var url = apiUrl();
    if (!url) return Promise.reject(new Error('No server link set'));
    return nativeFetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  function banner(msg) {
    var el = document.getElementById('ssdcBanner');
    if (!el) {
      el = document.createElement('div'); el.id = 'ssdcBanner';
      el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100000;background:#c0392b;color:#fff;padding:10px 16px;font-weight:700;text-align:center;font-size:14px;';
      document.body.appendChild(el);
    }
    el.textContent = '⚠️ ' + msg;
  }

  // Session / permission codes are handled the same way for every call.
  function handleCodes(res) {
    if (!res || res.success !== false) return res;
    if (res.code === 'AUTH_REQUIRED') {
      API.saveSession(null);
      if (typeof window.onSessionLost === 'function') window.onSessionLost(res.error);
    } else if (res.code === 'MUST_CHANGE_PASSWORD') {
      if (typeof window.openChangePassword === 'function') window.openChangePassword(true);
    } else if (res.code === 'FORBIDDEN') {
      toast('🔒 ' + res.error, 'warning');
    } else if (res.code === 'MIGRATION_REQUIRED' || res.code === 'USE_POST') {
      banner(res.error);
    }
    return res;
  }

  API.login = function (username, password) {
    return post({ action: 'login', username: username, password: password }).then(function (res) {
      if (res && res.success && !res.token) {   // the Apps Script is still the old version
        res = { success: false, code: 'SERVER_OLD', error: 'The Apps Script server has not been updated yet. Paste the new Code.gs, run migrateToV3 and deploy a new version (see docs/DEPLOYMENT.md).' };
        banner(res.error);
        return res;
      }
      if (res.success) API.saveSession({ token: res.token, user: res.user, at: Date.now(), features: res.features || {}, dataKey: res.dataKey || '' });
      else if (res.code === 'MIGRATION_REQUIRED' || res.code === 'USE_POST') banner(res.error);
      return res;
    });
  };
  API.logout = function () {
    var t = API.token(); API.saveSession(null);
    if (t) post({ action: 'logout', token: t }).catch(function () {});
  };

  // Direct call. Writes get a request ID; if the network is down they are queued
  // (unless interactive) and the promise resolves with {queued:true}.
  API.call = function (action, params, opts) {
    opts = opts || {};
    var p = Object.assign({}, params || {});
    var reqId = READS[action] ? '' : (p.reqId || newId('R'));
    var body = Object.assign({}, p, { action: action, token: API.token() });
    if (reqId) body.reqId = reqId;
    return post(body).then(function (res) {
      handleCodes(res);
      if (action === 'getAllData' && res && res.success !== false) {
        API.lastSync = Date.now();
        if (!res.unchanged) { res = mergePending(res); API.lastAllData = res; if (res.dataVersion) API.dataVersion = res.dataVersion; }
        updateStatusLine();
      }
      // session ended / server busy: keep the write and send it after login / later
      if (reqId && !NO_QUEUE[action] && !opts.noQueue && res && ['AUTH_REQUIRED', 'MUST_CHANGE_PASSWORD', 'BUSY', 'RATE_LIMIT', 'SERVER_ERROR'].indexOf(res.code) !== -1) {
        delete p.token; enqueue(action, p, reqId);
        return { success: false, code: res.code, queued: true, reqId: reqId, error: res.error };
      }
      return res;
    }, function (err) {
      if (reqId && !NO_QUEUE[action] && !opts.noQueue) {
        delete p.token; enqueue(action, p, reqId);
        return { success: false, code: 'OFFLINE', queued: true, reqId: reqId, error: 'No internet — saved on this device, will sync automatically' };
      }
      return { success: false, code: 'NETWORK', error: 'No internet connection' };
    });
  };

  // ── offline queue ─────────────────────────────────────────────────
  var QKEY = 'ssdc_sync_queue_v2';
  function readQ() { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch (e) { return []; } }
  // Carry over unsent items from the previous app version (URL-based queue) so nothing is lost.
  (function migrateOldQueue() {
    try {
      var old = JSON.parse(localStorage.getItem('ssdc_sync_queue') || '[]');
      if (!old.length) return;
      var q = readQ();
      old.forEach(function (it) {
        var u = new URL(it.url), params = {}; u.searchParams.forEach(function (v, k) { params[k] = v; });
        var action = params.action; delete params.action;
        if (action) q.push({ reqId: newId('R'), action: action, params: params, at: it.at || Date.now(), status: 'pending', attempts: 0, error: '' });
      });
      localStorage.setItem(QKEY, JSON.stringify(q));
      localStorage.removeItem('ssdc_sync_queue');
    } catch (e) {}
  })();
  function writeQ(q) { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch (e) {} updateStatusLine(); }
  function enqueue(action, params, reqId) {
    var q = readQ();
    if (q.some(function (it) { return it.reqId === reqId; })) return;
    q.push({ reqId: reqId, action: action, params: params, at: Date.now(), status: 'pending', attempts: 0, error: '' });
    writeQ(q);
  }
  function summary(it) {
    var p = it.params || {};
    return (LABELS[it.action] || it.action) + ' · ' + (p.patientName || p.patient || p.name || p.medicineName || p.billId || p.id || p.settingKey || '');
  }
  API.queue = {
    list: readQ,
    summary: summary,
    counts: function () { var q = readQ(); return { pending: q.filter(function (i) { return i.status !== 'failed'; }).length, failed: q.filter(function (i) { return i.status === 'failed'; }).length }; },
    retry: function (reqId) { var q = readQ(); q.forEach(function (i) { if (i.reqId === reqId) { i.status = 'pending'; i.error = ''; } }); writeQ(q); return API.queue.flush(true); },
    discard: function (reqId) { writeQ(readQ().filter(function (i) { return i.reqId !== reqId; })); },
    pendingParams: function (action) { return readQ().filter(function (i) { return i.action === action; }).map(function (i) { return i.params; }); }
  };
  var flushing = false;
  API.queue.flush = function (manual) {
    if (flushing || !API.token() || navigator.onLine === false) return Promise.resolve();
    var q = readQ().filter(function (i) { return i.status !== 'failed'; });
    if (!q.length) return Promise.resolve();
    flushing = true;
    var done = 0, failed = 0, stop = false;
    return q.reduce(function (chain, it) {
      return chain.then(function () {
        if (stop) return;
        return post(Object.assign({}, it.params, { action: it.action, token: API.token(), reqId: it.reqId })).then(function (res) {
          var all = readQ(), cur = all.filter(function (x) { return x.reqId === it.reqId; })[0];
          if (!cur) return;
          if (res && res.success !== false) { writeQ(all.filter(function (x) { return x.reqId !== it.reqId; })); done++; return; }
          handleCodes(res);
          if (['AUTH_REQUIRED', 'MUST_CHANGE_PASSWORD', 'BUSY', 'RATE_LIMIT', 'SERVER_ERROR', 'MIGRATION_REQUIRED', 'USE_POST'].indexOf(res && res.code) !== -1) {
            cur.attempts++; cur.error = res.error || ''; writeQ(all); stop = true; return;
          }
          cur.status = 'failed'; cur.error = (res && res.error) || 'Rejected by server'; writeQ(all); failed++;
        }, function () { stop = true; });   // still offline
      });
    }, Promise.resolve()).then(function () {
      flushing = false;
      if (done) { toast('☁️ ' + done + ' saved item(s) synced to Google Sheets', 'success'); if (typeof window.loadData === 'function') window.loadData(); }
      if (failed) toast('❌ ' + failed + ' item(s) could not be saved — tap the red sync status to see why', 'error');
      else if (manual && !done) toast(navigator.onLine === false ? 'Still offline — will retry automatically' : 'Nothing could be sent yet', 'warning');
    });
  };

  // Records saved offline stay visible (marked) until the server confirms them.
  function mergePending(data) {
    var q = readQ(); if (!q.length || !data) return data;
    var haveBill = {}; (data.bills || []).forEach(function (b) { haveBill[String(b.billId)] = 1; });
    var ids = function (list, key) { var m = {}; (list || []).forEach(function (x) { m[String(x[key || 'id'])] = 1; }); return m; };
    var havePt = ids(data.patients), haveAp = ids(data.appointments), haveEx = ids(data.expenses);
    q.forEach(function (it) {
      var p = it.params || {}, st = it.status === 'failed' ? 'failed' : 'pending';
      if (it.action === 'saveBill' && !haveBill[p.billId] && data.bills) {
        var items = []; try { items = typeof p.items === 'string' ? JSON.parse(p.items) : (p.items || []); } catch (e) {}
        data.bills.push({ billId: p.billId, patientName: p.patientName || '', doctor: p.doctor || '', phone: p.phone || '', date: p.date || todayLocal(),
          subtotal: +p.subtotal || 0, discount: +p.discount || 0, total: +p.total || 0, costTotal: +p.costTotal || 0,
          paymentMode: p.paymentMode || 'Cash', items: items, syncStatus: st, syncError: it.error,
          paidAmount: p.paidAmount !== undefined && p.paidAmount !== '' ? +p.paidAmount : +p.total || 0,
          balanceDue: p.paidAmount !== undefined && p.paidAmount !== '' ? Math.round(((+p.total || 0) - (+p.paidAmount || 0)) * 100) / 100 : 0 });
      }
      if ((it.action === 'cancelBill' || it.action === 'deleteBill') && data.bills) data.bills = data.bills.filter(function (b) { return String(b.billId) !== String(p.billId); });
      if (it.action === 'savePatient' && data.patients && !havePt[p.id]) data.patients.push(Object.assign({}, p, { syncStatus: st }));
      if (it.action === 'saveAppointment' && data.appointments && !haveAp[p.id]) data.appointments.push(Object.assign({}, p, { syncStatus: st }));
      if (it.action === 'saveExpense' && data.expenses && !haveEx[p.id]) data.expenses.push(Object.assign({}, p, { amount: +p.amount || 0, syncStatus: st }));
    });
    return data;
  }

  // ── every legacy fetch(...?action=...) goes through the secure POST ──
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!isApi(url)) return nativeFetch(input, init);
    var u; try { u = new URL(url); } catch (e) { return nativeFetch(input, init); }
    var params = {}; u.searchParams.forEach(function (v, k) { params[k] = v; });
    var action = params.action || 'getAllData'; delete params.action;
    if (!API.token()) return Promise.resolve(jsonResponse({ success: false, code: 'AUTH_REQUIRED', error: 'Please log in' }));
    var reqId = READS[action] ? '' : newId('R');
    var body = Object.assign({}, params, { action: action, token: API.token() }); if (reqId) body.reqId = reqId;
    return post(body).then(function (res) {
      handleCodes(res);
      if (action === 'getAllData' && res && res.success !== false && !res.unchanged) { API.lastSync = Date.now(); res = mergePending(res); updateStatusLine(); }
      return jsonResponse(res);
    }, function (err) {
      if (reqId && !NO_QUEUE[action]) enqueue(action, params, reqId);
      throw err;      // older code then shows its "saved locally / offline" message
    });
  };

  // ── sync status line (sidebar) + badge ────────────────────────────
  function fmtTime(t) { return t ? new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'; }
  function updateStatusLine() {
    var c = API.queue ? API.queue.counts() : { pending: 0, failed: 0 };
    var online = navigator.onLine !== false;
    var line = document.getElementById('syncStatusLine');
    if (line) {
      line.innerHTML = '<span style="color:' + (online ? '#2ecc71' : '#f39c12') + ';">●</span> ' + (online ? 'Online' : 'Offline')
        + ' · synced ' + fmtTime(API.lastSync)
        + (c.pending ? ' · <b style="color:#f8c471;">' + c.pending + ' waiting</b>' : '')
        + (c.failed ? ' · <b style="color:#ff8a80;">' + c.failed + ' failed</b>' : '');
    }
    var el = document.getElementById('syncQueueBadge');
    if (!el && (c.pending || c.failed) && document.body) {
      el = document.createElement('div'); el.id = 'syncQueueBadge';
      el.onclick = function () { if (typeof window.openSyncCentre === 'function') window.openSyncCentre(); else API.queue.flush(true); };
      document.body.appendChild(el);
    }
    if (el) {
      el.textContent = c.failed ? '❌ ' + c.failed + ' not saved — tap' : '⏳ ' + c.pending + ' waiting to sync';
      el.style.background = c.failed ? '#c0392b' : '#f39c12';
      el.style.display = (c.pending || c.failed) ? 'block' : 'none';
    }
  }
  API.updateStatusLine = updateStatusLine;
  window.addEventListener('online', function () { updateStatusLine(); setTimeout(function () { API.queue.flush(); }, 1500); });
  window.addEventListener('offline', updateStatusLine);
  setInterval(function () { API.queue.flush(); }, 60000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener && navigator.serviceWorker.addEventListener('message', function (e) {
    if (e.data === 'ssdc-sync') API.queue.flush();
  });
  document.addEventListener('DOMContentLoaded', function () { updateStatusLine(); setTimeout(function () { API.queue.flush(); }, 5000); });

  // ── auto-logout after inactivity ──────────────────────────────────
  var lastActivity = Date.now();
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) {
    window.addEventListener(ev, function () { lastActivity = Date.now(); }, { passive: true, capture: true });
  });
  setInterval(function () {
    if (API.token() && Date.now() - lastActivity > IDLE_LOGOUT_MIN * 60000 && typeof window.doLogout === 'function') {
      window.doLogout(true);
      toast('🔒 Logged out after ' + IDLE_LOGOUT_MIN + ' minutes without use', 'warning');
    }
  }, 30000);

  // ── lazy lists (render 50 rows, load more on scroll) ──────────────
  var PAGE = 50;
  window.__lazyLimits = {};
  window.__lazyRender = {};
  window.__lazyKeep = false;
  window.__lazyReset = function (key) { if (!window.__lazyKeep) window.__lazyLimits[key] = PAGE; };
  window.__lazySlice = function (key, arr) { return arr.slice(0, window.__lazyLimits[key] || PAGE); };
  window.__lazyMore = function (key, total, shown, colspan) {
    if (shown >= total) return '';
    setTimeout(observe, 0);
    var btn = '<button type="button" class="lazy-more" data-lazy="' + key + '" data-onclick="__lazyLoadMore(\'' + key + '\')">⬇ Show more (' + (total - shown) + ' more)</button>';
    return colspan ? '<tr class="lazy-more-row"><td colspan="' + colspan + '">' + btn + '</td></tr>' : '<div class="lazy-more-wrap">' + btn + '</div>';
  };
  window.__lazyLoadMore = function (key) {
    window.__lazyLimits[key] = (window.__lazyLimits[key] || PAGE) + PAGE * 2;
    var fn = window.__lazyRender[key];
    if (fn) { window.__lazyKeep = true; try { fn(); } finally { window.__lazyKeep = false; } }
  };
  var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); window.__lazyLoadMore(en.target.getAttribute('data-lazy')); } });
  }, { rootMargin: '400px' }) : null;
  function observe() {
    if (!io) return;
    document.querySelectorAll('.lazy-more:not([data-obs])').forEach(function (b) { b.setAttribute('data-obs', '1'); io.observe(b); });
  }
})();
;

;/* ══ FILE: 00b-secure-store.js ══════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════
   00b-secure-store.js — patient data saved on this device is ENCRYPTED.
   • The server (v3.1) gives each user a device key at login (AES-256).
     It is kept only in this tab's session — never in the code or on disk.
   • Sensitive keys (patients, bills cache, offline queue, histories…) are
     stored as AES-GCM ciphertext, one slot per user, so a lost/shared
     phone shows nothing readable after logout.
   • The app keeps using localStorage as before: reads are served from a
     decrypted copy in memory, writes are encrypted in the background.
   • Old server (no key) → plain storage exactly as before.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var SENSITIVE = { medistock_cache: 1, pt_records: 1, appointments: 1, clinic_expenses: 1, ssdc_sync_queue_v2: 1, rx_history: 1,
    tr_history: 1, cb_history: 1, ef_history: 1, wa_sent_today: 1, ssdc_v31_cache: 1 };
  var P = Storage.prototype, rawGet = P.getItem, rawSet = P.setItem, rawRemove = P.removeItem;
  var mem = null, cryptoKey = null, user = '', dirty = {}, writing = null, timer = null;
  var hasCrypto = !!(window.crypto && crypto.subtle && window.TextEncoder);
  function isLocal(st) { try { return st === window.localStorage; } catch (e) { return false; } }
  function isEnc(raw) { return typeof raw === 'string' && raw.slice(0, 5) === 'enc1:'; }
  function b64(buf) { var s = '', a = new Uint8Array(buf); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }

  P.getItem = function (k) {
    if (isLocal(this) && SENSITIVE[k]) {
      if (mem) return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
      var raw = rawGet.call(this, k);
      return isEnc(raw) ? null : raw;          // locked: encrypted data stays unreadable
    }
    return rawGet.apply(this, arguments);
  };
  P.setItem = function (k, v) {
    if (isLocal(this) && SENSITIVE[k]) {
      if (mem) { mem[k] = String(v); mark(k); return; }
      if (isEnc(rawGet.call(this, k))) return;  // locked: never overwrite someone's encrypted data with plain text
    }
    return rawSet.apply(this, arguments);
  };
  P.removeItem = function (k) {
    if (isLocal(this) && SENSITIVE[k] && mem) { mem[k] = null; mark(k); return; }
    return rawRemove.apply(this, arguments);
  };

  function mark(k) {
    dirty[k] = 1;
    clearTimeout(timer);
    timer = setTimeout(persist, k === 'ssdc_sync_queue_v2' ? 0 : 150);   // offline queue: right away
  }
  function persist() {
    if (!cryptoKey || !mem) return Promise.resolve();
    var keys = Object.keys(dirty); dirty = {};
    if (!keys.length) return writing || Promise.resolve();
    var key = cryptoKey, who = user, snap = {};
    keys.forEach(function (k) { snap[k] = mem[k]; });
    var job = (writing || Promise.resolve()).then(function () {
      return Promise.all(keys.map(function (k) {
        var raw = rawGet.call(localStorage, k), box = { users: {} };
        if (isEnc(raw)) { try { box = JSON.parse(raw.slice(5)); } catch (e) {} }
        if (snap[k] === null || snap[k] === undefined) {
          delete box.users[who];
          if (!Object.keys(box.users).length) { rawRemove.call(localStorage, k); return; }
          try { rawSet.call(localStorage, k, 'enc1:' + JSON.stringify(box)); } catch (e) {}
          return;
        }
        var iv = crypto.getRandomValues(new Uint8Array(12));
        return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(snap[k])).then(function (ct) {
          var cur = rawGet.call(localStorage, k);                      // re-read: keep other users' slots
          if (isEnc(cur)) { try { box = JSON.parse(cur.slice(5)); } catch (e) {} } else box = { users: {} };
          box.users[who] = b64(iv) + '.' + b64(ct);
          try { rawSet.call(localStorage, k, 'enc1:' + JSON.stringify(box)); }
          catch (e) { console.warn('Device storage full — could not save ' + k); }
        });
      }));
    });
    writing = job.then(function () { writing = null; }, function () { writing = null; });
    return writing;
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') persist(); });
  window.addEventListener('pagehide', persist);

  window.SecureStore = {
    keys: SENSITIVE,
    isUnlocked: function () { return !!mem; },
    available: hasCrypto,
    // b64key: from the server at login; username: whose slot to use
    unlock: function (b64key, username) {
      if (!hasCrypto || !b64key) return Promise.resolve(false);
      return crypto.subtle.importKey('raw', unb64(b64key), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']).then(function (k) {
        var who = String(username || '').toLowerCase(), next = {}, migrate = [];
        return Promise.all(Object.keys(SENSITIVE).map(function (name) {
          var raw = rawGet.call(localStorage, name);
          if (!raw) { next[name] = null; return; }
          if (!isEnc(raw)) { next[name] = raw; migrate.push(name); return; }     // plain text from before → encrypt now
          var box; try { box = JSON.parse(raw.slice(5)); } catch (e) { next[name] = null; return; }
          var slot = box.users && box.users[who];
          if (!slot) { next[name] = null; return; }
          var parts = slot.split('.');
          return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(parts[0]) }, k, unb64(parts[1]))
            .then(function (pt) { next[name] = new TextDecoder().decode(pt); }, function () { next[name] = null; });
        })).then(function () {
          cryptoKey = k; user = who; mem = next;
          migrate.forEach(mark);
          return true;
        });
      }).catch(function (e) { console.warn('Secure storage unavailable:', e); return false; });
    },
    lock: function () {
      var p = persist();
      return p.then(function () { mem = null; cryptoKey = null; user = ''; dirty = {}; });
    },
    flush: persist
  };
})();
;

;/* ══ FILE: 00c-safe-handlers.js ══════════════════════════════════════════════ */
/* Safe event handlers — lets the Content-Security-Policy forbid inline JavaScript.
   Buttons and inputs carry their action in data-on<event> attributes (e.g. data-onclick holding submitBill()) …
   instead of the old inline onclick attribute. The browser never runs those attributes as code. This file reads them
   and carries them out with a small interpreter that only understands a narrow shape:
     • calls to the app's own functions (fn(), API.queue.flush(true), x.then(fn)) with simple arguments
     • strings, numbers, true/false/null, this, this.value, event, event.key, event.target === this
     • if (…) …, a ? b : c, &&, ||, !, ===, !==
     • setting el.value / el.checked / el.style.* on an element
   It never uses eval or new Function, refuses the browser's own functions (except a short list such
   as print and confirm) and refuses dangerous property names. Even if some text ever slipped through
   escaping, an injected attribute could at most call an existing app function after a click. */
(function () {
  'use strict';
  var BLOCKED_PROPS = { constructor: 1, __proto__: 1, prototype: 1, call: 1, apply: 1, bind: 1,
    __defineGetter__: 1, __defineSetter__: 1, __lookupGetter__: 1, __lookupSetter__: 1,
    innerHTML: 1, outerHTML: 1, insertAdjacentHTML: 1, srcdoc: 1, href: 1, src: 1, action: 1,
    location: 1, cookie: 1, write: 1, writeln: 1 };
  var BLOCKED_GLOBALS = { eval: 1, Function: 1, setTimeout: 1, setInterval: 1, fetch: 1,
    XMLHttpRequest: 1, importScripts: 1, location: 1, open: 1, opener: 1, parent: 1, top: 1, frames: 1,
    localStorage: 1, sessionStorage: 1, indexedDB: 1, Worker: 1, WebSocket: 1, navigator: 1 };
  var ELEMENT_SETTABLE = { value: 1, checked: 1, disabled: 1, hidden: 1, selectedIndex: 1, open: 1 };

  function isNative(fn) {
    try { return /\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(fn)); }
    catch (e) { return true; }
  }
  function nativeAllowed(fn) {
    var ok = [window.print, window.confirm, window.alert, document.getElementById];
    if (window.Event) ok.push(Event.prototype.stopPropagation, Event.prototype.preventDefault);
    if (window.HTMLElement) ok.push(HTMLElement.prototype.focus, HTMLElement.prototype.blur, HTMLElement.prototype.click);
    if (window.HTMLInputElement) ok.push(HTMLInputElement.prototype.select);
    if (window.Promise) ok.push(Promise.prototype.then, Promise.prototype.catch);
    for (var i = 0; i < ok.length; i++) if (ok[i] === fn) return true;
    return false;
  }

  /* ── tokenizer ── */
  function tokenize(src) {
    var out = [], i = 0, n = src.length, c, m;
    var re = /^(===|!==|==|!=|&&|\|\||[(){}.,;?:!=\-\[\]])/;
    while (i < n) {
      c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"' || c === "'") {
        var q = c, s = '', j = i + 1;
        while (j < n && src[j] !== q) {
          if (src[j] === '\\') {
            var e = src[j + 1];
            s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
            j += 2;
          } else s += src[j++];
        }
        if (j >= n) throw new SyntaxError('unterminated string');
        out.push({ t: 'str', v: s }); i = j + 1; continue;
      }
      m = /^\d+(\.\d+)?/.exec(src.slice(i));
      if (m) { out.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
      m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
      if (m) { out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      m = re.exec(src.slice(i));
      if (m) { out.push({ t: 'p', v: m[0] }); i += m[0].length; continue; }
      throw new SyntaxError('unexpected "' + c + '"');
    }
    return out;
  }

  /* ── parser → small syntax tree ── */
  function parse(src) {
    var tk = tokenize(src), pos = 0;
    function peek(v) { var t = tk[pos]; return t && (v === undefined || t.v === v) && (t.t === 'p' || t.t === 'id') ? t : null; }
    function eat(v) { var t = tk[pos]; if (!t || t.v !== v || t.t === 'str') throw new SyntaxError('expected ' + v); pos++; return t; }
    function program(endTok) {
      var list = [];
      while (pos < tk.length && !(endTok && peek(endTok))) {
        if (peek(';')) { pos++; continue; }
        list.push(statement());
        if (pos < tk.length && !peek(';') && !(endTok && peek(endTok))) {
          // allow `if(x) a() b()` style only when separated by ; — otherwise it's an error
          if (list[list.length - 1].k !== 'if') throw new SyntaxError('expected ;');
        }
      }
      return list;
    }
    function block() { eat('{'); var b = program('}'); eat('}'); return { k: 'block', body: b }; }
    function statement() {
      var t = tk[pos];
      if (t.t === 'id' && t.v === 'if') {
        pos++; eat('('); var cond = expr(); eat(')');
        var then = peek('{') ? block() : statement(), other = null;
        if (peek('else')) { pos++; other = peek('{') ? block() : statement(); }
        return { k: 'if', cond: cond, then: then, other: other };
      }
      if (t.t === 'id' && t.v === 'return') {
        pos++;
        var val = (pos < tk.length && !peek(';') && !peek('}')) ? expr() : null;
        return { k: 'return', val: val };
      }
      if (t.t === 'p' && t.v === '{') return block();
      var lhs = expr();
      if (peek('=')) {
        pos++;
        if (lhs.k !== 'member') throw new SyntaxError('can only set a property');
        return { k: 'assign', target: lhs, val: expr() };
      }
      return { k: 'expr', e: lhs };
    }
    function expr() {
      var c = orExpr();
      if (peek('?')) { pos++; var a = expr(); eat(':'); var b = expr(); return { k: 'cond', c: c, a: a, b: b }; }
      return c;
    }
    function orExpr() { var l = andExpr(); while (peek('||')) { pos++; l = { k: 'or', l: l, r: andExpr() }; } return l; }
    function andExpr() { var l = eqExpr(); while (peek('&&')) { pos++; l = { k: 'and', l: l, r: eqExpr() }; } return l; }
    function eqExpr() {
      var l = unary();
      while (peek('===') || peek('!==') || peek('==') || peek('!=')) { var op = tk[pos++].v; l = { k: 'cmp', op: op, l: l, r: unary() }; }
      return l;
    }
    function unary() {
      if (peek('!')) { pos++; return { k: 'not', e: unary() }; }
      if (peek('-')) { pos++; return { k: 'neg', e: unary() }; }
      return postfix();
    }
    function postfix() {
      var e = primary();
      for (;;) {
        if (peek('.')) {
          pos++; var t = tk[pos++];
          if (!t || t.t !== 'id') throw new SyntaxError('expected name');
          e = { k: 'member', obj: e, name: t.v };
        } else if (peek('(')) {
          pos++; var args = [];
          if (!peek(')')) { args.push(expr()); while (peek(',')) { pos++; args.push(expr()); } }
          eat(')'); e = { k: 'call', fn: e, args: args };
        } else return e;
      }
    }
    function primary() {
      var t = tk[pos++];
      if (!t) throw new SyntaxError('unexpected end');
      if (t.t === 'str' || t.t === 'num') return { k: 'lit', v: t.v };
      if (t.t === 'p' && t.v === '(') { var e = expr(); eat(')'); return e; }
      if (t.t === 'id') {
        if (t.v === 'true') return { k: 'lit', v: true };
        if (t.v === 'false') return { k: 'lit', v: false };
        if (t.v === 'null') return { k: 'lit', v: null };
        if (t.v === 'undefined') return { k: 'lit', v: undefined };
        if (t.v === 'this') return { k: 'this' };
        if (t.v === 'event') return { k: 'event' };
        if (t.v === 'function' || t.v === 'new' || t.v === 'import' || t.v === 'class') throw new SyntaxError(t.v + ' not allowed');
        return { k: 'name', name: t.v };
      }
      throw new SyntaxError('unexpected ' + t.v);
    }
    var prog = program(null);
    if (pos !== tk.length) throw new SyntaxError('unexpected ' + tk[pos].v);
    return prog;
  }

  /* ── evaluator ── */
  function RETURN(v) { this.v = v; }
  function getProp(obj, name) {
    if (BLOCKED_PROPS[name]) throw new Error('blocked property ' + name);
    if (obj === null || obj === undefined) throw new TypeError('cannot read ' + name + ' of ' + obj);
    var v = obj[name];
    if (v === window || v === document.defaultView) return window;
    return v;
  }
  function checkValue(v) {
    if (typeof v === 'function' && isNative(v) && !nativeAllowed(v)) throw new Error('browser function not allowed');
    return v;
  }
  function ev(node, ctx) {
    switch (node.k) {
      case 'lit': return node.v;
      case 'this': return ctx.el;
      case 'event': return ctx.ev;
      case 'name':
        if (BLOCKED_GLOBALS[node.name]) throw new Error('blocked name ' + node.name);
        if (node.name === 'window') return window;
        if (node.name === 'document') return document;
        if (!(node.name in window)) throw new ReferenceError(node.name + ' is not defined');
        return window[node.name];
      case 'member': return getProp(ev(node.obj, ctx), node.name);
      case 'call': {
        var self = undefined, fn;
        if (node.fn.k === 'member') { self = ev(node.fn.obj, ctx); fn = getProp(self, node.fn.name); }
        else fn = ev(node.fn, ctx);
        if (typeof fn !== 'function') throw new TypeError('not a function');
        if (isNative(fn) && !nativeAllowed(fn)) throw new Error('browser function not allowed');
        var args = node.args.map(function (a) { return checkValue(ev(a, ctx)); });
        return fn.apply(self, args);
      }
      case 'cond': return ev(node.c, ctx) ? ev(node.a, ctx) : ev(node.b, ctx);
      case 'or': return ev(node.l, ctx) || ev(node.r, ctx);
      case 'and': return ev(node.l, ctx) && ev(node.r, ctx);
      case 'not': return !ev(node.e, ctx);
      case 'neg': return -ev(node.e, ctx);
      case 'cmp': {
        var l = ev(node.l, ctx), r = ev(node.r, ctx);
        /* eslint-disable eqeqeq */
        return node.op === '===' ? l === r : node.op === '!==' ? l !== r : node.op === '==' ? l == r : l != r;
      }
    }
    throw new Error('bad node');
  }
  function run(list, ctx) {
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s.k === 'expr') ev(s.e, ctx);
      else if (s.k === 'block') run(s.body, ctx);
      else if (s.k === 'if') {
        if (ev(s.cond, ctx)) run([s.then], ctx); else if (s.other) run([s.other], ctx);
      } else if (s.k === 'return') throw new RETURN(s.val ? ev(s.val, ctx) : undefined);
      else if (s.k === 'assign') {
        var obj = ev(s.target.obj, ctx), name = s.target.name, val = ev(s.val, ctx);
        var isStyle = window.CSSStyleDeclaration && obj instanceof CSSStyleDeclaration;
        var isEl = window.Element && obj instanceof Element;
        if (BLOCKED_PROPS[name] || !(isStyle || (isEl && ELEMENT_SETTABLE[name]))) throw new Error('cannot set ' + name);
        if (typeof val === 'function' || (val && typeof val === 'object')) throw new Error('can only set simple values');
        obj[name] = val;
      }
    }
  }

  var cache = Object.create(null);
  function compile(code) {
    if (!(code in cache)) cache[code] = parse(code);
    return cache[code];
  }
  function exec(code, el, e) {
    var prog;
    try { prog = compile(code); }
    catch (err) { console.error('[ssdc] bad handler "' + code + '": ' + err.message); return; }
    try { run(prog, { el: el, ev: e }); }
    catch (err) {
      if (err instanceof RETURN) { if (err.v === false && e && e.cancelable) e.preventDefault(); return; }
      // report like an inline handler error would, without stopping other handlers
      setTimeout(function () { throw err; }, 0);
    }
  }

  var BUBBLING = ['click', 'dblclick', 'input', 'change', 'keydown', 'keyup', 'submit', 'touchend', 'touchstart', 'paste'];
  function dispatch(e) {
    var attr = 'data-on' + e.type, node = e.target;
    if (node && node.nodeType !== 1) node = node.parentElement;
    while (node && node !== document) {
      if (node.nodeType === 1 && node.hasAttribute(attr)) {
        if (!(node.disabled && e.type === 'click')) exec(node.getAttribute(attr), node, e);
        if (e.cancelBubble) break;   // event.stopPropagation() was called
      }
      node = node.parentElement;
    }
  }
  BUBBLING.forEach(function (type) { document.addEventListener(type, dispatch, false); });
  // Keyboard: Enter or Space on a focusable clickable element (menu items, cards) works like a click
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = e.target;
    if (!t || t.nodeType !== 1 || !t.hasAttribute('data-onclick') || /^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(t.tagName)) return;
    e.preventDefault(); t.click();
  }, false);
  /* Only user-driven events. Events that fire by themselves (load, error, focus via autofocus,
     toggle on an already-open <details>) are deliberately NOT supported, so injected markup
     could never run anything without the user clicking or typing. */

  window.SafeHandlers = { parse: parse, exec: exec };
})();

;/* ══ FILE: 01-core.js ══════════════════════════════════════════════ */
/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
        // CONFIG - PRE-FILLED WITH YOUR WEB APP URL
        const CONFIG = {
            apiUrl: '', // ← NOT stored here (code is public on GitHub). Entered once per device; saved in this browser.,
            demoMode: false,
            clinicName: 'Sri Sai Speciality Dental Care (T V Rao)',
            clinicPhone: '93965 22492, 86880 33072',
            clinicAddress: '8-5-254/10/1, Near TKR College Road, Kharmanghat',
            clinicTimings: '9:30 AM – 9:30 PM (Every Day, Sunday Working Day)',
            upiId: '',
            upiName: 'Sri Sai Dental Care'
        };

        window.CONFIG = CONFIG; // lets other scripts (Exam Form sync) see CONFIG

        // STATE
        let medicines = [];
        let bills = [];
        let purchases = [];
        let cart = [];
        let cancelledBills = [];      // owner: cancelled bills (kept, not deleted)
        let serverTreatments = [];    // dental treatment receipts from Sheets (dental revenue)
        let currentPage = 'dashboard';
        // Other modules use window.medicines / window.bills — make those point at the real data.
        Object.defineProperties(window, {
            medicines:        { get: () => medicines,        set: v => { medicines = v; },        configurable: true },
            bills:            { get: () => bills,            set: v => { bills = v; },            configurable: true },
            purchases:        { get: () => purchases,        set: v => { purchases = v; },        configurable: true },
            cart:             { get: () => cart,             set: v => { cart = v; },             configurable: true },
            cancelledBills:   { get: () => cancelledBills,   set: v => { cancelledBills = v; },   configurable: true },
            serverTreatments: { get: () => serverTreatments, set: v => { serverTreatments = v; }, configurable: true }
        });

        // ============ LOGIN / AUTH ============
        // Login is checked by the server (apps-script/Code.gs). No passwords or hashes in this file.
        let currentRole = null; // 'owner' or 'staff'
        let selectedRole = 'owner';

        function selectRole(role, keepError) {
            selectedRole = role;
            document.getElementById('tabOwner').classList.toggle('active', role === 'owner');
            document.getElementById('tabStaff').classList.toggle('active', role === 'staff');
            document.getElementById('loginUsername').value = role;      // usernames are created by the owner; these are the defaults
            document.getElementById('loginPassword').value = '';
            if (!keepError) document.getElementById('loginError').style.display = 'none';
        }

        let _loggingIn = false;
        async function doLogin() {
            if (_loggingIn) return;
            const errEl = document.getElementById('loginError');
            const username = (document.getElementById('loginUsername').value || '').trim();
            const password = document.getElementById('loginPassword').value;
            if (!username || !password) { errEl.textContent = '❌ Enter username and password'; errEl.style.display = 'block'; return; }
            if (!API.ensureUrl()) return;
            const btn = document.querySelector('.login-btn');
            _loggingIn = true; if (btn) { btn.disabled = true; btn.textContent = '⏳ Checking…'; }
            let res;
            try { res = await API.login(username, password); }
            catch (e) { res = { success: false, error: 'Cannot reach the server — check internet' }; }
            _loggingIn = false; if (btn) { btn.disabled = false; btn.textContent = '🔐 Login'; }
            if (!res.success) { errEl.textContent = '❌ ' + (res.error || 'Login failed'); errEl.style.display = 'block'; return; }
            errEl.style.display = 'none';
            document.getElementById('loginPassword').value = '';
            startSession(res.user);
        }

        // Called after login and when the app is reopened with a live session.
        function startSession(user) {
            currentRole = user.role === 'OWNER' ? 'owner' : 'staff';
            document.getElementById('loginScreen').classList.add('hidden');
            applyRoleUI();
            if (user.mustChangePassword) { if (typeof openChangePassword === 'function') openChangePassword(true); return; }
            initApp();
            API.queue.flush();
        }

        // Server said the session ended (expired, password changed, account disabled).
        window.onSessionLost = function (msg) {
            if (!currentRole) return;
            doLogout(true);
            const errEl = document.getElementById('loginError');
            errEl.textContent = '🔒 ' + (msg || 'Session ended — please log in again'); errEl.style.display = 'block';
        };

        function doLogout(silent) {
            API.logout();
            currentRole = null;
            selectedRole = 'owner';
            document.getElementById('loginScreen').classList.remove('hidden');
            document.getElementById('loginUsername').value = '';
            document.getElementById('loginPassword').value = '';
            if (!silent) document.getElementById('loginError').style.display = 'none';
            selectRole('owner', true);
        }
        window.doLogout = doLogout;

        function applyRoleUI() {
            const isOwner = currentRole === 'owner';
            // Update user badge
            const u = API.user() || {};
            document.getElementById('userIcon').textContent = isOwner ? '👑' : '👨‍⚕️';
            document.getElementById('userName').textContent = u.displayName || (isOwner ? 'Owner' : 'Staff');
            // Show/hide owner-only nav items
            document.querySelectorAll('.owner-only').forEach(el => {
                el.classList.toggle('hidden', !isOwner);
            });
            // If staff, go directly to New Bill page and make it active
            if (!isOwner) {
                // Remove active from all nav items, show newbill page
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                document.getElementById('newbill').classList.add('active');
                document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                document.getElementById('nav-newbill').classList.add('active');
                document.getElementById('pageTitle').textContent = '🧾 New Bill';
            } else {
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                document.getElementById('dashboard').classList.add('active');
                document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                document.getElementById('nav-dashboard').classList.add('active');
                document.getElementById('pageTitle').textContent = '📊 Dashboard';
            }
        }

        function showPage(page) {
            // Restrict staff from owner-only pages
            const ownerPages = ['dashboard','allbills','inventory','purchases','expenses','reports','settings'];
            if (currentRole === 'staff' && ownerPages.includes(page)) return;
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById(page).classList.add('active');
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            const navEl = document.getElementById('nav-' + page);
            if (navEl) navEl.classList.add('active');
            const titles = {
                dashboard: '📊 Dashboard',
                newbill: '🧾 New Bill',
                allbills: '📋 All Bills',
                inventory: '📦 Inventory',
                purchases: '🛒 Purchases',
                expenses: '💸 Clinic Expenses',
                reports: '📈 Reports',
                settings: '⚙️ Settings',
                treatmentreceipt: '🦷 Treatment Receipt',
                combinedbill: '🧾 Bill Summary',
                examform:     '🦷 Examination Form',
                appointments: '📅 Appointments',
                wareminders:  '📲 WA Reminders',
                prescription: '📋 Prescription',
                patients:     '👥 Patients'
            };
            document.getElementById('pageTitle').textContent = titles[page] || 'Sri Sai Speciality Dental Care';
            if (page === 'reports') setTimeout(renderReports, 50);
            if (page === 'expenses') setTimeout(renderExpenses, 50);
            if (page === 'combinedbill' && typeof renderCbHistory === 'function') renderCbHistory();
            if (page === 'patients') { renderPatientsTable(); updatePatientStats(); }
            if (page === 'appointments') { renderAppointments(); }
            if (page === 'wareminders') { updateWaStats(); renderWaTodayList(); updateWaPreview(); renderWaAllAppts(); }
            if (page === 'dashboard' && typeof renderDashCalendar === 'function') renderDashCalendar();
            if (page === 'examform') { if(typeof initDentalChart==='function') initDentalChart(); if(typeof renderEfHistory==='function') renderEfHistory(); }
            // Auto-fill receipt no if empty when navigating to receipt pages
            if (page === 'combinedbill') {
                var cbn = document.getElementById('cb_no');
                if (cbn && !cbn.value && typeof peekNextReceiptNo === 'function') {
                    cbn.placeholder = 'Next: ' + peekNextReceiptNo() + ' (click Auto)';
                }
            }
            if (page === 'treatmentreceipt') {
                var trn = document.getElementById('tr_no');
                if (trn && !trn.value && typeof peekNextReceiptNo === 'function') {
                    trn.placeholder = 'Next: ' + peekNextReceiptNo() + ' (click Auto)';
                }
                if (typeof renderTreatmentHistory === 'function') renderTreatmentHistory();
                if (typeof renderRxHistory === 'function') renderRxHistory();
            }
        }

        // Wire up live preview for treatment receipt
        function initTreatmentReceiptPreview() {
            ['tr_no','tr_date','tr_patient','tr_amount','tr_words','tr_others_text',
             'tr_t1','tr_t2','tr_t3','tr_t4','tr_t5','tr_t6','tr_t7','tr_t8','tr_t9'
            ].forEach(function(id) {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('input', updateTreatmentPreview);
                    el.addEventListener('change', updateTreatmentPreview);
                }
            });
            // Set today's date
            const d = document.getElementById('tr_date');
            if (d) d.valueAsDate = new Date();
            updateTreatmentPreview();
            renderTreatmentHistory();
            const rd = document.getElementById('rx_date');
            if (rd) rd.valueAsDate = new Date();
            updateRxPreview();
            renderRxHistory();
        }

        function initApp() {
            loadSettings();
            // Render histories immediately (no delay needed)
            if (typeof renderTreatmentHistory === 'function') renderTreatmentHistory();
            if (typeof renderRxHistory === 'function') renderRxHistory();
            setTimeout(initTreatmentReceiptPreview, 300);
            // Load cached data instantly so UI is usable immediately
            const cached = localStorage.getItem('medistock_cache');
            if (cached) {
                try {
                    const c = JSON.parse(cached);
                    medicines = c.medicines || [];
                    bills = c.bills || [];
                    purchases = c.purchases || [];
                    serverTreatments = c.serverTreatments || [];
                    refreshUI();
                } catch(e) {}
            }
            loadData();
            updateDate();
            if (!window.__appTimers) {
                window.__appTimers = true;
                setInterval(updateDate, 60000);
                setInterval(function(){ if (API.token()) loadData(); }, 300000);   // refresh from Sheets every 5 min
            }
        }
        // ============ END LOGIN / AUTH ============

        // INIT
        window.addEventListener('load', () => {
            // Don't load app until logged in
        });

        // LOAD SETTINGS FROM LOCAL STORAGE
        function loadSettings() {
            const saved = localStorage.getItem('medistock_config');
            if (saved) {
                const config = JSON.parse(saved);
                delete config.demoMode; // NEVER load demoMode from storage
                Object.assign(CONFIG, config);
                CONFIG.demoMode = false; // Always reset to false on load
                document.getElementById('apiUrl').value = CONFIG.apiUrl;
                document.getElementById('clinicName').value = CONFIG.clinicName;
                document.getElementById('clinicPhone').value = CONFIG.clinicPhone;
                document.getElementById('clinicAddress').value = CONFIG.clinicAddress;
                document.getElementById('clinicTimings').value = CONFIG.clinicTimings;
                document.getElementById('clinicUpiId').value = CONFIG.upiId || '';
                document.getElementById('clinicUpiName').value = CONFIG.upiName || '';
            }
        }

        // SAVE SETTINGS
        // ── SAVING OVERLAY HELPERS ──────────────────────────────
        let _clockInterval = null;
        function showSaving() {
            const overlay = document.getElementById('savingOverlay');
            overlay.style.display = 'flex';
            const clocks = ['🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚','🕛'];
            let ci = 0;
            const clockEl = document.getElementById('clockAnim');
            _clockInterval = setInterval(() => { clockEl.textContent = clocks[ci++ % clocks.length]; }, 100);
        }
        function hideSaving() {
            clearInterval(_clockInterval);
            document.getElementById('savingOverlay').style.display = 'none';
        }
        // ────────────────────────────────────────────────────────

        function saveSettings() {
            showSaving();
            var el = document.getElementById('apiUrl');
            if (el) { CONFIG.apiUrl = el.value; CONFIG.demoMode = false; }
            var toSave = Object.assign({}, CONFIG);
            delete toSave.demoMode;
            localStorage.setItem('medistock_config', JSON.stringify(toSave));
            setTimeout(() => {
                hideSaving();
                showToast('Settings saved!', 'success');
                loadData();
            }, 800);
        }

        // SAVE CLINIC DETAILS
        function saveClinicDetails() {
            showSaving();
            var g = function(id){ var e=document.getElementById(id); return e?e.value:''; };
            CONFIG.clinicName    = g('clinicName')    || CONFIG.clinicName;
            CONFIG.clinicPhone   = g('clinicPhone')   || CONFIG.clinicPhone;
            CONFIG.clinicAddress = g('clinicAddress') || CONFIG.clinicAddress;
            CONFIG.clinicTimings = g('clinicTimings') || CONFIG.clinicTimings;
            CONFIG.upiId         = g('clinicUpiId').trim();
            CONFIG.upiName       = g('clinicUpiName').trim() || CONFIG.clinicName;
            localStorage.setItem('medistock_config', JSON.stringify(CONFIG));
            setTimeout(() => {
                hideSaving();
                showToast('Clinic details saved!', 'success');
            }, 800);
        }

        function _normTime(t) {
            if(!t && t!==0) return '';
            var s = String(t).trim();
            if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(s)) return s.toUpperCase();
            var h, m;
            var num = parseFloat(s);
            if (!isNaN(num) && num >= 0 && num < 1) { var totalMins = Math.round(num * 24 * 60); h = Math.floor(totalMins / 60); m = totalMins % 60; }
            if (h === undefined && s.includes('T')) { var d = new Date(s); if (!isNaN(d)) { h = d.getUTCHours(); m = d.getUTCMinutes(); } }
            if (h === undefined && /^\d{1,2}:\d{2}$/.test(s)) { var pts = s.split(':'); h = parseInt(pts[0]); m = parseInt(pts[1]); }
            if (h === undefined) return s;
            var snapM = m < 15 ? 0 : m < 45 ? 30 : 0, snapH = m >= 45 ? h + 1 : h;
            if (snapH >= 24) snapH = 23;
            return ('0' + (snapH % 12 || 12)).slice(-2) + ':' + (snapM === 0 ? '00' : '30') + ' ' + (snapH < 12 ? 'AM' : 'PM');
        }
        function _normBill(b) {
            let items = b.items || [];
            if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }
            if (Array.isArray(items)) items = items.map(i => typeof i === 'string' ? (() => { try { return JSON.parse(i); } catch(e) { return i; } })() : i);
            return { ...b, phone: String(b.phone || ''), date: b.date ? String(b.date).split('T')[0] : '',
                total: parseFloat(b.total) || 0, subtotal: parseFloat(b.subtotal) || 0, discount: parseFloat(b.discount) || 0,
                costTotal: parseFloat(b.costTotal) || 0, items: items, syncStatus: b.syncStatus || 'saved' };
        }

        // LOAD DATA FROM GOOGLE SHEETS (secure, via the server session)
        let _firstLoadDone = false;
        async function loadData() {
            if (!CONFIG.apiUrl || !API.token()) { updateConnectionStatus(false); return; }
            // Data already on screen? Ask the server only whether it changed (tiny answer when nothing did).
            const data = await API.call('getAllData', (_firstLoadDone && API.dataVersion && bills.length + medicines.length) ? { ifVersion: API.dataVersion } : {});
            if (data && data.unchanged) { updateConnectionStatus(true); if (typeof _loadTmplsFromSheets === 'function') _loadTmplsFromSheets(); return; }
            if (!data || data.success === false) {
                updateConnectionStatus(false);
                // Keep showing the data already on screen / saved on this device. Never swap in demo data.
                if (data && (data.code === 'NETWORK' || data.code === 'OFFLINE')) showToast('📴 Offline — showing data saved on this device', 'warning');
                else if (data && ['AUTH_REQUIRED', 'MUST_CHANGE_PASSWORD', 'MIGRATION_REQUIRED', 'USE_POST'].indexOf(data.code) === -1)
                    showToast('⚠️ Could not load from Google Sheets: ' + (data.error || ''), 'warning');
                return;
            }
            medicines = (data.medicines || []).map(m => ({ ...m, stock: parseInt(m.stock) || 0, price: parseFloat(m.price) || 0, costPrice: parseFloat(m.costPrice) || 0 }));
            bills = (data.bills || []).map(_normBill);
            cancelledBills = (data.cancelledBills || []).map(_normBill);
            purchases = data.purchases || [];
            serverTreatments = data.treatmentReceipts || [];
            if (data.staffMaxDiscountPct !== undefined) CONFIG.staffMaxDiscountPct = parseFloat(data.staffMaxDiscountPct);

            if (Array.isArray(data.patients)) {
                _patients = data.patients.map(function(p){ return {
                    id: p.id||('PT-'+Date.now()+Math.random()), name: p.name||'', phone: String(p.phone||''), age: p.age||'',
                    sex: p.sex||'', doctor: p.doctor||'', treatment: p.treatment||'', balance: parseFloat(p.balance)||0, alerts: p.alerts||'',
                    status: p.status||'Active', lastVisit: p.lastVisit||'', addedOn: p.addedOn||'', syncStatus: p.syncStatus,
                    medicalHistory: p.medicalHistory||'', dentalHistory: p.dentalHistory||'', allergies: p.allergies||'', medications: p.medications||'',
                    bloodGroup: p.bloodGroup||'', address: p.address||'', emergencyContact: p.emergencyContact||'', dob: p.dob||''
                }; });
                localStorage.setItem('pt_records', JSON.stringify(_patients));
            }
            if (Array.isArray(data.appointments)) {
                _appointments = data.appointments.map(function(a){ return {
                    id: a.id||('A'+Date.now()+Math.random()), patient: a.patient||'', phone: String(a.phone||''), date: a.date||'',
                    time: _normTime(a.time), reason: a.reason||'', doctor: a.doctor||'', status: a.status||'Confirmed', bookedAt: a.bookedAt||''
                }; });
                localStorage.setItem('appointments', JSON.stringify(_appointments));
            }
            if (Array.isArray(data.expenses) && API.isOwner()) {
                _expenses = data.expenses.map(function(e){ return {
                    id: e.id || ('EXP-' + Date.now() + Math.random()), date: e.date ? String(e.date).split('T')[0] : '', category: e.category || '',
                    amount: parseFloat(e.amount) || 0, vendor: e.vendor || '', notes: e.notes || '', mode: e.mode || e.paymentMode || 'Cash',
                    addedAt: e.addedAt || '', syncStatus: e.syncStatus
                }; });
                _expenses.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
                localStorage.setItem('clinic_expenses', JSON.stringify(_expenses));
            }

            CONFIG.demoMode = false;
            updateConnectionStatus(true);
            try { localStorage.setItem('medistock_cache', JSON.stringify({ medicines, bills, purchases, serverTreatments })); } catch(e) {}
            refreshUI();
            setTimeout(function(){
                if(typeof renderPatientsTable==='function') renderPatientsTable();
                if(typeof updatePatientStats==='function') updatePatientStats();
                if(typeof renderAppointments==='function') renderAppointments();
                if(typeof renderExpenses==='function' && API.isOwner()) renderExpenses();
                if(typeof renderCancelledBills==='function') renderCancelledBills();
            }, 100);
            if (!_firstLoadDone) { _firstLoadDone = true; showToast('✅ Data loaded from Google Sheets', 'success'); }
            if (typeof _loadTmplsFromSheets === 'function') _loadTmplsFromSheets();
            if (window.V31) V31.ingest(data);
        }

        // ── DASHBOARD CALENDAR ───────────────────────────────────
        var _dashCalYear  = new Date().getFullYear();
        var _dashCalMonth = new Date().getMonth(); // 0-based
        var _dashSelDate  = new Date().toLocaleDateString('en-CA');

        function renderDashCalendar() {
            var today   = new Date();
            var todayStr = today.toLocaleDateString('en-CA');
            var first   = new Date(_dashCalYear, _dashCalMonth, 1);
            var last    = new Date(_dashCalYear, _dashCalMonth + 1, 0);
            var months  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

            var title = document.getElementById('dashCalTitle');
            if (title) title.textContent = months[_dashCalMonth] + ' ' + _dashCalYear;

            // Get all appointment dates this month
            var apptDates = {};
            (_appointments||[]).forEach(function(a){
                if (a.status !== 'Cancelled') apptDates[a.date] = (apptDates[a.date]||0) + 1;
            });

            var grid = document.getElementById('dashCalGrid');
            if (!grid) return;
            var html = '';

            // Blank days before first of month
            var startDay = first.getDay();
            for (var i = 0; i < startDay; i++) {
                var prevDate = new Date(_dashCalYear, _dashCalMonth, -(startDay - i - 1));
                html += '<div class="cal-day other-month">' + prevDate.getDate() + '</div>';
            }

            // Days of month
            for (var d = 1; d <= last.getDate(); d++) {
                var dateStr = _dashCalYear + '-' + String(_dashCalMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
                var cls = 'cal-day';
                if (dateStr === todayStr)    cls += ' today';
                else if (dateStr === _dashSelDate) cls += ' selected';
                if (apptDates[dateStr])      cls += ' has-appt';
                html += '<div class="' + cls + '" data-onclick="dashCalSelect(\'' + dateStr + '\')">' + d + '</div>';
            }

            // Fill remaining cells
            var totalCells = startDay + last.getDate();
            var remainder  = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
            for (var i = 1; i <= remainder; i++) {
                html += '<div class="cal-day other-month">' + i + '</div>';
            }

            grid.innerHTML = html;
            renderDashAppts(_dashSelDate);
        }

        function dashCalNav(dir) {
            _dashCalMonth += dir;
            if (_dashCalMonth > 11) { _dashCalMonth = 0; _dashCalYear++; }
            if (_dashCalMonth < 0)  { _dashCalMonth = 11; _dashCalYear--; }
            renderDashCalendar();
        }

        function dashCalSelect(dateStr) {
            _dashSelDate = dateStr;
            renderDashCalendar();
        }

        function renderDashAppts(dateStr) {
            var dateLabel = document.getElementById('dashApptDate');
            var list      = document.getElementById('dashApptList');
            if (!list) return;

            var d = new Date(dateStr + 'T12:00:00');
            var isToday = dateStr === new Date().toLocaleDateString('en-CA');
            if (dateLabel) {
                dateLabel.textContent = d.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) + (isToday?' — Today':'');
            }

            var dayAppts = (_appointments||[]).filter(function(a){ return a.date === dateStr; })
                .sort(function(a,b){ return (a.time||'').localeCompare(b.time||''); });

            if (!dayAppts.length) {
                list.innerHTML = '<div style="text-align:center;color:#aaa;padding:30px 10px;">' +
                    '<div style="font-size:32px;margin-bottom:8px;">📅</div>' +
                    '<div style="font-size:14px;">No appointments ' + (isToday?'today':'on this day') + '</div>' +
                    '<div style="font-size:12px;margin-top:6px;color:#bbb;">Tap a date or click + Book</div>' +
                    '</div>';
                return;
            }

            list.innerHTML = dayAppts.map(function(a){
                var isCancelled = a.status === 'Cancelled';
                var phone = (String(a.phone||'')).replace(/[^\d]/g,'');
                if (phone.length===10) phone = '91'+phone;
                var waBtn = phone ? '<button class="dash-appt-wa" data-onclick="sendDashApptWa(\''+esc(a.id)+'\')">📲</button>' : '';
                return '<div class="dash-appt-slot' + (isCancelled?' cancelled':'') + '">' +
                    '<span class="dash-appt-time">' + esc(a.time) + '</span>' +
                    '<div style="flex:1;min-width:0;">' +
                        '<div class="dash-appt-name">' + esc(a.patient) + '</div>' +
                        (a.doctor?'<div style="font-size:11px;color:#888;">'+esc(a.doctor)+'</div>':'') +
                    '</div>' +
                    (a.reason?'<span class="dash-appt-tag'+(isCancelled?' cancelled':'')+'">'+esc(a.reason)+'</span>':'') +
                    (isCancelled?'<span class="dash-appt-tag cancelled">Cancelled</span>':waBtn) +
                    '</div>';
            }).join('');
        }

        function sendDashApptWa(id) {
            var a = (_appointments||[]).find(function(x){ return x.id===id; }); if(!a) return;
            var phone = (String(a.phone||'')).replace(/[^\d]/g,'');
            if (!phone) { showToast('No phone for this appointment','warning'); return; }
            if (phone.length===10) phone='91'+phone;
            var msg = '*🦷 Sri Sai Speciality Dental Care*\n\nHello *'+a.patient+'*! 😊\n\n'+
                'Reminder for your appointment:\n⏰ *'+a.time+'*\n'+(a.reason?'🦷 '+a.reason+'\n':'')+(a.doctor?'👨‍⚕️ '+a.doctor+'\n':'')+
                '\nPlease arrive 5 mins early. Call: 8688033072 | 9396522492\n\nSee you soon! 🙏';
            openWhatsApp(phone, msg);
        }
        // ── END DASHBOARD CALENDAR ────────────────────────────────

        // LOAD DEMO DATA
        // UPDATE CONNECTION STATUS
        function updateConnectionStatus(isConnected) {
            const indicator = document.getElementById('statusIndicator');
            if (isConnected) {
                indicator.classList.add('connected');
                indicator.title = 'Connected to Google Sheets';
            } else {
                indicator.classList.remove('connected');
                indicator.title = 'Offline / Demo Mode';
            }
        }

        // REFRESH UI
        function refreshUI() {
            if(typeof renderPatientsTable==='function') { renderPatientsTable(); }
            if(typeof updatePatientStats==='function') { updatePatientStats(); }
            if(typeof renderAppointments==='function') { renderAppointments(); }
            updateDashboard();
            updateMedicineSelect();
            updateInventoryTable();
            updateBillsTable();
            updatePurchasesTable();
        }

        // PAGE NAVIGATION - handled by login/auth section above

        // DASHBOARD
        function updateDashboard() {
            const today = new Date().toLocaleDateString('en-CA');
            let todayRevenue = 0;
            let todayProfit = 0;

            bills.forEach(bill => {
                const billDate = bill.date ? String(bill.date).split('T')[0] : '';
                const billTotal = parseFloat(bill.total) || 0;

                // Try costTotal first; if 0 or missing, calculate from items × medicine costPrice
                let billCostTotal = parseFloat(bill.costTotal) || 0;
                if (billCostTotal === 0 && bill.items && bill.items.length > 0) {
                    billCostTotal = bill.items.reduce((sum, item) => {
                        const med = medicines.find(m => String(m.id) === String(item.medicineId));
                        const costPrice = med ? (parseFloat(med.costPrice) || 0) : (parseFloat(item.costPrice) || 0);
                        return sum + (parseInt(item.qty) * costPrice);
                    }, 0);
                }

                if (billDate === today) {
                    todayRevenue += billTotal;
                    todayProfit += (billTotal - billCostTotal);
                }
            });

            // Dental treatment income (receipts) is revenue with no medicine cost
            (serverTreatments || []).forEach(t => { if (String(t.date).split('T')[0] === today) { const a = parseFloat(t.amount) || 0; todayRevenue += a; todayProfit += a; } });
            const inrFmt = v => (Math.round(v * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            document.getElementById('todayRevenue').textContent = inrFmt(todayRevenue);
            document.getElementById('todayProfit').textContent = inrFmt(todayProfit);
            const hello = document.getElementById('dashHello');
            if (hello) {
                const hr = new Date().getHours(), u = (window.API && API.user && API.user()) || {};
                hello.textContent = (hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening') + (u.displayName ? ', ' + u.displayName : '');
            }

            const lowStock = medicines.filter(m => m.stock < (parseFloat(m.minStock) || 10)).length;
            document.getElementById('lowStockCount').textContent = lowStock;

            const expiring = medicines.filter(m => {
                const expiry = new Date(m.expiry);
                const thirtyDaysFromNow = new Date();
                thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
                return expiry <= thirtyDaysFromNow;
            }).length;
            document.getElementById('expiringCount').textContent = expiring;

            // Render dashboard calendar & today's appointments
            if (typeof renderDashCalendar === 'function') renderDashCalendar();

            // Recent bills
            const recent = bills.slice(-5).reverse();
            const tbody = document.getElementById('recentBillsBody');
            const cards = document.getElementById('recentBillsCards');
            const rows = recent.map(bill => `
                <tr>
                    <td style="font-size:11px;font-family:monospace;">${esc(bill.billNo || bill.billId)}</td>
                    <td>${esc(bill.patientName)}</td>
                    <td>${esc(bill.doctor || '-')}</td>
                    <td style="font-weight:700;">₹${parseFloat(bill.total||0).toFixed(2)}</td>
                    <td style="white-space:nowrap;">${esc(bill.date)}</td>
                </tr>
            `).join('');
            tbody.innerHTML = rows;
            if (cards) {
                const isCBfn = id => id && String(id).startsWith('CB-');
                cards.innerHTML = recent.map(bill => `
                    <div class="m-card" style="border-left-color:${isCBfn(bill.billId)?'#2c5aa0':'#27ae60'}">
                        <div class="m-card-row">
                            <div class="m-card-title">${esc(bill.patientName||'—')}</div>
                            <div class="m-card-val">₹${parseFloat(bill.total||0).toFixed(2)}</div>
                        </div>
                        <div class="m-card-meta">👨‍⚕️ ${esc(bill.doctor||'—')} &nbsp;|&nbsp; 📅 ${esc(bill.date||'')}</div>
                        <div class="m-card-meta" style="font-size:11px;color:#aaa;">${esc(bill.billNo || bill.billId)}</div>
                    </div>
                `).join('');
            }
        }

        // BILLING
        function updateMedicineSelect() {
            const select = document.getElementById('medicineSelect');
            const purchaseSelect = document.getElementById('purchaseMedicine');
            const options = medicines.map(m => `<option value="${esc(m.id)}" data-price="${esc(m.price)}" data-stock="${esc(m.stock)}" data-name="${esc(m.name)}">${esc(m.name)} — ₹${parseFloat(m.price).toFixed(2)} (Stock: ${esc(m.stock)})</option>`).join('');
            select.innerHTML = '<option value="">Choose medicine...</option>' + options;
            purchaseSelect.innerHTML = '<option value="">Select medicine...</option>' + options;
            // Also populate Combined Bill dropdown with same data
            const cbSel = document.getElementById('cb_medSelect');
            if (cbSel) {
                cbSel.innerHTML = '<option value="">Choose medicine...</option>' + options;
            }
        }

        function addMedicineToCart() {
            const medicineId = document.getElementById('medicineSelect').value;
            const qty = Number(document.getElementById('medicineQty').value);
            if (!Number.isInteger(qty) || qty < 1) { showToast('Quantity must be a whole number (1 or more)', 'warning'); return; }

            if (!medicineId) {
                showToast('Please select a medicine', 'warning');
                return;
            }

            const medicine = medicines.find(m => String(m.id) === String(medicineId));
            if (!medicine) {
                showToast('Medicine not found', 'error');
                return;
            }

            const existing = cart.find(c => String(c.id) === String(medicineId));
            const already = existing ? existing.qty : 0;
            if (qty + already > medicine.stock) {
                showToast(`Only ${medicine.stock} unexpired units available` + (already ? ` (${already} already in cart)` : ''), 'warning');
                return;
            }
            if (existing) {
                existing.qty += qty;
            } else {
                cart.push({
                    id: medicineId,
                    name: medicine.name,
                    price: medicine.price,
                    costPrice: medicine.costPrice,
                    qty: qty
                });
            }

            document.getElementById('medicineSelect').value = '';
            document.getElementById('medicineQty').value = '1';
            renderCart();
            recalc();
            updateReceipt();
        }

        function renderCart() {
            const tbody = document.getElementById('cartBody');
            tbody.innerHTML = cart.map((item, idx) => `
                <tr>
                    <td>${esc(item.name)}</td>
                    <td><input type="number" value="${item.qty}" min="1" step="1" inputmode="numeric" data-onchange="updateCartQty(${idx}, this.value)"></td>
                    <td>₹${item.price}</td>
                    <td>₹${(item.qty * item.price).toFixed(2)}</td>
                    <td><button class="btn-danger btn-small" data-onclick="removeFromCart(${idx})">Remove</button></td>
                </tr>
            `).join('');
        }

        function updateCartQty(idx, qty) {
            const n = Number(qty), item = cart[idx];
            const med = medicines.find(m => String(m.id) === String(item.id));
            if (!Number.isInteger(n) || n < 1) { showToast('Quantity must be a whole number (1 or more)', 'warning'); renderCart(); return; }
            if (med && n > med.stock) { showToast(`Only ${med.stock} units available`, 'warning'); renderCart(); return; }
            item.qty = n;
            renderCart();
            recalc();
            updateReceipt();
        }

        function removeFromCart(idx) {
            cart.splice(idx, 1);
            renderCart();
            recalc();
            updateReceipt();
        }

        function maxDiscountPct() { return currentRole === 'owner' ? 100 : (isFinite(CONFIG.staffMaxDiscountPct) ? CONFIG.staffMaxDiscountPct : 10); }
        function clampDiscount() {
            const el = document.getElementById('discountPct');
            let v = parseFloat(el.value) || 0, max = maxDiscountPct();
            if (v < 0) v = 0;
            if (v > max) { v = max; showToast(`Maximum discount allowed is ${max}%`, 'warning'); }
            if (String(v) !== el.value) el.value = v;
            return v;
        }
        function recalc() {
            const subtotal = cart.reduce((sum, item) => sum + (item.qty * item.price), 0);
            const discountPct = clampDiscount();
            const discount = (subtotal * discountPct) / 100;
            const grandTotal = subtotal - discount;

            document.getElementById('subtotal').textContent = subtotal.toFixed(2);
            document.getElementById('grandTotal').textContent = grandTotal.toFixed(2);
        }

        function updateReceipt() {
            const patientName = document.getElementById('patientName').value || 'N/A';
            const doctor = document.getElementById('doctor').value || 'N/A';
            const today = new Date().toLocaleDateString('en-IN');

            let receipt = `=== ${CONFIG.clinicName.toUpperCase()} ===

BILL DETAILS
Date: ${today}
Patient: ${patientName}
Doctor: ${doctor}

MEDICINES
`;

            cart.forEach(item => {
                receipt += `${item.name}
  Qty: ${item.qty} × ₹${item.price} = ₹${(item.qty * item.price).toFixed(2)}\n`;
            });

            const subtotal = cart.reduce((sum, item) => sum + (item.qty * item.price), 0);
            const discountPct = parseFloat(document.getElementById('discountPct').value) || 0;
            const discount = (subtotal * discountPct) / 100;
            const grandTotal = subtotal - discount;

            receipt += `
─────────────────────────
Subtotal: ₹${subtotal.toFixed(2)}`;

            if (discount > 0) {
                receipt += `
Discount (${discountPct}%): -₹${discount.toFixed(2)}`;
            }

            receipt += `
GRAND TOTAL: ₹${grandTotal.toFixed(2)}
─────────────────────────
Payment: ${_selectedPayMode || '—'}

📞 ${CONFIG.clinicPhone}
📍 ${CONFIG.clinicAddress}
🕐 ${CONFIG.clinicTimings}

Thank you! Visit again.`;

            document.getElementById('receiptPreview').textContent = receipt;
        }

        function clearCart() {
            if (confirm('Clear cart?')) {
                cart = [];
                document.getElementById('patientName').value = '';
                document.getElementById('patientPhone').value = '';
                document.getElementById('doctor').value = '';
                document.getElementById('discountPct').value = '0';
                renderCart();
                recalc();
                updateReceipt();
                document.getElementById('whatsappBtn').style.display = 'none';
                showToast('Cart cleared', 'info');
            }
        }

        // ============ PAYMENT MODAL ============
        let _pendingPrint = false;
        let _selectedPayMode = 'Cash';
        Object.defineProperty(window, '_selectedPayMode', { get: () => _selectedPayMode, configurable: true });
        // Amount to take now: the total, or the part payment entered (v3.1)
        function _pmCollect() {
            const t = parseFloat(document.getElementById('pmTotal').textContent.replace(/[₹,]/g, '')) || 0;
            return (window.V31 && V31.partPay) ? V31.partPay.amount('pm', t) : t;
        }

        function openPaymentModal(shouldPrint) {
            if (cart.length === 0) { showToast('Add medicines to cart first', 'warning'); return; }
            const patientName = document.getElementById('patientName').value.trim();
            if (!patientName) { showToast('Enter patient name', 'warning'); return; }

            _pendingPrint = shouldPrint;
            _selectedPayMode = 'Cash';

            const subtotal = cart.reduce((s, i) => s + i.qty * i.price, 0);
            const discountPct = clampDiscount();
            const discount = (subtotal * discountPct) / 100;
            const total = subtotal - discount;

            document.getElementById('pmPatient').textContent = patientName;
            document.getElementById('pmSubtotal').textContent = '₹' + subtotal.toFixed(2);
            document.getElementById('pmDiscount').textContent = '-₹' + discount.toFixed(2);
            document.getElementById('pmTotal').textContent = '₹' + total.toFixed(2);
            document.getElementById('pmDiscountRow').style.display = discount > 0 ? 'flex' : 'none';

            // Reset
            document.getElementById('pmTendered').value = '';
            document.getElementById('pmChange').textContent = '₹0';
            document.getElementById('pmUpiRef').value = '';
            document.getElementById('pmCardRef').value = '';
            document.getElementById('pmSplitCash').value = '';
            document.getElementById('pmSplitUpi').value = '';
            document.getElementById('splitStatus').textContent = '';
            selectPayMode('Cash');
            if (window.V31 && V31.partPay) V31.partPay.reset('pm');

            // Quick cash buttons
            const qc = document.getElementById('quickCashBtns');
            qc.innerHTML = '';
            const rounded = Math.ceil(total / 10) * 10;
            [rounded, rounded + 50, rounded + 100, 500, 1000, 2000].filter((v, i, a) => a.indexOf(v) === i && v >= total).slice(0, 5).forEach(amt => {
                const b = document.createElement('button');
                b.textContent = '₹' + amt;
                b.style.cssText = 'padding:6px 12px;border:1px solid #2c5aa0;border-radius:6px;background:#f0f4ff;color:#2c5aa0;cursor:pointer;font-size:13px;font-weight:600;';
                b.onclick = () => { document.getElementById('pmTendered').value = amt; calcChange(); };
                qc.appendChild(b);
            });

            document.getElementById('paymentModal').classList.add('active');
        }

        function selectPayMode(mode) {
            _selectedPayMode = mode;
            document.querySelectorAll('.pay-mode-btn').forEach(b => b.classList.remove('pay-mode-active'));
            document.getElementById('pm-' + mode).classList.add('pay-mode-active');
            document.getElementById('cashSection').style.display = mode === 'Cash' ? 'block' : 'none';
            document.getElementById('upiSection').style.display = mode === 'UPI' ? 'block' : 'none';
            document.getElementById('cardSection').style.display = mode === 'Card' ? 'block' : 'none';
            document.getElementById('splitSection').style.display = mode === 'Split' ? 'block' : 'none';
            // For UPI, the "Payment Received" button IS the save — hide the generic confirm row
            document.getElementById('pmConfirmRow').style.display = mode === 'UPI' ? 'none' : 'flex';
            // Reset UPI paid button if switching away and back
            if (mode === 'UPI') {
                const b = document.getElementById('upiPaidBtn');
                if (b) { b.textContent = '✅ Payment Received'; b.style.background = '#27ae60'; b.disabled = false; }
                generateUpiQr();
            }
        }

        // ── UPI PAYMENT (iPad-optimised) ───────────────────────
        let _upiExpectedAmount = 0;
        let _upiPaymentDetected = false;

        function generateUpiQr() {
            const total = _pmCollect();
            const upiId = (CONFIG.upiId || '').trim();
            const upiName = (CONFIG.upiName || CONFIG.clinicName).trim();
            const noConfig = document.getElementById('upiNoConfig');
            const qrCard = document.getElementById('upiQrCard');

            if (!upiId) {
                noConfig.style.display = 'block';
                qrCard.style.display = 'none';
                return;
            }
            noConfig.style.display = 'none';
            qrCard.style.display = 'block';

            _upiExpectedAmount = total;
            _upiPaymentDetected = false;

            // Build UPI deep link
            const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${total.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Dental')}`;
            const qrUrl = qrDataUrl(upiLink, 5);

            document.getElementById('upiQrImg').src = qrUrl;
            document.getElementById('upiAmountDisplay').textContent = '₹' + total.toFixed(2);
            document.getElementById('upiNameDisplay').textContent = upiName;
            document.getElementById('upiIdDisplay').textContent = '📲  ' + upiId;
            const step2 = document.getElementById('upiAmountStep2');
            if (step2) step2.textContent = total.toFixed(2);

            // Reset state
            document.getElementById('upiSuccessBox').style.display = 'none';
            document.getElementById('upiSmsInput').value = '';
            document.getElementById('upiSmsStatus').textContent = '';
            document.getElementById('pmUpiRef').value = '';
            const btn = document.getElementById('upiPaidBtn');
            btn.textContent = '✅ Payment Received — Save Bill';
            btn.style.background = '#27ae60';
            btn.style.opacity = '1';
            btn.disabled = false;
        }

        // Parse pasted bank SMS to extract amount and txn ID
        function checkSmsForPayment(smsText) {
            if (!smsText || smsText.length < 10) {
                document.getElementById('upiSmsStatus').textContent = '';
                return;
            }
            const statusEl = document.getElementById('upiSmsStatus');
            const text = smsText.toLowerCase();

            // Extract amount — matches Rs.450, Rs 450.00, INR 450, ₹450 etc.
            const amtMatch = smsText.match(/(?:rs\.?|inr|₹)\s*([\d,]+\.?\d*)/i);
            const amount = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, '')) : null;

            // Extract transaction / reference ID
            const txnMatch = smsText.match(/(?:ref(?:no|erence)?\.?\s*(?:no\.?)?|upi\s*ref|txn\s*(?:id|no)?|transaction\s*(?:id|no)?)[:\s#]*([A-Z0-9]{8,})/i)
                          || smsText.match(/([A-Z0-9]{12,20})/);
            const txnId = txnMatch ? txnMatch[1] : '';

            // Check keywords for credit/success
            const isCredit = /credited|received|credit|success|paid|debited from.*upi|upi.*credit/i.test(text);

            if (!isCredit) {
                statusEl.style.color = '#e67e22';
                statusEl.textContent = '⚠️ SMS does not look like a payment confirmation — check it';
                return;
            }

            if (amount !== null && Math.abs(amount - _upiExpectedAmount) > 1) {
                statusEl.style.color = '#e74c3c';
                statusEl.textContent = `❌ Amount mismatch — SMS shows ₹${amount.toFixed(2)}, expected ₹${_upiExpectedAmount.toFixed(2)}`;
                return;
            }

            // All good — auto confirm!
            statusEl.style.color = '#27ae60';
            statusEl.textContent = `✅ Amount ₹${amount ? amount.toFixed(2) : _upiExpectedAmount.toFixed(2)} confirmed${txnId ? ' · Ref: ' + txnId : ''}`;
            if (txnId) document.getElementById('pmUpiRef').value = txnId;

            // Trigger success after brief delay
            setTimeout(() => {
                if (!_upiPaymentDetected) upiPaymentSuccess(txnId, amount || _upiExpectedAmount, 'SMS verified');
            }, 800);
        }

        function upiPaymentSuccess(txnId, amount, source) {
            if (_upiPaymentDetected) return;
            _upiPaymentDetected = true;

            document.getElementById('upiSuccessBox').style.display = 'block';
            const txnEl = document.getElementById('upiSuccessTxn');
            if (txnEl) txnEl.textContent = (txnId ? 'Ref: ' + txnId : '') + (source ? '  (' + source + ')' : '');
            if (txnId) document.getElementById('pmUpiRef').value = txnId;

            const btn = document.getElementById('upiPaidBtn');
            btn.textContent = '✅ Saving...';
            btn.disabled = true;
            btn.style.opacity = '0.7';

            setTimeout(() => { confirmPayment(); }, 1200);
        }

        function markUpiPaid() {
            if (_upiPaymentDetected) return;
            const btn = document.getElementById('upiPaidBtn');
            btn.textContent = '✅ Saving Bill...';
            btn.style.background = '#1e8449';
            btn.disabled = true;

            document.getElementById('upiSuccessBox').style.display = 'block';
            const txnEl = document.getElementById('upiSuccessTxn');
            const manualRef = document.getElementById('pmUpiRef').value;
            if (txnEl) txnEl.textContent = manualRef ? 'Ref: ' + manualRef : 'Confirmed by staff';

            _upiPaymentDetected = true;
            setTimeout(() => { confirmPayment(); }, 600);
        }

        function stopUpiPolling() {}   // kept for compatibility
        // ── END UPI ──────────────────────────────────────────────

        // ══ BILL SUCCESS POPUP ══════════════════════════════════
        let _lastBillData = null;  // stores last saved bill for the success popup
        let _lastPaymentInfo = null;

        function showBillSuccess(billData, paymentInfo) {
            _lastBillData = billData;
            _lastPaymentInfo = paymentInfo;

            // Payment mode label
            let modeLabel = paymentInfo.mode;
            if (paymentInfo.mode === 'Credit') modeLabel = '🕒 Pay later (nothing paid now)';
            else if (paymentInfo.mode === 'Cash') modeLabel = '💵 Cash Payment';
            else if (paymentInfo.mode === 'UPI')  modeLabel = '📱 UPI / GPay Payment';
            else if (paymentInfo.mode === 'Card') modeLabel = '💳 Card Payment';
            else if (paymentInfo.mode === 'Split') modeLabel = '🔀 Split Payment';
            document.getElementById('bsPayMode').textContent = modeLabel;

            // Bill id & clinic
            document.getElementById('bsBillId').textContent = billData.billId;
            document.getElementById('bsClinicAddr').textContent = CONFIG.clinicAddress || '';
            document.getElementById('bsClinicPhone').textContent = CONFIG.clinicPhone ? '📞 ' + CONFIG.clinicPhone : '';

            // Patient info
            document.getElementById('bsPatient').textContent  = billData.patientName || '—';
            document.getElementById('bsDoctor').textContent   = billData.doctor       || '—';
            document.getElementById('bsDate').textContent     = billData.date         || '—';
            document.getElementById('bsPhone').textContent    = billData.phone        || '—';

            // Items
            const tbody = document.getElementById('bsItemsBody');
            tbody.innerHTML = billData.items.map((item, i) => `
                <tr style="background:${i % 2 === 0 ? 'white' : '#f8f9fa'};">
                    <td style="padding:7px 10px;border-bottom:1px solid #eee;">${esc(item.medicineName)}</td>
                    <td style="padding:7px 6px;text-align:center;border-bottom:1px solid #eee;">${item.qty}</td>
                    <td style="padding:7px 6px;text-align:right;border-bottom:1px solid #eee;">₹${parseFloat(item.price).toFixed(2)}</td>
                    <td style="padding:7px 10px;text-align:right;border-bottom:1px solid #eee;font-weight:600;">₹${parseFloat(item.amount).toFixed(2)}</td>
                </tr>
            `).join('');

            // Totals
            document.getElementById('bsSubtotal').textContent = '₹' + parseFloat(billData.subtotal).toFixed(2);
            document.getElementById('bsTotal').textContent    = '₹' + parseFloat(billData.total).toFixed(2);

            const discountRow = document.getElementById('bsDiscountRow');
            if (billData.discount > 0) {
                document.getElementById('bsDiscount').textContent = '-₹' + parseFloat(billData.discount).toFixed(2);
                discountRow.style.display = 'flex';
            } else {
                discountRow.style.display = 'none';
            }

            // Part payment: paid now / still due
            let dueBox = document.getElementById('bsDueBox');
            if (!dueBox) { dueBox = document.createElement('div'); dueBox.id = 'bsDueBox'; dueBox.className = 'v-due-box'; const t = document.getElementById('bsTotal'); if (t) t.closest('div').parentNode.appendChild(dueBox); }
            dueBox.innerHTML = billData.balanceDue > 0.009 ? `<div><span>Paid now</span><b>₹${(+billData.paidAmount || 0).toFixed(2)}</b></div><div class="v-due-strong"><span>Balance due</span><b>₹${(+billData.balanceDue).toFixed(2)}</b></div>` : '';
            dueBox.style.display = billData.balanceDue > 0.009 ? 'block' : 'none';

            // Cash change details
            const cashDetails = document.getElementById('bsCashDetails');
            if (paymentInfo.mode === 'Cash' && paymentInfo.tendered) {
                document.getElementById('bsTendered').textContent = '₹' + parseFloat(paymentInfo.tendered).toFixed(2);
                document.getElementById('bsChange').textContent   = '₹' + Math.max(0, parseFloat(paymentInfo.change || 0)).toFixed(2);
                cashDetails.style.display = 'block';
            } else {
                cashDetails.style.display = 'none';
            }

            document.getElementById('billSuccessModal').classList.add('active');
        }

        function closeBillSuccess() {
            document.getElementById('billSuccessModal').classList.remove('active');
        }

        function printBillFromSuccess() {
            if (!_lastBillData) return;
            const b = _lastBillData;
            const pi = _lastPaymentInfo || {};

            // Build items rows
            const itemRows = b.items.map((item, i) => `
                <tr style="background:${i % 2 === 0 ? '#fff' : '#f8f9fa'};">
                    <td style="padding:8px 10px;border-bottom:1px solid #eee;">${esc(item.medicineName)}</td>
                    <td style="padding:8px 6px;text-align:center;border-bottom:1px solid #eee;">${item.qty}</td>
                    <td style="padding:8px 6px;text-align:right;border-bottom:1px solid #eee;">₹${parseFloat(item.price).toFixed(2)}</td>
                    <td style="padding:8px 10px;text-align:right;border-bottom:1px solid #eee;font-weight:700;">₹${parseFloat(item.amount).toFixed(2)}</td>
                </tr>`).join('');

            // Payment mode label
            let modeLabel = pi.mode || '';
            if (modeLabel === 'Cash')  modeLabel = '💵 Cash';
            else if (modeLabel === 'UPI')   modeLabel = '📱 UPI / GPay';
            else if (modeLabel === 'Card')  modeLabel = '💳 Card';
            else if (modeLabel === 'Split') modeLabel = '🔀 Split';
            else if (modeLabel === 'Credit') modeLabel = '🕒 Pay later';
            const dueRows = b.balanceDue > 0.009
                ? `<tr><td style="padding:4px 0;">Paid now</td><td style="padding:4px 0;text-align:right;">₹${(+b.paidAmount || 0).toFixed(2)}</td></tr>
                   <tr><td style="padding:4px 0;font-weight:800;color:#c0392b;">Balance due</td><td style="padding:4px 0;text-align:right;font-weight:800;color:#c0392b;">₹${(+b.balanceDue).toFixed(2)}</td></tr>` : '';

            const discountRow = b.discount > 0
                ? `<tr><td style="padding:5px 0;color:#e74c3c;">Discount</td><td style="padding:5px 0;text-align:right;color:#e74c3c;">-₹${parseFloat(b.discount).toFixed(2)}</td></tr>` : '';

            const cashRows = (pi.mode === 'Cash' && pi.tendered)
                ? `<tr><td style="padding:4px 0;font-size:12px;color:#555;">Cash Received</td><td style="padding:4px 0;text-align:right;font-size:12px;color:#555;">₹${parseFloat(pi.tendered).toFixed(2)}</td></tr>
                   <tr><td style="padding:4px 0;font-size:12px;color:#27ae60;">Change Returned</td><td style="padding:4px 0;text-align:right;font-size:12px;color:#27ae60;">₹${Math.max(0, parseFloat(pi.change || 0)).toFixed(2)}</td></tr>` : '';

            // Build inline-styled HTML (no <html>/<head> tags — injected into div via innerHTML)
            const html = `
<style>
  #__bps * { box-sizing:border-box; font-family:'Bookman Old Style','Book Antiqua',Bookman,Georgia,serif; }
  #__bps { max-width:480px; margin:0 auto; color:#222; }
  #__bps .banner { background:linear-gradient(135deg,#27ae60,#1e8449); border-radius:14px 14px 0 0; padding:22px 20px 18px; text-align:center; color:white; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  #__bps .banner .tick { font-size:48px; margin-bottom:6px; display:block; }
  #__bps .banner h1 { font-size:22px; font-weight:800; margin:0; }
  #__bps .banner .mode { font-size:13px; opacity:0.85; margin-top:4px; }
  #__bps .body { border:2px solid #27ae60; border-top:none; border-radius:0 0 14px 14px; padding:18px 20px 20px; }
  #__bps .bill-id { text-align:right; font-size:11px; color:#999; font-family:monospace; margin-bottom:12px; }
  #__bps .clinic-header { text-align:center; margin-bottom:14px; padding-bottom:12px; border-bottom:2px dashed #ddd; }
  #__bps .clinic-header .name { font-size:16px; font-weight:800; color:#1e3f5a; }
  #__bps .clinic-header .sub { font-size:11px; color:#888; margin-top:3px; }
  #__bps .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; background:#f8f9fa; border-radius:8px; padding:12px; margin-bottom:14px; }
  #__bps .info-grid .lbl { font-size:10px; color:#999; margin-bottom:2px; }
  #__bps .info-grid .val { font-size:13px; font-weight:700; color:#2c3e50; }
  #__bps table { width:100%; border-collapse:collapse; margin-bottom:14px; font-size:13px; }
  #__bps thead tr { background:#2c5aa0; color:white; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  #__bps thead th { padding:8px 10px; text-align:left; }
  #__bps thead th:not(:first-child) { text-align:center; }
  #__bps thead th:last-child { text-align:right; }
  #__bps .totals { background:#f8f9fa; border-radius:8px; padding:12px 14px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  #__bps .totals table { margin-bottom:0; font-size:13px; }
  #__bps .totals td { padding:4px 0; }
  #__bps .totals td:last-child { text-align:right; }
  #__bps .grand-total td { font-size:18px; font-weight:800; color:#2c5aa0; border-top:2px solid #dce8f8; padding-top:8px; }
  #__bps .footer { text-align:center; margin-top:16px; font-size:11px; color:#aaa; }
</style>
<div id="__bps">
  <div class="banner">
    <span class="tick">✅</span>
    <h1>${b.balanceDue > 0.009 ? 'Bill Saved' : 'Payment Done!'}</h1>
    <div class="mode">${esc(modeLabel)}</div>
  </div>
  <div class="body">
    <div id="__ph" data-patient="${esc(b.patientName||'')}" data-doctor="${esc(b.doctor||'')}" data-date="${esc(b.date||'')}" data-billid="${esc(b.billId||'')}" data-total="${parseFloat(b.total||0).toFixed(2)}" data-subtotal="${parseFloat(b.subtotal||0).toFixed(2)}" data-discount="${parseFloat(b.discount||0).toFixed(2)}" data-mode="${esc(b.paymentMode||'Cash')}" data-paid="${(+(b.paidAmount !== undefined ? b.paidAmount : b.total) || 0).toFixed(2)}" data-due="${(+b.balanceDue || 0).toFixed(2)}" data-items="${encodeURIComponent(JSON.stringify((b.items||[]).map(function(i){return{name:i.medicineName||i.name||'',qty:i.qty,price:i.price,amount:i.amount};})))}" style="display:none"></div>
    <div class="bill-id">${esc(b.billId)}</div>
    <div class="clinic-header">
      <div class="name">🦷 Sri Sai Speciality Dental Care</div>
      <div class="sub">${CONFIG ? (CONFIG.clinicAddress || '') : ''}</div>
      <div class="sub">${CONFIG ? (CONFIG.clinicPhone ? '📞 ' + CONFIG.clinicPhone : '') : ''}</div>
    </div>
    <div class="info-grid">
      <div><div class="lbl">Patient</div><div class="val">${esc(b.patientName || '—')}</div></div>
      <div><div class="lbl">Doctor</div><div class="val">${esc(b.doctor || '—')}</div></div>
      <div><div class="lbl">Date</div><div class="val">${esc(b.date || '—')}</div></div>
      <div><div class="lbl">Phone</div><div class="val">${esc(b.phone || '—')}</div></div>
    </div>
    <table>
      <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div class="totals">
      <table>
        <tr><td>Subtotal</td><td>₹${parseFloat(b.subtotal).toFixed(2)}</td></tr>
        ${discountRow}
        <tr class="grand-total"><td><strong>Grand Total</strong></td><td><strong>₹${parseFloat(b.total).toFixed(2)}</strong></td></tr>
        ${dueRows}
        ${cashRows}
      </table>
    </div>
    <div class="footer">Thank you for choosing Sri Sai Speciality Dental Care 🦷</div>
  </div>
</div>`;

            printBillHtml(html);
        }
        // ══ END BILL SUCCESS POPUP ════════════════════════════

        function calcChange() {
            const total = _pmCollect();
            const tendered = parseFloat(document.getElementById('pmTendered').value) || 0;
            const change = tendered - total;
            const el = document.getElementById('pmChange');
            el.textContent = change >= 0 ? '₹' + change.toFixed(2) : '-₹' + Math.abs(change).toFixed(2);
            el.style.color = change >= 0 ? '#27ae60' : '#e74c3c';
        }

        function calcSplit() {
            const total = _pmCollect();
            const cash = parseFloat(document.getElementById('pmSplitCash').value) || 0;
            const upi = parseFloat(document.getElementById('pmSplitUpi').value) || 0;
            const rem = total - cash - upi;
            const el = document.getElementById('splitStatus');
            if (Math.abs(rem) < 0.01) { el.textContent = '✅ Balanced'; el.style.color = '#27ae60'; }
            else if (rem > 0) { el.textContent = '⚠️ ₹' + rem.toFixed(2) + ' still pending'; el.style.color = '#e67e22'; }
            else { el.textContent = '❌ Overpaid by ₹' + Math.abs(rem).toFixed(2); el.style.color = '#e74c3c'; }
        }

        function confirmPayment() {
            const total = _pmCollect();
            const fullTotal = parseFloat(document.getElementById('pmTotal').textContent.replace(/[₹,]/g, '')) || 0;
            if (total <= 0 && fullTotal > 0) {          // patient pays everything later
                if (!confirm('Save this bill with nothing paid now?\n\n₹' + fullTotal.toFixed(2) + ' will be due from the patient.')) return;
                closeModal('paymentModal');
                submitBill(_pendingPrint, { mode: 'Credit', paidAmount: 0 });
                return;
            }

            // Validation per mode
            if (_selectedPayMode === 'Cash') {
                const tendered = parseFloat(document.getElementById('pmTendered').value) || 0;
                if (tendered < total) { showToast('Amount tendered is less than total', 'warning'); return; }
            }
            if (_selectedPayMode === 'Split') {
                const cash = parseFloat(document.getElementById('pmSplitCash').value) || 0;
                const upi = parseFloat(document.getElementById('pmSplitUpi').value) || 0;
                if (Math.abs(cash + upi - total) > 0.5) { showToast('Split amounts must add up to total', 'warning'); return; }
            }

            // Build payment info to pass into bill
            let paymentInfo = { mode: _selectedPayMode };
            if (_selectedPayMode === 'Cash') {
                paymentInfo.tendered = parseFloat(document.getElementById('pmTendered').value) || total;
                paymentInfo.change = paymentInfo.tendered - total;
            }
            if (_selectedPayMode === 'UPI') paymentInfo.ref = document.getElementById('pmUpiRef').value;
            if (_selectedPayMode === 'Card') paymentInfo.ref = document.getElementById('pmCardRef').value;
            if (_selectedPayMode === 'Split') {
                paymentInfo.cash = parseFloat(document.getElementById('pmSplitCash').value) || 0;
                paymentInfo.upi = parseFloat(document.getElementById('pmSplitUpi').value) || 0;
            }
            if (total < fullTotal - 0.009) paymentInfo.paidAmount = Math.round(total * 100) / 100;

            closeModal('paymentModal');
            submitBill(_pendingPrint, paymentInfo);
        }
        // ============ END PAYMENT MODAL ============

        async function submitBill(shouldPrint = false, paymentInfo = { mode: 'Cash' }) {
            if (cart.length === 0) {
                showToast('Add medicines to cart first', 'warning');
                return;
            }

            const patientName = document.getElementById('patientName').value;
            if (!patientName) {
                showToast('Enter patient name', 'warning');
                return;
            }

            // Show saving animation
            showSaving();

            // Disable buttons
            document.getElementById('saveBillBtn').disabled = true;
            document.getElementById('printBillBtn').disabled = true;

            const billId = 'BILL-' + Date.now();
            const today = new Date().toLocaleDateString('en-CA');
            const subtotal = cart.reduce((sum, item) => sum + (item.qty * item.price), 0);
            const costTotal = cart.reduce((sum, item) => sum + (item.qty * (parseFloat(item.costPrice) || 0)), 0);
            const discountPct = clampDiscount();
            const discount = Math.round(subtotal * discountPct) / 100;
            const total = Math.round((subtotal - discount) * 100) / 100;

            const billData = {
                billId: billId,
                patientName: patientName,
                doctor: document.getElementById('doctor').value,
                phone: document.getElementById('patientPhone').value,
                date: today,
                subtotal: subtotal,
                discount: discount,
                total: total,
                costTotal: costTotal,
                paymentMode: paymentInfo.mode,
                paymentRef: paymentInfo.ref || '',
                paidAmount: paymentInfo.paidAmount !== undefined ? paymentInfo.paidAmount : total,
                balanceDue: paymentInfo.paidAmount !== undefined ? Math.round((total - paymentInfo.paidAmount) * 100) / 100 : 0,
                patientId: (window.V31 && V31.enabled()) ? V31.patientIdFor('patientName', 'patientPhone') : '',
                items: cart.map(item => ({
                    medicineId: item.id,
                    medicineName: item.name,
                    qty: item.qty,
                    price: item.price,
                    costPrice: item.costPrice,
                    amount: item.qty * item.price
                }))
            };

            // Show the bill immediately; its status changes to ✅ saved once the server confirms it.
            bills.push({...billData, syncStatus: 'saving'});
            updateBillsTable();
            updateDashboard();

            // Update stock locally
            billData.items.forEach(item => {
                const med = medicines.find(m => String(m.id) === String(item.medicineId));
                if (med) med.stock = Math.max(0, (med.stock || 0) - item.qty);
            });
            updateInventoryTable();

            hideSaving();
            document.getElementById('saveBillBtn').disabled = false;
            document.getElementById('printBillBtn').disabled = false;
            showToast(`🧾 Bill created · ${paymentInfo.mode}. Saving to server…`, 'info');

            if (shouldPrint) printBill();
            document.getElementById('whatsappBtn').style.display = 'block';

            // ✅ Show Bill Payment Done popup with bill copy
            showBillSuccess(billData, paymentInfo);

            // Auto-clear cart after payment (no confirm needed — payment already confirmed)
            cart = [];
            document.getElementById('patientName').value = '';
            { const pn = document.getElementById('patientName'); if (pn && pn._v31Clear) pn._v31Clear(); }
            document.getElementById('patientPhone').value = '';
            document.getElementById('doctor').value = '';
            document.getElementById('discountPct').value = '0';
            renderCart();
            recalc();
            updateReceipt();

            // 🔄 SAVE ON THE SERVER — it re-checks prices, totals, discount and stock (FEFO)
            setBillSyncStatus('saving');
            API.call('saveBill', {
                billId: billId, patientName: billData.patientName, doctor: billData.doctor || '', phone: billData.phone || '',
                date: today, subtotal: subtotal.toFixed(2), discount: discount.toFixed(2), total: total.toFixed(2),
                paymentMode: paymentInfo.mode, paymentRef: paymentInfo.ref || '',
                cashAmount: paymentInfo.mode === 'Split' ? (paymentInfo.cash || 0) : '', upiAmount: paymentInfo.mode === 'Split' ? (paymentInfo.upi || 0) : '',
                paidAmount: paymentInfo.paidAmount !== undefined ? paymentInfo.paidAmount.toFixed(2) : '', patientId: billData.patientId || '',
                items: JSON.stringify(billData.items)
            }).then(res => applyBillSaveResult(billId, res, billData.items));
        }

        // One place that turns the server's answer into what staff see.
        function applyBillSaveResult(billId, res, items) {
            const b = bills.find(x => x.billId === billId);
            if (res && res.success) {
                if (b) { b.syncStatus = 'saved'; if (res.billNo) b.billNo = res.billNo; if (res.costTotal !== undefined && currentRole === 'owner') b.costTotal = res.costTotal;
                    if (res.balanceDue !== undefined) { b.paidAmount = res.paidAmount; b.balanceDue = res.balanceDue; b.paymentStatus = res.balanceDue > 0.009 ? (res.paidAmount > 0 ? 'Partial' : 'Unpaid') : 'Paid'; } }
                setBillSyncStatus('saved', res.billNo);
                showToast('☁️ Saved on server' + (res.billNo ? ' · ' + res.billNo : ''), 'success');
                if (res.warnings && res.warnings.length) showToast('⚠️ ' + res.warnings.join(' · '), 'warning');
                if (b && res.balanceDue > 0.009 && window.V31) V31.money.noteDue('BILL', b);
            } else if (res && res.queued) {
                if (b) b.syncStatus = 'pending';
                setBillSyncStatus('pending');
                showToast('📴 Bill kept on this device — it will be sent automatically', 'warning');
            } else {
                if (b) { b.syncStatus = 'failed'; b.syncError = res && res.error; }
                setBillSyncStatus('failed', res && res.error);
                // undo the on-screen stock change; the server did not record this sale
                (items || []).forEach(it => { const m = medicines.find(x => String(x.id) === String(it.medicineId)); if (m) m.stock += it.qty; });
                bills = bills.filter(x => x.billId !== billId);
                alert('❌ This bill was NOT saved.\n\nReason: ' + ((res && res.error) || 'unknown') + '\n\nNothing was recorded on the server. Please correct and bill again.');
            }
            updateBillsTable(); updateDashboard(); updateInventoryTable(); updateMedicineSelect();
        }
        window.applyBillSaveResult = applyBillSaveResult;

        function setBillSyncStatus(state, info) {
            let el = document.getElementById('bsSyncStatus');
            const anchor = document.getElementById('bsBillId');
            if (!el && anchor && anchor.parentNode) {
                el = document.createElement('div'); el.id = 'bsSyncStatus';
                el.style.cssText = 'margin:6px 0 10px;padding:8px 12px;border-radius:8px;font-weight:700;font-size:13px;text-align:center;';
                anchor.parentNode.insertBefore(el, anchor.nextSibling);
            }
            if (!el) return;
            const S = {
                saving:  ['#fff8e1', '#b7770d', '⏳ Saving on server…'],
                saved:   ['#e8f8ee', '#1e8449', '✅ Saved on server' + (info ? ' · Bill No ' + info : '')],
                pending: ['#fff3e0', '#e67e22', '📴 Saved on this device — will sync when online'],
                failed:  ['#fdecea', '#c0392b', '❌ NOT saved: ' + (info || 'rejected by server')]
            }[state];
            el.style.background = S[0]; el.style.color = S[1]; el.textContent = S[2];
            if (state === 'saved' && info && anchor) anchor.textContent = info;
        }

        function printBill() {
            const receiptText = document.getElementById('receiptPreview').innerText;
            const safeText = receiptText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            const html = '<pre style="font-family:\'Bookman Old Style\',\'Book Antiqua\',Bookman,Georgia,serif;font-size:13px;line-height:1.8;white-space:pre-wrap;word-wrap:break-word;color:#000;">' + safeText + '</pre>';
            printBillHtml(html);
        }

        function shareOnWhatsApp() {
            const patientPhone = document.getElementById('patientPhone').value;
            const patientName = document.getElementById('patientName').value;
            const doctor = document.getElementById('doctor').value;

            if (!patientPhone) {
                showToast('Enter patient phone number', 'warning');
                return;
            }

            let message = `*SRI SAI SPECIALITY DENTAL CARE*\n\nHello ${patientName}!\n\n*Bill Details*\n`;
            message += `Doctor: ${doctor || 'N/A'}\n\n*Medicines:*\n`;

            cart.forEach(item => {
                message += `${item.name}\n  ${item.qty} × ₹${item.price} = ₹${(item.qty * item.price).toFixed(2)}\n`;
            });

            const subtotal = cart.reduce((sum, item) => sum + (item.qty * item.price), 0);
            const discountPct = parseFloat(document.getElementById('discountPct').value) || 0;
            const discount = (subtotal * discountPct) / 100;
            const total = subtotal - discount;

            message += `\n*Total: ₹${total.toFixed(2)}*\n\n`;
            message += `📞 ${CONFIG.clinicPhone}\n📍 ${CONFIG.clinicAddress}\n\nThank you!`;

            const patientCleanPhone = patientPhone.replace(/[^\d]/g, '');
            openWhatsApp(patientCleanPhone, message);
        }

        // INVENTORY
        function updateInventoryTable() {
            const tbody = document.getElementById('inventoryBody');
            const cards = document.getElementById('inventoryCards');
            const stockColor = s => s <= 0 ? '#e74c3c' : s <= 10 ? '#f39c12' : '#27ae60';
            const expTag = med => (med.expiredStock > 0 ? `<div style="font-size:11px;color:#8e44ad;font-weight:700;">+${med.expiredStock} expired</div>` : '');
            const nb = med => (med.batches && med.batches.length > 1 ? ` <span style="font-size:11px;color:#888;">(${med.batches.length} batches)</span>` : '');
            const invList = (window.V31 && V31.stock) ? V31.stock.filterInv(medicines) : medicines;
            const hist = med => (window.V31 && V31.enabled()) ? `<button class="btn-primary btn-small" style="background:#7f8c8d;" data-act="batchHistory" data-id="${esc(med.id)}" title="Batches and stock history">📜</button>` : '';
            const gen = med => med.genericName ? `<div style="font-size:11px;color:#888;">${esc(med.genericName)}${med.barcode ? ' · ▮▯ ' + esc(med.barcode) : ''}</div>` : (med.barcode ? `<div style="font-size:11px;color:#888;">▮▯ ${esc(med.barcode)}</div>` : '');
            tbody.innerHTML = invList.map(med => `
                <tr>
                    <td><strong>${esc(med.name)}</strong>${nb(med)}${gen(med)}</td>
                    <td style="color:${stockColor(med.stock)};font-weight:700;">${med.stock}${expTag(med)}</td>
                    <td>₹${med.price}</td>
                    <td>₹${med.costPrice}</td>
                    <td style="white-space:nowrap;">${esc(med.expiry)}</td>
                    <td style="white-space:nowrap;">
                        <button class="btn-primary btn-small" data-onclick="openEditMedicine('${esc(med.id)}')">✏️ Edit</button>
                        <button class="btn-primary btn-small" style="background:#16a085;" data-onclick="openStockDialog('${esc(med.id)}')">📦 Stock</button>
                        ${hist(med)}
                        <button class="btn-danger btn-small" data-onclick="deleteMedicine('${esc(med.id)}')" title="Hide (history kept)">🗑️</button>
                    </td>
                </tr>
            `).join('');
            if (cards) {
                cards.innerHTML = invList.length ? invList.map(med => {
                    const sc = stockColor(med.stock);
                    return `<div class="m-card" style="border-left-color:${sc}">
                        <div class="m-card-row">
                            <div class="m-card-title">${esc(med.name)}${nb(med)}</div>
                            <div style="font-size:20px;font-weight:900;color:${sc};">${med.stock}${expTag(med)}</div>
                        </div>
                        <div class="m-card-row">
                            <div class="m-card-meta">💰 Sell: ₹${med.price} &nbsp;|&nbsp; Buy: ₹${med.costPrice}</div>
                            <div class="m-card-meta">📅 ${esc(med.expiry)}</div>
                        </div>
                        <div class="m-card-actions">
                            <button style="background:#2c5aa0;" data-onclick="openEditMedicine('${esc(med.id)}')">✏️ Edit</button>
                            <button style="background:#16a085;" data-onclick="openStockDialog('${esc(med.id)}')">📦 Stock</button>
                            ${(window.V31 && V31.enabled()) ? `<button style="background:#7f8c8d;" data-act="batchHistory" data-id="${esc(med.id)}">📜 History</button>` : ''}
                            <button style="background:#e74c3c;" data-onclick="deleteMedicine('${esc(med.id)}')">🗑️</button>
                        </div>
                    </div>`;
                }).join('') : '<div style="text-align:center;color:#aaa;padding:20px;">No medicines in inventory.</div>';
            }
        }

        function openAddMedicineModal() {
            document.getElementById('addMedicineModal').classList.add('active');
        }

        async function saveMedicine() {
            const name = document.getElementById('newMedicineName').value;
            const price = parseFloat(document.getElementById('newMedicinePrice').value);
            const costPrice = parseFloat(document.getElementById('newMedicineCostPrice').value);
            const stock = 0;
            const expiry = document.getElementById('newMedicineExpiry').value;

            if (!name || !price || !costPrice || !expiry) {
                showToast('Fill all fields', 'warning');
                return;
            }

            showSaving();

            // Save locally immediately
            const tempId = Date.now();
            medicines.push({ id: tempId, name, price, costPrice, stock, expiry, __temp: true });
            closeModal('addMedicineModal');
            updateInventoryTable();
            updateMedicineSelect();
            hideSaving();
            showToast('✅ Medicine added! Syncing to Sheets...', 'success');

            // Reset form for next entry
            document.getElementById('newMedicineName').value = '';
            document.getElementById('newMedicinePrice').value = '';
            document.getElementById('newMedicineCostPrice').value = '';
            document.getElementById('newMedicineExpiry').value = '';

            // Sync to Sheets in background
            try {
                const params = new URLSearchParams();
                params.append('action', 'addMedicine');
                params.append('name', name);
                params.append('price', price);
                params.append('costPrice', costPrice);
                params.append('stock', stock);
                params.append('expiry', expiry);
                { const bc = document.getElementById('newMedicineBarcode'), gn = document.getElementById('newMedicineGeneric');
                  if (bc && bc.value.trim()) params.append('barcode', bc.value.trim()); if (gn && gn.value.trim()) params.append('genericName', gn.value.trim());
                  if (bc) bc.value = ''; if (gn) gn.value = ''; }

                fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' })
                    .then(r => r.json())
                    .then(result => {
                        if (result.success) {
                            // Update local ID to real Sheets ID
                            const med = medicines.find(m => String(m.id) === String(tempId));
                            if (med) {
                                med.id = result.medicineId; delete med.__temp;
                                // Refresh dropdowns so they use the real Sheets ID
                                updateMedicineSelect();
                                updateInventoryTable();
                            }
                            showToast('☁️ Medicine synced to Sheets!', 'success');
                        } else {
                            showToast('⚠️ Saved locally, Sheets sync failed', 'warning');
                        }
                    })
                    .catch(() => showToast('⚠️ Saved locally, Sheets offline', 'warning'));
            } catch(e) {
                showToast('⚠️ Saved locally, Sheets offline', 'warning');
            }
        }

        async function deleteMedicine(id) {
            const med = medicines.find(m => String(m.id) === String(id));
            if (!confirm(`Hide "${med ? med.name : id}" from the medicine list?\n\nPast bills keep it. You can't undo this from the app.`)) return;
            const res = await API.call('deleteMedicine', { id: id }, { noQueue: true });
            if (res.success) { medicines = medicines.filter(m => String(m.id) !== String(id)); updateInventoryTable(); updateMedicineSelect(); showToast('🗑️ Medicine hidden', 'success'); }
            else showToast('❌ ' + (res.error || 'Could not remove'), 'error');
        }

        // PURCHASES
        function updatePurchasesTable() {
            const tbody = document.getElementById('purchasesBody');
            const cards = document.getElementById('purchasesCards');
            tbody.innerHTML = purchases.map((p, i) => `
                <tr>
                    <td style="white-space:nowrap;">${esc(p.date)}</td>
                    <td>${esc(p.supplier)}${p.invoiceNo ? `<div style="font-size:11px;color:#888;">Inv ${esc(p.invoiceNo)}</div>` : ''}</td>
                    <td><strong>${esc(p.medicineName)}</strong>${p.batchNo || p.expiry ? `<div style="font-size:11px;color:#888;">Batch ${esc(p.batchNo || '—')} · Exp ${esc(p.expiry || '—')}</div>` : ''}</td>
                    <td style="text-align:center;">${p.qty}</td>
                    <td>₹${p.costPrice}</td>
                    <td style="font-weight:700;">₹${(p.qty * p.costPrice).toFixed(2)}</td>
                    <td><button class="btn-danger btn-small" data-onclick="deletePurchase('${esc(p.id||i)}')">🗑️</button></td>
                </tr>
            `).join('');
            if (cards) {
                cards.innerHTML = purchases.length ? purchases.slice().reverse().map((p, i) => `
                    <div class="m-card">
                        <div class="m-card-row">
                            <div class="m-card-title">${esc(p.medicineName)}</div>
                            <div class="m-card-val">₹${(p.qty * p.costPrice).toFixed(2)}</div>
                        </div>
                        <div class="m-card-meta">🏪 ${esc(p.supplier)} &nbsp;|&nbsp; 📦 Qty: ${p.qty}${p.batchNo ? ' &nbsp;|&nbsp; Batch ' + esc(p.batchNo) : ''}${p.expiry ? ' · Exp ' + esc(p.expiry) : ''}</div>
                        <div class="m-card-meta">💰 Cost: ₹${esc(p.costPrice)}/unit &nbsp;|&nbsp; 📅 ${esc(p.date)}</div>
                        <div class="m-card-actions" style="margin-top:8px;">
                            <button style="background:#e74c3c;" data-onclick="deletePurchase('${esc(p.id||'')}')">🗑️ Delete</button>
                        </div>
                    </div>
                `).join('') : '<div style="text-align:center;color:#aaa;padding:20px;">No purchases yet.</div>';
            }
        }

        async function deletePurchase(id) {
            if (!id) { showToast('Cannot cancel — no ID on this record', 'warning'); return; }
            const reason = (prompt('Cancel this purchase entry?\n\nIts stock is removed again (only possible if none of it was sold). The record is kept as CANCELLED.\n\nReason (required):') || '').trim();
            if (!reason) return;
            if (reason.length < 3) { showToast('Please type a proper reason', 'warning'); return; }
            showSaving();
            const res = await API.call('cancelPurchase', { id: id, reason: reason }, { noQueue: true });
            hideSaving();
            if (res.success) { showToast('✖ Purchase cancelled · stock updated', 'success'); loadData(); }
            else showToast('❌ ' + (res.error || 'Could not cancel'), 'error');
        }

        function openAddPurchaseModal() {
            document.getElementById('purchaseDate').valueAsDate = new Date();
            document.getElementById('purchaseSupplier').value = '';
            document.getElementById('purchaseMedicine').value = '';
            document.getElementById('purchaseQty').value = '1';
            document.getElementById('purchaseCostPrice').value = '';
            ['purchaseBatchNo','purchaseExpiry','purchaseInvoiceNo','purchaseMrp','purchaseFreeQty'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
            document.getElementById('addPurchaseModal').classList.add('active');
        }

        async function savePurchase() {
            const date = document.getElementById('purchaseDate').value;
            const supplier = document.getElementById('purchaseSupplier').value.trim();
            const medicineId = document.getElementById('purchaseMedicine').value;
            const qty = Number(document.getElementById('purchaseQty').value);
            const costPrice = parseFloat(document.getElementById('purchaseCostPrice').value);
            const gv = id => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
            const batchNo = gv('purchaseBatchNo'), expiry = gv('purchaseExpiry'), invoiceNo = gv('purchaseInvoiceNo');
            const mrp = gv('purchaseMrp'), freeQty = Number(gv('purchaseFreeQty') || 0);

            if (!date || !supplier || !medicineId || !qty || !(costPrice >= 0) || !expiry) {
                showToast('Fill date, supplier, medicine, quantity, cost and expiry', 'warning');
                return;
            }
            if (!Number.isInteger(qty) || qty < 1 || !Number.isInteger(freeQty) || freeQty < 0) { showToast('Quantities must be whole numbers', 'warning'); return; }
            if (expiry < todayLocal() && !confirm('This batch is already EXPIRED (' + expiry + '). It will be stored but never sold. Continue?')) return;

            // Try ID match first (string-safe)
            let medicine = medicines.find(m => String(m.id) === String(medicineId));

            // Fallback: match by selected option display name (handles tempId vs real ID mismatch)
            if (!medicine) {
                const selectEl = document.getElementById("purchaseMedicine");
                const selectedText = selectEl.options[selectEl.selectedIndex] ? selectEl.options[selectEl.selectedIndex].text : "";
                const selectedName = selectedText.replace(/\s*\(Stock:.*\)$/, "").trim();
                medicine = medicines.find(m => m.name.trim().toLowerCase() === selectedName.toLowerCase());
            }

            if (!medicine) {
                const selectEl = document.getElementById("purchaseMedicine");
                const dbgText = selectEl.options[selectEl.selectedIndex] ? selectEl.options[selectEl.selectedIndex].text : "none";
                console.warn("savePurchase failed | dropdown value:", medicineId, "| selected text:", dbgText, "| medicine ids:", medicines.map(m=>m.id));
                showToast("❌ Medicine ID mismatch — please close this form and reopen it, then try again.", "error");
                return;
            }

            showSaving();

            if (String(medicine.id).length >= 13 && medicine.__temp) { showToast('This medicine is still being saved — try again in a moment', 'warning'); return; }
            // Save locally immediately (same ID is sent to the server)
            const purchaseId = newId('PUR');
            purchases.push({ id: purchaseId, date, supplier, medicineId: medicine.id, medicineName: medicine.name, qty: qty + freeQty, costPrice, batchNo, expiry, invoiceNo });
            if (expiry >= todayLocal()) medicine.stock = (medicine.stock || 0) + qty + freeQty;

            // Reset form fields for next entry
            document.getElementById('purchaseSupplier').value = '';
            document.getElementById('purchaseMedicine').value = '';
            document.getElementById('purchaseQty').value = '1';
            document.getElementById('purchaseCostPrice').value = '';
            document.getElementById('purchaseDate').valueAsDate = new Date();

            closeModal('addPurchaseModal');
            updatePurchasesTable();
            updateInventoryTable();
            updateMedicineSelect();
            hideSaving();
            showToast('✅ Purchase saved! Syncing to Sheets...', 'success');

            // Sync to Sheets in background
            try {
                const params = new URLSearchParams();
                params.append('action', 'addPurchase');
                params.append('id', purchaseId);
                params.append('date', date);
                params.append('supplier', supplier);
                params.append('medicineId', medicine.id);
                params.append('medicineName', medicine.name);
                params.append('qty', qty);
                params.append('freeQty', freeQty);
                params.append('costPrice', costPrice);
                params.append('batchNo', batchNo);
                params.append('expiry', expiry);
                params.append('invoiceNo', invoiceNo);
                params.append('mrp', mrp);

                fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' })
                    .then(r => r.json())
                    .then(result => {
                        if (result.success) {
                            showToast('☁️ Purchase saved · batch ' + (batchNo || 'added'), 'success'); loadData();
                        } else {
                            showToast('❌ Purchase NOT saved: ' + (result.error || 'rejected'), 'error'); loadData();
                        }
                    })
                    .catch(() => showToast('⚠️ Saved locally, Sheets offline', 'warning'));
            } catch(e) {
                showToast('⚠️ Saved locally, Sheets offline', 'warning');
            }
        }

        // BILLS TABLE
        function updateBillsTable() {
            const tbody = document.getElementById('billsBody');
            const cardsEl = document.getElementById('billsCards');
            const __allBills = bills.slice().reverse();
            const sorted = __lazySlice('bills', __allBills); // lazy: 50 at a time

            if (!sorted.length) {
                if(tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#aaa;padding:20px;">No bills yet.</td></tr>';
                if(cardsEl) cardsEl.innerHTML = '<div style="text-align:center;color:#aaa;padding:30px;">No bills yet.</div>';
                return;
            }

            let tableRows = '';
            let cardHtml  = '';

            sorted.forEach(bill => {
                let items = bill.items || [];
                if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }

                const isCB = bill.billId && String(bill.billId).startsWith('CB-');
                const printFn = isCB ? `reprintCbBillFromAllBills('${esc(bill.billId)}')` : `reprrintBill('${esc(bill.billId)}')`;
                const waFn    = isCB ? `shareWhatsAppCb('${esc(bill.billId)}')` : `shareWhatsApp('${esc(bill.billId)}')`;

                const payColor = bill.paymentMode==='Cash'?'#e8f8ee':bill.paymentMode==='UPI'?'#fff3e0':bill.paymentMode==='Card'?'#e8f0fe':'#fce4ec';
                const payText  = bill.paymentMode==='Cash'?'#27ae60':bill.paymentMode==='UPI'?'#e67e22':bill.paymentMode==='Card'?'#2c5aa0':'#c0392b';

                const medNames = items.map(i => {
                    const m = medicines.find(x => String(x.id)===String(i.medicineId));
                    return esc(i.medicineName||(m?m.name:null)||i.name||'—');
                });

                // ── Desktop table row ──
                const typeBadge = isCB
                    ? `<span style="background:#e8f0fe;color:#2c5aa0;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;">🧾 Bill Summary</span>`
                    : `<span style="background:#e8f8ee;color:#27ae60;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;">💊 Pharmacy</span>`;
                const trInfo = (isCB && bill.trDesc)
                    ? `<div><span style="background:#f0f4ff;color:#1e3f5a;border-radius:4px;padding:2px 7px;font-size:12px;">🦷 ${esc(bill.trDesc.substring(0,35))}${bill.trDesc.length>35?'...':''}</span></div>`
                    : '';
                const medBadges = medNames.length
                    ? medNames.map((n,i2)=>`<span style="display:inline-block;background:#e8f0fe;color:#2c5aa0;border-radius:4px;padding:2px 7px;margin:2px;font-size:12px;">${n} ×${items[i2].qty}</span>`).join('')
                    : '<span style="color:#aaa;font-size:12px;">—</span>';

                const syncBadge = syncBadgeHtml(bill.syncStatus, bill.syncError);
                const cancelBtn = currentRole === 'owner' ? `<button class="btn-danger btn-small" data-onclick="cancelBillUI('${esc(bill.billId)}')" title="Cancel bill (kept in records)" style="margin-left:4px;">✖</button>` : '';
                tableRows += `<tr>
                    <td style="font-size:11px;font-family:monospace;">${esc(bill.billNo || bill.billId)}${syncBadge}</td>
                    <td>${typeBadge}</td>
                    <td>${esc(bill.patientName||'—')}</td>
                    <td>${esc(bill.doctor||'—')}</td>
                    <td style="max-width:200px;">${trInfo}${medBadges}</td>
                    <td style="font-weight:700;">₹${parseFloat(bill.total||0).toFixed(2)}</td>
                    <td><span style="background:${payColor};color:${payText};border-radius:4px;padding:2px 8px;font-size:12px;font-weight:600;">${esc(bill.paymentMode||'—')}</span>${window.V31 ? V31.money.billBadges(bill) : ''}</td>
                    <td style="white-space:nowrap;">${esc(bill.date||'—')}</td>
                    <td style="white-space:nowrap;">
                        ${window.V31 ? V31.money.billButton(bill) : ''}<button class="btn-primary btn-small" data-onclick="${printFn}" style="margin-right:4px;">🖨️ Print</button>
                        <button class="btn-primary btn-small" data-onclick="${waFn}" style="background:#25d366;">📲 WA</button>${cancelBtn}
                    </td>
                </tr>`;

                // ── Mobile card ──
                const typeLabel = isCB ? '🧾 Bill Summary' : '💊 Pharmacy';
                const typeColor = isCB ? '#2c5aa0' : '#27ae60';
                const medLine   = medNames.length ? medNames.map((n,i2)=>`${n} ×${items[i2].qty}`).join(', ') : '';
                const trLine    = (isCB && bill.trDesc) ? `<div class="bill-card-meta">🦷 ${esc(bill.trDesc.substring(0,50))}${bill.trDesc.length>50?'...':''}</div>` : '';

                cardHtml += `<div class="bill-card ${isCB?'bc-cb':'bc-ph'}">
                    <div class="bill-card-top">
                        <div>
                            <div class="bill-card-name">${esc(bill.patientName||'—')}${syncBadge}</div>
                            <span style="background:${isCB?'#e8f0fe':'#e8f8ee'};color:${typeColor};border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;">${typeLabel}</span>
                        </div>
                        <div style="text-align:right;">
                            <div class="bill-card-total">₹${parseFloat(bill.total||0).toFixed(2)}</div>
                            <div style="font-size:11px;color:#888;">${esc(bill.date||'')}</div>
                        </div>
                    </div>
                    <div class="bill-card-meta">👨‍⚕️ ${esc(bill.doctor||'—')} &nbsp;|&nbsp; <span class="pay-badge" style="background:${payColor};color:${payText};">${esc(bill.paymentMode||'—')}</span>${window.V31 ? V31.money.billBadges(bill) : ''}</div>
                    ${trLine}
                    ${medLine?`<div class="bill-card-meta">💊 ${medLine}</div>`:''}
                    <div class="bill-card-actions" style="margin-top:10px;">
                        ${window.V31 && V31.money.billButton(bill) ? `<button class="bc-print-btn" style="background:#8e44ad;" data-act="billDetail" data-type="BILL" data-id="${esc(bill.billId)}">💰 Payments</button>` : ''}<button class="bc-print-btn" data-onclick="${printFn}">🖨️ Print</button>
                        <button class="bc-wa-btn" data-onclick="${waFn}">📲 WhatsApp</button>
                        ${currentRole === 'owner' ? `<button class="bc-print-btn" style="background:#e74c3c;" data-onclick="cancelBillUI('${esc(bill.billId)}')">✖ Cancel</button>` : ''}
                    </div>
                </div>`;
            });

            if(tbody)    tbody.innerHTML    = tableRows + __lazyMore('bills', __allBills.length, sorted.length, 9);
            if(cardsEl)  cardsEl.innerHTML  = cardHtml + __lazyMore('bills', __allBills.length, sorted.length);
        }

        function syncBadgeHtml(status, err) {
            if (status === 'pending' || status === 'saving') return ' <span title="Waiting to reach the server" style="background:#fff3e0;color:#e67e22;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700;">⏳ pending</span>';
            if (status === 'failed') return ' <span title="' + esc(err || '') + '" style="background:#fdecea;color:#c0392b;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700;">❌ not saved</span>';
            return '';
        }

        // Cancelled bills: kept for the record, excluded from revenue.
        function renderCancelledBills() {
            const page = document.getElementById('allbills'); if (!page || currentRole !== 'owner') return;
            let wrap = document.getElementById('cancelledBillsWrap');
            if (!wrap) { wrap = document.createElement('details'); wrap.id = 'cancelledBillsWrap'; wrap.style.cssText = 'margin-top:18px;background:#fff;border-radius:10px;padding:12px 16px;'; page.appendChild(wrap); }
            const list = cancelledBills.slice().reverse();
            wrap.innerHTML = `<summary style="cursor:pointer;font-weight:700;color:#c0392b;">✖ Cancelled bills (${list.length}) — not counted in revenue</summary>` +
                (list.length ? `<div class="tbl-wrap"><table class="table" style="margin-top:10px;"><thead><tr><th>Bill</th><th>Patient</th><th>Total</th><th>Date</th><th>Cancelled</th><th>Reason</th></tr></thead><tbody>` +
                list.map(b => `<tr><td style="font-family:monospace;font-size:11px;">${esc(b.billNo || b.billId)}</td><td>${esc(b.patientName)}</td><td>₹${(+b.total||0).toFixed(2)}</td><td>${esc(b.date)}</td><td>${esc(b.cancelledAt||'')} · ${esc(b.cancelledBy||'')}</td><td>${esc(b.cancelReason||'')}</td></tr>`).join('') +
                `</tbody></table></div>` : '<p style="color:#888;margin-top:8px;">None.</p>');
        }

        async function cancelBillUI(billId) {
            const b = bills.find(x => x.billId === billId); if (!b) return;
            const reason = (prompt(`Cancel bill ${b.billNo || billId} (${b.patientName}, ₹${(+b.total||0).toFixed(2)})?

The bill is kept in the records as CANCELLED and removed from revenue.

Reason (required):`) || '').trim();
            if (!reason) return;
            if (reason.length < 3) { showToast('Please type a proper reason', 'warning'); return; }
            const restore = confirm('Return the medicines on this bill to stock?\n\nOK = yes, the medicines came back\nCancel = no (e.g. already used)');
            showSaving();
            const res = await API.call('cancelBill', { billId: billId, reason: reason, restoreStock: restore }, { noQueue: true });
            hideSaving();
            if (res.success) { showToast('✖ Bill cancelled' + (restore ? ' · stock restored' : ''), 'success'); loadData(); }
            else showToast('❌ ' + (res.error || 'Could not cancel'), 'error');
        }

        // Filter bills by patient name search
        function filterBills() {
            const q = (document.getElementById('billsSearch').value||'').toLowerCase();
            if (!q) { updateBillsTable(); return; }
            const filtered = bills.filter(b => ((b.patientName||'') + ' ' + (b.billNo||'') + ' ' + (b.phone||'')).toLowerCase().includes(q));
            const saved = bills;
            bills = filtered;
            updateBillsTable();
            bills = saved;
        }

        // Old "delete" now means cancel (records are never erased)
        function deleteBill(billId) { return cancelBillUI(billId); }

                function closePrintModal() {
            const m = document.getElementById('__printModal');
            const s = document.getElementById('__printModalStyle');
            if (m) m.remove();
            if (s) s.remove();
        }

        // PRINT ENGINE — uses hidden iframe, works on iPad/iPhone Safari, Chrome, Firefox, Android
        // No popup windows means no freezing on mobile/tablet
        // ── PRINT CHOICE DIALOG ────────────────────────────────
        var __pendingPrintHtml = null;

        function printBillHtml(html) {
            var savingOverlay = document.getElementById('savingOverlay');
            if (savingOverlay) savingOverlay.style.display = 'none';
            __pendingPrintHtml = html;
            // Show print-choice dialog
            var dlg = document.getElementById('__printChoiceDlg');
            if (dlg) {
                // Update BT button state
                var btBtn = document.getElementById('__pcdBtBtn');
                if (btBtn) {
                    if (window._btPrinter && window._btPrinter.connected) {
                        btBtn.innerHTML = '🔵 Thermal Print<br><span style="font-size:11px;opacity:0.85;">80mm · '+(_btPrinter.deviceName||'BT Printer')+'</span>';
                        btBtn.style.opacity = '1';
                        btBtn.style.pointerEvents = 'auto';
                    } else {
                        btBtn.innerHTML = '🔵 Thermal Print<br><span style="font-size:11px;opacity:0.85;">Tap to connect printer</span>';
                        btBtn.style.opacity = '0.75';
                        btBtn.style.pointerEvents = 'auto';
                    }
                }
                dlg.style.display = 'flex';
                requestAnimationFrame(function(){
                    var sheet = document.getElementById('__pcdSheet');
                    if(sheet) sheet.style.transform = 'translateY(0)';
                });
            } else {
                _doPrintRegular(html);
            }
        }

        function _doPrintRegular(html) {
            var fullHtml = '<!DOCTYPE html><html><head>' +
                '<meta charset="UTF-8">' +
                '<meta name="viewport" content="width=device-width,initial-scale=1">' +
                '<title>Bill - Sri Sai Speciality Dental Care</title>' +
                '<style>html,body{margin:0;padding:0;background:white;color:#000;font-family:"Bookman Old Style","Book Antiqua",Bookman,Georgia,serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}@page{margin:10mm;size:A4 portrait;}@media print{html,body{margin:0;padding:0;}.no-print{display:none!important;}}</style>' +
                '</head><body>' + html + '</body></html>';
            // Android app: print through Android's print service (printer or "Save as PDF")
            if (typeof window.ssdcNativePrint === 'function') { window.ssdcNativePrint(fullHtml); return; }
            var old = document.getElementById('__printIframe');
            if (old) old.remove();
            var iframe = document.createElement('iframe');
            iframe.id = '__printIframe';
            iframe.setAttribute('aria-hidden', 'true');
            iframe.style.cssText = 'position:fixed;width:1px;height:1px;top:-9999px;left:-9999px;border:none;visibility:hidden;';
            document.body.appendChild(iframe);
            try {
                var iDoc = iframe.contentDocument || iframe.contentWindow.document;
                iDoc.open(); iDoc.write(fullHtml); iDoc.close();
                var isIpadSafari = /iPad|iPhone|iPod/.test(navigator.userAgent) && !/CriOS/.test(navigator.userAgent);
                setTimeout(function() {
                    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); }
                    catch(pe) { iframe.remove(); _showPrintOverlay(html); return; }
                    setTimeout(function() { var f=document.getElementById('__printIframe'); if(f)f.remove(); }, 4000);
                }, isIpadSafari ? 950 : 500);
                return;
            } catch(e) { iframe.remove(); }
            _showPrintOverlay(html);
        }

        function __closePrintChoice() {
            var dlg = document.getElementById('__printChoiceDlg');
            var sheet = document.getElementById('__pcdSheet');
            if(sheet) sheet.style.transform = 'translateY(110%)';
            setTimeout(function(){ if(dlg) dlg.style.display='none'; }, 320);
        }

        function __pickRegularPrint() {
            __closePrintChoice();
            setTimeout(function(){ _doPrintRegular(__pendingPrintHtml || ''); }, 350);
        }

        function __pickThermalPrint() {
            __closePrintChoice();
            setTimeout(function(){ __showThermalPreview(__pendingPrintHtml || ''); }, 350);
        }

        function __closeThermalPreview() {
            var dlg = document.getElementById('__thermalPreviewDlg');
            if (!dlg) return;
            dlg.classList.remove('open');
            setTimeout(function(){ dlg.style.display='none'; }, 300);
        }

        function __thermalPrintNow() {
            __closeThermalPreview();
            setTimeout(function(){
                if (window._btPrinter && window._btPrinter.connected) _doThermalPrint(__pendingPrintHtml || '');
                else openBtPrinterPanel(true);
            }, 200);
        }

        function __showThermalPreview(html) {
            var dlg = document.getElementById('__thermalPreviewDlg');
            var rollEl = document.getElementById('__tpvContent');
            if (!dlg || !rollEl) return;
            function renderLines() {
                var lines = __buildThermalPreviewLines(html);
                var qrAmount = 0;
                rollEl.innerHTML = lines.map(function(l){
                    if (l.qr) {
                        qrAmount = l.amount || 289.60;
                        return '<div class="__tpvQrWrap" id="__tpvQrBox" style="text-align:center;padding:8px 0;background:#fdfaf4;"></div>';
                    }
                    // Full-width CSS dividers — always span edge to edge
                    if (l.divider) {
                        var t = l.text||'';
                        if (t.indexOf('=') >= 0) return '<div class="__tpvDivFull __tpvDivLine"></div>';
                        if (t.indexOf('.') >= 0) return '<div class="__tpvDivFull __tpvDotLine"></div>';
                        return '<div class="__tpvDivFull __tpvDashLine"></div>';
                    }
                    if (l.star) return '<div class="__tpvDivFull __tpvStarLine"></div>';
                    var cls = '__tpvLine';
                    if(l.center||l.tall) cls += ' center';
                    if(l.bold)    cls += ' bold';
                    if(l.tall)    cls += ' tall';
                    var txt = (l.text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                    return '<div class="'+cls+'">'+txt+'</div>';
                }).join('');

                // Render actual QR code into the placeholder div
                var qrBox = document.getElementById('__tpvQrBox');
                if (qrBox && qrAmount > 0) {
                    var upiUrl = 'upi://pay?pa=8688033072@ybl&pn=SriSaiDental&am='+qrAmount.toFixed(2)+'&cu=INR&tn=DentalBill';
                    __renderQRtoDiv(qrBox, upiUrl, 72);
                }

                // Scroll to top after render
                var sc = document.getElementById('__tpvScrollArea');
                if (sc) {
                    sc.scrollTop = 0;
                    sc.onscroll = function() {
                        var thumb = document.getElementById('__tpvScrollThumb');
                        if (!thumb) return;
                        var pct = sc.scrollHeight <= sc.clientHeight ? 1 :
                            sc.scrollTop / (sc.scrollHeight - sc.clientHeight);
                        var w = Math.max(15, Math.round(pct * 70));
                        var left = Math.round(pct * (100 - w));
                        thumb.style.width = w + '%';
                        thumb.style.left  = left + '%';
                    };
                }
            }
            // Show dialog, wait two frames for layout, then render
            dlg.style.display = 'flex';
            requestAnimationFrame(function(){
                dlg.classList.add('open');
                requestAnimationFrame(function(){
                    requestAnimationFrame(renderLines);
                });
            });
        }

        // Paid / balance due of a printed bill: data-paid/data-due (pharmacy + combined bills)
        // or the due line of a part-paid dental receipt. null = no payment details on the page.
        function __thermalPay(doc, total) {
            var el = doc.querySelector('[data-due]');
            if (el) {
                var due = parseFloat(el.getAttribute('data-due')) || 0, paid = parseFloat(el.getAttribute('data-paid'));
                if (!isFinite(paid)) paid = Math.max(0, total - due);
                return { paid: paid, due: due, total: total };
            }
            var dl = doc.querySelector('#__tr .due-line');
            if (dl) {
                var n = (dl.textContent.replace(/,/g, '').match(/\d+(\.\d+)?/g) || []).map(parseFloat);
                if (n.length >= 3) return { total: n[0], paid: n[1], due: n[2] };
            }
            return null;
        }

        function __buildThermalPreviewLines(html) {
            // W = characters per line. We use font-size:12px Courier New.
            // Courier New 12px → char width ≈ 7.2px on desktop, ~7.8px on mobile (due to DPI/rendering)
            // Roll inner width = modal sheet width (max 430px) minus scroll(8px) minus padding(16px) = ~392px
            // On mobile we use a larger char-width estimate to avoid overflow.
            var rollEl = document.getElementById('__tpvContent');
            var innerPx = 260; // safe fallback
            if (rollEl && rollEl.offsetWidth > 0) {
                // subtract padding (8px each side) + small buffer
                innerPx = rollEl.offsetWidth - 24;
            }
            // Use same _W as actual print — ensures preview matches real output exactly
            // _W is loaded from localStorage (default 42 for KP307)
            var W = (typeof _W !== 'undefined' && _W >= 24) ? _W : 42;

            var lines = [];
            function rep(c,n)   { return n>0 ? c.repeat(Math.ceil(n)) : ''; }
            function dbl()      { lines.push({text:rep('=',W), divider:true}); }
            function div_()     { lines.push({text:rep('-',W), divider:true}); }
            function dot()      { lines.push({text:rep('.',W), divider:true}); }
            function star()     { lines.push({text:rep('=',W), divider:true}); }
            function nl()       { lines.push({text:''}); }
            function ctr(t,b,tl){ lines.push({text:String(t||''),center:true,bold:!!b,tall:!!tl}); }
            function lft(t,b)   { lines.push({text:String(t||'').substring(0,W),bold:!!b}); }
            function tr_(s,w)   { return String(s||'').substring(0,w||W); }
            // Right-align `r` after `l` with spaces
            function spc(l,r) {
                l = String(l||''); r = String(r||'');
                var sp = W - l.length - r.length;
                if (sp < 1) { l = l.substring(0, W - r.length - 1); sp = 1; }
                lines.push({text: l + rep(' ',sp) + r});
            }
            function isSample(){ return !html || html.replace(/<[^>]*>/g,'').replace(/\s/g,'').length < 20; }

            // ── HEADER ───────────────────────────────────────
            ctr('SRI SAI SPECIALITY DENTAL CARE', true, true);
            ctr('~ Smile With Confidence ~', false, false);
            star();
            ctr('TKR College Rd, Karmanghat', true);
            ctr('Ph: 9396522492 / 8688033072', true);
            star();

            function addSampleMeds() {
                ctr('- MEDICINES -', true);
                dot(); spc('  Item','Amt'); dot();
                spc('  Apcil 375mg  x6 @Rs.18.10', '108.60');
                spc('  Cenodol-SP   x6 @Rs.9.00 ', ' 54.00');
                spc('  Metro hex    x1 @Rs.127.00', '127.00');
                dot();
                spc('Pharmacy', 'Rs.289.60');
            }
            function addFooter(gt, qrTitle) {
                nl(); dbl();
                ctr('*  THANK YOU  *', true, true);
                ctr('Beauty is Power, Smile is a Sword', true);
                ctr('Visit Again! Stay Healthy :)', true);
                dbl(); nl();
                star();
                ctr(qrTitle || 'SCAN & PAY', true);
                nl();
                // Special QR marker — replaced with canvas after render
                lines.push({text:'__QR__:'+(gt>0?gt.toFixed(2):'289.60'), qr:true, amount:(gt>0?gt:289.60)});
                nl();
                ctr('Rs. ' + (gt > 0 ? gt.toFixed(2) : '289.60'), true, true);
                ctr('8688033072@ybl', true);
                ctr('GPay / PhonePe / Any UPI');
                star();
            }

            // ── SAMPLE PATH ──────────────────────────────────
            if (isSample()) {
                lft('Bill No : BILL-' + Date.now().toString().slice(-6));
                lft('Date    : ' + new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}));
                lft('Patient : Mamatha');
                lft('Doctor  : Dr. T Sai Vakula');
                div_(); addSampleMeds();
                dbl(); ctr('** GRAND TOTAL **',true,true); ctr('Rs. 289.60',true,true); dbl();
                addFooter(289.60);
                return lines;
            }

            // ── REAL BILL PATH ───────────────────────────────
            html = html.replace(/&#8377;/g,'Rs.').replace(/\u20b9/g,'Rs.').replace(/&nbsp;/g,' ');
            var doc2 = (new DOMParser()).parseFromString(html,'text/html');
            var grandTotal = 0;
            var isCB = !!doc2.getElementById('__cb');
            var isRx = !!doc2.getElementById('__rx');
            var isTr = !!doc2.getElementById('__tr');

            if (isCB) {
                var cb = doc2.getElementById('__cb');
                var iv = Array.from(cb.querySelectorAll('.i-val')).map(function(e){
                    return e.textContent.replace(/\u00a0/g,' ').trim();
                });
                if(iv[0]) lft('Bill No : '+tr_(iv[0],W-9), true);
                if(iv[1]) lft('Date    : '+tr_(iv[1],W-9));
                if(iv[2]) lft('Patient : '+tr_(iv[2],W-9));
                if(iv[3]) lft('Doctor  : '+tr_(iv[3],W-9));
                div_();
                var mTable=cb.querySelector('table.meds'), meds2=[];
                if(mTable){ Array.from(mTable.querySelectorAll('tbody tr')).forEach(function(row){
                    var td=Array.from(row.querySelectorAll('td')).map(function(c){return c.textContent.trim();});
                    if(td.length<2||!td[0]||/no medicines/i.test(td[0]))return;
                    meds2.push({name:td[0],qty:td[1]||'',rate:td[2]||'',amount:td[td.length-1]});
                });}
                // Safe money parser for this scope
                function pM(s){var m=String(s||'').replace(/,/g,'').match(/(\d+\.?\d*)/);return m?parseFloat(m[1]):0;}
                if(meds2.length>0){
                    ctr('- MEDICINES -',true); dot(); spc('  Item','Amt'); dot();
                    meds2.forEach(function(m){
                        var aStr=pM(m.amount).toFixed(2);
                        var left='  '+tr_(m.name,13)+(m.qty?' x'+m.qty:'')+(m.rate?' @'+m.rate:'');
                        spc(tr_(left,W-aStr.length-1), aStr);
                    }); dot();
                }
                var sBox=cb.querySelector('.summary-box'), sRows2=[];
                if(sBox){Array.from(sBox.querySelectorAll('tr')).forEach(function(row){
                    var td=Array.from(row.querySelectorAll('td')).map(function(c){return c.textContent.trim();});
                    if(td.length>=2&&td[0]&&td[1])sRows2.push({label:td[0],value:td[1]});
                });}
                sRows2.slice(0,-1).forEach(function(r){
                    var lbl = tr_(r.label.replace(/[^ -~]/g,'').trim(),W-12);
                    var val = 'Rs.'+pM(r.value).toFixed(2);
                    var sp = W-lbl.length-val.length;
                    if(sp<1){lbl=lbl.substring(0,W-val.length-1);sp=1;}
                    lines.push({text:lbl+' '.repeat(sp)+val, bold:true});
                });
                if(sRows2.length>0){
                    var g=sRows2[sRows2.length-1];
                    grandTotal=pM(g.value)||0;
                    dbl(); ctr('** GRAND TOTAL **',true,true); ctr('Rs. '+grandTotal.toFixed(2),true,true); dbl();
                }

            } else if (isTr) {
                var trEl=doc2.getElementById('__tr');
                var iV2=Array.from(trEl.querySelectorAll('.i-val')).map(function(e){
                    return e.textContent.replace(/\u00a0/g,' ').trim();
                });
                if(iV2[0]) lft('Bill No : '+tr_(iV2[0],W-9),true);
                if(iV2[1]) lft('Date    : '+tr_(iV2[1],W-9));
                if(iV2[2]) lft('Patient : '+tr_(iV2[2],W-9));
                if(iV2[3]) lft('Amount  : Rs.'+tr_(iV2[3],W-12));
                div_();
                var trRows2=Array.from(trEl.querySelectorAll('table.treat td.item-cell')).map(function(td){return td.textContent.trim();}).filter(Boolean);
                if(trRows2.length){ lft('TOWARDS:',true); trRows2.forEach(function(l){ctr(l.trim(),true,false);}); }
                grandTotal=parseFloat((iV2[3]||'0').replace(/[^\d.]/g,''))||0;
                var trPay2 = __thermalPay(doc2, grandTotal); if (trPay2 && trPay2.total) grandTotal = trPay2.total;
                if(grandTotal>0){ dbl(); ctr('** TOTAL **',true,true); ctr('Rs. '+grandTotal.toFixed(2),true,true); dbl(); }

            } else if (isRx) {
                var rxEl=doc2.getElementById('__rx');
                (rxEl?(rxEl.innerText||rxEl.textContent):'').split('\n')
                    .map(function(l){return l.trim();}).filter(Boolean).slice(0,20)
                    .forEach(function(l){if(!/^(sri sai|mob|timing|reg\.|b\.d)/i.test(l))lft(tr_(l,W));});

            } else if (doc2.getElementById('__ph')) {
                // ── Pharmacy bill: same data as the printer (data-* on #__ph) ──
                var phEl = doc2.getElementById('__ph'), A = function (k) { return phEl.getAttribute('data-' + k) || ''; };
                var phIt = []; try { phIt = JSON.parse(decodeURIComponent(A('items') || '[]')); } catch (e) {}
                if (A('billid')) lft('Bill No : ' + tr_(A('billid'), W-9), true);
                lft('Date    : ' + tr_(A('date'), W-9));
                lft('Patient : ' + tr_(A('patient'), W-9));
                lft('Doctor  : ' + tr_(A('doctor'), W-9));
                lft('Payment : ' + tr_(A('mode') || 'Cash', W-9));
                div_(); ctr('- MEDICINES -', true); dot(); spc('  Item', 'Amt'); dot();
                phIt.forEach(function (it) { var a = (+it.amount || 0).toFixed(2); spc(tr_('  ' + (it.name || '') + ' x' + (it.qty || 1), W - a.length - 1), a); });
                dot();
                var phSub2 = +A('subtotal') || 0, phDisc2 = +A('discount') || 0; grandTotal = +A('total') || 0;
                if (phDisc2 > 0) { spc('Subtotal', 'Rs.' + phSub2.toFixed(2)); spc('Discount', '-Rs.' + phDisc2.toFixed(2)); }
                dbl(); ctr('** GRAND TOTAL **', true, true); ctr('Rs. ' + grandTotal.toFixed(2), true, true); dbl();

            } else {
                // ── Generic pharmacy bill ─────────────────────
                var inf = {};
                // Parse .lbl/.val sibling pairs
                Array.from(doc2.querySelectorAll('.lbl')).forEach(function(lbl){
                    var val = lbl.nextElementSibling;
                    if (!val) return;
                    var k = lbl.textContent.trim().toLowerCase();
                    var v = val.textContent.trim();
                    if (!v || v==='—') return;
                    if (/patient|name/.test(k))   inf.patient = inf.patient||v;
                    else if (/doctor|dr/.test(k)) inf.doctor  = inf.doctor||v;
                    else if (/date/.test(k))      inf.date    = inf.date||v;
                    else if (/payment|mode/.test(k)) inf.pay  = inf.pay||v;
                });
                // .bid element for bill id
                var bidEl = doc2.querySelector('.bid');
                if (bidEl) inf.no = bidEl.textContent.trim();

                lft('Bill No : '+tr_(inf.no||'BILL-001', W-9), true);
                lft('Date    : '+tr_(inf.date||new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}),W-9));
                if(inf.patient) lft('Patient : '+tr_(inf.patient, W-9));
                if(inf.doctor)  lft('Doctor  : '+tr_(inf.doctor,  W-9));
                div_();

                // Helper: safely parse a currency string like "Rs.108.60" or "&#8377;108.60"
                function parseMoney(s) {
                    // Find the first run of digits (with optional decimal point)
                    var m = String(s||'').replace(/,/g,'').match(/(\d+\.?\d*)/);
                    return m ? parseFloat(m[1]) : 0;
                }

                // Extract medicine rows
                var meds3 = [];
                Array.from(doc2.querySelectorAll('table tbody tr')).forEach(function(row){
                    var td=Array.from(row.querySelectorAll('td')).map(function(c){return c.textContent.trim();});
                    if (td.length < 2 || !td[0]) return;
                    if (/total|grand|subtotal|discount/i.test(td[0])) return;
                    var amt = parseMoney(td[td.length-1]);
                    if (amt <= 0) return;
                    var qty  = td.length >= 3 ? td[1] : '';
                    var rate = td.length >= 4 ? td[2] : '';
                    meds3.push({name:td[0], qty:qty, rate:rate, amount:amt});
                });

                // Grand total — tr.grand is the last row in .tot table
                var gtEl = doc2.querySelector('tr.grand td:last-child');
                if (gtEl) grandTotal = parseMoney(gtEl.textContent);

                // Fallback: last row of any .tot table
                if (!grandTotal) {
                    var totTbl = doc2.querySelector('.tot table');
                    if (totTbl) {
                        var trows = totTbl.querySelectorAll('tr');
                        for (var ri = trows.length-1; ri >= 0; ri--) {
                            var tds = trows[ri].querySelectorAll('td');
                            if (tds.length >= 2) {
                                var v = parseMoney(tds[tds.length-1].textContent);
                                if (v > 0) { grandTotal = v; break; }
                            }
                        }
                    }
                }

                // Fallback: text scan
                if (!grandTotal) {
                    var bodyTxt = doc2.body ? (doc2.body.innerText||doc2.body.textContent) : '';
                    var gm = bodyTxt.match(/grand\s+total[^\d]*(\d[\d,]*\.?\d*)/i);
                    if (gm) grandTotal = parseFloat(gm[1].replace(/,/g,''))||0;
                }

                if (meds3.length > 0) {
                    ctr('- MEDICINES -',true); dot(); spc('  Item','Amt'); dot();
                    meds3.forEach(function(m){
                        var aStr = m.amount.toFixed(2);
                        var left = '  '+tr_(m.name,14)+(m.qty?' x'+m.qty:'')+(m.rate?' @'+m.rate:'');
                        spc(tr_(left, W-aStr.length-1), aStr);
                    }); dot();
                    spc('Grand Total', 'Rs.'+grandTotal.toFixed(2));
                } else {
                    lft('(no item lines found on this bill)');
                }
                dbl(); ctr('** GRAND TOTAL **',true,true); ctr('Rs. '+grandTotal.toFixed(2),true,true); dbl();
            }

            var pv = __thermalPay(doc2, grandTotal);
            if (pv && pv.due > 0.009) {
                spc('Paid now', 'Rs.' + pv.paid.toFixed(2));
                lines.push({ text: (function () { var l = 'BALANCE DUE', r = 'Rs.' + pv.due.toFixed(2); return l + ' '.repeat(Math.max(1, W - l.length - r.length)) + r; })(), bold: true });
                dbl();
                addFooter(pv.due, 'SCAN TO PAY BALANCE');
            } else addFooter(grandTotal);
            return lines;
        }

        function _showPrintOverlay(html) {
            var modal = document.getElementById('__printModal');
            if (modal) modal.remove();
            var st = document.getElementById('__printModalStyle');
            if (st) st.remove();
            modal = document.createElement('div');
            modal.id = '__printModal';
            modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999999;background:white;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px;box-sizing:border-box;';
            var btnBar = document.createElement('div');
            btnBar.className = 'no-print';
            btnBar.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #2c5aa0;position:sticky;top:0;background:white;z-index:2;';
            btnBar.innerHTML = '<button data-onclick="window.print()" style="padding:12px 28px;background:#2c5aa0;color:white;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;touch-action:manipulation;">🖨️ Print / Save PDF</button>' +
                '<button data-onclick="closePrintModal()" style="padding:12px 20px;background:#e74c3c;color:white;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;touch-action:manipulation;">✕ Close</button>';
            var billDiv = document.createElement('div');
            billDiv.innerHTML = html;
            modal.appendChild(btnBar); modal.appendChild(billDiv);
            document.body.appendChild(modal);
            var style = document.createElement('style');
            style.id = '__printModalStyle';
            style.innerHTML = '@media print{body>*:not(#__printModal){display:none!important;}#__printModal{position:static!important;overflow:visible!important;padding:0!important;}.no-print{display:none!important;}}';
            document.head.appendChild(style);
        }

        // ══ PRESCRIPTION ══════════════════════════════════════
        function buildPrescriptionHTML() {
            const name   = esc(document.getElementById('rx_name').value || '');
            const age    = esc(document.getElementById('rx_age').value || '');
            const sex    = esc(document.getElementById('rx_sex').value || '');
            const dateV  = document.getElementById('rx_date').value || '';
            const rxText = document.getElementById('rx_content').value || '';
            const dateStr = dateV ? new Date(dateV).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) : '___________';

            const emptyLines = Array(8).fill('<div style="min-height:24px;border-bottom:1px dotted #aaa;margin-bottom:3px;">&nbsp;</div>').join('');
            const rxLines = rxText
                ? rxText.split('\n').map(line =>
                    '<div style="min-height:24px;border-bottom:1px dotted #aaa;padding:2px 0;margin-bottom:3px;">'
                    + (line ? line.replace(/&/g,'&amp;').replace(/</g,'&lt;') : '&nbsp;')
                    + '</div>').join('')
                : emptyLines;

            return `<style>
  #__rx, #__rx * { font-family:'Bookman Old Style','Book Antiqua',Bookman,Georgia,serif; box-sizing:border-box; }
  #__rx { color:#000; background:#fff; padding:20px 26px; }
  #__rx h2 { font-size:18px; font-weight:900; letter-spacing:1.5px; text-transform:uppercase; margin:0 0 3px; text-align:center; }
  #__rx .sub { text-align:center; font-size:11.5px; margin-bottom:2px; }
  #__rx .timing { text-align:center; font-size:11px; font-weight:700; margin-bottom:10px; }
  #__rx .docs-row { display:table; width:100%; border:1.5px solid #000; border-collapse:collapse; margin-bottom:12px; }
  #__rx .doc-cell { display:table-cell; width:50%; vertical-align:top; padding:8px 14px; font-size:11.5px; line-height:1.75; text-align:center; }
  #__rx .doc-cell:first-child { border-right:1.5px solid #000; }
  #__rx .doc-cell strong { font-size:13px; display:block; }
  #__rx .note { font-size:10.5px; color:#333; border:1px solid #999; border-radius:3px; padding:5px 10px; margin-bottom:12px; line-height:1.55; }
  #__rx .pt { display:table; width:100%; border-collapse:collapse; margin-bottom:12px; }
  #__rx .pt td { display:table-cell; vertical-align:bottom; padding-bottom:3px; font-size:13px; white-space:nowrap; }
  #__rx .pt td.lbl { padding-right:4px; }
  #__rx .pt td.val { border-bottom:1px solid #000; padding-left:4px; padding-right:4px; }
  #__rx .pt td.gap { padding-left:16px; }
  #__rx .rx-lbl { font-size:26px; font-weight:900; font-style:italic; margin:8px 0 6px; }
  #__rx .rx-body { min-height:160px; }
  #__rx .sig { text-align:right; margin-top:24px; font-size:12.5px; padding-right:10px; border-top:1px dashed #ccc; padding-top:10px; }
  #__rx .footer { text-align:center; font-size:10px; color:#555; font-style:italic; border-top:1px solid #ccc; margin-top:14px; padding-top:8px; line-height:1.6; }
  @media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
</style>
<div id="__rx">

  <h2>Sri Sai Speciality Dental Care</h2>
  <div class="sub">TKR College Road, Karmanghat, Hyderabad.</div>
  <div class="sub">Mobile : 9396522492, 8688033072</div>
  <div class="timing">Timings :- MON-SUN &nbsp; 9AM TO 9PM</div>

  <div class="docs-row">
    <div class="doc-cell">
      <strong>DR. T. VENKAT RAO</strong>
      Reg. A-734<br>
      B.D.S (Osm), M.R.S.H, FAGE,<br>
      (SENIOR DENTAL SURGEON)<br>
      Member, Indian Dental Association
    </div>
    <div class="doc-cell">
      <strong>DR. T. SAI VAKULA</strong>
      Reg. A-15680<br>
      M.D.S.<br>
      MAXILLOFACIAL SURGEON &amp; IMPLANTOLOGIST<br>
      Specialist in Lasers &amp; Cosmetic Dentistry
    </div>
  </div>

  <div class="note">Note : Patients are requested to inform Doctor for any Drug reaction prior to each consultation and verify after prescription.</div>

  <table class="pt"><tr>
    <td class="lbl">Name :</td>
    <td class="val" style="min-width:180px;">&nbsp;${name}&nbsp;</td>
    <td class="gap lbl">Age / Sex :</td>
    <td class="val" style="min-width:50px;">&nbsp;${age}&nbsp;</td>
    <td class="lbl" style="padding:0 4px;">/ </td>
    <td class="val" style="min-width:60px;">&nbsp;${sex}&nbsp;</td>
    <td class="gap lbl">Date :</td>
    <td class="val" style="min-width:100px;">&nbsp;${dateStr}&nbsp;</td>
  </tr></table>

  <div class="rx-lbl">Rx</div>
  <div class="rx-body">${rxLines}</div>

  <div class="sig">DOCTOR'S SIGNATURE</div>

  <div class="footer">
    Cherish your Yesterdays, Dream your Tomorrow, but live your today<br>
    Beauty is a Power and Smile is a Sword
  </div>
</div>`;
        }

        function updateRxPreview() {
            const preview = document.getElementById('rx_preview');
            if (preview) preview.innerHTML = buildPrescriptionHTML();
        }

        function clearPrescriptionForm() {
            ['rx_name','rx_age','rx_date','rx_content'].forEach(id => {
                const el = document.getElementById(id); if (el) el.value = '';
            });
            const sex = document.getElementById('rx_sex'); if (sex) sex.value = '';
            updateRxPreview();
        }

        function getRxHistory() {
            try { return JSON.parse(localStorage.getItem('rx_history') || '[]'); } catch(e) { return []; }
        }
        function saveRxHistory(list) {
            localStorage.setItem('rx_history', JSON.stringify(list));
        }

        function renderRxHistory() {
            const list = getRxHistory();
            const el = document.getElementById('rx_history_list');
            if (!el) return;
            if (!list.length) {
                el.innerHTML = '<div style="color:#aaa;font-size:13px;text-align:center;padding:20px;">No prescriptions saved yet.</div>';
                return;
            }
            el.innerHTML = list.slice().reverse().map((r, ri) => {
                const idx = list.length - 1 - ri;
                const preview = (r.rxText || '').replace(/\n/g,' ').substring(0, 80) + ((r.rxText||'').length > 80 ? '...' : '');
                return `<div style="border:1px solid #e0e8f5;border-radius:8px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;background:#f8faff;">
                    <div style="min-width:0;">
                        <div style="font-weight:700;color:var(--primary);font-size:14px;">${esc(r.name || '-')} &nbsp;|&nbsp; Age: ${esc(r.age||'-')} &nbsp;|&nbsp; ${esc(r.sex||'-')}</div>
                        <div style="font-size:12px;color:#777;margin-top:3px;">Date: ${esc(r.dateStr || '-')}</div>
                        <div style="font-size:12px;color:#555;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(preview || '-')}</div>
                    </div>
                    <div style="display:flex;gap:8px;flex-shrink:0;">
                        <button data-onclick="loadRxRecord(${idx})" style="background:#2c5aa0;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">✏️ Edit</button>
                        <button data-onclick="reprintRxRecord(${idx})" style="background:#27ae60;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">🖨️ Print</button>
                        <button data-onclick="deleteRxRecord(${idx})" style="background:#e74c3c;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">🗑️</button>
                    </div>
                </div>`;
            }).join('');
        }

        function loadRxRecord(idx) {
            const list = getRxHistory();
            const r = list[idx]; if (!r) return;
            document.getElementById('rx_name').value = r.name || '';
            document.getElementById('rx_age').value = r.age || '';
            document.getElementById('rx_sex').value = r.sex || '';
            document.getElementById('rx_date').value = r.date || '';
            document.getElementById('rx_content').value = r.rxText || '';
            updateRxPreview();
            window.scrollTo(0,0);
        }

        function reprintRxRecord(idx) {
            const list = getRxHistory();
            const r = list[idx]; if (!r) return;
            loadRxRecord(idx);
            setTimeout(() => { printBillHtml(buildPrescriptionHTML()); }, 100);
        }

        function deleteRxRecord(idx) {
            if (!confirm('Delete this prescription from history?')) return;
            const list = getRxHistory();
            const rec = list[idx];
            list.splice(idx, 1);
            saveRxHistory(list);
            renderRxHistory();
            showToast('🗑️ Prescription deleted', 'success');
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
            const params = new URLSearchParams();
            params.append('action', 'deletePrescription');
            params.append('recordId', rec ? (rec.recordId||'') : '');
            params.append('savedAt', rec ? (rec.savedAt||rec.date||'') : '');
            params.append('patientName', rec ? (rec.name||'') : '');
            fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' })
                .then(r => r.json())
                .then(res => { if (res.success) showToast('☁️ Removed from Google Sheets', 'success'); else showToast('⚠️ Deleted locally — Sheets sync failed', 'warning'); })
                .catch(() => showToast('⚠️ Deleted locally only', 'warning'));
        }

        function clearPrescriptionHistory() {
            if (!confirm('Clear all prescription history?')) return;
            localStorage.removeItem('rx_history');
            renderRxHistory();
        }

        function printPrescription() {
            const name   = document.getElementById('rx_name').value.trim() || '';
            const age    = document.getElementById('rx_age').value || '';
            const sex    = document.getElementById('rx_sex').value || '';
            const dateV  = document.getElementById('rx_date').value || '';
            const rxText = document.getElementById('rx_content').value || '';
            const dateStr = dateV ? new Date(dateV).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';

            const record = { recordId: newId('RX'), name, age, sex, date: dateV, dateStr, rxText, savedAt: new Date().toISOString() };
            const list = getRxHistory();
            list.push(record);
            saveRxHistory(list);
            renderRxHistory();

            printBillHtml(buildPrescriptionHTML());
            savePrescriptionToSheets(record.recordId);
        }

        function savePrescriptionToSheets(recordId) {
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
            const name   = document.getElementById('rx_name').value || '';
            const age    = document.getElementById('rx_age').value || '';
            const sex    = document.getElementById('rx_sex').value || '';
            const dateV  = document.getElementById('rx_date').value || '';
            const rxText = document.getElementById('rx_content').value || '';

            const params = new URLSearchParams();
            params.append('action', 'savePrescription');
            params.append('recordId', recordId || '');
            params.append('date', dateV);
            params.append('patientName', name);
            params.append('age', age);
            params.append('sex', sex);
            params.append('prescription', rxText);
            if (window.V31 && V31.enabled()) { const x = V31.clinic.rxExtras(); Object.keys(x).forEach(k => { if (x[k]) params.append(k, x[k]); }); }

            fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' })
                .then(r => r.json())
                .then(result => {
                    if (result.success) showToast('☁️ Prescription saved to Sheets!', 'success');
                    else showToast('⚠️ Print OK, Sheets sync failed', 'warning');
                })
                .catch(() => showToast('⚠️ Print OK, Sheets offline', 'warning'));
        }
        // ══ END PRESCRIPTION ══════════════════════════════════

        // ══ TREATMENT RECEIPT ════════════════════════════════
        function buildTreatmentReceiptHTML(forPrint) {
            const no        = esc(document.getElementById('tr_no').value || '___________');
            const date      = document.getElementById('tr_date').value || '';
            const patient   = esc(document.getElementById('tr_patient').value || '______________________________');
            const pay       = forPrint && window.__trPay && window.__trPay.paidAmount !== undefined ? window.__trPay : null;    // part payment (v3.1)
            const totalAmt  = parseFloat(document.getElementById('tr_amount').value) || 0;
            const amount    = esc(pay ? pay.paidAmount.toFixed(2) : (document.getElementById('tr_amount').value || '___________'));
            const words     = esc(pay ? (window.V31 ? V31.words(pay.paidAmount) : '') : (document.getElementById('tr_words').value || '______________________________'));
            const treatText = (document.getElementById('tr_treatment_text') ? document.getElementById('tr_treatment_text').value.trim() : '') || '';
            const dueLine   = pay ? `<div class="due-line">Total treatment charges ₹${totalAmt.toFixed(2)} · Paid now ₹${pay.paidAmount.toFixed(2)} · <b>Balance due ₹${(totalAmt - pay.paidAmount).toFixed(2)}</b></div>` : '';
            const dateStr   = date ? new Date(date).toLocaleDateString('en-IN', {day:'2-digit',month:'2-digit',year:'numeric'}) : '_______________';
            const clinicAddr  = CONFIG ? (CONFIG.clinicAddress || 'TKR College Road, Karmanghat, Hyderabad.') : 'TKR College Road, Karmanghat, Hyderabad.';
            const clinicPhone = CONFIG ? (CONFIG.clinicPhone || '9396522492, 8688033072') : '9396522492, 8688033072';

            // Build treatment rows — one row per line typed, minimum 6 rows for blank space
            const tLines = treatText ? treatText.split('\n').map(l => l.trim()).filter(Boolean) : [];
            const minRows = 6;
            const rowsToShow = Math.max(tLines.length, minRows);
            let treatmentRows = '';
            for (let i = 0; i < rowsToShow; i++) {
                const label = tLines[i] ? esc(tLines[i]) : '&nbsp;';
                treatmentRows += `<tr><td class="item-cell" style="height:30px;">${label}</td></tr>`;
            }

            return `<style>
  @page { size:A4 portrait; margin:10mm; }
  #__tr * { font-family:'Bookman Old Style','Book Antiqua',Bookman,Georgia,serif; box-sizing:border-box; margin:0; padding:0; }
  #__tr { width:100%; max-width:100%; padding:0; color:#000; background:#fff; font-size:13px; line-height:1.4; }
  #__tr h1 { text-align:center; font-size:19px; font-weight:900; letter-spacing:2px; text-transform:uppercase; margin-bottom:3px; }
  #__tr .addr { text-align:center; font-size:11.5px; margin-bottom:2px; }
  #__tr .mob  { text-align:center; font-size:11.5px; margin-bottom:10px; }
  #__tr .doctors { display:table; width:100%; border-collapse:collapse; border:1.5px solid #000; margin-bottom:10px; }
  #__tr .doc-cell { display:table-cell; width:50%; padding:8px 12px; text-align:center; font-size:12px; line-height:1.75; vertical-align:middle; }
  #__tr .doc-cell:first-child { border-right:1.5px solid #000; }
  #__tr .doc-cell strong { font-size:13px; display:block; }
  #__tr .receipt-title { text-align:center; font-size:15px; font-weight:900; letter-spacing:3px; margin-bottom:12px; text-decoration:underline; }
  #__tr .info-section { width:100%; margin-bottom:14px; font-size:13px; }
  #__tr .info-row { display:flex; align-items:flex-end; width:100%; margin-bottom:11px; }
  #__tr .i-left  { display:flex; align-items:flex-end; flex:0 0 55%; padding-right:6px; }
  #__tr .i-right { display:flex; align-items:flex-end; flex:0 0 45%; }
  #__tr .i-lbl   { flex:0 0 auto; white-space:nowrap; padding-right:7px; padding-bottom:3px; }
  #__tr .i-val   { flex:1 1 0; border-bottom:1.5px solid #000; padding:0 3px 3px 3px; min-height:18px; font-weight:bold; }
  #__tr .i-sep   { flex:0 0 auto; white-space:nowrap; padding-right:7px; padding-bottom:3px; }
  #__tr .info-row.full .i-val { flex:1 1 0; }
  #__tr .towards { font-size:13px; font-weight:900; margin-bottom:4px; letter-spacing:1px; }
  #__tr table.treat { width:100%; border-collapse:collapse; margin-bottom:14px; font-size:13px; }
  #__tr table.treat td { border:1.5px solid #000; padding:0; height:30px; vertical-align:middle; }
  #__tr table.treat td.item-cell { padding-left:8px; }
  #__tr .sig-row { display:flex; justify-content:flex-end; margin-top:18px; font-size:13px; padding-right:4px; }
  #__tr .due-line { border:1.5px solid #000; padding:6px 8px; margin:-4px 0 10px; font-size:12.5px; }
  @media print { html, body { margin:0; padding:0; } #__tr { width:100%; } }
</style>
<div id="__tr">
  <h1>Sri Sai Speciality Dental Care</h1>
  <div class="addr">TKR College Road, Karmanghat, Hyderabad.</div>
  <div class="addr">Mobile : 9396522492, 8688033072</div>
  <div class="mob"><strong>Timings :- MON-SUN &nbsp; 9AM TO 9PM</strong></div>
  <div class="doctors">
    <div class="doc-cell">
      <strong>DR. T. VENKAT RAO</strong>
      Reg. A-734<br>B.D.S (Osm), M.R.S.H, FAGE,<br>(SENIOR DENTAL SURGEON)<br>Member, Indian Dental Association
    </div>
    <div class="doc-cell">
      <strong>DR. T. SAI VAKULA</strong>
      Reg. A-15680<br>M.D.S.<br>MAXILLOFACIAL SURGEON &amp; IMPLANTOLOGIST<br>Specialist in Lasers &amp; Cosmetic Dentistry
    </div>
  </div>
  <div class="receipt-title">RECEIPT</div>
  <div class="info-section">
    <div class="info-row">
      <div class="i-left"><span class="i-lbl">No.</span><span class="i-val">&nbsp;${no}</span></div>
      <div class="i-right"><span class="i-sep">Date:</span><span class="i-val">&nbsp;${dateStr}</span></div>
    </div>
    <div class="info-row">
      <div class="i-left"><span class="i-lbl">Received from</span><span class="i-val">&nbsp;${patient}</span></div>
      <div class="i-right"><span class="i-sep">Rs.</span><span class="i-val">&nbsp;${amount}</span></div>
    </div>
    <div class="info-row full"><span class="i-lbl">In words</span><span class="i-val">&nbsp;${words}</span></div>
  </div>
  <div class="towards">TOWARDS</div>
  <table class="treat"><tbody>${treatmentRows}</tbody></table>
  ${dueLine}
  <div class="sig-row">Signature</div>
</div>`;
        }

                function updateTreatmentPreview() {
            const preview = document.getElementById('tr_preview');
            if (preview) preview.innerHTML = buildTreatmentReceiptHTML(false);
        }

        function clearTreatmentForm() {
            ['tr_no','tr_date','tr_patient','tr_amount','tr_words','tr_treatment_text'].forEach(id => {
                const el = document.getElementById(id); if (el) el.value = '';
            });
            updateTreatmentPreview();
        }

        function getTreatmentHistory() {
            try { return JSON.parse(localStorage.getItem('tr_history') || '[]'); } catch(e) { return []; }
        }
        function saveTreatmentHistory(list) {
            localStorage.setItem('tr_history', JSON.stringify(list));
        }

        function renderTreatmentHistory() {
            const list = getTreatmentHistory();
            const el = document.getElementById('tr_history_list');
            if (!el) return;
            if (!list.length) {
                el.innerHTML = '<div style="color:#aaa;font-size:13px;text-align:center;padding:20px;">No receipts saved yet.</div>';
                return;
            }
            el.innerHTML = list.slice().reverse().map((r, ri) => {
                const idx = list.length - 1 - ri;
                return `<div style="border:1px solid #e0e8f5;border-radius:8px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;background:#f8faff;">
                    <div>
                        <div style="font-weight:700;color:var(--primary);font-size:14px;">Receipt No. ${esc(r.no || '-')} &nbsp;|&nbsp; ${esc(r.patient || '-')}</div>
                        <div style="font-size:12px;color:#777;margin-top:3px;">Date: ${esc(r.dateStr || '-')} &nbsp;|&nbsp; Rs. ${esc(r.amount || '-')}</div>
                        <div style="font-size:12px;color:#555;margin-top:3px;">${r.treatments || '-'}</div>
                    </div>
                    <div style="display:flex;gap:8px;flex-shrink:0;">
                        <button data-onclick="loadTreatmentRecord(${idx})" style="background:#2c5aa0;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">✏️ Edit</button>
                        <button data-onclick="reprintTreatmentRecord(${idx})" style="background:#27ae60;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">🖨️ Print</button>
                        <button data-onclick="deleteTreatmentRecord(${idx})" style="background:#e74c3c;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">🗑️</button>
                    </div>
                </div>`;
            }).join('');
        }

        function loadTreatmentRecord(idx) {
            const list = getTreatmentHistory();
            const r = list[idx]; if (!r) return;
            document.getElementById('tr_no').value = r.no || '';
            document.getElementById('tr_date').value = r.date || '';
            document.getElementById('tr_patient').value = r.patient || '';
            document.getElementById('tr_amount').value = r.amount || '';
            document.getElementById('tr_words').value = r.words || '';
            const ttEl = document.getElementById('tr_treatment_text');
            if (ttEl) ttEl.value = r.treatmentText || r.treatments || '';
            updateTreatmentPreview();
            window.scrollTo(0,0);
        }

        function reprintTreatmentRecord(idx) {
            const list = getTreatmentHistory();
            const r = list[idx]; if (!r) return;
            loadTreatmentRecord(idx);
            setTimeout(() => { printBillHtml(buildTreatmentReceiptHTML(true)); }, 100);
        }

        function deleteTreatmentRecord(idx) {
            if (!confirm('Delete this receipt from history?')) return;
            const list = getTreatmentHistory();
            const rec = list[idx];
            list.splice(idx, 1);
            saveTreatmentHistory(list);
            renderTreatmentHistory();
            showToast('🗑️ Treatment receipt deleted', 'success');
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
            const params = new URLSearchParams();
            params.append('action', 'deleteTreatmentReceipt');
            params.append('recordId', rec ? (rec.recordId||'') : '');
            params.append('no', rec ? (rec.no||'') : '');
            params.append('savedAt', rec ? (rec.savedAt||rec.date||'') : '');
            fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' })
                .then(r => r.json())
                .then(res => { if (res.success) showToast('☁️ Removed from Google Sheets', 'success'); else showToast('⚠️ Deleted locally — Sheets sync failed', 'warning'); })
                .catch(() => showToast('⚠️ Deleted locally only', 'warning'));
        }

        function clearTreatmentHistory() {
            if (!confirm('Clear all treatment receipt history?')) return;
            localStorage.removeItem('tr_history');
            renderTreatmentHistory();
        }

        function printTreatmentReceipt() {
            const no           = document.getElementById('tr_no').value.trim() || '';
            const dateV        = document.getElementById('tr_date').value || '';
            const patient      = document.getElementById('tr_patient').value.trim() || '';
            const amount       = document.getElementById('tr_amount').value || '';
            const words        = document.getElementById('tr_words').value || '';
            const treatmentText= document.getElementById('tr_treatment_text') ? document.getElementById('tr_treatment_text').value.trim() : '';
            const dateStr      = dateV ? new Date(dateV).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';

            const tp = window.__trPay || null;
            const record = { recordId: newId('TR'), no, date: dateV, dateStr, patient, amount, words, treatmentText, treatments: treatmentText,
                             paymentMode: tp ? tp.mode : (typeof _trMode !== 'undefined' ? _trMode : ''), savedAt: new Date().toISOString() };
            const list = getTreatmentHistory();
            list.push(record);
            saveTreatmentHistory(list);
            renderTreatmentHistory();
            serverTreatments.push({ no, date: dateV || todayLocal(), patient, amount: parseFloat(amount) || 0, treatments: treatmentText, recordId: record.recordId, paymentMode: record.paymentMode, pending: true,
                                    paidAmount: tp && tp.paidAmount !== undefined ? tp.paidAmount : parseFloat(amount) || 0, balanceDue: tp && tp.paidAmount !== undefined ? (parseFloat(amount) || 0) - tp.paidAmount : 0 });

            const html = buildTreatmentReceiptHTML(true);
            printBillHtml(html);
            saveTreatmentReceiptToSheets(record.recordId, record.paymentMode);
            window.__trPay = null;
            if (window.V31 && V31.clinic) V31.clinic.clearReceiptExtras();
        }

        function saveTreatmentReceiptToSheets(recordId, paymentMode) {
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
            const no      = document.getElementById('tr_no').value || '';
            const dateV   = document.getElementById('tr_date').value || '';
            const patient = document.getElementById('tr_patient').value || '';
            const amount  = document.getElementById('tr_amount').value || '';
            const words   = document.getElementById('tr_words').value || '';

            const selected = document.getElementById('tr_treatment_text') ? document.getElementById('tr_treatment_text').value.trim() : '';

            const params = new URLSearchParams();
            params.append('action', 'saveTreatmentReceipt');
            params.append('recordId', recordId || '');
            params.append('paymentMode', paymentMode || '');
            params.append('receiptNo', no);
            params.append('date', dateV);
            params.append('patient', patient);
            params.append('amount', amount);
            params.append('amountWords', words);
            params.append('treatments', selected);
            const tp = window.__trPay;
            if (tp && tp.paidAmount !== undefined) params.append('paidAmount', tp.paidAmount.toFixed(2));
            if (tp && tp.mode === 'Split') { params.append('cashAmount', tp.cash || 0); params.append('upiAmount', tp.upi || 0); }
            if (window.V31 && V31.enabled()) { const x = V31.clinic.receiptExtras(); Object.keys(x).forEach(k => { if (x[k] && x[k] !== '[]') params.append(k, x[k]); }); }

            fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' })
                .then(r => r.json())
                .then(result => {
                    if (result.success) showToast('☁️ Treatment receipt saved to Sheets!', 'success');
                    else showToast('⚠️ Print OK, Sheets sync failed', 'warning');
                })
                .catch(() => showToast('⚠️ Print OK, Sheets offline', 'warning'));
        }
        // ══ END TREATMENT RECEIPT ══════════════════════════════

        function reprrintBill(billId) {

            const bill = bills.find(b => b.billId === billId);
            if (!bill) { showToast('Bill not found', 'error'); return; }

            let items = bill.items || [];
            if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }

            const itemRows = items.map((item, i) => {
                const med = medicines.find(m => String(m.id) === String(item.medicineId));
                const medName = med ? med.name : (item.medicineName || item.name || 'Unknown');
                return '<tr style="background:'+(i%2===0?'#fff':'#f8f9fa')+'">' +
                    '<td style="padding:7px 10px;border-bottom:1px solid #eee;">'+esc(medName)+'</td>' +
                    '<td style="padding:7px 6px;text-align:center;border-bottom:1px solid #eee;">'+item.qty+'</td>' +
                    '<td style="padding:7px 6px;text-align:right;border-bottom:1px solid #eee;">&#8377;'+parseFloat(item.price).toFixed(2)+'</td>' +
                    '<td style="padding:7px 10px;text-align:right;border-bottom:1px solid #eee;font-weight:700;">&#8377;'+parseFloat(item.amount).toFixed(2)+'</td>' +
                    '</tr>';
            }).join('');

            const subtotal = items.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
            const discount = parseFloat(bill.discount) || 0;
            const discountRow = discount > 0
                ? '<tr><td style="padding:4px 0;color:#e74c3c;">Discount</td><td style="padding:4px 0;text-align:right;color:#e74c3c;">-&#8377;'+discount.toFixed(2)+'</td></tr>' : '';

            const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Bill</title><style>' +
                '*{margin:0;padding:0;box-sizing:border-box}' +
                'body{font-family:"Bookman Old Style","Book Antiqua",Bookman,Georgia,serif;background:#fff;color:#222;padding:20px}' +
                '@page{margin:8mm;size:A5 portrait}' +
                '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}' +
                '.hdr{text-align:center;margin-bottom:14px;padding-bottom:12px;border-bottom:2px dashed #ddd}' +
                '.hdr h2{font-size:17px;font-weight:800;color:#1e3f5a}.hdr p{font-size:11px;color:#888;margin-top:2px}' +
                '.info{display:grid;grid-template-columns:1fr 1fr;gap:8px;background:#f8f9fa;border-radius:8px;padding:12px;margin-bottom:14px}' +
                '.lbl{font-size:10px;color:#999}.val{font-size:13px;font-weight:700;color:#2c3e50}' +
                'table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px}' +
                'thead tr{background:#2c5aa0;color:white}thead th{padding:8px 10px;text-align:left}' +
                'thead th:not(:first-child){text-align:center}thead th:last-child{text-align:right}' +
                '.tot{background:#f8f9fa;border-radius:8px;padding:12px 14px}' +
                '.tot table{margin-bottom:0;font-size:13px}.tot td{padding:3px 0}.tot td:last-child{text-align:right}' +
                '.grand td{font-size:17px;font-weight:800;color:#2c5aa0;border-top:2px solid #dce8f8;padding-top:7px}' +
                '.ftr{text-align:center;margin-top:16px;font-size:11px;color:#aaa}' +
                '.bid{text-align:right;font-size:11px;color:#999;font-family:monospace;margin-bottom:10px}' +
                '</style></head><body>' +
                '<div id="__ph" data-patient="'+(bill.patientName||'').replace(/"/g,'&quot;')
                    +'" data-doctor="'+(bill.doctor||'').replace(/"/g,'&quot;')
                    +'" data-date="'+(bill.date||'')
                    +'" data-billid="'+(bill.billId||'')
                    +'" data-total="'+parseFloat(bill.total||0).toFixed(2)
                    +'" data-subtotal="'+subtotal.toFixed(2)
                    +'" data-discount="'+discount.toFixed(2)
                    +'" data-mode="'+(bill.paymentMode||'Cash')
                    +'" data-items="'+encodeURIComponent(JSON.stringify(items.map(function(i){ return {name:i.medicineName||i.name||'',qty:i.qty,price:i.price,amount:i.amount}; })))
                    +'" style="display:none"></div>' +
                '<div class="bid">'+esc(bill.billId)+'</div>' +
                '<div class="hdr"><h2>&#x1F9B7; '+CONFIG.clinicName+'</h2>' +
                '<p>'+(CONFIG.clinicAddress||'')+'</p>' +
                '<p>'+(CONFIG.clinicPhone?'&#128222; '+CONFIG.clinicPhone:'')+'</p></div>' +
                '<div class="info">' +
                '<div><div class="lbl">Patient</div><div class="val">'+esc(bill.patientName||'—')+'</div></div>' +
                '<div><div class="lbl">Doctor</div><div class="val">'+esc(bill.doctor||'—')+'</div></div>' +
                '<div><div class="lbl">Date</div><div class="val" style="font-weight:500">'+esc(bill.date||'—')+'</div></div>' +
                '<div><div class="lbl">Payment</div><div class="val" style="font-weight:500">'+esc(bill.paymentMode||'—')+'</div></div>' +
                '</div>' +
                '<table><thead><tr><th>Medicine</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>' +
                '<tbody>'+itemRows+'</tbody></table>' +
                '<div class="tot"><table>' +
                '<tr><td>Subtotal</td><td>&#8377;'+subtotal.toFixed(2)+'</td></tr>' +
                discountRow +
                '<tr class="grand"><td><strong>Grand Total</strong></td><td><strong>&#8377;'+parseFloat(bill.total).toFixed(2)+'</strong></td></tr>' +
                '</table></div>' +
                '<div class="ftr">Thank you for choosing '+CONFIG.clinicName+' &#x1F9B7;</div>' +
                '</body></html>';

            printBillHtml(html);
        }

        function shareWhatsApp(billId) {
            const bill = bills.find(b => b.billId === billId);
            if (!bill) { showToast('Bill not found', 'error'); return; }

            if (!bill.phone || String(bill.phone).trim() === '') {
                showToast('❌ No phone number for this bill', 'warning');
                return;
            }

            let items = bill.items || [];
            if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }

            let message = `*${CONFIG.clinicName.toUpperCase()}*\n\n`;
            message += `*Bill ID: ${bill.billId}*\n`;
            message += `Date: ${bill.date}\n`;
            message += `Hello ${bill.patientName}!\n\n`;
            message += `Doctor: ${bill.doctor || 'N/A'}\n\n`;
            message += `*Medicines:*\n`;

            items.forEach(item => {
                const med = medicines.find(m => String(m.id) === String(item.medicineId));
                const medName = med ? med.name : (item.medicineName || item.name || 'Unknown');
                message += `• ${medName}\n  ${item.qty} × ₹${parseFloat(item.price).toFixed(2)} = ₹${parseFloat(item.amount).toFixed(2)}\n`;
            });

            const subtotal = items.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
            message += `\nSubtotal: ₹${subtotal.toFixed(2)}`;
            if (bill.discount && parseFloat(bill.discount) > 0) {
                message += `\nDiscount: -₹${parseFloat(bill.discount).toFixed(2)}`;
            }
            message += `\n\n*Grand Total: ₹${parseFloat(bill.total).toFixed(2)}*`;
            message += `\n\n📞 ${CONFIG.clinicPhone}`;
            message += `\n📍 ${CONFIG.clinicAddress}`;
            message += `\n\nThank you! Visit again. 😊`;

            const phone = String(bill.phone).replace(/[^\d]/g, '');
            openWhatsApp(phone, message);
        }

        // REPORTS
        function generateMedicineWiseReport() {
            if (bills.length === 0) {
                showToast('No bills to report', 'warning');
                return;
            }

            const medicineStats = {};

            bills.forEach(bill => {
                let items = bill.items || [];
                if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }
                if (Array.isArray(items)) {
                    items = items.map(i => typeof i === 'string' ? (() => { try { return JSON.parse(i); } catch(e) { return {}; } })() : i);
                }
                items = items.filter(i => i && (i.medicineId || i.medicineName || i.name));

                items.forEach(item => {
                    const med = medicines.find(m => String(m.id) === String(item.medicineId));
                    const name = item.medicineName || (med ? med.name : null) || item.name || 'Unknown';
                    const costPrice = med ? (parseFloat(med.costPrice) || 0) : (parseFloat(item.costPrice) || 0);
                    const qty = parseInt(item.qty) || 1;
                    const amount = parseFloat(item.amount) || (qty * parseFloat(item.price || 0));

                    if (!medicineStats[name]) {
                        medicineStats[name] = { name, totalQty: 0, totalRevenue: 0, totalCost: 0, totalProfit: 0, transactions: 0 };
                    }
                    medicineStats[name].totalQty += qty;
                    medicineStats[name].totalRevenue += amount;
                    medicineStats[name].totalCost += (qty * costPrice);
                    medicineStats[name].totalProfit += (amount - (qty * costPrice));
                    medicineStats[name].transactions += 1;
                });
            });

            if (Object.keys(medicineStats).length === 0) {
                showToast('No medicine data found in bills. Make sure bills have medicine items saved.', 'warning');
                return;
            }

            let csvContent = "Medicine Name,Total Qty,Total Revenue,Total Cost,Total Profit,Transactions,Profit Margin %\n";
            Object.values(medicineStats).forEach(stat => {
                const margin = stat.totalRevenue > 0 ? ((stat.totalProfit / stat.totalRevenue) * 100).toFixed(2) : 0;
                csvContent += `${csvQ(stat.name)},${stat.totalQty},${stat.totalRevenue.toFixed(2)},${stat.totalCost.toFixed(2)},${stat.totalProfit.toFixed(2)},${stat.transactions},${margin}%\n`;
            });

            downloadReport(csvContent, 'Medicine-wise-Report.csv');
            showToast('✅ Medicine-wise report downloaded!', 'success');
        }

        function generateSupplierWiseReport() {
            if (purchases.length === 0) {
                showToast('No purchases to report', 'warning');
                return;
            }
            const medRevenue = buildMedRevenue();
            const supplierStats = {};

            purchases.forEach(purchase => {
                const sup = normSupplier(purchase.supplier);
                const med = normMedicine(purchase.medicineName);
                if (!supplierStats[sup]) {
                    supplierStats[sup] = { supplier:sup, totalQty:0, totalCost:0, totalRevenue:0, transactions:0, medicines:new Set() };
                }
                supplierStats[sup].totalQty     += parseInt(purchase.qty)||0;
                supplierStats[sup].totalCost    += purchaseCost(purchase);
                supplierStats[sup].totalRevenue += medRevenue[med] || 0;
                supplierStats[sup].transactions += 1;
                supplierStats[sup].medicines.add(med);
            });

            let csvContent = "Supplier,Orders,Total Qty,Cost Paid,Revenue Earned,Profit,Margin %,Medicines Supplied\n";
            Object.values(supplierStats)
                .sort((a,b) => b.totalCost - a.totalCost)
                .forEach(stat => {
                    const profit = stat.totalRevenue - stat.totalCost;
                    const margin = stat.totalRevenue > 0 ? ((profit/stat.totalRevenue)*100).toFixed(1)+'%' : 'N/A';
                    csvContent += `${csvQ(stat.supplier)},${stat.transactions},${stat.totalQty},${stat.totalCost.toFixed(2)},${stat.totalRevenue.toFixed(2)},${profit.toFixed(2)},${margin},${csvQ(Array.from(stat.medicines).join(', '))}\n`;
                });

            downloadReport(csvContent, 'Supplier-wise-Report.csv');
            showToast('✅ Supplier report with margins downloaded!', 'success');
        }

        function generateMonthlyReport() {
            if (bills.length === 0) {
                showToast('No bills to report', 'warning');
                return;
            }

            const monthlyStats = {};
            
            bills.forEach(bill => {
                const billDate = String(bill.date).split('T')[0];
                const yearMonth = billDate.substring(0, 7); // YYYY-MM
                
                if (!monthlyStats[yearMonth]) {
                    monthlyStats[yearMonth] = {
                        month: yearMonth,
                        totalRevenue: 0,
                        totalCost: 0,
                        totalProfit: 0,
                        transactions: 0
                    };
                }
                
                monthlyStats[yearMonth].totalRevenue += parseFloat(bill.total) || 0;

                // Calculate cost from costTotal or fallback to items × costPrice
                let billCost = parseFloat(bill.costTotal) || 0;
                if (billCost === 0) {
                    let items = bill.items || [];
                    if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }
                    billCost = items.reduce((sum, item) => {
                        const med = medicines.find(m => String(m.id) === String(item.medicineId));
                        const cp = med ? (parseFloat(med.costPrice) || 0) : (parseFloat(item.costPrice) || 0);
                        return sum + (parseInt(item.qty) * cp);
                    }, 0);
                }
                monthlyStats[yearMonth].totalCost += billCost;
                monthlyStats[yearMonth].totalProfit += ((parseFloat(bill.total) || 0) - billCost);
                monthlyStats[yearMonth].transactions += 1;
            });

            let csvContent = "Month,Total Revenue,Total Cost,Total Profit,Profit Margin %,Transactions\n";
            Object.values(monthlyStats).sort((a, b) => a.month.localeCompare(b.month)).forEach(stat => {
                const margin = stat.totalRevenue > 0 ? ((stat.totalProfit / stat.totalRevenue) * 100).toFixed(2) : 0;
                csvContent += `${stat.month},${stat.totalRevenue.toFixed(2)},${stat.totalCost.toFixed(2)},${stat.totalProfit.toFixed(2)},${margin}%,${stat.transactions}\n`;
            });

            downloadReport(csvContent, 'Monthly-Trends-Report.csv');
            showToast('✅ Monthly trends report downloaded!', 'success');
        }

        function downloadReport(csvContent, filename) {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        // MODALS
        function closeModal(modalId) {
            document.getElementById(modalId).classList.remove('active');
        }

        // UTILITY
        function showToast(message, type = 'info') {
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }

        // ══ CLINIC PERFORMANCE REPORTS ═══════════════════════════

        // Called whenever the Reports page is opened or filter changes
        // ══════════════════════════════════════════════════════════
        // CLINIC EXPENSES MODULE
        // ══════════════════════════════════════════════════════════
        var _expenses = JSON.parse(localStorage.getItem('clinic_expenses') || '[]');

        function saveExpenses() {
            localStorage.setItem('clinic_expenses', JSON.stringify(_expenses));
        }

        function addExpense() {
            var date     = document.getElementById('exp_date').value;
            var category = document.getElementById('exp_category').value;
            var amount   = parseFloat(document.getElementById('exp_amount').value);
            var vendor   = document.getElementById('exp_vendor').value.trim();
            var notes    = document.getElementById('exp_notes').value.trim();
            var mode     = document.getElementById('exp_mode').value;

            if (!date)     { showToast('Please select a date', 'warning'); return; }
            if (!category) { showToast('Please select a category', 'warning'); return; }
            if (!amount || amount <= 0) { showToast('Please enter a valid amount', 'warning'); return; }

            var expense = {
                id:       'EXP-' + Date.now(),
                date:     date,
                category: category,
                amount:   amount,
                vendor:   vendor,
                notes:    notes,
                mode:     mode,
                addedAt:  new Date().toISOString()
            };

            _expenses.unshift(expense);
            saveExpenses();
            renderExpenses();
            // Reset form
            document.getElementById('exp_amount').value = '';
            document.getElementById('exp_vendor').value = '';
            document.getElementById('exp_notes').value = '';
            showToast('✅ Expense saved!', 'success');
            // Sync to Google Sheets
            syncExpenseToSheets(expense);
        }

        function deleteExpense(id) {
            if (!confirm('Delete this expense? This cannot be undone.')) return;
            _expenses = _expenses.filter(function(e){ return e.id !== id; });
            saveExpenses();
            renderExpenses();
            showToast('🗑️ Expense deleted', 'success');
            // Sync deletion to Sheets
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
            var p = new URLSearchParams();
            p.append('action', 'deleteExpense');
            p.append('id', id);
            fetch(CONFIG.apiUrl + '?' + p.toString(), { method:'GET', redirect:'follow' })
                .then(function(r){ return r.json(); })
                .then(function(res){ if(res.success) showToast('☁️ Removed from Sheets','success'); })
                .catch(function(){});
        }

        function syncExpenseToSheets(exp) {
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
            var p = new URLSearchParams();
            p.append('action',   'saveExpense');
            p.append('id',       exp.id);
            p.append('date',     exp.date);
            p.append('category', exp.category);
            p.append('amount',   exp.amount);
            p.append('vendor',   exp.vendor || '');
            p.append('notes',    exp.notes  || '');
            p.append('mode',     exp.mode   || 'Cash');
            fetch(CONFIG.apiUrl + '?' + p.toString(), { method:'GET', redirect:'follow' })
                .then(function(r){ return r.json(); })
                .then(function(res){ if(res.success) showToast('☁️ Synced to Google Sheets','success'); else showToast('⚠️ Saved locally only','warning'); })
                .catch(function(){ showToast('⚠️ Saved locally — no internet?','warning'); });
        }

        // Pull all expenses from Google Sheets and merge with local
        function syncExpensesFromSheets() {
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) {
                showToast('⚠️ No Google Sheets connected', 'warning'); return;
            }
            showToast('🔄 Syncing expenses from Sheets...', 'info');
            var url = CONFIG.apiUrl + '?action=getExpenses';
            fetch(url, { method:'GET', redirect:'follow' })
                .then(function(r){ return r.json(); })
                .then(function(data) {
                    var rows = data.expenses || data || [];
                    if (!Array.isArray(rows) || rows.length === 0) {
                        // Fallback: try getAllData
                        return fetch(CONFIG.apiUrl + '?action=getAllData', { method:'GET', redirect:'follow' })
                            .then(function(r2){ return r2.json(); })
                            .then(function(d2){ return d2.expenses || []; });
                    }
                    return rows;
                })
                .then(function(rows) {
                    if (!Array.isArray(rows) || rows.length === 0) {
                        showToast('No expenses found in Sheets', 'warning'); return;
                    }
                    var sheetExpenses = rows.map(function(e){ return {
                        id:       e.id       || ('EXP-' + Date.now() + Math.random()),
                        date:     e.date     ? String(e.date).split('T')[0] : '',
                        category: e.category || e.Category || '',
                        amount:   parseFloat(e.amount || e.Amount) || 0,
                        vendor:   e.vendor   || e.Vendor || '',
                        notes:    e.notes    || e.Notes  || '',
                        mode:     e.mode     || e.paymentMode || e['Payment Mode'] || 'Cash',
                        addedAt:  e.addedAt  || e.added_at || e['Added At'] || ''
                    }; });
                    var localExpenses = JSON.parse(localStorage.getItem('clinic_expenses') || '[]');
                    var sheetIds = sheetExpenses.map(function(e){ return e.id; });
                    var localOnly = localExpenses.filter(function(e){ return sheetIds.indexOf(e.id) === -1; });
                    _expenses = sheetExpenses.concat(localOnly);
                    _expenses.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
                    localStorage.setItem('clinic_expenses', JSON.stringify(_expenses));
                    renderExpenses();
                    showToast('✅ Expenses synced! ' + _expenses.length + ' entries loaded', 'success');
                })
                .catch(function(err){
                    console.error('Expense sync error:', err);
                    showToast('❌ Sync failed — check internet / Sheets connection', 'warning');
                });
        }

        function renderExpenses() {
            var catFilter   = (document.getElementById('exp_filterCat')   || {}).value || '';
            var monthFilter = (document.getElementById('exp_filterMonth') || {}).value || '';
            var yearFilter  = (document.getElementById('exp_filterYear')  || {}).value || '';

            // Populate year dropdown
            var years = [...new Set(_expenses.map(function(e){ return e.date.substring(0,4); }))].sort().reverse();
            var ySel = document.getElementById('exp_filterYear');
            if (ySel) {
                var curYVal = ySel.value;
                ySel.innerHTML = '<option value="">All Years</option>' +
                    years.map(function(y){ return '<option value="'+y+'"'+(y===curYVal?' selected':'')+'>'+y+'</option>'; }).join('');
            }

            var today = new Date();
            var thisMonth = today.getFullYear()+'-'+(String(today.getMonth()+1).padStart(2,'0'));
            var thisYear  = String(today.getFullYear());

            var filtered = _expenses.filter(function(e) {
                if (catFilter   && e.category !== catFilter)              return false;
                if (monthFilter && e.date.substring(5,7) !== monthFilter) return false;
                if (yearFilter  && e.date.substring(0,4) !== yearFilter)  return false;
                return true;
            });

            // Summary totals
            var totalThisMonth = _expenses.filter(function(e){ return e.date.substring(0,7)===thisMonth; }).reduce(function(s,e){ return s+e.amount; },0);
            var totalThisYear  = _expenses.filter(function(e){ return e.date.substring(0,4)===thisYear;  }).reduce(function(s,e){ return s+e.amount; },0);
            var totalAll       = _expenses.reduce(function(s,e){ return s+e.amount; },0);
            var el = function(id){ return document.getElementById(id); };
            if(el('exp_thisMonth')) el('exp_thisMonth').textContent = '₹'+totalThisMonth.toFixed(2);
            if(el('exp_thisYear'))  el('exp_thisYear').textContent  = '₹'+totalThisYear.toFixed(2);
            if(el('exp_allTime'))   el('exp_allTime').textContent   = '₹'+totalAll.toFixed(2);
            if(el('exp_count'))     el('exp_count').textContent     = _expenses.length;

            // Category breakdown for filtered set
            var breakdown = {};
            var catColors = {
                'Rent':'#e74c3c','Electricity':'#f39c12','Staff Salary':'#2ecc71',
                'Lab Bill':'#3498db','Equipment':'#9b59b6','Medicine Stock':'#1abc9c',
                'Housekeeping':'#e67e22','Internet & Phone':'#34495e','Marketing':'#e91e63',
                'Insurance':'#607d8b','Miscellaneous':'#95a5a6'
            };
            filtered.forEach(function(e){ breakdown[e.category] = (breakdown[e.category]||0) + e.amount; });
            var bTotal = filtered.reduce(function(s,e){ return s+e.amount; },0);
            var bdBox = el('exp_breakdown');
            var bdCnt = el('exp_breakdownContent');
            if (bdBox && bdCnt && Object.keys(breakdown).length > 0) {
                bdBox.style.display = 'block';
                bdCnt.innerHTML = Object.keys(breakdown).sort(function(a,b){ return breakdown[b]-breakdown[a]; }).map(function(cat){
                    var pct = bTotal > 0 ? Math.round(breakdown[cat]/bTotal*100) : 0;
                    var color = catColors[cat] || '#95a5a6';
                    return '<div style="margin-bottom:8px;">' +
                        '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">' +
                            '<span style="font-weight:700;">'+esc(cat)+'</span>' +
                            '<span>₹'+breakdown[cat].toFixed(2)+' <span style="color:#888;">('+pct+'%)</span></span>' +
                        '</div>' +
                        '<div style="height:8px;background:#f0f0f0;border-radius:4px;overflow:hidden;">' +
                            '<div style="height:100%;width:'+pct+'%;background:'+color+';border-radius:4px;transition:width 0.4s;"></div>' +
                        '</div></div>';
                }).join('');
            } else if (bdBox) { bdBox.style.display = 'none'; }

            // Expense cards
            var listEl = el('exp_list');
            if (!listEl) return;
            if (filtered.length === 0) {
                listEl.innerHTML = '<div style="text-align:center;color:#aaa;padding:40px;font-size:14px;">No expenses found.<br>'+(catFilter||monthFilter||yearFilter?'Try clearing filters.':'Add your first expense above.')+'</div>';
                return;
            }
            listEl.innerHTML = filtered.map(function(e){
                var color = catColors[e.category] || '#95a5a6';
                var modeIcon = e.mode==='Cash'?'💵':e.mode==='UPI'?'📱':e.mode==='Cheque'?'📄':'🏦';
                return '<div style="background:#fff;border-radius:12px;padding:14px 16px;box-shadow:0 2px 8px rgba(0,0,0,0.07);border-left:4px solid '+color+';">' +
                    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
                        '<div style="flex:1;min-width:0;">' +
                            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">' +
                                '<span style="background:'+color+'22;color:'+color+';border-radius:6px;padding:2px 8px;font-size:11px;font-weight:800;">'+esc(e.category)+'</span>' +
                                '<span style="font-size:11px;color:#888;">'+esc(e.date)+'</span>' +
                                '<span style="font-size:11px;color:#888;">'+modeIcon+' '+esc(e.mode)+'</span>' +
                            '</div>' +
                            (e.vendor ? '<div style="font-size:13px;font-weight:700;color:#333;margin-bottom:2px;">'+esc(e.vendor)+'</div>' : '') +
                            (e.notes  ? '<div style="font-size:12px;color:#666;">'+esc(e.notes)+'</div>' : '') +
                        '</div>' +
                        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">' +
                            '<div style="font-size:18px;font-weight:800;color:'+color+';">₹'+e.amount.toFixed(2)+'</div>' +
                            '<button data-onclick="deleteExpense(\''+esc(e.id)+'\')" style="padding:4px 10px;background:#fdecea;color:#e74c3c;border:1px solid #e74c3c;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;touch-action:manipulation;">🗑️ Delete</button>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            }).join('');
        }

        function exportExpensesCSV() {
            if (_expenses.length === 0) { showToast('No expenses to export','warning'); return; }
            var csv = 'Date,Category,Amount,Vendor,Notes,Payment Mode\n';
            _expenses.forEach(function(e){
                csv += csvQ(e.date)+','+csvQ(e.category)+','+e.amount.toFixed(2)+','+csvQ(e.vendor)+','+csvQ(e.notes)+','+csvQ(e.mode)+'\n';
            });
            var blob = new Blob([csv], {type:'text/csv'});
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'clinic_expenses_'+new Date().toLocaleDateString('en-CA')+'.csv';
            a.click();
            showToast('📥 CSV exported!', 'success');
        }

        // Set today's date as default on expenses form
        (function(){
            var d = document.getElementById('exp_date');
            if (d) d.value = new Date().toLocaleDateString('en-CA');
        })();

        // ══════════════════════════════════════════════════════════
        function renderReports() {
            const filtered = getFilteredBills();
            renderKPIs(filtered);
            renderRevenueChart(filtered);
            renderTreatmentChart();
            renderPaymentChart(filtered);
            renderDoctorChart(filtered);
            renderTopMedicines(filtered);
            renderMonthlyTable(filtered);
            renderSupplierReport();
            renderPurchaseReport();
            renderInsights(filtered);
        }

        function getFilteredBills() {
            const period = document.getElementById('rpt_period') ? document.getElementById('rpt_period').value : 'all';
            const now = new Date();
            const today = now.toLocaleDateString('en-CA');

            // Show/hide custom range inputs
            const cr = document.getElementById('rpt_custom_range');
            if (cr) cr.style.display = period === 'custom' ? 'flex' : 'none';

            return bills.filter(b => {
                const d = String(b.date).split('T')[0];
                if (period === 'all') return true;
                if (period === 'today') return d === today;
                if (period === 'week') {
                    const wStart = new Date(now); wStart.setDate(now.getDate() - now.getDay());
                    return new Date(d) >= wStart;
                }
                if (period === 'month') return d.substring(0,7) === today.substring(0,7);
                if (period === 'last3') {
                    const t = new Date(now); t.setMonth(t.getMonth() - 3);
                    return new Date(d) >= t;
                }
                if (period === 'year') return d.substring(0,4) === today.substring(0,4);
                if (period === 'custom') {
                    const from = document.getElementById('rpt_from').value;
                    const to   = document.getElementById('rpt_to').value;
                    if (from && d < from) return false;
                    if (to   && d > to)   return false;
                    return true;
                }
                return true;
            });
        }

        // Dental treatment receipts in the selected period (same filter as bills)
        function getFilteredTreatments() {
            const saved = bills; bills = (serverTreatments || []).map(t => Object.assign({}, t, { total: parseFloat(t.amount) || 0 }));
            try { return getFilteredBills(); } finally { bills = saved; }
        }
        function renderKPIs(filtered) {
            const pharmRev  = filtered.reduce((s,b) => s + (parseFloat(b.total)||0), 0);
            const dentalRev = getFilteredTreatments().reduce((s,t) => s + (parseFloat(t.total)||0), 0);
            const totalRev  = pharmRev + dentalRev;
            const totalPts  = filtered.length;
            const avgBill   = totalPts ? pharmRev / totalPts : 0;
            const totalDisc = filtered.reduce((s,b) => s + (parseFloat(b.discount)||0), 0);

            // Unique patient names
            const uniquePts = new Set(filtered.map(b => (b.patientName||'').toLowerCase().trim())).size;

            // Bills today
            const today = new Date().toLocaleDateString('en-CA');
            const todayRev = bills.filter(b => String(b.date).split('T')[0] === today).reduce((s,b) => s + (parseFloat(b.total)||0), 0)
                           + (serverTreatments || []).filter(t => String(t.date).split('T')[0] === today).reduce((s,t) => s + (parseFloat(t.amount)||0), 0);

            const kpis = [
                { label:"Total Revenue",   value:`₹${totalRev.toLocaleString('en-IN',{maximumFractionDigits:0})}`,  color:'#2c5aa0', icon:'💰' },
                { label:"Pharmacy Sales",  value:`₹${pharmRev.toLocaleString('en-IN',{maximumFractionDigits:0})}`,  color:'#27ae60', icon:'💊' },
                { label:"Dental Treatments", value:`₹${dentalRev.toLocaleString('en-IN',{maximumFractionDigits:0})}`, color:'#8e44ad', icon:'🦷' },
                { label:"Pharmacy Bills",  value:totalPts,                       color:'#27ae60', icon:'🧾' },
                { label:"Unique Patients", value:uniquePts,                      color:'#8e44ad', icon:'👥' },
                { label:"Avg Bill Value",  value:`₹${avgBill.toFixed(0)}`,       color:'#e67e22', icon:'📊' },
                { label:"Total Discounts", value:`₹${totalDisc.toFixed(0)}`,     color:'#e74c3c', icon:'🏷️' },
                { label:"Today's Revenue", value:`₹${todayRev.toFixed(0)}`,      color:'#16a085', icon:'📅' },
            ];

            document.getElementById('rpt_kpis').innerHTML = kpis.map(k => `
                <div style="background:white;border-radius:10px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.07);border-left:4px solid ${k.color};">
                    <div style="font-size:22px;margin-bottom:4px;">${k.icon}</div>
                    <div style="font-size:11px;color:#7f8c8d;text-transform:uppercase;letter-spacing:0.5px;">${k.label}</div>
                    <div style="font-size:22px;font-weight:800;color:${k.color};margin-top:3px;">${k.value}</div>
                </div>`).join('');
        }

        function renderRevenueChart(filtered) {
            // Last 30 days bar chart using pure SVG
            const days = 30;
            const buckets = {};
            for (let i = days-1; i >= 0; i--) {
                const d = new Date(); d.setDate(d.getDate()-i);
                buckets[d.toLocaleDateString('en-CA')] = 0;
            }
            filtered.concat(getFilteredTreatments()).forEach(b => {
                const d = String(b.date).split('T')[0];
                if (buckets[d] !== undefined) buckets[d] += parseFloat(b.total)||0;
            });

            const vals = Object.values(buckets);
            const maxV = Math.max(...vals, 1);
            const w = 480, h = 150, pad = 30, barW = Math.floor((w - pad*2) / days) - 2;

            const bars = Object.entries(buckets).map(([date, val], i) => {
                const bh = Math.round((val / maxV) * (h - 20));
                const x  = pad + i * ((w - pad*2) / days);
                const y  = h - bh - 5;
                const col = val > 0 ? '#2c5aa0' : '#e8edf5';
                return `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" fill="${col}" rx="2">
                    <title>${esc(date)}: ₹${val.toFixed(0)}</title></rect>`;
            }).join('');

            // Y axis labels
            const yLabels = [0, 0.5, 1].map(f => {
                const yv = Math.round(maxV * f);
                const yp = h - Math.round(f * (h-20)) - 5;
                return `<text x="2" y="${yp}" font-size="9" fill="#aaa">₹${yv>=1000?Math.round(yv/1000)+'k':yv}</text>`;
            }).join('');

            document.getElementById('rpt_revenue_chart').innerHTML =
                `<svg viewBox="0 0 ${w} ${h}" width="100%" style="overflow:visible;">
                    ${yLabels}
                    <line x1="${pad}" y1="5" x2="${pad}" y2="${h-5}" stroke="#eee" stroke-width="1"/>
                    <line x1="${pad}" y1="${h-5}" x2="${w-10}" y2="${h-5}" stroke="#eee" stroke-width="1"/>
                    ${bars}
                    <text x="${pad}" y="${h+14}" font-size="9" fill="#aaa">30 days ago</text>
                    <text x="${w-40}" y="${h+14}" font-size="9" fill="#aaa">Today</text>
                </svg>`;
        }

        function renderTreatmentChart() {
            // Uses treatmentReceipts data if available, else builds from bills
            const treatments = {
                'Consultation':0,'Teeth Cleaning':0,'Fillings':0,
                'Root Canal':0,'Crowns':0,'Orthodontic':0,
                'Flap Surgery':0,'Extractions':0,'Others':0
            };

            // Count from treatment receipts saved in Google Sheets (all devices) for the selected period
            try {
                getFilteredTreatments().forEach(r => {
                    if (r.treatments) {
                        String(r.treatments).split(',').forEach(t => {
                            const key = Object.keys(treatments).find(k => t.trim().toLowerCase().includes(k.toLowerCase()));
                            if (key) treatments[key]++;
                        });
                    }
                });
            } catch(e) {}

            // No invented numbers: show an empty state when there is no treatment data
            const total = Object.values(treatments).reduce((a,b)=>a+b,0);
            if (total === 0) {
                const el = document.getElementById('rpt_treatment_chart');
                if (el) el.innerHTML = '<div style="text-align:center;color:#999;padding:30px 10px;font-size:13px;">No treatment receipts in this period yet.</div>';
                return;
            }
            const labels = Object.keys(treatments).filter(k => treatments[k] > 0);
            const values = labels.map(k => treatments[k]);

            renderDonutChart('rpt_treatment_chart', labels, values,
                ['#2c5aa0','#27ae60','#e74c3c','#f39c12','#8e44ad','#16a085','#d35400','#2980b9','#7f8c8d']);
        }

        function renderPaymentChart(filtered) {
            const modes = {};
            filtered.forEach(b => {
                const m = b.paymentMode || 'Unknown';
                modes[m] = (modes[m]||0) + 1;
            });
            if (Object.keys(modes).length === 0) {
                document.getElementById('rpt_payment_chart').innerHTML = '<p style="color:#aaa;font-size:13px;text-align:center;margin-top:40px;">No data yet</p>';
                return;
            }
            renderDonutChart('rpt_payment_chart', Object.keys(modes), Object.values(modes),
                ['#27ae60','#2c5aa0','#e67e22','#8e44ad','#e74c3c']);
        }

        function renderDoctorChart(filtered) {
            const doctors = {};
            filtered.forEach(b => {
                const d = b.doctor || 'Unassigned';
                doctors[d] = (doctors[d]||0) + (parseFloat(b.total)||0);
            });
            const sorted = Object.entries(doctors).sort((a,b)=>b[1]-a[1]);
            if (sorted.length === 0) {
                document.getElementById('rpt_doctor_chart').innerHTML = '<p style="color:#aaa;font-size:13px;text-align:center;margin-top:40px;">No data yet</p>';
                return;
            }
            const maxV = sorted[0][1] || 1;
            const colors = ['#2c5aa0','#27ae60','#e67e22','#8e44ad'];
            document.getElementById('rpt_doctor_chart').innerHTML = sorted.map(([doc, rev], i) => `
                <div style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
                        <span style="font-weight:600;color:#2c3e50;">${esc(doc)}</span>
                        <span style="color:#27ae60;font-weight:700;">₹${rev.toLocaleString('en-IN',{maximumFractionDigits:0})}</span>
                    </div>
                    <div style="background:#f0f4ff;border-radius:4px;height:10px;width:100%;">
                        <div style="background:${colors[i%colors.length]};width:${Math.round((rev/maxV)*100)}%;height:10px;border-radius:4px;transition:width 0.6s;"></div>
                    </div>
                </div>`).join('');
        }

        function renderDonutChart(containerId, labels, values, colors) {
            const total = values.reduce((a,b)=>a+b,0) || 1;
            const cx = 75, cy = 75, r = 60, ri = 38;
            let startAngle = -Math.PI/2;
            const slices = values.map((v, i) => {
                const angle = (v / total) * 2 * Math.PI;
                const x1 = cx + r * Math.cos(startAngle);
                const y1 = cy + r * Math.sin(startAngle);
                startAngle += angle;
                const x2 = cx + r * Math.cos(startAngle);
                const y2 = cy + r * Math.sin(startAngle);
                const large = angle > Math.PI ? 1 : 0;
                const xi1 = cx + ri * Math.cos(startAngle - angle);
                const yi1 = cy + ri * Math.sin(startAngle - angle);
                const xi2 = cx + ri * Math.cos(startAngle);
                const yi2 = cy + ri * Math.sin(startAngle);
                return `<path d="M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${xi2},${yi2} A${ri},${ri} 0 ${large},0 ${xi1},${yi1} Z"
                    fill="${colors[i%colors.length]}" stroke="white" stroke-width="2">
                    <title>${esc(labels[i])}: ${v} (${Math.round((v/total)*100)}%)</title></path>`;
            }).join('');

            const legend = labels.map((l, i) => `
                <div style="display:flex;align-items:center;gap:5px;font-size:11px;margin-bottom:4px;">
                    <span style="width:10px;height:10px;background:${colors[i%colors.length]};border-radius:2px;flex-shrink:0;"></span>
                    <span style="color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px;">${esc(l)}</span>
                    <span style="margin-left:auto;font-weight:700;color:#2c3e50;">${Math.round((values[i]/total)*100)}%</span>
                </div>`).join('');

            document.getElementById(containerId).innerHTML = `
                <div style="display:flex;align-items:center;gap:16px;">
                    <svg viewBox="0 0 150 150" width="150" height="150" style="flex-shrink:0;">${slices}</svg>
                    <div style="flex:1;overflow:hidden;">${legend}</div>
                </div>`;
        }

        function renderTopMedicines(filtered) {
            const meds = {};
            filtered.forEach(b => {
                let items = b.items||[];
                if (typeof items==='string'){try{items=JSON.parse(items);}catch(e){items=[];}}
                items.forEach(item => {
                    const name = item.medicineName||item.name||'Unknown';
                    if (!meds[name]) meds[name] = {rev:0, qty:0};
                    meds[name].rev += parseFloat(item.amount)||0;
                    meds[name].qty += parseInt(item.qty)||1;
                });
            });
            const sorted = Object.entries(meds).sort((a,b)=>b[1].rev-a[1].rev).slice(0,8);
            if (!sorted.length) {
                document.getElementById('rpt_top_medicines').innerHTML = '<p style="color:#aaa;font-size:13px;">No medicine data in bills</p>';
                return;
            }
            document.getElementById('rpt_top_medicines').innerHTML = `
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <tr style="background:#f8f9fa;">
                        <th style="padding:7px 8px;text-align:left;color:#555;">Medicine</th>
                        <th style="padding:7px 8px;text-align:center;color:#555;">Qty</th>
                        <th style="padding:7px 8px;text-align:right;color:#555;">Revenue</th>
                    </tr>
                    ${sorted.map(([name,s],i)=>`
                    <tr style="border-bottom:1px solid #f0f0f0;${i%2?'background:#fafafa':''}">
                        <td style="padding:7px 8px;color:#2c3e50;font-weight:500;">${esc(name)}</td>
                        <td style="padding:7px 8px;text-align:center;color:#7f8c8d;">${s.qty}</td>
                        <td style="padding:7px 8px;text-align:right;color:#27ae60;font-weight:700;">₹${s.rev.toFixed(0)}</td>
                    </tr>`).join('')}
                </table>`;
        }

        function renderMonthlyTable(filtered) {
            const monthly = {};
            filtered.forEach(b => {
                const ym = String(b.date).split('T')[0].substring(0,7);
                if (!monthly[ym]) monthly[ym] = {rev:0, count:0};
                monthly[ym].rev   += parseFloat(b.total)||0;
                monthly[ym].count += 1;
            });
            const sorted = Object.entries(monthly).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,8);
            if (!sorted.length) {
                document.getElementById('rpt_monthly_table').innerHTML = '<p style="color:#aaa;font-size:13px;">No data yet</p>';
                return;
            }
            document.getElementById('rpt_monthly_table').innerHTML = `
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <tr style="background:#f8f9fa;">
                        <th style="padding:7px 8px;text-align:left;color:#555;">Month</th>
                        <th style="padding:7px 8px;text-align:center;color:#555;">Bills</th>
                        <th style="padding:7px 8px;text-align:right;color:#555;">Revenue</th>
                        <th style="padding:7px 8px;text-align:right;color:#555;">Avg</th>
                    </tr>
                    ${sorted.map(([ym,s],i)=>{
                        const [y,m] = ym.split('-');
                        const label = new Date(y,m-1).toLocaleString('en-IN',{month:'short',year:'numeric'});
                        return `<tr style="border-bottom:1px solid #f0f0f0;${i%2?'background:#fafafa':''}">
                            <td style="padding:7px 8px;font-weight:600;color:#2c3e50;">${label}</td>
                            <td style="padding:7px 8px;text-align:center;color:#7f8c8d;">${s.count}</td>
                            <td style="padding:7px 8px;text-align:right;color:#2c5aa0;font-weight:700;">₹${s.rev.toLocaleString('en-IN',{maximumFractionDigits:0})}</td>
                            <td style="padding:7px 8px;text-align:right;color:#27ae60;">₹${Math.round(s.rev/s.count)}</td>
                        </tr>`;
                    }).join('')}
                </table>`;
        }

        function renderInsights(filtered) {
            const insights = [];
            const totalRev = filtered.reduce((s,b)=>s+parseFloat(b.total||0),0);
            const totalPts = filtered.length;
            const avgBill  = totalPts ? totalRev/totalPts : 0;

            // Payment mode insight
            const modes = {};
            filtered.forEach(b=>{ const m=b.paymentMode||'Unknown'; modes[m]=(modes[m]||0)+1; });
            const topMode = Object.entries(modes).sort((a,b)=>b[1]-a[1])[0];
            if (topMode) insights.push({
                icon:'💳', color:'#2c5aa0',
                title:'Top Payment Mode',
                text:`<b>${esc(topMode[0])}</b> is your most used payment method (${topMode[1]} transactions). Ensure UPI QR codes are clearly visible at reception.`
            });

            // Avg bill insight
            if (avgBill < 500 && totalPts > 0) insights.push({
                icon:'📈', color:'#e67e22',
                title:'Increase Average Bill Value',
                text:`Your average bill is <b>₹${avgBill.toFixed(0)}</b>. Consider bundling consultations with preventive treatments like scaling to increase per-visit value.`
            });
            if (avgBill >= 500) insights.push({
                icon:'🌟', color:'#27ae60',
                title:'Strong Average Revenue',
                text:`Average bill of <b>₹${avgBill.toFixed(0)}</b> is healthy. Focus on retaining existing patients with follow-up reminders for best ROI.`
            });

            // Doctor spread
            const doctors = {};
            filtered.forEach(b=>{ const d=b.doctor||'Unassigned'; doctors[d]=(doctors[d]||0)+1; });
            const docCount = Object.keys(doctors).filter(d=>d!=='Unassigned').length;
            if (docCount > 1) insights.push({
                icon:'👨‍⚕️', color:'#8e44ad',
                title:'Doctor Performance Spread',
                text:`<b>${docCount} doctors</b> are generating revenue. Review the Doctor-wise chart and consider focusing high-value treatments with specialist Dr. Sai Vakula.`
            });

            // Discount alert
            const totalDisc = filtered.reduce((s,b)=>s+parseFloat(b.discount||0),0);
            const discPct = totalRev > 0 ? (totalDisc/totalRev)*100 : 0;
            if (discPct > 10) insights.push({
                icon:'⚠️', color:'#e74c3c',
                title:'High Discount Rate',
                text:`Discounts are <b>${discPct.toFixed(1)}%</b> of revenue (₹${totalDisc.toFixed(0)}). Consider limiting to loyalty patients only to protect margins.`
            });

            // Low activity days
            const today = new Date().toLocaleDateString('en-CA');
            const todayBills = bills.filter(b=>String(b.date).split('T')[0]===today).length;
            if (todayBills === 0) insights.push({
                icon:'📣', color:'#16a085',
                title:'No Bills Today Yet',
                text:`No bills recorded today. Use WhatsApp status or ask reception to follow up pending appointments to drive walk-ins.`
            });

            // Prescriptions reminder
            insights.push({
                icon:'💊', color:'#2980b9',
                title:'Track Prescription Medicines',
                text:`Ensure every prescription is linked to a bill. Commonly prescribed items can be stocked in bulk to reduce cost and improve margins.`
            });

            // Growth tip
            insights.push({
                icon:'🦷', color:'#27ae60',
                title:'Boost Treatment Revenue',
                text:`Orthodontic treatment, Implants, and Root Canal are high-value procedures. Dr. Sai Vakula's MAXILLOFACIAL specialty can be promoted to increase specialty revenue.`
            });

            document.getElementById('rpt_insights').innerHTML = insights.map(ins=>`
                <div style="background:#f8f9fa;border-radius:8px;padding:14px 16px;border-left:4px solid ${ins.color};">
                    <div style="font-size:18px;margin-bottom:5px;">${ins.icon} <strong style="font-size:13px;color:${ins.color};">${ins.title}</strong></div>
                    <div style="font-size:12px;color:#555;line-height:1.6;">${ins.text}</div>
                </div>`).join('');
        }

        function renderSupplierReport() {
            const supplierEl  = document.getElementById('rpt_supplier_table');
            const supplierChEl = document.getElementById('rpt_supplier_chart');
            if (!supplierEl) return;

            if (!purchases || purchases.length === 0) {
                supplierEl.innerHTML = '<p style="color:#aaa;font-size:13px;text-align:center;padding:20px 0;">No purchase data yet.<br>Add purchases in the Purchases tab.</p>';
                if (supplierChEl) supplierChEl.innerHTML = '';
                return;
            }

            // Build revenue per medicine from bills (for margin calculation)
            const medRevenue = buildMedRevenue();

            // Aggregate by supplier
            const stats = {};
            purchases.forEach(p => {
                const sup = normSupplier(p.supplier);
                const med = normMedicine(p.medicineName);
                if (!stats[sup]) stats[sup] = { cost:0, revenue:0, qty:0, txns:0, meds:new Set() };
                const cost = purchaseCost(p);
                stats[sup].cost    += cost;
                stats[sup].qty     += parseInt(p.qty)||0;
                stats[sup].txns    += 1;
                stats[sup].meds.add(med);
                // Add revenue earned from this medicine (proportional to qty purchased)
                if (medRevenue[med]) stats[sup].revenue += medRevenue[med];
            });

            const sorted = Object.entries(stats).sort((a,b) => b[1].cost - a[1].cost);
            const grandCost    = sorted.reduce((s,[,v]) => s + v.cost, 0) || 1;
            const grandRevenue = sorted.reduce((s,[,v]) => s + v.revenue, 0);
            const grandProfit  = grandRevenue - grandCost;
            const colors = ['#e67e22','#2c5aa0','#27ae60','#8e44ad','#e74c3c','#16a085','#f39c12','#2980b9'];

            // Bar chart
            if (supplierChEl) {
                supplierChEl.style.marginBottom = '4px';
                supplierChEl.innerHTML = sorted.map(([sup, s], i) => {
                    const profit = s.revenue - s.cost;
                    const margin = s.revenue > 0 ? (profit/s.revenue)*100 : 0;
                    const mColor = margin >= 30 ? '#27ae60' : margin >= 10 ? '#e67e22' : '#e74c3c';
                    return `
                    <div style="margin-bottom:12px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;margin-bottom:5px;">
                            <span style="font-weight:700;color:#2c3e50;font-size:14px;">${esc(sup)}</span>
                            <span style="white-space:nowrap;display:flex;gap:16px;align-items:center;">
                                <span style="color:#e67e22;font-weight:700;">₹${s.cost.toLocaleString('en-IN',{maximumFractionDigits:0})} cost</span>
                                ${s.revenue>0?`<span style="background:${mColor}18;color:${mColor};padding:3px 10px;border-radius:20px;font-weight:800;font-size:12px;">${margin.toFixed(1)}% margin</span>`:'<span style="color:#aaa;font-size:12px;">No sales yet</span>'}
                            </span>
                        </div>
                        <div style="background:#f0f4ff;border-radius:6px;height:14px;width:100%;">
                            <div style="background:${colors[i%colors.length]};width:${Math.round((s.cost/grandCost)*100)}%;height:14px;border-radius:6px;"></div>
                        </div>
                    </div>`;
                }).join('');
            }

            const divider = '<div style="border-top:2px solid #f0f0f0;margin:20px 0;"></div>';

            supplierEl.innerHTML = divider + `
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <tr style="background:#fff3e0;">
                        <th style="padding:10px 12px;text-align:left;color:#e67e22;font-size:13px;">Supplier</th>
                        <th style="padding:10px 12px;text-align:center;color:#555;">Orders</th>
                        <th style="padding:10px 12px;text-align:right;color:#e74c3c;">Cost Paid</th>
                        <th style="padding:10px 12px;text-align:right;color:#2c5aa0;">Revenue</th>
                        <th style="padding:10px 12px;text-align:right;color:#27ae60;">Profit</th>
                        <th style="padding:10px 12px;text-align:right;color:#555;">Margin</th>
                        <th style="padding:10px 12px;text-align:right;color:#555;">Share</th>
                    </tr>
                    ${sorted.map(([sup, s], i) => {
                        const profit = s.revenue - s.cost;
                        const margin = s.revenue > 0 ? (profit/s.revenue)*100 : null;
                        const mColor = margin===null?'#aaa':margin>=30?'#27ae60':margin>=10?'#e67e22':'#e74c3c';
                        return `
                        <tr style="border-bottom:1px solid #f5f5f5;${i%2?'background:#fafafa':'background:white'}">
                            <td style="padding:11px 12px;font-weight:700;font-size:13px;color:#2c3e50;">${esc(sup)}</td>
                            <td style="padding:11px 12px;text-align:center;color:#7f8c8d;">${s.txns}</td>
                            <td style="padding:11px 12px;text-align:right;color:#e74c3c;font-weight:700;">₹${s.cost.toFixed(0)}</td>
                            <td style="padding:11px 12px;text-align:right;color:#2c5aa0;font-weight:700;">${s.revenue>0?'₹'+s.revenue.toFixed(0):'<span style="color:#ccc;">—</span>'}</td>
                            <td style="padding:11px 12px;text-align:right;font-weight:800;color:${profit>=0&&s.revenue>0?'#27ae60':'#e74c3c'};">${s.revenue>0?(profit>=0?'+':'')+' ₹'+Math.abs(profit).toFixed(0):'<span style="color:#ccc;">—</span>'}</td>
                            <td style="padding:11px 12px;text-align:right;">
                                ${margin!==null
                                    ?`<span style="background:${mColor}20;color:${mColor};padding:4px 10px;border-radius:20px;font-size:12px;font-weight:800;">${margin.toFixed(1)}%</span>`
                                    :'<span style="color:#aaa;font-size:12px;">No sales</span>'}
                            </td>
                            <td style="padding:11px 12px;text-align:right;">
                                <span style="background:#fff3e0;color:#e67e22;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700;">${Math.round((s.cost/grandCost)*100)}%</span>
                            </td>
                        </tr>`;
                    }).join('')}
                    <tr style="background:#fff3e0;border-top:2px solid #e67e22;font-weight:800;">
                        <td style="padding:12px;font-size:14px;color:#e67e22;" colspan="2">TOTAL</td>
                        <td style="padding:12px;text-align:right;font-size:14px;color:#e74c3c;">₹${grandCost.toFixed(0)}</td>
                        <td style="padding:12px;text-align:right;font-size:14px;color:#2c5aa0;">${grandRevenue>0?'₹'+grandRevenue.toFixed(0):'—'}</td>
                        <td style="padding:12px;text-align:right;font-size:14px;color:${grandProfit>=0?'#27ae60':'#e74c3c'};">${grandRevenue>0?(grandProfit>=0?'+':'')+' ₹'+Math.abs(grandProfit).toFixed(0):'—'}</td>
                        <td style="padding:12px;text-align:right;">
                            ${grandRevenue>0?`<span style="background:#27ae6020;color:#27ae60;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:800;">${((grandProfit/grandRevenue)*100).toFixed(1)}%</span>`:'—'}
                        </td>
                        <td style="padding:12px;text-align:right;font-size:14px;color:#e67e22;">100%</td>
                    </tr>
                </table>`;
        }

        // ── Normalize helpers (shared by all purchase/supplier functions) ──
        function normSupplier(s) {
            return (s||'Unknown').trim().toLowerCase().replace(/\b\w/g, c=>c.toUpperCase());
        }
        function normMedicine(m) {
            return (m||'Unknown').trim().replace(/\s+/g,' ');
        }
        function purchaseCost(p) {
            if (p.totalCost && parseFloat(p.totalCost) > 0) return parseFloat(p.totalCost);
            return (parseFloat(p.costPrice)||0) * (parseInt(p.qty)||0);
        }

        // Build a map of medicine name → total revenue earned from bills
        function buildMedRevenue() {
            const rev = {};
            bills.forEach(b => {
                let items = b.items || [];
                if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }
                items.forEach(item => {
                    const name = normMedicine(item.medicineName || item.name || '');
                    if (!name) return;
                    rev[name] = (rev[name]||0) + (parseFloat(item.amount)||0);
                });
            });
            return rev;
        }

        // Build a map of medicine name → total purchase cost
        function buildMedCost() {
            const cost = {};
            purchases.forEach(p => {
                const name = normMedicine(p.medicineName);
                cost[name] = (cost[name]||0) + purchaseCost(p);
            });
            return cost;
        }

        function renderPurchaseReport() {
            const kpiEl   = document.getElementById('rpt_purchase_kpis');
            const tableEl = document.getElementById('rpt_purchase_table');
            if (!tableEl) return;

            if (!purchases || purchases.length === 0) {
                if (kpiEl) kpiEl.innerHTML = '';
                tableEl.innerHTML = '<p style="color:#aaa;font-size:13px;text-align:center;padding:20px 0;">No purchase data yet.<br>Add purchases in the Purchases tab.</p>';
                return;
            }

            // KPIs — use purchaseCost() so totals match Sheets
            const totalSpent  = purchases.reduce((s,p) => s + purchaseCost(p), 0);
            const totalQty    = purchases.reduce((s,p) => s + (parseInt(p.qty)||0), 0);
            const totalOrders = purchases.length;
            // Unique meds after normalizing name (trim + collapse spaces)
            const uniqueMeds  = new Set(purchases.map(p => normMedicine(p.medicineName))).size;

            if (kpiEl) kpiEl.innerHTML = [
                { label:'Total Spent',  value:`₹${totalSpent.toLocaleString('en-IN',{maximumFractionDigits:0})}`, color:'#16a085' },
                { label:'Total Orders', value:totalOrders,  color:'#2c5aa0' },
                { label:'Total Units',  value:totalQty,     color:'#27ae60' },
                { label:'Unique Meds',  value:uniqueMeds,   color:'#8e44ad' },
            ].map(k => `
                <div style="background:#f8f9fa;border-radius:10px;padding:16px 20px;border-left:4px solid ${k.color};">
                    <div style="font-size:11px;color:#7f8c8d;text-transform:uppercase;letter-spacing:0.5px;">${k.label}</div>
                    <div style="font-size:26px;font-weight:800;color:${k.color};margin-top:4px;">${k.value}</div>
                </div>`).join('');

            // Medicine-wise — normalize name, use purchaseCost(), cross with revenue
            const medRevenue = buildMedRevenue();
            const medStats = {};
            purchases.forEach(p => {
                const name = normMedicine(p.medicineName);
                const cost = purchaseCost(p);
                if (!medStats[name]) medStats[name] = { qty:0, cost:0, orders:0, lastDate:'' };
                medStats[name].qty    += parseInt(p.qty)||0;
                medStats[name].cost   += cost;
                medStats[name].orders += 1;
                const d = String(p.date||'').split('T')[0];
                if (d > medStats[name].lastDate) medStats[name].lastDate = d;
            });

            // Attach revenue to each medicine
            Object.keys(medStats).forEach(name => {
                medStats[name].revenue = medRevenue[name] || 0;
                medStats[name].profit  = medStats[name].revenue - medStats[name].cost;
                medStats[name].margin  = medStats[name].revenue > 0
                    ? (medStats[name].profit / medStats[name].revenue) * 100 : null;
            });

            const sorted = Object.entries(medStats).sort((a,b)=>b[1].cost-a[1].cost).slice(0,15);
            const grandCost    = Object.values(medStats).reduce((s,v)=>s+v.cost,0) || 1;
            const grandRevenue = Object.values(medStats).reduce((s,v)=>s+v.revenue,0);
            const grandProfit  = grandRevenue - grandCost;

            tableEl.innerHTML = `
                <div style="font-size:13px;font-weight:700;color:#555;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px;">Medicine-wise Breakdown with Margins</div>
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <tr style="background:#e8f8f5;">
                        <th style="padding:11px 14px;text-align:left;color:#16a085;font-size:13px;">Medicine</th>
                        <th style="padding:11px 14px;text-align:center;color:#555;">Qty</th>
                        <th style="padding:11px 14px;text-align:right;color:#e74c3c;">Cost</th>
                        <th style="padding:11px 14px;text-align:right;color:#2c5aa0;">Revenue</th>
                        <th style="padding:11px 14px;text-align:right;color:#27ae60;">Profit</th>
                        <th style="padding:11px 14px;text-align:right;color:#555;">Margin</th>
                    </tr>
                    ${sorted.map(([name, s], i) => {
                        const mColor = s.margin===null?'#aaa':s.margin>=30?'#27ae60':s.margin>=10?'#e67e22':'#e74c3c';
                        return `
                        <tr style="border-bottom:1px solid #f0f0f0;${i%2?'background:#fafafa':'background:white'}">
                            <td style="padding:11px 14px;font-weight:600;color:#2c3e50;">${esc(name)}</td>
                            <td style="padding:11px 14px;text-align:center;color:#7f8c8d;">${s.qty}</td>
                            <td style="padding:11px 14px;text-align:right;color:#e74c3c;font-weight:700;">₹${s.cost.toFixed(0)}</td>
                            <td style="padding:11px 14px;text-align:right;color:#2c5aa0;font-weight:700;">${s.revenue>0?'₹'+s.revenue.toFixed(0):'<span style="color:#ccc;">—</span>'}</td>
                            <td style="padding:11px 14px;text-align:right;font-weight:800;color:${s.revenue>0?(s.profit>=0?'#27ae60':'#e74c3c'):'#ccc'};">${s.revenue>0?(s.profit>=0?'+':'-')+'₹'+Math.abs(s.profit).toFixed(0):'—'}</td>
                            <td style="padding:11px 14px;text-align:right;">
                                ${s.margin!==null
                                    ?`<span style="background:${mColor}22;color:${mColor};padding:4px 10px;border-radius:20px;font-size:12px;font-weight:800;">${s.margin.toFixed(1)}%</span>`
                                    :'<span style="color:#ccc;font-size:12px;">No sales</span>'}
                            </td>
                        </tr>`;
                    }).join('')}
                    <tr style="background:#e8f8f5;border-top:2px solid #16a085;font-weight:800;">
                        <td style="padding:12px 14px;font-size:14px;color:#16a085;" colspan="2">TOTAL</td>
                        <td style="padding:12px 14px;text-align:right;font-size:14px;color:#e74c3c;">₹${grandCost.toFixed(0)}</td>
                        <td style="padding:12px 14px;text-align:right;font-size:14px;color:#2c5aa0;">${grandRevenue>0?'₹'+grandRevenue.toFixed(0):'—'}</td>
                        <td style="padding:12px 14px;text-align:right;font-size:14px;color:${grandProfit>=0?'#27ae60':'#e74c3c'};">${grandRevenue>0?(grandProfit>=0?'+':'-')+'₹'+Math.abs(grandProfit).toFixed(0):'—'}</td>
                        <td style="padding:12px 14px;text-align:right;">
                            ${grandRevenue>0?`<span style="background:#27ae6022;color:#27ae60;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:800;">${((grandProfit/grandRevenue)*100).toFixed(1)}%</span>`:'—'}
                        </td>
                    </tr>
                </table>`;
        }

        function generatePurchaseReport() {
            if (!purchases || purchases.length === 0) {
                showToast('No purchase data to export', 'warning');
                return;
            }
            const medRevenue = buildMedRevenue();

            // Detail rows
            let csv = 'Date,Supplier,Medicine,Qty,Cost Price,Total Cost\n';
            purchases.forEach(p => {
                const d = String(p.date||'').split('T')[0];
                csv += `${csvQ(d)},${csvQ(normSupplier(p.supplier))},${csvQ(normMedicine(p.medicineName))},${p.qty||0},${parseFloat(p.costPrice||0).toFixed(2)},${purchaseCost(p).toFixed(2)}\n`;
            });

            // Supplier summary with margins
            const supStats = {};
            purchases.forEach(p => {
                const sup = normSupplier(p.supplier);
                const med = normMedicine(p.medicineName);
                if (!supStats[sup]) supStats[sup] = { cost:0, revenue:0 };
                supStats[sup].cost    += purchaseCost(p);
                supStats[sup].revenue += medRevenue[med] || 0;
            });
            csv += '\nSupplier Summary with Margins\nSupplier,Cost Paid,Revenue,Profit,Margin %\n';
            Object.entries(supStats).sort((a,b)=>b[1].cost-a[1].cost).forEach(([s,v]) => {
                const profit = v.revenue - v.cost;
                const margin = v.revenue > 0 ? ((profit/v.revenue)*100).toFixed(1)+'%' : 'N/A';
                csv += `${csvQ(s)},${v.cost.toFixed(2)},${v.revenue.toFixed(2)},${profit.toFixed(2)},${margin}\n`;
            });

            // Medicine summary with margins
            const medStats2 = {};
            purchases.forEach(p => {
                const med = normMedicine(p.medicineName);
                if (!medStats2[med]) medStats2[med] = { qty:0, cost:0 };
                medStats2[med].qty  += parseInt(p.qty)||0;
                medStats2[med].cost += purchaseCost(p);
            });
            csv += '\nMedicine Summary with Margins\nMedicine,Qty,Cost,Revenue,Profit,Margin %\n';
            Object.entries(medStats2).sort((a,b)=>b[1].cost-a[1].cost).forEach(([m,v]) => {
                const rev    = medRevenue[m] || 0;
                const profit = rev - v.cost;
                const margin = rev > 0 ? ((profit/rev)*100).toFixed(1)+'%' : 'N/A';
                csv += `${csvQ(m)},${v.qty},${v.cost.toFixed(2)},${rev.toFixed(2)},${profit.toFixed(2)},${margin}\n`;
            });

            downloadReport(csv, 'Purchase-wise-Report.csv');
            showToast('✅ Purchase report with margins downloaded!', 'success');
        }

        function generateTreatmentReport() {
            // Export treatment receipts log — reads from tr_history (same key as printTreatmentReceipt)
            try {
                const saved = JSON.parse(localStorage.getItem('tr_history') || '[]');
                if (!saved.length) { showToast('No treatment receipts saved yet', 'warning'); return; }
                let csv = 'Receipt No,Date,Patient,Amount,Treatments\n';
                saved.forEach(r => {
                    csv += `${csvQ(r.no||'')},${csvQ(r.date||'')},${csvQ(r.patient||'')},${csvQ(r.amount||'')},${csvQ(r.treatments||'')}\n`;
                });
                downloadReport(csv, 'Treatment-Receipts-Report.csv');
                showToast('✅ Treatment report downloaded!', 'success');
            } catch(e) { showToast('No treatment data found', 'warning'); }
        }

        // Auto-render when reports page is shown
        const _origShowPage = typeof showPage === 'function' ? showPage : null;

        // ══ END CLINIC PERFORMANCE REPORTS ═══════════════════════

        function updateDate() {
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
            document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-IN', options);
        }
;

;/* ══ FILE: 02-treatment-payment.js ══════════════════════════════════════════════ */
/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    var _trMode = 'Cash';
    function openTreatmentPayment() {
        const patient = (document.getElementById('tr_patient').value||'').trim();
        const amt = parseFloat(document.getElementById('tr_amount').value)||0;
        if (!patient) { showToast('Enter patient name first','warning'); return; }
        if (!amt)     { showToast('Enter treatment amount first','warning'); return; }
        const tDefs = ['Consultation','Teeth Cleaning (Scaling)','Fillings (Amalgam / Composite)','Root Canal Therapy','Crowns','Orthodontic Treatment','Flap Surgery','Extractions','Others'];
        const othTxt = (document.getElementById('tr_others_text')||{}).value||'';
        const sel = tDefs.filter((_,i)=>{ const cb=document.getElementById('tr_t'+(i+1)); return cb&&cb.checked; })
                         .map(t=>t==='Others'&&othTxt?'Others: '+othTxt:t).join(', ')||'Treatment';
        document.getElementById('trPmPatient').textContent    = patient;
        document.getElementById('trPmTreatments').textContent = sel;
        document.getElementById('trPmTotal').textContent      = '₹'+amt.toFixed(2);
        ['trPmTendered','trPmSplitCash','trPmSplitUpi','trPmCardRef'].forEach(id=>{ const e=document.getElementById(id); if(e)e.value=''; });
        document.getElementById('trPmChange').textContent='₹0';
        document.getElementById('trPmChange').style.color='#27ae60';
        document.getElementById('trSplitSt').textContent='';
        document.getElementById('trSplitSt').style.background='#f8f9fa';
        document.getElementById('trQuickChips').innerHTML=[100,200,500,1000,2000].map(v=>
            `<button class="tr-chip" data-onclick="document.getElementById('trPmTendered').value=${v};calcTrChange();">₹${v}</button>`).join('');
        const upiId=(typeof CONFIG!=='undefined'?CONFIG.upiId:'')||'';
        const upiName=(typeof CONFIG!=='undefined'?CONFIG.upiName:'')||'Sri Sai Dental';
        if (upiId.trim()) {
            document.getElementById('trUpiWarn').style.display='none';
            document.getElementById('trUpiCard').style.display='block';
            document.getElementById('trUpiAmt').textContent='₹'+amt.toFixed(2);
            document.getElementById('trUpiIdShow').textContent=upiId;
            const lnk=`upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${amt.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Dental')}`;
            document.getElementById('trUpiQr').src=qrDataUrl(lnk, 5);
        } else {
            document.getElementById('trUpiWarn').style.display='block';
            document.getElementById('trUpiCard').style.display='none';
        }
        selectTrMode('Cash');
        if (window.V31 && V31.partPay) V31.partPay.reset('tr');
        window.__trPay = null;
        const modal=document.getElementById('trPayModal');
        modal.style.display='flex';
        requestAnimationFrame(()=>requestAnimationFrame(()=>modal.classList.add('tr-open')));
        document.body.style.overflow='hidden';
    }
    function closeTrPayModal() {
        const modal=document.getElementById('trPayModal');
        modal.classList.remove('tr-open');
        setTimeout(()=>{ modal.style.display='none'; },370);
        document.body.style.overflow='';
    }
    function selectTrMode(mode) {
        _trMode=mode;
        ['Cash','UPI','Card','Split'].forEach(m=>{
            document.getElementById('trpm-'+m).classList.toggle('tr-active',m===mode);
            document.getElementById('trSec'+m).classList.toggle('tr-hide',m!==mode);
        });
    }
    function _trCollect() { const t = parseFloat((document.getElementById('trPmTotal').textContent||'').replace(/[₹,]/g,''))||0; return (window.V31 && V31.partPay) ? V31.partPay.amount('tr', t) : t; }
    function calcTrChange() {
        const total=_trCollect();
        const amt=parseFloat(document.getElementById('trPmTendered').value)||0;
        const chg=amt-total;
        const el=document.getElementById('trPmChange');
        el.textContent=chg>=0?'₹'+chg.toFixed(2):'-₹'+Math.abs(chg).toFixed(2);
        el.style.color=chg>=0?'#27ae60':'#e74c3c';
    }
    function calcTrSplit() {
        const total=_trCollect();
        const cash=parseFloat(document.getElementById('trPmSplitCash').value)||0;
        const upi=parseFloat(document.getElementById('trPmSplitUpi').value)||0;
        const rem=total-cash-upi;
        const el=document.getElementById('trSplitSt');
        if(Math.abs(rem)<0.01){el.textContent='✅ Balanced';el.style.background='#e8f8ee';el.style.color='#27ae60';}
        else if(rem>0){el.textContent='⚠️ ₹'+rem.toFixed(2)+' still pending';el.style.background='#fff8e1';el.style.color='#e67e22';}
        else{el.textContent='❌ Overpaid by ₹'+Math.abs(rem).toFixed(2);el.style.background='#fff0f0';el.style.color='#e74c3c';}
    }
    function confirmTrPayment() {
        const full=parseFloat((document.getElementById('trPmTotal').textContent||'').replace(/[₹,]/g,''))||0;
        const total=_trCollect();
        const credit = total <= 0 && full > 0;
        if (credit && !confirm('Save this receipt with nothing paid now?\n\n₹' + full.toFixed(2) + ' will be due from the patient.')) return;
        if(!credit&&_trMode==='Cash'&&(parseFloat(document.getElementById('trPmTendered').value)||0)<total){showToast('Amount tendered is less than '+(total<full?'the amount paid now':'total'),'warning');return;}
        if(!credit&&_trMode==='Split'){
            const c=parseFloat(document.getElementById('trPmSplitCash').value)||0;
            const u=parseFloat(document.getElementById('trPmSplitUpi').value)||0;
            if(Math.abs(c+u-total)>0.5){showToast('Split amounts must add up to '+(total<full?'the amount paid now':'total'),'warning');return;}
        }
        window.__trPay = { mode: credit ? 'Credit' : _trMode };
        if (total < full - 0.009) window.__trPay.paidAmount = Math.round(total * 100) / 100;
        if (!credit && _trMode === 'Split') { window.__trPay.cash = parseFloat(document.getElementById('trPmSplitCash').value)||0; window.__trPay.upi = parseFloat(document.getElementById('trPmSplitUpi').value)||0; }
        closeTrPayModal();
        const modeLabel={Cash:'💵 Cash',UPI:'📱 UPI / GPay',Card:'💳 Card',Split:'🔀 Split'};
        document.getElementById('trSucPat').textContent=document.getElementById('tr_patient').value||'—';
        document.getElementById('trSucNo').textContent=document.getElementById('tr_no').value||'—';
        document.getElementById('trSucAmt').textContent='₹'+total.toFixed(2)+(total<full-0.009?' (due ₹'+(full-total).toFixed(2)+')':'');
        document.getElementById('trSucMode').textContent=credit?'🕒 Pay later':(modeLabel[_trMode]||_trMode);
        setTimeout(()=>document.getElementById('trSuccessSheet').classList.add('tr-open'),220);
        printTreatmentReceipt();
    }
    function trSucPrint(){closeTrSuccess();setTimeout(()=>printBillHtml(buildTreatmentReceiptHTML(false)),150);}
    function closeTrSuccess(){document.getElementById('trSuccessSheet').classList.remove('tr-open');}
;

;/* ══ FILE: 03-receipt-numbers.js ══════════════════════════════════════════════ */
/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    // ── Auto Receipt Number ──────────────────────────────────────
    // Shared counter stored in localStorage as 'receipt_counter'
    // Format: year + 4-digit padded number e.g. 2026-0001

    function getNextReceiptNo() {
        var year = new Date().getFullYear();
        var key  = 'receipt_counter_' + year;
        var curr = parseInt(localStorage.getItem(key) || '0');
        var next = curr + 1;
        localStorage.setItem(key, next);
        return year + '-' + String(next).padStart(4, '0');
    }


    async function autoFillNo(fieldId) {
        var el = document.getElementById(fieldId);
        if (!el) return;
        var res = await API.call('reserveReceiptNo', {}, { noQueue: true });
        var no;
        if (res && res.success) no = res.receiptNo;
        else {
            // offline: device-tagged number that can never clash with server numbers
            var tag = localStorage.getItem('ssdc_device_tag') || Math.random().toString(36).slice(2, 5).toUpperCase();
            localStorage.setItem('ssdc_device_tag', tag);
            no = getNextReceiptNo() + '-' + tag;
            showToast('📴 Offline receipt number ' + no, 'warning');
        }
        el.value = no;
        el.style.borderColor = '#27ae60';
        el.style.background  = '#f0fff4';
        setTimeout(function(){ el.style.borderColor = ''; el.style.background = ''; }, 1500);
        el.dispatchEvent(new Event('input'));
        if (res && res.success) showToast('✅ Receipt No. ' + no + ' assigned', 'success');
    }
    function peekNextReceiptNo() { return 'tap Auto'; }
    // ── End Auto Receipt Number ──────────────────────────────────
;

;/* ══ FILE: 04-combined-bill.js ══════════════════════════════════════════════ */
/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    // ══════════════════════════════════════════════
    // COMBINED BILL
    // ══════════════════════════════════════════════
    var _cbCart = [];
    var _cbMode = 'Cash';

    function addCbMedicine() {
        var sel = document.getElementById('cb_medSelect');
        var qty = parseInt(document.getElementById('cb_medQty').value) || 1;
        if (!sel || !sel.value) { showToast('Select a medicine first', 'warning'); return; }
        var opt   = sel.options[sel.selectedIndex];
        var medId = sel.value;
        var price = parseFloat(opt.dataset.price) || 0;
        var stock = parseInt(opt.dataset.stock); if (!isFinite(stock)) stock = 0;
        var name  = opt.dataset.name || opt.text.split('—')[0].trim();
        if (!price) {
            var med = (window.medicines||[]).find(function(m){ return String(m.id)===String(medId); });
            if (med) { price=parseFloat(med.price)||0; stock=parseInt(med.stock)||9999; name=med.name; }
        }
        if (!Number.isInteger(qty) || qty < 1) { showToast('Quantity must be a whole number (1 or more)', 'warning'); return; }
        var existing = _cbCart.find(function(c){ return String(c.medicineId)===String(medId); });
        if (qty + (existing ? existing.qty : 0) > stock) { showToast('Only ' + stock + ' unexpired in stock!', 'warning'); return; }
        if (existing) {
            existing.qty += qty;
            existing.amount = existing.qty * existing.price;
        } else {
            _cbCart.push({ medicineId:medId, medicineName:name, qty:qty, price:price, amount:qty*price });
        }
        sel.value = '';
        document.getElementById('cb_medQty').value = 1;
        // Batch DOM updates in one frame
        requestAnimationFrame(function(){
            renderCbCart();
            recalcCombined();
        });
        showToast('✅ ' + name + ' added', 'success');
    }

    function removeCbCartItem(idx) {
        _cbCart.splice(idx, 1);
        requestAnimationFrame(function(){ renderCbCart(); recalcCombined(); });
    }

    // Cart uses CSS classes — no inline styles = faster rendering
    function renderCbCart() {
        var tbody = document.getElementById('cb_cartBody');
        if (!tbody) return;
        if (_cbCart.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="cb-empty-row">No medicines added yet</td></tr>';
            return;
        }
        var rows = '';
        for (var i = 0; i < _cbCart.length; i++) {
            var item = _cbCart[i];
            rows += '<tr class="' + (i%2===0?'':'cb-row-alt') + '">' +
                '<td class="cb-td">' + esc(item.medicineName) + '</td>' +
                '<td class="cb-td cb-td-c">' + item.qty + '</td>' +
                '<td class="cb-td cb-td-r">₹' + item.price.toFixed(2) + '</td>' +
                '<td class="cb-td cb-td-r cb-td-bold">₹' + item.amount.toFixed(2) + '</td>' +
                '<td class="cb-td cb-td-c"><button class="cb-rm-btn" data-onclick="removeCbCartItem(' + i + ')">✕</button></td>' +
                '</tr>';
        }
        tbody.innerHTML = rows;
    }

    function recalcCombined() {
        var trAmt = parseFloat(document.getElementById('cb_tr_amount').value) || 0;
        var phAmt = 0;
        for (var i=0; i<_cbCart.length; i++) phAmt += _cbCart[i].amount;
        var grand = trAmt + phAmt;
        // Direct textContent updates — fastest DOM write
        document.getElementById('cb_medSubtotal').textContent = phAmt.toFixed(2);
        document.getElementById('cb_trShow').textContent      = trAmt.toFixed(2);
        document.getElementById('cb_phShow').textContent      = phAmt.toFixed(2);
        document.getElementById('cb_grandTotal').textContent  = grand.toFixed(2);
        scheduleCbPreview();
    }

    function clearCombinedForm() {
        ['cb_no','cb_patient','cb_phone','cb_tr_desc','cb_tr_amount','cb_tr_words'].forEach(function(id){
            var el=document.getElementById(id); if(el) el.value='';
        });
        var dr=document.getElementById('cb_doctor'); if(dr) dr.value='';
        var iq=document.getElementById('cb_medQty'); if(iq) iq.value=1;
        var is=document.getElementById('cb_medSelect'); if(is) is.value='';
        _cbCart=[];
        renderCbCart();
        recalcCombined();
        // Update placeholder to show next available number
        var cbn = document.getElementById('cb_no');
        if (cbn && typeof peekNextReceiptNo === 'function') {
            cbn.placeholder = 'Next: ' + peekNextReceiptNo() + ' (click Auto)';
        }
    }

    function buildCombinedBillHTML(pay) {
        var no      = esc(document.getElementById('cb_no').value      || '___________');
        var dateV   = document.getElementById('cb_date').value    || '';
        var patient = esc(document.getElementById('cb_patient').value || '______________________________');
        var doctor  = esc(document.getElementById('cb_doctor').value  || '—');
        var phone   = esc(document.getElementById('cb_phone').value   || '');
        var trDesc  = document.getElementById('cb_tr_desc').value || '';
        var trAmt   = parseFloat(document.getElementById('cb_tr_amount').value)||0;
        var words   = document.getElementById('cb_tr_words').value|| '';
        var dateStr = dateV ? new Date(dateV).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) : '_______________';
        var phAmt   = _cbCart.reduce(function(s,c){return s+parseFloat(c.amount);},0);
        var grand   = trAmt+phAmt;

        var trDescHtml = trDesc
            ? trDesc.split('\n').map(function(l){return '<div style="padding:4px 0;border-bottom:1px dotted #bbb;">'+(esc(l.trim())||'&nbsp;')+'</div>';}).join('')
            : '<div style="padding:4px 0;border-bottom:1px dotted #bbb;">&nbsp;</div><div style="padding:4px 0;border-bottom:1px dotted #bbb;">&nbsp;</div><div style="padding:4px 0;border-bottom:1px dotted #bbb;">&nbsp;</div>';

        var medRows = _cbCart.length>0 ? _cbCart.map(function(item,i){
            return '<tr style="background:'+(i%2===0?'#fff':'#f8f9fa')+';">' +
                '<td style="padding:7px 10px;border-bottom:1px solid #eee;">'+esc(item.medicineName)+'</td>' +
                '<td style="padding:7px 6px;text-align:center;border-bottom:1px solid #eee;">'+item.qty+'</td>' +
                '<td style="padding:7px 6px;text-align:right;border-bottom:1px solid #eee;">&#8377;'+parseFloat(item.price).toFixed(2)+'</td>' +
                '<td style="padding:7px 10px;text-align:right;border-bottom:1px solid #eee;font-weight:600;">&#8377;'+parseFloat(item.amount).toFixed(2)+'</td>' +
                '</tr>';
        }).join('') : '<tr><td colspan="4" style="text-align:center;color:#aaa;padding:8px;">No medicines</td></tr>';

        var clinicAddr  = (typeof CONFIG!=='undefined')?(CONFIG.clinicAddress||'TKR College Road, Karmanghat, Hyderabad.'):'TKR College Road, Karmanghat, Hyderabad.';
        var clinicPhone = (typeof CONFIG!=='undefined')?(CONFIG.clinicPhone  ||'9396522492, 8688033072'):'9396522492, 8688033072';

        return '<style>@page{size:A4 portrait;margin:10mm;}#__cb,#__cb *{font-family:"Bookman Old Style","Book Antiqua",Bookman,Georgia,serif;box-sizing:border-box;margin:0;padding:0;}#__cb{width:100%;color:#000;background:#fff;font-size:13px;line-height:1.4;}#__cb h1{text-align:center;font-size:19px;font-weight:900;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px;}#__cb .addr{text-align:center;font-size:11.5px;margin-bottom:2px;}#__cb .mob{text-align:center;font-size:11.5px;margin-bottom:10px;}#__cb .doctors{display:table;width:100%;border-collapse:collapse;border:1.5px solid #000;margin-bottom:10px;}#__cb .doc-cell{display:table-cell;width:50%;padding:8px 12px;text-align:center;font-size:12px;line-height:1.75;vertical-align:middle;}#__cb .doc-cell:first-child{border-right:1.5px solid #000;}#__cb .doc-cell strong{font-size:13px;display:block;}#__cb .receipt-title{text-align:center;font-size:15px;font-weight:900;letter-spacing:3px;margin-bottom:12px;text-decoration:underline;}#__cb .info-row{display:flex;align-items:flex-end;width:100%;margin-bottom:10px;}#__cb .i-left{display:flex;align-items:flex-end;flex:0 0 55%;padding-right:6px;}#__cb .i-right{display:flex;align-items:flex-end;flex:0 0 45%;}#__cb .i-lbl{flex:0 0 auto;white-space:nowrap;padding-right:7px;padding-bottom:2px;}#__cb .i-val{flex:1 1 0;border-bottom:1.5px solid #000;padding:0 3px 2px;min-height:18px;font-weight:bold;}#__cb .i-sep{flex:0 0 auto;white-space:nowrap;padding-right:7px;padding-bottom:2px;}#__cb .sec-hdr{font-size:13px;font-weight:900;letter-spacing:1px;margin:12px 0 6px;padding:5px 10px;background:#1e3f5a;color:white;border-radius:4px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}#__cb .tr-box{border:1px solid #ccc;border-radius:6px;padding:8px 12px;min-height:55px;margin-bottom:8px;}#__cb .tr-amt-row{display:flex;justify-content:space-between;font-size:14px;font-weight:700;padding:7px 12px;background:#f0f4ff;border-radius:6px;margin-bottom:4px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}#__cb table.meds{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px;}#__cb table.meds thead tr{background:#27ae60;color:white;-webkit-print-color-adjust:exact;print-color-adjust:exact;}#__cb table.meds thead th{padding:7px 10px;text-align:left;}#__cb table.meds thead th:not(:first-child){text-align:center;}#__cb table.meds thead th:last-child{text-align:right;}#__cb .summary-box{background:#f0f4ff;border-radius:8px;padding:12px 14px;margin-top:10px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}#__cb .summary-box table{width:100%;border-collapse:collapse;font-size:13px;}#__cb .summary-box td{padding:5px 0;}#__cb .summary-box td:last-child{text-align:right;font-weight:700;}#__cb .grand-row td{font-size:18px;font-weight:900;color:#2c5aa0;border-top:2px solid #2c5aa0;padding-top:8px;}#__cb .sig-row{display:flex;justify-content:flex-end;margin-top:20px;font-size:13px;padding-right:4px;}#__cb .footer{text-align:center;font-size:10px;color:#555;font-style:italic;border-top:1px solid #ccc;margin-top:14px;padding-top:8px;line-height:1.6;}@media print{html,body{margin:0;padding:0;}#__cb{width:100%;}}</style>' +
        '<div id="__cb">' +
        '<h1>Sri Sai Speciality Dental Care</h1>' +
        '<div class="addr">'+clinicAddr+'</div>' +
        '<div class="addr">Mobile : '+clinicPhone+'</div>' +
        '<div class="mob"><strong>Timings :- MON-SUN &nbsp; 9AM TO 9PM</strong></div>' +
        '<div class="doctors"><div class="doc-cell"><strong>DR. T. VENKAT RAO</strong>Reg. A-734<br>B.D.S (Osm), M.R.S.H, FAGE,<br>(SENIOR DENTAL SURGEON)<br>Member, Indian Dental Association</div><div class="doc-cell"><strong>DR. T. SAI VAKULA</strong>Reg. A-15680<br>M.D.S.<br>MAXILLOFACIAL SURGEON &amp; IMPLANTOLOGIST<br>Specialist in Lasers &amp; Cosmetic Dentistry</div></div>' +
        '<div class="receipt-title">BILL SUMMARY</div>' +
        '<div style="margin-bottom:14px;font-size:13px;">' +
        '<div class="info-row"><div class="i-left"><span class="i-lbl">No.</span><span class="i-val">&nbsp;'+no+'</span></div><div class="i-right"><span class="i-sep">Date:</span><span class="i-val">&nbsp;'+dateStr+'</span></div></div>' +
        '<div class="info-row"><div class="i-left"><span class="i-lbl">Patient</span><span class="i-val">&nbsp;'+patient+'</span></div><div class="i-right"><span class="i-sep">Doctor:</span><span class="i-val">&nbsp;'+doctor+'</span></div></div>' +
        (phone?'<div class="info-row"><div class="i-left"><span class="i-lbl">Phone</span><span class="i-val">&nbsp;'+phone+'</span></div><div class="i-right"></div></div>':'') +
        '</div>' +
        '<div class="sec-hdr">&#9658; TREATMENT</div>' +
        '<div class="tr-box">'+trDescHtml+'</div>' +
        '<div class="tr-amt-row"><span>Treatment Amount</span><span>&#8377;'+trAmt.toFixed(2)+(words?' ('+esc(words)+')':'')+'</span></div>' +
        '<div class="sec-hdr">&#9658; PHARMACY / MEDICINES</div>' +
        '<table class="meds"><thead><tr><th>Medicine</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead><tbody>'+medRows+'</tbody></table>' +
        '<div class="summary-box"><table>' +
        '<tr><td style="color:#1e3f5a;">🦷 Treatment Charges</td><td>&#8377;'+trAmt.toFixed(2)+'</td></tr>' +
        '<tr><td style="color:#27ae60;">💊 Pharmacy Charges</td><td>&#8377;'+phAmt.toFixed(2)+'</td></tr>' +
        '<tr class="grand-row"><td><strong>Grand Total</strong></td><td><strong>&#8377;'+grand.toFixed(2)+'</strong></td></tr>' +
        '</table></div>' +
        (pay && pay.due > 0.009 ? '<div id="__cbpay" data-paid="'+pay.paid.toFixed(2)+'" data-due="'+pay.due.toFixed(2)+'" style="border:1.5px solid #000;padding:6px 10px;margin:8px 0;font-size:13px;display:flex;justify-content:space-between;gap:10px;"><span>Paid now: &#8377;'+pay.paid.toFixed(2)+'</span><strong>Balance due: &#8377;'+pay.due.toFixed(2)+'</strong></div>' : '') +
        '<div class="sig-row">Signature</div>' +
        '<div class="footer">Cherish your Yesterdays, Dream your Tomorrow, but live your today<br>Beauty is a Power and Smile is a Sword</div>' +
        '</div>';
    }

    // ── Debounce helper ──────────────────────────────────────────
    var _cbPreviewTimer = null;
    function scheduleCbPreview() {
        clearTimeout(_cbPreviewTimer);
        _cbPreviewTimer = setTimeout(function(){ updateCombinedPreview(); }, 800);
    }

    function updateCombinedPreview() {
        var p = document.getElementById('cb_preview');
        if (p) p.innerHTML = buildCombinedBillHTML();
    }
    function printCombinedBill() {
        if(!(document.getElementById('cb_patient').value||'').trim()){showToast('Enter patient name first','warning');return;}
        printBillHtml(buildCombinedBillHTML());
    }

    function shareCbWhatsApp() {
        var patient = (document.getElementById('cb_patient').value||'').trim();
        var phone   = (document.getElementById('cb_phone').value||'').trim();
        var doctor  = document.getElementById('cb_doctor').value || '';
        var no      = document.getElementById('cb_no').value || '';
        var dateV   = document.getElementById('cb_date').value || '';
        var trDesc  = (document.getElementById('cb_tr_desc').value||'').trim();
        var trAmt   = parseFloat(document.getElementById('cb_tr_amount').value)||0;
        var phAmt   = _cbCart.reduce(function(s,c){return s+parseFloat(c.amount);},0);
        var grand   = trAmt + phAmt;
        var dateStr = dateV ? new Date(dateV).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';

        if (!phone) { showToast('Enter patient phone number first','warning'); document.getElementById('cb_phone').focus(); return; }
        if (!patient) { showToast('Enter patient name first','warning'); return; }
        if (grand<=0) { showToast('Add treatment amount or medicines first','warning'); return; }

        // Build WhatsApp message
        var msg = '*🦷 SRI SAI SPECIALITY DENTAL CARE*\n';
        msg += 'TKR College Road, Karmanghat, Hyderabad\n';
        msg += '📞 8688033072 | 9396522492, 8688033072\n';
        msg += '─────────────────────────\n\n';
        msg += 'Hello *' + patient + '*! 😊\n\n';
        msg += '*COMBINED BILL*\n';
        if (no)      msg += 'Receipt No: ' + no + '\n';
        if (dateStr) msg += 'Date: ' + dateStr + '\n';
        if (doctor)  msg += 'Doctor: ' + doctor + '\n';
        msg += '\n';

        // Treatment section
        if (trDesc || trAmt > 0) {
            msg += '*🦷 TREATMENT*\n';
            if (trDesc) msg += trDesc + '\n';
            msg += 'Amount: ₹' + trAmt.toFixed(2) + '\n\n';
        }

        // Pharmacy section
        if (_cbCart.length > 0) {
            msg += '*💊 PHARMACY / MEDICINES*\n';
            _cbCart.forEach(function(item) {
                msg += '• ' + item.medicineName + ' × ' + item.qty + ' @ ₹' + parseFloat(item.price).toFixed(2) + ' = *₹' + parseFloat(item.amount).toFixed(2) + '*\n';
            });
            msg += 'Medicine Total: ₹' + phAmt.toFixed(2) + '\n\n';
        }

        msg += '─────────────────────────\n';
        msg += '🦷 Treatment: ₹' + trAmt.toFixed(2) + '\n';
        msg += '💊 Pharmacy:  ₹' + phAmt.toFixed(2) + '\n';
        msg += '*💰 GRAND TOTAL: ₹' + grand.toFixed(2) + '*\n';
        msg += '─────────────────────────\n\n';
        msg += 'Thank you for visiting Sri Sai Speciality Dental Care! 🙏\n';
        msg += '_Beauty is a Power and Smile is a Sword_ 😁';

        var cleanPhone = phone.replace(/[^\d]/g,'');
        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
        var url = 'https://wa.me/' + cleanPhone;
        window.open(url, '_blank');
    }
    function openCbPayment() {
        var patient=(document.getElementById('cb_patient').value||'').trim();
        if(!patient){showToast('Enter patient name first','warning');return;}
        var trAmt=parseFloat(document.getElementById('cb_tr_amount').value)||0;
        var phAmt=_cbCart.reduce(function(s,c){return s+parseFloat(c.amount);},0);
        var grand=trAmt+phAmt;
        if(grand<=0){showToast('Grand total is 0 — add treatment or medicines','warning');return;}
        document.getElementById('cbPmPatient').textContent=patient;
        document.getElementById('cbPmTotal').textContent='₹'+grand.toFixed(2);
        document.getElementById('cbPmTr').textContent=trAmt.toFixed(2);
        document.getElementById('cbPmPh').textContent=phAmt.toFixed(2);
        ['cbPmTendered','cbPmSplitCash','cbPmSplitUpi','cbPmCardRef'].forEach(function(id){var e=document.getElementById(id);if(e)e.value='';});
        document.getElementById('cbPmChange').textContent='₹0';
        document.getElementById('cbPmChange').style.color='#27ae60';
        document.getElementById('cbSplitSt').textContent='';
        document.getElementById('cbSplitSt').style.background='#f8f9fa';
        document.getElementById('cbQuickChips').innerHTML=[100,200,500,1000,2000].map(function(v){
            return '<button data-onclick="document.getElementById(\'cbPmTendered\').value='+v+';calcCbChange();" style="padding:8px 12px;border:1px solid #ddd;border-radius:8px;background:white;font-size:13px;font-weight:700;cursor:pointer;">₹'+v+'</button>';
        }).join('');
        var upiId=(typeof CONFIG!=='undefined'?CONFIG.upiId:'')||'';
        var upiName=(typeof CONFIG!=='undefined'?CONFIG.upiName:'')||'Sri Sai Dental';
        if(upiId.trim()){
            document.getElementById('cbUpiWarn').style.display='none';
            document.getElementById('cbUpiCard').style.display='block';
            document.getElementById('cbUpiAmt').textContent=grand.toFixed(2);
            document.getElementById('cbUpiIdShow').textContent=upiId;
            var lnk='upi://pay?pa='+encodeURIComponent(upiId)+'&pn='+encodeURIComponent(upiName)+'&am='+grand.toFixed(2)+'&cu=INR&tn='+encodeURIComponent('Dental');
            document.getElementById('cbUpiQr').src=qrDataUrl(lnk, 5);
        } else {
            document.getElementById('cbUpiWarn').style.display='block';
            document.getElementById('cbUpiCard').style.display='none';
        }
        selectCbMode('Cash');
        if (window.V31 && V31.partPay) V31.partPay.reset('cb');
        var modal=document.getElementById('cbPayModal');
        modal.style.display='flex';
        // Force GPU layer before animating
        document.getElementById('cbPayCard').style.transform='translate3d(0,100%,0)';
        requestAnimationFrame(function(){
            requestAnimationFrame(function(){
                document.getElementById('cbPayCard').style.transform='translate3d(0,0,0)';
            });
        });
        document.body.style.overflow='hidden';
    }
    function closeCbPayModal(){document.getElementById('cbPayCard').style.transform='translate3d(0,100%,0)';setTimeout(function(){document.getElementById('cbPayModal').style.display='none';},340);document.body.style.overflow='';}
    function selectCbMode(mode){_cbMode=mode;['Cash','UPI','Card','Split'].forEach(function(m){var btn=document.getElementById('cbpm-'+m);var sec=document.getElementById('cbSec'+m);if(btn){btn.style.background=(m===mode)?'#2c5aa0':'white';btn.style.color=(m===mode)?'white':'#333';btn.style.borderColor=(m===mode)?'#2c5aa0':'#e0e0e0';}if(sec)sec.style.display=(m===mode)?'block':'none';});}
    function _cbCollect(){var t=parseFloat((document.getElementById('cbPmTotal').textContent||'').replace(/[₹,]/g,''))||0;return (window.V31&&V31.partPay)?V31.partPay.amount('cb',t):t;}
    function calcCbChange(){var total=_cbCollect();var amt=parseFloat(document.getElementById('cbPmTendered').value)||0;var chg=amt-total;var el=document.getElementById('cbPmChange');el.textContent=chg>=0?'₹'+chg.toFixed(2):'-₹'+Math.abs(chg).toFixed(2);el.style.color=chg>=0?'#27ae60':'#e74c3c';}
    function calcCbSplit(){var total=_cbCollect();var cash=parseFloat(document.getElementById('cbPmSplitCash').value)||0;var upi=parseFloat(document.getElementById('cbPmSplitUpi').value)||0;var rem=total-cash-upi;var el=document.getElementById('cbSplitSt');if(Math.abs(rem)<0.01){el.textContent='✅ Balanced';el.style.background='#e8f8ee';el.style.color='#27ae60';}else if(rem>0){el.textContent='⚠️ ₹'+rem.toFixed(2)+' still pending';el.style.background='#fff8e1';el.style.color='#e67e22';}else{el.textContent='❌ Overpaid by ₹'+Math.abs(rem).toFixed(2);el.style.background='#fff0f0';el.style.color='#e74c3c';}}
    function confirmCbPayment(){
        var full=parseFloat((document.getElementById('cbPmTotal').textContent||'').replace(/[₹,]/g,''))||0;
        var total=_cbCollect(), cbCredit = total <= 0 && full > 0;
        if(cbCredit && !confirm('Save this bill with nothing paid now?\n\n₹' + full.toFixed(2) + ' will be due from the patient.')) return;
        window.__cbPaid = total < full - 0.009 ? Math.round(total*100)/100 : null;
        if(!cbCredit&&_cbMode==='Cash'&&(parseFloat(document.getElementById('cbPmTendered').value)||0)<total){showToast('Amount tendered is less than '+(total<full?'the amount paid now':'total'),'warning');return;}
        if(!cbCredit&&_cbMode==='Split'){
            var c=parseFloat(document.getElementById('cbPmSplitCash').value)||0;
            var u=parseFloat(document.getElementById('cbPmSplitUpi').value)||0;
            if(Math.abs(c+u-total)>0.5){showToast('Split amounts must add up to total','warning');return;}
        }
        closeCbPayModal();

        var patient = document.getElementById('cb_patient').value || '';
        var doctor  = document.getElementById('cb_doctor').value  || '';
        var phone   = document.getElementById('cb_phone').value   || '';
        var no      = document.getElementById('cb_no').value      || '';
        var dateV   = document.getElementById('cb_date').value    || new Date().toLocaleDateString('en-CA');
        var trAmt   = parseFloat(document.getElementById('cb_tr_amount').value)||0;
        var phAmt   = _cbCart.reduce(function(s,c){return s+parseFloat(c.amount);},0);
        var grand   = trAmt + phAmt;
        var billId  = 'CB-' + Date.now();

        // ── Deduct stock locally ─────────────────────────────────
        _cbCart.forEach(function(item){
            var med=(window.medicines||[]).find(function(m){return String(m.id)===String(item.medicineId);});
            if(med) med.stock=Math.max(0,(parseInt(med.stock)||0)-item.qty);
        });

        // ── Push into local bills array → dashboard updates instantly ──
        var costTotal = _cbCart.reduce(function(s,c){
            var med=(window.medicines||[]).find(function(m){return String(m.id)===String(c.medicineId);});
            return s+(med?parseFloat(med.costPrice||0)*c.qty:0);
        },0);

        // Pharmacy part → Bills; treatment part → TreatmentReceipts (so revenue is never counted twice)
        var localBill = {
            billId:      billId,
            patientName: patient,
            doctor:      doctor,
            phone:       phone,
            date:        dateV,
            subtotal:    phAmt,
            discount:    0,
            total:       phAmt,
            syncStatus:  'saving',
            costTotal:   costTotal,   // only pharmacy has cost; treatment profit = full amount
            paymentMode: _cbMode,
            items:       _cbCart.map(function(item){ return {
                medicineId:   item.medicineId,
                medicineName: item.medicineName,
                qty:          item.qty,
                price:        item.price,
                costPrice:    (function(){ var med=(window.medicines||[]).find(function(m){return String(m.id)===String(item.medicineId);}); return med?parseFloat(med.costPrice||0):0; })(),
                amount:       item.amount
            }; })
        };

        if(window.bills && _cbCart.length) window.bills.push(localBill);
        var trAmtLocal = parseFloat(document.getElementById('cb_tr_amount').value)||0;
        var cbRecordId = newId('TR');
        if (trAmtLocal > 0) serverTreatments.push({ no: no, date: dateV, patient: patient, doctor: doctor, amount: trAmtLocal,
            treatments: document.getElementById('cb_tr_desc').value || '', recordId: cbRecordId, paymentMode: _cbMode, pending: true });

        // ── Refresh all UI immediately ───────────────────────────
        if(typeof updateDashboard     ==='function') updateDashboard();
        if(typeof updateBillsTable    ==='function') updateBillsTable();
        if(typeof updateInventoryTable==='function') updateInventoryTable();
        if(typeof updateMedicineSelect==='function') updateMedicineSelect();

        // ── Print ────────────────────────────────────────────────
        saveCbRecordToHistory(billId);   // save to history BEFORE printing
        var cbPaidNow = cbCredit ? 0 : (window.__cbPaid !== null && window.__cbPaid !== undefined ? window.__cbPaid : grand);
        var cbPrintPay = { paid: Math.round(cbPaidNow * 100) / 100, due: Math.round((grand - cbPaidNow) * 100) / 100 };
        setTimeout(function(){printBillHtml(buildCombinedBillHTML(cbPrintPay));},200);
        showToast('✅ Dashboard updated! Syncing to Google Sheets...','success');
        // Update receipt no placeholder for next bill
        var cbn = document.getElementById('cb_no');
        if (cbn && typeof peekNextReceiptNo === 'function') {
            cbn.placeholder = 'Next: ' + peekNextReceiptNo() + ' (click Auto)';
        }

        // ── Save to Google Sheets in background ──────────────────
        saveCombinedBillToSheets(cbCredit ? 'Credit' : _cbMode, billId, dateV, grand, phAmt, costTotal, patient, doctor, phone, no, cbRecordId);
    }

    function saveCombinedBillToSheets(payMode, billId, dateV, grand, phAmt, costTotal, patient, doctor, phone, no, recordId) {
        var trDesc  = document.getElementById('cb_tr_desc').value  || '';
        var trAmt   = parseFloat(document.getElementById('cb_tr_amount').value)||0;
        var trWords = document.getElementById('cb_tr_words').value || '';
        var cartItems = _cbCart.map(function(item){ return { medicineId: item.medicineId, medicineName: item.medicineName, qty: item.qty, price: item.price, amount: item.amount }; });
        var splitCash = parseFloat((document.getElementById('cbPmSplitCash')||{}).value)||0, splitUpi = parseFloat((document.getElementById('cbPmSplitUpi')||{}).value)||0;
        // Money paid now goes to the medicines first, then to the treatment. Split cash/UPI is shared out the same way.
        var r2 = function(x){ return Math.round((+x||0)*100)/100; };
        var paidNow = payMode === 'Credit' ? 0 : (window.__cbPaid !== null && window.__cbPaid !== undefined ? window.__cbPaid : grand);
        var phPaid = r2(Math.min(phAmt, paidNow)), trPaid = r2(paidNow - phPaid);
        var phCash = r2(Math.min(splitCash, phPaid)), phUpi = r2(phPaid - phCash), trCash = r2(splitCash - phCash), trUpi = r2(splitUpi - phUpi);
        var partMode = function(paid){ return paid <= 0 ? 'Credit' : payMode; };
        var pid = (window.V31 && V31.enabled()) ? V31.patientIdFor('cb_patient', 'cb_phone') : '';
        window.__cbPaid = null;

        // ── 1. Treatment receipt (dental revenue) ──
        if (trAmt > 0 || trDesc) {
            API.call('saveTreatmentReceipt', { recordId: recordId || newId('TR'), receiptNo: no, date: dateV, patient: patient, doctor: doctor, phone: phone, patientId: pid,
                amount: trAmt.toFixed(2), amountWords: trWords, treatments: trDesc, paymentMode: partMode(trPaid),
                paidAmount: trPaid < trAmt - 0.009 ? trPaid.toFixed(2) : '', cashAmount: payMode === 'Split' ? trCash : '', upiAmount: payMode === 'Split' ? trUpi : '' }).then(function(res){
                if (res.success) showToast('☁️ Treatment saved', 'success');
                else if (res.queued) showToast('📴 Treatment kept on this device — will sync', 'warning');
                else showToast('❌ Treatment NOT saved: ' + (res.error || ''), 'error');
            });
        }
        // ── 2. Pharmacy bill (server checks stock, FEFO, totals) ──
        if (cartItems.length > 0) {
            setBillSyncStatus && setBillSyncStatus('saving');
            API.call('saveBill', { billId: billId, patientName: patient, doctor: doctor, phone: phone, date: dateV,
                subtotal: phAmt.toFixed(2), discount: '0', total: phAmt.toFixed(2), paymentMode: partMode(phPaid), paymentRef: '', patientId: pid,
                cashAmount: payMode === 'Split' ? phCash : '', upiAmount: payMode === 'Split' ? phUpi : '',
                paidAmount: phPaid < phAmt - 0.009 ? phPaid.toFixed(2) : '',
                items: JSON.stringify(cartItems) }).then(function(res){ applyBillSaveResult(billId, res, cartItems); });
        }
    }

        function reprintCbBillFromAllBills(billId) {
        // Search window.bills first
        var bill = (window.bills||[]).find(function(b){ return b.billId === billId; });
        // Then search CB history by stored billId
        if (!bill) {
            var hist = getCbHistory().find(function(r){ return r.billId === billId; });
            if (hist) bill = hist;
        }
        if (!bill) { showToast('Bill not found — may have been cleared from history', 'error'); return; }

        // Snapshot current form state
        var snap = {
            no:    document.getElementById('cb_no').value,
            date:  document.getElementById('cb_date').value,
            pat:   document.getElementById('cb_patient').value,
            doc:   document.getElementById('cb_doctor').value,
            phone: document.getElementById('cb_phone').value,
            desc:  document.getElementById('cb_tr_desc').value,
            amt:   document.getElementById('cb_tr_amount').value,
            words: document.getElementById('cb_tr_words').value,
            cart:  _cbCart.slice()
        };

        // Fill form with bill data
        document.getElementById('cb_no').value        = bill.no       || bill.billId || '';
        document.getElementById('cb_date').value      = bill.date     || '';
        document.getElementById('cb_patient').value   = bill.patientName || bill.patient || '';
        document.getElementById('cb_doctor').value    = bill.doctor   || '';
        document.getElementById('cb_phone').value     = bill.phone    || '';
        document.getElementById('cb_tr_desc').value   = bill.trDesc   || '';
        document.getElementById('cb_tr_amount').value = bill.trAmt != null ? bill.trAmt : '';
        document.getElementById('cb_tr_words').value  = bill.trWords  || '';
        _cbCart = (bill.cart || bill.items || []).map(function(c){
            return { medicineId:c.medicineId||'', medicineName:c.medicineName||c.name||'', qty:c.qty, price:c.price, amount:c.amount };
        });

        var html = buildCombinedBillHTML();

        // Restore form
        document.getElementById('cb_no').value        = snap.no;
        document.getElementById('cb_date').value      = snap.date;
        document.getElementById('cb_patient').value   = snap.pat;
        document.getElementById('cb_doctor').value    = snap.doc;
        document.getElementById('cb_phone').value     = snap.phone;
        document.getElementById('cb_tr_desc').value   = snap.desc;
        document.getElementById('cb_tr_amount').value = snap.amt;
        document.getElementById('cb_tr_words').value  = snap.words;
        _cbCart = snap.cart;

        printBillHtml(html);
        showToast('🖨️ Reprinting Bill Summary...', 'success');
    }

    function shareWhatsAppCb(billId) {
        // Search window.bills first, then localStorage history
        var bill = (window.bills||[]).find(function(b){ return b.billId === billId; });
        if (!bill) {
            var hist = getCbHistory().find(function(r){ return r.billId === billId; });
            if (hist) bill = hist;
        }
        if (!bill) { showToast('Bill not found — may have been cleared from history', 'error'); return; }

        var phone = (String(bill.phone||'')).replace(/[^\d]/g,'');
        if (!phone) { showToast('No phone number saved for this bill','warning'); return; }
        if (phone.length === 10) phone = '91' + phone;

        var patient = bill.patientName || bill.patient || 'Patient';
        var trAmt   = parseFloat(bill.trAmt || 0);
        var items   = bill.cart || bill.items || [];
        var phAmt   = items.reduce(function(s,c){ return s + parseFloat(c.amount||0); }, 0);
        var grand   = parseFloat(bill.grand || bill.total || (trAmt + phAmt));

        var msg = '*🦷 SRI SAI SPECIALITY DENTAL CARE*\n';
        msg += 'TKR College Road, Karmanghat, Hyderabad\n';
        msg += '📞 8688033072 | 9396522492, 8688033072\n';
        msg += '─────────────────────────\n\n';
        msg += 'Hello *' + patient + '*! 😊\n\n';
        msg += '*BILL SUMMARY*\n';
        if (bill.no)     msg += 'Receipt No: ' + bill.no + '\n';
        if (bill.date)   msg += 'Date: ' + (bill.dateStr || bill.date) + '\n';
        if (bill.doctor) msg += 'Doctor: ' + bill.doctor + '\n';
        msg += '\n';

        if (bill.trDesc || trAmt > 0) {
            msg += '*🦷 TREATMENT*\n';
            if (bill.trDesc) msg += bill.trDesc + '\n';
            msg += 'Amount: ₹' + trAmt.toFixed(2) + '\n\n';
        }

        if (items.length > 0) {
            msg += '*💊 PHARMACY / MEDICINES*\n';
            items.forEach(function(item){
                var name = item.medicineName || item.name || 'Medicine';
                msg += '• ' + name + ' ×' + item.qty + ' = *₹' + parseFloat(item.amount||0).toFixed(2) + '*\n';
            });
            msg += 'Medicine Total: ₹' + phAmt.toFixed(2) + '\n\n';
        }

        msg += '─────────────────────────\n';
        if (trAmt > 0) msg += '🦷 Treatment: ₹' + trAmt.toFixed(2) + '\n';
        if (phAmt > 0) msg += '💊 Pharmacy:  ₹' + phAmt.toFixed(2) + '\n';
        msg += '*💰 GRAND TOTAL: ₹' + grand.toFixed(2) + '*\n';
        msg += '─────────────────────────\n\n';
        msg += 'Thank you for visiting Sri Sai Speciality Dental Care! 🙏\n';
        msg += '_Beauty is a Power and Smile is a Sword_ 😁';

        openWhatsApp(phone, msg);
    }
    function getCbHistory() {
        try { return JSON.parse(localStorage.getItem('cb_history') || '[]'); } catch(e) { return []; }
    }
    function saveCbHistory(list) {
        try { localStorage.setItem('cb_history', JSON.stringify(list)); } catch(e) {}
    }

    function renderCbHistory() {
        var list = getCbHistory();
        var el   = document.getElementById('cb_history_list');
        if (!el) return;
        if (!list.length) {
            el.innerHTML = '<div class="cb-empty-row" style="padding:20px;">No bill summaries saved yet.</div>';
            return;
        }
        var html = '';
        for (var ri = list.length - 1; ri >= 0; ri--) {
            var r   = list[ri];
            var idx = ri;
            var medSummary = (r.cart && r.cart.length > 0)
                ? r.cart.map(function(c){ return c.medicineName + ' ×' + c.qty; }).join(', ')
                : 'No medicines';
            var trPreview = (r.trDesc||'').replace(/\n/g,' ').substring(0,50) + ((r.trDesc||'').length>50?'...':'');
            html += '<div class="cb-hist-item">' +
                '<div class="cb-hist-row">' +
                    '<div class="cb-hist-info">' +
                        '<div class="cb-hist-name">🧾 #' + esc(r.no||'—') + ' — ' + esc(r.patient||'—') + (r.doctor?' | '+esc(r.doctor):'') + '</div>' +
                        '<div class="cb-hist-meta">📅 ' + (r.dateStr||r.date||'—') + '</div>' +
                        (trPreview ? '<div class="cb-hist-meta">🦷 ' + trPreview + '</div>' : '') +
                        '<div class="cb-hist-meta">💊 ' + medSummary + '</div>' +
                        '<div class="cb-hist-total">Grand Total: ₹' + parseFloat(r.grand||0).toFixed(2) + '</div>' +
                    '</div>' +
                    '<div class="cb-hist-btns">' +
                        '<button data-onclick="loadCbRecord('+idx+')" style="background:#2c5aa0;">✏️ Load</button>' +
                        '<button data-onclick="reprintCbRecord('+idx+')" style="background:#27ae60;">🖨️ Print</button>' +
                        '<button data-onclick="deleteCbRecord('+idx+')" style="background:#e74c3c;">🗑️</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        }
        el.innerHTML = html;
    }

    function saveCbRecordToHistory(billId) {
        var trAmt = parseFloat(document.getElementById('cb_tr_amount').value)||0;
        var phAmt = _cbCart.reduce(function(s,c){return s+parseFloat(c.amount);},0);
        var record = {
            billId:  billId,
            no:      document.getElementById('cb_no').value      || '',
            date:    document.getElementById('cb_date').value    || '',
            dateStr: document.getElementById('cb_date').value
                        ? new Date(document.getElementById('cb_date').value).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'})
                        : '',
            patient: document.getElementById('cb_patient').value || '',
            doctor:  document.getElementById('cb_doctor').value  || '',
            phone:   document.getElementById('cb_phone').value   || '',
            trDesc:  document.getElementById('cb_tr_desc').value || '',
            trAmt:   trAmt,
            trWords: document.getElementById('cb_tr_words').value|| '',
            cart:    _cbCart.map(function(c){ return { medicineId:c.medicineId, medicineName:c.medicineName, qty:c.qty, price:c.price, amount:c.amount }; }),
            grand:   trAmt + phAmt,
            payMode: _cbMode,
            savedAt: new Date().toISOString()
        };
        var list = getCbHistory();
        list.push(record);
        saveCbHistory(list);
        renderCbHistory();
    }

    function loadCbRecord(idx) {
        var list = getCbHistory();
        var r = list[idx]; if (!r) return;
        document.getElementById('cb_no').value        = r.no      || '';
        document.getElementById('cb_date').value      = r.date    || '';
        document.getElementById('cb_patient').value   = r.patient || '';
        document.getElementById('cb_doctor').value    = r.doctor  || '';
        document.getElementById('cb_phone').value     = r.phone   || '';
        document.getElementById('cb_tr_desc').value   = r.trDesc  || '';
        document.getElementById('cb_tr_amount').value = r.trAmt   || '';
        document.getElementById('cb_tr_words').value  = r.trWords || '';
        _cbCart = (r.cart || []).map(function(c){ return { medicineId:c.medicineId, medicineName:c.medicineName, qty:c.qty, price:c.price, amount:c.amount }; });
        renderCbCart();
        recalcCombined();
        window.scrollTo(0, 0);
        showToast('✅ Bill loaded — edit and reprint as needed', 'success');
    }

    function reprintCbRecord(idx) {
        loadCbRecord(idx);
        setTimeout(function(){ printBillHtml(buildCombinedBillHTML()); }, 300);
    }

    function deleteCbRecord(idx) {
        if (!confirm('Delete this bill from history?')) return;
        var list = getCbHistory();
        var rec = list[idx];
        list.splice(idx, 1);
        saveCbHistory(list);
        renderCbHistory();
        showToast('🗑️ Bill deleted', 'success');
        if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
        var p = new URLSearchParams();
        p.append('action', 'deleteBill');
        p.append('billId', rec ? (rec.billId||rec.no||'') : '');
        p.append('savedAt', rec ? (rec.savedAt||'') : '');
        fetch(CONFIG.apiUrl + '?' + p.toString(), { method: 'GET', redirect: 'follow' })
            .then(function(r){ return r.json(); })
            .then(function(res){ if (res.success) showToast('☁️ Removed from Google Sheets', 'success'); else showToast('⚠️ Deleted locally — Sheets sync failed', 'warning'); })
            .catch(function(){ showToast('⚠️ Deleted locally only', 'warning'); });
    }

    function clearCbHistory() {
        if (!confirm('Clear ALL bill summary history? This cannot be undone.')) return;
        localStorage.removeItem('cb_history');
        renderCbHistory();
    }
    // ── End History ──────────────────────────────────────────────

    document.addEventListener('DOMContentLoaded', function(){
        var d=document.getElementById('cb_date'); if(d) d.valueAsDate=new Date();
        // Passive listeners — no scroll blocking
        ['cb_no','cb_patient','cb_phone','cb_tr_desc','cb_tr_words'].forEach(function(id){
            var el=document.getElementById(id);
            if(el) el.addEventListener('input', scheduleCbPreview, {passive:true});
        });
        var doc=document.getElementById('cb_doctor');
        if(doc) doc.addEventListener('change', scheduleCbPreview, {passive:true});
        var dat=document.getElementById('cb_date');
        if(dat) dat.addEventListener('change', scheduleCbPreview, {passive:true});
        // Defer non-critical renders
        setTimeout(renderCbHistory, 80);
        setTimeout(function(){
            var cbList=getCbHistory(); if(!cbList.length) return;
            cbList.forEach(function(r){
                var billId=r.billId||('CB-'+new Date(r.savedAt).getTime());
                if(!(window.bills||[]).find(function(b){return b.billId===billId;})&&window.bills){
                    window.bills.push({billId:billId,patientName:r.patient||'',doctor:r.doctor||'',
                        phone:r.phone||'',date:r.date||'',total:r.grand||0,trAmt:r.trAmt||0,
                        trDesc:r.trDesc||'',trWords:r.trWords||'',no:r.no||'',
                        cart:r.cart||[],items:r.cart||[],paymentMode:r.payMode||'—'});
                }
            });
            if(typeof updateBillsTable==='function') updateBillsTable();
            if(typeof updateDashboard==='function') updateDashboard();
        }, 1500);
    });
    // ══ END COMBINED BILL ══════════════════════════════════════
;

;/* ══ FILE: 05-patients-appointments.js ══════════════════════════════════════════════ */
/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    // ── Sheets sync helpers ───────────────────────────────────
    function sheetsPost(params, successMsg, failMsg) {
        if (!window.CONFIG || !CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
        var url = CONFIG.apiUrl + '?' + params.toString();
        fetch(url, { method: 'GET', redirect: 'follow' })
            .then(function(r){ return r.json(); })
            .then(function(res){ if(res.success) showToast(successMsg,'success'); else showToast(failMsg,'warning'); })
            .catch(function(){ showToast(failMsg,'warning'); });
    }

    // ════════════════════════════════════════
    // PATIENTS
    // ════════════════════════════════════════
    var _patients = JSON.parse(localStorage.getItem('pt_records') || '[]');
    function savePatients(){ localStorage.setItem('pt_records', JSON.stringify(_patients)); }

    function updatePatientStats(){
        var now = new Date(); var ym = now.getFullYear()+'-'+(now.getMonth()+1);
        var due = (window.V31 && V31.enabled()) ? V31.clinic.totalDue() : _patients.reduce(function(s,p){ return s+parseFloat(p.balance||0); }, 0);
        var month = _patients.filter(function(p){ return (p.lastVisit||'').startsWith(now.getFullYear()+'-'); }).length;
        var t=document.getElementById('pt_total'); if(t) t.textContent=_patients.length;
        var m=document.getElementById('pt_month'); if(m) m.textContent=month;
        var d=document.getElementById('pt_due');   if(d) d.textContent='₹'+due.toFixed(0);
    }

    function renderPatientsTable(list){
        list = list || _patients;
        var tbody = document.getElementById('patientsBody');
        var cards = document.getElementById('patientsCards');
        if(!tbody) return;
        if(!list.length){
            tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:#aaa;padding:20px;">No patients yet. Click + Add Patient.</td></tr>';
            if(cards) cards.innerHTML='<div style="text-align:center;color:#aaa;padding:30px;">No patients yet.</div>';
            return;
        }
        var statusColor = {Active:'green',Due:'orange','Follow-up':'blue'};
        var __fullList = list; list = __lazySlice('patients', list); // lazy: 50 at a time
        tbody.innerHTML = list.map(function(p,i){
            var sc = statusColor[p.status]||'grey';
            var idx = _patients.indexOf(p);
            return '<tr>' +
                '<td><strong>'+esc(p.name)+'</strong>'+(p.syncStatus==='pending'?' <span style="font-size:10px;color:#e67e22;">⏳</span>':'')+(p.age?' <span style="color:#aaa;font-size:12px;">('+esc(p.age)+(p.sex?' '+esc(p.sex):'')+')' +'</span>':'')+((p.allergies||p.alerts)?' <span title="'+esc((p.allergies?'Allergy: '+p.allergies+' ':'')+(p.alerts||''))+'" style="color:#c0392b;">⚠️</span>':'')+'</td>'+
                '<td style="white-space:nowrap;">'+esc(p.phone||'—')+'</td>'+
                '<td style="white-space:nowrap;">'+esc(p.lastVisit||'—')+'</td>'+
                '<td>'+esc(p.treatment||'—')+'</td>'+
                (function(){ var bal = window.V31 ? V31.clinic.balanceOf(p) : parseFloat(p.balance||0); return '<td style="font-weight:700;color:'+(bal>0?'#e74c3c':'#27ae60')+'">₹'+bal.toFixed(0)+'</td>'; })()+
                '<td><span class="patient-badge '+sc+'">'+esc(p.status||'Active')+'</span></td>'+
                '<td style="white-space:nowrap;">' + (window.V31 ? V31.clinic.rowButtons(p) : '') +
                    '<button data-onclick="sendWaToPatient('+idx+')" style="background:#25d366;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;margin-right:4px;touch-action:manipulation;">📲 WA</button>' +
                    '<button data-onclick="deletePatient('+idx+')" style="background:#e74c3c;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;touch-action:manipulation;">🗑️</button>' +
                '</td></tr>';
        }).join('') + __lazyMore('patients', __fullList.length, list.length, 7);
        if(cards){
            cards.innerHTML = list.map(function(p,i){
                var idx = _patients.indexOf(p);
                var sc = statusColor[p.status]||'grey';
                var balColor = parseFloat(p.balance||0)>0?'#e74c3c':'#27ae60';
                return '<div class="m-card" style="border-left-color:'+(parseFloat(p.balance||0)>0?'#e74c3c':'#27ae60')+'">' +
                    '<div class="m-card-row"><div class="m-card-title">'+esc(p.name)+'</div>' +
                    '<div style="font-weight:900;color:'+balColor+';">₹'+(parseFloat(p.balance||0).toFixed(0))+'</div></div>' +
                    '<div class="m-card-meta">📞 '+esc(p.phone||'—')+' &nbsp;|&nbsp; <span class="patient-badge '+sc+'">'+esc(p.status||'Active')+'</span></div>' +
                    '<div class="m-card-meta">🦷 '+esc(p.treatment||'—')+(p.alerts?' &nbsp;⚠️ '+esc(p.alerts):'')+'</div>' +
                    '<div class="m-card-actions">' +
                        '<button style="background:#25d366;" data-onclick="sendWaToPatient('+idx+')">📲 WhatsApp</button>' +
                        '<button style="background:#e74c3c;" data-onclick="deletePatient('+idx+')">🗑️ Delete</button>' +
                    '</div></div>';
            }).join('') + __lazyMore('patients', __fullList.length, list.length);
        }
        updatePatientStats();
    }

    function filterPatients(){
        var q=(document.getElementById('ptSearch').value||'').toLowerCase();
        renderPatientsTable(q ? _patients.filter(function(p){ return (p.name||'').toLowerCase().includes(q)||(String(p.phone||'')).includes(q); }) : _patients);
    }

    function openAddPatientModal(){
        if (window.V31 && V31.enabled()) { V31.clinic.openProfile(''); return; }
        ['pt_name','pt_phone','pt_age','pt_treatment','pt_alerts'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
        var s=document.getElementById('pt_sex'); if(s) s.value='';
        var d=document.getElementById('pt_doctor'); if(d) d.value='';
        document.getElementById('addPatientModal').classList.add('active');
    }

    function savePatient(){
        var name=(document.getElementById('pt_name').value||'').trim();
        var phone=(document.getElementById('pt_phone').value||'').trim();
        if(!name){ showToast('Enter patient name','warning'); return; }
        var today = new Date().toLocaleDateString('en-CA');
        var patient = {
            id: 'PT-'+Date.now(),
            name:name, phone:phone,
            age:document.getElementById('pt_age').value||'',
            sex:document.getElementById('pt_sex').value||'',
            doctor:document.getElementById('pt_doctor').value||'',
            treatment:document.getElementById('pt_treatment').value||'',
            balance:0,
            alerts:document.getElementById('pt_alerts').value||'',
            status:'Active',
            lastVisit:today, addedOn:today
        };
        _patients.push(patient);
        savePatients();
        closeModal('addPatientModal');
        renderPatientsTable();
        showToast('✅ Patient saved!','success');

        // Sync to Google Sheets
        var p = new URLSearchParams();
        p.append('action','savePatient');
        p.append('id', patient.id);
        p.append('name', patient.name);
        p.append('phone', patient.phone);
        p.append('age', patient.age);
        p.append('sex', patient.sex);
        p.append('doctor', patient.doctor);
        p.append('treatment', patient.treatment);
        p.append('balance', patient.balance);
        p.append('alerts', patient.alerts);
        p.append('status', patient.status);
        p.append('lastVisit', patient.lastVisit);
        p.append('addedOn', patient.addedOn);
        var syncUrl = CONFIG.apiUrl + '?' + p.toString(); fetch(syncUrl, {method:'GET',redirect:'follow'}).then(function(r){return r.json();}).then(function(res){if(res.success) showToast('Synced to Sheets!','success'); else showToast('Sync failed:'+(res.error||''),'warning');}).catch(function(e){showToast('Error:'+e,'warning');});
    }

    function deletePatient(idx){
        if(!confirm('Delete this patient record?')) return;
        var patient = _patients[idx];
        _patients.splice(idx,1);
        savePatients();
        renderPatientsTable();
        showToast('🗑️ Patient deleted','success');
        // Sync to Sheets
        if (patient && patient.id) {
            var p = new URLSearchParams();
            p.append('action','deletePatient');
            p.append('id', patient.id);
            fetch(CONFIG.apiUrl + '?' + p.toString(), {method:'GET', redirect:'follow'})
                .then(function(r){return r.json();})
                .then(function(res){ if(res.success) showToast('☁️ Patient removed from Sheets','success'); else showToast('⚠️ Deleted locally only','warning'); })
                .catch(function(){ showToast('⚠️ Deleted locally only','warning'); });
        }
    }

    function sendWaToPatient(idx){
        var p=_patients[idx]; if(!p) return;
        var phone=(String(p.phone||'')).replace(/[^\d]/g,'');
        if(!phone){ showToast('No phone number for this patient','warning'); return; }
        if(phone.length===10) phone='91'+phone;
        var msg='*🦷 Sri Sai Speciality Dental Care*\n\nHello *'+p.name+'*! 😊\n\n';
        if(parseFloat(p.balance||0)>0){
            msg+='💰 You have an outstanding balance of *₹'+parseFloat(p.balance).toFixed(0)+'*.\nKindly settle before your next visit.\n\n';
        }
        msg+='Thank you for choosing Sri Sai Speciality Dental Care! 🙏\n📞 8688033072 | 9396522492';
        openWhatsApp(phone, msg);
    }

    // ════════════════════════════════════════
    // APPOINTMENTS
    // ════════════════════════════════════════
    var _appointments = JSON.parse(localStorage.getItem('appointments') || '[]');
    // Migrate any appointments with raw/broken times to proper slot format
    (function(){
        function _fixTime(t){
            if(!t && t!==0) return t;
            var s = String(t).trim();
            if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(s)) return s.toUpperCase();
            var h, m;
            // Sheets decimal fraction e.g. 0.4375 = 10:30 AM
            var num = parseFloat(s);
            if (!isNaN(num) && num >= 0 && num < 1) {
                var totalMins = Math.round(num * 24 * 60);
                h = Math.floor(totalMins / 60); m = totalMins % 60;
            }
            if (h === undefined && s.includes('T')) {
                var d = new Date(s); if (!isNaN(d)) { h = d.getUTCHours(); m = d.getUTCMinutes(); }
            }
            if (h === undefined && /^\d{1,2}:\d{2}$/.test(s)) {
                var p = s.split(':'); h = parseInt(p[0]); m = parseInt(p[1]);
            }
            if (h === undefined) return t;
            var sM = m < 15 ? 0 : m < 45 ? 30 : 0;
            var sH = m >= 45 ? h + 1 : h;
            var ap = sH < 12 ? 'AM' : 'PM'; var h12 = sH % 12 || 12;
            return ('0' + h12).slice(-2) + ':' + (sM === 0 ? '00' : '30') + ' ' + ap;
        }
        var changed = false;
        _appointments.forEach(function(a){ var f = _fixTime(a.time); if(f !== a.time){ a.time = f; changed = true; } });
        if (changed) localStorage.setItem('appointments', JSON.stringify(_appointments));
    })();
    function saveAppts(){ localStorage.setItem('appointments', JSON.stringify(_appointments)); }

    function apptChangeDay(dir){
        var d=document.getElementById('appt_date');
        if(!d) return;
        var cur=d.value?new Date(d.value):new Date();
        cur.setDate(cur.getDate()+dir);
        d.value=cur.toLocaleDateString('en-CA');
        renderAppointments();
    }

    function renderAppointments(){
        var dateEl=document.getElementById('appt_date');
        var selDate=dateEl?dateEl.value:new Date().toLocaleDateString('en-CA');
        var label=document.getElementById('appt_dateLabel');
        if(label) label.textContent=new Date(selDate+'T12:00:00').toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
        var dayAppts=_appointments.filter(function(a){ return a.date===selDate; });
        var morning=['09:00 AM','09:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM','12:00 PM','12:30 PM','01:00 PM','01:30 PM'];
        var afternoon=['02:00 PM','02:30 PM','03:00 PM','03:30 PM','04:00 PM','04:30 PM','05:00 PM','05:30 PM','06:00 PM','06:30 PM','07:00 PM','07:30 PM','08:00 PM'];
        var allSlots = morning.concat(afternoon);
        var confirmed=0,cancelled=0;
        function renderSlots(times,containerId){
            var html='';
            times.forEach(function(time){
                var appt=dayAppts.find(function(a){ return a.time===time; });
                if(appt){
                    var cls=appt.status==='Cancelled'?'cancelled':'booked';
                    var bc=appt.status==='Cancelled'?'red':appt.reason?'green':'blue';
                    if(appt.status!=='Cancelled') confirmed++;
                    else cancelled++;
                    html+='<div class="appt-slot '+cls+'" data-onclick="toggleApptStatus(\''+esc(appt.id)+'\')">'+
                        '<span class="appt-time">'+esc(time)+'</span>'+
                        '<span class="appt-name">'+esc(appt.patient)+'</span>'+
                        (appt.reason?'<span class="appt-badge '+bc+'">'+esc(appt.reason)+'</span>':'')+
                        '<button data-onclick="event.stopPropagation();deleteAppt(\''+esc(appt.id)+'\')" style="background:none;border:none;color:#aaa;font-size:16px;cursor:pointer;padding:0 4px;touch-action:manipulation;">×</button>'+
                        '</div>';
                } else {
                    html+='<div class="appt-slot free" data-onclick="quickBookSlot(\''+esc(selDate)+'\',\''+esc(time)+'\')">'+
                        '<span class="appt-time">'+esc(time)+'</span>'+
                        '<span class="appt-name" style="color:#aaa;">Available — tap to book</span>'+
                        '</div>';
                }
            });
            var el=document.getElementById(containerId); if(el) el.innerHTML=html;
        }
        renderSlots(morning,'appt_morning');
        renderSlots(afternoon,'appt_afternoon');
        // Show appointments whose time doesn't match any standard slot (custom / imported times)
        var unmatched = dayAppts.filter(function(a){ return allSlots.indexOf(a.time) === -1; });
        if (unmatched.length) {
            var extraHtml = '<div style="margin-top:10px;padding:10px 0 4px;font-size:12px;font-weight:700;color:#e67e22;">⚠️ Custom-time appointments (not in standard slots):</div>';
            unmatched.forEach(function(appt){
                var cls=appt.status==='Cancelled'?'cancelled':'booked';
                var bc=appt.status==='Cancelled'?'red':appt.reason?'green':'blue';
                if(appt.status!=='Cancelled') confirmed++;
                else cancelled++;
                extraHtml+='<div class="appt-slot '+cls+'" data-onclick="toggleApptStatus(\''+esc(appt.id)+'\')">'+
                    '<span class="appt-time">'+esc(appt.time)+'</span>'+
                    '<span class="appt-name">'+esc(appt.patient)+'</span>'+
                    (appt.reason?'<span class="appt-badge '+bc+'">'+esc(appt.reason)+'</span>':'')+
                    '<button data-onclick="event.stopPropagation();deleteAppt(\''+esc(appt.id)+'\')" style="background:none;border:none;color:#aaa;font-size:16px;cursor:pointer;padding:0 4px;touch-action:manipulation;">×</button>'+
                    '</div>';
            });
            var mEl = document.getElementById('appt_morning');
            if (mEl) mEl.innerHTML += extraHtml;
        }
        var avail=allSlots.length-dayAppts.filter(function(a){return a.status!=='Cancelled';}).length;
        var ec=document.getElementById('appt_confirmed'); if(ec) ec.textContent=confirmed;
        var ea=document.getElementById('appt_available'); if(ea) ea.textContent=avail;
        var ecan=document.getElementById('appt_cancelled'); if(ecan) ecan.textContent=cancelled;
        renderWaTodayList();
    }

    function openAddApptModal(){
        ['appt_patient','appt_phone','appt_reason'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
        var d=document.getElementById('appt_bookDate');
        var cd=document.getElementById('appt_date');
        if(d) d.value=cd?cd.value:new Date().toLocaleDateString('en-CA');
        var t=document.getElementById('appt_time'); if(t) t.value='';
        var dr=document.getElementById('appt_doctor'); if(dr) dr.value='';
        document.getElementById('addApptModal').classList.add('active');
    }

    function quickBookSlot(date,time){
        openAddApptModal();
        var d=document.getElementById('appt_bookDate'); if(d) d.value=date;
        var t=document.getElementById('appt_time'); if(t) t.value=time;
    }

    function saveAppointment(){
        var patient=(document.getElementById('appt_patient').value||'').trim();
        var time=document.getElementById('appt_time').value;
        var date=document.getElementById('appt_bookDate').value;
        if(!patient||!time||!date){ showToast('Fill patient name, date and time','warning'); return; }
        var apptDoctor=document.getElementById('appt_doctor').value||'';
        var existing=_appointments.find(function(a){ return a.date===date&&a.time===time&&a.status!=='Cancelled'&&(a.doctor||'')===apptDoctor; });
        if(existing){ showToast('That doctor already has an appointment in this slot','warning'); return; }
        var appt = {
            id:'A'+Date.now(),
            patient:patient,
            phone:document.getElementById('appt_phone').value||'',
            date:date, time:time,
            reason:document.getElementById('appt_reason').value||'',
            doctor:document.getElementById('appt_doctor').value||'',
            status:'Confirmed',
            bookedAt:new Date().toISOString()
        };
        _appointments.push(appt);
        saveAppts();
        closeModal('addApptModal');
        renderAppointments();
        showToast('✅ Appointment booked!','success');

        // Show WA popup if patient has a phone number
        if (appt.phone && String(appt.phone).replace(/[^\d]/g,'').length >= 10) {
            openWaBookingPopup(appt);
        }

        // Sync to Google Sheets
        var p = new URLSearchParams();
        p.append('action','saveAppointment');
        p.append('id', appt.id);
        p.append('patient', appt.patient);
        p.append('phone', appt.phone);
        p.append('date', appt.date);
        p.append('time', appt.time);
        p.append('reason', appt.reason);
        p.append('doctor', appt.doctor);
        p.append('status', appt.status);
        p.append('bookedAt', appt.bookedAt);
        fetch(CONFIG.apiUrl + '?' + p.toString(), {method:'GET', redirect:'follow'}).then(function(r){return r.json();}).then(function(res){ if(res.success) showToast('☁️ Appointment synced!','success'); else showToast('⚠️ Appt saved locally only','warning'); }).catch(function(){ showToast('⚠️ Sync error','warning'); });
    }

    function toggleApptStatus(id){
        var a=_appointments.find(function(a){ return a.id===id; }); if(!a) return;
        a.status=a.status==='Cancelled'?'Confirmed':'Cancelled';
        saveAppts(); renderAppointments();
        showToast(a.status==='Confirmed'?'✅ Restored':'❌ Cancelled','success');
        // Sync status to Sheets
        var p = new URLSearchParams();
        p.append('action','updateAppointmentStatus');
        p.append('id', a.id);
        p.append('status', a.status);
        fetch(CONFIG.apiUrl + '?' + p.toString(), {method:'GET', redirect:'follow'}).then(function(r){return r.json();}).then(function(res){ if(res.success) showToast('☁️ Status updated in Sheets','success'); else showToast('⚠️ Updated locally only','warning'); }).catch(function(){ showToast('⚠️ Sync error','warning'); });
    }

    function deleteAppt(id){
        if(!confirm('Delete this appointment?')) return;
        _appointments=_appointments.filter(function(a){ return a.id!==id; });
        saveAppts(); renderAppointments();
        showToast('🗑️ Appointment deleted','success');
        // Sync to Sheets
        var p = new URLSearchParams();
        p.append('action','deleteAppointment');
        p.append('id', id);
        fetch(CONFIG.apiUrl + '?' + p.toString(), {method:'GET', redirect:'follow'}).then(function(r){return r.json();}).then(function(res){ if(res.success) showToast('☁️ Removed from Sheets','success'); else showToast('⚠️ Deleted locally only','warning'); }).catch(function(){ showToast('⚠️ Sync error','warning'); });
    }

    // ════════════════════════════════════════
    // WHATSAPP REMINDERS
    // ════════════════════════════════════════
    var _waSentCount = parseInt(localStorage.getItem('wa_sent_today')||'0');
    var _waSentDate  = localStorage.getItem('wa_sent_date')||'';

    function updateWaStats(){
        var today=new Date().toLocaleDateString('en-CA');
        if(_waSentDate!==today){ _waSentCount=0; _waSentDate=today; localStorage.setItem('wa_sent_date',today); localStorage.setItem('wa_sent_today','0'); }
        var todayAppts=_appointments.filter(function(a){ return a.date===today&&a.status!=='Cancelled'; });
        var duePats=_patients.filter(function(p){ return parseFloat(p.balance||0)>0; });
        var ws=document.getElementById('wa_sent'); if(ws) ws.textContent=_waSentCount;
        var wa=document.getElementById('wa_appts'); if(wa) wa.textContent=todayAppts.length;
        var wd=document.getElementById('wa_due');   if(wd) wd.textContent=duePats.length;
    }

    function updateWaPreview(){
        var tmpl  = document.getElementById('wa_template').value;
        var name  = (document.getElementById('wa_patName').value||'').trim() || '{name}';
        var extra = document.getElementById('wa_extra_fields');
        var prev  = document.getElementById('wa_preview_text');

        // Build extra fields HTML
        var extraHtml = '';
        if (tmpl === 'reminder24' || tmpl === 'reminder1h') {
            extraHtml =
                '<div style="background:#fff8e1;border-radius:8px;padding:12px;margin-bottom:4px;">' +
                '<div style="font-size:12px;font-weight:700;color:#e67e22;margin-bottom:8px;">Fill appointment details:</div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;" class="wa-quick-grid">' +
                '<div><label style="font-size:12px;">Appointment Time *</label>' +
                '<input type="text" id="wa_appt_time" placeholder="e.g. 10:30 AM" style="font-size:16px;" data-oninput="refreshWaMsg()"></div>' +
                '<div><label style="font-size:12px;">Treatment / Reason</label>' +
                '<input type="text" id="wa_appt_reason" placeholder="e.g. Scaling" data-oninput="refreshWaMsg()"></div>' +
                '</div>' +
                '<div><label style="font-size:12px;">Doctor</label>' +
                '<select id="wa_appt_doctor" data-onchange="refreshWaMsg()">' +
                '<option value="Dr. T Sai Vakula">Dr. T Sai Vakula</option>' +
                '<option value="Dr. T Venkat Rao">Dr. T Venkat Rao</option>' +
                '</select></div></div>';
        } else if (tmpl === 'reschedule') {
            extraHtml =
                '<div style="background:#f5eef8;border-radius:8px;padding:12px;margin-bottom:4px;">' +
                '<div style="font-size:12px;font-weight:700;color:#9b59b6;margin-bottom:8px;">Fill reschedule details:</div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;" class="wa-quick-grid">' +
                '<div><label style="font-size:12px;">Doctor</label>' +
                '<select id="wa_rsch_doctor" data-onchange="refreshWaMsg()">' +
                '<option value="Dr. T Sai Vakula">Dr. T Sai Vakula</option>' +
                '<option value="Dr. T Venkat Rao">Dr. T Venkat Rao</option>' +
                '</select></div>' +
                '<div><label style="font-size:12px;">Original Time *</label>' +
                '<input type="text" id="wa_rsch_time" placeholder="e.g. 11:00 AM" style="font-size:16px;" data-oninput="refreshWaMsg()"></div>' +
                '</div>' +
                '<div><label style="font-size:12px;">Suggested New Date (optional)</label>' +
                '<input type="text" id="wa_rsch_newdate" placeholder="e.g. Tomorrow 27 May at 10 AM" data-oninput="refreshWaMsg()"></div></div>';
        } else if (tmpl === 'confirm') {
            extraHtml =
                '<div style="background:#e8f8ee;border-radius:8px;padding:12px;margin-bottom:4px;">' +
                '<div style="font-size:12px;font-weight:700;color:#27ae60;margin-bottom:8px;">Fill booking details:</div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;" class="wa-quick-grid">' +
                '<div><label style="font-size:12px;">Date</label><input type="date" id="wa_conf_date" data-oninput="refreshWaMsg()"></div>' +
                '<div><label style="font-size:12px;">Time *</label><input type="text" id="wa_conf_time" placeholder="e.g. 10:00 AM" style="font-size:16px;" data-oninput="refreshWaMsg()"></div>' +
                '<div><label style="font-size:12px;">Doctor</label>' +
                '<select id="wa_conf_doctor" data-onchange="refreshWaMsg()">' +
                '<option value="Dr. T Sai Vakula">Dr. T Sai Vakula</option>' +
                '<option value="Dr. T Venkat Rao">Dr. T Venkat Rao</option>' +
                '</select></div></div></div>';
        } else if (tmpl === 'payment') {
            extraHtml =
                '<div><label>Balance Amount (Rs.)</label>' +
                '<input type="number" id="wa_pay_amount" placeholder="e.g. 500" inputmode="decimal" data-oninput="refreshWaMsg()"></div>';
        } else if (tmpl === 'followup') {
            extraHtml =
                '<div><label>Treatment Done</label>' +
                '<input type="text" id="wa_fu_treatment" placeholder="e.g. Root Canal" data-oninput="refreshWaMsg()"></div>';
        } else if (tmpl === 'patReschedule') {
            extraHtml =
                '<div style="background:#e8f8f5;border-radius:8px;padding:12px;margin-bottom:4px;">' +
                '<div style="font-size:12px;font-weight:700;color:#16a085;margin-bottom:8px;">📅 New appointment details (after patient request):</div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;" class="wa-quick-grid">' +
                '<div><label style="font-size:12px;">New Date</label><input type="date" id="wa_prsch_date" data-oninput="refreshWaMsg()"></div>' +
                '<div><label style="font-size:12px;">New Time *</label><input type="text" id="wa_prsch_time" placeholder="e.g. 11:00 AM" style="font-size:16px;" data-oninput="refreshWaMsg()"></div>' +
                '<div><label style="font-size:12px;">Doctor</label>' +
                '<select id="wa_prsch_doctor" data-onchange="refreshWaMsg()">' +
                '<option value="Dr. T Sai Vakula">Dr. T Sai Vakula</option>' +
                '<option value="Dr. T Venkat Rao">Dr. T Venkat Rao</option>' +
                '</select></div></div></div>';
        } else if (tmpl === 'custom') {
            extraHtml =
                '<div><label>Your Message</label>' +
                '<textarea id="wa_custom_msg" rows="4" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;font-family:inherit;" placeholder="Type your message here..." data-oninput="refreshWaMsg()"></textarea></div>';
        }
        if (extra) extra.innerHTML = extraHtml;
        // Immediately refresh message after DOM update
        setTimeout(refreshWaMsg, 10);
    }

    function refreshWaMsg() {
        var tmpl   = document.getElementById('wa_template').value;
        var name   = (document.getElementById('wa_patName').value||'').trim() || '{name}';
        var prev   = document.getElementById('wa_preview_text');
        var g = function(id){ var e=document.getElementById(id); return e?e.value:''; };

        var time    = g('wa_appt_time')    || '________';
        var reason  = g('wa_appt_reason');
        var doctor  = g('wa_appt_doctor')  || 'Dr. T Sai Vakula';
        var rschDoc = g('wa_rsch_doctor')  || 'Dr. T Sai Vakula';
        var rschTim = g('wa_rsch_time')    || '________';
        var rschNew = g('wa_rsch_newdate');
        var confDate= g('wa_conf_date');
        var confTime= g('wa_conf_time')    || '________';
        var confDoc = g('wa_conf_doctor')  || 'Dr. T Sai Vakula';
        var payAmt  = g('wa_pay_amount')   || '________';
        var fuTreat = g('wa_fu_treatment') || '________';
        var prschDate = g('wa_prsch_date');
        var prschTime = g('wa_prsch_time') || '________';
        var prschDoc  = g('wa_prsch_doctor') || 'Dr. T Sai Vakula';
        var confDateStr = confDate
            ? new Date(confDate+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'})
            : '________';
        var prschDateStr = prschDate
            ? new Date(prschDate+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'})
            : '________';

        var C  = '🦷 *Sri Sai Speciality Dental Care*';
        var PH = '📞 *8688033072 | 9396522492*';

        var msgs = {
            reminder24:
                C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '⏰ *Appointment Reminder – Tomorrow*\n\n' +
                '🕐 *Time:* ' + time + '\n' +
                (reason ? '🦷 *Treatment:* ' + reason + '\n' : '') +
                '👨‍⚕️ *Doctor:* ' + doctor + '\n\n' +
                'Please arrive *5 minutes early*.\n' +
                'Reply *YES* to confirm or call us to reschedule.\n\n' +
                PH + '\n' +
                '_Sri Sai Speciality Dental Care_ 🙏',

            reminder1h:
                C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '🔔 *Your appointment is in 1 HOUR!*\n\n' +
                '🕐 *Time:* ' + time + '\n' +
                (reason ? '🦷 *Treatment:* ' + reason + '\n' : '') +
                '👨‍⚕️ *Doctor:* ' + doctor + '\n\n' +
                'Please start heading now. 🚗\n\n' +
                PH + '\n' +
                '_See you soon!_ 😊',

            reschedule:
                C + '\n\n' +
                'Hello *' + name + '*! 🙏\n\n' +
                '⚠️ *Important Notice*\n\n' +
                'We regret that *' + rschDoc + '* is *unavailable today*\n' +
                'for your *' + rschTim + '* appointment.\n\n' +
                'We sincerely apologize for the inconvenience.\n\n' +
                (rschNew ? '📅 *Suggested:* ' + rschNew + '\n\n' : '') +
                'Please call us to reschedule:\n' +
                PH + '\n\n' +
                'Thank you for your understanding. 🙏\n' +
                '_Sri Sai Speciality Dental Care_',

            confirm:
                C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '✅ *Appointment Confirmed!*\n\n' +
                '📅 *Date:* ' + confDateStr + '\n' +
                '🕐 *Time:* ' + confTime + '\n' +
                '👨‍⚕️ *Doctor:* ' + confDoc + '\n\n' +
                'Please arrive 5 minutes early.\n' +
                'We look forward to seeing you!\n\n' +
                PH + '\n' +
                '_Sri Sai Speciality Dental Care_ 🦷',

            payment:
                C + '\n\n' +
                'Hello *' + name + '*! 🙏\n\n' +
                '💰 *Payment Reminder*\n\n' +
                'Outstanding balance: *₹' + payAmt + '*\n\n' +
                'Kindly settle before your next visit.\n\n' +
                PH + '\n' +
                'Thank you! 😊',

            followup:
                C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '💙 *Follow-up Check*\n\n' +
                'Hope you are recovering well\n' +
                'after your *' + fuTreat + '*.\n\n' +
                'Call us for any concerns.\n\n' +
                PH + '\n' +
                '_We care about your smile!_ 🦷',

            patReschedule:
                C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '📅 *Reschedule Confirmed!*\n\n' +
                'We have received your reschedule request.\n' +
                'Your new appointment is confirmed:\n\n' +
                '📅 *Date:* ' + prschDateStr + '\n' +
                '🕐 *Time:* ' + prschTime + '\n' +
                '👨‍⚕️ *Doctor:* ' + prschDoc + '\n\n' +
                'Please arrive 5 minutes early.\n' +
                'We look forward to seeing you! 😊\n\n' +
                PH + '\n' +
                '_Sri Sai Speciality Dental Care_ 🦷',

            custom: g('wa_custom_msg')
        };

        // ── Use custom template if saved, else use default ──────────────
        var customTmpl = (typeof _getCustomTmpl === 'function') ? _getCustomTmpl(tmpl) : null;
        if (customTmpl && tmpl !== 'custom') {
            // Replace placeholders with actual values
            var msg = customTmpl
                .replace(/\{name\}/g,   name)
                .replace(/\{time\}/g,   confTime !== '________' ? confTime : (time !== '________' ? time : prschTime))
                .replace(/\{date\}/g,   confDateStr !== '________' ? confDateStr : prschDateStr)
                .replace(/\{doctor\}/g, confDoc || doctor || prschDoc)
                .replace(/\{reason\}/g, reason || '');
            if (prev) prev.value = msg;
        } else {
            if (prev) prev.value = msgs[tmpl] || '';
        }
    }

    function sendWaReminder(){
        var phone=(document.getElementById('wa_patPhone').value||'').replace(/[^\d]/g,'');
        if(!phone){ showToast('Enter phone number','warning'); return; }
        if(phone.length===10) phone='91'+phone;
        var tmpl=document.getElementById('wa_template').value;
        var msg=tmpl==='custom'
            ? (document.getElementById('wa_custom_msg')?document.getElementById('wa_custom_msg').value:'')
            : document.getElementById('wa_preview_text').value;
        if(!msg.trim()){ showToast('Message is empty','warning'); return; }
        _waSentCount++;
        localStorage.setItem('wa_sent_today',_waSentCount);
        localStorage.setItem('wa_sent_date',new Date().toLocaleDateString('en-CA'));
        updateWaStats();
        openWhatsApp(phone, msg);
    }

    function renderWaTodayList(){
        var el=document.getElementById('wa_today_list'); if(!el) return;
        var today=new Date().toLocaleDateString('en-CA');
        var todayAppts=_appointments.filter(function(a){ return a.date===today&&a.status!=='Cancelled'; });
        if(!todayAppts.length){
            el.innerHTML='<div style="text-align:center;color:#aaa;padding:20px;">No appointments today.</div>';
            return;
        }
        el.innerHTML=todayAppts.map(function(a){
            var hasPhone = !!(String(a.phone||'')).replace(/[^\d]/g,'');
            var btnStyle = 'padding:7px 10px;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;touch-action:manipulation;color:#fff;white-space:nowrap;';
            return '<div style="border:1px solid #f0f0f0;border-radius:10px;padding:12px;margin-bottom:8px;background:#fafafa;">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">' +
                    '<div>' +
                        '<div style="font-weight:700;font-size:14px;color:#1e3f5a;">'+esc(a.patient)+'</div>' +
                        '<div style="font-size:12px;color:#777;margin-top:2px;">'+esc(a.time)+(a.reason?' — '+esc(a.reason):'')+(a.doctor?' | '+esc(a.doctor):'')+'</div>' +
                        (!hasPhone?'<div style="font-size:11px;color:#e74c3c;margin-top:2px;">⚠️ No phone saved</div>':'') +
                    '</div>' +
                    '<div style="display:flex;gap:5px;flex-wrap:wrap;">' +
                        '<button style="'+btnStyle+'background:#e67e22;" data-onclick="sendApptWaTemplate(\''+esc(a.id)+'\',\'24h\')">⏰ 24h</button>' +
                        '<button style="'+btnStyle+'background:#e74c3c;" data-onclick="sendApptWaTemplate(\''+esc(a.id)+'\',\'1h\')">🔔 1h</button>' +
                        '<button style="'+btnStyle+'background:#9b59b6;" data-onclick="sendApptWaTemplate(\''+esc(a.id)+'\',\'reschedule\')">🔄 Reschedule</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    function buildApptMsg(a, type) {
        var name   = a.patient || 'Patient';
        var time   = a.time   || '—';
        var reason = a.reason || '';
        var doctor = a.doctor || 'our doctor';
        var dateStr = a.date
            ? new Date(a.date+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'})
            : '—';

        // Map type codes to template keys
        var tmplKey = type === '24h' ? 'reminder24' : type === '1h' ? 'reminder1h' : type;

        // ── Check custom template first ──────────────────────────────────
        var customTmpl = (typeof _getCustomTmpl === 'function') ? _getCustomTmpl(tmplKey) : null;
        if (customTmpl) {
            return customTmpl
                .replace(/\{name\}/g,   name)
                .replace(/\{time\}/g,   time)
                .replace(/\{date\}/g,   dateStr)
                .replace(/\{doctor\}/g, doctor)
                .replace(/\{reason\}/g, reason);
        }

        var C  = '🦷 *Sri Sai Speciality Dental Care*';
        var PH = '📞 *8688033072 | 9396522492*';

        if (type === '24h') {
            return C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '⏰ *Appointment Reminder – Tomorrow*\n\n' +
                '🕐 *Time:* ' + time + '\n' +
                (reason ? '🦷 *Treatment:* ' + reason + '\n' : '') +
                '👨‍⚕️ *Doctor:* ' + doctor + '\n\n' +
                'Please arrive *5 minutes early*.\n' +
                'Reply *YES* to confirm or call us to reschedule.\n\n' +
                PH + '\n' +
                '_Sri Sai Speciality Dental Care_ 🙏';
        }
        if (type === '1h') {
            return C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '🔔 *Your appointment is in 1 HOUR!*\n\n' +
                '🕐 *Time:* ' + time + '\n' +
                (reason ? '🦷 *Treatment:* ' + reason + '\n' : '') +
                '👨‍⚕️ *Doctor:* ' + doctor + '\n\n' +
                'Please start heading now. 🚗\n\n' +
                PH + '\n' +
                '_See you soon!_ 😊';
        }
        if (type === 'reschedule') {
            return C + '\n\n' +
                'Hello *' + name + '*! 🙏\n\n' +
                '⚠️ *Important Notice*\n\n' +
                'We regret that *' + doctor + '* is *unavailable today*\n' +
                'for your *' + time + '* appointment.\n\n' +
                'We sincerely apologize for the inconvenience.\n\n' +
                'Please call us to reschedule:\n' +
                PH + '\n\n' +
                'Thank you for your understanding. 🙏\n' +
                '_Sri Sai Speciality Dental Care_';
        }
        return '';
    }

    function sendApptWaTemplate(id, type) {
        var a = (_appointments||[]).find(function(x){ return x.id===id; }); if(!a) return;
        var phone = (String(a.phone||'')).replace(/[^\d]/g,'');
        if (!phone) { showToast('No phone number for '+a.patient+'. Add in Patients page.','warning'); return; }
        var msg = buildApptMsg(a, type);
        _waSentCount++;
        localStorage.setItem('wa_sent_today',_waSentCount);
        localStorage.setItem('wa_sent_date',new Date().toLocaleDateString('en-CA'));
        updateWaStats();
        openWhatsApp(phone, msg);
        showToast('✅ Message copied! Opening WhatsApp for '+a.patient,'success');
    }

    function sendAllReminders(type) {
        var today = new Date().toLocaleDateString('en-CA');
        var appts = (_appointments||[]).filter(function(a){ return a.date===today&&a.status!=='Cancelled'&&a.phone; });
        if (!appts.length) { showToast('No appointments with phone numbers today','warning'); return; }
        var label = type==='24h'?'24-hour':'1-hour';
        if (!confirm('Send '+label+' reminders to all '+appts.length+' patients today?')) return;
        var delay = 0;
        appts.forEach(function(a){
            setTimeout(function(){
                var phone = (String(a.phone||'')).replace(/[^\d]/g,'');
                if (phone.length===10) phone='91'+phone;
                var msg = buildApptMsg(a, type);
                openWhatsApp(phone, msg);
                _waSentCount++;
            }, delay);
            delay += 1500; // 1.5s gap between each to avoid spam detection
        });
        localStorage.setItem('wa_sent_today',_waSentCount+appts.length);
        localStorage.setItem('wa_sent_date',today);
        setTimeout(updateWaStats, 500);
        showToast('✅ Sending reminders to '+appts.length+' patients...','success');
    }

    // ═══════════════════════════════════════════════════
    // WA BOOKING POPUP — auto-open after appointment saved
    // ═══════════════════════════════════════════════════
    var _wabpAppt = null;

    function openWaBookingPopup(appt) {
        _wabpAppt = appt;
        var dateStr = appt.date
            ? new Date(appt.date+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'})
            : '';
        var el = document.getElementById('wabp_patinfo');
        if (el) el.textContent = (appt.patient||'') + (dateStr?' | '+dateStr:'') + (appt.time?' at '+appt.time:'') + (appt.phone?' | '+appt.phone:'');
        document.getElementById('wabp_template').value = 'confirm';
        updateWabpPreview();
        document.getElementById('waBookingPopup').classList.add('active');
    }

    function buildWabpMsg(tmpl, appt) {
        var name   = appt.patient || 'Patient';
        var time   = appt.time   || '—';
        var reason = appt.reason || '';
        var doctor = appt.doctor || 'our doctor';
        var dateStr = appt.date
            ? new Date(appt.date+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'})
            : '—';

        // ── Check custom template first ──────────────────────────────────
        var customTmpl = (typeof _getCustomTmpl === 'function') ? _getCustomTmpl(tmpl) : null;
        if (customTmpl) {
            return customTmpl
                .replace(/\{name\}/g,   name)
                .replace(/\{time\}/g,   time)
                .replace(/\{date\}/g,   dateStr)
                .replace(/\{doctor\}/g, doctor)
                .replace(/\{reason\}/g, reason);
        }

        var C  = '🦷 *Sri Sai Speciality Dental Care*';
        var PH = '📞 *8688033072 | 9396522492*';

        if (tmpl === 'confirm') {
            return C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '✅ *Appointment Confirmed!*\n\n' +
                '📅 *Date:* ' + dateStr + '\n' +
                '🕐 *Time:* ' + time + '\n' +
                (reason ? '🦷 *Treatment:* ' + reason + '\n' : '') +
                '👨‍⚕️ *Doctor:* ' + doctor + '\n\n' +
                'Please arrive 5 minutes early.\n' +
                'We look forward to seeing you! 😊\n\n' +
                PH + '\n' +
                '_Sri Sai Speciality Dental Care_ 🦷';
        }
        if (tmpl === 'reminder24') {
            return C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '⏰ *Appointment Reminder – Tomorrow*\n\n' +
                '🕐 *Time:* ' + time + '\n' +
                (reason ? '🦷 *Treatment:* ' + reason + '\n' : '') +
                '👨‍⚕️ *Doctor:* ' + doctor + '\n\n' +
                'Please arrive *5 minutes early*.\n' +
                'Reply *YES* to confirm or call us to reschedule.\n\n' +
                PH + '\n' +
                '_Sri Sai Speciality Dental Care_ 🙏';
        }
        if (tmpl === 'reminder1h') {
            return C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '🔔 *Your appointment is in 1 HOUR!*\n\n' +
                '🕐 *Time:* ' + time + '\n' +
                (reason ? '🦷 *Treatment:* ' + reason + '\n' : '') +
                '👨‍⚕️ *Doctor:* ' + doctor + '\n\n' +
                'Please start heading now. 🚗\n\n' +
                PH + '\n' +
                '_See you soon!_ 😊';
        }
        if (tmpl === 'followup') {
            return C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '💙 *Follow-up Check*\n\n' +
                'Hope you are recovering well' + (reason ? ' after your *' + reason + '*' : '') + '.\n\n' +
                'Call us for any concerns.\n\n' +
                PH + '\n' +
                '_We care about your smile!_ 🦷';
        }
        if (tmpl === 'reschedule') {
            return C + '\n\n' +
                'Hello *' + name + '*! \uD83D\uDE4F\n\n' +
                '\u26A0\uFE0F *Important Notice*\n\n' +
                'We regret that *' + doctor + '* is *unavailable today*\n' +
                'for your *' + time + '* appointment.\n\n' +
                'We sincerely apologize for the inconvenience.\n\n' +
                'Please call us to reschedule at your convenience:\n' +
                PH + '\n\n' +
                'Thank you for your understanding. \uD83D\uDE4F\n' +
                '_Sri Sai Speciality Dental Care_';
        }
        if (tmpl === 'patReschedule') {
            return C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '📅 *Reschedule Confirmed!*\n\n' +
                'We have received your reschedule request.\n' +
                'Your new appointment is confirmed:\n\n' +
                '📅 *Date:* ' + dateStr + '\n' +
                '🕐 *Time:* ' + time + '\n' +
                '👨‍⚕️ *Doctor:* ' + doctor + '\n\n' +
                'Please arrive 5 minutes early.\n' +
                'We look forward to seeing you! 😊\n\n' +
                PH + '\n' +
                '_Sri Sai Speciality Dental Care_ 🦷';
        }
        if (tmpl === 'payment') {
            return C + '\n\n' +
                'Hello *' + name + '*! 🙏\n\n' +
                '💰 *Payment Reminder*\n\n' +
                'You have an outstanding balance at Sri Sai Speciality Dental Care.\n' +
                'Kindly settle before your next visit.\n\n' +
                PH + '\n' +
                'Thank you! 😊';
        }
        return '';
    }

    function updateWabpPreview() {
        var tmpl = document.getElementById('wabp_template').value;
        var ta   = document.getElementById('wabp_msg');
        if (!ta || !_wabpAppt) return;
        if (tmpl === 'custom') {
            ta.value = '';
            ta.placeholder = 'Type your own message here...';
        } else {
            ta.value = buildWabpMsg(tmpl, _wabpAppt);
        }
    }

    function sendWabpMsg() {
        if (!_wabpAppt) return;
        var phone = (String(_wabpAppt.phone||'')).replace(/[^\d]/g,'');
        if (!phone) { showToast('No phone number saved for this patient','warning'); return; }
        var msg = (document.getElementById('wabp_msg').value||'').trim();
        if (!msg) { showToast('Message is empty — type something first','warning'); return; }
        closeModal('waBookingPopup');
        _waSentCount++;
        localStorage.setItem('wa_sent_today',_waSentCount);
        localStorage.setItem('wa_sent_date',new Date().toLocaleDateString('en-CA'));
        updateWaStats();
        openWhatsApp(phone, msg);
    }

    // ═══════════════════════════════════════════════════
    // WA ALL APPOINTMENTS LIST
    // ═══════════════════════════════════════════════════
    function renderWaAllAppts() {
        var el = document.getElementById('wa_all_appts_list'); if (!el) return;
        var search  = (document.getElementById('wa_appt_search')||{value:''}).value.toLowerCase().trim();
        var filter  = (document.getElementById('wa_appt_filter')||{value:'all'}).value;
        var today   = new Date().toLocaleDateString('en-CA');

        var list = (_appointments||[]).slice().sort(function(a,b){ return b.date>a.date?1:b.date<a.date?-1:0; });

        list = list.filter(function(a){
            if (filter==='today')    return a.date===today;
            if (filter==='upcoming') return a.date>today;
            if (filter==='past')     return a.date<today;
            return true;
        });

        if (search) {
            list = list.filter(function(a){
                return (a.patient||'').toLowerCase().includes(search) ||
                       (String(a.phone||'')).includes(search) ||
                       (a.reason||'').toLowerCase().includes(search);
            });
        }

        if (!list.length) {
            el.innerHTML = '<div style="text-align:center;color:#aaa;padding:20px;">No appointments found.</div>';
            return;
        }

        el.innerHTML = list.map(function(a) {
            var hasPhone = !!(String(a.phone||'')).replace(/[^\d]/g,'');
            var dateStr = a.date ? new Date(a.date+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'}) : '—';
            var isToday = a.date===today;
            var isPast  = a.date<today;
            var borderColor = a.status==='Cancelled'?'#e74c3c': isToday?'#25d366': isPast?'#bbb':'#2c5aa0';
            var bgColor = a.status==='Cancelled'?'#fff5f5': isToday?'#f0fff4': isPast?'#f8f8f8':'#f0f4ff';
            var statusBadge = a.status==='Cancelled'
                ? '<span style="font-size:10px;background:#fee;color:#e74c3c;border-radius:4px;padding:1px 6px;font-weight:700;">❌ Cancelled</span>'
                : isToday ? '<span style="font-size:10px;background:#d4edda;color:#155724;border-radius:4px;padding:1px 6px;font-weight:700;">📅 Today</span>'
                : isPast  ? '<span style="font-size:10px;background:#e2e3e5;color:#383d41;border-radius:4px;padding:1px 6px;font-weight:700;">Past</span>'
                :           '<span style="font-size:10px;background:#d1ecf1;color:#0c5460;border-radius:4px;padding:1px 6px;font-weight:700;">⏳ Upcoming</span>';

            var safeId = esc(a.id);

            return '<div data-onclick="waFillFromAppt(\''+safeId+'\')" style="border:1.5px solid '+borderColor+';border-radius:10px;padding:11px 12px;margin-bottom:8px;background:'+bgColor+';cursor:pointer;">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">' +
                    '<div style="flex:1;min-width:0;">' +
                        '<div style="font-weight:700;font-size:14px;color:#1e3f5a;margin-bottom:2px;">'+esc(a.patient)+' '+statusBadge+'</div>' +
                        '<div style="font-size:12px;color:#555;">📅 '+esc(dateStr)+' &nbsp;🕐 '+esc(a.time)+(a.reason?' &nbsp;🦷 '+esc(a.reason):'')+'</div>' +
                        '<div style="font-size:12px;color:#777;margin-top:1px;">'+(a.doctor?'👨‍⚕️ '+esc(a.doctor)+' &nbsp;':'')+(!hasPhone?'<span style="color:#e74c3c;">⚠️ No phone</span>':'📞 '+esc(a.phone))+'</div>' +
                    '</div>' +
                    '<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;max-width:120px;" data-onclick="event.stopPropagation();">' +
                        (hasPhone ?
                            '<button data-onclick="waQuickSend(\''+safeId+'\',\'confirm\')" style="padding:5px 9px;background:#27ae60;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">✅ Confirm</button>' +
                            '<button data-onclick="waQuickSend(\''+safeId+'\',\'reminder24\')" style="padding:5px 9px;background:#e67e22;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">⏰ 24h</button>' +
                            '<button data-onclick="waQuickSend(\''+safeId+'\',\'reminder1h\')" style="padding:5px 9px;background:#e74c3c;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">🔔 1h</button>' +
                            '<button data-onclick="waQuickSend(\''+safeId+'\',\'reschedule\')" style="padding:5px 9px;background:#9b59b6;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">🔄 Reschedule</button>' +
                            '<button data-onclick="waQuickSend(\''+safeId+'\',\'patReschedule\')" style="padding:5px 9px;background:#16a085;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">📅 Pat.Rsch</button>' +
                            '<button data-onclick="waOpenPopupForAppt(\''+safeId+'\')" style="padding:5px 9px;background:#2c5aa0;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">✏️ Custom</button>' +
                            '<button data-onclick="sendClinicLocation(\''+safeId+'\')" style="padding:5px 9px;background:#1abc9c;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">📍 Location</button>'
                        : '') +
                        '<button data-onclick="deleteAppointmentFromWa(\''+safeId+'\')" style="padding:5px 9px;background:#c0392b;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">🗑️ Delete</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    // Fill Quick Send form from appointment card tap
    function waFillFromAppt(id) {
        var a = (_appointments||[]).find(function(x){ return x.id===id; }); if (!a) return;
        var nameEl  = document.getElementById('wa_patName');
        var phoneEl = document.getElementById('wa_patPhone');
        if (nameEl)  nameEl.value  = a.patient||'';
        if (phoneEl) phoneEl.value = a.phone||'';
        var tmplEl = document.getElementById('wa_template');
        if (tmplEl) { tmplEl.value='confirm'; updateWaPreview(); }
        setTimeout(function(){
            var df = document.getElementById('wa_conf_date');  if(df) df.value = a.date||'';
            var tf = document.getElementById('wa_conf_time');  if(tf) tf.value = a.time||'';
            var dc = document.getElementById('wa_conf_doctor');if(dc) dc.value = a.doctor||'Dr. T Sai Vakula';
            refreshWaMsg();
        }, 50);
        var qsEl = document.getElementById('wa_patName');
        if (qsEl) qsEl.scrollIntoView({behavior:'smooth',block:'center'});
        showToast('✅ Patient details filled in Quick Send!','success');
    }

    // Open popup for custom message for any appointment
    function waOpenPopupForAppt(id) {
        var a = (_appointments||[]).find(function(x){ return x.id===id; }); if (!a) return;
        openWaBookingPopup(a);
    }

    // Delete appointment from WA page
    function deleteAppointmentFromWa(id) {
        var a = (_appointments||[]).find(function(x){ return x.id===id; });
        if (!a) return;
        var label = a.patient + (a.date ? ' (' + new Date(a.date+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'}) + ')' : '');
        if (!confirm('🗑️ Delete appointment for ' + label + '?\n\nThis cannot be undone.')) return;
        _appointments = (_appointments||[]).filter(function(x){ return x.id!==id; });
        if (typeof saveAppts === 'function') saveAppts();
        else localStorage.setItem('appointments', JSON.stringify(_appointments));
        renderWaTodayList();
        renderWaAllAppts();
        if (typeof renderAppointments === 'function') renderAppointments();
        if (typeof renderDashboard === 'function') renderDashboard();
        showToast('🗑️ Deleting appointment...', 'info');
        // Sync deletion to Google Sheets
        var p = new URLSearchParams();
        p.append('action', 'deleteAppointment');
        p.append('id', id);
        fetch(CONFIG.apiUrl + '?' + p.toString(), { method: 'GET', redirect: 'follow' })
            .then(function(r){ return r.json(); })
            .then(function(res){
                if (res.success) showToast('☁️ Deleted from Google Sheets too!', 'success');
                else showToast('⚠️ Deleted locally — Sheets sync failed: ' + (res.error||''), 'warning');
            })
            .catch(function(e){ showToast('⚠️ Deleted locally only — no internet?', 'warning'); });
    }

    // Quick send directly from appointment list
    function waQuickSend(id, tmpl) {
        var a = (_appointments||[]).find(function(x){ return x.id===id; }); if (!a) return;
        var phone = (String(a.phone||'')).replace(/[^\d]/g,'');
        if (!phone) { showToast('No phone number saved','warning'); return; }
        _wabpAppt = a;
        var msg = buildWabpMsg(tmpl, a);
        _waSentCount++;
        localStorage.setItem('wa_sent_today',_waSentCount);
        localStorage.setItem('wa_sent_date',new Date().toLocaleDateString('en-CA'));
        updateWaStats();
        openWhatsApp(phone, msg);
        showToast('📲 Message copied! Opening WhatsApp for '+a.patient,'success');
    }

    // Send clinic Google Maps location to patient via WhatsApp
    function sendClinicLocation(id) {
        var a = (_appointments||[]).find(function(x){ return x.id===id; }); if (!a) return;
        var phone = (String(a.phone||'')).replace(/[^\d]/g,'');
        if (!phone) { showToast('No phone number saved','warning'); return; }
        var name = a.patient || 'Patient';
        var mapsUrl = 'https://maps.app.goo.gl/4U5eAwWFZW575XFk6?g_st=awb';
        var msg = '🦷 *Sri Sai Speciality Dental Care*\n\n' +
            'Hello *' + name + '*! 😊\n\n' +
            'Here is our clinic location on Google Maps:\n' +
            '📍 ' + mapsUrl + '\n\n' +
            '📞 8688033072 | 9396522492';
        _waSentCount++;
        localStorage.setItem('wa_sent_today', _waSentCount);
        localStorage.setItem('wa_sent_date', new Date().toLocaleDateString('en-CA'));
        updateWaStats();
        openWhatsApp(phone, msg);
        showToast('📍 Location message opening for ' + name, 'success');
    }

    // Init new pages when navigated to
    document.addEventListener('DOMContentLoaded', function(){
        var d=document.getElementById('appt_date');
        if(d) d.valueAsDate=new Date();
        setTimeout(function(){ updateWaPreview(); updateWaStats(); }, 500);
        setTimeout(function(){ if(typeof renderDashCalendar==='function') renderDashCalendar(); }, 300);
    });
;

;/* ══ FILE: 06-exam-form.js ══════════════════════════════════════════════ */
/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    // ════════════════════════════════════════
    // EXAMINATION FORM
    // ════════════════════════════════════════
    var _efHistory = JSON.parse(localStorage.getItem('ef_history') || '[]');
    function saveEfHistory(){ localStorage.setItem('ef_history', JSON.stringify(_efHistory)); }

    // Dental chart tooth numbers
    var EF_UPPER = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28];
    var EF_LOWER = [48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];

    function initDentalChart() {
        ['upper','lower'].forEach(function(arch) {
            var nums  = EF_UPPER;
            if (arch === 'lower') nums = EF_LOWER;
            var numRow  = document.getElementById('ef_'+arch+'_nums');
            var markRow = document.getElementById('ef_'+arch+'_marks');
            if (!numRow || !markRow) return;
            numRow.innerHTML  = nums.map(function(n){ return '<th>'+n+'</th>'; }).join('');
            markRow.innerHTML = nums.map(function(n){
                return '<td><input type="text" class="ef-chart-input" id="ef_tooth_'+n+'" maxlength="4" placeholder="" title="Tooth '+n+'"></td>';
            }).join('');
        });
    }

    function getExamData() {
        var teeth = {};
        EF_UPPER.concat(EF_LOWER).forEach(function(n){
            var el = document.getElementById('ef_tooth_'+n);
            if (el) teeth[n] = el.value.toUpperCase();
        });
        var tps = ['scaling','filling','crown','rct','denture','extraction','implant','braces','surgery','other'];
        var checkedTp = tps.filter(function(t){ var el=document.getElementById('ef_tp_'+t); return el&&el.checked; });
        return {
            patient:    document.getElementById('ef_patient').value||'',
            age:        document.getElementById('ef_age').value||'',
            sex:        document.getElementById('ef_sex').value||'',
            date:       document.getElementById('ef_date').value||'',
            doctor:     document.getElementById('ef_doctor').value||'',
            phone:      document.getElementById('ef_phone').value||'',
            swelling:   document.getElementById('ef_swelling').value||'',
            tmj:        document.getElementById('ef_tmj').value||'',
            lymph:      document.getElementById('ef_lymph').value||'',
            oral_hygiene:document.getElementById('ef_oral_hygiene').value||'',
            gingiva:    document.getElementById('ef_gingiva').value||'',
            caries:     document.getElementById('ef_caries').value||'',
            missing_teeth:document.getElementById('ef_missing_teeth').value||'',
            stains:     document.getElementById('ef_stains').value||'',
            calculus:   document.getElementById('ef_calculus').value||'',
            prov_diag:  document.getElementById('ef_prov_diag').value||'',
            final_diag: document.getElementById('ef_final_diag').value||'',
            tp_notes:   document.getElementById('ef_tp_notes').value||'',
            treatments: checkedTp,
            teeth:      teeth,
            savedAt:    new Date().toISOString()
        };
    }

    function loadExamData(d) {
        document.getElementById('ef_patient').value     = d.patient||'';
        document.getElementById('ef_age').value         = d.age||'';
        document.getElementById('ef_sex').value         = d.sex||'';
        document.getElementById('ef_date').value        = d.date||'';
        document.getElementById('ef_doctor').value      = d.doctor||'';
        document.getElementById('ef_phone').value       = d.phone||'';
        document.getElementById('ef_swelling').value    = d.swelling||'';
        document.getElementById('ef_tmj').value         = d.tmj||'';
        document.getElementById('ef_lymph').value       = d.lymph||'';
        document.getElementById('ef_oral_hygiene').value= d.oral_hygiene||'';
        document.getElementById('ef_gingiva').value     = d.gingiva||'';
        document.getElementById('ef_caries').value      = d.caries||'';
        document.getElementById('ef_missing_teeth').value=d.missing_teeth||'';
        document.getElementById('ef_stains').value      = d.stains||'';
        document.getElementById('ef_calculus').value    = d.calculus||'';
        document.getElementById('ef_prov_diag').value   = d.prov_diag||'';
        document.getElementById('ef_final_diag').value  = d.final_diag||'';
        document.getElementById('ef_tp_notes').value    = d.tp_notes||'';
        ['scaling','filling','crown','rct','denture','extraction','implant','braces','surgery','other'].forEach(function(t){
            var el=document.getElementById('ef_tp_'+t);
            if(el) el.checked = (d.treatments||[]).includes(t);
        });
        if (d.teeth) {
            EF_UPPER.concat(EF_LOWER).forEach(function(n){
                var el=document.getElementById('ef_tooth_'+n);
                if(el) el.value = d.teeth[n]||'';
            });
        }
    }

    function clearExamForm() {
        ['ef_patient','ef_age','ef_phone','ef_swelling','ef_tmj','ef_lymph',
         'ef_oral_hygiene','ef_gingiva','ef_caries','ef_missing_teeth','ef_stains',
         'ef_calculus','ef_prov_diag','ef_final_diag','ef_tp_notes'].forEach(function(id){
            var el=document.getElementById(id); if(el) el.value='';
        });
        document.getElementById('ef_sex').value='';
        document.getElementById('ef_doctor').value='';
        document.getElementById('ef_date').valueAsDate=new Date();
        ['scaling','filling','crown','rct','denture','extraction','implant','braces','surgery','other'].forEach(function(t){
            var el=document.getElementById('ef_tp_'+t); if(el) el.checked=false;
        });
        EF_UPPER.concat(EF_LOWER).forEach(function(n){
            var el=document.getElementById('ef_tooth_'+n); if(el) el.value='';
        });
    }

    function buildExamPrintHTML(d) {
        d = d || getExamData();
        // every value typed into the exam form (or loaded from history) is shown as text, never as HTML
        d = (function escAll(o) {
            if (typeof o === 'string') return esc(o);
            if (Array.isArray(o)) return o.map(escAll);
            if (o && typeof o === 'object') { var r = {}; Object.keys(o).forEach(function (k) { r[k] = escAll(o[k]); }); return r; }
            return o;
        })(d);
        var dateStr = d.date ? new Date(d.date+'T12:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) : '_______________';
        var tpLabels = {scaling:'Scaling',filling:'Filling',crown:'Crown',rct:'Root Canal Treatment',denture:'Denture',extraction:'Extraction',implant:'Implant',braces:'Braces',surgery:'Surgery',other:'Other'};
        var allTp = ['scaling','filling','crown','rct','denture','extraction','implant','braces','surgery','other'];

        var upperCells = EF_UPPER.map(function(n){ return '<th style="border:1.5px solid #999;padding:4px 6px;min-width:30px;background:#f0f4ff;font-size:11px;font-weight:700;text-align:center;">'+n+'</th>'; }).join('');
        var upperMarks = EF_UPPER.map(function(n){ return '<td style="border:1.5px solid #999;padding:4px 6px;min-width:30px;text-align:center;font-size:11px;font-weight:700;color:#c0392b;">'+(d.teeth&&d.teeth[n]?d.teeth[n]:'')+'</td>'; }).join('');
        var lowerCells = EF_LOWER.map(function(n){ return '<th style="border:1.5px solid #999;padding:4px 6px;min-width:30px;background:#f0f4ff;font-size:11px;font-weight:700;text-align:center;">'+n+'</th>'; }).join('');
        var lowerMarks = EF_LOWER.map(function(n){ return '<td style="border:1.5px solid #999;padding:4px 6px;min-width:30px;text-align:center;font-size:11px;font-weight:700;color:#c0392b;">'+(d.teeth&&d.teeth[n]?d.teeth[n]:'')+'</td>'; }).join('');

        var tpRow1 = allTp.slice(0,5).map(function(t){ return '<td style="border:1.5px solid #999;padding:7px;text-align:center;font-size:12px;">'+((d.treatments||[]).includes(t)?'☑':'☐')+' '+tpLabels[t]+'</td>'; }).join('');
        var tpRow2 = allTp.slice(5).map(function(t){ return '<td style="border:1.5px solid #999;padding:7px;text-align:center;font-size:12px;">'+((d.treatments||[]).includes(t)?'☑':'☐')+' '+tpLabels[t]+'</td>'; }).join('');

        var clinicName  = (typeof CONFIG!=='undefined'&&CONFIG.clinicName)  ? CONFIG.clinicName  : 'Sri Sai Speciality Dental Care';
        var clinicPhone = (typeof CONFIG!=='undefined'&&CONFIG.clinicPhone) ? CONFIG.clinicPhone : '9396522492, 8688033072';
        var clinicAddr  = (typeof CONFIG!=='undefined'&&CONFIG.clinicAddress)?CONFIG.clinicAddress: 'TKR College Road, Karmanghat, Hyderabad';

        return '<style>@page{size:A4;margin:14mm}body,*{font-family:"Bookman Old Style","Book Antiqua",Georgia,serif;box-sizing:border-box}body{padding:0;color:#000;font-size:13px}h1{text-align:center;font-size:18px;font-weight:900;letter-spacing:1px}@media print{html,body{margin:0;padding:0}}</style>'+
        '<div style="max-width:720px;margin:0 auto;">'+
        '<h1 style="text-align:center;font-size:24px;font-weight:900;letter-spacing:1px;margin-bottom:4px;">'+clinicName+'</h1>'+
        '<div style="text-align:center;font-size:14px;margin-bottom:4px;">'+clinicAddr+'</div>'+
        '<div style="text-align:center;font-size:14px;margin-bottom:14px;">📞 '+clinicPhone+'</div>'+
        '<hr style="border:2px solid #000;margin-bottom:12px;">'+
        '<h2 style="text-align:center;font-size:15px;font-weight:900;text-decoration:underline;margin-bottom:14px;">EXAMINATION FORM</h2>'+

        // Patient info
        '<table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px;">'+
        '<tr><td style="padding:4px;width:50%;"><strong>Patient:</strong> '+(d.patient||'_________________________')+'</td>'+
        '<td style="padding:4px;"><strong>Date:</strong> '+dateStr+'</td></tr>'+
        '<tr><td style="padding:4px;"><strong>Age/Sex:</strong> '+(d.age||'___')+' / '+(d.sex||'___')+'</td>'+
        '<td style="padding:4px;"><strong>Doctor:</strong> '+(d.doctor||'_________________________')+'</td></tr>'+
        '</table>'+

        // Section 1
        '<h3 style="text-align:center;font-size:13px;font-weight:900;text-decoration:underline;margin:12px 0 10px;">1. CLINICAL EXAMINATION</h3>'+
        '<table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:12px;">'+
        '<tr>'+
        '<td style="width:50%;vertical-align:top;padding-right:10px;">'+
            '<table style="width:100%;border-collapse:collapse;">'+
            '<thead><tr><th style="border:1.5px solid #999;padding:7px;background:#1e3f5a;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;">Extra Oral Examination</th><th style="border:1.5px solid #999;padding:7px;background:#1e3f5a;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;">Remarks</th></tr></thead>'+
            '<tbody>'+
            '<tr><td style="border:1.5px solid #999;padding:7px;">Swelling</td><td style="border:1.5px solid #999;padding:7px;">'+(d.swelling||'—')+'</td></tr>'+
            '<tr><td style="border:1.5px solid #999;padding:7px;">TMJ</td><td style="border:1.5px solid #999;padding:7px;">'+(d.tmj||'—')+'</td></tr>'+
            '<tr><td style="border:1.5px solid #999;padding:7px;">Lymph Nodes</td><td style="border:1.5px solid #999;padding:7px;">'+(d.lymph||'—')+'</td></tr>'+
            '</tbody></table>'+
        '</td>'+
        '<td style="width:50%;vertical-align:top;">'+
            '<table style="width:100%;border-collapse:collapse;">'+
            '<thead><tr><th style="border:1.5px solid #999;padding:7px;background:#1e3f5a;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;">Intra Oral Examination</th><th style="border:1.5px solid #999;padding:7px;background:#1e3f5a;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;">Remarks</th></tr></thead>'+
            '<tbody>'+
            '<tr><td style="border:1.5px solid #999;padding:6px;">Oral Hygiene</td><td style="border:1.5px solid #999;padding:6px;">'+(d.oral_hygiene||'—')+'</td></tr>'+
            '<tr><td style="border:1.5px solid #999;padding:6px;">Gingiva</td><td style="border:1.5px solid #999;padding:6px;">'+(d.gingiva||'—')+'</td></tr>'+
            '<tr><td style="border:1.5px solid #999;padding:6px;">Dental Caries</td><td style="border:1.5px solid #999;padding:6px;">'+(d.caries||'—')+'</td></tr>'+
            '<tr><td style="border:1.5px solid #999;padding:6px;">Missing Teeth</td><td style="border:1.5px solid #999;padding:6px;">'+(d.missing_teeth||'—')+'</td></tr>'+
            '<tr><td style="border:1.5px solid #999;padding:6px;">Stains</td><td style="border:1.5px solid #999;padding:6px;">'+(d.stains||'—')+'</td></tr>'+
            '<tr><td style="border:1.5px solid #999;padding:6px;">Calculus</td><td style="border:1.5px solid #999;padding:6px;">'+(d.calculus||'—')+'</td></tr>'+
            '</tbody></table>'+
        '</td></tr></table>'+

        // Section 2 - Dental Chart
        '<h3 style="text-align:center;font-size:13px;font-weight:900;text-decoration:underline;margin:12px 0 8px;">2. DENTAL CHART ADULT</h3>'+
        '<div style="text-align:center;font-weight:700;font-size:12px;margin-bottom:6px;">Upper Arch</div>'+
        '<div style="overflow-x:auto;margin-bottom:10px;"><table style="border-collapse:collapse;margin:0 auto;"><thead><tr>'+upperCells+'</tr></thead><tbody><tr>'+upperMarks+'</tr></tbody></table></div>'+
        '<div style="text-align:center;font-weight:700;font-size:12px;margin-bottom:6px;">Lower Arch</div>'+
        '<div style="overflow-x:auto;margin-bottom:8px;"><table style="border-collapse:collapse;margin:0 auto;"><thead><tr>'+lowerCells+'</tr></thead><tbody><tr>'+lowerMarks+'</tr></tbody></table></div>'+
        '<div style="font-size:11px;color:#555;text-align:center;margin-bottom:14px;">Markings: C = Caries &nbsp; M = Missing &nbsp; RCT = Root Canal &nbsp; CR = Crown &nbsp; IMP = Implant &nbsp; EX = Extraction Advised</div>'+

        // Section 3
        '<h3 style="text-align:center;font-size:13px;font-weight:900;text-decoration:underline;margin:12px 0 8px;">3. DIAGNOSIS</h3>'+
        '<table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:12px;">'+
        '<thead><tr><th style="border:1.5px solid #999;padding:8px;background:#1e3f5a;color:#fff;width:35%;-webkit-print-color-adjust:exact;print-color-adjust:exact;">Diagnosis Type</th><th style="border:1.5px solid #999;padding:8px;background:#1e3f5a;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;">Details</th></tr></thead>'+
        '<tbody>'+
        '<tr><td style="border:1.5px solid #999;padding:8px;">Provisional Diagnosis</td><td style="border:1.5px solid #999;padding:8px;">'+(d.prov_diag||'—')+'</td></tr>'+
        '<tr><td style="border:1.5px solid #999;padding:8px;">Final Diagnosis</td><td style="border:1.5px solid #999;padding:8px;">'+(d.final_diag||'—')+'</td></tr>'+
        '</tbody></table>'+

        // Section 4
        '<h3 style="text-align:center;font-size:13px;font-weight:900;text-decoration:underline;margin:12px 0 8px;">4. TREATMENT PLAN</h3>'+
        '<table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:12px;"><tbody>'+
        '<tr>'+tpRow1+'</tr><tr>'+tpRow2+'</tr>'+
        '</tbody></table>'+
        '<div style="font-size:12px;margin-bottom:14px;padding:4px 0;">*Treatment Notes: '+(d.tp_notes||'___________________________________________')+'</div>'+

        '</div>';
    }

    function printExamForm() {
        var d = getExamData();
        if (!d.patient) { showToast('Enter patient name first','warning'); return; }
        d.recordId = d.recordId || newId('EF');
        // Save to history
        _efHistory.push(d);
        saveEfHistory();
        renderEfHistory();
        // Sync to Google Sheets
        if (window.CONFIG && CONFIG.apiUrl && !CONFIG.apiUrl.includes('YOUR_WEB_APP')) {
            var p = new URLSearchParams();
            p.append('action','saveExamForm');
            p.append('recordId',     d.recordId);
            p.append('date',         d.date);
            p.append('patient',      d.patient);
            p.append('age',          d.age);
            p.append('sex',          d.sex);
            p.append('doctor',       d.doctor);
            p.append('phone',        d.phone);
            p.append('swelling',     d.swelling);
            p.append('tmj',          d.tmj);
            p.append('lymph',        d.lymph);
            p.append('oral_hygiene', d.oral_hygiene);
            p.append('gingiva',      d.gingiva);
            p.append('caries',       d.caries);
            p.append('missing_teeth',d.missing_teeth);
            p.append('stains',       d.stains);
            p.append('calculus',     d.calculus);
            p.append('prov_diag',    d.prov_diag);
            p.append('final_diag',   d.final_diag);
            p.append('treatments',   (d.treatments||[]).join(', '));
            p.append('tp_notes',     d.tp_notes);
            p.append('upper_teeth',  EF_UPPER.map(function(n){ return n+':'+(d.teeth[n]||''); }).join(', '));
            p.append('lower_teeth',  EF_LOWER.map(function(n){ return n+':'+(d.teeth[n]||''); }).join(', '));
            if (window.V31 && V31.enabled()) { var epid = V31.patientIdFor('ef_patient', 'ef_phone'); if (epid) p.append('patientId', epid); }
            fetch(CONFIG.apiUrl + '?' + p.toString(), {method:'GET', redirect:'follow'})
                .then(function(r){return r.json();})
                .then(function(res){ if(res.success) showToast('☁️ Exam form saved to Sheets!','success'); })
                .catch(function(){});
        }
        printBillHtml(buildExamPrintHTML(d));
    }

    function renderEfHistory() {
        var el = document.getElementById('ef_history_list'); if (!el) return;
        if (!_efHistory.length) {
            el.innerHTML = '<div style="text-align:center;color:#aaa;padding:20px;font-size:13px;">No exam forms saved yet.</div>';
            return;
        }
        el.innerHTML = _efHistory.slice().reverse().map(function(d, ri) {
            var idx = _efHistory.length - 1 - ri;
            var dateStr = d.date ? new Date(d.date+'T12:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
            var tpSummary = (d.treatments||[]).map(function(t){ return t.charAt(0).toUpperCase()+t.slice(1); }).join(', ') || '—';
            return '<div class="ef-hist-item">' +
                '<div class="ef-hist-info">' +
                    '<div class="ef-hist-name">🦷 '+esc(d.patient||'—')+'</div>' +
                    '<div class="ef-hist-meta">📅 '+esc(dateStr)+(d.doctor?' | 👨‍⚕️ '+esc(d.doctor):'')+'</div>' +
                    '<div class="ef-hist-meta">📋 '+esc(tpSummary)+'</div>' +
                '</div>' +
                '<div class="ef-hist-btns">' +
                    '<button style="background:#2c5aa0;" data-onclick="loadEfRecord('+idx+')">✏️ Load</button>' +
                    '<button style="background:#27ae60;" data-onclick="reprintEfRecord('+idx+')">🖨️ Print</button>' +
                    '<button style="background:#e74c3c;" data-onclick="deleteEfRecord('+idx+')">🗑️</button>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    function loadEfRecord(idx) {
        loadExamData(_efHistory[idx]);
        window.scrollTo(0,0);
        showToast('✅ Exam form loaded','success');
    }

    function reprintEfRecord(idx) {
        printBillHtml(buildExamPrintHTML(_efHistory[idx]));
    }

    function deleteEfRecord(idx) {
        if (!confirm('Delete this exam form?')) return;
        var rec = _efHistory[idx];
        _efHistory.splice(idx,1);
        saveEfHistory();
        renderEfHistory();
        showToast('🗑️ Exam form deleted', 'success');
        if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
        var p = new URLSearchParams();
        p.append('action', 'deleteExamForm');
        p.append('recordId', rec ? (rec.recordId||'') : '');
        p.append('savedAt', rec ? (rec.savedAt||rec.date||'') : '');
        p.append('patientName', rec ? (rec.patientName||rec.patient||'') : '');
        fetch(CONFIG.apiUrl + '?' + p.toString(), { method: 'GET', redirect: 'follow' })
            .then(function(r){ return r.json(); })
            .then(function(res){ if (res.success) showToast('☁️ Removed from Google Sheets', 'success'); else showToast('⚠️ Deleted locally — Sheets sync failed', 'warning'); })
            .catch(function(){ showToast('⚠️ Deleted locally only', 'warning'); });
    }

    function clearExamHistory() {
        if (!confirm('Clear all exam form history?')) return;
        _efHistory = [];
        saveEfHistory();
        renderEfHistory();
    }

    document.addEventListener('DOMContentLoaded', function(){
        setTimeout(function(){
            initDentalChart();
            renderEfHistory();
            var d = document.getElementById('ef_date');
            if (d) d.valueAsDate = new Date();
        }, 200);
    });
    // ════════════════════════════════════════
    // END EXAMINATION FORM
    // ════════════════════════════════════════
;

;/* ══ FILE: 07-whatsapp.js ══════════════════════════════════════════════ */
/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    function openWhatsApp(phone, msg) {
        // Copy message to clipboard first
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(msg).then(function() {
                showToast('✅ Message copied! Paste it in WhatsApp chat.', 'success');
            }).catch(function(){});
        } else {
            // Fallback: select textarea
            var ta = document.createElement('textarea');
            ta.value = msg;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus(); ta.select();
            try { document.execCommand('copy'); } catch(e) {}
            document.body.removeChild(ta);
        }
        // Open WhatsApp with phone only (no text in URL = no encoding corruption)
        var cleanPhone = (String(phone||'')).replace(/[^\d]/g,'');
        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
        // Small delay so toast shows first
        setTimeout(function(){
            window.open('https://wa.me/' + cleanPhone, '_blank');
        }, 400);
    }
;

;/* ══ FILE: 08-mobile-sidebar.js ══════════════════════════════════════════════ */
/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    function toggleSidebar() {
        var sidebar = document.querySelector('.sidebar');
        var overlay = document.getElementById('sidebarOverlay');
        if (sidebar.classList.contains('open')) {
            closeSidebar();
        } else {
            sidebar.classList.add('open');
            overlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }
    function closeSidebar() {
        var sidebar = document.querySelector('.sidebar');
        var overlay = document.getElementById('sidebarOverlay');
        if (!sidebar) return;
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        // Use rAF to restore scroll after transition finishes, prevents stuck-scroll on iPad
        requestAnimationFrame(function() { document.body.style.overflow = ''; });
    }
    // Close sidebar on nav item click (mobile)
    document.querySelectorAll('.nav-item').forEach(function(item) {
        item.addEventListener('click', function() {
            if (window.innerWidth <= 1024) closeSidebar();
        });
    });
    // Swipe left on sidebar to close, swipe right from edge to open
    (function() {
        var startX, startY, sidebar = document.querySelector('.sidebar');
        // Swipe left to close
        sidebar.addEventListener('touchstart', function(e) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, {passive: true});
        sidebar.addEventListener('touchend', function(e) {
            if (!startX) return;
            var dx = e.changedTouches[0].clientX - startX;
            var dy = e.changedTouches[0].clientY - startY;
            if (dx < -50 && Math.abs(dy) < 80) closeSidebar();
            startX = null;
        }, {passive: true});
        // Swipe right from left edge to open
        document.addEventListener('touchstart', function(e) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, {passive: true});
        document.addEventListener('touchend', function(e) {
            if (startX === null || startX === undefined) return;
            var dx = e.changedTouches[0].clientX - startX;
            var dy = Math.abs(e.changedTouches[0].clientY - startY);
            if (dx > 60 && dy < 80 && startX < 25 && window.innerWidth <= 1024) {
                if (!sidebar.classList.contains('open')) toggleSidebar();
            }
        }, {passive: true});
    })();
;

;/* ══ FILE: 09-bt-printer.js ══════════════════════════════════════════════ */
/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    // ════════════════════════════════════════════════════════════
    // BLUETOOTH THERMAL PRINTER ENGINE
    // ════════════════════════════════════════════════════════════
    window._btPrinter = {
        device: null,
        server: null,
        characteristic: null,
        connected: false,
        deviceName: '',
        autoPrintAfterConnect: false
    };

    // Common BLE printer service/characteristic UUID sets (try each in order)
    var BT_PROFILES = [
        { service: '000018f0-0000-1000-8000-00805f9b34fb', char: '00002af1-0000-1000-8000-00805f9b34fb' },
        { service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', char: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f' },
        { service: '49535343-fe7d-4ae5-8fa9-9fafd205e455', char: '49535343-1e4d-4bd9-ba61-23c647249616' },
        { service: '0000ff00-0000-1000-8000-00805f9b34fb', char: '0000ff02-0000-1000-8000-00805f9b34fb' },
        { service: '000018f0-0000-1000-8000-00805f9b34fb', char: '00002af0-0000-1000-8000-00805f9b34fb' }
    ];

    function openBtPrinterPanel(autoPrint) {
        window._btPrinter.autoPrintAfterConnect = !!autoPrint;
        var panel = document.getElementById('__btPanel');
        if (panel) {
            panel.style.display = 'flex';
            requestAnimationFrame(function(){
                var sheet = document.getElementById('__btPanelSheet');
                if(sheet) sheet.style.transform = 'translateY(0)';
            });
        }
        _btUpdateUI();
    }

    function closeBtPrinterPanel() {
        var panel = document.getElementById('__btPanel');
        var sheet = document.getElementById('__btPanelSheet');
        if(sheet) sheet.style.transform = 'translateY(110%)';
        setTimeout(function(){ if(panel) panel.style.display = 'none'; }, 340);
    }

    function _btSetStatus(msg, type) {
        var el = document.getElementById('__btStatusMsg');
        if (!el) return;
        if (msg) {
            el.textContent = msg;
            el.className = '__btStatus ' + (type || 'info');
            el.style.display = 'block';
        } else {
            el.style.display = 'none';
        }
    }

    function _btSetProgress(show) {
        var el = document.getElementById('__btProgressWrap');
        if (el) el.style.display = show ? 'block' : 'none';
    }

    function _btUpdateUI() {
        var connected = window._btPrinter.connected;
        var name = window._btPrinter.deviceName || 'Thermal Printer';

        // Sidebar indicator
        var dot = document.getElementById('btStatusDot');
        var lbl = document.getElementById('btPrinterLabel');
        if (dot) { dot.style.background = connected ? '#27ae60' : '#e74c3c'; dot.style.animation = connected ? 'none' : 'pulse 2s infinite'; }
        if (lbl) lbl.textContent = connected ? name : 'Thermal Printer';

        // Panel cards
        var connCard = document.getElementById('__btConnectedCard');
        var notConn  = document.getElementById('__btNotConnectedSection');
        var printNow = document.getElementById('__btPrintNowSection');
        var nameEl   = document.getElementById('__btConnName');
        if (nameEl) nameEl.textContent = name;
        if (connCard) connCard.style.display = connected ? 'block' : 'none';
        if (notConn)  notConn.style.display  = connected ? 'none' : 'block';
        if (printNow) printNow.style.display  = (connected && window._btPrinter.autoPrintAfterConnect && __pendingPrintHtml) ? 'block' : 'none';

        // Print choice button
        var btBtn = document.getElementById('__pcdBtBtn');
        if (btBtn) {
            if (connected) {
                btBtn.innerHTML = '🔵 Thermal Print<br><span style="font-size:11px;opacity:0.85;">80mm · '+esc(name)+'</span>';
                btBtn.style.opacity = '1';
            } else {
                btBtn.innerHTML = '🔵 Thermal Print<br><span style="font-size:11px;opacity:0.85;">Tap to connect first</span>';
                btBtn.style.opacity = '0.75';
            }
        }
    }

    async function btScanAndConnect() {
        if (!navigator.bluetooth) {
            _btSetStatus('❌ Web Bluetooth not supported. Use Chrome/Edge on Android or Chrome on Desktop.', 'err');
            return;
        }
        _btSetStatus('🔍 Opening Bluetooth scanner...', 'info');
        _btSetProgress(true);
        try {
            // Build optionalServices list from all profiles
            var optServices = BT_PROFILES.map(function(p){ return p.service; });
            var device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: optServices
            });
            _btSetStatus('⏳ Connecting to ' + device.name + '...', 'info');
            window._btPrinter.device     = device;
            window._btPrinter.deviceName = device.name || 'BT Printer';
            device.addEventListener('gattserverdisconnected', _btOnDisconnected);

            var server = await device.gatt.connect();
            window._btPrinter.server = server;

            // Try each profile until one works
            var char = null;
            for (var i = 0; i < BT_PROFILES.length; i++) {
                try {
                    var svc = await server.getPrimaryService(BT_PROFILES[i].service);
                    char = await svc.getCharacteristic(BT_PROFILES[i].char);
                    break;
                } catch(e2) { /* try next */ }
            }
            if (!char) {
                // Fallback: try to get any writable characteristic
                try {
                    var services = await server.getPrimaryServices();
                    outer: for (var s = 0; s < services.length; s++) {
                        var chars = await services[s].getCharacteristics();
                        for (var c = 0; c < chars.length; c++) {
                            var props = chars[c].properties;
                            if (props.write || props.writeWithoutResponse) {
                                char = chars[c]; break outer;
                            }
                        }
                    }
                } catch(e3) {}
            }
            if (!char) throw new Error('No writable characteristic found on this printer. Try pairing it in Bluetooth settings first.');

            window._btPrinter.characteristic = char;
            window._btPrinter.connected = true;
            _btSetProgress(false);
            _btSetStatus('✅ Connected to ' + device.name, 'ok');
            _btUpdateUI();
            showToast('🔵 Printer connected: ' + device.name, 'success');

            // Auto-print if triggered from print dialog
            if (window._btPrinter.autoPrintAfterConnect && __pendingPrintHtml) {
                window._btPrinter.autoPrintAfterConnect = false;
                _btUpdateUI();
                setTimeout(function(){ _doThermalPrint(__pendingPrintHtml); closeBtPrinterPanel(); }, 600);
            }
        } catch(err) {
            _btSetProgress(false);
            if (err.name === 'NotFoundError' || err.message.includes('cancelled')) {
                _btSetStatus('', '');
            } else {
                _btSetStatus('❌ ' + err.message, 'err');
            }
        }
    }

    function _btOnDisconnected() {
        window._btPrinter.connected = false;
        window._btPrinter.characteristic = null;
        _btUpdateUI();
        if (document.getElementById('__btPanel').style.display === 'flex') {
            _btSetStatus('⚠️ Printer disconnected. Tap Scan to reconnect.', 'err');
        }
        showToast('🔌 Bluetooth printer disconnected', 'warning');
    }

    function btDisconnect() {
        if (window._btPrinter.device && window._btPrinter.device.gatt.connected) {
            window._btPrinter.device.gatt.disconnect();
        }
        window._btPrinter.connected = false;
        window._btPrinter.characteristic = null;
        _btUpdateUI();
        _btSetStatus('', '');
    }

    // ── ESC/POS Receipt Builder — 80mm / 3.1" (W=48) ─────────
    var ESC=0x1B, GS=0x1D, LF=0x0A;
    // Printer character width — KP307 default is 42. Change in printer panel if misaligned.
    var _W = parseInt(localStorage.getItem('thermal_printer_width') || '48');

    function _init()   { return [ESC,0x40]; }
    function _fontA()  { return [ESC,0x4D,0x00]; }
    function _aL()     { return [ESC,0x61,0x00]; }
    function _aC()     { return [ESC,0x61,0x01]; }
    function _bOn()    { return [ESC,0x45,0x01]; }
    function _bOff()   { return [ESC,0x45,0x00]; }
    function _gap(n)   { return [ESC,0x33,n|0]; }
    function _cut()    { return [GS, 0x56,0x41,0x20]; }
    function _lf(n)    { var r=[]; for(var i=0;i<(n||1);i++) r.push(LF); return r; }
    // Double-height + double-width (tall + wide = big text)
    function _tallOn()  { return [ESC,0x21,0x30]; } // bit4=dblH, bit5=dblW, bold
    function _tallOff() { return [ESC,0x21,0x00]; }
    // Double-height only (taller but same width — fits more chars)
    // ESC ! 0x10 = double height; works on virtually all ESC/POS printers
    function _dhOn()    { return [ESC,0x21,0x10]; }
    function _dhOff()   { return [ESC,0x21,0x00]; }

    function _clean(s){
        return (s||'')
            .replace(/&#8377;/g,'Rs.').replace(/\u20b9/g,'Rs.')
            .replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\u00a0/g,' ')
            .replace(/&lt;/g,'<').replace(/&gt;/g,'>')
            .replace(/\u2014|\u2013/g,'-')
            .replace(/[^\x20-\x7E\n]/g,'');
    }
    function _b(s){
        var c=_clean(s),o=[];
        for(var i=0;i<c.length;i++) o.push(c.charCodeAt(i)&0xFF);
        return o;
    }
    function _t(s,w){ return _clean(String(s||'')).substring(0,w||_W); }

    // Center within W
    function _ctr(s,w){
        var W=w||_W, t=_clean(String(s||''));
        if(t.length>=W) t=t.substring(0,W);
        var p=Math.floor((W-t.length)/2);
        return _b(' '.repeat(p)+t+'\n');
    }

    // Center at DOUBLE-WIDTH (max 24 chars visible)
    function _ctrDW(s){
        var W=24, t=_clean(String(s||'')).substring(0,W);
        var p=Math.floor((W-t.length)/2);
        return _b(' '.repeat(p)+t+'\n');
    }

    // Dash leader right-justify: "LEFT ---- RIGHT\n"
    function _dash(left,right,w){
        var W=w||_W;
        left=_clean(String(left||'')); right=_clean(String(right||''));
        var sp=W-left.length-right.length;
        if(sp<2){ left=left.substring(0,W-right.length-2); sp=2; }
        return _b(left+'-'.repeat(sp)+right+'\n');
    }

    // Parse amount
    function _amt(s){
        var m=_clean(String(s||'')).match(/(\d[\d,]*\.?\d*)/);
        return m?parseFloat(m[1].replace(/,/g,'')):0;
    }
    function _n(s){ var v=_amt(s); return v>0?v.toFixed(2):''; }

    // Dividers — 48 chars wide
    function _div()  { return _b('------------------------------------------------\n'); }
    function _dbl()  { return _b('================================================\n'); }
    function _dot()  { return _b('................................................\n'); }
    function _star() { return _b('================================================\n'); }
    function _nl()   { return [LF]; }

    // ── UPI QR Code ───────────────────────────────────────────
    function _upiQR(upiId,amount,name,ms){
        var url='upi://pay?pa='+upiId+'&pn='+(name||'SriSaiDental')+
                '&am='+amount.toFixed(2)+'&cu=INR&tn=DentalBill';
        var data=[]; for(var i=0;i<url.length;i++) data.push(url.charCodeAt(i)&0xFF);
        var sLen=data.length+3, pL=sLen&0xFF, pH=(sLen>>8)&0xFF;
        return [].concat(
            [GS,0x28,0x6B,0x04,0x00,0x31,0x41,0x32,0x00],
            [GS,0x28,0x6B,0x03,0x00,0x31,0x43,ms||4],
            [GS,0x28,0x6B,0x03,0x00,0x31,0x45,0x31],
            [GS,0x28,0x6B,pL,pH,0x31,0x50,0x30],
            data,
            [GS,0x28,0x6B,0x03,0x00,0x31,0x51,0x30]
        );
    }

    // ════════════════════════════════════════════════════════
    //  MAIN BUILDER
    // ════════════════════════════════════════════════════════
    function _buildThermalBytes(html){
        html=html.replace(/&#8377;/g,'Rs.').replace(/\u20b9/g,'Rs.').replace(/&nbsp;/g,' ');

        var doc=(new DOMParser()).parseFromString(html,'text/html');
        var out=[], grandTotal=0;

        out=out.concat(_init());
        out=out.concat(_fontA());
        out=out.concat([ESC,0x21,0x00]);  // ensure normal mode
        out=out.concat(_gap(24));

        // ════════════════════════════════════
        //  HEADER
        // ════════════════════════════════════
        out=out.concat(_aC());
        // Clinic name: Double-height + bold (fits 48 chars wide, taller)
        out=out.concat(_dhOn());
        out=out.concat(_bOn());
        out=out.concat(_ctr('SRI SAI SPECIALITY DENTAL CARE'));
        out=out.concat(_bOff());
        out=out.concat(_dhOff());
        // Tagline — normal bold
        out=out.concat([ESC,0x21,0x00]);
        out=out.concat(_bOn());
        out=out.concat(_ctr('~ Smile With Confidence ~'));
        out=out.concat(_bOff());
        out=out.concat(_star());
        out=out.concat(_bOn());
        out=out.concat(_ctr('TKR College Rd, Karmanghat'));
        out=out.concat(_ctr('Ph: 9396522492 / 8688033072'));
        out=out.concat(_bOff());
        out=out.concat(_star());
        out=out.concat(_aL());

        var isCB=!!doc.getElementById('__cb');
        var isRx=!!doc.getElementById('__rx');
        var isPh=!!doc.getElementById('__ph');

        // ════════════════════════════════════
        //  COMBINED BILL
        // ════════════════════════════════════
        if(isCB){
            var cb=doc.getElementById('__cb');
            var iv=Array.from(cb?cb.querySelectorAll('.i-val'):[])
                       .map(function(e){return _clean(e.textContent.replace(/\u00a0/g,' ').trim());});

            if(iv[0]) { out=out.concat(_bOn()); out=out.concat(_b('Bill No : '+_t(iv[0],40)+'\n')); out=out.concat(_bOff()); }
            if(iv[1]) out=out.concat(_b('Date    : '+_t(iv[1],38)+'\n'));
            if(iv[2]) out=out.concat(_b('Patient : '+_t(iv[2],38)+'\n'));
            if(iv[3]) out=out.concat(_b('Doctor  : '+_t(iv[3],38)+'\n'));
            if(iv[4]) out=out.concat(_b('Phone   : '+_t(iv[4],38)+'\n'));
            out=out.concat(_div());

            // ── Medicines ──────────────────────────────────
            var mTable=cb?cb.querySelector('table.meds'):null, meds=[];
            if(mTable){ Array.from(mTable.querySelectorAll('tbody tr')).forEach(function(row){
                var td=Array.from(row.querySelectorAll('td'))
                          .map(function(c){return _clean(c.textContent.trim());});
                if(td.length<2||!td[0]||/no medicines/i.test(td[0]))return;
                meds.push({name:td[0],qty:td[1]||'',rate:td[2]||'',amount:td[td.length-1]});
            });}

            if(meds.length>0){
                out=out.concat(_aC());
                out=out.concat(_bOn());
                out=out.concat(_ctr('- MEDICINES -'));
                out=out.concat(_bOff());
                out=out.concat(_aL());
                out=out.concat(_dot());
                out=out.concat(_bOn());
                out=out.concat(_b('  Item              Qty   Rate     Amount\n'));
                out=out.concat(_bOff());
                out=out.concat(_dot());

                meds.forEach(function(m){
                    var aStr = _n(m.amount);
                    var left = _t(m.name,16);
                    if(m.qty)  left += ' x'+_t(m.qty,3);
                    if(m.rate) left += ' @'+_t(m.rate,9);
                    left = _t(left, _W - aStr.length - 3);
                    out=out.concat(_dash(left, aStr));
                });
                out=out.concat(_dot());
            }

            // ── Summary rows ────────────────────────────────
            var sBox=cb?cb.querySelector('.summary-box'):null, sRows=[];
            if(sBox){ Array.from(sBox.querySelectorAll('tr')).forEach(function(row){
                var td=Array.from(row.querySelectorAll('td'))
                          .map(function(c){return _clean(c.textContent.trim());});
                if(td.length>=2&&td[0]&&td[1]) sRows.push({label:td[0],value:td[1]});
            });}

            sRows.slice(0,-1).forEach(function(r){
                var v=_amt(r.value);
                var valStr='Rs.'+v.toFixed(2);
                out=out.concat(_bOn());
                out=out.concat(_dash(_t(r.label,24),valStr));
                out=out.concat(_bOff());
            });

            // Grand Total — TALL + BOLD
            var gRow=sRows.length>0?sRows[sRows.length-1]:null;
            if(gRow){
                grandTotal=_amt(gRow.value);
                out=out.concat(_dbl());
                out=out.concat(_aC());
                out=out.concat(_tallOn());
                out=out.concat(_ctrDW('GRAND TOTAL'));
                out=out.concat(_ctrDW('Rs.'+grandTotal.toFixed(2)));
                out=out.concat(_tallOff());
                out=out.concat(_aL());
                out=out.concat(_dbl());
            }

            // ── Treatment-only (no medicines) ──
            var trEl=cb?cb.querySelector('.tr-amt-row'):null, trAmt=0;
            if(trEl&&meds.length===0){
                var tm=_clean(trEl.textContent).match(/(\d[\d,]*\.?\d*)/);
                trAmt=tm?parseFloat(tm[1].replace(/,/g,'')):0;
                var trBox=cb?cb.querySelector('.tr-box'):null, trLines=[];
                if(trBox){ trBox.querySelectorAll('div').forEach(function(d){
                    var t=_clean(d.textContent.trim()); if(t&&t.length>1)trLines.push(t);
                });}
                trLines.slice(0,4).forEach(function(l){ out=out.concat(_b(_t(l,_W)+'\n')); });
                if(trAmt>0){
                    grandTotal=trAmt;
                    out=out.concat(_dbl());
                    out=out.concat(_aC());
                    out=out.concat(_dhOn());
                    out=out.concat(_ctr('** GRAND TOTAL **'));
                    out=out.concat(_ctr('Rs. '+grandTotal.toFixed(2)));
                    out=out.concat(_dhOff());
                    out=out.concat(_aL());
                    out=out.concat(_dbl());
                }
            }

        } else if(doc.getElementById('__tr')) {
            // ── TREATMENT RECEIPT (#__tr) ──────────────────
            var tr = doc.getElementById('__tr');
            var iVals = Array.from(tr?tr.querySelectorAll('.i-val'):[])
                            .map(function(e){return _clean(e.textContent.replace(/\u00a0/g,' ').replace(/&nbsp;/g,' ').trim());});
            var trNo   = iVals[0]||'';
            var trDate = iVals[1]||'';
            var trPt   = iVals[2]||'';
            var trAmt2 = iVals[3]||'';
            var trWords= iVals[4]||'';
            var trRows = Array.from(tr?tr.querySelectorAll('table.treat td.item-cell'):[])
                             .map(function(td){return _clean(td.textContent.trim());})
                             .filter(function(t){return t&&t.length>1;});
            grandTotal = parseFloat(trAmt2.replace(/[^\d.]/g,''))||0;
            var trPay = __thermalPay(doc, grandTotal); if (trPay && trPay.total) grandTotal = trPay.total;   // part paid: TOTAL is the full charge

            if(trNo)  { out=out.concat(_bOn()); out=out.concat(_b('Bill No : '+_t(trNo,39)+'\n')); out=out.concat(_bOff()); }
            if(trDate)  out=out.concat(_b('Date    : '+_t(trDate,38)+'\n'));
            if(trPt)    out=out.concat(_b('Patient : '+_t(trPt,38)+'\n'));
            if(trAmt2)  out=out.concat(_b('Amount  : Rs.'+_t(trAmt2,35)+'\n'));
            if(trWords) out=out.concat(_b('Words   : '+_t(trWords,38)+'\n'));
            out=out.concat(_div());

            if(trRows.length>0){
                out=out.concat(_bOn());
                out=out.concat(_b('TOWARDS:\n'));
                out=out.concat(_bOff());
                out=out.concat(_aC());
                out=out.concat(_bOn());
                trRows.forEach(function(l){ out=out.concat(_ctr(l.trim())); });
                out=out.concat(_bOff());
                out=out.concat(_aL());
                out=out.concat(_nl());
            }

            if(grandTotal>0){
                out=out.concat(_dbl());
                out=out.concat(_aC());
                out=out.concat(_tallOn());
                out=out.concat(_ctrDW('TOTAL'));
                out=out.concat(_ctrDW('Rs.'+grandTotal.toFixed(2)));
                out=out.concat(_tallOff());
                out=out.concat(_aL());
                out=out.concat(_dbl());
            }

        } else if(isRx){
            var rx=doc.getElementById('__rx');
            _clean(rx?(rx.innerText||rx.textContent):'').split('\n')
                .map(function(l){return l.trim();}).filter(Boolean).slice(0,30)
                .forEach(function(l){
                    if(/^(sri sai|mob|timing|reg\.|b\.d)/i.test(l))return;
                    out=out.concat(_b(_t(l,_W)+'\n'));
                });

        } else if(doc.getElementById('__ph')) {
            // ════════════════════════════════════
            //  PHARMACY BILL (direct data path)
            // ════════════════════════════════════
            var ph = doc.getElementById('__ph');
            var phBillId  = ph.getAttribute('data-billid')  || '';
            var phPatient = ph.getAttribute('data-patient')  || '';
            var phDoctor  = ph.getAttribute('data-doctor')   || '';
            var phDate    = ph.getAttribute('data-date')     || '';
            var phTotal   = parseFloat(ph.getAttribute('data-total')   || '0');
            var phSub     = parseFloat(ph.getAttribute('data-subtotal')|| '0');
            var phDisc    = parseFloat(ph.getAttribute('data-discount') || '0');
            var phItems   = [];
            var phMode    = ph.getAttribute('data-mode') || 'Cash';
            try { phItems = JSON.parse(decodeURIComponent(ph.getAttribute('data-items') || '[]')); } catch(e){}

            if(phBillId){ out=out.concat(_bOn()); out=out.concat(_b('Bill No : '+_t(phBillId,_W-9)+'\n')); out=out.concat(_bOff()); }
            out=out.concat(_b('Date    : '+_t(phDate,   _W-9)+'\n'));
            out=out.concat(_b('Patient : '+_t(phPatient,_W-9)+'\n'));
            out=out.concat(_b('Doctor  : '+_t(phDoctor, _W-9)+'\n'));
            out=out.concat(_b('Payment : '+phMode+'\n'));
            out=out.concat(_div());

            out=out.concat(_aC());
            out=out.concat(_bOn());
            out=out.concat(_ctr('- MEDICINES -'));
            out=out.concat(_bOff());
            out=out.concat(_aL());
            out=out.concat(_dot());
            out=out.concat(_bOn());
            out=out.concat(_dash('  Item','Amt'));
            out=out.concat(_bOff());
            out=out.concat(_dot());

            phItems.forEach(function(it){
                var aStr = _n(it.amount);
                var name = _t(it.name||'', _W - aStr.length - 5);
                var qty  = ' x'+String(it.qty||'1');
                var left = _t(name + qty, _W - aStr.length - 3);
                out=out.concat(_dash(left, aStr));
            });
            out=out.concat(_dot());

            if(phDisc>0){
                out=out.concat(_bOn()); out=out.concat(_dash(_t('Subtotal',24),'Rs.'+phSub.toFixed(2))); out=out.concat(_bOff());
                out=out.concat(_dash(_t('Discount',24),'-Rs.'+phDisc.toFixed(2)));
            }
            // Grand Total — GS! BIG + center
            out=out.concat(_dbl());
            grandTotal=phTotal;
            out=out.concat([ESC,0x61,0x01]);   // center
            out=out.concat([GS,0x21,0x11]);    // GS! double H+W
            out=out.concat(_bOn());
            out=out.concat(_b('GRAND TOTAL\n'));
            out=out.concat(_b('Rs.'+phTotal.toFixed(2)+'\n'));
            out=out.concat(_bOff());
            out=out.concat([GS,0x21,0x00]);    // normal
            out=out.concat([ESC,0x61,0x00]);   // left
            out=out.concat(_dbl());

        } else {
            // Generic fallback
            var body=_clean(doc.body?(doc.body.innerText||doc.body.textContent):'');
            var bL=body.split('\n').map(function(l){return l.trim();}).filter(Boolean);
            var inf={};
            bL.forEach(function(l){
                var m;
                if(!inf.no  &&(m=l.match(/(?:bill|receipt|no)[^\w]*([\w][\w\-\/]*)/i)))inf.no=m[1];
                if(!inf.date&&(m=l.match(/date\s*[:|]\s*(.+)/i)))inf.date=m[1].trim().substring(0,40);
                if(!inf.pt  &&(m=l.match(/(?:patient|name)\s*[:|]\s*(.+)/i)))inf.pt=m[1].trim().substring(0,40);
                if(!inf.dr  &&(m=l.match(/(?:doctor|dr\.?)\s*[:|]\s*(.+)/i)))inf.dr=m[1].trim().substring(0,40);
            });
            if(inf.no) { out=out.concat(_bOn()); out=out.concat(_b('Bill No : '+inf.no+'\n')); out=out.concat(_bOff()); }
            if(inf.date) out=out.concat(_b('Date    : '+inf.date+'\n'));
            if(inf.pt)   out=out.concat(_b('Patient : '+inf.pt+'\n'));
            if(inf.dr)   out=out.concat(_b('Doctor  : '+inf.dr+'\n'));
            out=out.concat(_div());

            var items2=[],tots2=[];
            Array.from(doc.querySelectorAll('table tr')).forEach(function(row){
                var td=Array.from(row.querySelectorAll('td,th'))
                          .map(function(c){return _clean(c.textContent.trim().replace(/\s+/g,' '));});
                if(td.length<2||!td[0])return;
                if(/^(sl|no|#|item|description|medicine|qty|amount|rate|price)$/i.test(td[0]))return;
                if(/^[-_. ]+$/.test(td[0]))return;
                var isT=/total|grand|subtotal|discount/i.test(td[0]);
                if(isT) tots2.push({label:td[0],value:td[td.length-1]});
                else    items2.push({name:td[0],qty:td.length>=3?td[1]:'',rate:td.length>=4?td[2]:'',price:td[td.length-1]});
            });

            out=out.concat(_bOn()); out=out.concat(_dash('Item','Amount')); out=out.concat(_bOff());
            out=out.concat(_dot());
            items2.forEach(function(it){
                var aStr=_n(it.price), left=_t(it.name,20)+(it.qty?' x'+it.qty:'')+(it.rate?' @'+it.rate:'');
                out=out.concat(_dash(_t(left,_W-aStr.length-3),aStr));
            });
            out=out.concat(_dot());
            tots2.forEach(function(t,i){
                var isG=/grand/i.test(t.label)||i===tots2.length-1;
                var val='Rs.'+_amt(t.value).toFixed(2);
                if(isG){
                    grandTotal=_amt(t.value);
                    out=out.concat(_dbl());
                    out=out.concat(_aC());
                    out=out.concat(_dhOn());
                    out=out.concat(_ctr('** GRAND TOTAL **'));
                    out=out.concat(_ctr('Rs. '+grandTotal.toFixed(2)));
                    out=out.concat(_dhOff());
                    out=out.concat(_aL());
                    out=out.concat(_dbl());
                } else {
                    out=out.concat(_dash(_t(t.label,24),val));
                }
            });
        }

        // ── Paid now / balance due (part payments and pay-later bills) ──
        var payInfo = __thermalPay(doc, grandTotal), qrAmount = grandTotal, qrTitle = 'SCAN & PAY';
        if (payInfo && payInfo.due > 0.009) {
            out=out.concat(_dash(_t('Paid now',24), 'Rs.'+payInfo.paid.toFixed(2)));
            out=out.concat(_bOn()); out=out.concat(_dash(_t('BALANCE DUE',24), 'Rs.'+payInfo.due.toFixed(2))); out=out.concat(_bOff());
            out=out.concat(_dbl());
            qrAmount = payInfo.due; qrTitle = 'SCAN TO PAY BALANCE';
        }

        // ════════════════════════════════════
        //  FOOTER
        // ════════════════════════════════════
        out=out.concat(_nl());
        out=out.concat(_dbl());
        out=out.concat([ESC,0x61,0x01]);   // center
        out=out.concat([GS,0x21,0x10]);    // GS! double height only
        out=out.concat(_bOn());
        out=out.concat(_b('THANK YOU\n'));
        out=out.concat(_bOff());
        out=out.concat([GS,0x21,0x00]);    // normal
        out=out.concat(_b('Beauty is Power, Smile is a Sword\n'));
        out=out.concat(_b('Visit Again! Stay Healthy :)\n'));
        out=out.concat([ESC,0x61,0x00]);   // left
        out=out.concat(_dbl());
        out=out.concat(_nl());

        // ════════════════════════════════════
        //  UPI QR CODE
        // ════════════════════════════════════
        if(qrAmount>0){
            var C=[ESC,0x61,0x01];  // center command bytes
            out=out.concat(C); out=out.concat(_dbl());
            out=out.concat(C); out=out.concat(_bOn()); out=out.concat(_b(qrTitle+'\n')); out=out.concat(_bOff());
            out=out.concat(_nl());
            out=out.concat(C); out=out.concat(_upiQR('8688033072@ybl',qrAmount,'SriSaiDental',4));
            out=out.concat(_nl());
            // CENTER → font → CENTER again → text (double-ensures alignment)
            out=out.concat(C); out=out.concat([ESC,0x21,0x10]); out=out.concat(C); out=out.concat(_bOn());
            out=out.concat(_b('Rs.'+qrAmount.toFixed(2)+'\n'));
            out=out.concat(_bOff()); out=out.concat([ESC,0x21,0x00]); out=out.concat(C);
            out=out.concat(_bOn()); out=out.concat(_b('8688033072@ybl\n')); out=out.concat(_bOff());
            out=out.concat(C); out=out.concat(_b('GPay / PhonePe / Any UPI\n'));
            out=out.concat(C); out=out.concat(_dbl());
        }

        out=out.concat(_aL());
        out=out.concat(_lf(4));
        out=out.concat(_cut());
        return new Uint8Array(out);
    }





    // ── Tiny QR Code renderer for thermal preview ─────────────────────
    // Uses the qrcode-generator library loaded from CDN
    function __renderQRtoDiv(container, text, size) {
        // Try qrcode library if available
        if (typeof qrcode !== 'undefined') {
            try {
                var qr = qrcode(0, 'M');
                qr.addData(text);
                qr.make();
                var img = qr.createImgTag(2, 2);
                container.innerHTML = img;
                var imgEl = container.querySelector('img');
                if (imgEl) {
                    imgEl.style.cssText = 'display:block;margin:0 auto;image-rendering:pixelated;width:'+size+'px;height:'+size+'px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.12);';
                }
                return;
            } catch(e) {}
        }
        // Fallback: canvas-based mini QR using data URL approach
        __renderQRCanvas(container, text, size);
    }

    function __renderQRCanvas(container, text, size) {
        // Simple visual QR placeholder with UPI info styled nicely
        var upiId = text.match(/pa=([^&]+)/);
        var amt   = text.match(/am=([^&]+)/);
        container.innerHTML =
            '<div style="display:inline-block;background:#fff;border:2px solid #000;padding:4px;border-radius:3px;box-shadow:0 1px 4px rgba(0,0,0,0.15);">' +
            '<canvas id="__qrCanvas" width="'+size+'" height="'+size+'"></canvas>' +
            '</div>';
        var canvas = document.getElementById('__qrCanvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        // Draw a realistic-looking QR pattern
        var s = size, m = Math.floor(s/21);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0,0,s,s);
        ctx.fillStyle = '#000';
        // Draw finder patterns (corners)
        function finder(x,y) {
            ctx.fillRect(x*m,y*m,7*m,7*m);
            ctx.fillStyle='#fff';
            ctx.fillRect((x+1)*m,(y+1)*m,5*m,5*m);
            ctx.fillStyle='#000';
            ctx.fillRect((x+2)*m,(y+2)*m,3*m,3*m);
            ctx.fillStyle='#000';
        }
        finder(0,0); finder(14,0); finder(0,14);
        // Timing patterns
        for(var i=8;i<13;i++){
            if(i%2===0){ctx.fillRect(i*m,6*m,m,m);ctx.fillRect(6*m,i*m,m,m);}
        }
        // Random data modules (seeded from text for consistency)
        var seed=0; for(var c=0;c<text.length;c++) seed=(seed*31+text.charCodeAt(c))&0xFFFF;
        function rnd(){seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;}
        for(var row=0;row<21;row++){
            for(var col=0;col<21;col++){
                // Skip finder pattern zones
                if((row<9&&col<9)||(row<9&&col>12)||(row>12&&col<9))continue;
                if(rnd()>0.5){ctx.fillRect(col*m,row*m,m,m);}
            }
        }
    }
;

;/* ══ FILE: vendor/qrcode.min.js ══════════════════════════════════════════════ */
// Copyright (c) 2009 Kazuhiko Arase
var qrcode=function(){var t=function(t,r){var e=t,n=g[r],o=null,i=0,a=null,u=[],f={},c=function(t,r){o=function(t){for(var r=new Array(t),e=0;e<t;e+=1){r[e]=new Array(t);for(var n=0;n<t;n+=1)r[e][n]=null}return r}(i=4*e+17),l(0,0),l(i-7,0),l(0,i-7),s(),h(),d(t,r),e>=7&&v(t),null==a&&(a=p(e,n,u)),w(a,r)},l=function(t,r){for(var e=-1;e<=7;e+=1)if(!(t+e<=-1||i<=t+e))for(var n=-1;n<=7;n+=1)r+n<=-1||i<=r+n||(o[t+e][r+n]=0<=e&&e<=6&&(0==n||6==n)||0<=n&&n<=6&&(0==e||6==e)||2<=e&&e<=4&&2<=n&&n<=4)},h=function(){for(var t=8;t<i-8;t+=1)null==o[t][6]&&(o[t][6]=t%2==0);for(var r=8;r<i-8;r+=1)null==o[6][r]&&(o[6][r]=r%2==0)},s=function(){for(var t=B.getPatternPosition(e),r=0;r<t.length;r+=1)for(var n=0;n<t.length;n+=1){var i=t[r],a=t[n];if(null==o[i][a])for(var u=-2;u<=2;u+=1)for(var f=-2;f<=2;f+=1)o[i+u][a+f]=-2==u||2==u||-2==f||2==f||0==u&&0==f}},v=function(t){for(var r=B.getBCHTypeNumber(e),n=0;n<18;n+=1){var a=!t&&1==(r>>n&1);o[Math.floor(n/3)][n%3+i-8-3]=a}for(n=0;n<18;n+=1){a=!t&&1==(r>>n&1);o[n%3+i-8-3][Math.floor(n/3)]=a}},d=function(t,r){for(var e=n<<3|r,a=B.getBCHTypeInfo(e),u=0;u<15;u+=1){var f=!t&&1==(a>>u&1);u<6?o[u][8]=f:u<8?o[u+1][8]=f:o[i-15+u][8]=f}for(u=0;u<15;u+=1){f=!t&&1==(a>>u&1);u<8?o[8][i-u-1]=f:u<9?o[8][15-u-1+1]=f:o[8][15-u-1]=f}o[i-8][8]=!t},w=function(t,r){for(var e=-1,n=i-1,a=7,u=0,f=B.getMaskFunction(r),c=i-1;c>0;c-=2)for(6==c&&(c-=1);;){for(var g=0;g<2;g+=1)if(null==o[n][c-g]){var l=!1;u<t.length&&(l=1==(t[u]>>>a&1)),f(n,c-g)&&(l=!l),o[n][c-g]=l,-1==(a-=1)&&(u+=1,a=7)}if((n+=e)<0||i<=n){n-=e,e=-e;break}}},p=function(t,r,e){for(var n=A.getRSBlocks(t,r),o=b(),i=0;i<e.length;i+=1){var a=e[i];o.put(a.getMode(),4),o.put(a.getLength(),B.getLengthInBits(a.getMode(),t)),a.write(o)}var u=0;for(i=0;i<n.length;i+=1)u+=n[i].dataCount;if(o.getLengthInBits()>8*u)throw"code length overflow. ("+o.getLengthInBits()+">"+8*u+")";for(o.getLengthInBits()+4<=8*u&&o.put(0,4);o.getLengthInBits()%8!=0;)o.putBit(!1);for(;!(o.getLengthInBits()>=8*u||(o.put(236,8),o.getLengthInBits()>=8*u));)o.put(17,8);return function(t,r){for(var e=0,n=0,o=0,i=new Array(r.length),a=new Array(r.length),u=0;u<r.length;u+=1){var f=r[u].dataCount,c=r[u].totalCount-f;n=Math.max(n,f),o=Math.max(o,c),i[u]=new Array(f);for(var g=0;g<i[u].length;g+=1)i[u][g]=255&t.getBuffer()[g+e];e+=f;var l=B.getErrorCorrectPolynomial(c),h=k(i[u],l.getLength()-1).mod(l);for(a[u]=new Array(l.getLength()-1),g=0;g<a[u].length;g+=1){var s=g+h.getLength()-a[u].length;a[u][g]=s>=0?h.getAt(s):0}}var v=0;for(g=0;g<r.length;g+=1)v+=r[g].totalCount;var d=new Array(v),w=0;for(g=0;g<n;g+=1)for(u=0;u<r.length;u+=1)g<i[u].length&&(d[w]=i[u][g],w+=1);for(g=0;g<o;g+=1)for(u=0;u<r.length;u+=1)g<a[u].length&&(d[w]=a[u][g],w+=1);return d}(o,n)};f.addData=function(t,r){var e=null;switch(r=r||"Byte"){case"Numeric":e=M(t);break;case"Alphanumeric":e=x(t);break;case"Byte":e=m(t);break;case"Kanji":e=L(t);break;default:throw"mode:"+r}u.push(e),a=null},f.isDark=function(t,r){if(t<0||i<=t||r<0||i<=r)throw t+","+r;return o[t][r]},f.getModuleCount=function(){return i},f.make=function(){if(e<1){for(var t=1;t<40;t++){for(var r=A.getRSBlocks(t,n),o=b(),i=0;i<u.length;i++){var a=u[i];o.put(a.getMode(),4),o.put(a.getLength(),B.getLengthInBits(a.getMode(),t)),a.write(o)}var g=0;for(i=0;i<r.length;i++)g+=r[i].dataCount;if(o.getLengthInBits()<=8*g)break}e=t}c(!1,function(){for(var t=0,r=0,e=0;e<8;e+=1){c(!0,e);var n=B.getLostPoint(f);(0==e||t>n)&&(t=n,r=e)}return r}())},f.createTableTag=function(t,r){t=t||2;var e="";e+='<table style="',e+=" border-width: 0px; border-style: none;",e+=" border-collapse: collapse;",e+=" padding: 0px; margin: "+(r=void 0===r?4*t:r)+"px;",e+='">',e+="<tbody>";for(var n=0;n<f.getModuleCount();n+=1){e+="<tr>";for(var o=0;o<f.getModuleCount();o+=1)e+='<td style="',e+=" border-width: 0px; border-style: none;",e+=" border-collapse: collapse;",e+=" padding: 0px; margin: 0px;",e+=" width: "+t+"px;",e+=" height: "+t+"px;",e+=" background-color: ",e+=f.isDark(n,o)?"#000000":"#ffffff",e+=";",e+='"/>';e+="</tr>"}return e+="</tbody>",e+="</table>"},f.createSvgTag=function(t,r,e,n){var o={};"object"==typeof arguments[0]&&(t=(o=arguments[0]).cellSize,r=o.margin,e=o.alt,n=o.title),t=t||2,r=void 0===r?4*t:r,(e="string"==typeof e?{text:e}:e||{}).text=e.text||null,e.id=e.text?e.id||"qrcode-description":null,(n="string"==typeof n?{text:n}:n||{}).text=n.text||null,n.id=n.text?n.id||"qrcode-title":null;var i,a,u,c,g=f.getModuleCount()*t+2*r,l="";for(c="l"+t+",0 0,"+t+" -"+t+",0 0,-"+t+"z ",l+='<svg version="1.1" xmlns="http://www.w3.org/2000/svg"',l+=o.scalable?"":' width="'+g+'px" height="'+g+'px"',l+=' viewBox="0 0 '+g+" "+g+'" ',l+=' preserveAspectRatio="xMinYMin meet"',l+=n.text||e.text?' role="img" aria-labelledby="'+y([n.id,e.id].join(" ").trim())+'"':"",l+=">",l+=n.text?'<title id="'+y(n.id)+'">'+y(n.text)+"</title>":"",l+=e.text?'<description id="'+y(e.id)+'">'+y(e.text)+"</description>":"",l+='<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>',l+='<path d="',a=0;a<f.getModuleCount();a+=1)for(u=a*t+r,i=0;i<f.getModuleCount();i+=1)f.isDark(a,i)&&(l+="M"+(i*t+r)+","+u+c);return l+='" stroke="transparent" fill="black"/>',l+="</svg>"},f.createDataURL=function(t,r){t=t||2,r=void 0===r?4*t:r;var e=f.getModuleCount()*t+2*r,n=r,o=e-r;return I(e,e,function(r,e){if(n<=r&&r<o&&n<=e&&e<o){var i=Math.floor((r-n)/t),a=Math.floor((e-n)/t);return f.isDark(a,i)?0:1}return 1})},f.createImgTag=function(t,r,e){t=t||2,r=void 0===r?4*t:r;var n=f.getModuleCount()*t+2*r,o="";return o+="<img",o+=' src="',o+=f.createDataURL(t,r),o+='"',o+=' width="',o+=n,o+='"',o+=' height="',o+=n,o+='"',e&&(o+=' alt="',o+=y(e),o+='"'),o+="/>"};var y=function(t){for(var r="",e=0;e<t.length;e+=1){var n=t.charAt(e);switch(n){case"<":r+="&lt;";break;case">":r+="&gt;";break;case"&":r+="&amp;";break;case'"':r+="&quot;";break;default:r+=n}}return r};return f.createASCII=function(t,r){if((t=t||1)<2)return function(t){t=void 0===t?2:t;var r,e,n,o,i,a=1*f.getModuleCount()+2*t,u=t,c=a-t,g={"██":"█","█ ":"▀"," █":"▄","  ":" "},l={"██":"▀","█ ":"▀"," █":" ","  ":" "},h="";for(r=0;r<a;r+=2){for(n=Math.floor((r-u)/1),o=Math.floor((r+1-u)/1),e=0;e<a;e+=1)i="█",u<=e&&e<c&&u<=r&&r<c&&f.isDark(n,Math.floor((e-u)/1))&&(i=" "),u<=e&&e<c&&u<=r+1&&r+1<c&&f.isDark(o,Math.floor((e-u)/1))?i+=" ":i+="█",h+=t<1&&r+1>=c?l[i]:g[i];h+="\n"}return a%2&&t>0?h.substring(0,h.length-a-1)+Array(a+1).join("▀"):h.substring(0,h.length-1)}(r);t-=1,r=void 0===r?2*t:r;var e,n,o,i,a=f.getModuleCount()*t+2*r,u=r,c=a-r,g=Array(t+1).join("██"),l=Array(t+1).join("  "),h="",s="";for(e=0;e<a;e+=1){for(o=Math.floor((e-u)/t),s="",n=0;n<a;n+=1)i=1,u<=n&&n<c&&u<=e&&e<c&&f.isDark(o,Math.floor((n-u)/t))&&(i=0),s+=i?g:l;for(o=0;o<t;o+=1)h+=s+"\n"}return h.substring(0,h.length-1)},f.renderTo2dContext=function(t,r){r=r||2;for(var e=f.getModuleCount(),n=0;n<e;n++)for(var o=0;o<e;o++)t.fillStyle=f.isDark(n,o)?"black":"white",t.fillRect(n*r,o*r,r,r)},f};t.stringToBytes=(t.stringToBytesFuncs={default:function(t){for(var r=[],e=0;e<t.length;e+=1){var n=t.charCodeAt(e);r.push(255&n)}return r}}).default,t.createStringToBytes=function(t,r){var e=function(){for(var e=S(t),n=function(){var t=e.read();if(-1==t)throw"eof";return t},o=0,i={};;){var a=e.read();if(-1==a)break;var u=n(),f=n()<<8|n();i[String.fromCharCode(a<<8|u)]=f,o+=1}if(o!=r)throw o+" != "+r;return i}(),n="?".charCodeAt(0);return function(t){for(var r=[],o=0;o<t.length;o+=1){var i=t.charCodeAt(o);if(i<128)r.push(i);else{var a=e[t.charAt(o)];"number"==typeof a?(255&a)==a?r.push(a):(r.push(a>>>8),r.push(255&a)):r.push(n)}}return r}};var r,e,n,o,i,a=1,u=2,f=4,c=8,g={L:1,M:0,Q:3,H:2},l=0,h=1,s=2,v=3,d=4,w=5,p=6,y=7,B=(r=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]],e=1335,n=7973,i=function(t){for(var r=0;0!=t;)r+=1,t>>>=1;return r},(o={}).getBCHTypeInfo=function(t){for(var r=t<<10;i(r)-i(e)>=0;)r^=e<<i(r)-i(e);return 21522^(t<<10|r)},o.getBCHTypeNumber=function(t){for(var r=t<<12;i(r)-i(n)>=0;)r^=n<<i(r)-i(n);return t<<12|r},o.getPatternPosition=function(t){return r[t-1]},o.getMaskFunction=function(t){switch(t){case l:return function(t,r){return(t+r)%2==0};case h:return function(t,r){return t%2==0};case s:return function(t,r){return r%3==0};case v:return function(t,r){return(t+r)%3==0};case d:return function(t,r){return(Math.floor(t/2)+Math.floor(r/3))%2==0};case w:return function(t,r){return t*r%2+t*r%3==0};case p:return function(t,r){return(t*r%2+t*r%3)%2==0};case y:return function(t,r){return(t*r%3+(t+r)%2)%2==0};default:throw"bad maskPattern:"+t}},o.getErrorCorrectPolynomial=function(t){for(var r=k([1],0),e=0;e<t;e+=1)r=r.multiply(k([1,C.gexp(e)],0));return r},o.getLengthInBits=function(t,r){if(1<=r&&r<10)switch(t){case a:return 10;case u:return 9;case f:case c:return 8;default:throw"mode:"+t}else if(r<27)switch(t){case a:return 12;case u:return 11;case f:return 16;case c:return 10;default:throw"mode:"+t}else{if(!(r<41))throw"type:"+r;switch(t){case a:return 14;case u:return 13;case f:return 16;case c:return 12;default:throw"mode:"+t}}},o.getLostPoint=function(t){for(var r=t.getModuleCount(),e=0,n=0;n<r;n+=1)for(var o=0;o<r;o+=1){for(var i=0,a=t.isDark(n,o),u=-1;u<=1;u+=1)if(!(n+u<0||r<=n+u))for(var f=-1;f<=1;f+=1)o+f<0||r<=o+f||0==u&&0==f||a==t.isDark(n+u,o+f)&&(i+=1);i>5&&(e+=3+i-5)}for(n=0;n<r-1;n+=1)for(o=0;o<r-1;o+=1){var c=0;t.isDark(n,o)&&(c+=1),t.isDark(n+1,o)&&(c+=1),t.isDark(n,o+1)&&(c+=1),t.isDark(n+1,o+1)&&(c+=1),0!=c&&4!=c||(e+=3)}for(n=0;n<r;n+=1)for(o=0;o<r-6;o+=1)t.isDark(n,o)&&!t.isDark(n,o+1)&&t.isDark(n,o+2)&&t.isDark(n,o+3)&&t.isDark(n,o+4)&&!t.isDark(n,o+5)&&t.isDark(n,o+6)&&(e+=40);for(o=0;o<r;o+=1)for(n=0;n<r-6;n+=1)t.isDark(n,o)&&!t.isDark(n+1,o)&&t.isDark(n+2,o)&&t.isDark(n+3,o)&&t.isDark(n+4,o)&&!t.isDark(n+5,o)&&t.isDark(n+6,o)&&(e+=40);var g=0;for(o=0;o<r;o+=1)for(n=0;n<r;n+=1)t.isDark(n,o)&&(g+=1);return e+=Math.abs(100*g/r/r-50)/5*10},o),C=function(){for(var t=new Array(256),r=new Array(256),e=0;e<8;e+=1)t[e]=1<<e;for(e=8;e<256;e+=1)t[e]=t[e-4]^t[e-5]^t[e-6]^t[e-8];for(e=0;e<255;e+=1)r[t[e]]=e;var n={glog:function(t){if(t<1)throw"glog("+t+")";return r[t]},gexp:function(r){for(;r<0;)r+=255;for(;r>=256;)r-=255;return t[r]}};return n}();function k(t,r){if(void 0===t.length)throw t.length+"/"+r;var e=function(){for(var e=0;e<t.length&&0==t[e];)e+=1;for(var n=new Array(t.length-e+r),o=0;o<t.length-e;o+=1)n[o]=t[o+e];return n}(),n={getAt:function(t){return e[t]},getLength:function(){return e.length},multiply:function(t){for(var r=new Array(n.getLength()+t.getLength()-1),e=0;e<n.getLength();e+=1)for(var o=0;o<t.getLength();o+=1)r[e+o]^=C.gexp(C.glog(n.getAt(e))+C.glog(t.getAt(o)));return k(r,0)},mod:function(t){if(n.getLength()-t.getLength()<0)return n;for(var r=C.glog(n.getAt(0))-C.glog(t.getAt(0)),e=new Array(n.getLength()),o=0;o<n.getLength();o+=1)e[o]=n.getAt(o);for(o=0;o<t.getLength();o+=1)e[o]^=C.gexp(C.glog(t.getAt(o))+r);return k(e,0).mod(t)}};return n}var A=function(){var t=[[1,26,19],[1,26,16],[1,26,13],[1,26,9],[1,44,34],[1,44,28],[1,44,22],[1,44,16],[1,70,55],[1,70,44],[2,35,17],[2,35,13],[1,100,80],[2,50,32],[2,50,24],[4,25,9],[1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],[2,86,68],[4,43,27],[4,43,19],[4,43,15],[2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],[2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],[2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],[2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],[4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],[2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15],[4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12],[3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13],[5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12,7,37,13],[5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16],[1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15],[5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15],[3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14],[3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16],[4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17],[2,139,111,7,140,112],[17,74,46],[7,54,24,16,55,25],[34,37,13],[4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16],[6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17],[8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16],[10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17],[8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16],[3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16],[7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16],[5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16],[13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16],[17,145,115],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16],[17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16],[13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17],[12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16],[6,151,121,14,152,122],[6,75,47,34,76,48],[46,54,24,10,55,25],[2,45,15,64,46,16],[17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16],[4,152,122,18,153,123],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16],[20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16],[19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]],r=function(t,r){var e={};return e.totalCount=t,e.dataCount=r,e},e={};return e.getRSBlocks=function(e,n){var o=function(r,e){switch(e){case g.L:return t[4*(r-1)+0];case g.M:return t[4*(r-1)+1];case g.Q:return t[4*(r-1)+2];case g.H:return t[4*(r-1)+3];default:return}}(e,n);if(void 0===o)throw"bad rs block @ typeNumber:"+e+"/errorCorrectionLevel:"+n;for(var i=o.length/3,a=[],u=0;u<i;u+=1)for(var f=o[3*u+0],c=o[3*u+1],l=o[3*u+2],h=0;h<f;h+=1)a.push(r(c,l));return a},e}(),b=function(){var t=[],r=0,e={getBuffer:function(){return t},getAt:function(r){var e=Math.floor(r/8);return 1==(t[e]>>>7-r%8&1)},put:function(t,r){for(var n=0;n<r;n+=1)e.putBit(1==(t>>>r-n-1&1))},getLengthInBits:function(){return r},putBit:function(e){var n=Math.floor(r/8);t.length<=n&&t.push(0),e&&(t[n]|=128>>>r%8),r+=1}};return e},M=function(t){var r=a,e=t,n={getMode:function(){return r},getLength:function(t){return e.length},write:function(t){for(var r=e,n=0;n+2<r.length;)t.put(o(r.substring(n,n+3)),10),n+=3;n<r.length&&(r.length-n==1?t.put(o(r.substring(n,n+1)),4):r.length-n==2&&t.put(o(r.substring(n,n+2)),7))}},o=function(t){for(var r=0,e=0;e<t.length;e+=1)r=10*r+i(t.charAt(e));return r},i=function(t){if("0"<=t&&t<="9")return t.charCodeAt(0)-"0".charCodeAt(0);throw"illegal char :"+t};return n},x=function(t){var r=u,e=t,n={getMode:function(){return r},getLength:function(t){return e.length},write:function(t){for(var r=e,n=0;n+1<r.length;)t.put(45*o(r.charAt(n))+o(r.charAt(n+1)),11),n+=2;n<r.length&&t.put(o(r.charAt(n)),6)}},o=function(t){if("0"<=t&&t<="9")return t.charCodeAt(0)-"0".charCodeAt(0);if("A"<=t&&t<="Z")return t.charCodeAt(0)-"A".charCodeAt(0)+10;switch(t){case" ":return 36;case"$":return 37;case"%":return 38;case"*":return 39;case"+":return 40;case"-":return 41;case".":return 42;case"/":return 43;case":":return 44;default:throw"illegal char :"+t}};return n},m=function(r){var e=f,n=t.stringToBytes(r),o={getMode:function(){return e},getLength:function(t){return n.length},write:function(t){for(var r=0;r<n.length;r+=1)t.put(n[r],8)}};return o},L=function(r){var e=c,n=t.stringToBytesFuncs.SJIS;if(!n)throw"sjis not supported.";!function(){var t=n("友");if(2!=t.length||38726!=(t[0]<<8|t[1]))throw"sjis not supported."}();var o=n(r),i={getMode:function(){return e},getLength:function(t){return~~(o.length/2)},write:function(t){for(var r=o,e=0;e+1<r.length;){var n=(255&r[e])<<8|255&r[e+1];if(33088<=n&&n<=40956)n-=33088;else{if(!(57408<=n&&n<=60351))throw"illegal char at "+(e+1)+"/"+n;n-=49472}n=192*(n>>>8&255)+(255&n),t.put(n,13),e+=2}if(e<r.length)throw"illegal char at "+(e+1)}};return i},D=function(){var t=[],r={writeByte:function(r){t.push(255&r)},writeShort:function(t){r.writeByte(t),r.writeByte(t>>>8)},writeBytes:function(t,e,n){e=e||0,n=n||t.length;for(var o=0;o<n;o+=1)r.writeByte(t[o+e])},writeString:function(t){for(var e=0;e<t.length;e+=1)r.writeByte(t.charCodeAt(e))},toByteArray:function(){return t},toString:function(){var r="";r+="[";for(var e=0;e<t.length;e+=1)e>0&&(r+=","),r+=t[e];return r+="]"}};return r},S=function(t){var r=t,e=0,n=0,o=0,i={read:function(){for(;o<8;){if(e>=r.length){if(0==o)return-1;throw"unexpected end of file./"+o}var t=r.charAt(e);if(e+=1,"="==t)return o=0,-1;t.match(/^\s$/)||(n=n<<6|a(t.charCodeAt(0)),o+=6)}var i=n>>>o-8&255;return o-=8,i}},a=function(t){if(65<=t&&t<=90)return t-65;if(97<=t&&t<=122)return t-97+26;if(48<=t&&t<=57)return t-48+52;if(43==t)return 62;if(47==t)return 63;throw"c:"+t};return i},I=function(t,r,e){for(var n=function(t,r){var e=t,n=r,o=new Array(t*r),i={setPixel:function(t,r,n){o[r*e+t]=n},write:function(t){t.writeString("GIF87a"),t.writeShort(e),t.writeShort(n),t.writeByte(128),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(255),t.writeByte(255),t.writeByte(255),t.writeString(","),t.writeShort(0),t.writeShort(0),t.writeShort(e),t.writeShort(n),t.writeByte(0);var r=a(2);t.writeByte(2);for(var o=0;r.length-o>255;)t.writeByte(255),t.writeBytes(r,o,255),o+=255;t.writeByte(r.length-o),t.writeBytes(r,o,r.length-o),t.writeByte(0),t.writeString(";")}},a=function(t){for(var r=1<<t,e=1+(1<<t),n=t+1,i=u(),a=0;a<r;a+=1)i.add(String.fromCharCode(a));i.add(String.fromCharCode(r)),i.add(String.fromCharCode(e));var f,c,g,l=D(),h=(f=l,c=0,g=0,{write:function(t,r){if(t>>>r!=0)throw"length over";for(;c+r>=8;)f.writeByte(255&(t<<c|g)),r-=8-c,t>>>=8-c,g=0,c=0;g|=t<<c,c+=r},flush:function(){c>0&&f.writeByte(g)}});h.write(r,n);var s=0,v=String.fromCharCode(o[s]);for(s+=1;s<o.length;){var d=String.fromCharCode(o[s]);s+=1,i.contains(v+d)?v+=d:(h.write(i.indexOf(v),n),i.size()<4095&&(i.size()==1<<n&&(n+=1),i.add(v+d)),v=d)}return h.write(i.indexOf(v),n),h.write(e,n),h.flush(),l.toByteArray()},u=function(){var t={},r=0,e={add:function(n){if(e.contains(n))throw"dup key:"+n;t[n]=r,r+=1},size:function(){return r},indexOf:function(r){return t[r]},contains:function(r){return void 0!==t[r]}};return e};return i}(t,r),o=0;o<r;o+=1)for(var i=0;i<t;i+=1)n.setPixel(i,o,e(i,o));var a=D();n.write(a);for(var u=function(){var t=0,r=0,e=0,n="",o={},i=function(t){n+=String.fromCharCode(a(63&t))},a=function(t){if(t<0);else{if(t<26)return 65+t;if(t<52)return t-26+97;if(t<62)return t-52+48;if(62==t)return 43;if(63==t)return 47}throw"n:"+t};return o.writeByte=function(n){for(t=t<<8|255&n,r+=8,e+=1;r>=6;)i(t>>>r-6),r-=6},o.flush=function(){if(r>0&&(i(t<<6-r),t=0,r=0),e%3!=0)for(var o=3-e%3,a=0;a<o;a+=1)n+="="},o.toString=function(){return n},o}(),f=a.toByteArray(),c=0;c<f.length;c+=1)u.writeByte(f[c]);return u.flush(),"data:image/gif;base64,"+u};return t}();qrcode.stringToBytesFuncs["UTF-8"]=function(t){return function(t){for(var r=[],e=0;e<t.length;e++){var n=t.charCodeAt(e);n<128?r.push(n):n<2048?r.push(192|n>>6,128|63&n):n<55296||n>=57344?r.push(224|n>>12,128|n>>6&63,128|63&n):(e++,n=65536+((1023&n)<<10|1023&t.charCodeAt(e)),r.push(240|n>>18,128|n>>12&63,128|n>>6&63,128|63&n))}return r}(t)},function(t){"function"==typeof define&&define.amd?define([],t):"object"==typeof exports&&(module.exports=t())}(function(){return qrcode});
;

;/* ══ FILE: 10-bt-print-qr.js ══════════════════════════════════════════════ */
/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    // ── Write bytes to BT printer in chunks ──────────────────
    async function _btWriteBytes(data) {
        var char = window._btPrinter.characteristic;
        if (!char) throw new Error('Printer not connected');
        var CHUNK = 100;
        for (var i = 0; i < data.length; i += CHUNK) {
            var chunk = data.slice(i, i + CHUNK);
            if (char.properties.writeWithoutResponse) {
                await char.writeValueWithoutResponse(chunk);
            } else {
                await char.writeValue(chunk);
            }
            await new Promise(function(r){ setTimeout(r, 20); });
        }
    }

    async function _doThermalPrint(html) {
        if (!window._btPrinter.connected || !window._btPrinter.characteristic) {
            showToast('❌ No printer connected. Tap 🖨️ in sidebar to connect.', 'error');
            return;
        }
        showToast('🖨️ Sending to thermal printer...', 'info');
        try {
            var bytes = _buildThermalBytes(html);
            await _btWriteBytes(bytes);
            showToast('✅ Printed successfully on thermal printer!', 'success');
        } catch(err) {
            if (err.name === 'NetworkError' || err.message.includes('GATT')) {
                window._btPrinter.connected = false;
                window._btPrinter.characteristic = null;
                _btUpdateUI();
                showToast('❌ Printer disconnected. Please reconnect.', 'error');
            } else {
                showToast('❌ Print failed: ' + err.message, 'error');
            }
        }
    }

    async function btTestPrint() {
        if (!window._btPrinter.connected) { showToast('No printer connected','warning'); return; }
        var dt = new Date().toLocaleDateString('en-IN', {day:'2-digit',month:'2-digit',year:'numeric'});
        var testHtml = '<div>Patient: Test Patient</div>' +
            '<div>Date: ' + dt + '</div>' +
            '<div>Doctor: Dr. T Venkat Rao</div>' +
            '<table>' +
            '<tr><th>Item</th><th>Qty</th><th>Amount</th></tr>' +
            '<tr><td>Test Medicine</td><td>2</td><td>Rs.120</td></tr>' +
            '<tr><td>Consultation</td><td>1</td><td>Rs.300</td></tr>' +
            '<tr><td>Subtotal</td><td></td><td>Rs.420</td></tr>' +
            '<tr><td>Grand Total</td><td></td><td>Rs.420</td></tr>' +
            '</table>';
        await _doThermalPrint(testHtml);
    }

    async function btWidthTest() {
        if (!window._btPrinter.connected) { showToast('No printer connected','warning'); return; }
        showToast('📏 Printing calibration test...', 'info');
        try {
            var out = [];
            out = out.concat(_init());
            out = out.concat([ESC,0x4D,0x00]);   // Font A
            out = out.concat([ESC,0x21,0x00]);   // Normal size
            out = out.concat(_gap(24));

            // ── SECTION 1: Width test ───────────────────────
            out = out.concat(_aC());
            out = out.concat(_bOn());
            out = out.concat(_b('** WIDTH CALIBRATION **\n'));
            out = out.concat(_bOff());
            out = out.concat(_aL());
            out = out.concat(_b('\n'));
            out = out.concat(_b('123456789012345678901234567890123456789012345678\n'));
            out = out.concat(_b('----10----20----30----40----50----\n'));
            out = out.concat(_b('Count digits LINE 1 → set width\n'));
            out = out.concat(_b('48=OK  42=set42  32=set32\n'));
            out = out.concat(_b('Current: _W='+_W+' chars\n'));
            out = out.concat(_b('--------------------------------\n'));

            // ── SECTION 2: Font size test ─────────────────────
            out = out.concat(_aC());
            out = out.concat(_bOn());
            out = out.concat(_b('** FONT SIZE TEST **\n'));
            out = out.concat(_bOff());
            out = out.concat(_aL());
            out = out.concat(_b('\n'));

            // Normal
            out = out.concat([ESC,0x21,0x00]);
            out = out.concat(_b('1. NORMAL (ESC!0x00)\n'));

            // Bold only
            out = out.concat([ESC,0x45,0x01]);
            out = out.concat(_b('2. BOLD   (ESC 45 01)\n'));
            out = out.concat([ESC,0x45,0x00]);

            // Double height
            out = out.concat([ESC,0x21,0x10]);
            out = out.concat(_b('3. DBL-H  (ESC!0x10)\n'));
            out = out.concat([ESC,0x21,0x00]);

            // Double width
            out = out.concat([ESC,0x21,0x20]);
            out = out.concat(_b('4.DBL-W  (ESC!0x20)\n'));
            out = out.concat([ESC,0x21,0x00]);

            // Double height + width
            out = out.concat([ESC,0x21,0x30]);
            out = out.concat(_b('5.BIG\n'));
            out = out.concat([ESC,0x21,0x00]);

            // GS ! method (alternative)
            out = out.concat([GS,0x21,0x11]);
            out = out.concat(_b('6.GS! BIG\n'));
            out = out.concat([GS,0x21,0x00]);

            out = out.concat(_b('\n'));
            out = out.concat(_b('Check: are sizes 1-6 different?\n'));
            out = out.concat(_b('YES=ESC/POS OK  NO=firmware issue\n'));
            out = out.concat(_b('--------------------------------\n'));

            // ── SECTION 3: Font A vs B ──────────────────────
            out = out.concat([ESC,0x21,0x00]);
            out = out.concat([ESC,0x4D,0x00]);
            out = out.concat(_b('Font A: ABCDEFGHIJ1234567890ab\n'));
            out = out.concat([ESC,0x4D,0x01]);
            out = out.concat(_b('Font B: ABCDEFGHIJ1234567890ab\n'));
            out = out.concat([ESC,0x4D,0x00]);
            out = out.concat(_b('--------------------------------\n'));

            out = out.concat([LF,LF,LF]);
            out = out.concat(_cut());
            await _btWriteBytes(new Uint8Array(out));
            showToast('✅ Test printed! Check font sizes 1-6.', 'success');
        } catch(err) {
            showToast('❌ Test failed: ' + err.message, 'error');
        }
    }

    function savePrinterWidth(val) {
        _W = val;
        localStorage.setItem('thermal_printer_width', String(val));
        // Update display
        var disp = document.getElementById('__currentWidthDisplay');
        if (disp) disp.textContent = val;
        // Highlight selected radio label
        [32,42,48].forEach(function(w){
            var lbl = document.getElementById('__wLabel'+w);
            if (lbl) lbl.style.borderColor = (w===val) ? '#e67e22' : '#ddd';
            if (lbl) lbl.style.background  = (w===val) ? '#fff8e1' : '#fff';
        });
        var msg = document.getElementById('__widthSavedMsg');
        var valEl = document.getElementById('__widthSavedVal');
        if (msg) msg.style.display = 'block';
        if (valEl) valEl.textContent = val;
        showToast('✅ Printer width set to ' + val + ' chars!', 'success');
        setTimeout(function(){ if(msg) msg.style.display='none'; }, 3000);
    }

    function btPrintPending() {
        if (__pendingPrintHtml) {
            closeBtPrinterPanel();
            setTimeout(function(){ _doThermalPrint(__pendingPrintHtml); }, 400);
        }
    }

    // Init on load
    document.addEventListener('DOMContentLoaded', function(){
        _btUpdateUI();
        // Update print choice BT button on open
        document.getElementById('__printChoiceDlg').addEventListener('click', function(e){
            if(e.target === this) __closePrintChoice();
        });
        // Load saved template previews in cards
        _refreshAllTmplPreviews();
        // Init printer width from saved value — set radio + highlight
        var savedW = parseInt(localStorage.getItem('thermal_printer_width') || '48');
        _W = savedW;
        var disp = document.getElementById('__currentWidthDisplay');
        if (disp) disp.textContent = savedW;
        [32,42,48].forEach(function(w){
            var lbl = document.getElementById('__wLabel'+w);
            var radio = lbl ? lbl.querySelector('input[type=radio]') : null;
            if (radio) radio.checked = (w === savedW);
            if (lbl) {
                lbl.style.borderColor = (w===savedW) ? '#e67e22' : '#ddd';
                lbl.style.background  = (w===savedW) ? '#fff8e1' : '#fff';
            }
        });
    });
;

;/* ══ FILE: 11-wa-templates.js ══════════════════════════════════════════════ */
/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    // ── WA Template Editor ──────────────────────────────────────────────
    var _waTmplEditKey = null;

    var _waTmplDefaults = {
        reminder24:
            '🦷 *Sri Sai Speciality Dental Care*\n\n' +
            'Hello *{name}*! 😊\n\n' +
            '⏰ *Appointment Reminder – Tomorrow*\n\n' +
            '🕐 *Time:* {time}\n' +
            '🦷 *Treatment:* {reason}\n' +
            '👨‍⚕️ *Doctor:* {doctor}\n\n' +
            'Please arrive *5 minutes early*.\n' +
            'Reply *YES* to confirm or call us to reschedule.\n\n' +
            '📞 *8688033072 | 9396522492*\n' +
            '_Sri Sai Speciality Dental Care_ 🙏',

        reminder1h:
            '🦷 *Sri Sai Speciality Dental Care*\n\n' +
            'Hello *{name}*! 😊\n\n' +
            '🔔 *Your appointment is in 1 HOUR!*\n\n' +
            '🕐 *Time:* {time}\n' +
            '🦷 *Treatment:* {reason}\n' +
            '👨‍⚕️ *Doctor:* {doctor}\n\n' +
            'Please start heading now. 🚗\n\n' +
            '📞 *8688033072 | 9396522492*\n' +
            '_See you soon!_ 😊',

        reschedule:
            '🦷 *Sri Sai Speciality Dental Care*\n\n' +
            'Hello *{name}*! 🙏\n\n' +
            '⚠️ *Important Notice*\n\n' +
            'We regret that *Dr. {doctor}* is *unavailable today*\n' +
            'for your *{time}* appointment.\n\n' +
            'We sincerely apologize for the inconvenience.\n\n' +
            'Please call us to reschedule:\n' +
            '📞 *8688033072 | 9396522492*\n\n' +
            'Thank you for your understanding. 🙏\n' +
            '_Sri Sai Speciality Dental Care_',

        confirm:
            '🦷 *Sri Sai Speciality Dental Care*\n\n' +
            'Hello *{name}*! 😊\n\n' +
            '✅ *Appointment Confirmed!*\n\n' +
            '📅 *Date:* {date}\n' +
            '🕐 *Time:* {time}\n' +
            '👨‍⚕️ *Doctor:* {doctor}\n\n' +
            'Please arrive 5 minutes early.\n' +
            'We look forward to seeing you!\n\n' +
            '📞 *8688033072 | 9396522492*\n' +
            '_Sri Sai Speciality Dental Care_ 🦷',

        payment:
            '🦷 *Sri Sai Speciality Dental Care*\n\n' +
            'Hello *{name}*! 🙏\n\n' +
            '💰 *Payment Reminder*\n\n' +
            'You have an outstanding balance.\n' +
            'Kindly settle before your next visit.\n\n' +
            '📞 *8688033072 | 9396522492*\n' +
            'Thank you! 😊',

        followup:
            '🦷 *Sri Sai Speciality Dental Care*\n\n' +
            'Hello *{name}*! 😊\n\n' +
            '💙 *Follow-up Check*\n\n' +
            'Hope you are recovering well after your treatment.\n\n' +
            'Call us for any concerns.\n\n' +
            '📞 *8688033072 | 9396522492*\n' +
            '_We care about your smile!_ 🦷',

        patReschedule:
            '🦷 *Sri Sai Speciality Dental Care*\n\n' +
            'Hello *{name}*! 😊\n\n' +
            '📅 *Reschedule Confirmed!*\n\n' +
            'We have received your reschedule request.\n' +
            'Your new appointment is confirmed:\n\n' +
            '📅 *Date:* {date}\n' +
            '🕐 *Time:* {time}\n' +
            '👨‍⚕️ *Doctor:* {doctor}\n\n' +
            'Please arrive 5 minutes early.\n' +
            'We look forward to seeing you! 😊\n\n' +
            '📞 *8688033072 | 9396522492*\n' +
            '_Sri Sai Speciality Dental Care_ 🦷'
    };

    var _waTmplLabels = {
        reminder24: '⏰ 24-Hour Reminder',
        reminder1h: '🔔 1-Hour Reminder',
        reschedule: '🔄 Doctor Unavailable — Reschedule',
        confirm:    '✅ Booking Confirmation',
        payment:    '💰 Payment Due',
        followup:   '💙 Follow-up',
        patReschedule: '📅 Patient Reschedule — Confirmed'
    };

    // ── Template Storage: localStorage (fast) + Google Sheets (cross-device sync) ──
    function _getCustomTmpl(key) {
        try { return localStorage.getItem('wa_custom_tmpl_' + key) || null; } catch(e) { return null; }
    }
    function _setCustomTmpl(key, val) {
        try { localStorage.setItem('wa_custom_tmpl_' + key, val); } catch(e) {}
        // Sync all templates to Sheets so every device gets them
        _syncTmplsToSheets();
    }
    function _delCustomTmpl(key) {
        try { localStorage.removeItem('wa_custom_tmpl_' + key); } catch(e) {}
        _syncTmplsToSheets();
    }
    function _getEffectiveTmpl(key) {
        return _getCustomTmpl(key) || _waTmplDefaults[key] || '';
    }

    // Save all custom templates as one JSON blob to Google Sheets Settings sheet
    function _syncTmplsToSheets() {
        if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
        var allTmpls = {};
        Object.keys(_waTmplDefaults).forEach(function(key) {
            var v = _getCustomTmpl(key);
            if (v) allTmpls[key] = v;
        });
        var p = new URLSearchParams();
        p.append('action', 'saveSettings');
        p.append('settingKey', 'wa_templates');
        p.append('settingValue', JSON.stringify(allTmpls));
        fetch(CONFIG.apiUrl + '?' + p.toString(), { method: 'GET', redirect: 'follow' })
            .catch(function(){});
    }

    // Load templates from Sheets on startup — overwrites localStorage cache
    function _loadTmplsFromSheets() {
        if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
        var p = new URLSearchParams();
        p.append('action', 'getSettings');
        p.append('settingKey', 'wa_templates');
        fetch(CONFIG.apiUrl + '?' + p.toString(), { method: 'GET', redirect: 'follow' })
            .then(function(r){ return r.json(); })
            .then(function(res){
                if (!res.success || !res.value) return;
                try {
                    var tmpls = JSON.parse(res.value);
                    var changed = false;
                    Object.keys(tmpls).forEach(function(key) {
                        if (tmpls[key] && tmpls[key] !== (_getCustomTmpl(key)||'')) {
                            try { localStorage.setItem('wa_custom_tmpl_' + key, tmpls[key]); } catch(e) {}
                            changed = true;
                        }
                    });
                    if (changed) {
                        _refreshAllTmplPreviews();
                        showToast('📋 Message templates synced from cloud', 'success');
                        // Refresh the Quick Send preview if it's visible
                        if (typeof refreshWaMsg === 'function') setTimeout(refreshWaMsg, 50);
                    }
                } catch(e) {}
            })
            .catch(function(){});
    }

    function openWaTmplEdit(key) {
        _waTmplEditKey = key;
        var modal = document.getElementById('waTmplEditModal');
        document.getElementById('waTmplEditText').value = _getEffectiveTmpl(key);
        modal.style.display = 'flex';
        var hasCustom = !!_getCustomTmpl(key);
        document.getElementById('waTmplEditName').innerHTML =
            (_waTmplLabels[key] || key) +
            (hasCustom ? ' <span style="font-size:10px;background:#e8f5e9;color:#27ae60;border-radius:4px;padding:1px 6px;margin-left:6px;">✔ Custom saved</span>' : '');
    }

    function closeWaTmplEdit() {
        document.getElementById('waTmplEditModal').style.display = 'none';
        _waTmplEditKey = null;
    }

    function saveWaTmplEdit() {
        if (!_waTmplEditKey) return;
        var val = document.getElementById('waTmplEditText').value.trim();
        if (!val) { showToast('Template cannot be empty', 'warning'); return; }
        _setCustomTmpl(_waTmplEditKey, val);
        _refreshAllTmplPreviews();
        showToast('✅ Template saved & syncing to all devices...', 'success');
        closeWaTmplEdit();
    }

    function resetWaTmplEdit() {
        if (!_waTmplEditKey) return;
        if (!confirm('Reset "' + (_waTmplLabels[_waTmplEditKey]||_waTmplEditKey) + '" to default?')) return;
        _delCustomTmpl(_waTmplEditKey);
        document.getElementById('waTmplEditText').value = _waTmplDefaults[_waTmplEditKey] || '';
        document.getElementById('waTmplEditName').innerHTML = _waTmplLabels[_waTmplEditKey] || _waTmplEditKey;
        showToast('↩ Reset to default & syncing...', 'info');
    }

    // Close modal on backdrop click
    document.getElementById('waTmplEditModal').addEventListener('click', function(e) {
        if (e.target === this) closeWaTmplEdit();
    });

    function _refreshAllTmplPreviews() {
        Object.keys(_waTmplDefaults).forEach(function(key) {
            var el = document.getElementById('tmplPreview_' + key);
            if (!el) return;
            var custom = _getCustomTmpl(key);
            if (custom) {
                // Show custom text as plain text with line breaks
                el.innerHTML = custom.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
                el.style.borderTop = '1px dashed #27ae60';
                el.style.paddingTop = '6px';
                el.style.marginTop = '4px';
            }
        });
    }

    // ── Custom template helpers are now built into refreshWaMsg, buildApptMsg, buildWabpMsg ──
    // No override needed — those functions check _getCustomTmpl() directly.
;

;/* ══ FILE: 12-admin.js ══════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════
   12-admin.js — v3 screens
   • Change password (forced on first login with a temporary password)
   • Sync Centre: every unsynced transaction with its status + retry
   • Owner Settings: users, billing rules, backups, audit log, data check
   • Inventory: edit medicine, batches (FEFO order), stock adjustments,
     stock movement history
   ════════════════════════════════════════════════════════════════════ */

// ── generic dialog ─────────────────────────────────────────────────
function ssdcDialog(title, bodyHtml, opts) {
    opts = opts || {};
    closeSsdcDialog();
    var ov = document.createElement('div');
    ov.id = 'ssdcDialog';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', title);
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,30,45,.55);z-index:100001;display:flex;align-items:center;justify-content:center;padding:14px;';
    ov.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:' + (opts.width || 560) + 'px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.25);">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #eef1f5;position:sticky;top:0;background:#fff;">'
        + '<h3 style="margin:0;color:#1e3f5a;font-size:17px;">' + title + '</h3>'
        + (opts.locked ? '' : '<button type="button" data-onclick="closeSsdcDialog()" aria-label="Close" style="border:none;background:#f0f3f7;border-radius:8px;width:34px;height:34px;font-size:18px;cursor:pointer;">✕</button>')
        + '</div><div style="padding:16px 18px;" id="ssdcDialogBody">' + bodyHtml + '</div></div>';
    if (!opts.locked) ov.addEventListener('click', function (e) { if (e.target === ov) closeSsdcDialog(); });
    document.body.appendChild(ov);
    var first = ov.querySelector('input,select,textarea,button'); if (first) first.focus();   // immediately: a delayed focus could steal typing
    return ov;
}
function closeSsdcDialog() { var d = document.getElementById('ssdcDialog'); if (d) d.remove(); }
var _fld = 'width:100%;padding:10px 12px;border:1.5px solid #d5dce6;border-radius:8px;font-size:15px;margin:4px 0 12px;box-sizing:border-box;';
var _btn = 'padding:11px 18px;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;';
function _v(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }
function _msg(id, text, ok) { var e = document.getElementById(id); if (e) { e.textContent = text; e.style.color = ok ? '#1e8449' : '#c0392b'; } }

// ── change password ────────────────────────────────────────────────
function openChangePassword(forced) {
    if (document.getElementById('cpOld')) return;      // already open — never wipe what the user is typing
    ssdcDialog(forced ? '🔑 Set your own password' : '🔑 Change password',
        (forced ? '<p style="background:#fff8e1;border-radius:8px;padding:10px 12px;font-size:14px;color:#7a5b00;margin:0 0 12px;">You logged in with a temporary password. Choose your own password to continue.</p>' : '')
        + '<label for="cpOld">Current password</label><input id="cpOld" type="password" autocomplete="current-password" style="' + _fld + '">'
        + '<label for="cpNew">New password <small style="color:#888;">(at least 8 characters)</small></label><input id="cpNew" type="password" autocomplete="new-password" style="' + _fld + '">'
        + '<label for="cpNew2">Repeat new password</label><input id="cpNew2" type="password" autocomplete="new-password" style="' + _fld + '">'
        + '<div id="cpMsg" style="min-height:20px;font-size:14px;margin-bottom:8px;" aria-live="polite"></div>'
        + '<div style="display:flex;gap:10px;"><button type="button" data-onclick="submitChangePassword(' + (forced ? 'true' : 'false') + ')" style="' + _btn + 'background:#2c5aa0;color:#fff;flex:1;">Save password</button>'
        + (forced ? '<button type="button" data-onclick="closeSsdcDialog();doLogout();" style="' + _btn + 'background:#eef1f5;color:#333;">Log out</button>' : '') + '</div>',
        { locked: !!forced, width: 440 });
}
async function submitChangePassword(forced) {
    var oldP = document.getElementById('cpOld').value, n1 = document.getElementById('cpNew').value, n2 = document.getElementById('cpNew2').value;
    if (n1.length < 8) return _msg('cpMsg', 'New password must be at least 8 characters');
    if (n1 !== n2) return _msg('cpMsg', 'The two new passwords do not match');
    _msg('cpMsg', 'Saving…', true);
    var res = await API.call('changePassword', { oldPassword: oldP, newPassword: n1 }, { noQueue: true });
    if (!res.success) return _msg('cpMsg', res.error || 'Could not change password');
    var s = API.session; if (s && s.user) { s.user.mustChangePassword = false; API.saveSession(s); }
    closeSsdcDialog();
    showToast('✅ Password changed', 'success');
    if (forced) { initApp(); API.queue.flush(); }
}

// ── sync centre ────────────────────────────────────────────────────
function openSyncCentre() {
    var q = API.queue.list();
    var rows = q.length ? q.map(function (it) {
        var st = it.status === 'failed'
            ? '<span style="color:#c0392b;font-weight:700;">❌ Not saved</span><div style="font-size:12px;color:#c0392b;">' + esc(it.error) + '</div>'
            : '<span style="color:#e67e22;font-weight:700;">⏳ Waiting</span>' + (it.error ? '<div style="font-size:12px;color:#888;">' + esc(it.error) + '</div>' : '');
        return '<tr><td style="font-size:12px;white-space:nowrap;">' + new Date(it.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + '</td>'
            + '<td>' + esc(API.queue.summary(it)) + '</td><td>' + st + '</td><td style="white-space:nowrap;">'
            + '<button type="button" class="btn-primary btn-small" data-onclick="API.queue.retry(\'' + it.reqId + '\').then(openSyncCentre)">↻ Retry</button>'
            + (currentRole === 'owner' ? ' <button type="button" class="btn-danger btn-small" data-onclick="if(confirm(\'Discard this unsynced item? It will NOT be saved.\')){API.queue.discard(\'' + it.reqId + '\');openSyncCentre();}">Discard</button>' : '')
            + '</td></tr>';
    }).join('') : '<tr><td colspan="4" style="text-align:center;color:#888;padding:18px;">✅ Everything is synced.</td></tr>';
    ssdcDialog('☁️ Sync Centre',
        '<p style="margin:0 0 10px;font-size:14px;color:#555;">' + (navigator.onLine === false ? '📴 This device is offline.' : '🟢 Online.')
        + ' Last synced: ' + (API.lastSync ? new Date(API.lastSync).toLocaleTimeString('en-IN') : '—') + '</p>'
        + '<div class="tbl-wrap"><table class="table"><thead><tr><th>When</th><th>What</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        + '<button type="button" data-onclick="API.queue.flush(true).then(openSyncCentre)" style="' + _btn + 'background:#2c5aa0;color:#fff;margin-top:12px;">↻ Sync now</button>', { width: 720 });
}

// ── owner settings panels ──────────────────────────────────────────
function renderAdminPanels() {
    var page = document.getElementById('settings'); if (!page) return;
    var box = document.getElementById('adminPanels');
    if (!box) { box = document.createElement('div'); box.id = 'adminPanels'; page.appendChild(box); }
    if (currentRole !== 'owner') { box.innerHTML = ''; return; }
    var card = 'background:#fff;padding:20px;border-radius:8px;margin-top:20px;';
    box.innerHTML =
        '<div style="' + card + '"><h3 style="margin:0 0 12px;color:var(--primary);">👥 Users &amp; passwords</h3><div id="admUsers">Loading…</div>'
        + '<details style="margin-top:12px;"><summary style="cursor:pointer;font-weight:700;">➕ Add a staff/owner login</summary><div style="max-width:420px;margin-top:10px;">'
        + '<label for="nuName">Username</label><input id="nuName" style="' + _fld + '" placeholder="e.g. reception2" autocomplete="off">'
        + '<label for="nuDisp">Display name</label><input id="nuDisp" style="' + _fld + '" placeholder="e.g. Reception (evening)">'
        + '<label for="nuRole">Role</label><select id="nuRole" style="' + _fld + '"><option value="STAFF">Staff</option><option value="OWNER">Owner</option></select>'
        + '<label for="nuPass">Temporary password (they change it at first login)</label><input id="nuPass" style="' + _fld + '" autocomplete="off">'
        + '<div id="nuMsg" style="min-height:18px;font-size:14px;" aria-live="polite"></div><button type="button" data-onclick="admCreateUser()" style="' + _btn + 'background:#2c5aa0;color:#fff;">Create login</button></div></details>'
        + '<p style="font-size:13px;color:#777;margin:12px 0 0;">Forgot the owner password? In Apps Script run <code>emergencyResetOwnerPassword</code> — a temporary password is e-mailed to the clinic Google account.</p></div>'

        + '<div style="' + card + '"><h3 style="margin:0 0 12px;color:var(--primary);">🧾 Billing rules</h3>'
        + '<label for="admMaxDisc">Maximum discount staff may give (%)</label><input id="admMaxDisc" type="number" min="0" max="100" step="1" style="' + _fld + 'max-width:160px;" value="' + (isFinite(CONFIG.staffMaxDiscountPct) ? CONFIG.staffMaxDiscountPct : 10) + '">'
        + '<div id="admRuleMsg" style="min-height:18px;font-size:14px;"></div><button type="button" data-onclick="admSaveRules()" style="' + _btn + 'background:#2c5aa0;color:#fff;">Save rule</button></div>'

        + '<div style="' + card + '"><h3 style="margin:0 0 12px;color:var(--primary);">💾 Backups</h3><div id="admBackups">Loading…</div>'
        + '<button type="button" data-onclick="admBackupNow()" style="' + _btn + 'background:#27ae60;color:#fff;margin-top:10px;">💾 Back up now</button>'
        + '<p style="font-size:13px;color:#777;margin:10px 0 0;">Automatic: daily ~2 AM (14 kept), weekly (8), monthly (12) in Google Drive folder “SSDC Backups”. Every backup is checked row-by-row; you get an e-mail if one fails.</p></div>'

        + '<div style="' + card + '"><h3 style="margin:0 0 12px;color:var(--primary);">🔎 Data check</h3><p style="font-size:14px;color:#555;margin:0 0 10px;">Looks for duplicate bills/medicines, stock that doesn\'t match its batches, and broken links.</p>'
        + '<button type="button" data-onclick="admValidate()" style="' + _btn + 'background:#8e44ad;color:#fff;">Run check</button><div id="admValidate" style="margin-top:10px;"></div></div>'

        + '<div style="' + card + '"><h3 style="margin:0 0 12px;color:var(--primary);">🛡️ Audit log <small style="font-weight:400;color:#888;">(who did what, latest first)</small></h3>'
        + '<input id="admAuditFilter" placeholder="🔍 Filter (user, action, bill…)" data-oninput="admRenderAudit()" style="' + _fld + 'max-width:320px;"><div id="admAudit">Loading…</div></div>';
    admLoadUsers(); admLoadBackups(); admLoadAudit();
}
async function admLoadUsers() {
    var res = await API.call('listUsers'), el = document.getElementById('admUsers'); if (!el) return;
    if (!res.success) { el.textContent = res.error || 'Could not load users'; return; }
    el.innerHTML = '<div class="tbl-wrap"><table class="table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>'
        + res.users.map(function (u) {
            return '<tr><td><b>' + esc(u.username) + '</b><div style="font-size:12px;color:#888;">' + esc(u.displayName) + '</div></td><td>' + esc(u.role) + '</td><td>'
                + (u.active ? (u.locked ? '🔒 Locked (wrong passwords)' : (u.mustChangePassword ? '⏳ Must set password' : '✅ Active')) : '⛔ Disabled') + '</td><td style="font-size:12px;">' + esc(u.lastLogin || '—') + '</td><td style="white-space:nowrap;">'
                + '<button type="button" class="btn-primary btn-small" data-onclick="admResetPw(\'' + esc(u.username) + '\')">Reset password</button> '
                + '<button type="button" class="btn-small ' + (u.active ? 'btn-danger' : 'btn-primary') + '" data-onclick="admSetActive(\'' + esc(u.username) + '\',' + (!u.active) + ')">' + (u.active ? 'Disable' : 'Enable') + '</button></td></tr>';
        }).join('') + '</tbody></table></div>';
}
async function admCreateUser() {
    var res = await API.call('createUser', { username: _v('nuName'), displayName: _v('nuDisp'), role: _v('nuRole'), password: _v('nuPass') }, { noQueue: true });
    if (!res.success) return _msg('nuMsg', res.error);
    _msg('nuMsg', '✅ Login created. Give them the temporary password.', true);
    ['nuName', 'nuDisp', 'nuPass'].forEach(function (id) { document.getElementById(id).value = ''; });
    admLoadUsers(); admLoadAudit();
}
async function admResetPw(username) {
    var p = (prompt('New TEMPORARY password for "' + username + '" (min 8 characters).\nThey will be asked to change it at next login, and are logged out everywhere now.') || '').trim();
    if (!p) return;
    var res = await API.call('resetUserPassword', { username: username, newPassword: p }, { noQueue: true });
    showToast(res.success ? '✅ Temporary password set for ' + username : '❌ ' + res.error, res.success ? 'success' : 'error');
    admLoadUsers(); admLoadAudit();
}
async function admSetActive(username, active) {
    if (!active && !confirm('Disable "' + username + '"? They are logged out immediately and cannot log in.')) return;
    var res = await API.call('setUserActive', { username: username, active: active }, { noQueue: true });
    showToast(res.success ? (active ? '✅ Enabled ' : '⛔ Disabled ') + username : '❌ ' + res.error, res.success ? 'success' : 'error');
    admLoadUsers(); admLoadAudit();
}
async function admSaveRules() {
    var v = parseFloat(_v('admMaxDisc'));
    if (!(v >= 0 && v <= 100)) return _msg('admRuleMsg', 'Enter a number from 0 to 100');
    var res = await API.call('saveSettings', { settingKey: 'staff_max_discount_pct', settingValue: String(v) }, { noQueue: true });
    if (res.success) { CONFIG.staffMaxDiscountPct = v; _msg('admRuleMsg', '✅ Saved — staff can give up to ' + v + '%', true); } else _msg('admRuleMsg', res.error);
}
async function admLoadBackups() {
    var res = await API.call('listBackups'), el = document.getElementById('admBackups'); if (!el) return;
    if (!res.success) { el.textContent = res.error || 'Could not load backups'; return; }
    var last = res.last;
    el.innerHTML = (last ? '<p style="margin:0 0 8px;font-size:14px;">Last backup: <b>' + esc(last.at) + '</b> ' + (last.verified ? '✅ verified' : '❌ ' + esc((last.problems || []).join('; '))) + '</p>' : '<p style="margin:0 0 8px;">No backup yet.</p>')
        + (res.backups.length ? '<details><summary style="cursor:pointer;">Show ' + res.backups.length + ' backup(s)</summary><ul style="margin:8px 0 0;padding-left:18px;font-size:13px;">'
        + res.backups.map(function (b) { return '<li><a href="' + esc(b.url) + '" target="_blank" rel="noopener">' + esc(b.name) + '</a></li>'; }).join('') + '</ul></details>' : '');
}
async function admBackupNow() {
    showToast('💾 Backing up… (may take ~20 seconds)', 'info');
    var res = await API.call('backupNow', {}, { noQueue: true });
    showToast(res.success ? '✅ Backup done and verified' : '❌ Backup failed: ' + res.error, res.success ? 'success' : 'error');
    admLoadBackups(); admLoadAudit();
}
async function admValidate() {
    var el = document.getElementById('admValidate'); el.textContent = 'Checking…';
    var res = await API.call('validateData');
    if (!res.success) { el.textContent = res.error; return; }
    el.innerHTML = res.count ? '<p style="color:#c0392b;font-weight:700;margin:0 0 6px;">' + res.count + ' issue(s) found:</p><ul style="margin:0;padding-left:18px;font-size:13px;">'
        + res.issues.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>' : '<p style="color:#1e8449;font-weight:700;margin:0;">✅ No problems found.</p>';
}
var _auditEntries = [];
async function admLoadAudit() {
    var res = await API.call('getAuditLog', { limit: 500 });
    _auditEntries = res.success ? res.entries : [];
    admRenderAudit(res.success ? '' : (res.error || 'Could not load'));
}
function admRenderAudit(err) {
    var el = document.getElementById('admAudit'); if (!el) return;
    if (err) { el.textContent = err; return; }
    var f = _v('admAuditFilter').toLowerCase();
    var list = _auditEntries.filter(function (e) { return !f || (e.user + ' ' + e.action + ' ' + e.target + ' ' + e.details + ' ' + e.result).toLowerCase().indexOf(f) !== -1; }).slice(0, 200);
    var col = { OK: '#1e8449', WARN: '#e67e22', FAILED: '#c0392b', DENIED: '#c0392b', ERROR: '#c0392b' };
    el.innerHTML = '<div class="tbl-wrap" style="max-height:420px;overflow:auto;"><table class="table" style="font-size:13px;"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Record</th><th>Details</th><th>Result</th></tr></thead><tbody>'
        + list.map(function (e) {
            return '<tr><td style="white-space:nowrap;">' + esc(e.at) + '</td><td>' + esc(e.user) + '</td><td>' + esc(e.action) + '</td><td style="font-family:monospace;font-size:11px;">' + esc(e.target)
                + '</td><td>' + esc(e.details) + '</td><td style="color:' + (col[e.result] || '#333') + ';font-weight:700;">' + esc(e.result) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
}

// ── inventory: edit medicine ───────────────────────────────────────
function openEditMedicine(id) {
    var m = medicines.find(function (x) { return String(x.id) === String(id); }); if (!m) return;
    ssdcDialog('✏️ Edit ' + esc(m.name),
        '<label for="emName">Name</label><input id="emName" style="' + _fld + '" value="' + esc(m.name) + '">'
        + '<div style="display:flex;gap:10px;"><div style="flex:1;"><label for="emPrice">Selling price ₹</label><input id="emPrice" type="number" step="0.01" min="0" style="' + _fld + '" value="' + m.price + '"></div>'
        + '<div style="flex:1;"><label for="emCost">Cost price ₹</label><input id="emCost" type="number" step="0.01" min="0" style="' + _fld + '" value="' + (m.costPrice || 0) + '"></div></div>'
        + '<label for="emMin">Low-stock alert below</label><input id="emMin" type="number" step="1" min="0" style="' + _fld + 'max-width:160px;" value="' + (m.minStock || 10) + '">'
        + '<p style="font-size:13px;color:#777;margin:0 0 12px;">Stock and expiry change only through purchases or <b>📦 Stock</b> adjustments, so every change is recorded.</p>'
        + '<div id="emMsg" style="min-height:18px;font-size:14px;"></div>'
        + '<button type="button" data-onclick="saveEditMedicine(\'' + esc(m.id) + '\')" style="' + _btn + 'background:#2c5aa0;color:#fff;">Save changes</button>', { width: 480 });
}
async function saveEditMedicine(id) {
    var price = parseFloat(_v('emPrice')), cost = parseFloat(_v('emCost'));
    if (!_v('emName') || !(price >= 0) || !(cost >= 0)) return _msg('emMsg', 'Check name and prices');
    if (price < cost && !confirm('Selling price is below cost price. Save anyway?')) return;
    var res = await API.call('updateMedicine', { id: id, name: _v('emName'), price: price, costPrice: cost, minStock: _v('emMin') }, { noQueue: true });
    if (!res.success) return _msg('emMsg', res.error);
    closeSsdcDialog(); showToast('✅ Medicine updated', 'success'); loadData();
}

// ── inventory: batches + adjustments + movement history ───────────
var ADJ_LABELS = { DAMAGED: 'Damaged / broken (−)', EXPIRED: 'Expired — remove from shelf (−)', PURCHASE_RETURN: 'Returned to supplier (−)',
    CUSTOMER_RETURN: 'Returned by patient (+)', OPENING: 'Opening stock found (+)', ADJUSTMENT: 'Stock count correction (+ or −)' };
function openStockDialog(id) {
    var m = medicines.find(function (x) { return String(x.id) === String(id); }); if (!m) return;
    var today = todayLocal(), batches = (m.batches || []);
    var bRows = batches.length ? batches.map(function (b, i) {
        var expired = b.expiry && b.expiry < today;
        var days = b.expiry ? Math.ceil((new Date(b.expiry) - new Date(today)) / 86400000) : null;
        var tag = expired ? '<span style="color:#8e44ad;font-weight:700;">EXPIRED</span>' : (days !== null && days <= 90 ? '<span style="color:#e67e22;font-weight:700;">' + days + ' days</span>' : '');
        return '<tr><td>' + (expired ? '' : (i === batches.filter(function (x) { return x.expiry && x.expiry < today; }).length ? '<b title="Sold first (FEFO)">▶</b> ' : '')) + esc(b.batchNo || '—') + '</td><td>' + esc(b.expiry || '—') + ' ' + tag + '</td><td><b>' + b.qty + '</b></td><td>₹' + (b.cost || 0) + '</td><td style="font-size:12px;">' + esc(b.supplier || '') + '</td></tr>';
    }).join('') : '<tr><td colspan="5" style="color:#888;text-align:center;">No batch details (refresh after upgrade).</td></tr>';
    ssdcDialog('📦 ' + esc(m.name),
        '<p style="margin:0 0 8px;font-size:14px;">Sellable: <b>' + m.stock + '</b>' + (m.expiredStock ? ' · <span style="color:#8e44ad;">Expired (not sellable): <b>' + m.expiredStock + '</b></span>' : '') + ' · Sold in order of expiry (▶ = next).</p>'
        + '<div class="tbl-wrap"><table class="table"><thead><tr><th>Batch</th><th>Expiry</th><th>Qty</th><th>Cost</th><th>Supplier</th></tr></thead><tbody>' + bRows + '</tbody></table></div>'
        + '<h4 style="margin:16px 0 8px;color:#1e3f5a;">Record a stock change</h4>'
        + '<label for="adjType">Type</label><select id="adjType" style="' + _fld + '">' + Object.keys(ADJ_LABELS).map(function (k) { return '<option value="' + k + '">' + ADJ_LABELS[k] + '</option>'; }).join('') + '</select>'
        + '<div style="display:flex;gap:10px;"><div style="flex:1;"><label for="adjQty">Quantity</label><input id="adjQty" type="number" step="1" style="' + _fld + '" placeholder="e.g. 5 (or −5 for correction)"></div>'
        + '<div style="flex:1;"><label for="adjBatch">Batch</label><select id="adjBatch" style="' + _fld + '"><option value="">Automatic (FEFO)</option>'
        + batches.map(function (b) { return '<option value="' + esc(b.batchId) + '">' + esc(b.batchNo || b.batchId) + ' · ' + esc(b.expiry || '') + ' · ' + b.qty + '</option>'; }).join('') + '</select></div></div>'
        + '<label for="adjReason">Reason (required)</label><input id="adjReason" style="' + _fld + '" placeholder="e.g. strip torn while unpacking">'
        + '<div id="adjMsg" style="min-height:18px;font-size:14px;"></div>'
        + '<button type="button" data-onclick="submitStockAdjust(\'' + esc(m.id) + '\')" style="' + _btn + 'background:#16a085;color:#fff;">Save stock change</button>'
        + '<details style="margin-top:16px;"><summary style="cursor:pointer;font-weight:700;" data-onclick="if(!this.parentNode.open)loadMovements(\'' + esc(m.id) + '\')">📜 Stock history</summary><div id="mvList" style="margin-top:8px;">Loading…</div></details>',
        { width: 680 });
}
async function submitStockAdjust(id) {
    var type = _v('adjType'), qty = Number(_v('adjQty')), reason = _v('adjReason');
    if (!Number.isInteger(qty) || qty === 0) return _msg('adjMsg', 'Enter a whole number (not 0)');
    if (reason.length < 3) return _msg('adjMsg', 'Please write a reason');
    var res = await API.call('adjustStock', { medicineId: id, type: type, qty: qty, batchId: _v('adjBatch'), reason: reason }, { noQueue: true });
    if (!res.success) return _msg('adjMsg', res.error);
    closeSsdcDialog(); showToast('✅ Stock updated · now ' + res.stock, 'success'); loadData();
}
async function loadMovements(id) {
    var res = await API.call('getStockMovements', { medicineId: id, limit: 100 }), el = document.getElementById('mvList'); if (!el) return;
    if (!res.success) { el.textContent = res.error; return; }
    el.innerHTML = res.movements.length ? '<div class="tbl-wrap" style="max-height:300px;overflow:auto;"><table class="table" style="font-size:13px;"><thead><tr><th>When</th><th>Type</th><th>Qty</th><th>Ref</th><th>By</th><th>Reason</th></tr></thead><tbody>'
        + res.movements.map(function (m) {
            return '<tr><td style="white-space:nowrap;">' + esc(m.at) + '</td><td>' + esc(m.type) + '</td><td style="font-weight:700;color:' + (m.qty < 0 ? '#c0392b' : '#1e8449') + ';">' + (m.qty > 0 ? '+' : '') + m.qty
                + '</td><td style="font-family:monospace;font-size:11px;">' + esc(m.ref) + '</td><td>' + esc(m.user) + '</td><td>' + esc(m.reason) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p style="color:#888;">No movements yet.</p>';
}
;

;/* ══ FILE: 13-v31-core.js ══════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════
   13-v31-core.js — shared layer for the v3.1 features
   • V31.enabled(): new screens appear only when the server is v3.1
   • V31.data: receivables, payments, suppliers, treatments, follow-ups…
   • Click/input handling through data-act attributes (no inline scripts)
   • Patient picker with allergy / medical alert banner
   • Page registry: V31.pages[id] = render function
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var V31 = window.V31 = {
    data: { receivables: [], payments: [], treatmentMaster: [], patientTreatments: [], followUps: [], cashClosings: [], suppliers: [],
      purchaseInvoices: [], purchaseReturns: [], settings: {}, loadedFrom: '' },
    pages: {}, _serverOn: false
  };
  V31.enabled = function () { var s = API.session; return !!((s && s.features && s.features.v31) || V31._serverOn); };
  V31.isOwner = function () { return API.isOwner(); };

  // ── small helpers ──────────────────────────────────────────────────
  var h = V31.h = window.esc;
  V31.r2 = function (x) { return Math.round((+x || 0) * 100) / 100; };
  V31.inr = function (n, dp) {
    n = +n || 0; var d = dp === 0 ? 0 : 2;
    return (n < 0 ? '−₹' : '₹') + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  V31.today = function () { return todayLocal(); };
  V31.addDays = function (d, n) { var x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };
  V31.fmtDate = function (d) {
    if (!d) return '—'; var x = new Date(String(d).slice(0, 10) + 'T12:00:00');
    return isNaN(x) ? String(d) : x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  V31.daysBetween = function (a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); };
  V31.normPhone = function (p) { var d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : d; };
  V31.waPhone = function (p) { var d = V31.normPhone(p); return d.length === 10 ? '91' + d : d; };
  V31.badge = function (status) {
    var c = { Paid: ['#e8f8ee', '#1e8449'], Partial: ['#fff3e0', '#b9770e'], Unpaid: ['#fdecea', '#c0392b'], Returned: ['#eef1f5', '#555'],
      Active: ['#e8f8ee', '#1e8449'], Cancelled: ['#eef1f5', '#777'], Pending: ['#fff3e0', '#b9770e'], Done: ['#e8f8ee', '#1e8449'],
      Planned: ['#e8f0fe', '#2c5aa0'], 'In progress': ['#fff3e0', '#b9770e'], Completed: ['#e8f8ee', '#1e8449'], Overdue: ['#fdecea', '#c0392b'],
      Inactive: ['#eef1f5', '#777'] }[status] || ['#eef1f5', '#555'];
    return '<span class="v-badge" style="background:' + c[0] + ';color:' + c[1] + ';">' + h(status || '—') + '</span>';
  };
  V31.uid = function (p) { return newId(p); };
  V31.toast = function (m, t) { showToast(m, t || 'success'); };
  V31.val = function (id) { var e = document.getElementById(id); return e ? String(e.value || '').trim() : ''; };
  V31.num = function (id) { var v = parseFloat(V31.val(id)); return isFinite(v) ? v : 0; };
  V31.msg = function (id, text, ok) { var e = document.getElementById(id); if (e) { e.textContent = text; e.style.color = ok ? '#1e8449' : '#c0392b'; } };
  V31.busy = function (btn, on, label) {
    if (!btn) return; if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = label || '⏳ Saving…'; }
    else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
  };
  // Amount in words (Indian numbering) — receipts
  V31.words = function (num) {
    num = Math.round(+num || 0); if (!num) return 'Zero Only';
    var a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    var b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    var two = function (n) { return n < 20 ? a[n] : b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : ''); };
    var three = function (n) { return (n >= 100 ? a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : ''); };
    var out = [], cr = Math.floor(num / 10000000), lk = Math.floor(num / 100000) % 100, th = Math.floor(num / 1000) % 100, rest = num % 1000;
    if (cr) out.push(three(cr) + ' Crore'); if (lk) out.push(two(lk) + ' Lakh'); if (th) out.push(two(th) + ' Thousand'); if (rest) out.push(three(rest));
    return out.join(' ') + ' Only';
  };

  // ── clicks / inputs without inline scripts (CSP friendly) ─────────
  var ACT = V31.act = {};
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-act]'); if (!el || el.disabled) return;
    var fn = ACT[el.getAttribute('data-act')]; if (!fn) return;
    if (el.tagName === 'A' || el.tagName === 'BUTTON') e.preventDefault();
    try { fn(el, e); } catch (err) { console.error(err); showToast('⚠️ ' + err.message, 'error'); }
  });
  ['input', 'change'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      var el = e.target; if (!el || !el.getAttribute) return;
      var name = el.getAttribute('data-' + type); if (!name || !ACT[name]) return;
      try { ACT[name](el, e); } catch (err) { console.error(err); }
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var el = e.target; if (!el || !el.getAttribute) return;
    var name = el.getAttribute('data-enter'); if (!name || !ACT[name]) return;
    e.preventDefault(); ACT[name](el, e);
  });

  // ── building blocks ────────────────────────────────────────────────
  V31.table = function (heads, rows, opts) {
    opts = opts || {};
    if (!rows.length) return '<div class="v-empty">' + (opts.empty || 'Nothing to show.') + '</div>';
    var numCol = String(rows[0]).split('<td').slice(1).map(function (c) { return /^[^>]*class="num"/.test(c); });
    // phones: every row becomes a small card; each cell shows its column name
    var labels = heads.map(function (x) { return String(x).replace(/<[^>]*>/g, '').replace(/"/g, '&quot;').trim(); });
    rows = rows.map(function (r) { var i = 0; return String(r).replace(/<td(?=[\s>])/g, function () { return '<td data-label="' + (labels[i++] || '') + '"'; }); });
    return '<div class="tbl-wrap' + (opts.scroll ? ' v-scroll' : '') + '"><table class="table v-table' + (opts.cls ? ' ' + opts.cls : '') + '"><thead><tr>'
      + heads.map(function (x, i) { return '<th' + (numCol[i] ? ' class="num"' : '') + '>' + x + '</th>'; }).join('')
      + '</tr></thead><tbody>' + rows.join('') + '</tbody>' + (opts.foot ? '<tfoot>' + opts.foot + '</tfoot>' : '') + '</table></div>';
  };
  V31.td = function (v, num, extra) { return '<td' + (num ? ' class="num"' : '') + (extra ? ' ' + extra : '') + '>' + v + '</td>'; };
  V31.kpis = function (list) {
    return '<div class="v-kpis">' + list.map(function (k) {
      return '<div class="v-kpi' + (k.tone ? ' v-' + k.tone : '') + '"><div class="v-kpi-l">' + h(k.label) + '</div><div class="v-kpi-v">' + k.value + '</div>' + (k.sub ? '<div class="v-kpi-s">' + k.sub + '</div>' : '') + '</div>';
    }).join('') + '</div>';
  };
  V31.tabs = function (id, list, cur) {
    return '<div class="v-tabs" role="tablist">' + list.map(function (t) {
      return '<button type="button" role="tab" aria-selected="' + (t[0] === cur) + '" class="v-tab' + (t[0] === cur ? ' on' : '') + '" data-act="v31Tab" data-tabs="' + id + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div>';
  };
  V31.tabState = {};
  ACT.v31Tab = function (el) { V31.tabState[el.dataset.tabs] = el.dataset.tab; var f = V31.tabRender[el.dataset.tabs]; if (f) f(); };
  V31.tabRender = {};
  V31.modeButtons = function (group, cur, modes) {
    modes = modes || [['Cash', '💵 Cash'], ['UPI', '📱 UPI'], ['Card', '💳 Card'], ['Split', '🔀 Split']];
    return '<div class="v-modes" data-group="' + group + '">' + modes.map(function (m) {
      return '<button type="button" class="v-mode' + (m[0] === cur ? ' on' : '') + '" data-act="v31Mode" data-group="' + group + '" data-mode="' + m[0] + '">' + m[1] + '</button>';
    }).join('') + '</div>';
  };
  V31.modeOf = function (group) { var b = document.querySelector('.v-mode.on[data-group="' + group + '"]'); return b ? b.dataset.mode : 'Cash'; };
  V31.onMode = {};
  ACT.v31Mode = function (el) {
    document.querySelectorAll('.v-mode[data-group="' + el.dataset.group + '"]').forEach(function (b) { b.classList.toggle('on', b === el); });
    if (V31.onMode[el.dataset.group]) V31.onMode[el.dataset.group](el.dataset.mode);
  };
  V31.dialog = function (title, body, opts) { return ssdcDialog(title, body, opts); };
  V31.close = function () { closeSsdcDialog(); };
  ACT.v31Close = function () { closeSsdcDialog(); };
  V31.field = function (id, label, input) { return '<div class="v-field"><label for="' + id + '">' + label + '</label>' + input + '</div>'; };
  V31.input = function (id, attrs) { return '<input id="' + id + '" class="v-in" ' + (attrs || '') + '>'; };
  V31.call = function (action, params, opts) { return API.call(action, params, opts); };

  // ── data from getAllData ─────────────────────────────────────────
  var CKEY = 'ssdc_v31_cache';
  V31.ingest = function (d) {
    if (!d || d.unchanged || d.success === false) return;
    V31._serverOn = !!(d.features && d.features.v31);
    if (API.session) { API.session.features = d.features || API.session.features; API.saveSession(API.session); }
    if (V31._serverOn) {
      ['receivables', 'payments', 'treatmentMaster', 'patientTreatments', 'followUps', 'cashClosings', 'suppliers', 'purchaseInvoices', 'purchaseReturns']
        .forEach(function (k) { if (Array.isArray(d[k])) V31.data[k] = d[k]; });
      V31.data.settings = d.settings || {}; V31.data.loadedFrom = d.loadedFrom || '';
      try { localStorage.setItem(CKEY, JSON.stringify(V31.data)); } catch (e) {}
    }
    V31.applyUI();
    V31.refresh();
  };
  V31.loadCache = function () {
    try { var c = JSON.parse(localStorage.getItem(CKEY) || 'null'); if (c) Object.keys(c).forEach(function (k) { V31.data[k] = c[k]; }); } catch (e) {}
  };
  V31.applyUI = function () {
    var on = V31.enabled();
    document.body.classList.toggle('v31', on);
    document.querySelectorAll('.v31-only').forEach(function (el) { el.hidden = !on || (el.classList.contains('owner-only') && !API.isOwner()); });
    document.querySelectorAll('.v30-only').forEach(function (el) { el.hidden = on; });
    // which server this copy is talking to — one look tells if the Apps Script update is done
    var vl = document.getElementById('appVersionLabel'), f = (API.session && API.session.features) || null;
    if (vl && (f || V31._serverOn)) { f = f || {}; vl.textContent = on ? 'App v3.1 · server v3.1 ✓' : 'App v3.1 · server needs update'; vl.style.color = on ? '' : '#ffd166'; vl.title = 'Server data version (schema) ' + (f.schema || '?'); }
  };
  V31.refresh = function () {
    var cur = document.querySelector('.page.active'), ae = document.activeElement;
    var typing = cur && ae && cur.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
    // background refresh never redraws a page someone is typing in (or that has its own data, like Finance / Cash closing)
    if (cur && V31.pages[cur.id] && V31.enabled() && !typing && !V31.pages[cur.id].noAutoRefresh) { try { V31.pages[cur.id](true); } catch (e) { console.error(e); } }
    (V31.afterRefresh || []).forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
  };
  V31.afterRefresh = [];

  // ── patients ───────────────────────────────────────────────────────
  V31.patients = function () { return window._patients || []; };
  V31.patientById = function (id) { return V31.patients().find(function (p) { return String(p.id) === String(id); }) || null; };
  V31.findPatient = function (name, phone) {
    var n = String(name || '').trim().toLowerCase(), ph = V31.normPhone(phone);
    if (!n) return null;
    var list = V31.patients().filter(function (p) { return String(p.name || '').trim().toLowerCase() === n && (!ph || V31.normPhone(p.phone) === ph); });
    return list.length === 1 ? list[0] : null;
  };
  V31.searchPatients = function (q, limit) {
    q = String(q || '').trim().toLowerCase(); if (!q) return [];
    var digits = q.replace(/\D/g, '');
    return V31.patients().filter(function (p) {
      return String(p.name || '').toLowerCase().indexOf(q) !== -1 || (digits.length >= 3 && String(p.phone || '').replace(/\D/g, '').indexOf(digits) !== -1);
    }).slice(0, limit || 8);
  };
  V31.outstandingOf = function (p) {
    if (!p) return 0; var ph = V31.normPhone(p.phone), nm = String(p.name || '').trim().toLowerCase();
    return V31.r2(V31.data.receivables.reduce(function (a, r) {
      var mine = r.patientId ? String(r.patientId) === String(p.id) : (String(r.patientName || '').trim().toLowerCase() === nm && (!ph || !r.phone || V31.normPhone(r.phone) === ph));
      return a + (mine ? r.balance : 0);
    }, 0));
  };
  V31.alertsHtml = function (p) {
    if (!p) return '';
    var bits = [];
    if (p.allergies) bits.push('<b>Allergy:</b> ' + h(p.allergies));
    if (p.alerts) bits.push('<b>Alert:</b> ' + h(p.alerts));
    if (p.medicalHistory) bits.push('<b>History:</b> ' + h(String(p.medicalHistory).slice(0, 120)));
    var due = V31.outstandingOf(p);
    if (due > 0) bits.push('<b>Due:</b> ' + V31.inr(due));
    return bits.length ? '<div class="v-alert" role="status">⚠️ ' + bits.join(' · ') + '</div>' : '';
  };
  // Type-ahead under a name field. Remembers the chosen patient's ID on the input.
  V31.attachPatientPicker = function (input, opts) {
    if (!input || input.dataset.picker) return; opts = opts || {};
    input.dataset.picker = '1'; input.setAttribute('autocomplete', 'off');
    var box = document.createElement('div'); box.className = 'v-pick'; box.hidden = true; box.setAttribute('role', 'listbox');
    var alertBox = document.createElement('div'); alertBox.className = 'v-pick-alert';
    input.parentNode.insertBefore(box, input.nextSibling); box.parentNode.insertBefore(alertBox, box.nextSibling);
    if (getComputedStyle(input.parentNode).position === 'static') input.parentNode.style.position = 'relative';
    var choose = function (p) {
      input.value = p.name; input.dataset.patientId = p.id; box.hidden = true;
      var ph = opts.phone && document.getElementById(opts.phone); if (ph && !ph.value) ph.value = p.phone || '';
      alertBox.innerHTML = V31.enabled() ? V31.alertsHtml(p) : '';
      if (opts.onPick) opts.onPick(p);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    input.addEventListener('input', function (e) {
      if (e.isTrusted !== false && input.dataset.patientId) { var cur = V31.patientById(input.dataset.patientId); if (!cur || cur.name !== input.value) { delete input.dataset.patientId; alertBox.innerHTML = ''; } }
      var list = V31.searchPatients(input.value, 8);
      if (!list.length || (list.length === 1 && list[0].name === input.value && input.dataset.patientId)) { box.hidden = true; return; }
      box.innerHTML = list.map(function (p, i) {
        return '<div class="v-pick-item" role="option" data-i="' + i + '"><b>' + h(p.name) + '</b> <span>' + h(p.phone || '') + (p.age ? ' · ' + h(p.age) : '') + '</span>'
          + (p.allergies || p.alerts ? ' <span class="v-pick-warn">⚠️</span>' : '') + '</div>';
      }).join('');
      box._list = list; box.hidden = false;
    });
    box.addEventListener('mousedown', function (e) { var it = e.target.closest('.v-pick-item'); if (it) { e.preventDefault(); choose(box._list[+it.dataset.i]); } });
    input.addEventListener('blur', function () { setTimeout(function () { box.hidden = true; }, 150); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Escape') box.hidden = true; if (e.key === 'Enter' && !box.hidden && box._list && box._list.length === 1) { e.preventDefault(); choose(box._list[0]); } });
    input._v31Clear = function () { delete input.dataset.patientId; alertBox.innerHTML = ''; box.hidden = true; };
    input._v31Choose = choose;
  };
  V31.patientIdFor = function (inputId, phoneId) {
    var el = document.getElementById(inputId); if (!el) return '';
    if (el.dataset.patientId) return el.dataset.patientId;
    var p = V31.findPatient(el.value, phoneId ? V31.val(phoneId) : ''); return p ? p.id : '';
  };

  // ── session: unlock encrypted storage before the app reads it ─────
  var origStart = window.startSession;
  window.startSession = function (user) {
    var s = API.session || {};
    if (s.dataKey && window.SecureStore && !SecureStore.isUnlocked()) {
      SecureStore.unlock(s.dataKey, user.username).then(function () { reloadLocalState(); origStart(user); }, function () { origStart(user); });
      return;
    }
    origStart(user);
    V31.applyUI();
  };
  function reloadLocalState() {
    try { window._patients = JSON.parse(localStorage.getItem('pt_records') || '[]'); } catch (e) {}
    try { window._appointments = JSON.parse(localStorage.getItem('appointments') || '[]'); } catch (e) {}
    try { if (typeof window._expenses !== 'undefined') window._expenses = JSON.parse(localStorage.getItem('clinic_expenses') || '[]'); } catch (e) {}
    try { if (typeof window._efHistory !== 'undefined') window._efHistory = JSON.parse(localStorage.getItem('ef_history') || '[]'); } catch (e) {}
    V31.loadCache(); V31.applyUI();
    if (API.updateStatusLine) API.updateStatusLine();
  }
  var origLogout = window.doLogout;
  window.doLogout = function (silent) {
    var r = origLogout.apply(this, arguments);
    API.dataVersion = '';
    if (window.SecureStore && SecureStore.isUnlocked()) SecureStore.lock();
    V31._serverOn = false; V31.applyUI();
    return r;
  };

  // ── page hooks ─────────────────────────────────────────────────────
  var V31_TITLES = { payments: '💰 Dues & Payments', cashclose: '🧮 Cash Closing', suppliers: '🏭 Suppliers', followups: '🔔 Follow-ups', finance: '💹 Finance & Reports' };
  var origShow = window.showPage;
  window.showPage = function (page) {
    if (['suppliers', 'finance'].indexOf(page) !== -1 && currentRole !== 'owner') return;
    var r = origShow.apply(this, arguments);
    if (V31_TITLES[page]) document.getElementById('pageTitle').textContent = V31_TITLES[page];
    if (V31.pages[page] && V31.enabled()) {
      try { V31.pages[page](); } catch (e) { console.error(e); }
      if (API.token() && typeof loadData === 'function') loadData();     // fresh numbers (tiny request when nothing changed)
    }
    (V31.onShow[page] || []).forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
    return r;
  };
  V31.onShow = {};
  V31.whenShown = function (page, fn) { (V31.onShow[page] = V31.onShow[page] || []).push(fn); };

  document.addEventListener('DOMContentLoaded', function () {
    V31.applyUI();
    ['patientName', 'patientPhone', 'doctor', 'discountPct'].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () { if (typeof updateReceipt === 'function') updateReceipt(); });
    });
  });
})();
;

;/* ══ FILE: 14-money.js ══════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════
   14-money.js — part payments, dues, collections, returns/refunds,
   payment history, daily cash closing (v3.1)
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var V = window.V31, ACT = V.act, h = V.h, inr = V.inr, r2 = V.r2;
  var M = V.money = {};

  // ═══════════ part payment widget (inside the 3 payment windows) ═══════════
  var PP = V.partPay = { st: {} };
  PP.mount = function (key, anchor, getTotal, onChange) {
    if (!anchor) return;
    var box = document.getElementById('pp_' + key);
    if (!box) { box = document.createElement('div'); box.id = 'pp_' + key; box.className = 'v-pp'; anchor.parentNode.insertBefore(box, anchor.nextSibling); }
    PP.st[key] = PP.st[key] || { on: false, now: '' };
    PP.st[key].getTotal = getTotal; PP.st[key].onChange = onChange;
    PP.render(key);
  };
  PP.allowed = function () { return V.enabled() && (API.isOwner() || V.data.settings.staffCreditAllowed !== false); };
  PP.render = function (key) {
    var box = document.getElementById('pp_' + key), st = PP.st[key]; if (!box || !st) return;
    box.hidden = !PP.allowed();
    if (box.hidden) { st.on = false; return; }
    var total = st.getTotal(), now = st.on ? PP.amount(key) : total;
    box.innerHTML = '<label class="v-pp-tog"><input type="checkbox" data-change="ppToggle" data-k="' + key + '"' + (st.on ? ' checked' : '') + '> Pay part now · rest later</label>'
      + (st.on ? '<div class="v-pp-body"><div class="v-pp-row"><label for="pp_now_' + key + '">Paying now ₹</label>'
        + '<input id="pp_now_' + key + '" type="number" min="0" step="0.01" inputmode="decimal" value="' + now + '" data-input="ppNow" data-k="' + key + '"></div>'
        + '<div class="v-pp-chips"><button type="button" data-act="ppSet" data-k="' + key + '" data-v="0">Pay all later</button>'
        + '<button type="button" data-act="ppSet" data-k="' + key + '" data-v="half">Half now</button></div>'
        + '<div class="v-pp-due" id="pp_due_' + key + '">' + dueText(total, now) + '</div></div>' : '');
  };
  function dueText(total, now) {
    var due = r2(total - now);
    return now <= 0 ? '🕒 Nothing collected now — <b>' + inr(total) + '</b> will be due' : 'Balance due later: <b>' + inr(due) + '</b>';
  }
  PP.amount = function (key, totalArg) {
    var st = PP.st[key], total = totalArg !== undefined ? totalArg : (st ? st.getTotal() : 0);
    if (!st || !st.on || !PP.allowed()) return total;
    var v = parseFloat(st.now); if (!isFinite(v)) v = total;
    return r2(Math.max(0, Math.min(total, v)));
  };
  PP.isPart = function (key) { var st = PP.st[key]; return !!(st && st.on && PP.allowed() && PP.amount(key) < st.getTotal() - 0.009); };
  PP.reset = function (key) { var st = PP.st[key]; if (st) { st.on = false; st.now = ''; PP.render(key); } };
  ACT.ppToggle = function (el) {
    var st = PP.st[el.dataset.k]; st.on = el.checked; st.now = st.on ? String(r2(st.getTotal() / 2)) : '';
    PP.render(el.dataset.k); if (st.onChange) st.onChange();
    var inp = document.getElementById('pp_now_' + el.dataset.k); if (inp) { inp.focus(); inp.select(); }
  };
  ACT.ppNow = function (el) {
    var k = el.dataset.k, st = PP.st[k]; st.now = el.value;
    var d = document.getElementById('pp_due_' + k); if (d) d.innerHTML = dueText(st.getTotal(), PP.amount(k));
    if (st.onChange) st.onChange();
  };
  ACT.ppSet = function (el) {
    var k = el.dataset.k, st = PP.st[k], t = st.getTotal();
    st.now = el.dataset.v === 'half' ? String(r2(t / 2)) : '0';
    PP.render(k); if (st.onChange) st.onChange();
  };

  // pharmacy bill window
  function pmTotal() { return parseFloat(String((document.getElementById('pmTotal') || {}).textContent || '0').replace(/[₹,]/g, '')) || 0; }
  function pmChanged() {
    var now = PP.amount('pm', pmTotal());
    if (now === 0 && window._selectedPayMode === 'UPI') selectPayMode('Cash');
    if (typeof calcChange === 'function') calcChange();
    if (typeof calcSplit === 'function') calcSplit();
    if (window._selectedPayMode === 'UPI' && typeof generateUpiQr === 'function') generateUpiQr();
    var qc = document.getElementById('quickCashBtns');
    if (qc && now > 0) {
      qc.innerHTML = '';
      var rd = Math.ceil(now / 10) * 10;
      [rd, rd + 50, rd + 100, 500, 1000, 2000].filter(function (v, i, a) { return a.indexOf(v) === i && v >= now; }).slice(0, 5).forEach(function (amt) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = '₹' + amt;
        b.style.cssText = 'padding:6px 12px;border:1px solid #2c5aa0;border-radius:6px;background:#f0f4ff;color:#2c5aa0;cursor:pointer;font-size:13px;font-weight:600;';
        b.addEventListener('click', function () { document.getElementById('pmTendered').value = amt; calcChange(); });
        qc.appendChild(b);
      });
    }
    var lab = document.getElementById('pmCollectLine');
    if (lab) lab.innerHTML = PP.isPart('pm') ? 'Collect now: <b>' + inr(now) + '</b>' : '';
  }
  // dental receipt window
  function trTotal() { return parseFloat(String((document.getElementById('trPmTotal') || {}).textContent || '0').replace(/[₹,]/g, '')) || 0; }
  function upiQr(imgId, amtId, amt) {
    var img = document.getElementById(imgId); if (!img || !CONFIG.upiId) return;
    var link = 'upi://pay?pa=' + encodeURIComponent(CONFIG.upiId) + '&pn=' + encodeURIComponent(CONFIG.upiName || 'Sri Sai Dental') + '&am=' + amt.toFixed(2) + '&cu=INR&tn=' + encodeURIComponent('Dental');
    img.src = qrDataUrl(link, 5); var a = document.getElementById(amtId); if (a) a.textContent = (amtId === 'cbUpiAmt' ? '' : '₹') + amt.toFixed(2);
  }
  function trChanged() { if (typeof calcTrChange === 'function') calcTrChange(); if (typeof calcTrSplit === 'function') calcTrSplit(); upiQr('trUpiQr', 'trUpiAmt', PP.amount('tr', trTotal())); }
  function cbTotal() { return parseFloat(String((document.getElementById('cbPmTotal') || {}).textContent || '0').replace(/[₹,]/g, '')) || 0; }
  function cbChanged() { if (typeof calcCbChange === 'function') calcCbChange(); if (typeof calcCbSplit === 'function') calcCbSplit(); upiQr('cbUpiQr', 'cbUpiAmt', PP.amount('cb', cbTotal())); }
  M.mountPartPay = function () {
    var a = document.getElementById('pmTotal'); if (a) PP.mount('pm', a.closest('div').parentNode, pmTotal, pmChanged);
    var b = document.getElementById('trPmTotal'); if (b) PP.mount('tr', b.closest('div').parentNode, trTotal, trChanged);
    var c = document.getElementById('cbPmTotal'); if (c) PP.mount('cb', c.closest('div').parentNode, cbTotal, cbChanged);
  };
  M.collectNow = function (key) {     // amount to collect now in a payment window
    var t = key === 'pm' ? pmTotal() : key === 'tr' ? trTotal() : cbTotal();
    return PP.amount(key, t);
  };

  // ═══════════ collect a balance ═══════════
  function recLabel(r) { return (r.type === 'BILL' ? '💊 ' : r.type === 'RECEIPT' ? '🦷 ' : '📒 ') + (r.no || r.id); }
  M.receivable = function (type, id) { return V.data.receivables.find(function (r) { return r.type === type && String(r.id) === String(id); }) || null; };
  M.openCollect = function (recs) {
    recs = (recs || []).filter(function (r) { return r && r.balance > 0.009; });
    if (!recs.length) { V.toast('Nothing is due', 'info'); return; }
    recs.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    var due = r2(recs.reduce(function (a, r) { return a + r.balance; }, 0)), p = recs[0];
    M._collect = recs;
    V.dialog('💰 Collect payment',
      '<div class="v-sum"><div><span>Patient</span><b>' + h(p.patientName) + '</b></div>'
      + (p.phone ? '<div><span>Phone</span><b>' + h(p.phone) + '</b></div>' : '')
      + '<div><span>For</span><b>' + recs.map(function (r) { return h(recLabel(r)) + ' <small>(' + inr(r.balance) + ')</small>'; }).join('<br>') + '</b></div>'
      + '<div class="v-sum-big"><span>Total due</span><b>' + inr(due) + '</b></div></div>'
      + V.field('colAmt', 'Amount received now (₹)', '<input id="colAmt" class="v-in v-in-big" type="number" min="1" step="0.01" inputmode="decimal" value="' + due + '" data-input="colAmtChanged">')
      + '<div id="colAfter" class="v-note"></div>'
      + '<label class="v-lbl">How was it paid?</label>' + V.modeButtons('col', 'Cash')
      + '<div id="colSplit" hidden><div class="v-row2">' + V.field('colCash', 'Cash ₹', V.input('colCash', 'type="number" min="0" step="0.01"'))
      + V.field('colUpi', 'UPI ₹', V.input('colUpi', 'type="number" min="0" step="0.01"')) + V.field('colCard', 'Card ₹', V.input('colCard', 'type="number" min="0" step="0.01"')) + '</div></div>'
      + '<div id="colUpiQr" class="v-qr" hidden></div>'
      + V.field('colRef', 'Reference (UPI ref / card last 4) — optional', V.input('colRef', 'maxlength="60"'))
      + (API.isOwner() ? V.field('colDate', 'Date received', V.input('colDate', 'type="date" max="' + V.today() + '" value="' + V.today() + '"')) : '')
      + '<div id="colMsg" class="v-msg" aria-live="polite"></div>'
      + '<button type="button" class="v-btn v-primary v-wide" data-act="colSave">✅ Save payment</button>', { width: 480 });
    V.onMode.col = function (m) { document.getElementById('colSplit').hidden = m !== 'Split'; colQr(); };
    ACT.colAmtChanged(); colQr();
  };
  function colQr() {
    var el = document.getElementById('colUpiQr'); if (!el) return;
    var m = V.modeOf('col'), amt = V.num('colAmt');
    if (m !== 'UPI' || !CONFIG.upiId || !(amt > 0)) { el.hidden = true; return; }
    var link = 'upi://pay?pa=' + encodeURIComponent(CONFIG.upiId) + '&pn=' + encodeURIComponent(CONFIG.upiName || 'Sri Sai Dental Care') + '&am=' + amt.toFixed(2) + '&cu=INR&tn=' + encodeURIComponent('Dues');
    el.innerHTML = '<img alt="UPI QR for ' + inr(amt) + '" src="' + qrDataUrl(link, 4) + '"><div>Scan to pay <b>' + inr(amt) + '</b><br><small>' + h(CONFIG.upiId) + '</small></div>'; el.hidden = false;
  }
  ACT.colAmtChanged = function () {
    var due = r2((M._collect || []).reduce(function (a, r) { return a + r.balance; }, 0)), amt = V.num('colAmt'), el = document.getElementById('colAfter');
    if (el) el.innerHTML = amt > due + 0.009 ? '<span class="v-bad">More than the amount due (' + inr(due) + ')</span>' : amt > 0 ? 'Still due after this: <b>' + inr(due - amt) + '</b>' : '';
    colQr();
  };
  ACT.colSave = async function (btn) {
    var recs = M._collect || [], amt = r2(V.num('colAmt')), mode = V.modeOf('col'), due = r2(recs.reduce(function (a, r) { return a + r.balance; }, 0));
    if (!(amt > 0)) return V.msg('colMsg', 'Enter the amount received');
    if (amt > due + 0.009) return V.msg('colMsg', 'That is more than the ' + inr(due) + ' due');
    var split = { cash: V.num('colCash'), upi: V.num('colUpi'), card: V.num('colCard') };
    if (mode === 'Split' && Math.abs(split.cash + split.upi + split.card - amt) > 0.5) return V.msg('colMsg', 'Cash + UPI + Card must add up to ' + inr(amt));
    V.busy(btn, true);
    var left = amt, done = [], failed = '', queued = false, sLeft = Object.assign({}, split);
    for (var i = 0; i < recs.length && left > 0.009; i++) {
      var r = recs[i], part = r2(Math.min(left, r.balance)), p = { againstType: r.type, againstId: r.id, amount: part, mode: mode, ref: V.val('colRef'), date: V.val('colDate') || '', phone: r.phone || '' };
      if (mode === 'Split') {     // fill this invoice from cash, then UPI, then card
        var need = part; ['cash', 'upi', 'card'].forEach(function (k) { var t = r2(Math.min(sLeft[k], need)); p[k + 'Amount'] = t; sLeft[k] = r2(sLeft[k] - t); need = r2(need - t); });
      }
      var res = await API.call('recordPayment', p);
      if (res.success) { done.push({ r: r, res: res, amount: part }); r.balance = r2(r.balance - part); left = r2(left - part); }
      else if (res.queued) { queued = true; r.balance = r2(r.balance - part); left = r2(left - part); done.push({ r: r, res: { paymentNo: 'pending', balance: r.balance }, amount: part }); }
      else { failed = res.error || 'Not saved'; break; }
    }
    V.busy(btn, false);
    if (failed && !done.length) return V.msg('colMsg', failed);
    V.data.receivables = V.data.receivables.filter(function (x) { return x.balance > 0.009; });
    M._lastReceipt = { patientName: recs[0].patientName, phone: recs[0].phone, amount: r2(amt - left), mode: mode, ref: V.val('colRef'), date: V.val('colDate') || V.today(),
      lines: done.map(function (d) { return { label: recLabel(d.r), no: d.res.paymentNo, amount: d.amount, after: d.res.balance }; }), stillDue: r2(due - (amt - left)) };
    V.dialog('✅ Payment saved',
      '<p class="v-big-ok">' + inr(M._lastReceipt.amount) + ' received from <b>' + h(recs[0].patientName) + '</b>' + (queued ? '<br><small>📴 Saved on this device — will sync automatically</small>' : '') + '</p>'
      + (failed ? '<p class="v-bad">Part of it was not saved: ' + h(failed) + '</p>' : '')
      + '<p>Still due: <b>' + inr(M._lastReceipt.stillDue) + '</b></p>'
      + '<div class="v-actions"><button type="button" class="v-btn v-primary" data-act="payReceiptPrint">🖨️ Print receipt</button>'
      + (recs[0].phone ? '<button type="button" class="v-btn v-wa" data-act="payReceiptWa">📲 WhatsApp</button>' : '')
      + '<button type="button" class="v-btn" data-act="v31Close">Done</button></div>', { width: 420 });
    if (!queued) loadData(); else V.refresh();
  };
  function receiptHtml(rc) {
    return '<div id="__pay" style="font-family:Georgia,serif;max-width:420px;margin:0 auto;color:#111;">'
      + '<h2 style="text-align:center;margin:0;font-size:18px;">Sri Sai Speciality Dental Care</h2>'
      + '<div style="text-align:center;font-size:11px;">' + h(CONFIG.clinicAddress || '') + '<br>📞 ' + h(CONFIG.clinicPhone || '') + '</div>'
      + '<h3 style="text-align:center;letter-spacing:2px;text-decoration:underline;margin:12px 0;">PAYMENT RECEIPT</h3>'
      + '<table style="width:100%;font-size:13px;border-collapse:collapse;">'
      + '<tr><td>Date</td><td style="text-align:right;">' + h(V.fmtDate(rc.date)) + '</td></tr>'
      + '<tr><td>Received from</td><td style="text-align:right;"><b>' + h(rc.patientName) + '</b></td></tr>'
      + rc.lines.map(function (l) { return '<tr><td>' + h(l.label) + ' <small>' + h(l.no) + '</small></td><td style="text-align:right;">' + inr(l.amount) + '</td></tr>'; }).join('')
      + '<tr><td style="border-top:1px solid #000;padding-top:6px;"><b>Amount received</b></td><td style="border-top:1px solid #000;text-align:right;padding-top:6px;"><b>' + inr(rc.amount) + '</b></td></tr>'
      + '<tr><td colspan="2" style="font-size:12px;">(' + h(V.words(rc.amount)) + ') · ' + h(rc.mode) + (rc.ref ? ' · Ref ' + h(rc.ref) : '') + '</td></tr>'
      + '<tr><td>Balance still due</td><td style="text-align:right;">' + inr(rc.stillDue) + '</td></tr></table>'
      + '<p style="text-align:right;margin-top:26px;font-size:12px;">Signature</p></div>';
  }
  ACT.payReceiptPrint = function () { if (M._lastReceipt) printBillHtml(receiptHtml(M._lastReceipt)); };
  ACT.payReceiptWa = function () {
    var rc = M._lastReceipt; if (!rc) return;
    var msg = '*🦷 Sri Sai Speciality Dental Care*\n\nDear *' + rc.patientName + '*, we received *' + inr(rc.amount) + '* (' + rc.mode + ') on ' + V.fmtDate(rc.date) + '.\n'
      + (rc.stillDue > 0 ? 'Balance still due: *' + inr(rc.stillDue) + '*.\n' : 'Your account is fully settled. ✅\n') + '\nThank you! 🙏\n📞 ' + (CONFIG.clinicPhone || '');
    openWhatsApp(V.waPhone(rc.phone), msg);
  };
  ACT.remindDue = function (el) {
    var list = V.data.receivables.filter(function (r) { return M.patientKey(r) === el.dataset.key; }); if (!list.length) return;
    var p = list[0], due = r2(list.reduce(function (a, r) { return a + r.balance; }, 0));
    if (!p.phone) { V.toast('No phone number for this patient', 'warning'); return; }
    var msg = '*🦷 Sri Sai Speciality Dental Care*\n\nHello *' + p.patientName + '*! 😊\nA balance of *' + inr(due) + '* is pending'
      + ' (' + list.map(function (r) { return (r.no || r.id) + ' — ' + inr(r.balance); }).join(', ') + ').\n'
      + (CONFIG.upiId ? 'You can pay by UPI to *' + CONFIG.upiId + '*.\n' : '') + 'Kindly settle at your convenience.\n\nThank you! 🙏\n📞 ' + (CONFIG.clinicPhone || '');
    openWhatsApp(V.waPhone(p.phone), msg);
  };
  // a bill just saved with money still due shows in Dues straight away
  M.noteDue = function (type, b) {
    if (M.receivable(type, b.billId)) return;
    V.data.receivables.push({ type: type, id: b.billId, no: b.billNo || b.billId, date: b.date, patientId: b.patientId || '', patientName: b.patientName, phone: b.phone || '',
      doctor: b.doctor || '', total: +b.total || 0, paid: +b.paidAmount || 0, returned: 0, refunded: 0, balance: +b.balanceDue || 0 });
    V.refresh();
  };
  ACT.collect = function (el) {
    if (el.dataset.key) return M.openCollect(V.data.receivables.filter(function (r) { return M.patientKey(r) === el.dataset.key; }));
    M.openCollect([M.receivable(el.dataset.type, el.dataset.id)]);
  };

  // ═══════════ bill detail: payments + returns ═══════════
  M.findInvoice = function (type, id) {
    if (type === 'BILL') return (window.bills || []).find(function (b) { return String(b.billId) === String(id); }) || null;
    return (window.serverTreatments || []).find(function (t) { return String(t.recordId || t.no) === String(id); }) || null;
  };
  ACT.billDetail = function (el) { M.openDetail(el.dataset.type || 'BILL', el.dataset.id); };
  M.openDetail = async function (type, id) {
    var inv = M.findInvoice(type, id), rec = M.receivable(type, id);
    if (!inv && type === 'BILL' && API.isOwner()) {
      var got = await API.call('getBills', { q: id, limit: 3 });
      if (got.success) inv = (got.bills || []).find(function (b) { return String(b.billId) === String(id); }) || null;
    }
    var base = inv ? (type === 'BILL'
      ? { no: inv.billNo || inv.billId, date: inv.date, patient: inv.patientName, phone: inv.phone, doctor: inv.doctor, total: +inv.total || 0, paid: inv.paidAmount !== undefined ? inv.paidAmount : +inv.total, returned: inv.returnedValue || 0, refunded: inv.refundedAmount || 0, items: inv.items || [], subtotal: +inv.subtotal || 0, discount: +inv.discount || 0, mode: inv.paymentMode }
      : { no: inv.no, date: inv.date, patient: inv.patient, phone: '', doctor: inv.doctor, total: +inv.amount || 0, paid: inv.paidAmount !== undefined ? inv.paidAmount : +inv.amount, returned: inv.returnedValue || 0, refunded: inv.refundedAmount || 0, items: [], treatments: inv.treatments, mode: inv.paymentMode })
      : rec ? { no: rec.no, date: rec.date, patient: rec.patientName, phone: rec.phone, doctor: rec.doctor, total: rec.total, paid: rec.paid, returned: rec.returned, refunded: rec.refunded, items: [] } : null;
    if (!base) { V.toast('Bill not found on this device', 'warning'); return; }
    base.balance = r2(base.total - base.returned - (base.paid - base.refunded));
    M._detail = { type: type, id: id, base: base, inv: inv };
    V.dialog((type === 'BILL' ? '💊 Bill ' : '🦷 Receipt ') + h(base.no || id),
      '<div class="v-sum"><div><span>Patient</span><b>' + h(base.patient || '—') + '</b></div><div><span>Date</span><b>' + h(V.fmtDate(base.date)) + '</b></div>'
      + (base.doctor ? '<div><span>Doctor</span><b>' + h(base.doctor) + '</b></div>' : '') + '</div>'
      + (base.items.length ? V.table(['Item', 'Qty', 'Rate', 'Amount'], base.items.map(function (i) { return '<tr><td>' + h(i.medicineName || i.name) + '</td>' + V.td(i.qty, 1) + V.td(inr(i.price), 1) + V.td(inr(i.amount), 1) + '</tr>'; })) : '')
      + (base.treatments ? '<p class="v-note">🦷 ' + h(base.treatments) + '</p>' : '')
      + '<div class="v-money">' + [['Total', base.total], base.returned ? ['Returned', -base.returned] : null, ['Paid', base.paid], base.refunded ? ['Paid back', -base.refunded] : null]
        .filter(Boolean).map(function (x) { return '<div><span>' + x[0] + '</span><b>' + inr(x[1]) + '</b></div>'; }).join('')
      + '<div class="v-money-due"><span>Balance due</span><b>' + inr(base.balance) + '</b></div></div>'
      + '<h4 class="v-h4">Payments &amp; returns</h4><div id="detPays">Loading…</div>'
      + '<div class="v-actions">'
      + (base.balance > 0.009 ? '<button type="button" class="v-btn v-primary" data-act="collect" data-type="' + type + '" data-id="' + h(id) + '">💰 Collect</button>' : '')
      + (API.isOwner() && base.total - base.returned > 0.009 ? '<button type="button" class="v-btn v-warn" data-act="openRefund">↩️ Return / Refund</button>' : '')
      + '</div>', { width: 620 });
    var res = await API.call('getPayments', { againstId: id });
    var el = document.getElementById('detPays'); if (!el) return;
    if (!res.success) { el.textContent = res.error || 'Could not load payments'; return; }
    M._detail.payments = res.payments;
    var initial = r2(base.paid - res.payments.filter(function (p) { return p.type === 'COLLECTION' && p.status === 'Active'; }).reduce(function (a, p) { return a + p.amount; }, 0));
    var rows = [];
    if (initial > 0) rows.push('<tr><td>' + h(V.fmtDate(base.date)) + '</td><td>Paid with bill</td><td>' + h(base.mode || '') + '</td>' + V.td(inr(initial), 1) + '<td></td><td></td></tr>');
    res.payments.forEach(function (p) {
      var cancelled = p.status === 'Cancelled';
      rows.push('<tr' + (cancelled ? ' class="v-strike"' : '') + '><td>' + h(V.fmtDate(p.date)) + '</td><td>' + (p.type === 'REFUND' ? '↩️ ' + h(p.no) + (p.items.length ? '<br><small>' + h(p.items.map(function (i) { return i.name + ' ×' + i.qty; }).join(', ')) + '</small>' : '') + '<br><small>' + h(p.notes) + '</small>' : '💰 ' + h(p.no)) + '</td>'
        + '<td>' + h(p.mode) + (p.ref ? '<br><small>' + h(p.ref) + '</small>' : '') + '</td>' + V.td((p.type === 'REFUND' ? '−' : '') + inr(p.amount) + (p.type === 'REFUND' && p.creditValue ? '<br><small>credit ' + inr(p.creditValue) + '</small>' : ''), 1)
        + '<td><small>' + h(p.createdBy) + '</small></td><td>' + (cancelled ? '<small>cancelled: ' + h(p.cancelReason) + '</small>' : (API.isOwner() && p.type === 'COLLECTION' ? '<button type="button" class="v-btn v-sm v-danger" data-act="cancelPay" data-id="' + h(p.id) + '">✖</button>' : '')) + '</td></tr>');
    });
    el.innerHTML = V.table(['Date', 'What', 'Mode', 'Amount', 'By', ''], rows, { empty: 'No payments yet.' });
  };
  ACT.cancelPay = async function (el) {
    var reason = (prompt('Cancel this payment? The amount becomes due again.\n\nReason (required):') || '').trim();
    if (reason.length < 3) return;
    var res = await API.call('cancelPayment', { paymentId: el.dataset.id, reason: reason }, { noQueue: true });
    if (!res.success) return V.toast('❌ ' + res.error, 'error');
    V.toast('Payment cancelled'); await loadData(); if (M._detail) M.openDetail(M._detail.type, M._detail.id);
  };

  // ═══════════ return / refund (owner) ═══════════
  ACT.openRefund = function () {
    var d = M._detail; if (!d) return;
    var b = d.base, returned = {};
    (d.payments || []).forEach(function (p) { if (p.type === 'REFUND' && p.status === 'Active') p.items.forEach(function (i) { returned[i.medicineId] = (returned[i.medicineId] || 0) + (+i.qty || 0); }); });
    var lines = {}; (b.items || []).forEach(function (i) { var k = String(i.medicineId); var o = lines[k] = lines[k] || { id: k, name: i.medicineName || i.name, qty: 0, price: +i.price || 0 }; o.qty += +i.qty || 0; });
    var ratio = b.subtotal > 0 ? Math.max(0, 1 - b.discount / b.subtotal) : 1;
    M._refund = { lines: Object.keys(lines).map(function (k) { var o = lines[k]; o.left = o.qty - (returned[k] || 0); return o; }), ratio: ratio };
    V.dialog('↩️ Return / Refund · ' + h(b.no),
      (M._refund.lines.length ? '<p class="v-note">How many of each medicine came back?</p>' + V.table(['Medicine', 'Sold', 'Can return', 'Return now'], M._refund.lines.map(function (l, i) {
        return '<tr><td>' + h(l.name) + '</td>' + V.td(l.qty, 1) + V.td(l.left, 1) + '<td class="num"><input class="v-in v-in-sm" type="number" min="0" max="' + l.left + '" step="1" value="0" id="rfQ' + i + '" data-input="rfCalc"' + (l.left ? '' : ' disabled') + '></td></tr>';
      })) + '<label class="v-check"><input type="checkbox" id="rfRestock" checked data-change="rfCalc"> Put returned medicines back in stock (unopened, sellable)</label>' : '')
      + V.field('rfAllow', (M._refund.lines.length ? 'Extra amount to reduce / give back (₹) — optional' : 'Amount to reduce / give back (₹)'), V.input('rfAllow', 'type="number" min="0" step="0.01" value="0" data-input="rfCalc"'))
      + '<div id="rfPreview" class="v-money"></div>'
      + '<div id="rfModeWrap" hidden><label class="v-lbl">Give money back by</label>' + V.modeButtons('rf', 'Cash', [['Cash', '💵 Cash'], ['UPI', '📱 UPI'], ['Card', '💳 Card']]) + '</div>'
      + V.field('rfReason', 'Reason (required)', V.input('rfReason', 'maxlength="200" placeholder="e.g. doctor changed the medicine"'))
      + '<div id="rfMsg" class="v-msg"></div><button type="button" class="v-btn v-warn v-wide" data-act="rfSave">Save return / refund</button>', { width: 560 });
    ACT.rfCalc();
  };
  function rfNumbers() {
    var d = M._detail.base, rf = M._refund, items = [], value = 0;
    rf.lines.forEach(function (l, i) { var q = parseInt(V.val('rfQ' + i), 10) || 0; if (q > 0) { items.push({ medicineId: l.id, qty: q, name: l.name }); value += q * l.price * rf.ratio; } });
    value = r2(value);
    var credit = r2(value + V.num('rfAllow')), netNew = r2(d.total - d.returned - credit), back = r2(Math.max(0, (d.paid - d.refunded) - netNew));
    return { items: items, value: value, credit: credit, netNew: netNew, back: back, balance: r2(netNew - (d.paid - d.refunded - back)) };
  }
  ACT.rfCalc = function () {
    var n = rfNumbers(), el = document.getElementById('rfPreview'); if (!el) return;
    el.innerHTML = '<div><span>Value of goods returned</span><b>' + inr(n.value) + '</b></div><div><span>Total reduction</span><b>' + inr(n.credit) + '</b></div>'
      + '<div><span>New bill amount</span><b>' + inr(n.netNew) + '</b></div><div class="v-money-due"><span>' + (n.back > 0 ? 'Give back now' : 'Balance due after') + '</span><b>' + inr(n.back > 0 ? n.back : n.balance) + '</b></div>';
    document.getElementById('rfModeWrap').hidden = !(n.back > 0);
  };
  ACT.rfSave = async function (btn) {
    var d = M._detail, n = rfNumbers(), reason = V.val('rfReason');
    if (n.credit <= 0) return V.msg('rfMsg', 'Choose items to return or enter an amount');
    if (n.netNew < -0.009) return V.msg('rfMsg', 'That is more than the bill');
    if (M._refund.lines.some(function (l, i) { return (parseInt(V.val('rfQ' + i), 10) || 0) > l.left; })) return V.msg('rfMsg', 'Return quantity is more than what can be returned');
    if (reason.length < 3) return V.msg('rfMsg', 'Please write a reason');
    if (!confirm(n.back > 0 ? 'Give back ' + inr(n.back) + ' to ' + d.base.patient + '?' : 'Reduce this bill by ' + inr(n.credit) + '?')) return;
    V.busy(btn, true);
    var res = await API.call('returnRefund', { againstType: d.type, againstId: d.id, items: JSON.stringify(n.items.map(function (i) { return { medicineId: i.medicineId, qty: i.qty }; })),
      restock: !!(document.getElementById('rfRestock') || {}).checked, allowance: V.num('rfAllow'), mode: V.modeOf('rf'), reason: reason }, { noQueue: true });
    V.busy(btn, false);
    if (!res.success) return V.msg('rfMsg', res.error || 'Not saved');
    V.toast('↩️ ' + res.refundNo + (res.refundAmount > 0 ? ' · give back ' + inr(res.refundAmount) : ' · bill reduced by ' + inr(res.creditValue)));
    await loadData(); M.openDetail(d.type, d.id);
  };

  // ═══════════ Dues & Payments page ═══════════
  M.patientKey = function (r) { return r.patientId ? 'id:' + r.patientId : 'n:' + String(r.patientName || '').trim().toLowerCase() + '|' + V.normPhone(r.phone); };
  V.tabRender.pay = function () { V.pages.payments(); };
  V.pages.payments = function () {
    var page = document.getElementById('payments'); if (!page) return;
    var tab = V.tabState.pay || 'dues', recs = V.data.receivables, today = V.today();
    var totalDue = r2(recs.reduce(function (a, r) { return a + r.balance; }, 0)), keys = {};
    recs.forEach(function (r) { keys[M.patientKey(r)] = 1; });
    var todayColl = V.data.payments.filter(function (p) { return p.date === today && p.type === 'COLLECTION' && p.status === 'Active'; });
    var old = recs.filter(function (r) { return r.date && V.daysBetween(r.date, today) > 30; });
    var html = V.kpis([
      { label: 'Total due from patients', value: inr(totalDue, 0), sub: Object.keys(keys).length + ' patient(s)', tone: totalDue > 0 ? 'warn' : 'ok' },
      { label: 'Due for over 30 days', value: inr(old.reduce(function (a, r) { return a + r.balance; }, 0), 0), sub: old.length + ' bill(s)', tone: old.length ? 'bad' : '' },
      { label: 'Collected today (dues)', value: inr(todayColl.reduce(function (a, p) { return a + p.amount; }, 0), 0), sub: todayColl.length + ' payment(s)' }
    ]) + V.tabs('pay', [['dues', '🧾 Who owes'], ['history', '💰 Payments'], ['refunds', '↩️ Returns & refunds']], tab);
    if (tab === 'dues') {
      html += '<div class="v-toolbar"><input id="duesQ" class="v-in" type="search" placeholder="🔍 Search name, phone or bill no" value="' + h(M._duesQ || '') + '" data-input="duesSearch"></div><div id="duesList"></div>';
    } else if (tab === 'history') {
      html += '<div class="v-toolbar"><label>From <input id="phFrom" class="v-in" type="date" value="' + (M._phFrom || V.addDays(today, -30)) + '" data-change="phLoad"></label>'
        + '<label>To <input id="phTo" class="v-in" type="date" value="' + (M._phTo || today) + '" data-change="phLoad"></label></div><div id="phList"></div>';
    } else html += '<div id="rfList"></div>';
    page.innerHTML = html;
    if (tab === 'dues') renderDues(); else if (tab === 'history') renderHistory(); else renderRefunds();
  };
  ACT.duesSearch = function (el) { M._duesQ = el.value; renderDues(); };
  function renderDues() {
    var el = document.getElementById('duesList'); if (!el) return;
    var q = String(M._duesQ || '').trim().toLowerCase(), groups = {}, order = [], today = V.today();
    V.data.receivables.forEach(function (r) {
      if (q && (r.patientName + ' ' + r.phone + ' ' + r.no + ' ' + r.id).toLowerCase().indexOf(q) === -1) return;
      var k = M.patientKey(r); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(r);
    });
    order.sort(function (a, b) { return groups[b].reduce(function (s, r) { return s + r.balance; }, 0) - groups[a].reduce(function (s, r) { return s + r.balance; }, 0); });
    if (!order.length) { el.innerHTML = '<div class="v-empty">' + (q ? 'No match.' : '✅ No one owes the clinic anything.') + '</div>'; return; }
    el.innerHTML = order.map(function (k) {
      var list = groups[k], p = list[0], due = r2(list.reduce(function (a, r) { return a + r.balance; }, 0));
      return '<div class="v-card v-due-card"><div class="v-due-head"><div><b>' + h(p.patientName || '—') + '</b> <span class="v-muted">' + h(p.phone || '') + '</span></div>'
        + '<div class="v-due-amt">' + inr(due) + '</div></div>'
        + '<div class="v-due-rows">' + list.map(function (r) {
          var age = r.date ? V.daysBetween(r.date, today) : 0;
          return '<div class="v-due-row"><button type="button" class="v-link" data-act="' + (r.type === 'OPENING' ? 'collect' : 'billDetail') + '" data-type="' + r.type + '" data-id="' + h(r.id) + '">' + h(recLabel(r)) + '</button>'
            + '<span class="v-muted">' + h(V.fmtDate(r.date)) + (age > 30 ? ' · <span class="v-bad">' + age + ' days</span>' : '') + '</span>'
            + '<span class="num">' + inr(r.total) + ' · paid ' + inr(r.paid - r.refunded) + '</span><b class="num">' + inr(r.balance) + '</b></div>';
        }).join('') + '</div>'
        + '<div class="v-actions"><button type="button" class="v-btn v-primary v-sm" data-act="collect" data-key="' + h(k) + '">💰 Collect</button>'
        + (p.phone ? '<button type="button" class="v-btn v-wa v-sm" data-act="remindDue" data-key="' + h(k) + '">📲 Remind</button>' : '') + '</div></div>';
    }).join('');
  }
  ACT.phLoad = function () { M._phFrom = V.val('phFrom'); M._phTo = V.val('phTo'); renderHistory(); };
  async function renderHistory() {
    var el = document.getElementById('phList'); if (!el) return;
    var from = V.val('phFrom'), to = V.val('phTo'), list;
    if (from >= (V.data.loadedFrom || '0000')) list = V.data.payments.filter(function (p) { return p.date >= from && p.date <= to; });
    else { el.innerHTML = 'Loading…'; var res = await API.call('getPayments', { from: from, to: to }); list = res.success ? res.payments : []; if (!res.success) { el.textContent = res.error; return; } }
    list = list.filter(function (p) { return p.type === 'COLLECTION'; }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    var tot = { Cash: 0, UPI: 0, Card: 0, Split: 0 };
    list.forEach(function (p) { if (p.status === 'Active') { tot.Cash += p.cashAmount; tot.UPI += p.upiAmount; tot.Card += p.cardAmount; } });
    el.innerHTML = '<p class="v-note">Total: <b>' + inr(tot.Cash + tot.UPI + tot.Card) + '</b> · Cash ' + inr(tot.Cash) + ' · UPI ' + inr(tot.UPI) + ' · Card ' + inr(tot.Card) + '</p>'
      + V.table(['Date', 'Receipt', 'Patient', 'For', 'Mode', 'Amount', 'By', ''], list.map(function (p) {
        var c = p.status === 'Cancelled';
        return '<tr' + (c ? ' class="v-strike"' : '') + '><td>' + h(V.fmtDate(p.date)) + '</td><td><small>' + h(p.no) + '</small></td><td>' + h(p.patientName) + '</td>'
          + '<td><button type="button" class="v-link" data-act="billDetail" data-type="' + h(p.againstType) + '" data-id="' + h(p.againstId) + '">' + h(p.againstNo || p.againstId) + '</button></td>'
          + '<td>' + h(p.mode) + '</td>' + V.td(inr(p.amount), 1) + '<td><small>' + h(p.createdBy) + '</small></td>'
          + '<td>' + (!c && API.isOwner() ? '<button type="button" class="v-btn v-sm v-danger" data-act="cancelPay" data-id="' + h(p.id) + '">✖</button>' : (c ? '<small>' + h(p.cancelReason) + '</small>' : '')) + '</td></tr>';
      }), { empty: 'No payments in this period.' });
  }
  function renderRefunds() {
    var el = document.getElementById('rfList'); if (!el) return;
    var list = V.data.payments.filter(function (p) { return p.type === 'REFUND'; }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    el.innerHTML = V.table(['Date', 'No', 'Patient', 'Bill', 'Items', 'Reduced', 'Paid back', 'Reason'], list.map(function (p) {
      return '<tr><td>' + h(V.fmtDate(p.date)) + '</td><td><small>' + h(p.no) + '</small></td><td>' + h(p.patientName) + '</td>'
        + '<td><button type="button" class="v-link" data-act="billDetail" data-type="' + h(p.againstType) + '" data-id="' + h(p.againstId) + '">' + h(p.againstNo || p.againstId) + '</button></td>'
        + '<td><small>' + h(p.items.map(function (i) { return i.name + ' ×' + i.qty; }).join(', ') || '—') + '</small></td>' + V.td(inr(p.creditValue), 1)
        + V.td(p.amount ? inr(p.amount) + ' <small>' + h(p.mode) + '</small>' : '—', 1) + '<td><small>' + h(p.notes) + '</small></td></tr>';
    }), { empty: 'No returns or refunds in the loaded period.' });
  }

  // ═══════════ cash closing ═══════════
  var NOTES = [500, 200, 100, 50, 20, 10];
  V.pages.cashclose = async function () {
    var page = document.getElementById('cashclose'); if (!page) return;
    var date = M._ccDate || V.today(), min = API.isOwner() ? '' : V.addDays(V.today(), -3);
    page.innerHTML = '<div class="v-toolbar"><label>Day <input id="ccDate" class="v-in" type="date" value="' + date + '" max="' + V.today() + '"' + (min ? ' min="' + min + '"' : '') + ' data-change="ccDay"></label></div><div id="ccBody">Loading…</div>';
    var res = await API.call('getCashSummary', { date: date }), el = document.getElementById('ccBody'); if (!el) return;
    if (!res.success) { el.innerHTML = '<div class="v-empty">' + h(res.error || 'Could not load (offline?)') + '</div>'; return; }
    var s = res.summary, c = res.closing; M._cc = res;
    var line = function (label, o, sign) { return '<tr><td>' + label + '</td>' + V.td((sign || '') + inr(o.cash), 1) + V.td(inr(o.upi), 1) + V.td(inr(o.card), 1) + '</tr>'; };
    var html = '<div class="v-grid2"><div class="v-card"><h3 class="v-h3">Money in and out · ' + h(V.fmtDate(date)) + '</h3>'
      + V.table(['', 'Cash', 'UPI', 'Card'], [line('💊 Pharmacy bills (' + s.counts.bills + ')', s.bills), line('🦷 Dental receipts (' + s.counts.receipts + ')', s.receipts),
        line('💰 Dues collected (' + s.counts.collections + ')', s.collections), line('↩️ Refunds (' + s.counts.refunds + ')', s.refunds, '−'),
        line('💸 Expenses (' + s.counts.expenses + ')', s.expenses, '−'), line('🏭 Supplier payments (' + s.counts.suppliers + ')', s.suppliers, '−')],
        { foot: '<tr><th>Net</th>' + V.td('<b>' + inr(s.cashIn - s.cashOut) + '</b>', 1) + V.td('<b>' + inr(s.upiIn) + '</b>', 1) + V.td('<b>' + inr(s.cardIn) + '</b>', 1) + '</tr>' })
      + '</div><div class="v-card">';
    if (c) {
      html += '<h3 class="v-h3">✅ Closed by ' + h(c.closedBy) + '</h3><div class="v-money"><div><span>Opening cash</span><b>' + inr(c.openingCash) + '</b></div>'
        + '<div><span>Expected in drawer</span><b>' + inr(c.expectedCash) + '</b></div><div><span>Counted</span><b>' + inr(c.countedCash) + '</b></div>'
        + '<div class="v-money-due"><span>Difference</span><b class="' + (Math.abs(c.difference) > 0.009 ? 'v-bad' : 'v-ok') + '">' + inr(c.difference) + '</b></div>'
        + '<div><span>Taken out / deposited</span><b>' + inr(c.deposited) + '</b></div><div><span>UPI ' + inr(c.upiTotal) + '</span><b>' + (c.upiVerified ? '✅ checked' : '—') + '</b></div>'
        + '<div><span>Card ' + inr(c.cardTotal) + '</span><b>' + (c.cardVerified ? '✅ checked' : '—') + '</b></div></div>' + (c.notes ? '<p class="v-note">' + h(c.notes) + '</p>' : '')
        + (API.isOwner() ? '<button type="button" class="v-btn" data-act="ccEdit">✏️ Change this closing</button>' : '');
    } else html += closingForm(res);
    html += '</div></div>';
    if (API.isOwner()) html += '<div class="v-card"><h3 class="v-h3">Recent closings</h3>' + V.table(['Day', 'Expected', 'Counted', 'Difference', 'UPI', 'Card', 'By'], V.data.cashClosings.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 31).map(function (x) {
      return '<tr><td>' + h(V.fmtDate(x.date)) + '</td>' + V.td(inr(x.expectedCash), 1) + V.td(inr(x.countedCash), 1) + V.td('<span class="' + (Math.abs(x.difference) > 0.009 ? 'v-bad' : 'v-ok') + '">' + inr(x.difference) + '</span>', 1)
        + V.td(inr(x.upiTotal) + (x.upiVerified ? ' ✅' : ''), 1) + V.td(inr(x.cardTotal) + (x.cardVerified ? ' ✅' : ''), 1) + '<td><small>' + h(x.closedBy) + '</small></td></tr>';
    }), { empty: 'No days closed yet.' }) + '</div>';
    el.innerHTML = html;
    if (!c) ACT.ccCount();
  };
  function closingForm(res, c) {
    var s = res.summary, open = c ? c.openingCash : res.suggestedOpening;
    return '<h3 class="v-h3">Close the day</h3>'
      + V.field('ccOpen', 'Cash in drawer at start of day (₹)', V.input('ccOpen', 'type="number" min="0" step="1" value="' + open + '" data-input="ccCount"'))
      + '<label class="v-lbl">Count the cash now</label><div class="v-notes">' + NOTES.map(function (n) {
        return '<label>₹' + n + ' × <input class="v-in v-in-sm" type="number" min="0" step="1" id="ccN' + n + '" data-input="ccCount"></label>';
      }).join('') + '<label>Coins ₹ <input class="v-in v-in-sm" type="number" min="0" step="1" id="ccCoins" data-input="ccCount"></label></div>'
      + V.field('ccCounted', 'Cash counted (₹)', V.input('ccCounted', 'type="number" min="0" step="1" value="' + (c ? c.countedCash : '') + '" data-input="ccCount"'))
      + '<div id="ccCheck" class="v-money"></div>'
      + V.field('ccDep', 'Taken out of the drawer / deposited (₹)', V.input('ccDep', 'type="number" min="0" step="1" value="' + (c ? c.deposited : 0) + '"'))
      + '<label class="v-check"><input type="checkbox" id="ccUpi"' + (c && c.upiVerified ? ' checked' : '') + '> UPI app shows ' + inr(s.upiIn) + ' for today</label>'
      + '<label class="v-check"><input type="checkbox" id="ccCard"' + (c && c.cardVerified ? ' checked' : '') + '> Card machine shows ' + inr(s.cardIn) + '</label>'
      + V.field('ccNotes', 'Notes', V.input('ccNotes', 'maxlength="300" value="' + h(c ? c.notes : '') + '"'))
      + '<div id="ccMsg" class="v-msg"></div><button type="button" class="v-btn v-primary v-wide" data-act="ccSave">🔒 Close the day</button>';
  }
  V.pages.cashclose.noAutoRefresh = true;
  ACT.ccDay = function (el) { M._ccDate = el.value; V.pages.cashclose(); };
  ACT.ccEdit = function () {
    var el = document.querySelector('#ccBody .v-grid2 > .v-card:last-child'); if (!el || !M._cc) return;
    el.innerHTML = closingForm(M._cc, M._cc.closing); ACT.ccCount();
  };
  ACT.ccCount = function (el) {
    var sum = 0, any = false;
    NOTES.forEach(function (n) { var q = V.num('ccN' + n); if (q) any = true; sum += q * n; });
    if (V.num('ccCoins')) any = true; sum += V.num('ccCoins');
    if (any && (!el || el.id !== 'ccCounted')) { var ce = document.getElementById('ccCounted'); if (ce) ce.value = sum; }
    var s = M._cc && M._cc.summary, chk = document.getElementById('ccCheck'); if (!s || !chk) return;
    var expected = r2(V.num('ccOpen') + s.cashIn - s.cashOut), counted = V.num('ccCounted'), diff = r2(counted - expected);
    chk.innerHTML = '<div><span>Expected in drawer</span><b>' + inr(expected) + '</b></div>'
      + (V.val('ccCounted') !== '' ? '<div class="v-money-due"><span>' + (Math.abs(diff) < 0.01 ? 'Matches ✅' : diff < 0 ? 'Short' : 'Extra') + '</span><b class="' + (Math.abs(diff) < 0.01 ? 'v-ok' : 'v-bad') + '">' + inr(diff) + '</b></div>' : '');
  };
  ACT.ccSave = async function (btn) {
    if (V.val('ccCounted') === '') return V.msg('ccMsg', 'Enter the cash counted');
    V.busy(btn, true);
    var res = await API.call('saveCashClosing', { date: V.val('ccDate'), openingCash: V.num('ccOpen'), countedCash: V.num('ccCounted'), deposited: V.num('ccDep'),
      upiVerified: document.getElementById('ccUpi').checked, cardVerified: document.getElementById('ccCard').checked, notes: V.val('ccNotes') }, { noQueue: true });
    V.busy(btn, false);
    if (!res.success) return V.msg('ccMsg', res.error || 'Not saved');
    V.toast(Math.abs(res.difference) < 0.01 ? '✅ Day closed — cash matches' : '⚠️ Day closed — difference ' + inr(res.difference), Math.abs(res.difference) < 0.01 ? 'success' : 'warning');
    await loadData(); V.pages.cashclose();
  };

  // ═══════════ hooks into existing screens ═══════════
  // All Bills: payment status + details button
  M.billBadges = function (bill) {
    if (!V.enabled() || bill.syncStatus === 'failed') return '';
    var s = '';
    if (bill.balanceDue > 0.009) s += ' <span class="v-badge v-due">Due ' + inr(bill.balanceDue, 0) + '</span>';
    if (bill.returnedValue > 0.009) s += ' <span class="v-badge v-ret">↩ ' + inr(bill.returnedValue, 0) + '</span>';
    return s;
  };
  M.billButton = function (bill) {
    if (!V.enabled() || bill.syncStatus === 'pending' || bill.syncStatus === 'saving' || bill.syncStatus === 'failed') return '';
    return '<button type="button" class="btn-primary btn-small" data-act="billDetail" data-type="BILL" data-id="' + h(bill.billId) + '" title="Payments, returns, refunds" style="margin-right:4px;background:#8e44ad;">💰</button>';
  };
  V.afterRefresh.push(function () { if (document.getElementById('pp_pm')) M.mountPartPay(); });
  document.addEventListener('DOMContentLoaded', function () { M.mountPartPay(); });
})();
;

;/* ══ FILE: 15-suppliers.js ══════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════
   15-suppliers.js — suppliers, purchase invoices (many lines, paid or on
   credit, photo/PDF attached), supplier payments + ledger, purchase returns
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var V = window.V31, ACT = V.act, h = V.h, inr = V.inr, r2 = V.r2;
  var S = V.sup = {};

  // ── full-screen sheet (dialogs can open on top of it) ──
  V.sheet = function (title, body) {
    V.closeSheet();
    var ov = document.createElement('div'); ov.id = 'v31Sheet'; ov.className = 'v-sheet'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', title);
    ov.innerHTML = '<div class="v-sheet-box"><div class="v-sheet-head"><h3>' + title + '</h3><button type="button" class="v-x" data-act="closeSheet" aria-label="Close">✕</button></div><div class="v-sheet-body" id="v31SheetBody">' + body + '</div></div>';
    document.body.appendChild(ov);
    return ov;
  };
  V.closeSheet = function () { var s = document.getElementById('v31Sheet'); if (s) s.remove(); };
  ACT.closeSheet = function () { if (!S._dirty || confirm('Close without saving?')) { S._dirty = false; V.closeSheet(); } };

  S.byId = function (id) { return V.data.suppliers.find(function (x) { return x.id === id; }) || null; };
  S.active = function () { return V.data.suppliers.filter(function (x) { return x.status !== 'Inactive'; }).sort(function (a, b) { return a.name.localeCompare(b.name); }); };
  function medByName(n) { n = String(n || '').trim().toLowerCase(); return (window.medicines || []).find(function (m) { return String(m.name).trim().toLowerCase() === n; }) || null; }
  function medById(id) { return (window.medicines || []).find(function (m) { return String(m.id) === String(id); }) || null; }
  function monthEnd(ym) { if (!/^\d{4}-\d{2}$/.test(ym || '')) return ''; var d = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0); return d.toLocaleDateString('en-CA'); }

  // ═══════════ Suppliers page ═══════════
  V.pages.suppliers = function () {
    var page = document.getElementById('suppliers'); if (!page) return;
    var sups = V.data.suppliers, month = V.today().slice(0, 7);
    var owed = r2(sups.reduce(function (a, s) { return a + Math.max(0, s.balance); }, 0));
    var monthInv = V.data.purchaseInvoices.filter(function (i) { return i.status === 'Active' && i.date.slice(0, 7) === month; });
    var monthRet = V.data.purchaseReturns.filter(function (r) { return r.status === 'Active' && r.date.slice(0, 7) === month; });
    var q = String(S._q || '').toLowerCase();
    var list = sups.filter(function (s) { return !q || (s.name + ' ' + s.phone + ' ' + s.contact).toLowerCase().indexOf(q) !== -1; })
      .sort(function (a, b) { return (b.balance - a.balance) || a.name.localeCompare(b.name); });
    var lastInv = {}; V.data.purchaseInvoices.forEach(function (i) { if (i.status === 'Active' && (!lastInv[i.supplierId] || i.date > lastInv[i.supplierId])) lastInv[i.supplierId] = i.date; });
    page.innerHTML = V.kpis([
      { label: 'We owe suppliers', value: inr(owed, 0), sub: sups.filter(function (s) { return s.balance > 0.009; }).length + ' supplier(s)', tone: owed > 0 ? 'warn' : 'ok' },
      { label: 'Purchases this month', value: inr(monthInv.reduce(function (a, i) { return a + i.total; }, 0), 0), sub: monthInv.length + ' invoice(s)' },
      { label: 'Returned to suppliers this month', value: inr(monthRet.reduce(function (a, r) { return a + r.amount; }, 0), 0), sub: monthRet.length + ' return(s)' }
    ])
      + '<div class="v-toolbar"><input class="v-in" type="search" placeholder="🔍 Search suppliers" value="' + h(S._q || '') + '" data-input="supSearch">'
      + '<button type="button" class="v-btn v-primary" data-act="newInvoice">➕ New purchase invoice</button>'
      + '<button type="button" class="v-btn" data-act="editSupplier">➕ Add supplier</button></div>'
      + V.table(['Supplier', 'Purchases', 'Paid', 'Returns', 'Balance owed', 'Last invoice', ''], list.map(function (s) {
        return '<tr' + (s.status === 'Inactive' ? ' class="v-dim"' : '') + '><td><b>' + h(s.name) + '</b>' + (s.status === 'Inactive' ? ' ' + V.badge('Inactive') : '') + '<br><small class="v-muted">' + h([s.phone, s.contact].filter(Boolean).join(' · ')) + '</small></td>'
          + V.td(inr(s.purchases, 0), 1) + V.td(inr(s.payments, 0), 1) + V.td(inr(s.returns, 0), 1)
          + V.td('<b class="' + (s.balance > 0.009 ? 'v-bad' : s.balance < -0.009 ? 'v-ok' : '') + '">' + inr(s.balance) + '</b>' + (s.balance < -0.009 ? '<br><small>advance</small>' : ''), 1)
          + '<td>' + h(V.fmtDate(lastInv[s.id])) + '</td><td class="v-nowrap">'
          + '<button type="button" class="v-btn v-sm" data-act="supLedger" data-id="' + h(s.id) + '">📒 Ledger</button> '
          + '<button type="button" class="v-btn v-sm v-primary" data-act="supPay" data-id="' + h(s.id) + '">💸 Pay</button> '
          + '<button type="button" class="v-btn v-sm" data-act="supReturn" data-id="' + h(s.id) + '">↩️ Return</button> '
          + '<button type="button" class="v-btn v-sm" data-act="editSupplier" data-id="' + h(s.id) + '">✏️</button></td></tr>';
      }), { empty: 'No suppliers yet — they are created automatically from purchase invoices.' });
  };
  ACT.supSearch = function (el) { S._q = el.value; V.pages.suppliers(); var i = document.querySelector('#suppliers input[type=search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } };

  ACT.editSupplier = function (el) {
    var s = el && el.dataset.id ? S.byId(el.dataset.id) : null;
    V.dialog(s ? '✏️ ' + h(s.name) : '➕ New supplier',
      V.field('spName', 'Name', V.input('spName', 'maxlength="120" value="' + h(s ? s.name : '') + '"'))
      + '<div class="v-row2">' + V.field('spPhone', 'Phone', V.input('spPhone', 'type="tel" maxlength="20" value="' + h(s ? s.phone : '') + '"'))
      + V.field('spContact', 'Contact person', V.input('spContact', 'maxlength="80" value="' + h(s ? s.contact : '') + '"')) + '</div>'
      + V.field('spAddr', 'Address', V.input('spAddr', 'maxlength="300" value="' + h(s ? s.address : '') + '"'))
      + V.field('spOpen', 'Amount owed before using this app (₹)', V.input('spOpen', 'type="number" step="0.01" value="' + (s ? s.openingBalance : 0) + '"'))
      + V.field('spNotes', 'Notes', V.input('spNotes', 'maxlength="500" value="' + h(s ? s.notes : '') + '"'))
      + (s ? '<label class="v-check"><input type="checkbox" id="spInactive"' + (s.status === 'Inactive' ? ' checked' : '') + '> Not used any more (hide)</label>' : '')
      + '<div id="spMsg" class="v-msg"></div><button type="button" class="v-btn v-primary v-wide" data-act="saveSupplier" data-id="' + h(s ? s.id : '') + '">Save supplier</button>', { width: 480 });
  };
  ACT.saveSupplier = async function (btn) {
    if (!V.val('spName')) return V.msg('spMsg', 'Name is required');
    V.busy(btn, true);
    var res = await API.call('saveSupplier', { id: btn.dataset.id, name: V.val('spName'), phone: V.val('spPhone'), contact: V.val('spContact'), address: V.val('spAddr'),
      openingBalance: V.num('spOpen'), notes: V.val('spNotes'), status: (document.getElementById('spInactive') || {}).checked ? 'Inactive' : 'Active' }, { noQueue: true });
    V.busy(btn, false);
    if (!res.success) return V.msg('spMsg', res.error);
    V.close(); V.toast('✅ Supplier saved'); loadData();
  };

  // ── ledger ──
  ACT.supLedger = async function (el) {
    var id = el.dataset.id; S._ledgerId = id;
    V.sheet('📒 Supplier ledger', 'Loading…');
    var res = await API.call('getSupplierLedger', { supplierId: id }), body = document.getElementById('v31SheetBody'); if (!body) return;
    if (!res.success) { body.textContent = res.error; return; }
    var s = res.supplier;
    body.innerHTML = '<div class="v-sum"><div><span>Supplier</span><b>' + h(s.name) + '</b></div><div><span>Phone</span><b>' + h(s.phone || '—') + '</b></div>'
      + '<div class="v-sum-big"><span>Balance owed</span><b>' + inr(s.balance) + '</b></div></div>'
      + '<div class="v-actions"><button type="button" class="v-btn v-primary" data-act="supPay" data-id="' + h(s.id) + '">💸 Pay supplier</button>'
      + '<button type="button" class="v-btn" data-act="supReturn" data-id="' + h(s.id) + '">↩️ Return stock</button>'
      + '<button type="button" class="v-btn" data-act="newInvoice" data-id="' + h(s.id) + '">➕ New invoice</button>'
      + '<button type="button" class="v-btn" data-act="ledgerXlsx">⬇️ Excel</button></div>'
      + '<h4 class="v-h4">Statement</h4>'
      + V.table(['Date', 'Entry', 'Reference', 'We owe +', 'Paid / returned −', 'Balance', ''], [
        '<tr><td></td><td>Opening balance</td><td></td>' + V.td(s.openingBalance ? inr(s.openingBalance) : '', 1) + '<td></td>' + V.td(inr(s.openingBalance), 1) + '<td></td></tr>'
      ].concat(res.entries.map(function (e) {
        var c = e.status === 'Cancelled';
        return '<tr' + (c ? ' class="v-strike"' : '') + '><td>' + h(V.fmtDate(e.date)) + '</td><td>' + h({ PURCHASE: '🧾 Purchase', PAYMENT: '💸 Payment', RETURN: '↩️ Return', ADJUSTMENT: '✏️ Adjustment', OPENING: 'Opening' }[e.type] || e.type)
          + (e.mode ? ' <small>' + h(e.mode) + '</small>' : '') + '<br><small class="v-muted">' + h(e.notes) + '</small></td><td><small>' + h(e.ref) + '</small></td>'
          + V.td(e.credit ? inr(e.credit) : '', 1) + V.td(e.debit ? inr(e.debit) : '', 1) + V.td(c ? '<small>cancelled</small>' : inr(e.balanceAfter), 1)
          + '<td>' + (!c && e.type === 'PAYMENT' && e.notes !== 'Paid with invoice' ? '<button type="button" class="v-btn v-sm v-danger" data-act="cancelSupEntry" data-id="' + h(e.id) + '">✖</button>' : '') + '</td></tr>';
      })), {})
      + '<h4 class="v-h4">Invoices</h4>' + invoiceTable(res.invoices)
      + (res.returns.length ? '<h4 class="v-h4">Returns</h4>' + V.table(['Date', 'Medicine', 'Batch', 'Qty', 'Amount', 'Reason'], res.returns.map(function (r) {
        return '<tr><td>' + h(V.fmtDate(r.date)) + '</td><td>' + h(r.medicineName) + '</td><td>' + h(r.batchNo) + '</td>' + V.td(r.qty, 1) + V.td(inr(r.amount), 1) + '<td><small>' + h(r.reason) + '</small></td></tr>';
      })) : '')
      + (res.olderPurchases.length ? '<details class="v-details"><summary>Older purchases (before invoices — counted as paid): ' + res.olderPurchases.length + '</summary>'
        + V.table(['Date', 'Medicine', 'Qty', 'Cost', 'Invoice'], res.olderPurchases.map(function (p) { return '<tr><td>' + h(V.fmtDate(p.date)) + '</td><td>' + h(p.medicineName) + '</td>' + V.td(p.qty, 1) + V.td(inr(p.totalCost), 1) + '<td>' + h(p.invoiceNo) + '</td></tr>'; })) + '</details>' : '');
    S._ledger = res;
  };
  ACT.ledgerXlsx = function () {
    var r = S._ledger; if (!r || !V.xlsx) return;
    V.xlsx.download('Ledger ' + r.supplier.name + '.xlsx', [{ name: 'Statement', rows: [['Date', 'Entry', 'Mode', 'Reference', 'Notes', 'We owe +', 'Paid/returned −', 'Balance', 'Status']]
      .concat([['', 'Opening balance', '', '', '', r.supplier.openingBalance, '', r.supplier.openingBalance, '']])
      .concat(r.entries.map(function (e) { return [e.date, e.type, e.mode, e.ref, e.notes, e.credit || '', e.debit || '', e.balanceAfter, e.status]; })) }]);
  };
  function invoiceTable(list) {
    return V.table(['Date', 'Invoice', 'Supplier', 'Lines', 'Total', 'Paid', 'File', ''], list.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).map(function (i) {
      var c = i.status === 'Cancelled';
      return '<tr' + (c ? ' class="v-strike"' : '') + '><td>' + h(V.fmtDate(i.date)) + '</td><td>' + h(i.invoiceNo || '—') + '</td><td>' + h(i.supplierName) + '</td>' + V.td(i.lines, 1)
        + V.td(inr(i.total), 1) + V.td(inr(i.paidAmount) + (i.paidAmount < i.total - 0.009 && !c ? '<br><small class="v-bad">credit ' + inr(i.total - i.paidAmount) + '</small>' : ''), 1)
        + '<td>' + (i.attachmentUrl ? '<a href="' + h(i.attachmentUrl) + '" target="_blank" rel="noopener">📎 View</a>' : (c ? '' : '<button type="button" class="v-btn v-sm" data-act="attachInvoice" data-id="' + h(i.id) + '">📎 Add</button>')) + '</td>'
        + '<td>' + (c ? '<small>' + h(i.cancelReason) + '</small>' : '<button type="button" class="v-btn v-sm v-danger" data-act="cancelInvoice" data-id="' + h(i.id) + '" title="Cancel invoice">✖</button>') + '</td></tr>';
    }), { empty: 'No invoices.' });
  }
  ACT.cancelSupEntry = async function (el) {
    var reason = (prompt('Cancel this supplier payment?\n\nReason (required):') || '').trim(); if (reason.length < 3) return;
    var res = await API.call('cancelSupplierEntry', { entryId: el.dataset.id, reason: reason }, { noQueue: true });
    if (!res.success) return V.toast('❌ ' + res.error, 'error');
    V.toast('Cancelled'); await loadData(); if (S._ledgerId) ACT.supLedger({ dataset: { id: S._ledgerId } });
  };

  // ── pay supplier ──
  ACT.supPay = function (el) {
    var s = S.byId(el.dataset.id); if (!s) return;
    V.dialog('💸 Pay ' + h(s.name),
      '<div class="v-sum"><div class="v-sum-big"><span>Balance owed</span><b>' + inr(s.balance) + '</b></div></div>'
      + V.field('sPayAmt', 'Amount paid (₹)', V.input('sPayAmt', 'type="number" min="1" step="0.01" class="v-in v-in-big" value="' + Math.max(0, s.balance) + '"'))
      + '<label class="v-lbl">Paid by</label>' + V.modeButtons('spay', 'UPI', [['Cash', '💵 Cash'], ['UPI', '📱 UPI'], ['Card', '💳 Card'], ['Bank', '🏦 Bank / cheque']])
      + '<div class="v-row2">' + V.field('sPayRef', 'Reference / cheque no.', V.input('sPayRef', 'maxlength="60"')) + V.field('sPayDate', 'Date', V.input('sPayDate', 'type="date" max="' + V.today() + '" value="' + V.today() + '"')) + '</div>'
      + V.field('sPayNotes', 'Notes', V.input('sPayNotes', 'maxlength="300"'))
      + '<div id="sPayMsg" class="v-msg"></div><button type="button" class="v-btn v-primary v-wide" data-act="supPaySave" data-id="' + h(s.id) + '">Save payment</button>', { width: 460 });
  };
  ACT.supPaySave = async function (btn) {
    var amt = V.num('sPayAmt'); if (!(amt > 0)) return V.msg('sPayMsg', 'Enter the amount');
    V.busy(btn, true);
    var res = await API.call('recordSupplierPayment', { supplierId: btn.dataset.id, amount: amt, mode: V.modeOf('spay'), ref: V.val('sPayRef'), date: V.val('sPayDate'), notes: V.val('sPayNotes') }, { noQueue: true });
    V.busy(btn, false);
    if (!res.success) return V.msg('sPayMsg', res.error);
    V.close(); V.toast('✅ Paid ' + inr(amt) + ' · balance ' + inr(res.balance) + (res.warnings && res.warnings.length ? ' · ' + res.warnings[0] : ''));
    await loadData(); if (document.getElementById('v31Sheet') && S._ledgerId === btn.dataset.id) ACT.supLedger({ dataset: { id: btn.dataset.id } });
  };

  // ── purchase return ──
  ACT.supReturn = function (el) {
    var sid = el && el.dataset.id || '', meds = (window.medicines || []).filter(function (m) { return (m.batches || []).length; });
    V.dialog('↩️ Return stock to supplier',
      V.field('prSup', 'Supplier', '<select id="prSup" class="v-in">' + S.active().map(function (s) { return '<option value="' + h(s.id) + '"' + (s.id === sid ? ' selected' : '') + '>' + h(s.name) + '</option>'; }).join('') + '</select>')
      + V.field('prMed', 'Medicine', '<select id="prMed" class="v-in" data-change="prMedChanged"><option value="">Choose…</option>' + meds.map(function (m) { return '<option value="' + h(m.id) + '">' + h(m.name) + '</option>'; }).join('') + '</select>')
      + V.field('prBatch', 'Batch', '<select id="prBatch" class="v-in" data-change="prBatchChanged"></select>')
      + '<div class="v-row2">' + V.field('prQty', 'Quantity', V.input('prQty', 'type="number" min="1" step="1"')) + V.field('prRate', 'Credit per unit (₹)', V.input('prRate', 'type="number" min="0" step="0.01"')) + '</div>'
      + V.field('prReason', 'Reason', '<input id="prReason" class="v-in" list="prReasons" maxlength="200"><datalist id="prReasons"><option>Expired</option><option>Near expiry</option><option>Damaged</option><option>Wrong item supplied</option><option>Excess stock</option></datalist>')
      + '<div id="prMsg" class="v-msg"></div><button type="button" class="v-btn v-warn v-wide" data-act="prSave">Save return</button>', { width: 480 });
  };
  ACT.prMedChanged = function () {
    var m = medById(V.val('prMed')), sel = document.getElementById('prBatch'), today = V.today();
    sel.innerHTML = m ? (m.batches || []).map(function (b) { return '<option value="' + h(b.batchId) + '" data-cost="' + (b.cost || 0) + '" data-sup="' + h(b.supplier || '') + '">' + h(b.batchNo || '—') + ' · exp ' + h(b.expiry || '—') + (b.expiry && b.expiry < today ? ' (EXPIRED)' : '') + ' · ' + b.qty + ' units</option>'; }).join('') : '';
    ACT.prBatchChanged();
  };
  ACT.prBatchChanged = function () {
    var o = document.querySelector('#prBatch option:checked'); if (!o) return;
    document.getElementById('prRate').value = o.dataset.cost;
    var sup = V.data.suppliers.find(function (s) { return s.name.toLowerCase() === String(o.dataset.sup).toLowerCase(); });
    if (sup) document.getElementById('prSup').value = sup.id;
  };
  ACT.prSave = async function (btn) {
    if (!V.val('prMed') || !V.val('prBatch')) return V.msg('prMsg', 'Choose medicine and batch');
    var qty = Number(V.val('prQty')); if (!Number.isInteger(qty) || qty < 1) return V.msg('prMsg', 'Enter a whole quantity');
    if (V.val('prReason').length < 3) return V.msg('prMsg', 'Write the reason');
    V.busy(btn, true);
    var res = await API.call('purchaseReturn', { supplierId: V.val('prSup'), medicineId: V.val('prMed'), batchId: V.val('prBatch'), qty: qty, rate: V.val('prRate'), reason: V.val('prReason') }, { noQueue: true });
    V.busy(btn, false);
    if (!res.success) return V.msg('prMsg', res.error);
    V.close(); V.toast('↩️ Returned · supplier credit ' + inr(res.amount)); loadData();
  };

  // ═══════════ purchase invoice ═══════════
  var INV = S.inv = { lines: [] };
  ACT.newInvoice = function (el) {
    INV.lines = [{}]; S._dirty = false; INV.file = null;
    var sid = el && el.dataset.id || '', sup = S.byId(sid);
    V.sheet('🧾 New purchase invoice',
      '<datalist id="invSupList">' + S.active().map(function (s) { return '<option value="' + h(s.name) + '">'; }).join('') + '</datalist>'
      + '<datalist id="invMedList">' + (window.medicines || []).map(function (m) { return '<option value="' + h(m.name) + '">'; }).join('') + '</datalist>'
      + '<div class="v-row3">' + V.field('invSup', 'Supplier', '<input id="invSup" class="v-in" list="invSupList" value="' + h(sup ? sup.name : '') + '" placeholder="Type or choose" data-input="invDirty">')
      + V.field('invNo', 'Supplier invoice no.', V.input('invNo', 'maxlength="60" data-input="invDirty"'))
      + V.field('invDate', 'Invoice date', V.input('invDate', 'type="date" max="' + V.today() + '" value="' + V.today() + '"')) + '</div>'
      + '<div class="v-inv-tools"><button type="button" class="v-btn" data-act="invAddLine">➕ Add line</button>'
      + '<button type="button" class="v-btn" data-act="scanBarcode" data-target="invoice">📷 Scan barcode</button>'
      + '<span class="v-muted">Tip: a USB / Bluetooth barcode scanner works in the medicine box.</span></div>'
      + '<div id="invLines"></div>'
      + '<div class="v-inv-foot"><div class="v-money" id="invTotals"></div><div>'
      + V.field('invAdj', 'Round-off / discount / extra charges (₹, minus for discount)', V.input('invAdj', 'type="number" step="0.01" value="0" data-input="invCalc"'))
      + '<div class="v-row2">' + V.field('invPaid', 'Paid now (₹)', V.input('invPaid', 'type="number" min="0" step="0.01" value="0" data-input="invCalc"'))
      + V.field('invMode', 'Paid by', '<select id="invMode" class="v-in"><option>Cash</option><option selected>UPI</option><option>Card</option><option>Bank</option></select>') + '</div>'
      + V.field('invFile', 'Invoice photo or PDF (optional)', '<input id="invFile" class="v-in" type="file" accept="image/*,application/pdf" capture="environment" data-change="invFilePicked">')
      + V.field('invNotes', 'Notes', V.input('invNotes', 'maxlength="300"'))
      + '<div id="invMsg" class="v-msg"></div><button type="button" class="v-btn v-primary v-wide" data-act="invSave">💾 Save invoice &amp; add stock</button></div></div>');
    renderLines(); ACT.invCalc();
    var f = document.getElementById(sup ? 'invNo' : 'invSup'); if (f) f.focus();
  };
  ACT.invDirty = function () { S._dirty = true; };
  ACT.invAddLine = function () { INV.lines.push({}); renderLines(); var i = document.getElementById('il_med_' + (INV.lines.length - 1)); if (i) i.focus(); };
  ACT.invDelLine = function (el) { INV.lines.splice(+el.dataset.i, 1); if (!INV.lines.length) INV.lines.push({}); renderLines(); ACT.invCalc(); };
  function renderLines() {
    var el = document.getElementById('invLines'); if (!el || INV._rendering) return;
    INV._rendering = true;
    try {
      // leaving a field fires its "change" (which may update a line) before the table is redrawn
      if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
      drawLines(el);
    } finally { INV._rendering = false; }
  }
  function drawLines(el) {
    el.innerHTML = '<div class="tbl-wrap"><table class="table v-table v-inv-table"><thead><tr><th>Medicine</th><th>Batch no.</th><th>Expiry</th><th class="num">Qty</th><th class="num">Free</th><th class="num">Rate ₹</th><th class="num">MRP ₹</th><th class="num">Amount</th><th></th></tr></thead><tbody>'
      + INV.lines.map(function (l, i) {
        var m = l.medicineId ? medById(l.medicineId) : null;
        return '<tr><td data-label="Medicine"><input id="il_med_' + i + '" class="v-in" list="invMedList" value="' + h(m ? m.name : (l.name || '')) + '" data-i="' + i + '" data-change="invMed" data-enter="invMedEnter" placeholder="Medicine name or barcode">'
          + (l.name && !m ? '<button type="button" class="v-link" data-act="invNewMed" data-i="' + i + '">➕ Add “' + h(l.name) + '” as a new medicine</button>' : '')
          + (m ? '<small class="v-muted">Stock ' + m.stock + ' · sells at ' + inr(m.price) + '</small>' : '') + '</td>'
          + '<td data-label="Batch no."><input class="v-in v-in-sm" value="' + h(l.batchNo || '') + '" data-i="' + i + '" data-f="batchNo" data-input="invField" maxlength="40"></td>'
          + '<td data-label="Expiry"><input class="v-in v-in-sm" type="month" value="' + h(l.expMonth || '') + '" data-i="' + i + '" data-f="expMonth" data-change="invField"></td>'
          + '<td data-label="Qty"><input class="v-in v-in-xs" type="number" min="1" step="1" value="' + (l.qty || '') + '" data-i="' + i + '" data-f="qty" data-input="invField"></td>'
          + '<td data-label="Free"><input class="v-in v-in-xs" type="number" min="0" step="1" value="' + (l.freeQty || '') + '" data-i="' + i + '" data-f="freeQty" data-input="invField"></td>'
          + '<td data-label="Rate ₹"><input class="v-in v-in-xs" type="number" min="0" step="0.01" value="' + (l.costPrice !== undefined ? l.costPrice : '') + '" data-i="' + i + '" data-f="costPrice" data-input="invField"></td>'
          + '<td data-label="MRP ₹"><input class="v-in v-in-xs" type="number" min="0" step="0.01" value="' + (l.mrp || '') + '" data-i="' + i + '" data-f="mrp" data-input="invField"></td>'
          + '<td data-label="Amount" class="num" id="il_amt_' + i + '">' + inr((+l.qty || 0) * (+l.costPrice || 0)) + '</td>'
          + '<td data-label=""><button type="button" class="v-btn v-sm v-danger" data-act="invDelLine" data-i="' + i + '" aria-label="Remove line">✖</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  S.addMedicineLine = function (m) {
    var empty = INV.lines.findIndex(function (l) { return !l.medicineId && !l.name; });
    var i = empty >= 0 ? empty : INV.lines.push({}) - 1;
    INV.lines[i] = { medicineId: m.id, costPrice: m.costPrice || '', qty: '' };
    S._dirty = true; renderLines(); ACT.invCalc();
    var q = document.querySelector('[data-i="' + i + '"][data-f="batchNo"]'); if (q) q.focus();
  };
  ACT.invMed = function (el) {
    var i = +el.dataset.i, v = el.value.trim(), m = medByName(v) || (window.medicines || []).find(function (x) { return x.barcode && x.barcode === v; });
    INV.lines[i] = Object.assign(INV.lines[i] || {}, m ? { medicineId: m.id, name: '' } : { medicineId: '', name: v });
    if (m && (INV.lines[i].costPrice === undefined || INV.lines[i].costPrice === '')) INV.lines[i].costPrice = m.costPrice || '';
    S._dirty = true; renderLines(); ACT.invCalc();
    if (m) { var q = document.querySelector('[data-i="' + i + '"][data-f="batchNo"]'); if (q) q.focus(); }
  };
  ACT.invMedEnter = function (el) { ACT.invMed(el); };
  ACT.invField = function (el) {
    var l = INV.lines[+el.dataset.i]; l[el.dataset.f] = el.value; S._dirty = true;
    var a = document.getElementById('il_amt_' + el.dataset.i); if (a) a.textContent = inr((+l.qty || 0) * (+l.costPrice || 0));
    ACT.invCalc();
  };
  ACT.invCalc = function () {
    var items = r2(INV.lines.reduce(function (a, l) { return a + (+l.qty || 0) * (+l.costPrice || 0); }, 0)), total = r2(items + V.num('invAdj')), paid = V.num('invPaid');
    var el = document.getElementById('invTotals'); if (!el) return;
    el.innerHTML = '<div><span>Lines</span><b>' + INV.lines.filter(function (l) { return l.medicineId; }).length + '</b></div><div><span>Items total</span><b>' + inr(items) + '</b></div>'
      + '<div class="v-money-due"><span>Invoice total</span><b>' + inr(total) + '</b></div>'
      + '<div><span>' + (paid >= total - 0.009 ? 'Fully paid' : 'On credit (we owe)') + '</span><b>' + inr(Math.max(0, total - paid)) + '</b></div>';
  };
  ACT.invNewMed = function (el) {
    var i = +el.dataset.i, l = INV.lines[i];
    V.dialog('➕ New medicine',
      V.field('nmName', 'Name', V.input('nmName', 'maxlength="120" value="' + h(l.name || '') + '"'))
      + '<div class="v-row2">' + V.field('nmPrice', 'Selling price ₹ (per unit)', V.input('nmPrice', 'type="number" min="0" step="0.01" value="' + (l.mrp || '') + '"'))
      + V.field('nmMin', 'Low-stock alert below', V.input('nmMin', 'type="number" min="0" step="1" value="10"')) + '</div>'
      + '<div class="v-row2">' + V.field('nmGeneric', 'Generic name (optional)', V.input('nmGeneric', 'maxlength="120"')) + V.field('nmBarcode', 'Barcode (optional)', V.input('nmBarcode', 'maxlength="60"')) + '</div>'
      + '<div id="nmMsg" class="v-msg"></div><button type="button" class="v-btn v-primary v-wide" data-act="invNewMedSave" data-i="' + i + '">Create medicine</button>', { width: 460 });
  };
  ACT.invNewMedSave = async function (btn) {
    var name = V.val('nmName'), price = V.num('nmPrice'); if (!name) return V.msg('nmMsg', 'Name required'); if (!(price > 0)) return V.msg('nmMsg', 'Enter the selling price');
    V.busy(btn, true);
    var l = INV.lines[+btn.dataset.i];
    var res = await API.call('addMedicine', { name: name, price: price, costPrice: +l.costPrice || 0, stock: 0, minStock: V.num('nmMin') || 10, genericName: V.val('nmGeneric'), barcode: V.val('nmBarcode') }, { noQueue: true });
    V.busy(btn, false);
    if (!res.success) return V.msg('nmMsg', res.error);
    await loadData();
    l.medicineId = String(res.medicineId); l.name = '';
    V.close(); renderLines(); ACT.invCalc();
    var dl = document.getElementById('invMedList'); if (dl) dl.innerHTML = (window.medicines || []).map(function (m) { return '<option value="' + h(m.name) + '">'; }).join('');
  };
  ACT.invFilePicked = function (el) { INV.file = el.files && el.files[0] || null; };
  // photos are shrunk to ~1600 px JPEG before upload (fast on mobile data)
  S.fileToBase64 = function (file) {
    return new Promise(function (resolve, reject) {
      if (file.type === 'application/pdf') {
        if (file.size > 5 * 1024 * 1024) return reject(new Error('PDF is larger than 5 MB'));
        var fr = new FileReader(); fr.onload = function () { resolve({ data: String(fr.result).split(',')[1], mime: 'application/pdf' }); }; fr.onerror = reject; fr.readAsDataURL(file); return;
      }
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        resolve({ data: c.toDataURL('image/jpeg', 0.8).split(',')[1], mime: 'image/jpeg' });
      };
      img.onerror = function () { reject(new Error('Could not read the photo')); };
      img.src = url;
    });
  };
  ACT.invSave = async function (btn) {
    var sup = V.val('invSup'); if (!sup) return V.msg('invMsg', 'Choose or type the supplier');
    var lines = [], bad = '';
    INV.lines.forEach(function (l, i) {
      if (!l.medicineId && !l.name && !l.qty) return;
      if (!l.medicineId) { bad = bad || 'Line ' + (i + 1) + ': choose a medicine from the list (or add it as new)'; return; }
      var q = Number(l.qty), f = Number(l.freeQty || 0), c = Number(l.costPrice);
      if (!Number.isInteger(q) || q < 1) { bad = bad || 'Line ' + (i + 1) + ': enter the quantity'; return; }
      if (!Number.isInteger(f) || f < 0) { bad = bad || 'Line ' + (i + 1) + ': free quantity must be a whole number'; return; }
      if (!(c >= 0) || l.costPrice === '' || l.costPrice === undefined) { bad = bad || 'Line ' + (i + 1) + ': enter the rate'; return; }
      lines.push({ medicineId: l.medicineId, qty: q, freeQty: f, costPrice: c, mrp: +l.mrp || 0, batchNo: (l.batchNo || '').trim(), expiry: monthEnd(l.expMonth) });
    });
    if (bad) return V.msg('invMsg', bad);
    if (!lines.length) return V.msg('invMsg', 'Add at least one medicine');
    var items = r2(lines.reduce(function (a, l) { return a + l.qty * l.costPrice; }, 0)), total = r2(items + V.num('invAdj')), paid = V.num('invPaid');
    if (paid > total + 0.009) return V.msg('invMsg', 'Paid now is more than the invoice total');
    var known = V.data.suppliers.find(function (s) { return s.name.toLowerCase() === sup.toLowerCase(); });
    if (!known && !confirm('“' + sup + '” is a new supplier. Create it?')) return;
    V.busy(btn, true, '⏳ Saving invoice…');
    var id = newId('PINV');
    var res = await API.call('addPurchaseInvoice', { id: id, supplierId: known ? known.id : '', supplierName: sup, invoiceNo: V.val('invNo'), date: V.val('invDate'),
      lines: JSON.stringify(lines), adjustment: V.num('invAdj'), total: total, paidAmount: paid, paymentMode: V.val('invMode'), notes: V.val('invNotes') }, { noQueue: true });
    if (!res.success) { V.busy(btn, false); return V.msg('invMsg', res.error); }
    var note = '';
    if (INV.file) {
      btn.textContent = '⏳ Uploading invoice file…';
      try { var f = await S.fileToBase64(INV.file); var up = await API.call('uploadInvoiceAttachment', { invoiceId: id, mimeType: f.mime, data: f.data }, { noQueue: true }); if (!up.success) note = ' (file not attached: ' + up.error + ')'; }
      catch (e) { note = ' (file not attached: ' + e.message + ')'; }
    }
    V.busy(btn, false); S._dirty = false; V.closeSheet();
    V.toast('✅ Invoice saved · ' + lines.length + ' line(s) · ' + inr(total) + (res.due > 0 ? ' · owe ' + inr(res.due) : ' · paid') + note, note ? 'warning' : 'success');
    loadData();
  };
  ACT.attachInvoice = function (el) {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*,application/pdf';
    inp.onchange = async function () {
      var file = inp.files && inp.files[0]; if (!file) return;
      V.toast('⏳ Uploading…', 'info');
      try { var f = await S.fileToBase64(file); var up = await API.call('uploadInvoiceAttachment', { invoiceId: el.dataset.id, mimeType: f.mime, data: f.data }, { noQueue: true });
        V.toast(up.success ? '📎 Attached' : '❌ ' + up.error, up.success ? 'success' : 'error'); if (up.success) loadData(); }
      catch (e) { V.toast('❌ ' + e.message, 'error'); }
    };
    inp.click();
  };
  ACT.cancelInvoice = async function (el) {
    var reason = (prompt('Cancel this purchase invoice?\nIts stock is removed (only possible if nothing from it was sold).\n\nReason (required):') || '').trim(); if (reason.length < 3) return;
    var res = await API.call('cancelPurchaseInvoice', { id: el.dataset.id, reason: reason }, { noQueue: true });
    V.toast(res.success ? '✖ Invoice cancelled' : '❌ ' + res.error, res.success ? 'success' : 'error');
    if (res.success) { await loadData(); if (document.getElementById('v31Sheet') && S._ledgerId) ACT.supLedger({ dataset: { id: S._ledgerId } }); }
  };

  // ── Purchases page: invoices list on top ──
  S.renderPurchasesTop = function () {
    var page = document.getElementById('purchases'); if (!page || !V.enabled() || !API.isOwner()) return;
    var box = document.getElementById('v31InvBox');
    if (!box) { box = document.createElement('div'); box.id = 'v31InvBox'; box.className = 'v-card'; page.insertBefore(box, page.firstChild); }
    var list = V.data.purchaseInvoices.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 30);
    box.innerHTML = '<div class="v-toolbar"><h3 class="v-h3" style="margin:0;flex:1;">🧾 Purchase invoices</h3>'
      + '<button type="button" class="v-btn v-primary" data-act="newInvoice">➕ New purchase invoice</button>'
      + '<button type="button" class="v-btn" data-act="supReturn">↩️ Return to supplier</button>'
      + '<button type="button" class="v-btn" data-act="goSuppliers">🏭 Suppliers</button></div>' + invoiceTable(list);
  };
  ACT.goSuppliers = function () { showPage('suppliers'); };
  V.whenShown('purchases', S.renderPurchasesTop);
  V.afterRefresh.push(function () { var p = document.getElementById('purchases'); if (p && p.classList.contains('active')) S.renderPurchasesTop(); });
})();
;

;/* ══ FILE: 16-stock.js ══════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════
   16-stock.js — medicine search (name / generic / barcode / batch),
   barcode scanning (camera or USB/Bluetooth scanner), barcode + generic
   name on medicines, full batch history, stock reports (valuation,
   expiring, expiry loss, dead / slow stock, reorder list)
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var V = window.V31, ACT = V.act, h = V.h, inr = V.inr, r2 = V.r2;
  var K = V.stock = {};
  function meds() { return window.medicines || []; }
  function medById(id) { return meds().find(function (m) { return String(m.id) === String(id); }) || null; }
  K.byBarcode = function (code) { code = String(code || '').trim(); if (!code) return null; return meds().find(function (m) { return m.barcode && String(m.barcode) === code; }) || null; };
  K.search = function (q, limit) {
    q = String(q || '').trim().toLowerCase(); if (!q) return [];
    var words = q.split(/\s+/);
    var score = function (m) {
      var name = String(m.name || '').toLowerCase(), gen = String(m.genericName || '').toLowerCase(), all = name + ' ' + gen + ' ' + String(m.category || '').toLowerCase() + ' ' + String(m.barcode || '') + ' ' + String(m.batchNos || '').toLowerCase();
      if (!words.every(function (w) { return all.indexOf(w) !== -1; })) return -1;
      return (name.indexOf(q) === 0 ? 0 : name.indexOf(q) !== -1 ? 1 : gen.indexOf(q) !== -1 ? 2 : 3) * 1000 - (m.stock > 0 ? 1 : 0) * 100;
    };
    return meds().map(function (m) { return { m: m, s: score(m) }; }).filter(function (x) { return x.s >= 0; })
      .sort(function (a, b) { return a.s - b.s || String(a.m.name).localeCompare(b.m.name); }).slice(0, limit || 10).map(function (x) { return x.m; });
  };

  // ═══════════ searchable picker in front of a <select> ═══════════
  // select: the existing medicine <select>; qty: quantity input; add(): adds to cart
  K.attachPicker = function (select, qty, add, opts) {
    if (!select || select.dataset.picker) return; select.dataset.picker = '1'; opts = opts || {};
    var wrap = document.createElement('div'); wrap.className = 'v-med-search';
    wrap.innerHTML = '<input type="search" class="v-in" placeholder="🔍 Type medicine, generic name or scan barcode" autocomplete="off" aria-label="Search medicine">'
      + '<button type="button" class="v-btn v-scan-btn" title="Scan barcode with camera" aria-label="Scan barcode">📷</button><div class="v-pick" role="listbox" hidden></div>';
    select.parentNode.insertBefore(wrap, select);
    var input = wrap.querySelector('input'), box = wrap.querySelector('.v-pick'), cam = wrap.querySelector('button'), list = [], cur = 0;
    var choose = function (m, addNow) {
      if (!m) return;
      select.value = String(m.id); select.dispatchEvent(new Event('change', { bubbles: true }));
      input.value = ''; box.hidden = true;
      if (addNow && m.stock > 0) { if (qty) qty.value = '1'; add(); input.focus(); }
      else if (qty) { qty.focus(); qty.select(); }
    };
    var draw = function () {
      box.innerHTML = list.map(function (m, i) {
        return '<div class="v-pick-item' + (i === cur ? ' on' : '') + (m.stock > 0 ? '' : ' v-dim') + '" role="option" data-i="' + i + '"><b>' + h(m.name) + '</b>'
          + (m.genericName ? ' <span class="v-muted">' + h(m.genericName) + '</span>' : '') + '<span class="v-pick-r">' + inr(m.price) + ' · ' + (m.stock > 0 ? m.stock + ' in stock' : 'out of stock') + (m.expiry ? ' · exp ' + h(m.expiry) : '') + '</span></div>';
      }).join(''); box.hidden = !list.length;
    };
    input.addEventListener('input', function () { list = K.search(input.value, 10); cur = 0; draw(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { cur = Math.min(cur + 1, list.length - 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { cur = Math.max(cur - 1, 0); draw(); e.preventDefault(); }
      else if (e.key === 'Escape') box.hidden = true;
      else if (e.key === 'Enter') {
        e.preventDefault();
        var bc = K.byBarcode(input.value);
        if (bc) return choose(bc, true);                 // barcode scanner: add one straight away
        if (list[cur]) choose(list[cur], false);
      }
    });
    box.addEventListener('mousedown', function (e) { var it = e.target.closest('.v-pick-item'); if (it) { e.preventDefault(); choose(list[+it.dataset.i], false); } });
    input.addEventListener('blur', function () { setTimeout(function () { box.hidden = true; }, 150); });
    cam.addEventListener('click', function () { K.scan(function (code) { var m = K.byBarcode(code); if (m) choose(m, true); else { input.value = code; input.dispatchEvent(new Event('input')); V.toast('No medicine has barcode ' + code + ' — add it in Inventory → Edit', 'warning'); } }); });
    wrap.hidden = !V.enabled();
    K._pickers.push(wrap);
  };
  K._pickers = [];
  V.afterRefresh.push(function () { K._pickers.forEach(function (w) { w.hidden = !V.enabled(); }); });

  // ═══════════ camera barcode scanning ═══════════
  K.scan = async function (onCode) {
    var hasApi = 'BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
    V.dialog('📷 Scan barcode',
      (hasApi ? '<div class="v-scan"><video id="scanVideo" playsinline muted></video><div class="v-scan-line"></div></div><p class="v-note" id="scanState">Point the camera at the barcode…</p>'
        : '<p class="v-note">This browser cannot read barcodes with the camera. Use a USB / Bluetooth barcode scanner (it types into the search box), or type the code:</p>')
      + '<div class="v-row2">' + V.field('scanManual', 'Barcode', V.input('scanManual', 'inputmode="numeric" data-enter="scanManualGo"')) + '<div style="align-self:end;"><button type="button" class="v-btn v-primary" data-act="scanManualGo">Use code</button></div></div>', { width: 460 });
    K._onCode = onCode;
    if (!hasApi) return;
    var video = document.getElementById('scanVideo'), stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; await video.play();
      var formats = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'qr_code', 'data_matrix', 'codabar'];
      try { var sup = await BarcodeDetector.getSupportedFormats(); formats = formats.filter(function (f) { return sup.indexOf(f) !== -1; }); } catch (e) {}
      var det = new BarcodeDetector({ formats: formats });
      var tick = async function () {
        if (!document.getElementById('scanVideo')) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        try { var codes = await det.detect(video); if (codes && codes.length) { stream.getTracks().forEach(function (t) { t.stop(); }); V.close(); onCode(codes[0].rawValue); return; } } catch (e) {}
        setTimeout(tick, 250);
      };
      tick();
    } catch (e) {
      var st = document.getElementById('scanState'); if (st) st.textContent = '⚠️ Camera not available (' + (e.name === 'NotAllowedError' ? 'permission denied' : e.message) + '). Type the code below.';
    }
  };
  ACT.scanManualGo = function () { var c = V.val('scanManual'); if (!c) return; var f = K._onCode; V.close(); if (f) f(c); };
  ACT.scanBarcode = function (el) {
    var t = el.dataset.target;
    K.scan(function (code) {
      var m = K.byBarcode(code);
      if (t === 'invoice') { if (m) V.sup.addMedicineLine(m); else { V.sup.inv.lines.push({ name: code }); V.toast('Barcode ' + code + ' is not on any medicine yet', 'warning'); } return; }
      if (t === 'field') { var f = document.getElementById(el.dataset.field); if (f) f.value = code; }
    });
  };

  // ═══════════ medicine edit: barcode, generic, category ═══════════
  var origEdit = window.openEditMedicine;
  window.openEditMedicine = function (id) {
    origEdit(id);
    if (!V.enabled()) return;
    var m = medById(id), btn = document.querySelector('#ssdcDialogBody button[data-onclick^="saveEditMedicine"]'); if (!m || !btn) return;
    var box = document.createElement('div');
    box.innerHTML = '<div class="v-row2">' + V.field('emBarcode', 'Barcode', '<div class="v-inline"><input id="emBarcode" class="v-in" maxlength="60" value="' + h(m.barcode || '') + '"><button type="button" class="v-btn" data-act="scanBarcode" data-target="field" data-field="emBarcode">📷</button></div>')
      + V.field('emGeneric', 'Generic name', V.input('emGeneric', 'maxlength="120" value="' + h(m.genericName || '') + '"')) + '</div>'
      + '<div class="v-row2">' + V.field('emCat', 'Category', '<input id="emCat" class="v-in" list="emCats" maxlength="60" value="' + h(m.category || '') + '"><datalist id="emCats">'
      + Array.from(new Set(meds().map(function (x) { return x.category; }).filter(Boolean).concat(['Tablet', 'Capsule', 'Syrup', 'Mouthwash', 'Gel', 'Toothpaste', 'Injection', 'Ointment']))).map(function (c) { return '<option value="' + h(c) + '">'; }).join('') + '</datalist>')
      + V.field('emMfr', 'Manufacturer', V.input('emMfr', 'maxlength="120" value="' + h(m.manufacturer || '') + '"')) + '</div>';
    btn.parentNode.insertBefore(box, document.getElementById('emMsg'));
  };
  var origSaveEdit = window.saveEditMedicine;
  window.saveEditMedicine = async function (id) {
    if (!V.enabled() || !document.getElementById('emBarcode')) return origSaveEdit(id);
    var price = parseFloat(_v('emPrice')), cost = parseFloat(_v('emCost'));
    if (!_v('emName') || !(price >= 0) || !(cost >= 0)) return _msg('emMsg', 'Check name and prices');
    if (price < cost && !confirm('Selling price is below cost price. Save anyway?')) return;
    var res = await API.call('updateMedicine', { id: id, name: _v('emName'), price: price, costPrice: cost, minStock: _v('emMin'),
      barcode: _v('emBarcode'), genericName: _v('emGeneric'), category: _v('emCat'), manufacturer: _v('emMfr') }, { noQueue: true });
    if (!res.success) return _msg('emMsg', res.error);
    closeSsdcDialog(); showToast('✅ Medicine updated', 'success'); loadData();
  };
  // add-medicine form: optional barcode + generic name
  K.extendAddForm = function () {
    var anchor = document.getElementById('newMedicineExpiry'); if (!anchor || document.getElementById('newMedicineBarcode')) return;
    var box = document.createElement('div'); box.className = 'v31-only'; box.hidden = !V.enabled();
    box.innerHTML = '<div class="form-group"><label for="newMedicineBarcode">Barcode (optional)</label><div class="v-inline"><input id="newMedicineBarcode" maxlength="60"><button type="button" class="v-btn" data-act="scanBarcode" data-target="field" data-field="newMedicineBarcode">📷</button></div></div>'
      + '<div class="form-group"><label for="newMedicineGeneric">Generic name (optional)</label><input id="newMedicineGeneric" maxlength="120"></div>';
    var grp = anchor.closest('.form-group') || anchor.parentNode; grp.parentNode.insertBefore(box, grp.nextSibling);
  };
  document.addEventListener('DOMContentLoaded', K.extendAddForm);
  document.addEventListener('DOMContentLoaded', function () {
    K.attachPicker(document.getElementById('medicineSelect'), document.getElementById('medicineQty'), function () { addMedicineToCart(); });
    K.attachPicker(document.getElementById('cb_medSelect'), document.getElementById('cb_medQty'), function () { addCbMedicine(); });
  });

  // ═══════════ inventory: filter + batch history ═══════════
  K.filterInv = function (list) {
    var q = String(K._invQ || '').trim(); if (!q || !V.enabled()) return list;
    var hits = K.search(q, 1000), ids = {}; hits.forEach(function (m) { ids[String(m.id)] = 1; });
    return list.filter(function (m) { return ids[String(m.id)]; });
  };
  K.renderInvTools = function () {
    var page = document.getElementById('inventory'); if (!page || !V.enabled()) return;
    var bar = document.getElementById('v31InvTools');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'v31InvTools'; bar.className = 'v-toolbar';
      var tw = page.querySelector('.tbl-wrap') || page.firstChild; page.insertBefore(bar, tw);
      bar.innerHTML = '<input id="invFilter" class="v-in" type="search" placeholder="🔍 Filter by name, generic, barcode, batch" data-input="invFilter">'
        + '<button type="button" class="v-btn" data-act="invFilterScan">📷</button>'
        + '<button type="button" class="v-btn v-primary" data-act="stockReports">📊 Stock reports</button>';
    }
  };
  ACT.invFilter = function (el) { K._invQ = el.value; updateInventoryTable(); };
  ACT.invFilterScan = function () { K.scan(function (c) { var f = document.getElementById('invFilter'); if (f) { f.value = c; K._invQ = c; updateInventoryTable(); } }); };
  V.whenShown('inventory', K.renderInvTools);
  ACT.batchHistory = async function (el) {
    var m = medById(el.dataset.id); if (!m) return;
    V.sheet('📜 ' + h(m.name) + ' — batches &amp; history', 'Loading…');
    var res = await API.call('getBatchHistory', { medicineId: m.id }), body = document.getElementById('v31SheetBody'); if (!body) return;
    if (!res.success) { body.textContent = res.error; return; }
    var t = res.totals, today = V.today(), TYPES = { PURCHASE: 'Purchased', OPENING: 'Opening', SALE: 'Sold', SALE_UNALLOCATED: 'Sold (short)', BILL_CANCEL: 'Bill cancelled', CUSTOMER_RETURN: 'Returned by patient',
      PURCHASE_RETURN: 'Returned to supplier', PURCHASE_CANCEL: 'Purchase cancelled', EXPIRED: 'Expired (removed)', DAMAGED: 'Damaged', ADJUSTMENT: 'Count correction' };
    K._hist = res;
    body.innerHTML = '<div class="v-actions"><button type="button" class="v-btn" data-act="histXlsx">⬇️ Excel</button></div>'
      + V.kpis(Object.keys(t).map(function (k) { return { label: TYPES[k] || k, value: (t[k] > 0 ? '+' : '') + t[k] }; }))
      + '<h4 class="v-h4">Batches (first to expire is sold first)</h4>'
      + V.table(['Batch', 'Expiry', 'Received', 'Available', 'Cost', 'MRP', 'Supplier', 'Status'], res.batches.map(function (b) {
        var days = b.expiry ? V.daysBetween(today, b.expiry) : null;
        return '<tr' + (b.available <= 0 || b.status !== 'Active' ? ' class="v-dim"' : '') + '><td>' + h(b.batchNo || '—') + '</td><td>' + h(b.expiry || '—')
          + (b.expired ? ' <span class="v-badge v-due">EXPIRED</span>' : days !== null && days <= 90 ? ' <span class="v-badge v-warnb">' + days + ' days</span>' : '') + '</td>'
          + V.td(b.received, 1) + V.td('<b>' + b.available + '</b>', 1) + V.td(inr(b.cost), 1) + V.td(b.mrp ? inr(b.mrp) : '—', 1) + '<td><small>' + h(b.supplier) + '</small></td><td>' + V.badge(b.status) + '</td></tr>';
      }))
      + '<h4 class="v-h4">Every stock change</h4>'
      + V.table(['When', 'What', 'Qty', 'Stock after', 'Batch', 'Reference', 'By', 'Reason'], res.movements.slice(0, 500).map(function (x) {
        var b = res.batches.find(function (y) { return y.batchId === x.batchId; });
        return '<tr><td class="v-nowrap"><small>' + h(x.at) + '</small></td><td>' + h(TYPES[x.type] || x.type) + '</td>' + V.td('<b class="' + (x.qty < 0 ? 'v-bad' : 'v-ok') + '">' + (x.qty > 0 ? '+' : '') + x.qty + '</b>', 1)
          + V.td(x.stockAfter, 1) + '<td><small>' + h(b ? b.batchNo || '—' : x.batchId) + '</small></td><td><small>' + h(x.ref) + '</small></td><td><small>' + h(x.user) + '</small></td><td><small>' + h(x.reason) + '</small></td></tr>';
      }), { empty: 'No stock changes recorded yet.' });
  };
  ACT.histXlsx = function () {
    var r = K._hist; if (!r || !V.xlsx) return;
    V.xlsx.download('Stock history ' + r.medicine.name + '.xlsx', [
      { name: 'Batches', rows: [['Batch', 'Expiry', 'Received', 'Available', 'Cost', 'MRP', 'Supplier', 'Status', 'Received at']].concat(r.batches.map(function (b) { return [b.batchNo, b.expiry, b.received, b.available, b.cost, b.mrp, b.supplier, b.status, b.receivedAt]; })) },
      { name: 'Movements', rows: [['When', 'Type', 'Qty', 'Stock after', 'Batch ID', 'Reference', 'By', 'Reason']].concat(r.movements.map(function (x) { return [x.at, x.type, x.qty, x.stockAfter, x.batchId, x.ref, x.user, x.reason]; })) }]);
  };

  // ═══════════ stock reports ═══════════
  V.tabRender.stk = function () { renderReports(); };
  ACT.stockReports = async function () {
    V.sheet('📊 Stock reports', 'Loading…');
    var res = await API.call('getInventoryReport', { deadDays: 90 }); if (!document.getElementById('v31SheetBody')) return;
    if (!res.success) { document.getElementById('v31SheetBody').textContent = res.error; return; }
    K._rep = res; renderReports();
  };
  function reportRows(tab) {
    var r = K._rep, today = V.today(), list = r.medicines.slice();
    if (tab === 'value') return { title: 'Stock valuation', head: ['Medicine', 'Category', 'Sellable', 'Value at cost', 'Value at selling price', 'Expired qty', 'Expired value'],
      rows: list.sort(function (a, b) { return b.costValue - a.costValue; }).map(function (m) { return [m.name, m.category, m.sellable, m.costValue, m.saleValue, m.expired, m.expiredValue]; }),
      foot: ['Total', '', '', r.totals.costValue, r.totals.saleValue, '', r.totals.expiredValue] };
    if (tab === 'expiring') {
      var rows = [];
      meds().forEach(function (m) { (m.batches || []).forEach(function (b) { if (b.expiry && b.qty > 0) { var d = V.daysBetween(today, b.expiry); if (d <= 90) rows.push([m.name, b.batchNo, b.expiry, d < 0 ? 'EXPIRED' : d, b.qty, r2(b.qty * (b.cost || 0)), b.supplier]); } }); });
      rows.sort(function (a, b) { return String(a[2]).localeCompare(b[2]); });
      return { title: 'Expired and expiring within 90 days', head: ['Medicine', 'Batch', 'Expiry', 'Days left', 'Qty', 'Value at cost', 'Supplier'], rows: rows,
        note: 'Return near-expiry stock to the supplier (Suppliers → Return) or remove expired strips (Inventory → 📦 Stock → Expired).' };
    }
    if (tab === 'loss') return { title: 'Expiry & damage loss', head: ['Date', 'Medicine', 'Why', 'Qty', 'Loss at cost', 'Reason'],
      rows: r.expiryLoss.rows.map(function (x) { return [x.date, x.medicineName, x.type === 'EXPIRED' ? 'Expired' : 'Damaged', x.qty, x.value, x.reason]; }),
      foot: ['Total', '', '', '', r.expiryLoss.total, ''],
      pre: V.table(['Month', 'Loss'], Object.keys(r.expiryLoss.byMonth).sort().reverse().map(function (k) { return '<tr><td>' + h(k) + '</td>' + V.td(inr(r.expiryLoss.byMonth[k]), 1) + '</tr>'; }), { empty: 'No expiry or damage losses recorded.' }) };
    if (tab === 'dead') return { title: 'Dead stock — no sale in ' + r.deadDays + ' days', head: ['Medicine', 'Sellable', 'Value at cost', 'Last sold'],
      rows: list.filter(function (m) { return m.dead; }).sort(function (a, b) { return b.costValue - a.costValue; }).map(function (m) { return [m.name, m.sellable, m.costValue, m.lastSale || 'never']; }),
      foot: ['Total', '', r.totals.deadValue, ''], note: 'Money locked in medicines nobody is buying. Consider returning them to the supplier or not re-ordering.' };
    if (tab === 'slow') return { title: 'Slow moving — more than 6 months of stock', head: ['Medicine', 'Sellable', 'Sold (90 days)', 'Days of stock', 'Value at cost'],
      rows: list.filter(function (m) { return m.slow; }).sort(function (a, b) { return b.daysCover - a.daysCover; }).map(function (m) { return [m.name, m.sellable, m.sold90, m.daysCover, m.costValue]; }) };
    if (tab === 'reorder') return { title: 'Re-order list (low stock or < 30 days left)', head: ['Medicine', 'Sellable', 'Minimum', 'Sold (30 days)', 'Suggested order'],
      rows: list.filter(function (m) { var perDay = m.sold90 / 90; return m.sellable < (m.minStock || 10) || (perDay > 0 && m.sellable / perDay < 30); })
        .map(function (m) { var need = Math.max((m.minStock || 10) * 2, Math.ceil(m.sold30 * 1.5)) - m.sellable; return [m.name, m.sellable, m.minStock || 10, m.sold30, Math.max(0, Math.ceil(need))]; })
        .sort(function (a, b) { return b[4] - a[4]; }) };
    return { title: '', head: [], rows: [] };
  }
  function renderReports() {
    var body = document.getElementById('v31SheetBody'); if (!body || !K._rep) return;
    var tab = V.tabState.stk || 'value', d = reportRows(tab), r = K._rep;
    K._cur = d;
    var fmt = function (v, i) { return typeof v === 'number' && /value|cost|price|loss/i.test(d.head[i]) ? inr(v) : h(v === undefined || v === null ? '' : v); };
    body.innerHTML = V.kpis([{ label: 'Stock value at cost', value: inr(r.totals.costValue, 0) }, { label: 'At selling price', value: inr(r.totals.saleValue, 0) },
      { label: 'Expired stock (at cost)', value: inr(r.totals.expiredValue, 0), tone: r.totals.expiredValue > 0 ? 'bad' : '' }, { label: 'Dead stock (at cost)', value: inr(r.totals.deadValue, 0), tone: r.totals.deadValue > 0 ? 'warn' : '' },
      { label: 'Expiry & damage loss (all time)', value: inr(r.expiryLoss.total, 0) }])
      + V.tabs('stk', [['value', '💰 Valuation'], ['expiring', '⏳ Expiring'], ['loss', '🗑️ Expiry loss'], ['dead', '🧊 Dead stock'], ['slow', '🐢 Slow moving'], ['reorder', '🛒 Re-order']], tab)
      + '<div class="v-toolbar"><h3 class="v-h3" style="flex:1;margin:0;">' + h(d.title) + '</h3><button type="button" class="v-btn" data-act="stkXlsx">⬇️ Excel</button><button type="button" class="v-btn" data-act="stkPdf">🖨️ PDF / Print</button></div>'
      + (d.note ? '<p class="v-note">' + h(d.note) + '</p>' : '') + (d.pre || '')
      + V.table(d.head, d.rows.map(function (row) { return '<tr>' + row.map(function (v, i) { return V.td(fmt(v, i), typeof v === 'number'); }).join('') + '</tr>'; }),
        { empty: 'Nothing here 👍', foot: d.foot ? '<tr>' + d.foot.map(function (v, i) { return '<th' + (typeof v === 'number' ? ' class="num"' : '') + '>' + fmt(v, i) + '</th>'; }).join('') + '</tr>' : '' });
  }
  ACT.stkXlsx = function () { var d = K._cur; if (d && V.xlsx) V.xlsx.download(d.title + ' ' + V.today() + '.xlsx', [{ name: d.title.slice(0, 31), rows: [d.head].concat(d.rows).concat(d.foot ? [d.foot] : []) }]); };
  ACT.stkPdf = function () { var d = K._cur; if (d && V.report) V.report.print(d.title, d.head, d.rows, d.foot); };
})();
;

;/* ══ FILE: 17-clinic.js ══════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════
   17-clinic.js — patient profile (medical & dental history, allergies),
   patient records (treatments, bills, prescriptions, exams, visits),
   treatment price list, follow-ups, prescription / exam / receipt
   history from the server (same on every device)
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var V = window.V31, ACT = V.act, h = V.h, inr = V.inr, r2 = V.r2;
  var C = V.clinic = {};
  var DOCTORS = ['Dr. T. Venkat Rao', 'Dr. T. Sai Vakula'];
  var BLOOD = ['', 'A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−'];
  function sel(id, opts, cur) { return '<select id="' + id + '" class="v-in">' + opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : (o || '—'); return '<option value="' + h(v) + '"' + (String(v) === String(cur || '') ? ' selected' : '') + '>' + h(l) + '</option>'; }).join('') + '</select>'; }
  function ta(id, val, ph) { return '<textarea id="' + id + '" class="v-in" rows="2" maxlength="2000" placeholder="' + h(ph || '') + '">' + h(val || '') + '</textarea>'; }

  // ═══════════ patient profile (add / edit) ═══════════
  C.openProfile = function (id) {
    var p = id ? V.patientById(id) : null;
    V.dialog(p ? '✏️ ' + h(p.name) : '➕ New patient',
      '<div class="v-row2">' + V.field('ppName', 'Full name', V.input('ppName', 'maxlength="120" value="' + h(p ? p.name : '') + '"'))
      + V.field('ppPhone', 'Mobile', V.input('ppPhone', 'type="tel" maxlength="15" value="' + h(p ? p.phone : '') + '"')) + '</div>'
      + '<div class="v-row3">' + V.field('ppAge', 'Age', V.input('ppAge', 'maxlength="5" value="' + h(p ? p.age : '') + '"'))
      + V.field('ppSex', 'Sex', sel('ppSex', [['', '—'], ['M', 'Male'], ['F', 'Female'], ['O', 'Other']], p && p.sex))
      + V.field('ppDob', 'Date of birth', V.input('ppDob', 'type="date" value="' + h(p ? p.dob : '') + '"')) + '</div>'
      + '<div class="v-row3">' + V.field('ppDoctor', 'Doctor', sel('ppDoctor', [''].concat(DOCTORS), p && p.doctor))
      + V.field('ppBlood', 'Blood group', sel('ppBlood', BLOOD, p && p.bloodGroup))
      + V.field('ppStatus', 'Status', sel('ppStatus', ['Active', 'Due', 'Follow-up', 'Inactive'], p ? p.status : 'Active')) + '</div>'
      + V.field('ppAllergies', '⚠️ Allergies (medicines, latex, food…)', V.input('ppAllergies', 'maxlength="500" value="' + h(p ? p.allergies : '') + '" placeholder="e.g. Penicillin, Ibuprofen"'))
      + V.field('ppAlerts', 'Medical alerts (shown on screen)', V.input('ppAlerts', 'maxlength="500" value="' + h(p ? p.alerts : '') + '" placeholder="e.g. Diabetic, on blood thinners, pregnant"'))
      + V.field('ppMed', 'Medical history', ta('ppMed', p && p.medicalHistory, 'BP, diabetes, heart, asthma, thyroid, surgeries…'))
      + V.field('ppMeds', 'Current medicines', ta('ppMeds', p && p.medications, 'e.g. Metformin 500 BD, Aspirin 75 OD'))
      + V.field('ppDental', 'Dental history', ta('ppDental', p && p.dentalHistory, 'Previous RCT, extractions, braces, habits (tobacco, grinding)…'))
      + '<div class="v-row2">' + V.field('ppAddr', 'Address', V.input('ppAddr', 'maxlength="300" value="' + h(p ? p.address : '') + '"'))
      + V.field('ppEmerg', 'Emergency contact', V.input('ppEmerg', 'maxlength="120" value="' + h(p ? p.emergencyContact : '') + '" placeholder="Name · phone"')) + '</div>'
      + V.field('ppTreat', 'Current treatment (short note)', V.input('ppTreat', 'maxlength="300" value="' + h(p ? p.treatment : '') + '"'))
      + (p && +p.balance > 0 ? '<p class="v-note">Old balance from before billing: <b>' + inr(p.balance) + '</b> — collect it from 💰 Dues &amp; Payments.</p>' : '')
      + '<div id="ppMsg" class="v-msg"></div><button type="button" class="v-btn v-primary v-wide" data-act="ppSave" data-id="' + h(p ? p.id : '') + '">💾 Save patient</button>', { width: 640 });
  };
  ACT.ppSave = function (btn) {
    var name = V.val('ppName'); if (!name) return V.msg('ppMsg', 'Enter the name');
    var phone = V.val('ppPhone');
    if (phone && V.normPhone(phone).length !== 10) return V.msg('ppMsg', 'Mobile number should have 10 digits');
    var id = btn.dataset.id, old = id ? V.patientById(id) : null;
    if (!old) {
      var dup = V.patients().find(function (x) { return String(x.name).trim().toLowerCase() === name.toLowerCase() && phone && V.normPhone(x.phone) === V.normPhone(phone); });
      if (dup && !confirm(name + ' with this mobile number already exists. Save another record anyway?')) return;
    }
    var today = V.today(), p = Object.assign({}, old || { id: 'PT-' + Date.now(), balance: 0, addedOn: today, lastVisit: today }, {
      name: name, phone: phone, age: V.val('ppAge'), sex: V.val('ppSex'), dob: V.val('ppDob'), doctor: V.val('ppDoctor'), bloodGroup: V.val('ppBlood'), status: V.val('ppStatus') || 'Active',
      allergies: V.val('ppAllergies'), alerts: V.val('ppAlerts'), medicalHistory: V.val('ppMed'), medications: V.val('ppMeds'), dentalHistory: V.val('ppDental'),
      address: V.val('ppAddr'), emergencyContact: V.val('ppEmerg'), treatment: V.val('ppTreat') });
    var list = window._patients || (window._patients = []);
    var i = list.findIndex(function (x) { return String(x.id) === String(p.id); });
    if (i >= 0) list[i] = p; else list.push(p);
    try { localStorage.setItem('pt_records', JSON.stringify(list)); } catch (e) {}
    V.close(); renderPatientsTable(); updatePatientStats();
    API.call('savePatient', { id: p.id, name: p.name, phone: p.phone, age: p.age, sex: p.sex, doctor: p.doctor, treatment: p.treatment, balance: p.balance || 0, alerts: p.alerts,
      status: p.status, lastVisit: p.lastVisit, addedOn: p.addedOn, allergies: p.allergies, medicalHistory: p.medicalHistory, medications: p.medications, dentalHistory: p.dentalHistory,
      bloodGroup: p.bloodGroup, address: p.address, emergencyContact: p.emergencyContact, dob: p.dob }).then(function (res) {
      if (res.success) V.toast('✅ Patient saved');
      else if (res.queued) { p.syncStatus = 'pending'; V.toast('📴 Saved on this device — will sync', 'warning'); renderPatientsTable(); }
      else V.toast('❌ Not saved: ' + res.error, 'error');
    });
  };
  ACT.ptEdit = function (el) { C.openProfile(el.dataset.id); };
  ACT.ptNew = function () { C.openProfile(''); };
  ACT.ptRecords = function (el) { C.openRecords(el.dataset.id); };

  // ═══════════ patient records (everything about one patient) ═══════════
  V.tabRender.rec = function () { renderRecords(); };
  C.openRecords = async function (id, tab) {
    var p = V.patientById(id); if (!p) return;
    C._rec = { p: p, data: null }; V.tabState.rec = tab || 'overview';
    V.sheet('📁 ' + h(p.name), 'Loading records…');
    var res = await API.call('getPatientHistory', { patientId: p.id, name: p.name, phone: p.phone });
    if (!document.getElementById('v31SheetBody')) return;
    if (!res.success) { document.getElementById('v31SheetBody').innerHTML = '<div class="v-empty">' + h(res.error || 'Could not load (offline?)') + '</div>'; return; }
    C._rec.data = res; renderRecords();
  };
  function renderRecords() {
    var body = document.getElementById('v31SheetBody'), R = C._rec; if (!body || !R || !R.data) return;
    var p = V.patientById(R.p.id) || R.p, d = R.data, tab = V.tabState.rec || 'overview', today = V.today();
    var fu = d.followUps.filter(function (f) { return f.status === 'Pending'; })[0];
    var openTr = d.treatments.filter(function (t) { return t.status === 'Planned' || t.status === 'In progress'; });
    var head = '<div class="v-rec-head"><div><b>' + h(p.name) + '</b> <span class="v-muted">' + h([p.phone, p.age ? p.age + ' yrs' : '', p.sex, p.bloodGroup].filter(Boolean).join(' · ')) + '</span></div>'
      + '<div class="v-actions"><button type="button" class="v-btn v-sm" data-act="ptEdit" data-id="' + h(p.id) + '">✏️ Edit</button>'
      + '<button type="button" class="v-btn v-sm v-primary" data-act="trPlan" data-id="' + h(p.id) + '">➕ Treatment</button>'
      + '<button type="button" class="v-btn v-sm" data-act="fuNew" data-id="' + h(p.id) + '">🔔 Follow-up</button>'
      + (d.outstanding > 0 ? '<button type="button" class="v-btn v-sm v-warn" data-act="recCollect">💰 Collect ' + inr(d.outstanding, 0) + '</button>' : '') + '</div></div>'
      + V.alertsHtml(p);
    var tabs = V.tabs('rec', [['overview', '🩺 Overview'], ['treat', '🦷 Treatments (' + d.treatments.length + ')'], ['bills', '💰 Bills (' + (d.bills.length + d.receipts.length) + ')'],
      ['rx', '📋 Prescriptions (' + d.prescriptions.length + ')'], ['exams', '🔬 Exams (' + d.exams.length + ')'], ['visits', '📅 Visits']], tab), html = '';
    if (tab === 'overview') {
      var lastVisit = [].concat(d.bills.map(function (b) { return b.date; }), d.receipts.map(function (r) { return r.date; }), d.prescriptions.map(function (r) { return r.date; }), d.exams.map(function (e) { return e.date; })).filter(Boolean).sort().pop();
      html = V.kpis([{ label: 'Outstanding', value: inr(d.outstanding, 0), tone: d.outstanding > 0 ? 'warn' : 'ok' },
        { label: 'Total billed', value: inr(d.bills.filter(function (b) { return b.status !== 'Cancelled'; }).reduce(function (a, b) { return a + b.total; }, 0) + d.receipts.reduce(function (a, r) { return a + r.amount; }, 0), 0) },
        { label: 'Last visit', value: V.fmtDate(lastVisit) }, { label: 'Next follow-up', value: fu ? V.fmtDate(fu.dueDate) : '—', sub: fu ? h(fu.reason) : '' }])
        + '<div class="v-grid2"><div class="v-card"><h4 class="v-h4">Medical</h4><dl class="v-dl">'
        + [['Allergies', p.allergies], ['Alerts', p.alerts], ['Medical history', p.medicalHistory], ['Current medicines', p.medications], ['Blood group', p.bloodGroup]]
          .map(function (x) { return '<dt>' + x[0] + '</dt><dd>' + (x[1] ? h(x[1]) : '<span class="v-muted">—</span>') + '</dd>'; }).join('') + '</dl></div>'
        + '<div class="v-card"><h4 class="v-h4">Dental</h4><dl class="v-dl"><dt>Dental history</dt><dd>' + (p.dentalHistory ? h(p.dentalHistory) : '<span class="v-muted">—</span>') + '</dd>'
        + '<dt>Open treatments</dt><dd>' + (openTr.length ? openTr.map(function (t) { return h(t.treatment) + (t.tooth ? ' (' + h(t.tooth) + ')' : '') + ' ' + V.badge(t.status); }).join('<br>') : '<span class="v-muted">none</span>') + '</dd>'
        + '<dt>Last diagnosis</dt><dd>' + (d.exams[0] ? h(d.exams[0].final_diag || d.exams[0].prov_diag || '—') + ' <small class="v-muted">' + h(V.fmtDate(d.exams[0].date)) + '</small>' : '<span class="v-muted">—</span>') + '</dd>'
        + '<dt>Address</dt><dd>' + h(p.address || '—') + '</dd><dt>Emergency</dt><dd>' + h(p.emergencyContact || '—') + '</dd></dl></div></div>';
    } else if (tab === 'treat') {
      html = '<div class="v-actions"><button type="button" class="v-btn v-primary" data-act="trPlan" data-id="' + h(p.id) + '">➕ Plan / add treatment</button>'
        + (openTr.length ? '<button type="button" class="v-btn" data-act="trBillOpen">🦷 Make receipt for treatments</button>' : '') + '</div>'
        + V.table(['Date', 'Treatment', 'Tooth', 'Doctor', 'Price', 'Status', 'Receipt', ''], d.treatments.map(function (t) {
          return '<tr><td>' + h(V.fmtDate(t.date)) + '</td><td><b>' + h(t.treatment) + '</b>' + (t.notes ? '<br><small class="v-muted">' + h(t.notes) + '</small>' : '') + '</td><td>' + h(t.tooth) + '</td><td><small>' + h(t.doctor) + '</small></td>'
            + V.td(inr(t.price), 1) + '<td>' + V.badge(t.status) + (t.completedOn ? '<br><small>' + h(V.fmtDate(t.completedOn)) + '</small>' : '') + '</td><td><small>' + h(t.receiptNo) + '</small></td><td class="v-nowrap">'
            + (t.status === 'Planned' ? '<button type="button" class="v-btn v-sm" data-act="trStatus" data-id="' + h(t.id) + '" data-s="In progress">▶ Start</button> ' : '')
            + (t.status !== 'Completed' && t.status !== 'Cancelled' ? '<button type="button" class="v-btn v-sm v-primary" data-act="trStatus" data-id="' + h(t.id) + '" data-s="Completed">✓ Done</button> ' : '')
            + '<button type="button" class="v-btn v-sm" data-act="trPlan" data-id="' + h(p.id) + '" data-tid="' + h(t.id) + '">✏️</button></td></tr>';
        }), { empty: 'No treatments recorded yet.' });
    } else if (tab === 'bills') {
      html = V.table(['Date', 'Bill / receipt', 'Details', 'Total', 'Paid', 'Due', ''], d.bills.map(function (b) {
        return '<tr' + (b.status === 'Cancelled' ? ' class="v-strike"' : '') + '><td>' + h(V.fmtDate(b.date)) + '</td><td>💊 ' + h(b.billNo || b.billId) + '</td><td><small>' + h(b.items.map(function (i) { return i.medicineName + ' ×' + i.qty; }).join(', ')) + '</small></td>'
          + V.td(inr(b.total), 1) + V.td(inr(b.paidAmount - b.refundedAmount), 1) + V.td(b.balanceDue > 0 ? '<b class="v-bad">' + inr(b.balanceDue) + '</b>' : '—', 1)
          + '<td><button type="button" class="v-btn v-sm" data-act="billDetail" data-type="BILL" data-id="' + h(b.billId) + '">💰</button></td></tr>';
      }).concat(d.receipts.map(function (r) {
        return '<tr><td>' + h(V.fmtDate(r.date)) + '</td><td>🦷 ' + h(r.no || '—') + '</td><td><small>' + h(r.treatments) + '</small></td>' + V.td(inr(r.amount), 1) + V.td(inr(r.paidAmount), 1)
          + V.td(r.balanceDue > 0 ? '<b class="v-bad">' + inr(r.balanceDue) + '</b>' : '—', 1) + '<td>' + (r.recordId ? '<button type="button" class="v-btn v-sm" data-act="billDetail" data-type="RECEIPT" data-id="' + h(r.recordId) + '">💰</button>' : '') + '</td></tr>';
      })).sort(function (a, b) { return 0; }), { empty: 'No bills yet.' });
    } else if (tab === 'rx') {
      html = d.prescriptions.length ? d.prescriptions.map(function (r, i) {
        return '<div class="v-card v-rx"><div class="v-rx-head"><b>' + h(V.fmtDate(r.date)) + '</b> <span class="v-muted">' + h(r.doctor || '') + (r.followUpDate ? ' · follow-up ' + h(V.fmtDate(r.followUpDate)) : '') + '</span>'
          + '<span><button type="button" class="v-btn v-sm" data-act="rxLoadSrv" data-i="' + i + '" data-src="rec">✏️ Use again</button> <button type="button" class="v-btn v-sm" data-act="rxPrintSrv" data-i="' + i + '" data-src="rec">🖨️</button></span></div>'
          + '<pre class="v-pre">' + h(r.prescription) + '</pre></div>';
      }).join('') : '<div class="v-empty">No prescriptions yet.</div>';
    } else if (tab === 'exams') {
      html = d.exams.length ? d.exams.map(function (e, i) {
        return '<div class="v-card"><div class="v-rx-head"><b>' + h(V.fmtDate(e.date)) + '</b> <span class="v-muted">' + h(e.doctor) + '</span>'
          + '<span><button type="button" class="v-btn v-sm" data-act="efLoadSrv" data-i="' + i + '" data-src="rec">✏️ Open</button> <button type="button" class="v-btn v-sm" data-act="efPrintSrv" data-i="' + i + '" data-src="rec">🖨️</button></span></div>'
          + '<dl class="v-dl">' + [['Provisional diagnosis', e.prov_diag], ['Final diagnosis', e.final_diag], ['Treatment plan', e.treatments], ['Notes', e.tp_notes], ['Missing teeth', e.missing_teeth], ['Caries', e.caries]]
            .filter(function (x) { return x[1]; }).map(function (x) { return '<dt>' + x[0] + '</dt><dd>' + h(x[1]) + '</dd>'; }).join('') + '</dl></div>';
      }).join('') : '<div class="v-empty">No exam forms yet.</div>';
    } else {
      html = '<h4 class="v-h4">Follow-ups</h4>' + V.table(['Due', 'Reason', 'Status', ''], d.followUps.map(function (f) {
        return '<tr><td>' + h(V.fmtDate(f.dueDate)) + '</td><td>' + h(f.reason) + '</td><td>' + V.badge(f.status === 'Pending' && f.dueDate < today ? 'Overdue' : f.status) + '</td><td>'
          + (f.status === 'Pending' ? '<button type="button" class="v-btn v-sm v-primary" data-act="fuDone" data-id="' + h(f.id) + '">✓ Done</button>' : '') + '</td></tr>';
      }), { empty: 'No follow-ups.' })
        + '<h4 class="v-h4">Appointments</h4>' + V.table(['Date', 'Time', 'Reason', 'Doctor', 'Status'], d.appointments.map(function (a) {
          return '<tr><td>' + h(V.fmtDate(a.date)) + '</td><td>' + h(a.time) + '</td><td>' + h(a.reason) + '</td><td><small>' + h(a.doctor) + '</small></td><td>' + V.badge(a.status) + '</td></tr>';
        }), { empty: 'No appointments.' });
    }
    body.innerHTML = head + tabs + '<div class="v-rec-body">' + html + '</div>';
  }
  ACT.recCollect = function () {
    var R = C._rec; if (!R) return;
    var p = R.p, nm = String(p.name).trim().toLowerCase(), ph = V.normPhone(p.phone);
    V.money.openCollect(V.data.receivables.filter(function (r) { return r.patientId ? r.patientId === String(p.id) : String(r.patientName).trim().toLowerCase() === nm && (!ph || !r.phone || V.normPhone(r.phone) === ph); }));
  };
  async function reloadRecords() { if (C._rec && document.getElementById('v31SheetBody')) { var t = V.tabState.rec; await C.openRecords(C._rec.p.id, t); } }

  // ── plan / edit a treatment ──
  C.master = function () { return V.data.treatmentMaster.filter(function (t) { return t.status !== 'Inactive'; }).sort(function (a, b) { return (a.category + a.name).localeCompare(b.category + b.name); }); };
  ACT.trPlan = function (el) {
    var p = V.patientById(el.dataset.id); if (!p) return;
    var t = el.dataset.tid && C._rec && C._rec.data ? C._rec.data.treatments.find(function (x) { return x.id === el.dataset.tid; }) : null;
    var groups = {}; C.master().forEach(function (m) { (groups[m.category || 'Other'] = groups[m.category || 'Other'] || []).push(m); });
    V.dialog((t ? '✏️ ' : '➕ ') + 'Treatment · ' + h(p.name),
      V.field('tpT', 'Treatment', '<select id="tpT" class="v-in" data-change="tpPick"><option value="">Choose from price list…</option>'
        + Object.keys(groups).map(function (g) { return '<optgroup label="' + h(g) + '">' + groups[g].map(function (m) { return '<option value="' + h(m.id) + '" data-price="' + m.price + '"' + (t && t.treatmentId === m.id ? ' selected' : '') + '>' + h(m.name) + (m.price ? ' — ' + inr(m.price, 0) : '') + '</option>'; }).join('') + '</optgroup>'; }).join('')
        + '<option value="__other"' + (t && !t.treatmentId ? ' selected' : '') + '>Other (type below)</option></select>')
      + '<div id="tpOtherWrap"' + (t && !t.treatmentId ? '' : ' hidden') + '>' + V.field('tpName', 'Treatment name', V.input('tpName', 'maxlength="200" value="' + h(t && !t.treatmentId ? t.treatment : '') + '"')) + '</div>'
      + '<div class="v-row3">' + V.field('tpTooth', 'Tooth / area', V.input('tpTooth', 'maxlength="60" placeholder="e.g. 36, UL quadrant" value="' + h(t ? t.tooth : '') + '"'))
      + V.field('tpPrice', 'Price ₹', V.input('tpPrice', 'type="number" min="0" step="1" value="' + (t ? t.price : '') + '"'))
      + V.field('tpStatus', 'Status', sel('tpStatus', ['Planned', 'In progress', 'Completed', 'Cancelled'], t ? t.status : 'Planned')) + '</div>'
      + '<div class="v-row2">' + V.field('tpDoctor', 'Doctor', sel('tpDoctor', [''].concat(DOCTORS), t ? t.doctor : p.doctor)) + V.field('tpDate', 'Date', V.input('tpDate', 'type="date" value="' + (t ? t.date : V.today()) + '"')) + '</div>'
      + V.field('tpNotes', 'Notes', V.input('tpNotes', 'maxlength="1000" value="' + h(t ? t.notes : '') + '"'))
      + '<div id="tpMsg" class="v-msg"></div><button type="button" class="v-btn v-primary v-wide" data-act="tpSave" data-id="' + h(p.id) + '" data-tid="' + h(t ? t.id : '') + '">Save treatment</button>', { width: 520 });
  };
  ACT.tpPick = function (el) {
    document.getElementById('tpOtherWrap').hidden = el.value !== '__other';
    var o = el.options[el.selectedIndex]; if (o && o.dataset.price && +o.dataset.price > 0) document.getElementById('tpPrice').value = o.dataset.price;
  };
  ACT.tpSave = async function (btn) {
    var p = V.patientById(btn.dataset.id), tid = V.val('tpT'), m = C.master().find(function (x) { return x.id === tid; });
    var name = tid === '__other' ? V.val('tpName') : (m ? m.name : ''); if (!name) return V.msg('tpMsg', 'Choose a treatment');
    V.busy(btn, true);
    var res = await API.call('savePatientTreatment', { id: btn.dataset.tid || newId('PTR'), patientId: p.id, patientName: p.name, phone: p.phone, treatmentId: m ? m.id : '', treatment: name,
      tooth: V.val('tpTooth'), price: V.val('tpPrice'), status: V.val('tpStatus'), doctor: V.val('tpDoctor'), date: V.val('tpDate'), notes: V.val('tpNotes') });
    V.busy(btn, false);
    if (!res.success && !res.queued) return V.msg('tpMsg', res.error);
    V.close(); V.toast(res.queued ? '📴 Saved on this device' : '✅ Treatment saved'); loadData(); reloadRecords();
  };
  ACT.trStatus = async function (el) {
    var res = await API.call('setPatientTreatmentStatus', { id: el.dataset.id, status: el.dataset.s });
    if (!res.success && !res.queued) return V.toast('❌ ' + res.error, 'error');
    V.toast(el.dataset.s === 'Completed' ? '✓ Marked done' : '▶ Started');
    loadData(); reloadRecords();
  };
  // bill open treatments → treatment receipt page, prefilled
  ACT.trBillOpen = function () {
    var R = C._rec; if (!R) return;
    var open = R.data.treatments.filter(function (t) { return (t.status === 'Planned' || t.status === 'In progress' || t.status === 'Completed') && !t.receiptNo; });
    if (!open.length) return V.toast('No unbilled treatments', 'info');
    V.dialog('🦷 Which treatments go on the receipt?', open.map(function (t, i) {
      return '<label class="v-check"><input type="checkbox" id="tb' + i + '" checked> ' + h(t.treatment) + (t.tooth ? ' (' + h(t.tooth) + ')' : '') + ' — <b>' + inr(t.price) + '</b> ' + V.badge(t.status) + '</label>';
    }).join('') + '<button type="button" class="v-btn v-primary v-wide" data-act="trBillGo">Continue to receipt</button>', { width: 480 });
    C._billable = open;
  };
  ACT.trBillGo = function () {
    var chosen = C._billable.filter(function (t, i) { return document.getElementById('tb' + i).checked; }); if (!chosen.length) return;
    var p = C._rec.p; V.close(); V.closeSheet();
    showPage('treatmentreceipt');
    C.fillReceipt(p, chosen);
  };
  C.fillReceipt = function (p, list) {
    var pi = document.getElementById('tr_patient'); if (pi) { pi.value = p.name; pi.dataset.patientId = p.id; }
    var tt = document.getElementById('tr_treatment_text'); if (tt) tt.value = list.map(function (t) { return t.treatment + (t.tooth ? ' (' + t.tooth + ')' : ''); }).join('\n');
    var total = r2(list.reduce(function (a, t) { return a + (+t.price || 0); }, 0));
    var am = document.getElementById('tr_amount'); if (am) am.value = total || '';
    var w = document.getElementById('tr_words'); if (w && total) w.value = V.words(total);
    C._receiptTreatments = list.map(function (t) { return t.id; });
    C._receiptItems = list.map(function (t) { return { name: t.treatment, tooth: t.tooth, price: t.price }; });
    if (typeof updateTreatmentPreview === 'function') updateTreatmentPreview();
  };

  // ═══════════ treatment receipt page: price list chips + patient link ═══════════
  C.enhanceReceiptPage = function () {
    var ta = document.getElementById('tr_treatment_text'); if (!ta || document.getElementById('v31TrPick')) return;
    var box = document.createElement('div'); box.id = 'v31TrPick'; box.className = 'v31-only v-tr-pick'; box.hidden = !V.enabled();
    ta.parentNode.parentNode.insertBefore(box, ta.parentNode.nextSibling);
    C.renderChips();
    V.attachPatientPicker(document.getElementById('tr_patient'), { onPick: function (p) { C.showPlanned(p); } });
  };
  C.renderChips = function () {
    var box = document.getElementById('v31TrPick'); if (!box) return;
    var list = C.master().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    box.innerHTML = '<div class="v-lbl">Add from price list <small class="v-muted">(tap to add · amount adds up)</small></div><div class="v-chips">'
      + list.map(function (t) { return '<button type="button" class="v-chip" data-act="trChip" data-id="' + h(t.id) + '">' + h(t.name) + (t.price ? ' · ' + inr(t.price, 0) : '') + '</button>'; }).join('')
      + (API.isOwner() ? '<button type="button" class="v-chip v-chip-edit" data-act="priceList">✏️ Edit prices</button>' : '') + '</div><div id="v31Planned"></div>';
  };
  ACT.trChip = function (el) {
    var t = V.data.treatmentMaster.find(function (x) { return x.id === el.dataset.id; }); if (!t) return;
    var ta = document.getElementById('tr_treatment_text'); ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + t.name;
    if (t.price) { var am = document.getElementById('tr_amount'); var tot = r2((parseFloat(am.value) || 0) + t.price); am.value = tot; var w = document.getElementById('tr_words'); if (w) w.value = V.words(tot); }
    C._receiptItems = (C._receiptItems || []).concat([{ name: t.name, price: t.price }]);
    if (typeof updateTreatmentPreview === 'function') updateTreatmentPreview();
  };
  C.showPlanned = function (p) {
    var el = document.getElementById('v31Planned'); if (!el) return;
    var open = V.data.patientTreatments.filter(function (t) { return (t.patientId ? t.patientId === String(p.id) : t.patientName.toLowerCase() === String(p.name).toLowerCase()) && !t.receiptNo && t.status !== 'Cancelled'; });
    el.innerHTML = open.length ? '<div class="v-note">🦷 ' + h(p.name) + ' has ' + open.length + ' unbilled treatment(s): ' + open.map(function (t) { return h(t.treatment) + ' ' + inr(t.price, 0); }).join(', ')
      + ' <button type="button" class="v-link" data-act="trUsePlanned" data-id="' + h(p.id) + '">Put them on this receipt</button></div>' : '';
    C._planned = open;
  };
  ACT.trUsePlanned = function (el) { var p = V.patientById(el.dataset.id); if (p && C._planned) C.fillReceipt(p, C._planned); };
  V.whenShown('treatmentreceipt', C.enhanceReceiptPage);
  document.addEventListener('DOMContentLoaded', function () { setTimeout(C.enhanceReceiptPage, 400); });
  // what the receipt save sends (used by 02-treatment-payment / printTreatmentReceipt)
  C.receiptExtras = function () {
    var out = { patientId: V.patientIdFor('tr_patient'), treatmentRecordIds: JSON.stringify(C._receiptTreatments || []), items: JSON.stringify(C._receiptItems || []) };
    var p = out.patientId ? V.patientById(out.patientId) : null; if (p) out.phone = p.phone || '';
    return out;
  };
  C.clearReceiptExtras = function () { C._receiptTreatments = []; C._receiptItems = []; var pi = document.getElementById('tr_patient'); if (pi && pi._v31Clear) pi._v31Clear(); var pl = document.getElementById('v31Planned'); if (pl) pl.innerHTML = ''; };

  // ═══════════ treatment price list (owner) ═══════════
  ACT.priceList = function () {
    var list = V.data.treatmentMaster.slice().sort(function (a, b) { return (a.category + a.name).localeCompare(b.category + b.name); });
    V.dialog('🦷 Treatment price list',
      '<p class="v-note">These prices fill in automatically on receipts and treatment plans. Change any time.</p>'
      + V.table(['Treatment', 'Category', 'Price ₹', 'In use', ''], list.map(function (t, i) {
        return '<tr><td><input class="v-in" id="pl_n' + i + '" value="' + h(t.name) + '" maxlength="120"></td><td><input class="v-in v-in-sm" id="pl_c' + i + '" value="' + h(t.category) + '" maxlength="60"></td>'
          + '<td class="num"><input class="v-in v-in-sm" type="number" min="0" step="1" id="pl_p' + i + '" value="' + t.price + '"></td>'
          + '<td><input type="checkbox" id="pl_a' + i + '"' + (t.status !== 'Inactive' ? ' checked' : '') + ' aria-label="In use"></td>'
          + '<td><button type="button" class="v-btn v-sm v-primary" data-act="plSave" data-i="' + i + '">Save</button></td></tr>';
      }), { scroll: true })
      + '<h4 class="v-h4">Add a treatment</h4><div class="v-row3">' + V.field('plNewN', 'Name', V.input('plNewN', 'maxlength="120"')) + V.field('plNewC', 'Category', V.input('plNewC', 'maxlength="60"'))
      + V.field('plNewP', 'Price ₹', V.input('plNewP', 'type="number" min="0" step="1"')) + '</div><div id="plMsg" class="v-msg"></div>'
      + '<button type="button" class="v-btn v-primary" data-act="plAdd">➕ Add</button>', { width: 720 });
    C._pl = list;
  };
  ACT.plSave = async function (btn) {
    var i = +btn.dataset.i, t = C._pl[i];
    V.busy(btn, true, '…');
    var res = await API.call('saveTreatment', { id: t.id, name: V.val('pl_n' + i), category: V.val('pl_c' + i), price: V.num('pl_p' + i), status: document.getElementById('pl_a' + i).checked ? 'Active' : 'Inactive' }, { noQueue: true });
    V.busy(btn, false);
    if (!res.success) return V.msg('plMsg', res.error);
    btn.textContent = '✓'; await loadData(); C.renderChips();
  };
  ACT.plAdd = async function (btn) {
    if (!V.val('plNewN')) return V.msg('plMsg', 'Enter the name');
    V.busy(btn, true);
    var res = await API.call('saveTreatment', { name: V.val('plNewN'), category: V.val('plNewC'), price: V.num('plNewP') }, { noQueue: true });
    V.busy(btn, false);
    if (!res.success) return V.msg('plMsg', res.error);
    await loadData(); C.renderChips(); ACT.priceList();
  };

  // ═══════════ follow-ups ═══════════
  V.pages.followups = function () {
    var page = document.getElementById('followups'); if (!page) return;
    var today = V.today(), week = V.addDays(today, 7), all = V.data.followUps.filter(function (f) { return f.status === 'Pending'; });
    var over = all.filter(function (f) { return f.dueDate < today; }), now = all.filter(function (f) { return f.dueDate === today; }), soon = all.filter(function (f) { return f.dueDate > today && f.dueDate <= week; }), later = all.filter(function (f) { return f.dueDate > week; });
    var done = V.data.followUps.filter(function (f) { return f.status === 'Done'; }).slice(-10).reverse();
    var block = function (title, list, tone) {
      return '<div class="v-card"><h3 class="v-h3">' + title + ' <span class="v-count' + (tone ? ' ' + tone : '') + '">' + list.length + '</span></h3>'
        + (list.length ? list.sort(function (a, b) { return a.dueDate.localeCompare(b.dueDate); }).map(function (f) {
          var p = f.patientId ? V.patientById(f.patientId) : null;
          return '<div class="v-fu"><div><b>' + h(f.patientName) + '</b> <span class="v-muted">' + h(f.phone || (p && p.phone) || '') + '</span><br><small>' + h(V.fmtDate(f.dueDate)) + ' · ' + h(f.reason || 'Review') + (f.doctor ? ' · ' + h(f.doctor) : '') + '</small></div>'
            + '<div class="v-actions">' + ((f.phone || (p && p.phone)) ? '<button type="button" class="v-btn v-sm v-wa" data-act="fuWa" data-id="' + h(f.id) + '">📲</button>' : '')
            + '<button type="button" class="v-btn v-sm" data-act="fuBook" data-id="' + h(f.id) + '">📅 Book</button>'
            + '<button type="button" class="v-btn v-sm v-primary" data-act="fuDone" data-id="' + h(f.id) + '">✓ Done</button>'
            + '<button type="button" class="v-btn v-sm" data-act="fuCancel" data-id="' + h(f.id) + '" aria-label="Cancel follow-up">✖</button></div></div>';
        }).join('') : '<div class="v-empty">None 👍</div>') + '</div>';
    };
    page.innerHTML = V.kpis([{ label: 'Overdue', value: over.length, tone: over.length ? 'bad' : 'ok' }, { label: 'Due today', value: now.length, tone: now.length ? 'warn' : '' }, { label: 'Next 7 days', value: soon.length }])
      + '<div class="v-toolbar"><button type="button" class="v-btn v-primary" data-act="fuNew">➕ Add follow-up</button>'
      + (over.length + now.length ? '<span class="v-muted">Tip: 📲 sends a ready-made WhatsApp reminder.</span>' : '') + '</div>'
      + block('⚠️ Overdue', over, 'bad') + block('📅 Today', now, 'warn') + block('🗓️ Next 7 days', soon) + (later.length ? block('Later', later) : '')
      + (done.length ? '<details class="v-details"><summary>Recently done (' + done.length + ')</summary>' + done.map(function (f) { return '<div class="v-fu v-dim"><div>' + h(f.patientName) + ' · ' + h(V.fmtDate(f.dueDate)) + ' · ' + h(f.reason) + '</div><small>' + h(f.doneBy) + '</small></div>'; }).join('') + '</details>' : '');
  };
  ACT.fuNew = function (el) {
    var p = el && el.dataset.id ? V.patientById(el.dataset.id) : null;
    V.dialog('🔔 New follow-up',
      V.field('fuName', 'Patient', V.input('fuName', 'maxlength="120" value="' + h(p ? p.name : '') + '"'))
      + V.field('fuPhone', 'Mobile', V.input('fuPhone', 'type="tel" maxlength="15" value="' + h(p ? p.phone : '') + '"'))
      + '<div class="v-row2">' + V.field('fuDays', 'After', '<select id="fuDays" class="v-in" data-change="fuDaysPick"><option value="">Choose…</option><option value="3">3 days</option><option value="7" selected>1 week</option><option value="14">2 weeks</option><option value="30">1 month</option><option value="90">3 months</option><option value="180">6 months</option></select>')
      + V.field('fuDate', 'Date', V.input('fuDate', 'type="date" min="' + V.today() + '" value="' + V.addDays(V.today(), 7) + '"')) + '</div>'
      + V.field('fuReason', 'Reason', '<input id="fuReason" class="v-in" list="fuReasons" maxlength="200" value="Review"><datalist id="fuReasons"><option>Review</option><option>RCT next sitting</option><option>Suture removal</option><option>Crown fitting</option><option>Braces adjustment</option><option>6-month check-up & cleaning</option><option>Denture trial</option></datalist>')
      + V.field('fuDoctor', 'Doctor', sel('fuDoctor', [''].concat(DOCTORS), p && p.doctor))
      + '<div id="fuMsg" class="v-msg"></div><button type="button" class="v-btn v-primary v-wide" data-act="fuSave" data-pid="' + h(p ? p.id : '') + '">Save follow-up</button>', { width: 460 });
    var inp = document.getElementById('fuName');
    V.attachPatientPicker(inp, { phone: 'fuPhone' }); if (p) inp.dataset.patientId = p.id;
  };
  ACT.fuDaysPick = function (el) { if (el.value) document.getElementById('fuDate').value = V.addDays(V.today(), +el.value); };
  ACT.fuSave = async function (btn) {
    var name = V.val('fuName'); if (!name) return V.msg('fuMsg', 'Enter the patient'); if (!V.val('fuDate')) return V.msg('fuMsg', 'Choose the date');
    var pid = V.patientIdFor('fuName', 'fuPhone') || btn.dataset.pid;
    V.busy(btn, true);
    var f = { id: newId('FU'), patientId: pid, patientName: name, phone: V.val('fuPhone'), dueDate: V.val('fuDate'), reason: V.val('fuReason'), doctor: V.val('fuDoctor'), source: 'Manual', status: 'Pending' };
    var res = await API.call('saveFollowUp', f);
    V.busy(btn, false);
    if (!res.success && !res.queued) return V.msg('fuMsg', res.error);
    V.data.followUps.push(f); V.close(); V.toast('🔔 Follow-up on ' + V.fmtDate(f.dueDate)); if (!res.queued) loadData(); V.refresh(); reloadRecords();
  };
  C.createFollowUp = function (o) {   // from prescription / treatment screens
    var f = Object.assign({ id: newId('FU'), status: 'Pending', source: 'Prescription' }, o);
    V.data.followUps.push(f);
    return API.call('saveFollowUp', f);
  };
  async function setFu(id, status) {
    var res = await API.call('setFollowUpStatus', { id: id, status: status });
    if (!res.success && !res.queued) return V.toast('❌ ' + res.error, 'error');
    var f = V.data.followUps.find(function (x) { return x.id === id; }); if (f) f.status = status;
    V.refresh(); if (!res.queued) loadData(); reloadRecords();
  }
  ACT.fuDone = function (el) { setFu(el.dataset.id, 'Done'); };
  ACT.fuCancel = function (el) { if (confirm('Cancel this follow-up?')) setFu(el.dataset.id, 'Cancelled'); };
  ACT.fuWa = function (el) {
    var f = V.data.followUps.find(function (x) { return x.id === el.dataset.id; }); if (!f) return;
    var p = f.patientId ? V.patientById(f.patientId) : null, phone = f.phone || (p && p.phone);
    var msg = '*🦷 Sri Sai Speciality Dental Care*\n\nHello *' + f.patientName + '*! 😊\nThis is a reminder for your *' + (f.reason || 'review') + '* visit '
      + (f.dueDate <= V.today() ? '(due now)' : 'on *' + V.fmtDate(f.dueDate) + '*') + '.\nPlease call us to book a convenient time.\n\n📞 ' + (CONFIG.clinicPhone || '') + '\n🕐 ' + (CONFIG.clinicTimings || '');
    openWhatsApp(V.waPhone(phone), msg);
  };
  ACT.fuBook = function (el) {
    var f = V.data.followUps.find(function (x) { return x.id === el.dataset.id; }); if (!f) return;
    showPage('appointments');
    setTimeout(function () {
      if (typeof openAddApptModal === 'function') openAddApptModal();
      var set = function (id, v) { var e = document.getElementById(id); if (e && v) e.value = v; };
      set('appt_patient', f.patientName); set('appt_phone', f.phone); set('appt_bookDate', f.dueDate); set('appt_reason', f.reason); set('appt_doctor', f.doctor);
    }, 120);
  };

  // ═══════════ server history: prescriptions, exams, receipts ═══════════
  var HIST = { rx: { kind: 'prescriptions', list: 'rx_history_list', title: '☁️ All prescriptions (every device)' },
    ef: { kind: 'exams', list: 'ef_history_list', title: '☁️ All exam forms (every device)' },
    tr: { kind: 'receipts', list: 'tr_history_list', title: '☁️ All treatment receipts (every device)' } };
  C.histState = {};
  C.mountHistory = function (key) {
    var cfg = HIST[key], anchor = document.getElementById(cfg.list); if (!anchor || !V.enabled()) return;
    var box = document.getElementById('v31Hist_' + key);
    if (!box) {
      box = document.createElement('details'); box.id = 'v31Hist_' + key; box.className = 'v-details v-srv-hist';
      box.innerHTML = '<summary>' + cfg.title + '</summary><div class="v-toolbar"><input class="v-in" type="search" placeholder="🔍 Search name, medicine, diagnosis…" data-enter="histSearch" data-k="' + key + '">'
        + '<button type="button" class="v-btn" data-act="histSearch" data-k="' + key + '">Search</button></div><div class="v-hist-list"></div>';
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
      box.addEventListener('toggle', function () { if (box.open && !C.histState[key]) C.loadHistory(key, true); });
    }
  };
  C.loadHistory = async function (key, reset) {
    var cfg = HIST[key], box = document.getElementById('v31Hist_' + key); if (!box) return;
    var st = C.histState[key] = reset ? { records: [], cursor: '', q: (box.querySelector('input') || {}).value || '' } : C.histState[key];
    var listEl = box.querySelector('.v-hist-list'); if (reset) listEl.innerHTML = 'Loading…';
    var res = await API.call('getRecentRecords', { kind: cfg.kind, limit: 30, cursor: st.cursor, q: st.q });
    if (!res.success) { listEl.textContent = res.error || 'Could not load (offline?)'; return; }
    st.records = st.records.concat(res.records); st.cursor = res.cursor;
    listEl.innerHTML = (st.records.length ? st.records.map(function (r, i) { return histRow(key, r, i); }).join('') : '<div class="v-empty">Nothing found.</div>')
      + (res.cursor ? '<button type="button" class="v-btn v-wide" data-act="histMore" data-k="' + key + '">⬇ Load older</button>' : '');
  };
  function histRow(key, r, i) {
    var btns = key === 'rx' ? '<button type="button" class="v-btn v-sm" data-act="rxLoadSrv" data-i="' + i + '">✏️ Use</button> <button type="button" class="v-btn v-sm" data-act="rxPrintSrv" data-i="' + i + '">🖨️</button>'
      : key === 'ef' ? '<button type="button" class="v-btn v-sm" data-act="efLoadSrv" data-i="' + i + '">✏️ Open</button> <button type="button" class="v-btn v-sm" data-act="efPrintSrv" data-i="' + i + '">🖨️</button>'
        : (r.recordId ? '<button type="button" class="v-btn v-sm" data-act="billDetail" data-type="RECEIPT" data-id="' + h(r.recordId) + '">💰</button> ' : '') + '<button type="button" class="v-btn v-sm" data-act="trPrintSrv" data-i="' + i + '">🖨️</button>';
    var title = key === 'rx' ? r.patientName : r.patient, sub = key === 'rx' ? String(r.prescription || '').replace(/\s+/g, ' ').slice(0, 90)
      : key === 'ef' ? (r.final_diag || r.prov_diag || r.treatments || '') : (r.no ? r.no + ' · ' : '') + inr(r.amount) + (r.balanceDue > 0 ? ' · due ' + inr(r.balanceDue) : '') + ' · ' + String(r.treatments || '').slice(0, 60);
    return '<div class="v-hist-row"><div><b>' + h(title || '—') + '</b> <span class="v-muted">' + h(V.fmtDate(r.date)) + (r.createdBy ? ' · ' + h(r.createdBy) : '') + '</span><br><small>' + h(sub) + '</small></div><div class="v-actions">' + btns + '</div></div>';
  }
  ACT.histSearch = function (el) { C.loadHistory(el.dataset.k, true); };
  ACT.histMore = function (el) { C.loadHistory(el.dataset.k, false); };
  function srcRec(el, key) { return el.dataset.src === 'rec' ? (C._rec && C._rec.data && C._rec.data[key === 'rx' ? 'prescriptions' : 'exams'][+el.dataset.i]) : (C.histState[key] && C.histState[key].records[+el.dataset.i]); }
  ACT.rxLoadSrv = function (el) {
    var r = srcRec(el, 'rx'); if (!r) return;
    if (el.dataset.src === 'rec') { V.closeSheet(); showPage('prescription'); }
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.value = v || ''; };
    set('rx_name', r.patientName); set('rx_age', r.age); set('rx_sex', r.sex); set('rx_date', V.today()); set('rx_content', r.prescription);
    if (typeof updateRxPreview === 'function') updateRxPreview();
    window.scrollTo(0, 0); V.toast('Loaded — change if needed, then print');
  };
  ACT.rxPrintSrv = function (el) {
    var r = srcRec(el, 'rx'); if (!r) return;
    var keep = ['rx_name', 'rx_age', 'rx_sex', 'rx_date', 'rx_content'].map(function (id) { var e = document.getElementById(id); return e ? e.value : ''; });
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.value = v || ''; };
    set('rx_name', r.patientName); set('rx_age', r.age); set('rx_sex', r.sex); set('rx_date', r.date); set('rx_content', r.prescription);
    var html = buildPrescriptionHTML();
    ['rx_name', 'rx_age', 'rx_sex', 'rx_date', 'rx_content'].forEach(function (id, i) { set(id, keep[i]); });
    printBillHtml(html);
  };
  function examFromServer(r) {
    var teeth = {}, parse = function (s) { String(s || '').split(',').forEach(function (x) { var m = x.trim().match(/^(\d+):(.*)$/); if (m) teeth[m[1]] = m[2].trim(); }); };
    parse(r.upper_teeth); parse(r.lower_teeth);
    return Object.assign({}, r, { teeth: teeth, treatments: String(r.treatments || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean) });
  }
  ACT.efLoadSrv = function (el) {
    var r = srcRec(el, 'ef'); if (!r) return;
    if (el.dataset.src === 'rec') { V.closeSheet(); showPage('examform'); }
    if (typeof loadExamData === 'function') loadExamData(examFromServer(r));
    window.scrollTo(0, 0);
  };
  ACT.efPrintSrv = function (el) { var r = srcRec(el, 'ef'); if (r && typeof buildExamPrintHTML === 'function') printBillHtml(buildExamPrintHTML(examFromServer(r))); };
  ACT.trPrintSrv = function (el) {
    var r = C.histState.tr && C.histState.tr.records[+el.dataset.i]; if (!r) return;
    var ids = ['tr_no', 'tr_date', 'tr_patient', 'tr_amount', 'tr_words', 'tr_treatment_text'], keep = ids.map(function (id) { var e = document.getElementById(id); return e ? e.value : ''; });
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.value = v === undefined || v === null ? '' : v; };
    set('tr_no', r.no); set('tr_date', r.date); set('tr_patient', r.patient); set('tr_amount', r.paidAmount !== undefined && r.paidAmount < r.amount ? r.paidAmount : r.amount);
    set('tr_words', r.amountWords || V.words(r.amount)); set('tr_treatment_text', String(r.treatments || '').split(/,\s*|\n/).join('\n'));
    var html = buildTreatmentReceiptHTML(true);
    ids.forEach(function (id, i) { set(id, keep[i]); });
    printBillHtml(html);
  };
  V.whenShown('prescription', function () { C.mountHistory('rx'); C.attachRx(); });
  V.whenShown('examform', function () { C.mountHistory('ef'); C.attachEf(); });
  V.whenShown('treatmentreceipt', function () { C.mountHistory('tr'); });

  // prescription page: patient link, allergy banner, follow-up after N days
  C.attachRx = function () {
    var n = document.getElementById('rx_name'); if (!n || !V.enabled()) return;
    V.attachPatientPicker(n, { onPick: function (p) { var a = document.getElementById('rx_age'), s = document.getElementById('rx_sex'); if (a && !a.value) a.value = p.age || ''; if (s && !s.value && p.sex) s.value = p.sex; } });
    var c = document.getElementById('rx_content');
    if (c && !document.getElementById('rxFuDays')) {
      var box = document.createElement('div'); box.className = 'v31-only v-inline-row';
      box.innerHTML = '<label for="rxFuDays">🔔 Follow-up after</label><select id="rxFuDays" class="v-in v-in-sm"><option value="">No follow-up</option><option value="3">3 days</option><option value="5">5 days</option><option value="7">1 week</option><option value="14">2 weeks</option><option value="30">1 month</option><option value="180">6 months</option></select>'
        + '<label for="rxDoctor">Doctor</label>' + sel('rxDoctor', [''].concat(DOCTORS), '');
      c.parentNode.insertBefore(box, c.nextSibling);
    }
  };
  C.rxExtras = function () {
    var out = { patientId: V.patientIdFor('rx_name'), doctor: V.val('rxDoctor') }, days = parseInt(V.val('rxFuDays'), 10);
    if (days > 0) {
      out.followUpDate = V.addDays(V.val('rx_date') || V.today(), days);
      var p = out.patientId ? V.patientById(out.patientId) : null;
      C.createFollowUp({ patientId: out.patientId, patientName: V.val('rx_name'), phone: p ? p.phone : '', dueDate: out.followUpDate, reason: 'Review after prescription', doctor: out.doctor });
      var s = document.getElementById('rxFuDays'); if (s) s.value = '';
    }
    return out;
  };
  C.attachEf = function () { var n = document.getElementById('ef_patient'); if (n && V.enabled()) V.attachPatientPicker(n, { phone: 'ef_phone', onPick: function (p) { var a = document.getElementById('ef_age'), s = document.getElementById('ef_sex'); if (a && !a.value) a.value = p.age || ''; if (s && !s.value && p.sex) s.value = p.sex; } }); };

  // ═══════════ patients page: records + edit buttons, real outstanding ═══════════
  C.rowButtons = function (p) {
    if (!V.enabled()) return '';
    return '<button type="button" data-act="ptRecords" data-id="' + h(p.id) + '" class="v-btn v-sm" title="All records">📁</button> '
      + '<button type="button" data-act="ptEdit" data-id="' + h(p.id) + '" class="v-btn v-sm" title="Edit profile">✏️</button> ';
  };
  C.balanceOf = function (p) { return V.enabled() ? V.outstandingOf(p) : (parseFloat(p.balance) || 0); };
  C.totalDue = function () { return r2(V.data.receivables.reduce(function (a, r) { return a + r.balance; }, 0)); };
  // New Bill / Combined bill: link the patient, show allergies
  document.addEventListener('DOMContentLoaded', function () {
    V.attachPatientPicker(document.getElementById('patientName'), { phone: 'patientPhone' });
    V.attachPatientPicker(document.getElementById('cb_patient'), { phone: 'cb_phone' });
  });
  V.afterRefresh.push(function () { var b = document.getElementById('v31TrPick'); if (b) { b.hidden = !V.enabled(); C.renderChips(); } });
})();
;

;/* ══ FILE: 18-finance.js ══════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════
   18-finance.js — owner finance: profit dashboard, monthly & annual
   (April–March) statements, receivables / payables, full report list,
   Excel (.xlsx) and PDF export. No GST (the pharmacy is not registered).
   Data for any period comes from the server (getReportData), so old
   months work even though only recent data is kept on the phone.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var V = window.V31, ACT = V.act, h = V.h, inr = V.inr, r2 = V.r2;
  var F = V.fin = { cache: {} };

  // ═══════════ Excel (.xlsx) writer — no library, works offline ═══════════
  var X = V.xlsx = {};
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {     // files: [{name, data(Uint8Array)}] → Blob (stored, no compression)
    var enc = new TextEncoder(), parts = [], central = [], off = 0;
    var u16 = function (v) { return [v & 255, (v >>> 8) & 255]; }, u32 = function (v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; };
    files.forEach(function (f) {
      var name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      var head = [].concat([0x50, 0x4b, 0x03, 0x04], u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(size), u32(size), u16(name.length), u16(0));
      parts.push(new Uint8Array(head), name, f.data);
      central.push(new Uint8Array([].concat([0x50, 0x4b, 0x01, 0x02], u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(size), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off))), name);
      off += head.length + name.length + size;
    });
    var cdSize = central.reduce(function (a, p) { return a + p.length; }, 0);
    var end = new Uint8Array([].concat([0x50, 0x4b, 0x05, 0x06], u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(off), u16(0)));
    return new Blob(parts.concat(central, [end]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function xesc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  X.build = function (sheets) {   // sheets: [{name, rows: [[cell…]]}] — first row is the header (bold)
    var enc = new TextEncoder(), files = [], used = {};
    sheets = sheets.map(function (s, i) {
      var n = String(s.name || 'Sheet' + (i + 1)).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31).trim() || 'Sheet' + (i + 1);
      while (used[n.toLowerCase()]) n = n.slice(0, 28) + ' ' + (i + 1); used[n.toLowerCase()] = 1;
      return { name: n, rows: s.rows || [] };
    });
    files.push({ name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>') });
    files.push({ name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') });
    files.push({ name: 'xl/workbook.xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + sheets.map(function (s, i) { return '<sheet name="' + xesc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>') });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('')
      + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>') });
    files.push({ name: 'xl/styles.xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F0FE"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>') });
    sheets.forEach(function (s, si) {
      var widths = [], xml = s.rows.map(function (row, r) {
        return '<row r="' + (r + 1) + '">' + row.map(function (v, c) {
          var ref = colName(c) + (r + 1), len = String(v === null || v === undefined ? '' : v).length; widths[c] = Math.max(widths[c] || 8, Math.min(len + 2, 60));
          if (v === null || v === undefined || v === '') return '';
          if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + (r === 0 ? ' s="1"' : (Math.round(v) !== v ? ' s="2"' : '')) + '><v>' + v + '</v></c>';
          return '<c r="' + ref + '" t="inlineStr"' + (r === 0 ? ' s="1"' : '') + '><is><t xml:space="preserve">' + xesc(v) + '</t></is></c>';
        }).join('') + '</row>';
      }).join('');
      files.push({ name: 'xl/worksheets/sheet' + (si + 1) + '.xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        + (widths.length ? '<cols>' + widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>' : '')
        + '<sheetData>' + xml + '</sheetData></worksheet>') });
    });
    return zip(files);
  };
  X.download = function (filename, sheets) {
    var blob = X.build(sheets), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename.replace(/[\\/:*?"<>|]/g, '_'); document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    V.toast('⬇️ ' + a.download);
  };

  // ═══════════ printable report (PDF via print → Save as PDF) ═══════════
  V.report = {
    print: function (title, head, rows, foot, sub) {
      var cell = function (v) { return typeof v === 'number' ? '<td class="n">' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + '</td>' : '<td>' + h(v === null || v === undefined ? '' : v) + '</td>'; };
      var html = '<style>@page{size:A4 ' + (head.length > 6 ? 'landscape' : 'portrait') + ';margin:10mm}#__rep{font-family:Arial,sans-serif;color:#111;font-size:11px}#__rep h1{font-size:16px;margin:0}#__rep .s{color:#555;margin:2px 0 10px}'
        + '#__rep table{border-collapse:collapse;width:100%}#__rep th,#__rep td{border:1px solid #bbb;padding:4px 6px;text-align:left;vertical-align:top}#__rep th{background:#e8f0fe}#__rep td.n,#__rep th.n{text-align:right;white-space:nowrap}#__rep tfoot th{background:#f3f3f3}</style>'
        + '<div id="__rep"><h1>Sri Sai Speciality Dental Care — ' + h(title) + '</h1><div class="s">' + h(sub || '') + ' · printed ' + new Date().toLocaleString('en-IN') + '</div>'
        + '<table><thead><tr>' + head.map(function (x) { return '<th>' + h(x) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + r.map(cell).join('') + '</tr>'; }).join('') + '</tbody>'
        + (foot ? '<tfoot><tr>' + foot.map(function (v) { return '<th' + (typeof v === 'number' ? ' class="n"' : '') + '>' + (typeof v === 'number' ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : h(v || '')) + '</th>'; }).join('') + '</tr></tfoot>' : '') + '</table></div>';
      _doPrintRegular(html);
    }
  };

  // ═══════════ tiny SVG charts with hover tooltip ═══════════
  var SER = ['#2a78d6', '#eb6834'];
  var tip;
  function tipShow(e, html) {
    if (!tip) { tip = document.createElement('div'); tip.className = 'v-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
    tip.innerHTML = html; tip.hidden = false;
    var x = e.clientX + 14, y = e.clientY + 14, w = tip.offsetWidth, hgt = tip.offsetHeight;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 14; if (y + hgt > window.innerHeight - 8) y = e.clientY - hgt - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function tipHide() { if (tip) tip.hidden = true; }
  function nice(max) { if (max <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(max))), m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
  function compact(v) { var a = Math.abs(v); return (v < 0 ? '−' : '') + (a >= 1e7 ? (a / 1e7).toFixed(1).replace(/\.0$/, '') + 'Cr' : a >= 1e5 ? (a / 1e5).toFixed(1).replace(/\.0$/, '') + 'L' : a >= 1e3 ? (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(Math.round(a))); }
  // columns: labels[], series: [{name, values[]}] stacked (all ≥ 0) or single (may be negative)
  F.columns = function (el, labels, series, opts) {
    opts = opts || {}; if (!el) return;
    var W = Math.max(el.clientWidth || 600, 280), H = opts.height || 220, padL = 44, padB = 24, padT = 10, plotW = W - padL - 8, plotH = H - padT - padB;
    var tops = labels.map(function (_, i) { return series.reduce(function (a, s) { return a + Math.max(0, s.values[i] || 0); }, 0); });
    var lows = labels.map(function (_, i) { return series.reduce(function (a, s) { return a + Math.min(0, s.values[i] || 0); }, 0); });
    var max = nice(Math.max.apply(null, tops.concat([0]))), min = Math.min.apply(null, lows.concat([0])); min = min < 0 ? -nice(-min) : 0;
    var y = function (v) { return padT + plotH * (max - v) / (max - min || 1); }, band = plotW / Math.max(labels.length, 1), bw = Math.min(24, band * 0.6);
    var svg = '<svg width="' + W + '" height="' + H + '" role="img" aria-label="' + h(opts.label || '') + '">';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) { var v = min + (max - min) * f, yy = y(v); svg += '<line x1="' + padL + '" x2="' + (W - 8) + '" y1="' + yy + '" y2="' + yy + '" class="v-grid"/><text x="' + (padL - 6) + '" y="' + (yy + 4) + '" class="v-axis" text-anchor="end">' + compact(v) + '</text>'; });
    var step = Math.ceil(labels.length / Math.max(1, Math.floor(plotW / 54)));
    labels.forEach(function (lab, i) {
      var cx = padL + band * i + band / 2, x = cx - bw / 2, base = y(0), up = base, down = base;
      series.forEach(function (s, si) {
        var v = s.values[i] || 0; if (!v) return;
        var hgt = Math.abs(y(v) - y(0)), yy;
        if (v > 0) { yy = up - hgt; up = yy - (hgt > 3 ? 2 : 0); } else { yy = down; down = yy + hgt + 2; }
        var r = Math.min(4, hgt / 2, bw / 2), topRound = v > 0 && up === yy - (hgt > 3 ? 2 : 0) && si === series.length - 1;
        svg += '<path d="' + (v > 0 ? 'M' + x + ',' + (yy + hgt) + 'V' + (yy + r) + 'Q' + x + ',' + yy + ' ' + (x + r) + ',' + yy + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + yy + ' ' + (x + bw) + ',' + (yy + r) + 'V' + (yy + hgt) + 'Z'
          : 'M' + x + ',' + yy + 'V' + (yy + hgt - r) + 'Q' + x + ',' + (yy + hgt) + ' ' + (x + r) + ',' + (yy + hgt) + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + (yy + hgt) + ' ' + (x + bw) + ',' + (yy + hgt - r) + 'V' + yy + 'Z')
          + '" fill="' + (s.color || SER[si]) + '"/>';
        void topRound;
      });
      svg += '<rect x="' + (padL + band * i) + '" y="' + padT + '" width="' + band + '" height="' + plotH + '" fill="transparent" class="v-hit" data-i="' + i + '"/>';
      if (i % step === 0) svg += '<text x="' + cx + '" y="' + (H - 6) + '" class="v-axis" text-anchor="middle">' + h(lab) + '</text>';
    });
    svg += '<line x1="' + padL + '" x2="' + (W - 8) + '" y1="' + y(0) + '" y2="' + y(0) + '" class="v-base"/></svg>';
    el.innerHTML = (series.length > 1 ? '<div class="v-legend">' + series.map(function (s, si) { return '<span><i style="background:' + (s.color || SER[si]) + '"></i>' + h(s.name) + '</span>'; }).join('') + '</div>' : '') + svg;
    el.querySelectorAll('.v-hit').forEach(function (r) {
      r.addEventListener('mousemove', function (e) { var i = +r.dataset.i; tipShow(e, '<b>' + h(labels[i]) + '</b>' + series.map(function (s, si) { return '<div>' + (series.length > 1 ? '<i style="background:' + (s.color || SER[si]) + '"></i>' : '') + h(s.name) + ': <b>' + inr(s.values[i] || 0, 0) + '</b></div>'; }).join('') + (series.length > 1 ? '<div>Total: <b>' + inr(tops[i] + lows[i], 0) + '</b></div>' : '')); });
      r.addEventListener('mouseleave', tipHide);
    });
  };
  F.hbars = function (el, rows, opts) {   // rows: [[label, value]] — single series, sorted
    if (!el) return; opts = opts || {};
    if (!rows.length) { el.innerHTML = '<div class="v-empty">No data</div>'; return; }
    var max = Math.max.apply(null, rows.map(function (r) { return r[1]; }).concat([1]));
    el.innerHTML = '<div class="v-hbars" role="list">' + rows.map(function (r) {
      return '<div class="v-hbar" role="listitem" title="' + h(r[0]) + ': ' + inr(r[1], 0) + '"><span class="v-hbar-l">' + h(r[0]) + '</span><span class="v-hbar-t"><span style="width:' + Math.max(1, 100 * r[1] / max) + '%;background:' + (opts.color || SER[0]) + '"></span></span><span class="v-hbar-v">' + inr(r[1], 0) + '</span></div>';
    }).join('') + '</div>';
  };

  // ═══════════ periods ═══════════
  function fyStart(d) { var y = +d.slice(0, 4), m = +d.slice(5, 7); return (m >= 4 ? y : y - 1) + '-04-01'; }
  function monthStart(d) { return d.slice(0, 8) + '01'; }
  function monthEnd(d) { var x = new Date(+d.slice(0, 4), +d.slice(5, 7), 0); return x.toLocaleDateString('en-CA'); }
  F.period = function (key) {
    var t = V.today(), lm = V.addDays(monthStart(t), -1);
    switch (key) {
      case 'today': return [t, t, 'Today'];
      case 'month': return [monthStart(t), t, 'This month'];
      case 'lastmonth': return [monthStart(lm), lm, 'Last month'];
      case 'fy': return [fyStart(t), t, 'This financial year (from 1 April)'];
      case 'lastfy': var s = fyStart(t), ps = (+s.slice(0, 4) - 1) + '-04-01'; return [ps, V.addDays(s, -1), 'Last financial year ' + ps.slice(0, 4) + '–' + s.slice(2, 4)];
      case '12m': return [monthStart(V.addDays(monthStart(t), -335)), t, 'Last 12 months'];
      default: return [F._from || monthStart(t), F._to || t, 'Custom'];
    }
  };
  F.load = async function (from, to) {
    var key = from + '|' + to;
    if (F.cache[key] && Date.now() - F.cache[key].at < 120000) return F.cache[key].data;
    var res = await API.call('getReportData', { from: from, to: to });
    if (!res.success) throw new Error(res.error || 'Could not load (are you online?)');
    F.cache[key] = { at: Date.now(), data: res }; return res;
  };

  // ═══════════ the numbers ═══════════
  function monthsBetween(from, to) { var out = [], d = monthStart(from); while (d <= to) { out.push(d.slice(0, 7)); d = V.addDays(monthEnd(d), 1); } return out; }
  F.compute = function (d) {
    var bills = d.bills.filter(function (b) { return b.status !== 'Cancelled'; }), receipts = d.receipts, pays = d.payments.filter(function (p) { return p.status === 'Active'; });
    var exp = d.expenses, loss = d.stockChanges.filter(function (m) { return m.type === 'EXPIRED' || m.type === 'DAMAGED'; });
    var byMonth = {}, byDay = {}, m = function (k) { return byMonth[k] = byMonth[k] || { sales: 0, ret: 0, cogs: 0, costBack: 0, dental: 0, dentalRet: 0, expenses: 0, loss: 0, collections: 0, bills: 0, receipts: 0 }; };
    var day = function (k) { return byDay[k] = byDay[k] || { bills: 0, sales: 0, dental: 0, cash: 0, upi: 0, card: 0, credit: 0, cogs: 0, ret: 0, costBack: 0, dentalRet: 0, exp: 0, loss: 0 }; };
    var add = function (o, mode, amt, c, u, k) { if (c || u || k) { o.cash += c; o.upi += u; o.card += k; } else if (/upi/i.test(mode)) o.upi += amt; else if (/card/i.test(mode)) o.card += amt; else if (/credit/i.test(mode)) {} else o.cash += amt; };
    var collLater = {}; pays.forEach(function (p) { if (p.type === 'COLLECTION') collLater[p.againstId] = (collLater[p.againstId] || 0) + p.amount; });
    bills.forEach(function (b) {
      var o = m(b.date.slice(0, 7)), dd = day(b.date); o.sales += b.total; o.cogs += b.costTotal; o.bills++; dd.bills++; dd.sales += b.total; dd.cogs += b.costTotal;
      var initial = r2((b.paidAmount !== undefined ? b.paidAmount : b.total) - (collLater[b.billId] || 0)); o.collections += initial;
      add(dd, b.paymentMode, initial, b.cashAmount, b.upiAmount, b.cardAmount); dd.credit += Math.max(0, b.total - initial);
    });
    receipts.forEach(function (r) {
      var o = m(r.date.slice(0, 7)), dd = day(r.date); o.dental += r.amount; o.receipts++; dd.dental += r.amount;
      var initial = r2((r.paidAmount !== undefined ? r.paidAmount : r.amount) - (collLater[r.recordId] || 0)); o.collections += initial; add(dd, r.paymentMode, initial, 0, 0, 0); dd.credit += Math.max(0, r.amount - initial);
    });
    pays.forEach(function (p) {
      var o = m(p.date.slice(0, 7)), dd = day(p.date);
      if (p.type === 'COLLECTION') { o.collections += p.amount; add(dd, p.mode, p.amount, p.cashAmount, p.upiAmount, p.cardAmount); }
      else { if (p.againstType === 'BILL') { o.ret += p.creditValue; o.costBack += p.costReversed; dd.ret += p.creditValue; dd.costBack += p.costReversed; } else { o.dentalRet += p.creditValue; dd.dentalRet += p.creditValue; } o.collections -= p.amount; }
    });
    exp.forEach(function (e) { m(e.date.slice(0, 7)).expenses += e.amount; day(e.date).exp += e.amount; });
    loss.forEach(function (x) { m(x.date.slice(0, 7)).loss += -x.value; day(x.date).loss += -x.value; });
    for (var dk = d.from; dk <= d.to; dk = V.addDays(dk, 1)) day(dk);     // every day of the period, even quiet ones
    var months = monthsBetween(d.from, d.to).map(function (k) {
      var o = m(k), netSales = o.sales - o.ret, cogs = o.cogs - o.costBack, gp = netSales - cogs, dental = o.dental - o.dentalRet;
      return { month: k, sales: r2(o.sales), returns: r2(o.ret), netSales: r2(netSales), cogs: r2(cogs), grossProfit: r2(gp), dental: r2(dental), revenue: r2(netSales + dental),
        expenses: r2(o.expenses), loss: r2(o.loss), profit: r2(gp + dental - o.expenses - o.loss), collections: r2(o.collections), bills: o.bills, receipts: o.receipts };
    });
    var T = months.reduce(function (a, x) { Object.keys(x).forEach(function (k) { if (typeof x[k] === 'number') a[k] = r2((a[k] || 0) + x[k]); }); return a; }, {});
    var purchases = r2(d.purchaseInvoices.filter(function (i) { return i.status === 'Active'; }).reduce(function (a, i) { return a + i.total; }, 0)
      + d.purchases.filter(function (p) { return !p.invoiceId; }).reduce(function (a, p) { return a + p.totalCost; }, 0));
    return { months: months, totals: T, byDay: byDay, purchases: purchases, data: d };
  };

  // ═══════════ Finance page ═══════════
  V.tabRender.fin = function () { V.pages.finance(); };
  V.pages.finance = async function () {
    var page = document.getElementById('finance'); if (!page) return;
    var key = F._period || 'month', p = F.period(key), tab = V.tabState.fin || 'dash';
    page.innerHTML = '<div class="v-toolbar v-periods">' + [['today', 'Today'], ['month', 'This month'], ['lastmonth', 'Last month'], ['fy', 'This FY'], ['lastfy', 'Last FY'], ['12m', '12 months'], ['custom', 'Custom']].map(function (x) {
      return '<button type="button" class="v-chip' + (x[0] === key ? ' on' : '') + '" data-act="finPeriod" data-p="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + (key === 'custom' ? '<label>From <input type="date" class="v-in" id="finFrom" value="' + p[0] + '" data-change="finCustom"></label><label>To <input type="date" class="v-in" id="finTo" value="' + p[1] + '" max="' + V.today() + '" data-change="finCustom"></label>' : '')
      + '<span class="v-muted">' + h(V.fmtDate(p[0])) + ' – ' + h(V.fmtDate(p[1])) + '</span></div>'
      + V.tabs('fin', [['dash', '📊 Dashboard'], ['statement', '📄 Statement'], ['reports', '🗂️ Reports']], tab) + '<div id="finBody"><div class="v-empty">Loading…</div></div>';
    var body = document.getElementById('finBody'), data;
    try { data = await F.load(p[0], p[1]); } catch (e) { if (body) body.innerHTML = '<div class="v-empty">⚠️ ' + h(e.message) + '</div>'; return; }
    if (!document.getElementById('finBody')) return;
    F._c = F.compute(data); F._label = p[2];
    if (tab === 'dash') renderDash(); else if (tab === 'statement') renderStatement(); else renderReportList();
  };
  V.pages.finance.noAutoRefresh = true;
  ACT.finPeriod = function (el) { F._period = el.dataset.p; V.pages.finance(); };
  ACT.finCustom = function () { F._from = V.val('finFrom'); F._to = V.val('finTo'); if (F._from && F._to && F._to >= F._from) V.pages.finance(); };

  function renderDash() {
    var c = F._c, T = c.totals, el = document.getElementById('finBody');
    var due = r2(V.data.receivables.reduce(function (a, r) { return a + r.balance; }, 0)), owe = r2(V.data.suppliers.reduce(function (a, s) { return a + Math.max(0, s.balance); }, 0));
    var margin = T.netSales > 0 ? Math.round(100 * T.grossProfit / T.netSales) : 0;
    el.innerHTML = '<div class="v-hero"><div class="v-hero-l">Operating profit · ' + h(F._label) + '</div><div class="v-hero-v' + (T.profit < 0 ? ' v-bad' : '') + '">' + inr(T.profit || 0, 0) + '</div>'
      + '<div class="v-hero-s">Revenue ' + inr(T.revenue || 0, 0) + ' − medicine cost ' + inr(T.cogs || 0, 0) + ' − expenses ' + inr(T.expenses || 0, 0) + (T.loss ? ' − expiry/damage ' + inr(T.loss, 0) : '') + '</div></div>'
      + V.kpis([{ label: 'Pharmacy sales (net of returns)', value: inr(T.netSales || 0, 0), sub: (T.bills || 0) + ' bills · margin ' + margin + '%' },
        { label: 'Pharmacy gross profit', value: inr(T.grossProfit || 0, 0), sub: 'after medicine cost ' + inr(T.cogs || 0, 0) },
        { label: 'Dental treatment revenue', value: inr(T.dental || 0, 0), sub: (T.receipts || 0) + ' receipts' },
        { label: 'Clinic expenses', value: inr(T.expenses || 0, 0) },
        { label: 'Money received', value: inr(T.collections || 0, 0), sub: 'cash basis, after refunds' },
        { label: 'Patients owe now', value: inr(due, 0), tone: due > 0 ? 'warn' : 'ok' },
        { label: 'We owe suppliers now', value: inr(owe, 0), tone: owe > 0 ? 'warn' : 'ok' },
        { label: 'Purchases in period', value: inr(c.purchases, 0) }])
      + '<div class="v-grid2"><div class="v-card"><h3 class="v-h3">Revenue by ' + (c.months.length > 1 ? 'month' : 'day') + '</h3><div id="finRev" class="v-chart"></div></div>'
      + '<div class="v-card"><h3 class="v-h3">Operating profit by ' + (c.months.length > 1 ? 'month' : 'day') + '</h3><div id="finProfit" class="v-chart"></div></div></div>'
      + '<div class="v-grid2"><div class="v-card"><h3 class="v-h3">Where the money went (expenses)</h3><div id="finExp"></div></div>'
      + '<div class="v-card"><h3 class="v-h3">Top medicines by profit</h3><div id="finMeds"></div></div></div>';
    var labels, rev1, rev2, prof;
    if (c.months.length > 1) {
      labels = c.months.map(function (m) { return new Date(m.month + '-15').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }); });
      rev1 = c.months.map(function (m) { return m.netSales; }); rev2 = c.months.map(function (m) { return m.dental; }); prof = c.months.map(function (m) { return m.profit; });
    } else {
      var days = Object.keys(c.byDay).sort(); labels = days.map(function (d) { return d.slice(8); });
      rev1 = days.map(function (d) { var o = c.byDay[d]; return r2(o.sales - o.ret); }); rev2 = days.map(function (d) { var o = c.byDay[d]; return r2(o.dental - o.dentalRet); });
      prof = days.map(function (d) { var o = c.byDay[d]; return r2(o.sales - o.ret - (o.cogs - o.costBack) + o.dental - o.dentalRet - o.exp - o.loss); });
    }
    F.columns(document.getElementById('finRev'), labels, [{ name: 'Pharmacy', values: rev1 }, { name: 'Dental', values: rev2 }], { label: 'Revenue: pharmacy and dental' });
    F.columns(document.getElementById('finProfit'), labels, [{ name: 'Operating profit', values: prof }], { label: 'Operating profit' });
    var cats = {}; c.data.expenses.forEach(function (e) { cats[e.category || 'Other'] = (cats[e.category || 'Other'] || 0) + e.amount; });
    F.hbars(document.getElementById('finExp'), Object.keys(cats).map(function (k) { return [k, r2(cats[k])]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8));
    F.hbars(document.getElementById('finMeds'), REPORTS.meds.build(c).rows.slice(0, 8).map(function (r) { return [r[0], r[5]]; }));
  }
  function renderStatement() {
    var c = F._c, el = document.getElementById('finBody'), rows = statementRows(c);
    el.innerHTML = '<div class="v-toolbar"><span class="v-muted" style="flex:1;">Accrual basis: sales and treatments are counted on the bill date, even if paid later. No GST.</span>'
      + '<button type="button" class="v-btn" data-act="finStmtX">⬇️ Excel</button><button type="button" class="v-btn" data-act="finStmtP">🖨️ PDF / Print</button></div>'
      + V.table(rows.head, rows.body.map(function (r) { return '<tr' + (r.strong ? ' class="v-strong"' : '') + '>' + r.cells.map(function (v, i) { return i ? V.td(typeof v === 'number' ? inr(v) : h(v), 1) : '<td>' + h(v) + '</td>'; }).join('') + '</tr>'; }), { cls: 'v-stmt' });
    F._stmt = rows;
  }
  function statementRows(c) {
    var ms = c.months, T = c.totals, cols = ms.length > 1 && ms.length <= 13;
    var lines = [['Pharmacy sales', 'sales'], ['Less: returns', 'returns', -1], ['Net pharmacy sales', 'netSales', 1, true], ['Less: cost of medicines sold', 'cogs', -1], ['Pharmacy gross profit', 'grossProfit', 1, true],
      ['Dental treatment revenue', 'dental'], ['Total revenue', 'revenue', 1, true], ['Less: clinic expenses', 'expenses', -1], ['Less: expired / damaged stock', 'loss', -1], ['Operating profit', 'profit', 1, true], ['Money received (cash basis)', 'collections']];
    var head = ['', ].concat(cols ? ms.map(function (m) { return new Date(m.month + '-15').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }); }) : []).concat(['Total']);
    var body = lines.map(function (l) {
      var sign = l[2] === -1 ? -1 : 1;
      return { strong: !!l[3], cells: [l[0]].concat(cols ? ms.map(function (m) { return sign * (m[l[1]] || 0); }) : []).concat([sign * (T[l[1]] || 0)]) };
    });
    return { head: head, body: body };
  }
  ACT.finStmtX = function () { var r = F._stmt; if (r) X.download('Statement ' + F._label + '.xlsx', [{ name: 'Statement', rows: [r.head].concat(r.body.map(function (b) { return b.cells; })) }]); };
  ACT.finStmtP = function () { var r = F._stmt, p = F.period(F._period || 'month'); if (r) V.report.print('Profit & loss statement', r.head, r.body.map(function (b) { return b.cells; }), null, F._label + ' · ' + p[0] + ' to ' + p[1] + ' · no GST'); };

  // ═══════════ the report list ═══════════
  function sum(list, f) { return r2(list.reduce(function (a, x) { return a + (+f(x) || 0); }, 0)); }
  function aging(d) { var a = V.daysBetween(d, V.today()); return a <= 30 ? '0–30 days' : a <= 60 ? '31–60 days' : a <= 90 ? '61–90 days' : 'over 90 days'; }
  var REPORTS = F.reports = {
    daily: { name: '📅 Daily sales & collections', build: function (c) {
      var days = Object.keys(c.byDay).sort().filter(function (d) { var o = c.byDay[d]; return o.bills || o.sales || o.dental || o.cash || o.upi || o.card; });
      var rows = days.map(function (d) { var o = c.byDay[d]; return [d, o.bills, r2(o.sales), r2(o.dental), r2(o.sales + o.dental), r2(o.cash), r2(o.upi), r2(o.card), r2(o.credit)]; });
      return { head: ['Date', 'Bills', 'Pharmacy ₹', 'Dental ₹', 'Total ₹', 'Cash ₹', 'UPI ₹', 'Card ₹', 'Pay later ₹'], rows: rows, foot: ['Total', sum(rows, function (r) { return r[1]; })].concat([2, 3, 4, 5, 6, 7, 8].map(function (i) { return sum(rows, function (r) { return r[i]; }); })) };
    } },
    monthly: { name: '🗓️ Monthly sales', build: function (c) {
      var rows = c.months.map(function (m) { return [m.month, m.bills, m.netSales, m.receipts, m.dental, m.revenue, m.collections]; });
      return { head: ['Month', 'Bills', 'Pharmacy (net) ₹', 'Receipts', 'Dental ₹', 'Total revenue ₹', 'Money received ₹'], rows: rows, foot: ['Total'].concat([1, 2, 3, 4, 5, 6].map(function (i) { return sum(rows, function (r) { return r[i]; }); })) };
    } },
    profit: { name: '💊 Pharmacy profit by month', build: function (c) {
      var rows = c.months.map(function (m) { return [m.month, m.sales, m.returns, m.netSales, m.cogs, m.grossProfit, m.netSales > 0 ? Math.round(1000 * m.grossProfit / m.netSales) / 10 : 0]; });
      return { head: ['Month', 'Sales ₹', 'Returns ₹', 'Net sales ₹', 'Medicine cost ₹', 'Gross profit ₹', 'Margin %'], rows: rows, foot: ['Total'].concat([1, 2, 3, 4, 5].map(function (i) { return sum(rows, function (r) { return r[i]; }); })).concat(['']) };
    } },
    meds: { name: '💊 Medicine-wise profitability', build: function (c) {
      var o = {};
      c.data.bills.filter(function (b) { return b.status !== 'Cancelled'; }).forEach(function (b) { b.items.forEach(function (i) { var k = i.medicineName || i.medicineId; var x = o[k] = o[k] || { qty: 0, sales: 0, cost: 0 }; x.qty += i.qty; x.sales += i.amount; x.cost += i.qty * (i.costPrice || 0); }); });
      c.data.payments.forEach(function (p) { if (p.type === 'REFUND' && p.status === 'Active') p.items.forEach(function (i) { var x = o[i.name]; if (x) { x.qty -= i.qty; x.sales -= i.value; } }); });
      var rows = Object.keys(o).map(function (k) { var x = o[k], pr = r2(x.sales - x.cost); return [k, x.qty, r2(x.sales), r2(x.cost), x.qty ? r2(x.sales / x.qty) : 0, pr, x.sales > 0 ? Math.round(1000 * pr / x.sales) / 10 : 0]; }).sort(function (a, b) { return b[5] - a[5]; });
      return { head: ['Medicine', 'Qty sold', 'Sales ₹', 'Cost ₹', 'Avg price ₹', 'Profit ₹', 'Margin %'], rows: rows, foot: ['Total', sum(rows, function (r) { return r[1]; }), sum(rows, function (r) { return r[2]; }), sum(rows, function (r) { return r[3]; }), '', sum(rows, function (r) { return r[5]; }), ''] };
    } },
    dental: { name: '🦷 Dental treatment revenue', build: function (c) {
      var o = {}, add = function (k, amt) { k = String(k || 'Treatment').trim(); var x = o[k] = o[k] || { n: 0, amt: 0 }; x.n++; x.amt += amt; };
      c.data.receipts.forEach(function (r) {
        var items = []; try { items = JSON.parse(r.items || '[]'); } catch (e) {}
        if (items.length && items.every(function (i) { return i.price; })) items.forEach(function (i) { add(i.name, +i.price || 0); });
        else { var parts = String(r.treatments || 'Treatment').split(/\n|,\s*/).map(function (s) { return s.trim(); }).filter(Boolean); parts.forEach(function (p) { add(p.replace(/\s*\(.*\)$/, ''), r.amount / parts.length); }); }
      });
      var rows = Object.keys(o).map(function (k) { return [k, o[k].n, r2(o[k].amt)]; }).sort(function (a, b) { return b[2] - a[2]; });
      return { head: ['Treatment', 'Times', 'Revenue ₹'], rows: rows, foot: ['Total', sum(rows, function (r) { return r[1]; }), sum(rows, function (r) { return r[2]; })], note: 'Receipts with several treatments and no item prices are split evenly between them.' };
    } },
    doctor: { name: '👨‍⚕️ Doctor-wise performance', build: function (c) {
      var o = {}, g = function (k) { k = k || '(not set)'; return o[k] = o[k] || { bills: 0, ph: 0, rc: 0, dental: 0, pts: {} }; };
      c.data.bills.filter(function (b) { return b.status !== 'Cancelled'; }).forEach(function (b) { var x = g(b.doctor); x.bills++; x.ph += b.total - b.returnedValue; x.pts[(b.patientName || '').toLowerCase()] = 1; });
      c.data.receipts.forEach(function (r) { var x = g(r.doctor); x.rc++; x.dental += r.amount; x.pts[(r.patient || '').toLowerCase()] = 1; });
      var rows = Object.keys(o).map(function (k) { var x = o[k]; return [k, Object.keys(x.pts).length, x.bills, r2(x.ph), x.rc, r2(x.dental), r2(x.ph + x.dental)]; }).sort(function (a, b) { return b[6] - a[6]; });
      return { head: ['Doctor', 'Patients', 'Pharmacy bills', 'Pharmacy ₹', 'Dental receipts', 'Dental ₹', 'Total ₹'], rows: rows };
    } },
    expenses: { name: '💸 Expense analysis', build: function (c) {
      var o = {}; c.data.expenses.forEach(function (e) { var k = e.category || 'Other'; var x = o[k] = o[k] || { n: 0, amt: 0, months: {} }; x.n++; x.amt += e.amount; });
      var total = sum(c.data.expenses, function (e) { return e.amount; });
      var rows = Object.keys(o).map(function (k) { return [k, o[k].n, r2(o[k].amt), total ? Math.round(1000 * o[k].amt / total) / 10 : 0]; }).sort(function (a, b) { return b[2] - a[2]; });
      return { head: ['Category', 'Entries', 'Amount ₹', 'Share %'], rows: rows, foot: ['Total', sum(rows, function (r) { return r[1]; }), total, 100] };
    } },
    purchases: { name: '🛒 Purchase analysis (by supplier)', build: function (c) {
      var o = {}, g = function (k) { return o[k] = o[k] || { inv: 0, total: 0, paid: 0, ret: 0, lines: 0 }; };
      c.data.purchaseInvoices.filter(function (i) { return i.status === 'Active'; }).forEach(function (i) { var x = g(i.supplierName); x.inv++; x.total += i.total; x.paid += i.paidAmount; x.lines += i.lines; });
      c.data.purchases.filter(function (p) { return !p.invoiceId; }).forEach(function (p) { var x = g(p.supplier || '(unknown)'); x.total += p.totalCost; x.paid += p.totalCost; x.lines++; });
      c.data.purchaseReturns.filter(function (r) { return r.status === 'Active'; }).forEach(function (r) { g(r.supplierName).ret += r.amount; });
      var rows = Object.keys(o).map(function (k) { var x = o[k]; return [k, x.inv, x.lines, r2(x.total), r2(x.paid), r2(x.ret)]; }).sort(function (a, b) { return b[3] - a[3]; });
      return { head: ['Supplier', 'Invoices', 'Lines', 'Purchased ₹', 'Paid with invoice ₹', 'Returned ₹'], rows: rows, foot: ['Total'].concat([1, 2, 3, 4, 5].map(function (i) { return sum(rows, function (r) { return r[i]; }); })) };
    } },
    purchaseMeds: { name: '🛒 Purchase analysis (by medicine)', build: function (c) {
      var o = {}; c.data.purchases.forEach(function (p) { var x = o[p.medicineName] = o[p.medicineName] || { qty: 0, free: 0, cost: 0 }; x.qty += p.qty; x.free += p.freeQty || 0; x.cost += p.totalCost; });
      var rows = Object.keys(o).map(function (k) { var x = o[k]; return [k, x.qty, x.free, r2(x.cost), x.qty ? r2(x.cost / x.qty) : 0]; }).sort(function (a, b) { return b[3] - a[3]; });
      return { head: ['Medicine', 'Units received', 'Free units', 'Cost ₹', 'Cost per unit ₹'], rows: rows, foot: ['Total', sum(rows, function (r) { return r[1]; }), sum(rows, function (r) { return r[2]; }), sum(rows, function (r) { return r[3]; }), ''] };
    } },
    supplierDue: { name: '🏭 Supplier outstanding (today)', now: true, build: function () {
      var rows = V.data.suppliers.filter(function (s) { return Math.abs(s.balance) > 0.009; }).sort(function (a, b) { return b.balance - a.balance; }).map(function (s) { return [s.name, s.phone, s.purchases, s.payments, s.returns, s.balance]; });
      return { head: ['Supplier', 'Phone', 'Purchased ₹', 'Paid ₹', 'Returned ₹', 'Balance owed ₹'], rows: rows, foot: ['Total', '', '', '', '', sum(rows, function (r) { return r[5]; })] };
    } },
    patientDue: { name: '👥 Patient outstanding (today, by age)', now: true, build: function () {
      var o = {}; V.data.receivables.forEach(function (r) { var k = V.money.patientKey(r), x = o[k] = o[k] || { name: r.patientName, phone: r.phone, b: { '0–30 days': 0, '31–60 days': 0, '61–90 days': 0, 'over 90 days': 0 }, t: 0, oldest: r.date }; x.b[aging(r.date || V.today())] += r.balance; x.t += r.balance; if (r.date < x.oldest) x.oldest = r.date; });
      var rows = Object.keys(o).map(function (k) { var x = o[k]; return [x.name, x.phone, x.oldest, r2(x.b['0–30 days']), r2(x.b['31–60 days']), r2(x.b['61–90 days']), r2(x.b['over 90 days']), r2(x.t)]; }).sort(function (a, b) { return b[7] - a[7]; });
      return { head: ['Patient', 'Phone', 'Oldest bill', '0–30 days ₹', '31–60 ₹', '61–90 ₹', '90+ ₹', 'Total due ₹'], rows: rows, foot: ['Total', '', ''].concat([3, 4, 5, 6, 7].map(function (i) { return sum(rows, function (r) { return r[i]; }); })) };
    } },
    refunds: { name: '↩️ Refund analysis', build: function (c) {
      var list = c.data.payments.filter(function (p) { return p.type === 'REFUND' && p.status === 'Active'; });
      var rows = list.map(function (p) { return [p.date, p.no, p.patientName, p.againstNo || p.againstId, p.items.map(function (i) { return i.name + ' ×' + i.qty; }).join(', '), p.creditValue, p.amount, p.mode, p.notes]; });
      return { head: ['Date', 'No', 'Patient', 'Bill', 'Items', 'Reduced ₹', 'Paid back ₹', 'Mode', 'Reason'], rows: rows, foot: ['Total', '', '', '', '', sum(rows, function (r) { return r[5]; }), sum(rows, function (r) { return r[6]; }), '', ''] };
    } },
    closings: { name: '🧮 Cash closings', build: function (c) {
      var rows = c.data.cashClosings.slice().sort(function (a, b) { return a.date.localeCompare(b.date); }).map(function (x) { return [x.date, x.openingCash, x.cashIn, x.cashOut, x.expectedCash, x.countedCash, x.difference, x.deposited, x.upiTotal, x.upiVerified ? 'yes' : 'no', x.closedBy]; });
      return { head: ['Date', 'Opening ₹', 'Cash in ₹', 'Cash out ₹', 'Expected ₹', 'Counted ₹', 'Difference ₹', 'Deposited ₹', 'UPI ₹', 'UPI checked', 'By'], rows: rows, foot: ['Total', '', '', '', '', '', sum(rows, function (r) { return r[6]; }), '', '', '', ''] };
    } },
    stockLoss: { name: '🗑️ Expired & damaged stock', build: function (c) {
      var rows = c.data.stockChanges.filter(function (m) { return m.type === 'EXPIRED' || m.type === 'DAMAGED'; }).map(function (m) { return [m.date, m.medicineName, m.type === 'EXPIRED' ? 'Expired' : 'Damaged', -m.qty, -m.value, m.reason, m.user]; });
      return { head: ['Date', 'Medicine', 'Why', 'Qty', 'Loss at cost ₹', 'Reason', 'By'], rows: rows, foot: ['Total', '', '', sum(rows, function (r) { return r[3]; }), sum(rows, function (r) { return r[4]; }), '', ''] };
    } },
    movements: { name: '📦 Stock movements (all medicines)', build: function (c) {
      var T = ['OPENING', 'PURCHASE', 'SALE', 'CUSTOMER_RETURN', 'BILL_CANCEL', 'PURCHASE_RETURN', 'PURCHASE_CANCEL', 'EXPIRED', 'DAMAGED', 'ADJUSTMENT'], o = {};
      c.data.stockChanges.forEach(function (m) { var t = m.type === 'SALE_UNALLOCATED' ? 'SALE' : m.type; var x = o[m.medicineName] = o[m.medicineName] || {}; x[t] = (x[t] || 0) + m.qty; });
      var rows = Object.keys(o).sort().map(function (k) { var x = o[k], net = 0; var r = [k].concat(T.map(function (t) { net += x[t] || 0; return x[t] || 0; })); r.push(net); return r; });
      return { head: ['Medicine', 'Opening', 'Purchased', 'Sold', 'Returned by patients', 'Bills cancelled', 'Returned to supplier', 'Purchases cancelled', 'Expired', 'Damaged', 'Corrections', 'Net change'],
        rows: rows, foot: ['Total'].concat(T.map(function (t, i) { return sum(rows, function (r) { return r[i + 1]; }); })).concat([sum(rows, function (r) { return r[11]; })]),
        note: 'Units in (+) and out (−) in the period, from the stock register. Use 📜 History in Inventory for one medicine batch by batch.' };
    } },
    annual: { name: '📘 Annual statement (financial year)', build: function (c) {
      var r = statementRows(Object.assign({}, c, { months: [] }));
      return { head: ['', 'Amount ₹'], rows: r.body.map(function (b) { return b.cells; }), note: 'Choose “This FY” or “Last FY” above for the April–March year.' };
    } }
  };
  function renderReportList() {
    var el = document.getElementById('finBody'), cur = F._rep;
    el.innerHTML = '<div class="v-rep-grid">' + Object.keys(REPORTS).map(function (k) {
      return '<button type="button" class="v-rep' + (k === cur ? ' on' : '') + '" data-act="finRep" data-k="' + k + '">' + h(REPORTS[k].name) + (REPORTS[k].now ? '<small>as of today</small>' : '') + '</button>';
    }).join('') + '<button type="button" class="v-rep" data-act="stockReports">📊 Stock reports<small>valuation, dead, slow, re-order</small></button>'
      + '<button type="button" class="v-rep v-rep-all" data-act="finAllX">⬇️ Everything in one Excel file</button></div><div id="finRepOut"></div>';
    if (cur) showReport(cur);
  }
  function showReport(k) {
    var r = REPORTS[k].build(F._c), el = document.getElementById('finRepOut'); if (!el) return; F._rep = k; F._repData = r;
    var fmt = function (v, i) { return typeof v === 'number' ? (/₹/.test(r.head[i]) ? inr(v) : v.toLocaleString('en-IN')) : h(v === null || v === undefined ? '' : v); };
    el.innerHTML = '<div class="v-card"><div class="v-toolbar"><h3 class="v-h3" style="flex:1;margin:0;">' + h(REPORTS[k].name) + '</h3><button type="button" class="v-btn" data-act="finRepX">⬇️ Excel</button><button type="button" class="v-btn" data-act="finRepP">🖨️ PDF / Print</button></div>'
      + (r.note ? '<p class="v-note">' + h(r.note) + '</p>' : '')
      + V.table(r.head, r.rows.map(function (row) { return '<tr>' + row.map(function (v, i) { return V.td(fmt(v, i), typeof v === 'number'); }).join('') + '</tr>'; }),
        { empty: 'Nothing in this period.', foot: r.foot ? '<tr>' + r.foot.map(function (v, i) { return '<th' + (typeof v === 'number' ? ' class="num"' : '') + '>' + fmt(v, i) + '</th>'; }).join('') + '</tr>' : '' }) + '</div>';
    document.querySelectorAll('.v-rep').forEach(function (b) { b.classList.toggle('on', b.dataset.k === k); });
  }
  ACT.finRep = function (el) { showReport(el.dataset.k); };
  ACT.finRepX = function () { var r = F._repData, k = F._rep; if (r) X.download(REPORTS[k].name.replace(/^\W+\s*/, '') + ' ' + (REPORTS[k].now ? V.today() : F._label) + '.xlsx', [{ name: REPORTS[k].name.replace(/^\W+\s*/, ''), rows: [r.head].concat(r.rows).concat(r.foot ? [r.foot] : []) }]); };
  ACT.finRepP = function () { var r = F._repData, k = F._rep, p = F.period(F._period || 'month'); if (r) V.report.print(REPORTS[k].name.replace(/^\W+\s*/, ''), r.head, r.rows, r.foot, REPORTS[k].now ? 'As of ' + V.fmtDate(V.today()) : F._label + ' · ' + p[0] + ' to ' + p[1]); };
  ACT.finAllX = function () {
    var c = F._c; if (!c) return;
    var sheets = [{ name: 'Statement', rows: (function () { var r = statementRows(c); return [r.head].concat(r.body.map(function (b) { return b.cells; })); })() }];
    Object.keys(REPORTS).forEach(function (k) { if (k === 'annual') return; var r = REPORTS[k].build(c); sheets.push({ name: REPORTS[k].name.replace(/^\W+\s*/, ''), rows: [r.head].concat(r.rows).concat(r.foot ? [r.foot] : []) }); });
    sheets.push({ name: 'Bills', rows: [['Date', 'Bill no', 'Patient', 'Doctor', 'Total', 'Paid', 'Due', 'Returned', 'Mode', 'Status']].concat(c.data.bills.map(function (b) { return [b.date, b.billNo || b.billId, b.patientName, b.doctor, b.total, b.paidAmount, b.balanceDue, b.returnedValue, b.paymentMode, b.status]; })) });
    sheets.push({ name: 'Dental receipts', rows: [['Date', 'Receipt no', 'Patient', 'Doctor', 'Amount', 'Paid', 'Due', 'Treatments']].concat(c.data.receipts.map(function (r) { return [r.date, r.no, r.patient, r.doctor, r.amount, r.paidAmount, r.balanceDue, r.treatments]; })) });
    sheets.push({ name: 'Expenses', rows: [['Date', 'Category', 'Amount', 'Vendor', 'Mode', 'Notes']].concat(c.data.expenses.map(function (e) { return [e.date, e.category, e.amount, e.vendor, e.mode, e.notes]; })) });
    X.download('SSDC reports ' + F._label + '.xlsx', sheets);
  };
})();
;

;/* ══ FILE: 19-system.js ══════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════
   19-system.js — owner settings for v3.1 (staff credit, how much history
   the phone keeps, treatment prices), system health check, restore drill,
   older bills on demand, dashboard tiles (dues, follow-ups, day closing)
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var V = window.V31, ACT = V.act, h = V.h, inr = V.inr;
  var Y = V.sys = {};

  // ── Settings page panels ──
  Y.renderSettings = function () {
    if (!V.enabled() || !API.isOwner()) return;
    var page = document.getElementById('settings'); if (!page) return;
    var box = document.getElementById('v31Settings');
    if (!box) { box = document.createElement('div'); box.id = 'v31Settings'; var admin = document.getElementById('adminPanels'); page.insertBefore(box, admin || null); }
    var st = V.data.settings || {}, win = (API.session && API.session.features && API.session.features.windowDays) || 365;
    box.innerHTML = '<div class="v-card"><h3 class="v-h3">🩺 System health</h3><div id="sysHealth"><button type="button" class="v-btn v-primary" data-act="sysHealth">Run health check</button></div></div>'
      + '<div class="v-card"><h3 class="v-h3">💰 Payments &amp; history</h3>'
      + '<label class="v-check"><input type="checkbox" id="setCredit"' + (st.staffCreditAllowed !== false ? ' checked' : '') + '> Staff may let a patient pay part now / later</label>'
      + V.field('setWindow', 'Keep this many days of bills on phones/PCs (older ones load when needed)', '<select id="setWindow" class="v-in" style="max-width:220px;">'
        + [90, 180, 365, 730].map(function (d) { return '<option value="' + d + '"' + (d === win ? ' selected' : '') + '>' + (d >= 365 ? d / 365 + ' year' + (d > 365 ? 's' : '') : d + ' days') + '</option>'; }).join('') + '</select>')
      + '<div id="setMsg" class="v-msg"></div><button type="button" class="v-btn v-primary" data-act="setSave">Save</button></div>'
      + '<div class="v-card"><h3 class="v-h3">🦷 Treatment price list</h3><p class="v-note">' + V.data.treatmentMaster.filter(function (t) { return t.status !== 'Inactive'; }).length
      + ' treatments. Prices fill in on receipts and treatment plans.</p><button type="button" class="v-btn" data-act="priceList">✏️ Edit prices</button></div>';
  };
  ACT.setSave = async function (btn) {
    V.busy(btn, true);
    var a = await API.call('saveSettings', { settingKey: 'staff_credit_allowed', settingValue: document.getElementById('setCredit').checked ? 'yes' : 'no' }, { noQueue: true });
    var b = await API.call('saveSettings', { settingKey: 'load_window_days', settingValue: V.val('setWindow') }, { noQueue: true });
    V.busy(btn, false);
    if (!a.success || !b.success) return V.msg('setMsg', (a.error || b.error));
    V.msg('setMsg', '✅ Saved', true); API.dataVersion = ''; loadData();
  };
  ACT.sysHealth = async function () {
    var el = document.getElementById('sysHealth'); el.innerHTML = 'Checking…';
    var r = await API.call('healthCheck');
    if (!r.success) { el.textContent = r.error || 'Could not check'; return; }
    el.innerHTML = '<p class="' + (r.ok ? 'v-ok' : 'v-bad') + '" style="font-weight:700;">' + (r.ok ? '✅ Everything looks good' : '⚠️ Some things need attention') + ' · server ' + h(r.version) + '</p>'
      + '<ul class="v-checks">' + r.checks.map(function (c) { return '<li class="' + (c.ok ? 'ok' : 'bad') + '">' + (c.ok ? '✅' : '❌') + ' <b>' + h(c.name) + '</b> <span class="v-muted">' + h(c.detail) + '</span></li>'; }).join('') + '</ul>'
      + '<div class="v-actions"><button type="button" class="v-btn" data-act="sysHealth">↻ Check again</button><button type="button" class="v-btn v-primary" data-act="sysDrill">🧪 Run restore drill</button></div>'
      + '<p class="v-note">The restore drill makes a fresh backup, checks every cell, then opens the backup with the app’s own loader and compares the result with the live data — proof the backup can really be restored. Takes ~30 seconds.</p>';
  };
  ACT.sysDrill = async function (btn) {
    V.busy(btn, true, '⏳ Running drill…');
    var r = await API.call('restoreDrill', {}, { noQueue: true });
    V.busy(btn, false);
    if (!r.success) return V.toast('❌ ' + (r.error || 'Drill failed'), 'error');
    V.toast(r.drill.ok ? '✅ Restore drill passed — ' + r.drill.cells.toLocaleString('en-IN') + ' cells identical' : '❌ Drill found problems: ' + r.drill.problems.join('; '), r.drill.ok ? 'success' : 'error');
    ACT.sysHealth();
  };
  V.whenShown('settings', function () { setTimeout(Y.renderSettings, 0); });

  // ── All Bills: load older bills from the server ──
  Y.renderOlder = function () {
    if (!V.enabled() || !API.isOwner()) return;
    var page = document.getElementById('allbills'); if (!page) return;
    var box = document.getElementById('v31Older');
    if (!box) { box = document.createElement('div'); box.id = 'v31Older'; box.className = 'v-card'; var c = document.getElementById('cancelledBillsWrap'); page.insertBefore(box, c || null); }
    var from = V.data.loadedFrom;
    box.innerHTML = '<div class="v-toolbar"><span class="v-muted" style="flex:1;">Showing bills from ' + h(V.fmtDate(from)) + '. Older bills stay safe on the server.</span>'
      + '<input id="oldQ" class="v-in" type="search" placeholder="Search older bills (name, phone, bill no)" data-enter="olderLoad"><button type="button" class="v-btn" data-act="olderLoad">⬇ Load older bills</button></div><div id="oldList"></div>';
    Y._older = null;
  };
  ACT.olderLoad = async function () {
    var el = document.getElementById('oldList'); if (!el) return;
    var st = Y._older || (Y._older = { bills: [], before: V.data.loadedFrom, q: V.val('oldQ') });
    if (st.q !== V.val('oldQ')) { st.bills = []; st.before = V.data.loadedFrom; st.q = V.val('oldQ'); }
    el.insertAdjacentHTML('beforeend', '<p class="v-muted" id="oldLoading">Loading…</p>');
    var r = await API.call('getBills', { before: st.before, limit: 100, q: st.q });
    var l = document.getElementById('oldLoading'); if (l) l.remove();
    if (!r.success) { V.toast(r.error, 'error'); return; }
    st.bills = st.bills.concat(r.bills); st.before = r.nextBefore || st.before; st.more = r.more;
    el.innerHTML = V.table(['Date', 'Bill', 'Patient', 'Items', 'Total', 'Status', ''], st.bills.map(function (b) {
      return '<tr' + (b.status === 'Cancelled' ? ' class="v-strike"' : '') + '><td>' + h(V.fmtDate(b.date)) + '</td><td><small>' + h(b.billNo || b.billId) + '</small></td><td>' + h(b.patientName) + '</td>'
        + '<td><small>' + h(b.items.map(function (i) { return i.medicineName + ' ×' + i.qty; }).join(', ')) + '</small></td>' + V.td(inr(b.total), 1) + '<td>' + V.badge(b.status === 'Cancelled' ? 'Cancelled' : b.paymentStatus) + '</td>'
        + '<td><button type="button" class="v-btn v-sm" data-act="billDetail" data-type="BILL" data-id="' + h(b.billId) + '">💰</button></td></tr>';
    }), { empty: 'No older bills.' }) + (st.more ? '<button type="button" class="v-btn v-wide" data-act="olderLoad">⬇ Load more</button>' : '');
  };
  V.whenShown('allbills', function () { setTimeout(Y.renderOlder, 0); });

  // ── Dashboard tiles ──
  Y.renderDash = function () {
    var page = document.getElementById('dashboard'); if (!page) return;
    var box = document.getElementById('v31Dash');
    if (!V.enabled()) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement('div'); box.id = 'v31Dash'; var sg = page.querySelector('.stats-grid'); page.insertBefore(box, sg ? sg.nextSibling : page.firstChild); }
    var today = V.today(), due = V.data.receivables.reduce(function (a, r) { return a + r.balance; }, 0);
    var fu = V.data.followUps.filter(function (f) { return f.status === 'Pending' && f.dueDate <= today; });
    var closed = V.data.cashClosings.some(function (c) { return c.date === today; });
    var owe = V.data.suppliers.reduce(function (a, s) { return a + Math.max(0, s.balance); }, 0);
    var tiles = [
      '<button type="button" class="v-tile" data-act="goPage" data-p="payments"><span>💰 Patients owe</span><b>' + inr(due, 0) + '</b><small>' + V.data.receivables.length + ' open bill(s)</small></button>',
      '<button type="button" class="v-tile' + (fu.length ? ' warn' : '') + '" data-act="goPage" data-p="followups"><span>🔔 Follow-ups due</span><b>' + fu.length + '</b><small>today &amp; overdue</small></button>',
      '<button type="button" class="v-tile' + (closed ? ' ok' : '') + '" data-act="goPage" data-p="cashclose"><span>🧮 Cash closing</span><b>' + (closed ? '✅ Done' : 'Not yet') + '</b><small>for today</small></button>'
    ];
    if (API.isOwner()) tiles.push('<button type="button" class="v-tile" data-act="goPage" data-p="suppliers"><span>🏭 We owe suppliers</span><b>' + inr(owe, 0) + '</b><small>' + V.data.suppliers.filter(function (s) { return s.balance > 0.009; }).length + ' supplier(s)</small></button>');
    box.innerHTML = '<div class="v-tiles">' + tiles.join('') + '</div>';
  };
  ACT.goPage = function (el) { showPage(el.dataset.p); if (typeof closeSidebar === 'function') try { closeSidebar(); } catch (e) {} };
  V.afterRefresh.push(Y.renderDash);
  V.whenShown('dashboard', function () { setTimeout(Y.renderDash, 0); });
})();
;

;/* ══ FILE: 99-speed.js ══════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════
   99-speed.js — loads LAST. Makes the app feel instant:
   • Only the page you are looking at is redrawn right away; other pages
     are redrawn in the background when the browser is idle.
   • First-time setup: asks for the Google Apps Script link once per
     device (the link is NOT stored in the code on GitHub).
   • Registers the service worker (instant repeat loads, works offline).
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 30); };

  // ── Which renderers belong to which page ──────────────────────────
  var PAGE_RENDERERS = {
    allbills:     ['updateBillsTable'],
    inventory:    ['updateInventoryTable'],
    purchases:    ['updatePurchasesTable'],
    patients:     ['renderPatientsTable', 'updatePatientStats'],
    appointments: ['renderAppointments']
  };
  var ALWAYS = ['updateDashboard', 'updateMedicineSelect'];
  var stale = {};

  function run(name) {
    if (typeof window[name] === 'function') { try { window[name](); } catch (e) { console.error(name, e); } }
  }
  function activePage() {
    var el = document.querySelector('.page.active');
    return el ? el.id : '';
  }
  function renderPage(page) {
    (PAGE_RENDERERS[page] || []).forEach(run);
    delete stale[page];
  }

  // ── Lazy refreshUI: draw visible page now, the rest when idle ─────
  if (typeof window.refreshUI === 'function') {
    window.refreshUI = function () {
      var cur = activePage();
      ALWAYS.forEach(run);
      Object.keys(PAGE_RENDERERS).forEach(function (p) { stale[p] = true; });
      renderPage(cur);
      Object.keys(PAGE_RENDERERS).forEach(function (p) {
        idle(function () { if (stale[p]) renderPage(p); }, { timeout: 2000 });
      });
    };
  }

  // ── When switching page, draw it immediately if it is stale ───────
  if (typeof window.showPage === 'function') {
    var _show = window.showPage;
    window.showPage = function (page) {
      var r = _show.apply(this, arguments);
      if (stale[page]) renderPage(page);
      return r;
    };
  }

  // ── Lazy lists: register "load more" redraws, reset on new search ──
  window.__lazyRender.bills = function () { run('filterBills'); };
  window.__lazyRender.patients = function () { run('filterPatients'); };
  ['filterBills', 'filterPatients'].forEach(function (fn) {
    var orig = window[fn];
    if (typeof orig !== 'function') return;
    window[fn] = function () {
      window.__lazyReset(fn === 'filterBills' ? 'bills' : 'patients');
      return orig.apply(this, arguments);
    };
  });

  // ── Pages that load their own data when opened ──
  if (typeof window.showPage === 'function') {
    var _show2 = window.showPage;
    window.showPage = function (page) {
      var r = _show2.apply(this, arguments);
      if (page === 'settings' && typeof renderAdminPanels === 'function') renderAdminPanels();
      if (page === 'allbills' && typeof renderCancelledBills === 'function') renderCancelledBills();
      return r;
    };
  }

  // ── Reopened app with a live session (same tab) → continue without logging in again ──
  if (window.API && API.user() && typeof startSession === 'function') {
    try { startSession(API.user()); } catch (e) { console.error(e); }
  }

  // ── Service worker ────────────────────────────────────────────────
  // (not inside the Android app: it already has the files on the phone)
  if ('serviceWorker' in navigator && !window.SSDC_NATIVE && !window.SSDC_APP_BUILD && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
;
