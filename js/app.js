/* ════════════════════════════════════════════════════════════════════
   Sri Sai Speciality Dental Care — billing app, all JavaScript in one
   file (one download = faster on slow mobile data).
   Sections are in load order; search for '══ FILE:' to jump between them.
   ════════════════════════════════════════════════════════════════════ */

;/* ══ FILE: 00-boot.js ══════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════
   00-boot.js — loads FIRST. Speed helpers used by the rest of the app:
   1. __sha256()        – password hashing (no plain passwords in code)
   2. Data prefetch     – starts downloading Google Sheets data while the
                          user is still typing the password
   3. Offline queue     – if internet drops while saving, the save is
                          kept on this device and retried automatically
   4. Lazy lists        – long tables render 50 rows at a time, more load
                          as you scroll
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── 1. SHA-256 (sync, UTF-8) ───────────────────────────────────────
  var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  window.__sha256 = function (str) {
    var bytes = Array.from(new TextEncoder().encode(String(str)));
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (var s = 7; s >= 0; s--) bytes.push(s >= 4 ? 0 : (bitLen >>> (s * 8)) & 0xff);
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var W = new Array(64);
    for (var off = 0; off < bytes.length; off += 64) {
      for (var t = 0; t < 16; t++) W[t] = (bytes[off+t*4]<<24)|(bytes[off+t*4+1]<<16)|(bytes[off+t*4+2]<<8)|bytes[off+t*4+3];
      for (t = 16; t < 64; t++) {
        var x = W[t-15], y = W[t-2];
        var s0 = ((x>>>7)|(x<<25)) ^ ((x>>>18)|(x<<14)) ^ (x>>>3);
        var s1 = ((y>>>17)|(y<<15)) ^ ((y>>>19)|(y<<13)) ^ (y>>>10);
        W[t] = (W[t-16] + s0 + W[t-7] + s1) | 0;
      }
      var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for (t = 0; t < 64; t++) {
        var S1 = ((e>>>6)|(e<<26)) ^ ((e>>>11)|(e<<21)) ^ ((e>>>25)|(e<<7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + W[t]) | 0;
        var S0 = ((a>>>2)|(a<<30)) ^ ((a>>>13)|(a<<19)) ^ ((a>>>22)|(a<<10));
        var mj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + mj) | 0;
        h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
      }
      H[0]=(H[0]+a)|0; H[1]=(H[1]+b)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0;
      H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
    }
    return H.map(function (v) { return ('00000000' + (v >>> 0).toString(16)).slice(-8); }).join('');
  };

  // ── Helpers ────────────────────────────────────────────────────────
  function storedApiUrl() {
    try { return (JSON.parse(localStorage.getItem('medistock_config') || '{}').apiUrl) || ''; }
    catch (e) { return ''; }
  }
  function isApi(url) { return typeof url === 'string' && url.indexOf('script.google.com/macros/') !== -1; }
  function paramsOf(url) { try { return new URL(url).searchParams; } catch (e) { return new URLSearchParams(''); } }
  function toast(msg, type) { if (typeof window.showToast === 'function') window.showToast(msg, type || 'success'); }

  var nativeFetch = window.fetch.bind(window);

  // ── 2. Prefetch Sheets data while the login screen is showing ─────
  var prefetch = null;
  var api0 = storedApiUrl();
  if (api0 && navigator.onLine !== false) {
    var pUrl = api0 + '?action=getAllData';
    prefetch = { url: pUrl, at: Date.now(), p: nativeFetch(pUrl, { method: 'GET', redirect: 'follow' }) };
    prefetch.p.catch(function () { prefetch = null; });
  }

  // ── 3. Offline queue for saves ─────────────────────────────────────
  // Only actions that are safe to send twice are queued (the server
  // ignores duplicates / overwrites by ID).
  var QUEUEABLE = { saveBill:1, deleteBill:1, savePatient:1, deletePatient:1, saveAppointment:1,
    updateAppointmentStatus:1, deleteAppointment:1, saveExpense:1, deleteExpense:1,
    updateMedicine:1, deleteMedicine:1, saveSettings:1, deletePurchase:1 };
  var QKEY = 'ssdc_sync_queue';
  function readQ() { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch (e) { return []; } }
  function writeQ(q) { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch (e) {} updateBadge(q.length); }
  function keyOf(url) {
    var p = paramsOf(url);
    return p.get('action') + '|' + (p.get('id') || p.get('billId') || p.get('settingKey') || url);
  }
  function enqueue(url) {
    var k = keyOf(url);
    var q = readQ().filter(function (it) { return it.k !== k; });
    q.push({ k: k, url: url, at: Date.now() });
    writeQ(q);
  }
  function dropKey(k) {
    var q = readQ(); var n = q.filter(function (it) { return it.k !== k; });
    if (n.length !== q.length) writeQ(n);
  }
  function updateBadge(n) {
    var el = document.getElementById('syncQueueBadge');
    if (!el) {
      if (!n) return;
      el = document.createElement('div');
      el.id = 'syncQueueBadge';
      el.title = 'Saved on this device, waiting for internet';
      el.onclick = function () { window.__flushSyncQueue(true); };
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = '⏳ ' + n + ' waiting to sync';
    el.style.display = n ? 'block' : 'none';
  }
  var flushing = false;
  window.__flushSyncQueue = function (manual) {
    if (flushing || navigator.onLine === false) return Promise.resolve();
    var q = readQ(); if (!q.length) return Promise.resolve();
    flushing = true; var done = 0;
    return q.reduce(function (chain, it) {
      return chain.then(function () {
        return nativeFetch(it.url, { method: 'GET', redirect: 'follow' })
          .then(function (r) { return r.json(); })
          .then(function (res) { if (res && res.success !== false) { dropKey(it.k); done++; } })
          .catch(function () {});
      });
    }, Promise.resolve()).then(function () {
      flushing = false;
      if (done) toast('☁️ ' + done + ' pending item(s) synced to Google Sheets', 'success');
      else if (manual) toast('Still offline — will retry automatically', 'warning');
    });
  };

  // Pending (unsynced) bills are merged into fresh server data so they
  // never "disappear" from the list while waiting to sync.
  function mergePending(data) {
    var q = readQ(); if (!q.length || !data || !Array.isArray(data.bills)) return data;
    var have = {}; data.bills.forEach(function (b) { have[String(b.billId)] = 1; });
    q.forEach(function (it) {
      var p = paramsOf(it.url);
      if (p.get('action') === 'saveBill' && !have[p.get('billId')]) {
        var items = []; try { items = JSON.parse(p.get('items') || '[]'); } catch (e) {}
        data.bills.push({ billId: p.get('billId'), patientName: p.get('patientName') || '', doctor: p.get('doctor') || '',
          phone: p.get('phone') || '', date: p.get('date') || '', subtotal: +p.get('subtotal') || 0,
          discount: +p.get('discount') || 0, total: +p.get('total') || 0, costTotal: +p.get('costTotal') || 0,
          paymentMode: p.get('paymentMode') || 'Cash', items: items });
      }
      if (p.get('action') === 'deleteBill') {
        data.bills = data.bills.filter(function (b) { return String(b.billId) !== p.get('billId'); });
      }
    });
    return data;
  }
  function jsonResponse(obj) {
    return new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // ── fetch wrapper (only touches Google Apps Script calls) ─────────
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : '';
    var method = ((init && init.method) || 'GET').toUpperCase();
    if (!isApi(url) || method !== 'GET') return nativeFetch(input, init);
    var action = paramsOf(url).get('action') || 'getAllData';

    if (action === 'getAllData') {
      var src;
      if (prefetch && prefetch.url === url && Date.now() - prefetch.at < 120000) {
        var pf = prefetch; prefetch = null;
        src = pf.p.then(function (r) { return r.clone(); }, function () { return nativeFetch(input, init); });
      } else {
        src = nativeFetch(input, init);
      }
      return src.then(function (r) {
        if (!r.ok) return r;
        return r.clone().json().then(function (d) { return jsonResponse(mergePending(d)); }, function () { return r; });
      });
    }

    if (QUEUEABLE[action]) {
      var k = keyOf(url);
      return nativeFetch(input, init).then(function (r) { dropKey(k); return r; }, function (err) {
        enqueue(url);
        throw err;
      });
    }
    return nativeFetch(input, init);
  };

  window.addEventListener('online', function () { setTimeout(window.__flushSyncQueue, 1500); });
  setInterval(function () { window.__flushSyncQueue(); }, 60000);
  document.addEventListener('DOMContentLoaded', function () {
    updateBadge(readQ().length);
    setTimeout(window.__flushSyncQueue, 8000);
  });

  // ── 4. Lazy lists (render 50 rows, load more on scroll) ───────────
  var PAGE = 50;
  window.__lazyLimits = {};
  window.__lazyRender = {};
  window.__lazyKeep = false;
  window.__lazyReset = function (key) { if (!window.__lazyKeep) window.__lazyLimits[key] = PAGE; };
  window.__lazySlice = function (key, arr) { return arr.slice(0, window.__lazyLimits[key] || PAGE); };
  window.__lazyMore = function (key, total, shown, colspan) {
    if (shown >= total) return '';
    setTimeout(observe, 0);
    var btn = '<button type="button" class="lazy-more" data-lazy="' + key + '" onclick="__lazyLoadMore(\'' + key + '\')">⬇ Show more (' + (total - shown) + ' more)</button>';
    return colspan ? '<tr class="lazy-more-row"><td colspan="' + colspan + '">' + btn + '</td></tr>'
                   : '<div class="lazy-more-wrap">' + btn + '</div>';
  };
  window.__lazyLoadMore = function (key) {
    window.__lazyLimits[key] = (window.__lazyLimits[key] || PAGE) + PAGE * 2;
    var fn = window.__lazyRender[key];
    if (fn) { window.__lazyKeep = true; try { fn(); } finally { window.__lazyKeep = false; } }
  };
  var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { io.unobserve(en.target); window.__lazyLoadMore(en.target.getAttribute('data-lazy')); }
    });
  }, { rootMargin: '400px' }) : null;
  function observe() {
    if (!io) return;
    document.querySelectorAll('.lazy-more:not([data-obs])').forEach(function (b) { b.setAttribute('data-obs', '1'); io.observe(b); });
  }
})();
;

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
        let currentPage = 'dashboard';

        // ============ LOGIN / AUTH ============
        // Passwords are stored only as SHA-256 hashes (never plain text in public code).
        // To change a password: open the app, press F12 → Console, run
        //   __sha256('ssdc|owner|NEW_PASSWORD')   (or 'ssdc|staff|NEW_PASSWORD')
        // and paste the result below.
        const CREDENTIALS = {
            owner: { username: 'owner', hash: 'e4a5873d591d1aaecce6c14588b5ee697251baddc12417f87904ce42447405e1' },
            staff: { username: 'staff', hash: '64fcd924b3a21386dc4e49f5665b4ec635a4feffb8395c608bef60d6aad6ac62' }
        };

        let currentRole = null; // 'owner' or 'staff'
        let selectedRole = 'owner';

        function selectRole(role) {
            selectedRole = role;
            document.getElementById('tabOwner').classList.toggle('active', role === 'owner');
            document.getElementById('tabStaff').classList.toggle('active', role === 'staff');
            document.getElementById('loginUsername').value = '';
            document.getElementById('loginPassword').value = '';
            document.getElementById('loginError').style.display = 'none';
        }

        function doLogin() {
            const username = document.getElementById('loginUsername').value.trim();
            const password = document.getElementById('loginPassword').value;
            const cred = CREDENTIALS[selectedRole];
            if (username === cred.username && __sha256('ssdc|' + selectedRole + '|' + password) === cred.hash) {
                currentRole = selectedRole;
                document.getElementById('loginScreen').classList.add('hidden');
                applyRoleUI();
                initApp();
            } else {
                document.getElementById('loginError').style.display = 'block';
            }
        }

        function doLogout() {
            currentRole = null;
            selectedRole = 'owner';
            document.getElementById('loginScreen').classList.remove('hidden');
            document.getElementById('loginUsername').value = '';
            document.getElementById('loginPassword').value = '';
            document.getElementById('loginError').style.display = 'none';
            selectRole('owner');
        }

        function applyRoleUI() {
            const isOwner = currentRole === 'owner';
            // Update user badge
            document.getElementById('userIcon').textContent = isOwner ? '👑' : '👨‍⚕️';
            document.getElementById('userName').textContent = isOwner ? 'Owner' : 'Staff';
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
                prescription: '📋 Prescription'
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
                    refreshUI();
                    
                } catch(e) {}
            }
            loadData();
            updateDate();
            setInterval(updateDate, 60000);
            // Auto-refresh from Sheets every 30 seconds
            setInterval(function(){ loadData(); }, 300000);
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

        // LOAD DATA FROM GOOGLE SHEETS
        async function loadData() {
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) {
                CONFIG.demoMode = true;
                loadDemoData();
                updateConnectionStatus(false);
                showToast('Demo Mode - Set API URL in Settings to use live data', 'warning');
                return;
            }

            try {
                // Google Apps Script CORS fix:
                // - No custom headers (they trigger a preflight OPTIONS that Apps Script rejects)
                // - redirect: 'follow' is required because Apps Script issues a redirect on GET
                const url = CONFIG.apiUrl + '?action=getAllData';
                const response = await fetch(url, {
                    method: 'GET',
                    redirect: 'follow'
                });
                
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                
                const data = await response.json();

                // Normalize types — Sheets can return numbers as strings
                medicines = (data.medicines || []).map(m => ({
                    ...m,
                    stock: parseInt(m.stock) || 0,
                    price: parseFloat(m.price) || 0,
                    costPrice: parseFloat(m.costPrice) || 0
                }));
                bills = (data.bills || []).map(b => {
                    let items = b.items || [];
                    if (typeof items === 'string') {
                        try { items = JSON.parse(items); } catch(e) { items = []; }
                    }
                    // Handle double-encoded: each element might still be a string
                    if (Array.isArray(items)) {
                        items = items.map(i => typeof i === 'string' ? (() => { try { return JSON.parse(i); } catch(e) { return i; } })() : i);
                    }
                    return {
                        ...b,
                        phone: String(b.phone || ''),
                        date: b.date ? String(b.date).split('T')[0] : '',
                        total: parseFloat(b.total) || 0,
                        subtotal: parseFloat(b.subtotal) || 0,
                        discount: parseFloat(b.discount) || 0,
                        costTotal: parseFloat(b.costTotal) || 0,
                        items: items
                    };
                });
                purchases = data.purchases || [];

                // Load patients & appointments - always update from Sheets or keep localStorage
                // Always update patients from Sheets if available, otherwise keep localStorage
                if (data.patients && data.patients.length) {
                    _patients = data.patients.map(function(p){ return {
                        id: p.id||('PT-'+Date.now()+Math.random()),
                        name: p.name||'', phone: String(p.phone||''), age: p.age||'',
                        sex: p.sex||'', doctor: p.doctor||'', treatment: p.treatment||'',
                        balance: parseFloat(p.balance)||0, alerts: p.alerts||'',
                        status: p.status||'Active', lastVisit: p.lastVisit||'', addedOn: p.addedOn||''
                    }; });
                    localStorage.setItem('pt_records', JSON.stringify(_patients));
                }
                if (data.appointments && data.appointments.length) {
                    _appointments = data.appointments.map(function(a){ return {
                        id: a.id||('A'+Date.now()+Math.random()),
                        patient: a.patient||'', phone: String(a.phone||''), date: a.date||'',
                        time: (function(t){
                            if(!t && t!==0) return '';
                            var s = String(t).trim();
                            // Already correct slot format e.g. "10:30 AM"
                            if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(s)) return s.toUpperCase();
                            var h, m;
                            // Google Sheets decimal fraction of day e.g. 0.4375 = 10:30 AM
                            var num = parseFloat(s);
                            if (!isNaN(num) && num >= 0 && num < 1) {
                                var totalMins = Math.round(num * 24 * 60);
                                h = Math.floor(totalMins / 60);
                                m = totalMins % 60;
                            }
                            // ISO timestamp e.g. "1970-01-01T05:08:00.000Z"
                            if (h === undefined && s.includes('T')) {
                                var d = new Date(s);
                                if (!isNaN(d)) { h = d.getUTCHours(); m = d.getUTCMinutes(); }
                            }
                            // Raw 24h time e.g. "10:30" or "05:08"
                            if (h === undefined && /^\d{1,2}:\d{2}$/.test(s)) {
                                var pts = s.split(':'); h = parseInt(pts[0]); m = parseInt(pts[1]);
                            }
                            if (h === undefined) return s;
                            // Snap to nearest valid slot (every 30 min)
                            var snapM = m < 15 ? 0 : m < 45 ? 30 : 0;
                            var snapH = m >= 45 ? h + 1 : h;
                            if (snapH >= 24) snapH = 23;
                            var ampm = snapH < 12 ? 'AM' : 'PM';
                            var h12 = snapH % 12 || 12;
                            return ('0' + h12).slice(-2) + ':' + (snapM === 0 ? '00' : '30') + ' ' + ampm;
                        })(a.time),
                        reason: a.reason||'', doctor: a.doctor||'',
                        status: a.status||'Confirmed', bookedAt: a.bookedAt||''
                    }; });
                    localStorage.setItem('appointments', JSON.stringify(_appointments));
                }

                // ── LOAD EXPENSES FROM SHEETS ──────────────────────
                if (data.expenses && data.expenses.length) {
                    var sheetExpenses = data.expenses.map(function(e){ return {
                        id:       e.id       || ('EXP-' + Date.now() + Math.random()),
                        date:     e.date     ? String(e.date).split('T')[0] : '',
                        category: e.category || '',
                        amount:   parseFloat(e.amount)  || 0,
                        vendor:   e.vendor   || '',
                        notes:    e.notes    || '',
                        mode:     e.mode     || e.paymentMode || e['Payment Mode'] || 'Cash',
                        addedAt:  e.addedAt  || e.added_at || ''
                    }; });
                    // Merge: keep local entries not in Sheets, add Sheets entries not local
                    var localExpenses = JSON.parse(localStorage.getItem('clinic_expenses') || '[]');
                    var sheetIds = sheetExpenses.map(function(e){ return e.id; });
                    var localOnly = localExpenses.filter(function(e){ return sheetIds.indexOf(e.id) === -1; });
                    _expenses = sheetExpenses.concat(localOnly);
                    // Sort newest first by date
                    _expenses.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
                    localStorage.setItem('clinic_expenses', JSON.stringify(_expenses));
                }
                // ───────────────────────────────────────────────────

                CONFIG.demoMode = false;
                updateConnectionStatus(true);
                // Cache data locally for fast next login
                try {
                    localStorage.setItem('medistock_cache', JSON.stringify({ medicines, bills, purchases }));
                } catch(e) {}
                refreshUI();
                // Force refresh patients, appointments and expenses tables
                setTimeout(function(){
                    if(typeof renderPatientsTable==='function') renderPatientsTable();
                    if(typeof updatePatientStats==='function') updatePatientStats();
                    if(typeof renderAppointments==='function') renderAppointments();
                    if(typeof renderExpenses==='function') renderExpenses();
                }, 100);
                showToast('✅ Data loaded from Google Sheets', 'success');
                // Load custom WA templates from Sheets so all devices stay in sync
                if (typeof _loadTmplsFromSheets === 'function') _loadTmplsFromSheets();
            } catch (err) {
                console.error('Load data error:', err);
                updateConnectionStatus(false);
                CONFIG.demoMode = false;
                loadDemoData();
                showToast("Could not load from Sheets. Saves still work.", "warning");



            }
        }

        // ── DASHBOARD CALENDAR ───────────────────────────────────
        var _dashCalYear  = new Date().getFullYear();
        var _dashCalMonth = new Date().getMonth(); // 0-based
        var _dashSelDate  = new Date().toISOString().split('T')[0];

        function renderDashCalendar() {
            var today   = new Date();
            var todayStr = today.toISOString().split('T')[0];
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
                html += '<div class="' + cls + '" onclick="dashCalSelect(\'' + dateStr + '\')">' + d + '</div>';
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
            var isToday = dateStr === new Date().toISOString().split('T')[0];
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
                var waBtn = phone ? '<button class="dash-appt-wa" onclick="sendDashApptWa(\''+a.id+'\')">📲</button>' : '';
                return '<div class="dash-appt-slot' + (isCancelled?' cancelled':'') + '">' +
                    '<span class="dash-appt-time">' + a.time + '</span>' +
                    '<div style="flex:1;min-width:0;">' +
                        '<div class="dash-appt-name">' + a.patient + '</div>' +
                        (a.doctor?'<div style="font-size:11px;color:#888;">'+a.doctor+'</div>':'') +
                    '</div>' +
                    (a.reason?'<span class="dash-appt-tag'+(isCancelled?' cancelled':'')+'">'+a.reason+'</span>':'') +
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
        function loadDemoData() {
            medicines = [
                { id: 1, name: 'Amoxicillin 500mg', stock: 50, price: 25, costPrice: 12, expiry: '2025-12-31' },
                { id: 2, name: 'Ibuprofen 200mg', stock: 100, price: 15, costPrice: 6, expiry: '2025-11-30' },
                { id: 3, name: 'Paracetamol 500mg', stock: 80, price: 10, costPrice: 4, expiry: '2025-10-31' }
            ];
            bills = [];
            purchases = [];
            refreshUI();
        }

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
            const today = new Date().toISOString().split('T')[0];
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

            document.getElementById('todayRevenue').textContent = todayRevenue.toFixed(2);
            document.getElementById('todayProfit').textContent = todayProfit.toFixed(2);

            const lowStock = medicines.filter(m => m.stock < 10).length;
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
                    <td style="font-size:11px;font-family:monospace;">${bill.billId}</td>
                    <td>${bill.patientName}</td>
                    <td>${bill.doctor || '-'}</td>
                    <td style="font-weight:700;">₹${parseFloat(bill.total||0).toFixed(2)}</td>
                    <td style="white-space:nowrap;">${bill.date}</td>
                </tr>
            `).join('');
            tbody.innerHTML = rows;
            if (cards) {
                const isCBfn = id => id && String(id).startsWith('CB-');
                cards.innerHTML = recent.map(bill => `
                    <div class="m-card" style="border-left-color:${isCBfn(bill.billId)?'#2c5aa0':'#27ae60'}">
                        <div class="m-card-row">
                            <div class="m-card-title">${bill.patientName||'—'}</div>
                            <div class="m-card-val">₹${parseFloat(bill.total||0).toFixed(2)}</div>
                        </div>
                        <div class="m-card-meta">👨‍⚕️ ${bill.doctor||'—'} &nbsp;|&nbsp; 📅 ${bill.date||''}</div>
                        <div class="m-card-meta" style="font-size:11px;color:#aaa;">${bill.billId}</div>
                    </div>
                `).join('');
            }
        }

        // BILLING
        function updateMedicineSelect() {
            const select = document.getElementById('medicineSelect');
            const purchaseSelect = document.getElementById('purchaseMedicine');
            const options = medicines.map(m => `<option value="${m.id}" data-price="${m.price}" data-stock="${m.stock}" data-name="${m.name}">${m.name} — ₹${parseFloat(m.price).toFixed(2)} (Stock: ${m.stock})</option>`).join('');
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
            const qty = parseInt(document.getElementById('medicineQty').value);

            if (!medicineId) {
                showToast('Please select a medicine', 'warning');
                return;
            }

            const medicine = medicines.find(m => String(m.id) === String(medicineId));
            if (!medicine) {
                showToast('Medicine not found', 'error');
                return;
            }

            if (qty > medicine.stock) {
                showToast(`Only ${medicine.stock} units available`, 'warning');
                return;
            }

            const existing = cart.find(c => String(c.id) === String(medicineId));
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
                    <td>${item.name}</td>
                    <td><input type="number" value="${item.qty}" min="1" onchange="updateCartQty(${idx}, this.value)"></td>
                    <td>₹${item.price}</td>
                    <td>₹${(item.qty * item.price).toFixed(2)}</td>
                    <td><button class="btn-danger btn-small" onclick="removeFromCart(${idx})">Remove</button></td>
                </tr>
            `).join('');
        }

        function updateCartQty(idx, qty) {
            cart[idx].qty = parseInt(qty);
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

        function recalc() {
            const subtotal = cart.reduce((sum, item) => sum + (item.qty * item.price), 0);
            const discountPct = parseFloat(document.getElementById('discountPct').value) || 0;
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

        function openPaymentModal(shouldPrint) {
            if (cart.length === 0) { showToast('Add medicines to cart first', 'warning'); return; }
            const patientName = document.getElementById('patientName').value.trim();
            if (!patientName) { showToast('Enter patient name', 'warning'); return; }

            _pendingPrint = shouldPrint;
            _selectedPayMode = 'Cash';

            const subtotal = cart.reduce((s, i) => s + i.qty * i.price, 0);
            const discountPct = parseFloat(document.getElementById('discountPct').value) || 0;
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
            const total = parseFloat(document.getElementById('pmTotal').textContent.replace('₹', '')) || 0;
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
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&ecc=M&data=${encodeURIComponent(upiLink)}`;

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
            if (paymentInfo.mode === 'Cash') modeLabel = '💵 Cash Payment';
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
                    <td style="padding:7px 10px;border-bottom:1px solid #eee;">${item.medicineName}</td>
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
                    <td style="padding:8px 10px;border-bottom:1px solid #eee;">${item.medicineName}</td>
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
    <h1>Payment Done!</h1>
    <div class="mode">${modeLabel}</div>
  </div>
  <div class="body">
    <div id="__ph" data-patient="${(b.patientName||'').replace(/"/g,'&quot;')}" data-doctor="${(b.doctor||'').replace(/"/g,'&quot;')}" data-date="${b.date||''}" data-billid="${b.billId||''}" data-total="${parseFloat(b.total||0).toFixed(2)}" data-subtotal="${parseFloat(b.subtotal||0).toFixed(2)}" data-discount="${parseFloat(b.discount||0).toFixed(2)}" data-mode="${b.paymentMode||'Cash'}" data-items="${encodeURIComponent(JSON.stringify((b.items||[]).map(function(i){return{name:i.medicineName||i.name||'',qty:i.qty,price:i.price,amount:i.amount};})))}" style="display:none"></div>
    <div class="bill-id">${b.billId}</div>
    <div class="clinic-header">
      <div class="name">🦷 Sri Sai Speciality Dental Care</div>
      <div class="sub">${CONFIG ? (CONFIG.clinicAddress || '') : ''}</div>
      <div class="sub">${CONFIG ? (CONFIG.clinicPhone ? '📞 ' + CONFIG.clinicPhone : '') : ''}</div>
    </div>
    <div class="info-grid">
      <div><div class="lbl">Patient</div><div class="val">${b.patientName || '—'}</div></div>
      <div><div class="lbl">Doctor</div><div class="val">${b.doctor || '—'}</div></div>
      <div><div class="lbl">Date</div><div class="val">${b.date || '—'}</div></div>
      <div><div class="lbl">Phone</div><div class="val">${b.phone || '—'}</div></div>
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
            const total = parseFloat(document.getElementById('pmTotal').textContent.replace('₹', '')) || 0;
            const tendered = parseFloat(document.getElementById('pmTendered').value) || 0;
            const change = tendered - total;
            const el = document.getElementById('pmChange');
            el.textContent = change >= 0 ? '₹' + change.toFixed(2) : '-₹' + Math.abs(change).toFixed(2);
            el.style.color = change >= 0 ? '#27ae60' : '#e74c3c';
        }

        function calcSplit() {
            const total = parseFloat(document.getElementById('pmTotal').textContent.replace('₹', '')) || 0;
            const cash = parseFloat(document.getElementById('pmSplitCash').value) || 0;
            const upi = parseFloat(document.getElementById('pmSplitUpi').value) || 0;
            const rem = total - cash - upi;
            const el = document.getElementById('splitStatus');
            if (Math.abs(rem) < 0.01) { el.textContent = '✅ Balanced'; el.style.color = '#27ae60'; }
            else if (rem > 0) { el.textContent = '⚠️ ₹' + rem.toFixed(2) + ' still pending'; el.style.color = '#e67e22'; }
            else { el.textContent = '❌ Overpaid by ₹' + Math.abs(rem).toFixed(2); el.style.color = '#e74c3c'; }
        }

        function confirmPayment() {
            const total = parseFloat(document.getElementById('pmTotal').textContent.replace('₹', '')) || 0;

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
            const costTotal = cart.reduce((sum, item) => sum + (item.qty * item.costPrice), 0);
            const discountPct = parseFloat(document.getElementById('discountPct').value) || 0;
            const discount = (subtotal * discountPct) / 100;
            const total = subtotal - discount;

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
                items: cart.map(item => ({
                    medicineId: item.id,
                    medicineName: item.name,
                    qty: item.qty,
                    price: item.price,
                    costPrice: item.costPrice,
                    amount: item.qty * item.price
                }))
            };

            // ✅ SAVE LOCALLY IMMEDIATELY — no waiting for Sheets
            bills.push({...billData});
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
            showToast(`✅ Bill saved! Payment: ${paymentInfo.mode}. Syncing...`, 'success');

            if (shouldPrint) printBill();
            document.getElementById('whatsappBtn').style.display = 'block';

            // ✅ Show Bill Payment Done popup with bill copy
            showBillSuccess(billData, paymentInfo);

            // Auto-clear cart after payment (no confirm needed — payment already confirmed)
            cart = [];
            document.getElementById('patientName').value = '';
            document.getElementById('patientPhone').value = '';
            document.getElementById('doctor').value = '';
            document.getElementById('discountPct').value = '0';
            renderCart();
            recalc();
            updateReceipt();

            // 🔄 SYNC TO GOOGLE SHEETS IN BACKGROUND (user not blocked)
            try {
                const params = new URLSearchParams();
                params.append('action', 'saveBill');
                params.append('billId', billId);
                params.append('patientName', billData.patientName);
                params.append('doctor', billData.doctor || '');
                params.append('phone', billData.phone || '');
                params.append('date', today);
                params.append('subtotal', subtotal.toFixed(2));
                params.append('discount', discount.toFixed(2));
                params.append('total', total.toFixed(2));
                params.append('costTotal', costTotal.toFixed(2));
                params.append('paymentMode', paymentInfo.mode);
                params.append('paymentRef', paymentInfo.ref || '');
                params.append('items', JSON.stringify(billData.items));

                fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' })
                    .then(r => r.json())
                    .then(result => {
                        if (result.success) {
                            showToast('☁️ Synced to Google Sheets!', 'success');
                        } else {
                            showToast('⚠️ Saved locally, Sheets sync failed: ' + (result.error || ''), 'warning');
                        }
                    })
                    .catch(err => {
                        showToast('⚠️ Saved locally, Sheets offline', 'warning');
                    });
            } catch(e) {
                showToast('⚠️ Saved locally, Sheets offline', 'warning');
            }
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
            tbody.innerHTML = medicines.map(med => `
                <tr>
                    <td><strong>${med.name}</strong></td>
                    <td style="color:${stockColor(med.stock)};font-weight:700;">${med.stock}</td>
                    <td>₹${med.price}</td>
                    <td>₹${med.costPrice}</td>
                    <td style="white-space:nowrap;">${med.expiry}</td>
                    <td><button class="btn-danger btn-small" onclick="deleteMedicine(${med.id})">Delete</button></td>
                </tr>
            `).join('');
            if (cards) {
                cards.innerHTML = medicines.length ? medicines.map(med => {
                    const sc = stockColor(med.stock);
                    return `<div class="m-card" style="border-left-color:${sc}">
                        <div class="m-card-row">
                            <div class="m-card-title">${med.name}</div>
                            <div style="font-size:20px;font-weight:900;color:${sc};">${med.stock}</div>
                        </div>
                        <div class="m-card-row">
                            <div class="m-card-meta">💰 Sell: ₹${med.price} &nbsp;|&nbsp; Buy: ₹${med.costPrice}</div>
                            <div class="m-card-meta">📅 ${med.expiry}</div>
                        </div>
                        <div class="m-card-actions">
                            <button style="background:#e74c3c;" onclick="deleteMedicine(${med.id})">🗑️ Delete</button>
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
            medicines.push({ id: tempId, name, price, costPrice, stock, expiry });
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

                fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' })
                    .then(r => r.json())
                    .then(result => {
                        if (result.success) {
                            // Update local ID to real Sheets ID
                            const med = medicines.find(m => String(m.id) === String(tempId));
                            if (med) {
                                med.id = result.medicineId;
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
            if (!confirm('Are you sure you want to delete this medicine?\nThis cannot be undone.')) return;

            medicines = medicines.filter(m => m.id !== id);
            updateInventoryTable();
            updateMedicineSelect();
            showToast('🗑️ Medicine deleted', 'success');

            try {
                const params = new URLSearchParams();
                params.append('action', 'deleteMedicine');
                params.append('id', id);
                await fetch(CONFIG.apiUrl + '?' + params.toString(), {
                    method: 'GET',
                    redirect: 'follow'
                });
            } catch(err) {
                console.error('Delete medicine sync error:', err);
            }
        }

        // PURCHASES
        function updatePurchasesTable() {
            const tbody = document.getElementById('purchasesBody');
            const cards = document.getElementById('purchasesCards');
            tbody.innerHTML = purchases.map((p, i) => `
                <tr>
                    <td style="white-space:nowrap;">${p.date}</td>
                    <td>${p.supplier}</td>
                    <td><strong>${p.medicineName}</strong></td>
                    <td style="text-align:center;">${p.qty}</td>
                    <td>₹${p.costPrice}</td>
                    <td style="font-weight:700;">₹${(p.qty * p.costPrice).toFixed(2)}</td>
                    <td><button class="btn-danger btn-small" onclick="deletePurchase('${p.id||i}')">🗑️</button></td>
                </tr>
            `).join('');
            if (cards) {
                cards.innerHTML = purchases.length ? purchases.slice().reverse().map((p, i) => `
                    <div class="m-card">
                        <div class="m-card-row">
                            <div class="m-card-title">${p.medicineName}</div>
                            <div class="m-card-val">₹${(p.qty * p.costPrice).toFixed(2)}</div>
                        </div>
                        <div class="m-card-meta">🏪 ${p.supplier} &nbsp;|&nbsp; 📦 Qty: ${p.qty}</div>
                        <div class="m-card-meta">💰 Cost: ₹${p.costPrice}/unit &nbsp;|&nbsp; 📅 ${p.date}</div>
                        <div class="m-card-actions" style="margin-top:8px;">
                            <button style="background:#e74c3c;" onclick="deletePurchase('${p.id||''}')">🗑️ Delete</button>
                        </div>
                    </div>
                `).join('') : '<div style="text-align:center;color:#aaa;padding:20px;">No purchases yet.</div>';
            }
        }

        async function deletePurchase(id) {
            if (!id) { showToast('Cannot delete — no ID on this record', 'warning'); return; }
            if (!confirm('Delete this purchase record? This cannot be undone.')) return;
            purchases = purchases.filter(p => (p.id||'') !== id);
            localStorage.setItem('purchases', JSON.stringify(purchases));
            updatePurchasesTable();
            showToast('🗑️ Purchase deleted', 'success');
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
            try {
                const params = new URLSearchParams();
                params.append('action', 'deletePurchase');
                params.append('id', id);
                const res = await fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' }).then(r => r.json());
                if (res.success) showToast('☁️ Removed from Google Sheets', 'success');
                else showToast('⚠️ Deleted locally — Sheets sync failed', 'warning');
            } catch(err) { showToast('⚠️ Deleted locally only — no internet?', 'warning'); }
        }

        function openAddPurchaseModal() {
            document.getElementById('purchaseDate').valueAsDate = new Date();
            document.getElementById('purchaseSupplier').value = '';
            document.getElementById('purchaseMedicine').value = '';
            document.getElementById('purchaseQty').value = '1';
            document.getElementById('purchaseCostPrice').value = '';
            document.getElementById('addPurchaseModal').classList.add('active');
        }

        async function savePurchase() {
            const date = document.getElementById('purchaseDate').value;
            const supplier = document.getElementById('purchaseSupplier').value.trim();
            const medicineId = document.getElementById('purchaseMedicine').value;
            const qty = parseInt(document.getElementById('purchaseQty').value);
            const costPrice = parseFloat(document.getElementById('purchaseCostPrice').value);

            if (!date || !supplier || !medicineId || !qty || !costPrice) {
                showToast('Fill all fields', 'warning');
                return;
            }

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

            // Save locally immediately
            purchases.push({ id: 'PUR-' + Date.now(), date, supplier, medicineId: medicine.id, medicineName: medicine.name, qty, costPrice });
            medicine.stock = (medicine.stock || 0) + qty;

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
                params.append('date', date);
                params.append('supplier', supplier);
                params.append('medicineId', medicineId);
                params.append('medicineName', medicine.name);
                params.append('qty', qty);
                params.append('costPrice', costPrice);

                fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' })
                    .then(r => r.json())
                    .then(result => {
                        if (result.success) {
                            showToast('☁️ Purchase synced to Sheets!', 'success');
                        } else {
                            showToast('⚠️ Saved locally, Sheets sync failed', 'warning');
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
                const printFn = isCB ? `reprintCbBillFromAllBills('${bill.billId}')` : `reprrintBill('${bill.billId}')`;
                const waFn    = isCB ? `shareWhatsAppCb('${bill.billId}')` : `shareWhatsApp('${bill.billId}')`;

                const payColor = bill.paymentMode==='Cash'?'#e8f8ee':bill.paymentMode==='UPI'?'#fff3e0':bill.paymentMode==='Card'?'#e8f0fe':'#fce4ec';
                const payText  = bill.paymentMode==='Cash'?'#27ae60':bill.paymentMode==='UPI'?'#e67e22':bill.paymentMode==='Card'?'#2c5aa0':'#c0392b';

                const medNames = items.map(i => {
                    const m = medicines.find(x => String(x.id)===String(i.medicineId));
                    return i.medicineName||(m?m.name:null)||i.name||'—';
                });

                // ── Desktop table row ──
                const typeBadge = isCB
                    ? `<span style="background:#e8f0fe;color:#2c5aa0;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;">🧾 Bill Summary</span>`
                    : `<span style="background:#e8f8ee;color:#27ae60;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;">💊 Pharmacy</span>`;
                const trInfo = (isCB && bill.trDesc)
                    ? `<div><span style="background:#f0f4ff;color:#1e3f5a;border-radius:4px;padding:2px 7px;font-size:12px;">🦷 ${bill.trDesc.substring(0,35)}${bill.trDesc.length>35?'...':''}</span></div>`
                    : '';
                const medBadges = medNames.length
                    ? medNames.map((n,i2)=>`<span style="display:inline-block;background:#e8f0fe;color:#2c5aa0;border-radius:4px;padding:2px 7px;margin:2px;font-size:12px;">${n} ×${items[i2].qty}</span>`).join('')
                    : '<span style="color:#aaa;font-size:12px;">—</span>';

                tableRows += `<tr>
                    <td style="font-size:11px;font-family:monospace;">${bill.billId}</td>
                    <td>${typeBadge}</td>
                    <td>${bill.patientName||'—'}</td>
                    <td>${bill.doctor||'—'}</td>
                    <td style="max-width:200px;">${trInfo}${medBadges}</td>
                    <td style="font-weight:700;">₹${parseFloat(bill.total||0).toFixed(2)}</td>
                    <td><span style="background:${payColor};color:${payText};border-radius:4px;padding:2px 8px;font-size:12px;font-weight:600;">${bill.paymentMode||'—'}</span></td>
                    <td style="white-space:nowrap;">${bill.date||'—'}</td>
                    <td style="white-space:nowrap;">
                        <button class="btn-primary btn-small" onclick="${printFn}" style="margin-right:4px;">🖨️ Print</button>
                        <button class="btn-primary btn-small" onclick="${waFn}" style="background:#25d366;">📲 WA</button>
                    </td>
                </tr>`;

                // ── Mobile card ──
                const typeLabel = isCB ? '🧾 Bill Summary' : '💊 Pharmacy';
                const typeColor = isCB ? '#2c5aa0' : '#27ae60';
                const medLine   = medNames.length ? medNames.map((n,i2)=>`${n} ×${items[i2].qty}`).join(', ') : '';
                const trLine    = (isCB && bill.trDesc) ? `<div class="bill-card-meta">🦷 ${bill.trDesc.substring(0,50)}${bill.trDesc.length>50?'...':''}</div>` : '';

                cardHtml += `<div class="bill-card ${isCB?'bc-cb':'bc-ph'}">
                    <div class="bill-card-top">
                        <div>
                            <div class="bill-card-name">${bill.patientName||'—'}</div>
                            <span style="background:${isCB?'#e8f0fe':'#e8f8ee'};color:${typeColor};border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;">${typeLabel}</span>
                        </div>
                        <div style="text-align:right;">
                            <div class="bill-card-total">₹${parseFloat(bill.total||0).toFixed(2)}</div>
                            <div style="font-size:11px;color:#888;">${bill.date||''}</div>
                        </div>
                    </div>
                    <div class="bill-card-meta">👨‍⚕️ ${bill.doctor||'—'} &nbsp;|&nbsp; <span class="pay-badge" style="background:${payColor};color:${payText};">${bill.paymentMode||'—'}</span></div>
                    ${trLine}
                    ${medLine?`<div class="bill-card-meta">💊 ${medLine}</div>`:''}
                    <div class="bill-card-actions" style="margin-top:10px;">
                        <button class="bc-print-btn" onclick="${printFn}">🖨️ Print</button>
                        <button class="bc-wa-btn" onclick="${waFn}">📲 WhatsApp</button>
                    </div>
                </div>`;
            });

            if(tbody)    tbody.innerHTML    = tableRows + __lazyMore('bills', __allBills.length, sorted.length, 9);
            if(cardsEl)  cardsEl.innerHTML  = cardHtml + __lazyMore('bills', __allBills.length, sorted.length);
        }

        // Filter bills by patient name search
        function filterBills() {
            const q = (document.getElementById('billsSearch').value||'').toLowerCase();
            if (!q) { updateBillsTable(); return; }
            const filtered = bills.filter(b => (b.patientName||'').toLowerCase().includes(q));
            const saved = bills;
            bills = filtered;
            updateBillsTable();
            bills = saved;
        }

        async function deleteBill(billId) {
            if (!confirm('Are you sure you want to delete Bill: ' + billId + '?\nThis cannot be undone.')) return;

            // Remove from local state immediately
            bills = bills.filter(b => b.billId !== billId);
            updateBillsTable();
            updateDashboard();
            showToast('🗑️ Bill deleted', 'success');

            // Also delete from Google Sheets
            try {
                const params = new URLSearchParams();
                params.append('action', 'deleteBill');
                params.append('billId', billId);
                await fetch(CONFIG.apiUrl + '?' + params.toString(), {
                    method: 'GET',
                    redirect: 'follow'
                });
            } catch(err) {
                console.error('Delete sync error:', err);
            }
        }


        // Universal print helper — works for local files
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
            function addFooter(gt) {
                nl(); dbl();
                ctr('*  THANK YOU  *', true, true);
                ctr('Beauty is Power, Smile is a Sword', true);
                ctr('Visit Again! Stay Healthy :)', true);
                dbl(); nl();
                star();
                ctr('SCAN & PAY', true);
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
            html = html.replace(/&#8377;/g,'Rs.').replace(/\u20b9/g,'Rs.')
                       .replace(/&amp;/g,'&').replace(/&nbsp;/g,' ')
                       .replace(/&lt;/g,'<').replace(/&gt;/g,'>');
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
                if(grandTotal>0){ dbl(); ctr('** TOTAL **',true,true); ctr('Rs. '+grandTotal.toFixed(2),true,true); dbl(); }

            } else if (isRx) {
                var rxEl=doc2.getElementById('__rx');
                (rxEl?(rxEl.innerText||rxEl.textContent):'').split('\n')
                    .map(function(l){return l.trim();}).filter(Boolean).slice(0,20)
                    .forEach(function(l){if(!/^(sri sai|mob|timing|reg\.|b\.d)/i.test(l))lft(tr_(l,W));});

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
                    addSampleMeds();
                    if (!grandTotal) grandTotal = 289.60;
                }
                dbl(); ctr('** GRAND TOTAL **',true,true); ctr('Rs. '+grandTotal.toFixed(2),true,true); dbl();
            }

            addFooter(grandTotal);
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
            btnBar.innerHTML = '<button onclick="window.print()" style="padding:12px 28px;background:#2c5aa0;color:white;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;touch-action:manipulation;">🖨️ Print / Save PDF</button>' +
                '<button onclick="closePrintModal()" style="padding:12px 20px;background:#e74c3c;color:white;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;touch-action:manipulation;">✕ Close</button>';
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
            const name   = document.getElementById('rx_name').value || '';
            const age    = document.getElementById('rx_age').value || '';
            const sex    = document.getElementById('rx_sex').value || '';
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
                        <div style="font-weight:700;color:var(--primary);font-size:14px;">${r.name || '-'} &nbsp;|&nbsp; Age: ${r.age||'-'} &nbsp;|&nbsp; ${r.sex||'-'}</div>
                        <div style="font-size:12px;color:#777;margin-top:3px;">Date: ${r.dateStr || '-'}</div>
                        <div style="font-size:12px;color:#555;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${preview || '-'}</div>
                    </div>
                    <div style="display:flex;gap:8px;flex-shrink:0;">
                        <button onclick="loadRxRecord(${idx})" style="background:#2c5aa0;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">✏️ Edit</button>
                        <button onclick="reprintRxRecord(${idx})" style="background:#27ae60;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">🖨️ Print</button>
                        <button onclick="deleteRxRecord(${idx})" style="background:#e74c3c;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">🗑️</button>
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

            const record = { name, age, sex, date: dateV, dateStr, rxText, savedAt: new Date().toISOString() };
            const list = getRxHistory();
            list.push(record);
            saveRxHistory(list);
            renderRxHistory();

            printBillHtml(buildPrescriptionHTML());
            savePrescriptionToSheets();
        }

        function savePrescriptionToSheets() {
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
            const name   = document.getElementById('rx_name').value || '';
            const age    = document.getElementById('rx_age').value || '';
            const sex    = document.getElementById('rx_sex').value || '';
            const dateV  = document.getElementById('rx_date').value || '';
            const rxText = document.getElementById('rx_content').value || '';

            const params = new URLSearchParams();
            params.append('action', 'savePrescription');
            params.append('date', dateV);
            params.append('patientName', name);
            params.append('age', age);
            params.append('sex', sex);
            params.append('prescription', rxText);

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
            const no        = document.getElementById('tr_no').value || '___________';
            const date      = document.getElementById('tr_date').value || '';
            const patient   = document.getElementById('tr_patient').value || '______________________________';
            const amount    = document.getElementById('tr_amount').value || '___________';
            const words     = document.getElementById('tr_words').value || '______________________________';
            const treatText = (document.getElementById('tr_treatment_text') ? document.getElementById('tr_treatment_text').value.trim() : '') || '';
            const dateStr   = date ? new Date(date).toLocaleDateString('en-IN', {day:'2-digit',month:'2-digit',year:'numeric'}) : '_______________';
            const clinicAddr  = CONFIG ? (CONFIG.clinicAddress || 'TKR College Road, Karmanghat, Hyderabad.') : 'TKR College Road, Karmanghat, Hyderabad.';
            const clinicPhone = CONFIG ? (CONFIG.clinicPhone || '9396522492, 8688033072') : '9396522492, 8688033072';

            // Build treatment rows — one row per line typed, minimum 6 rows for blank space
            const tLines = treatText ? treatText.split('\n').map(l => l.trim()).filter(Boolean) : [];
            const minRows = 6;
            const rowsToShow = Math.max(tLines.length, minRows);
            let treatmentRows = '';
            for (let i = 0; i < rowsToShow; i++) {
                const label = tLines[i] || '&nbsp;';
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
                        <div style="font-weight:700;color:var(--primary);font-size:14px;">Receipt No. ${r.no || '-'} &nbsp;|&nbsp; ${r.patient || '-'}</div>
                        <div style="font-size:12px;color:#777;margin-top:3px;">Date: ${r.dateStr || '-'} &nbsp;|&nbsp; Rs. ${r.amount || '-'}</div>
                        <div style="font-size:12px;color:#555;margin-top:3px;">${r.treatments || '-'}</div>
                    </div>
                    <div style="display:flex;gap:8px;flex-shrink:0;">
                        <button onclick="loadTreatmentRecord(${idx})" style="background:#2c5aa0;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">✏️ Edit</button>
                        <button onclick="reprintTreatmentRecord(${idx})" style="background:#27ae60;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">🖨️ Print</button>
                        <button onclick="deleteTreatmentRecord(${idx})" style="background:#e74c3c;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">🗑️</button>
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

            const record = { no, date: dateV, dateStr, patient, amount, words, treatmentText, treatments: treatmentText, savedAt: new Date().toISOString() };
            const list = getTreatmentHistory();
            list.push(record);
            saveTreatmentHistory(list);
            renderTreatmentHistory();

            const html = buildTreatmentReceiptHTML(true);
            printBillHtml(html);
            saveTreatmentReceiptToSheets();
        }

        function saveTreatmentReceiptToSheets() {
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
            const no      = document.getElementById('tr_no').value || '';
            const dateV   = document.getElementById('tr_date').value || '';
            const patient = document.getElementById('tr_patient').value || '';
            const amount  = document.getElementById('tr_amount').value || '';
            const words   = document.getElementById('tr_words').value || '';

            const selected = document.getElementById('tr_treatment_text') ? document.getElementById('tr_treatment_text').value.trim() : '';

            const params = new URLSearchParams();
            params.append('action', 'saveTreatmentReceipt');
            params.append('receiptNo', no);
            params.append('date', dateV);
            params.append('patient', patient);
            params.append('amount', amount);
            params.append('amountWords', words);
            params.append('treatments', selected);

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
                    '<td style="padding:7px 10px;border-bottom:1px solid #eee;">'+medName+'</td>' +
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
                '<div class="bid">'+bill.billId+'</div>' +
                '<div class="hdr"><h2>&#x1F9B7; '+CONFIG.clinicName+'</h2>' +
                '<p>'+(CONFIG.clinicAddress||'')+'</p>' +
                '<p>'+(CONFIG.clinicPhone?'&#128222; '+CONFIG.clinicPhone:'')+'</p></div>' +
                '<div class="info">' +
                '<div><div class="lbl">Patient</div><div class="val">'+(bill.patientName||'—')+'</div></div>' +
                '<div><div class="lbl">Doctor</div><div class="val">'+(bill.doctor||'—')+'</div></div>' +
                '<div><div class="lbl">Date</div><div class="val" style="font-weight:500">'+(bill.date||'—')+'</div></div>' +
                '<div><div class="lbl">Payment</div><div class="val" style="font-weight:500">'+(bill.paymentMode||'—')+'</div></div>' +
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
                csvContent += `"${stat.name}",${stat.totalQty},${stat.totalRevenue.toFixed(2)},${stat.totalCost.toFixed(2)},${stat.totalProfit.toFixed(2)},${stat.transactions},${margin}%\n`;
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
                    csvContent += `"${stat.supplier}",${stat.transactions},${stat.totalQty},${stat.totalCost.toFixed(2)},${stat.totalRevenue.toFixed(2)},${profit.toFixed(2)},${margin},"${Array.from(stat.medicines).join(', ')}"\n`;
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
                            '<span style="font-weight:700;">'+cat+'</span>' +
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
                                '<span style="background:'+color+'22;color:'+color+';border-radius:6px;padding:2px 8px;font-size:11px;font-weight:800;">'+e.category+'</span>' +
                                '<span style="font-size:11px;color:#888;">'+e.date+'</span>' +
                                '<span style="font-size:11px;color:#888;">'+modeIcon+' '+e.mode+'</span>' +
                            '</div>' +
                            (e.vendor ? '<div style="font-size:13px;font-weight:700;color:#333;margin-bottom:2px;">'+e.vendor+'</div>' : '') +
                            (e.notes  ? '<div style="font-size:12px;color:#666;">'+e.notes+'</div>' : '') +
                        '</div>' +
                        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">' +
                            '<div style="font-size:18px;font-weight:800;color:'+color+';">₹'+e.amount.toFixed(2)+'</div>' +
                            '<button onclick="deleteExpense(\''+e.id+'\')" style="padding:4px 10px;background:#fdecea;color:#e74c3c;border:1px solid #e74c3c;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;touch-action:manipulation;">🗑️ Delete</button>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            }).join('');
        }

        function exportExpensesCSV() {
            if (_expenses.length === 0) { showToast('No expenses to export','warning'); return; }
            var csv = 'Date,Category,Amount,Vendor,Notes,Payment Mode\n';
            _expenses.forEach(function(e){
                csv += '"'+e.date+'","'+e.category+'",'+e.amount.toFixed(2)+',"'+(e.vendor||'')+'","'+(e.notes||'')+'","'+(e.mode||'')+'"\n';
            });
            var blob = new Blob([csv], {type:'text/csv'});
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'clinic_expenses_'+new Date().toISOString().split('T')[0]+'.csv';
            a.click();
            showToast('📥 CSV exported!', 'success');
        }

        // Set today's date as default on expenses form
        (function(){
            var d = document.getElementById('exp_date');
            if (d) d.value = new Date().toISOString().split('T')[0];
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
            const today = now.toISOString().split('T')[0];

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

        function renderKPIs(filtered) {
            const totalRev  = filtered.reduce((s,b) => s + (parseFloat(b.total)||0), 0);
            const totalPts  = filtered.length;
            const avgBill   = totalPts ? totalRev / totalPts : 0;
            const totalDisc = filtered.reduce((s,b) => s + (parseFloat(b.discount)||0), 0);

            // Unique patient names
            const uniquePts = new Set(filtered.map(b => (b.patientName||'').toLowerCase().trim())).size;

            // Bills today
            const today = new Date().toISOString().split('T')[0];
            const todayRev = bills.filter(b => String(b.date).split('T')[0] === today)
                                  .reduce((s,b) => s + (parseFloat(b.total)||0), 0);

            const kpis = [
                { label:"Total Revenue",   value:`₹${totalRev.toLocaleString('en-IN',{maximumFractionDigits:0})}`,  color:'#2c5aa0', icon:'💰' },
                { label:"Total Bills",     value:totalPts,                       color:'#27ae60', icon:'🧾' },
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
                buckets[d.toISOString().split('T')[0]] = 0;
            }
            filtered.forEach(b => {
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
                    <title>${date}: ₹${val.toFixed(0)}</title></rect>`;
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

            // Count from treatment receipts saved in localStorage (tr_history is the correct key)
            try {
                const saved = JSON.parse(localStorage.getItem('tr_history') || '[]');
                saved.forEach(r => {
                    if (r.treatments) {
                        String(r.treatments).split(',').forEach(t => {
                            const key = Object.keys(treatments).find(k => t.trim().toLowerCase().includes(k.toLowerCase()));
                            if (key) treatments[key]++;
                        });
                    }
                });
            } catch(e) {}

            // Fallback: estimate from bill count if no treatment data
            const total = Object.values(treatments).reduce((a,b)=>a+b,0);
            const labels = total === 0
                ? ['Consultation','Fillings','Root Canal','Extractions','Scaling','Others']
                : Object.keys(treatments).filter(k => treatments[k] > 0);
            const values = total === 0
                ? [40, 20, 15, 10, 10, 5]
                : labels.map(k => treatments[k]);

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
                        <span style="font-weight:600;color:#2c3e50;">${doc}</span>
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
                    <title>${labels[i]}: ${v} (${Math.round((v/total)*100)}%)</title></path>`;
            }).join('');

            const legend = labels.map((l, i) => `
                <div style="display:flex;align-items:center;gap:5px;font-size:11px;margin-bottom:4px;">
                    <span style="width:10px;height:10px;background:${colors[i%colors.length]};border-radius:2px;flex-shrink:0;"></span>
                    <span style="color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px;">${l}</span>
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
                        <td style="padding:7px 8px;color:#2c3e50;font-weight:500;">${name}</td>
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
                text:`<b>${topMode[0]}</b> is your most used payment method (${topMode[1]} transactions). Ensure UPI QR codes are clearly visible at reception.`
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
            const today = new Date().toISOString().split('T')[0];
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
                            <span style="font-weight:700;color:#2c3e50;font-size:14px;">${sup}</span>
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
                            <td style="padding:11px 12px;font-weight:700;font-size:13px;color:#2c3e50;">${sup}</td>
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
                            <td style="padding:11px 14px;font-weight:600;color:#2c3e50;">${name}</td>
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
                csv += `"${d}","${normSupplier(p.supplier)}","${normMedicine(p.medicineName)}",${p.qty||0},${parseFloat(p.costPrice||0).toFixed(2)},${purchaseCost(p).toFixed(2)}\n`;
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
                csv += `"${s}",${v.cost.toFixed(2)},${v.revenue.toFixed(2)},${profit.toFixed(2)},${margin}\n`;
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
                csv += `"${m}",${v.qty},${v.cost.toFixed(2)},${rev.toFixed(2)},${profit.toFixed(2)},${margin}\n`;
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
                    csv += `"${r.no||''}","${r.date||''}","${r.patient||''}","${r.amount||''}","${r.treatments||''}"\n`;
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
            `<button class="tr-chip" onclick="document.getElementById('trPmTendered').value=${v};calcTrChange();">₹${v}</button>`).join('');
        const upiId=(typeof CONFIG!=='undefined'?CONFIG.upiId:'')||'';
        const upiName=(typeof CONFIG!=='undefined'?CONFIG.upiName:'')||'Sri Sai Dental';
        if (upiId.trim()) {
            document.getElementById('trUpiWarn').style.display='none';
            document.getElementById('trUpiCard').style.display='block';
            document.getElementById('trUpiAmt').textContent='₹'+amt.toFixed(2);
            document.getElementById('trUpiIdShow').textContent=upiId;
            const lnk=`upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${amt.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Dental')}`;
            document.getElementById('trUpiQr').src=`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(lnk)}`;
        } else {
            document.getElementById('trUpiWarn').style.display='block';
            document.getElementById('trUpiCard').style.display='none';
        }
        selectTrMode('Cash');
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
    function calcTrChange() {
        const total=parseFloat((document.getElementById('trPmTotal').textContent||'').replace('₹',''))||0;
        const amt=parseFloat(document.getElementById('trPmTendered').value)||0;
        const chg=amt-total;
        const el=document.getElementById('trPmChange');
        el.textContent=chg>=0?'₹'+chg.toFixed(2):'-₹'+Math.abs(chg).toFixed(2);
        el.style.color=chg>=0?'#27ae60':'#e74c3c';
    }
    function calcTrSplit() {
        const total=parseFloat((document.getElementById('trPmTotal').textContent||'').replace('₹',''))||0;
        const cash=parseFloat(document.getElementById('trPmSplitCash').value)||0;
        const upi=parseFloat(document.getElementById('trPmSplitUpi').value)||0;
        const rem=total-cash-upi;
        const el=document.getElementById('trSplitSt');
        if(Math.abs(rem)<0.01){el.textContent='✅ Balanced';el.style.background='#e8f8ee';el.style.color='#27ae60';}
        else if(rem>0){el.textContent='⚠️ ₹'+rem.toFixed(2)+' still pending';el.style.background='#fff8e1';el.style.color='#e67e22';}
        else{el.textContent='❌ Overpaid by ₹'+Math.abs(rem).toFixed(2);el.style.background='#fff0f0';el.style.color='#e74c3c';}
    }
    function confirmTrPayment() {
        const total=parseFloat((document.getElementById('trPmTotal').textContent||'').replace('₹',''))||0;
        if(_trMode==='Cash'&&(parseFloat(document.getElementById('trPmTendered').value)||0)<total){showToast('Amount tendered is less than total','warning');return;}
        if(_trMode==='Split'){
            const c=parseFloat(document.getElementById('trPmSplitCash').value)||0;
            const u=parseFloat(document.getElementById('trPmSplitUpi').value)||0;
            if(Math.abs(c+u-total)>0.5){showToast('Split amounts must add up to total','warning');return;}
        }
        closeTrPayModal();
        const modeLabel={Cash:'💵 Cash',UPI:'📱 UPI / GPay',Card:'💳 Card',Split:'🔀 Split'};
        document.getElementById('trSucPat').textContent=document.getElementById('tr_patient').value||'—';
        document.getElementById('trSucNo').textContent=document.getElementById('tr_no').value||'—';
        document.getElementById('trSucAmt').textContent='₹'+total.toFixed(2);
        document.getElementById('trSucMode').textContent=modeLabel[_trMode]||_trMode;
        setTimeout(()=>document.getElementById('trSuccessSheet').classList.add('tr-open'),220);
        printTreatmentReceipt();
    }
    function trSucPrint(){closeTrSuccess();setTimeout(()=>printBillHtml(buildTreatmentReceiptHTML(true)),150);}
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

    function peekNextReceiptNo() {
        var year = new Date().getFullYear();
        var key  = 'receipt_counter_' + year;
        var curr = parseInt(localStorage.getItem(key) || '0');
        return year + '-' + String(curr + 1).padStart(4, '0');
    }

    function autoFillNo(fieldId) {
        var el = document.getElementById(fieldId);
        if (!el) return;
        var no = getNextReceiptNo();
        el.value = no;
        el.style.borderColor = '#27ae60';
        el.style.background  = '#f0fff4';
        setTimeout(function(){ el.style.borderColor = ''; el.style.background = ''; }, 1500);
        // Trigger any relevant preview/recalc
        el.dispatchEvent(new Event('input'));
        showToast('✅ Receipt No. ' + no + ' assigned', 'success');
    }
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
        var stock = parseInt(opt.dataset.stock)   || 9999;
        var name  = opt.dataset.name || opt.text.split('—')[0].trim();
        if (!price) {
            var med = (window.medicines||[]).find(function(m){ return String(m.id)===String(medId); });
            if (med) { price=parseFloat(med.price)||0; stock=parseInt(med.stock)||9999; name=med.name; }
        }
        if (qty > stock) { showToast('Only ' + stock + ' in stock!', 'warning'); return; }
        var existing = _cbCart.find(function(c){ return String(c.medicineId)===String(medId); });
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
                '<td class="cb-td">' + item.medicineName + '</td>' +
                '<td class="cb-td cb-td-c">' + item.qty + '</td>' +
                '<td class="cb-td cb-td-r">₹' + item.price.toFixed(2) + '</td>' +
                '<td class="cb-td cb-td-r cb-td-bold">₹' + item.amount.toFixed(2) + '</td>' +
                '<td class="cb-td cb-td-c"><button class="cb-rm-btn" onclick="removeCbCartItem(' + i + ')">✕</button></td>' +
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

    function buildCombinedBillHTML() {
        var no      = document.getElementById('cb_no').value      || '___________';
        var dateV   = document.getElementById('cb_date').value    || '';
        var patient = document.getElementById('cb_patient').value || '______________________________';
        var doctor  = document.getElementById('cb_doctor').value  || '—';
        var phone   = document.getElementById('cb_phone').value   || '';
        var trDesc  = document.getElementById('cb_tr_desc').value || '';
        var trAmt   = parseFloat(document.getElementById('cb_tr_amount').value)||0;
        var words   = document.getElementById('cb_tr_words').value|| '';
        var dateStr = dateV ? new Date(dateV).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) : '_______________';
        var phAmt   = _cbCart.reduce(function(s,c){return s+parseFloat(c.amount);},0);
        var grand   = trAmt+phAmt;

        var trDescHtml = trDesc
            ? trDesc.split('\n').map(function(l){return '<div style="padding:4px 0;border-bottom:1px dotted #bbb;">'+(l.trim()||'&nbsp;')+'</div>';}).join('')
            : '<div style="padding:4px 0;border-bottom:1px dotted #bbb;">&nbsp;</div><div style="padding:4px 0;border-bottom:1px dotted #bbb;">&nbsp;</div><div style="padding:4px 0;border-bottom:1px dotted #bbb;">&nbsp;</div>';

        var medRows = _cbCart.length>0 ? _cbCart.map(function(item,i){
            return '<tr style="background:'+(i%2===0?'#fff':'#f8f9fa')+';">' +
                '<td style="padding:7px 10px;border-bottom:1px solid #eee;">'+item.medicineName+'</td>' +
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
        '<div class="tr-amt-row"><span>Treatment Amount</span><span>&#8377;'+trAmt.toFixed(2)+(words?' ('+words+')':'')+'</span></div>' +
        '<div class="sec-hdr">&#9658; PHARMACY / MEDICINES</div>' +
        '<table class="meds"><thead><tr><th>Medicine</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead><tbody>'+medRows+'</tbody></table>' +
        '<div class="summary-box"><table>' +
        '<tr><td style="color:#1e3f5a;">🦷 Treatment Charges</td><td>&#8377;'+trAmt.toFixed(2)+'</td></tr>' +
        '<tr><td style="color:#27ae60;">💊 Pharmacy Charges</td><td>&#8377;'+phAmt.toFixed(2)+'</td></tr>' +
        '<tr class="grand-row"><td><strong>Grand Total</strong></td><td><strong>&#8377;'+grand.toFixed(2)+'</strong></td></tr>' +
        '</table></div>' +
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
            return '<button onclick="document.getElementById(\'cbPmTendered\').value='+v+';calcCbChange();" style="padding:8px 12px;border:1px solid #ddd;border-radius:8px;background:white;font-size:13px;font-weight:700;cursor:pointer;">₹'+v+'</button>';
        }).join('');
        var upiId=(typeof CONFIG!=='undefined'?CONFIG.upiId:'')||'';
        var upiName=(typeof CONFIG!=='undefined'?CONFIG.upiName:'')||'Sri Sai Dental';
        if(upiId.trim()){
            document.getElementById('cbUpiWarn').style.display='none';
            document.getElementById('cbUpiCard').style.display='block';
            document.getElementById('cbUpiAmt').textContent=grand.toFixed(2);
            document.getElementById('cbUpiIdShow').textContent=upiId;
            var lnk='upi://pay?pa='+encodeURIComponent(upiId)+'&pn='+encodeURIComponent(upiName)+'&am='+grand.toFixed(2)+'&cu=INR&tn='+encodeURIComponent('Dental');
            document.getElementById('cbUpiQr').src='https://api.qrserver.com/v1/create-qr-code/?size=200x200&data='+encodeURIComponent(lnk);
        } else {
            document.getElementById('cbUpiWarn').style.display='block';
            document.getElementById('cbUpiCard').style.display='none';
        }
        selectCbMode('Cash');
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
    function calcCbChange(){var total=parseFloat((document.getElementById('cbPmTotal').textContent||'').replace('₹',''))||0;var amt=parseFloat(document.getElementById('cbPmTendered').value)||0;var chg=amt-total;var el=document.getElementById('cbPmChange');el.textContent=chg>=0?'₹'+chg.toFixed(2):'-₹'+Math.abs(chg).toFixed(2);el.style.color=chg>=0?'#27ae60':'#e74c3c';}
    function calcCbSplit(){var total=parseFloat((document.getElementById('cbPmTotal').textContent||'').replace('₹',''))||0;var cash=parseFloat(document.getElementById('cbPmSplitCash').value)||0;var upi=parseFloat(document.getElementById('cbPmSplitUpi').value)||0;var rem=total-cash-upi;var el=document.getElementById('cbSplitSt');if(Math.abs(rem)<0.01){el.textContent='✅ Balanced';el.style.background='#e8f8ee';el.style.color='#27ae60';}else if(rem>0){el.textContent='⚠️ ₹'+rem.toFixed(2)+' still pending';el.style.background='#fff8e1';el.style.color='#e67e22';}else{el.textContent='❌ Overpaid by ₹'+Math.abs(rem).toFixed(2);el.style.background='#fff0f0';el.style.color='#e74c3c';}}
    function confirmCbPayment(){
        var total=parseFloat((document.getElementById('cbPmTotal').textContent||'').replace('₹',''))||0;
        if(_cbMode==='Cash'&&(parseFloat(document.getElementById('cbPmTendered').value)||0)<total){showToast('Amount tendered is less than total','warning');return;}
        if(_cbMode==='Split'){
            var c=parseFloat(document.getElementById('cbPmSplitCash').value)||0;
            var u=parseFloat(document.getElementById('cbPmSplitUpi').value)||0;
            if(Math.abs(c+u-total)>0.5){showToast('Split amounts must add up to total','warning');return;}
        }
        closeCbPayModal();

        var patient = document.getElementById('cb_patient').value || '';
        var doctor  = document.getElementById('cb_doctor').value  || '';
        var phone   = document.getElementById('cb_phone').value   || '';
        var no      = document.getElementById('cb_no').value      || '';
        var dateV   = document.getElementById('cb_date').value    || new Date().toISOString().split('T')[0];
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

        var localBill = {
            billId:      billId,
            patientName: patient,
            doctor:      doctor,
            phone:       phone,
            date:        dateV,
            subtotal:    grand,
            discount:    0,
            total:       grand,       // grand total = treatment + pharmacy
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

        if(window.bills) window.bills.push(localBill);

        // ── Refresh all UI immediately ───────────────────────────
        if(typeof updateDashboard     ==='function') updateDashboard();
        if(typeof updateBillsTable    ==='function') updateBillsTable();
        if(typeof updateInventoryTable==='function') updateInventoryTable();
        if(typeof updateMedicineSelect==='function') updateMedicineSelect();

        // ── Print ────────────────────────────────────────────────
        saveCbRecordToHistory(billId);   // save to history BEFORE printing
        setTimeout(function(){printBillHtml(buildCombinedBillHTML());},200);
        showToast('✅ Dashboard updated! Syncing to Google Sheets...','success');
        // Update receipt no placeholder for next bill
        var cbn = document.getElementById('cb_no');
        if (cbn && typeof peekNextReceiptNo === 'function') {
            cbn.placeholder = 'Next: ' + peekNextReceiptNo() + ' (click Auto)';
        }

        // ── Save to Google Sheets in background ──────────────────
        saveCombinedBillToSheets(_cbMode, billId, dateV, grand, phAmt, costTotal, patient, doctor, phone, no);
    }

    function saveCombinedBillToSheets(payMode, billId, dateV, grand, phAmt, costTotal, patient, doctor, phone, no) {
        if(typeof CONFIG==='undefined'||!CONFIG.apiUrl||CONFIG.apiUrl.includes('YOUR_WEB_APP')){
            showToast('⚠️ Not connected to Google Sheets — bill saved locally only','warning'); return;
        }
        var trDesc  = document.getElementById('cb_tr_desc').value  || '';
        var trAmt   = parseFloat(document.getElementById('cb_tr_amount').value)||0;
        var trWords = document.getElementById('cb_tr_words').value || '';

        // ── 1. Treatment Sheet ────────────────────────────────────
        if (trAmt > 0 || trDesc) {
            var tp = new URLSearchParams();
            tp.append('action',      'saveTreatmentReceipt');
            tp.append('receiptNo',   no);
            tp.append('date',        dateV);
            tp.append('patient',     patient);
            tp.append('amount',      trAmt.toFixed(2));
            tp.append('amountWords', trWords);
            tp.append('treatments',  trDesc);
            fetch(CONFIG.apiUrl + '?' + tp.toString(), {method:'GET', redirect:'follow'})
                .then(function(r){return r.json();})
                .then(function(res){
                    if(res.success) showToast('☁️ Treatment saved to Sheets!','success');
                    else showToast('⚠️ Treatment sheet sync failed','warning');
                })
                .catch(function(){showToast('⚠️ Treatment sheet offline','warning');});
        }

        // ── 2. Bills Sheet + Bill Items Sheet + Stock deduction ───
        if (_cbCart.length > 0) {
            var bp = new URLSearchParams();
            bp.append('action',      'saveBill');
            bp.append('billId',      billId);
            bp.append('patientName', patient);
            bp.append('doctor',      doctor);
            bp.append('phone',       phone);
            bp.append('date',        dateV);
            bp.append('subtotal',    phAmt.toFixed(2));
            bp.append('discount',    '0');
            bp.append('total',       phAmt.toFixed(2));
            bp.append('costTotal',   costTotal.toFixed(2));
            bp.append('paymentMode', payMode);
            bp.append('paymentRef',  '');
            bp.append('items', JSON.stringify(_cbCart.map(function(item){
                var med=(window.medicines||[]).find(function(m){return String(m.id)===String(item.medicineId);});
                return {
                    medicineId:   item.medicineId,
                    medicineName: item.medicineName,
                    qty:          item.qty,
                    price:        item.price,
                    costPrice:    med?parseFloat(med.costPrice||0):0,
                    amount:       item.amount
                };
            })));
            fetch(CONFIG.apiUrl + '?' + bp.toString(), {method:'GET', redirect:'follow'})
                .then(function(r){return r.json();})
                .then(function(res){
                    if(res.success) showToast('☁️ Pharmacy bill saved to Sheets!','success');
                    else showToast('⚠️ Bill sheet sync failed: '+(res.error||''),'warning');
                })
                .catch(function(){showToast('⚠️ Bill sheet offline','warning');});
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
                        '<div class="cb-hist-name">🧾 #' + (r.no||'—') + ' — ' + (r.patient||'—') + (r.doctor?' | '+r.doctor:'') + '</div>' +
                        '<div class="cb-hist-meta">📅 ' + (r.dateStr||r.date||'—') + '</div>' +
                        (trPreview ? '<div class="cb-hist-meta">🦷 ' + trPreview + '</div>' : '') +
                        '<div class="cb-hist-meta">💊 ' + medSummary + '</div>' +
                        '<div class="cb-hist-total">Grand Total: ₹' + parseFloat(r.grand||0).toFixed(2) + '</div>' +
                    '</div>' +
                    '<div class="cb-hist-btns">' +
                        '<button onclick="loadCbRecord('+idx+')" style="background:#2c5aa0;">✏️ Load</button>' +
                        '<button onclick="reprintCbRecord('+idx+')" style="background:#27ae60;">🖨️ Print</button>' +
                        '<button onclick="deleteCbRecord('+idx+')" style="background:#e74c3c;">🗑️</button>' +
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
        var due = _patients.reduce(function(s,p){ return s+parseFloat(p.balance||0); }, 0);
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
                '<td><strong>'+p.name+'</strong>'+(p.age?' <span style="color:#aaa;font-size:12px;">('+p.age+(p.sex?' '+p.sex:'')+')' +'</span>':'')+'</td>'+
                '<td style="white-space:nowrap;">'+( p.phone||'—')+'</td>'+
                '<td style="white-space:nowrap;">'+(p.lastVisit||'—')+'</td>'+
                '<td>'+(p.treatment||'—')+'</td>'+
                '<td style="font-weight:700;color:'+(parseFloat(p.balance||0)>0?'#e74c3c':'#27ae60')+'">₹'+(parseFloat(p.balance||0).toFixed(0))+'</td>'+
                '<td><span class="patient-badge '+sc+'">'+(p.status||'Active')+'</span></td>'+
                '<td style="white-space:nowrap;">' +
                    '<button onclick="sendWaToPatient('+idx+')" style="background:#25d366;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;margin-right:4px;touch-action:manipulation;">📲 WA</button>' +
                    '<button onclick="deletePatient('+idx+')" style="background:#e74c3c;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;touch-action:manipulation;">🗑️</button>' +
                '</td></tr>';
        }).join('') + __lazyMore('patients', __fullList.length, list.length, 7);
        if(cards){
            cards.innerHTML = list.map(function(p,i){
                var idx = _patients.indexOf(p);
                var sc = statusColor[p.status]||'grey';
                var balColor = parseFloat(p.balance||0)>0?'#e74c3c':'#27ae60';
                return '<div class="m-card" style="border-left-color:'+(parseFloat(p.balance||0)>0?'#e74c3c':'#27ae60')+'">' +
                    '<div class="m-card-row"><div class="m-card-title">'+p.name+'</div>' +
                    '<div style="font-weight:900;color:'+balColor+';">₹'+(parseFloat(p.balance||0).toFixed(0))+'</div></div>' +
                    '<div class="m-card-meta">📞 '+(p.phone||'—')+' &nbsp;|&nbsp; <span class="patient-badge '+sc+'">'+(p.status||'Active')+'</span></div>' +
                    '<div class="m-card-meta">🦷 '+(p.treatment||'—')+(p.alerts?' &nbsp;⚠️ '+p.alerts:'')+'</div>' +
                    '<div class="m-card-actions">' +
                        '<button style="background:#25d366;" onclick="sendWaToPatient('+idx+')">📲 WhatsApp</button>' +
                        '<button style="background:#e74c3c;" onclick="deletePatient('+idx+')">🗑️ Delete</button>' +
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
        ['pt_name','pt_phone','pt_age','pt_treatment','pt_alerts'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
        var s=document.getElementById('pt_sex'); if(s) s.value='';
        var d=document.getElementById('pt_doctor'); if(d) d.value='';
        document.getElementById('addPatientModal').classList.add('active');
    }

    function savePatient(){
        var name=(document.getElementById('pt_name').value||'').trim();
        var phone=(document.getElementById('pt_phone').value||'').trim();
        if(!name){ showToast('Enter patient name','warning'); return; }
        var today = new Date().toISOString().split('T')[0];
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
        d.value=cur.toISOString().split('T')[0];
        renderAppointments();
    }

    function renderAppointments(){
        var dateEl=document.getElementById('appt_date');
        var selDate=dateEl?dateEl.value:new Date().toISOString().split('T')[0];
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
                    html+='<div class="appt-slot '+cls+'" onclick="toggleApptStatus(\''+appt.id+'\')">'+
                        '<span class="appt-time">'+time+'</span>'+
                        '<span class="appt-name">'+appt.patient+'</span>'+
                        (appt.reason?'<span class="appt-badge '+bc+'">'+appt.reason+'</span>':'')+
                        '<button onclick="event.stopPropagation();deleteAppt(\''+appt.id+'\')" style="background:none;border:none;color:#aaa;font-size:16px;cursor:pointer;padding:0 4px;touch-action:manipulation;">×</button>'+
                        '</div>';
                } else {
                    html+='<div class="appt-slot free" onclick="quickBookSlot(\''+selDate+'\',\''+time+'\')">'+
                        '<span class="appt-time">'+time+'</span>'+
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
                extraHtml+='<div class="appt-slot '+cls+'" onclick="toggleApptStatus(\''+appt.id+'\')">'+
                    '<span class="appt-time">'+appt.time+'</span>'+
                    '<span class="appt-name">'+appt.patient+'</span>'+
                    (appt.reason?'<span class="appt-badge '+bc+'">'+appt.reason+'</span>':'')+
                    '<button onclick="event.stopPropagation();deleteAppt(\''+appt.id+'\')" style="background:none;border:none;color:#aaa;font-size:16px;cursor:pointer;padding:0 4px;touch-action:manipulation;">×</button>'+
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
        if(d) d.value=cd?cd.value:new Date().toISOString().split('T')[0];
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
        var existing=_appointments.find(function(a){ return a.date===date&&a.time===time&&a.status!=='Cancelled'; });
        if(existing){ showToast('That slot is already booked!','warning'); return; }
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
        var today=new Date().toISOString().split('T')[0];
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
                '<input type="text" id="wa_appt_time" placeholder="e.g. 10:30 AM" style="font-size:16px;" oninput="refreshWaMsg()"></div>' +
                '<div><label style="font-size:12px;">Treatment / Reason</label>' +
                '<input type="text" id="wa_appt_reason" placeholder="e.g. Scaling" oninput="refreshWaMsg()"></div>' +
                '</div>' +
                '<div><label style="font-size:12px;">Doctor</label>' +
                '<select id="wa_appt_doctor" onchange="refreshWaMsg()">' +
                '<option value="Dr. T Sai Vakula">Dr. T Sai Vakula</option>' +
                '<option value="Dr. T Venkat Rao">Dr. T Venkat Rao</option>' +
                '</select></div></div>';
        } else if (tmpl === 'reschedule') {
            extraHtml =
                '<div style="background:#f5eef8;border-radius:8px;padding:12px;margin-bottom:4px;">' +
                '<div style="font-size:12px;font-weight:700;color:#9b59b6;margin-bottom:8px;">Fill reschedule details:</div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;" class="wa-quick-grid">' +
                '<div><label style="font-size:12px;">Doctor</label>' +
                '<select id="wa_rsch_doctor" onchange="refreshWaMsg()">' +
                '<option value="Dr. T Sai Vakula">Dr. T Sai Vakula</option>' +
                '<option value="Dr. T Venkat Rao">Dr. T Venkat Rao</option>' +
                '</select></div>' +
                '<div><label style="font-size:12px;">Original Time *</label>' +
                '<input type="text" id="wa_rsch_time" placeholder="e.g. 11:00 AM" style="font-size:16px;" oninput="refreshWaMsg()"></div>' +
                '</div>' +
                '<div><label style="font-size:12px;">Suggested New Date (optional)</label>' +
                '<input type="text" id="wa_rsch_newdate" placeholder="e.g. Tomorrow 27 May at 10 AM" oninput="refreshWaMsg()"></div></div>';
        } else if (tmpl === 'confirm') {
            extraHtml =
                '<div style="background:#e8f8ee;border-radius:8px;padding:12px;margin-bottom:4px;">' +
                '<div style="font-size:12px;font-weight:700;color:#27ae60;margin-bottom:8px;">Fill booking details:</div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;" class="wa-quick-grid">' +
                '<div><label style="font-size:12px;">Date</label><input type="date" id="wa_conf_date" oninput="refreshWaMsg()"></div>' +
                '<div><label style="font-size:12px;">Time *</label><input type="text" id="wa_conf_time" placeholder="e.g. 10:00 AM" style="font-size:16px;" oninput="refreshWaMsg()"></div>' +
                '<div><label style="font-size:12px;">Doctor</label>' +
                '<select id="wa_conf_doctor" onchange="refreshWaMsg()">' +
                '<option value="Dr. T Sai Vakula">Dr. T Sai Vakula</option>' +
                '<option value="Dr. T Venkat Rao">Dr. T Venkat Rao</option>' +
                '</select></div></div></div>';
        } else if (tmpl === 'payment') {
            extraHtml =
                '<div><label>Balance Amount (Rs.)</label>' +
                '<input type="number" id="wa_pay_amount" placeholder="e.g. 500" inputmode="decimal" oninput="refreshWaMsg()"></div>';
        } else if (tmpl === 'followup') {
            extraHtml =
                '<div><label>Treatment Done</label>' +
                '<input type="text" id="wa_fu_treatment" placeholder="e.g. Root Canal" oninput="refreshWaMsg()"></div>';
        } else if (tmpl === 'patReschedule') {
            extraHtml =
                '<div style="background:#e8f8f5;border-radius:8px;padding:12px;margin-bottom:4px;">' +
                '<div style="font-size:12px;font-weight:700;color:#16a085;margin-bottom:8px;">📅 New appointment details (after patient request):</div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;" class="wa-quick-grid">' +
                '<div><label style="font-size:12px;">New Date</label><input type="date" id="wa_prsch_date" oninput="refreshWaMsg()"></div>' +
                '<div><label style="font-size:12px;">New Time *</label><input type="text" id="wa_prsch_time" placeholder="e.g. 11:00 AM" style="font-size:16px;" oninput="refreshWaMsg()"></div>' +
                '<div><label style="font-size:12px;">Doctor</label>' +
                '<select id="wa_prsch_doctor" onchange="refreshWaMsg()">' +
                '<option value="Dr. T Sai Vakula">Dr. T Sai Vakula</option>' +
                '<option value="Dr. T Venkat Rao">Dr. T Venkat Rao</option>' +
                '</select></div></div></div>';
        } else if (tmpl === 'custom') {
            extraHtml =
                '<div><label>Your Message</label>' +
                '<textarea id="wa_custom_msg" rows="4" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;font-family:inherit;" placeholder="Type your message here..." oninput="refreshWaMsg()"></textarea></div>';
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
        localStorage.setItem('wa_sent_date',new Date().toISOString().split('T')[0]);
        updateWaStats();
        openWhatsApp(phone, msg);
    }

    function renderWaTodayList(){
        var el=document.getElementById('wa_today_list'); if(!el) return;
        var today=new Date().toISOString().split('T')[0];
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
                        '<div style="font-weight:700;font-size:14px;color:#1e3f5a;">'+a.patient+'</div>' +
                        '<div style="font-size:12px;color:#777;margin-top:2px;">'+a.time+(a.reason?' — '+a.reason:'')+(a.doctor?' | '+a.doctor:'')+'</div>' +
                        (!hasPhone?'<div style="font-size:11px;color:#e74c3c;margin-top:2px;">⚠️ No phone saved</div>':'') +
                    '</div>' +
                    '<div style="display:flex;gap:5px;flex-wrap:wrap;">' +
                        '<button style="'+btnStyle+'background:#e67e22;" onclick="sendApptWaTemplate(\''+a.id+'\',\'24h\')">⏰ 24h</button>' +
                        '<button style="'+btnStyle+'background:#e74c3c;" onclick="sendApptWaTemplate(\''+a.id+'\',\'1h\')">🔔 1h</button>' +
                        '<button style="'+btnStyle+'background:#9b59b6;" onclick="sendApptWaTemplate(\''+a.id+'\',\'reschedule\')">🔄 Reschedule</button>' +
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
        localStorage.setItem('wa_sent_date',new Date().toISOString().split('T')[0]);
        updateWaStats();
        openWhatsApp(phone, msg);
        showToast('✅ Message copied! Opening WhatsApp for '+a.patient,'success');
    }

    function sendAllReminders(type) {
        var today = new Date().toISOString().split('T')[0];
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
        localStorage.setItem('wa_sent_date',new Date().toISOString().split('T')[0]);
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
        var today   = new Date().toISOString().split('T')[0];

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

            var safeId = a.id.replace(/'/g,"\\'");

            return '<div onclick="waFillFromAppt(\''+safeId+'\')" style="border:1.5px solid '+borderColor+';border-radius:10px;padding:11px 12px;margin-bottom:8px;background:'+bgColor+';cursor:pointer;">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">' +
                    '<div style="flex:1;min-width:0;">' +
                        '<div style="font-weight:700;font-size:14px;color:#1e3f5a;margin-bottom:2px;">'+a.patient+' '+statusBadge+'</div>' +
                        '<div style="font-size:12px;color:#555;">📅 '+dateStr+' &nbsp;🕐 '+a.time+(a.reason?' &nbsp;🦷 '+a.reason:'')+'</div>' +
                        '<div style="font-size:12px;color:#777;margin-top:1px;">'+(a.doctor?'👨‍⚕️ '+a.doctor+' &nbsp;':'')+(!hasPhone?'<span style="color:#e74c3c;">⚠️ No phone</span>':'📞 '+a.phone)+'</div>' +
                    '</div>' +
                    '<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;max-width:120px;" onclick="event.stopPropagation();">' +
                        (hasPhone ?
                            '<button onclick="waQuickSend(\''+safeId+'\',\'confirm\')" style="padding:5px 9px;background:#27ae60;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">✅ Confirm</button>' +
                            '<button onclick="waQuickSend(\''+safeId+'\',\'reminder24\')" style="padding:5px 9px;background:#e67e22;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">⏰ 24h</button>' +
                            '<button onclick="waQuickSend(\''+safeId+'\',\'reminder1h\')" style="padding:5px 9px;background:#e74c3c;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">🔔 1h</button>' +
                            '<button onclick="waQuickSend(\''+safeId+'\',\'reschedule\')" style="padding:5px 9px;background:#9b59b6;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">🔄 Reschedule</button>' +
                            '<button onclick="waQuickSend(\''+safeId+'\',\'patReschedule\')" style="padding:5px 9px;background:#16a085;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">📅 Pat.Rsch</button>' +
                            '<button onclick="waOpenPopupForAppt(\''+safeId+'\')" style="padding:5px 9px;background:#2c5aa0;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">✏️ Custom</button>' +
                            '<button onclick="sendClinicLocation(\''+safeId+'\')" style="padding:5px 9px;background:#1abc9c;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">📍 Location</button>'
                        : '') +
                        '<button onclick="deleteAppointmentFromWa(\''+safeId+'\')" style="padding:5px 9px;background:#c0392b;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">🗑️ Delete</button>' +
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
        localStorage.setItem('wa_sent_date',new Date().toISOString().split('T')[0]);
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
        localStorage.setItem('wa_sent_date', new Date().toISOString().split('T')[0]);
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
        // Save to history
        _efHistory.push(d);
        saveEfHistory();
        renderEfHistory();
        // Sync to Google Sheets
        if (window.CONFIG && CONFIG.apiUrl && !CONFIG.apiUrl.includes('YOUR_WEB_APP')) {
            var p = new URLSearchParams();
            p.append('action','saveExamForm');
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
                    '<div class="ef-hist-name">🦷 '+(d.patient||'—')+'</div>' +
                    '<div class="ef-hist-meta">📅 '+dateStr+(d.doctor?' | 👨‍⚕️ '+d.doctor:'')+'</div>' +
                    '<div class="ef-hist-meta">📋 '+tpSummary+'</div>' +
                '</div>' +
                '<div class="ef-hist-btns">' +
                    '<button style="background:#2c5aa0;" onclick="loadEfRecord('+idx+')">✏️ Load</button>' +
                    '<button style="background:#27ae60;" onclick="reprintEfRecord('+idx+')">🖨️ Print</button>' +
                    '<button style="background:#e74c3c;" onclick="deleteEfRecord('+idx+')">🗑️</button>' +
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
                btBtn.innerHTML = '🔵 Thermal Print<br><span style="font-size:11px;opacity:0.85;">80mm · '+name+'</span>';
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
        html=html.replace(/&#8377;/g,'Rs.').replace(/\u20b9/g,'Rs.')
                 .replace(/&amp;/g,'&').replace(/&nbsp;/g,' ')
                 .replace(/&lt;/g,'<').replace(/&gt;/g,'>');

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
        if(grandTotal>0){
            var C=[ESC,0x61,0x01];  // center command bytes
            out=out.concat(C); out=out.concat(_dbl());
            out=out.concat(C); out=out.concat(_bOn()); out=out.concat(_b('SCAN & PAY\n')); out=out.concat(_bOff());
            out=out.concat(_nl());
            out=out.concat(C); out=out.concat(_upiQR('8688033072@ybl',grandTotal,'SriSaiDental',4));
            out=out.concat(_nl());
            // CENTER → font → CENTER again → text (double-ensures alignment)
            out=out.concat(C); out=out.concat([ESC,0x21,0x10]); out=out.concat(C); out=out.concat(_bOn());
            out=out.concat(_b('Rs.'+grandTotal.toFixed(2)+'\n'));
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

  // ── First-time setup: Apps Script link (kept off GitHub) ──────────
  function hasApiUrl() {
    try { return !!(JSON.parse(localStorage.getItem('medistock_config') || '{}').apiUrl); }
    catch (e) { return false; }
  }
  function askApiUrl() {
    var url = (prompt('First-time setup on this device:\n\nPaste your Google Apps Script Web App link\n(ends with /exec).\nYou only need to do this once per phone/computer.') || '').trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
      if (url) alert('That does not look like an Apps Script link (https://script.google.com/macros/s/.../exec). You can set it later in Settings.');
      return;
    }
    var cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('medistock_config') || '{}'); } catch (e) {}
    cfg.apiUrl = url;
    localStorage.setItem('medistock_config', JSON.stringify(cfg));
  }
  if (typeof window.initApp === 'function') {
    var _init = window.initApp;
    window.initApp = function () {
      if (!hasApiUrl()) askApiUrl();
      return _init.apply(this, arguments);
    };
  }

  // ── Service worker ────────────────────────────────────────────────
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
;
