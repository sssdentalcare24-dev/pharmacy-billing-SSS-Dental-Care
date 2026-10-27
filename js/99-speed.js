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
