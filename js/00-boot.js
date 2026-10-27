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
