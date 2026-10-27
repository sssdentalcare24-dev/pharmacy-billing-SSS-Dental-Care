// Tests for the Android app build (android-app/www) and its native bridge,
// run in Chromium with simulated Android plugins and the real Code.gs backend.
//   cd android-app && npm run build:www && npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const esbuild = require('esbuild');
const { createGas, legacyData } = require('../../tests/gas-mock');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }

const WWW = path.join(__dirname, '..', 'www');
const SS = '1rOwubjghrsuWiGXR8X1A1841_8yd-cmMQIj44QBqNaA';
const API = 'https://script.google.com/macros/s/AKfycbTESTDEPLOYMENT/exec';
const SHIMS = esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'web-shims.js')], bundle: true, format: 'iife', globalName: 'SSDCShims', write: false }).outputFiles[0].text;

async function waitUntil(page, fn, arg, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await page.evaluate(fn, arg)) return; } catch (e) {} await new Promise(r => setTimeout(r, 200)); }
  throw new Error('timed out: ' + fn.toString().slice(0, 100));
}

async function setup() {
  const g = createGas(); g.addSpreadsheet(SS, legacyData()); g.run('migrateToV3');
  const temp = {}; g.logs.join('\n').replace(/(owner|staff)\s*:\s*(\S+)/g, (_, u, p) => { temp[u] = p; });
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.png': 'image/png', '.webp': 'image/webp' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(WWW, p);
    if (!f.startsWith(WWW) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  });
  await new Promise(r => srv.listen(0, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept(/Apps Script Web App link/.test(d.message()) ? API : undefined));
  await page.route(/script\.google\.com/, route => {
    const body = JSON.parse(route.request().postData() || '{}');
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(g.post(body)) });
  });
  await page.goto(`http://localhost:${srv.address().port}/`);
  await page.evaluate(SHIMS);   // DevTools evaluation, like Capacitor's own injected bridge: not an inline <script>, so the strict CSP stays on
  // login (owner) with forced password change
  await page.fill('#loginUsername', 'owner'); await page.fill('#loginPassword', temp.owner); await page.click('.login-btn');
  await page.waitForSelector('#cpOld');
  await page.fill('#cpOld', temp.owner); await page.fill('#cpNew', 'Clinic#Owner2026'); await page.fill('#cpNew2', 'Clinic#Owner2026');
  await page.click('#ssdcDialog button:has-text("Save password")');
  await waitUntil(page, () => window.API && API.lastSync > 0 && !document.getElementById('ssdcDialog'));
  return { g, page, errors, close: async () => { await browser.close(); srv.close(); } };
}

test('app build loads in a normal browser without errors (native bridge stays off)', async () => {
  const t = await setup();
  try {
    assert.equal(await t.page.evaluate(() => !!window.SSDC_NATIVE), false);
    assert.equal(await t.page.evaluate(() => medicines.length), 3);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('thermal printer: the app\'s own Bluetooth code works through the native BLE bridge', async () => {
  const t = await setup();
  try {
    const r = await t.page.evaluate(async () => {
      const log = { writes: 0, bytes: 0, withoutResponse: 0, init: 0 };
      let onDisconnect = null;
      const mockBle = {   // what @capacitor-community/bluetooth-le returns on Android
        initialize: async (o) => { log.init++; log.neverForLocation = o.androidNeverForLocation; },
        requestDevice: async (o) => { log.optionalServices = o.optionalServices; return { deviceId: 'DC:0D:30:AA:BB:CC', name: 'RPP02N' }; },
        connect: async (id, cb) => { onDisconnect = cb; },
        getServices: async () => [
          { uuid: '0000180a-0000-1000-8000-00805f9b34fb', characteristics: [{ uuid: '00002a29-0000-1000-8000-00805f9b34fb', properties: { read: true } }] },
          { uuid: '000018f0-0000-1000-8000-00805f9b34fb', characteristics: [{ uuid: '00002af1-0000-1000-8000-00805f9b34fb', properties: { write: true, writeWithoutResponse: true } }] }],
        write: async (id, s, c, dv) => { log.writes++; log.bytes += dv.byteLength; },
        writeWithoutResponse: async (id, s, c, dv) => { log.withoutResponse++; log.bytes += dv.byteLength; log.lastService = s; },
        disconnect: async () => {},
      };
      Object.defineProperty(navigator, 'bluetooth', { value: SSDCShims.makeWebBluetooth(mockBle), configurable: true });
      await btScanAndConnect();
      const connected = window._btPrinter.connected;
      await btTestPrint();
      onDisconnect('DC:0D:30:AA:BB:CC');
      return { log, connected, name: window._btPrinter.deviceName, afterDisconnect: window._btPrinter.connected };
    });
    assert.equal(r.connected, true); assert.equal(r.name, 'RPP02N');
    assert.equal(r.log.neverForLocation, true, 'no location permission needed');
    assert.ok(r.log.optionalServices.includes('000018f0-0000-1000-8000-00805f9b34fb'));
    assert.ok(r.log.bytes > 200, 'receipt bytes sent: ' + r.log.bytes);
    assert.equal(r.log.lastService, '000018f0-0000-1000-8000-00805f9b34fb');
    assert.equal(r.afterDisconnect, false, 'app notices the printer switching off');
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('printing A4 bills goes to the native print module', async () => {
  const t = await setup();
  try {
    const html = await t.page.evaluate(async () => {
      let got = null; window.ssdcNativePrint = (h) => { got = h; };
      _doPrintRegular('<p>Test bill ₹30</p>');
      return got;
    });
    assert.match(html, /<!DOCTYPE html>/); assert.match(html, /Test bill ₹30/);
    assert.equal(await t.page.evaluate(() => !!document.getElementById('__printIframe')), false, 'no browser print attempted');
  } finally { await t.close(); }
});

test('CSV downloads become a shared file; Back button closes things in the right order', async () => {
  const t = await setup();
  try {
    const share = await t.page.evaluate(async () => {
      const calls = {};
      const handler = SSDCShims.makeDownloadHandler(
        { writeFile: async (o) => { calls.write = o; return { uri: 'file:///cache/' + o.path }; } },
        { share: async (o) => { calls.share = o; } }, SSDCShims.makeBlobReader(window));
      const orig = HTMLAnchorElement.prototype.click;
      let done; const finished = new Promise(r => { done = r; });
      HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) { handler(this.href, this.getAttribute('download')).then(done); return; } return orig.call(this); };
      downloadReport('Medicine,Qty\nParacetamol,5', 'Medicine Report.csv');
      await finished;
      return calls;
    });
    assert.equal(share.write.data, 'Medicine,Qty\nParacetamol,5'); assert.equal(share.write.path, 'Medicine_Report.csv');
    assert.deepEqual(share.share.files, ['file:///cache/Medicine_Report.csv']);
    assert.equal(share.write.encoding, 'utf8');
    // Excel (.xlsx) exports are binary: written byte-for-byte (base64, no text encoding) — a real zip
    const xl = await t.page.evaluate(async () => {
      const calls = {};
      const handler = SSDCShims.makeDownloadHandler(
        { writeFile: async (o) => { calls.write = o; return { uri: 'file:///cache/' + o.path }; } },
        { share: async (o) => { calls.share = o; } }, SSDCShims.makeBlobReader(window));
      const orig = HTMLAnchorElement.prototype.click;
      let done; const finished = new Promise(r => { done = r; });
      HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) { handler(this.href, this.getAttribute('download')).then(done); return; } return orig.call(this); };
      try { V31.xlsx.download('Test Report.xlsx', [{ name: 'Sheet', rows: [['Medicine', 'Qty'], ['Paracetamol', 5]] }]); await finished; }
      finally { HTMLAnchorElement.prototype.click = orig; }
      const bin = atob(calls.write.data);
      return { encoding: calls.write.encoding, path: calls.write.path, magic: bin.slice(0, 2), size: bin.length };
    });
    assert.equal(xl.encoding, undefined); assert.equal(xl.path, 'Test_Report.xlsx'); assert.equal(xl.magic, 'PK'); assert.ok(xl.size > 300);

    const steps = await t.page.evaluate(() => {
      const out = [];
      showPage('inventory'); openStockDialog(String(medicines[0].id));
      out.push(SSDCShims.handleBack(document, window));                    // dialog
      document.getElementById('addMedicineModal').classList.add('active');
      out.push(SSDCShims.handleBack(document, window));                    // modal
      out.push(SSDCShims.handleBack(document, window));                    // inventory → dashboard
      out.push(document.querySelector('.page.active').id);
      out.push(SSDCShims.handleBack(document, window));                    // on home → leave app
      return out;
    });
    assert.deepEqual(steps, ['dialog', 'modal', 'home', 'dashboard', 'exit']);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
