// Shared browser-test helpers: static server for the app, the real Code.gs answering
// every Google request on simulated Google services, login + billing shortcuts.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGas, legacyData } = require('./gas-mock');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))); }

const ROOT = path.join(__dirname, '..');
const SS = '1rOwubjghrsuWiGXR8X1A1841_8yd-cmMQIj44QBqNaA';
const API = 'https://script.google.com/macros/s/AKfycbTESTDEPLOYMENT/exec';
const OWNER_PW = 'Clinic#Owner2026', STAFF_PW = 'Reception#2026';

function staticServer() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    // CSP comes from the <meta> tag in index.html, exactly as on GitHub Pages
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  });
  return new Promise(r => srv.listen(0, () => r(srv)));
}

// Polls with separate evaluate() calls — robust while alert() popups open and close.
async function waitUntil(page, fn, arg, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await page.evaluate(fn, arg)) return; } catch (e) {} await new Promise(r => setTimeout(r, 200)); }
  const state = await page.evaluate(() => ({ loginHidden: document.getElementById('loginScreen').classList.contains('hidden'),
    loginError: document.getElementById('loginError').textContent, loginErrShown: document.getElementById('loginError').style.display,
    dialog: (document.getElementById('ssdcDialog') || {}).innerText, cpMsg: (document.getElementById('cpMsg') || {}).textContent,
    session: sessionStorage.getItem('ssdc_session'), btn: (document.querySelector('.login-btn') || {}).textContent })).catch(e => 'state error ' + e.message);
  throw new Error('waitUntil timed out: ' + fn.toString().slice(0, 120) + '\nSTATE ' + JSON.stringify(state));
}

async function setup(viewport, opts) {
  opts = opts || {};
  const g = createGas(); g.addSpreadsheet(SS, opts.data ? opts.data() : legacyData()); g.run('migrateToV3');
  const temp = {}; g.logs.join('\n').replace(/(owner|staff)\s*:\s*(\S+)/g, (_, u, p) => { temp[u] = p; });
  if (opts.v31) g.run('migrateToV31');
  const srv = await staticServer();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: viewport || { width: 1300, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [], dialogs = [], answers = [];
  let offline = false, tamper = null;
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('console', m => { if (/Content Security Policy|Refused to/.test(m.text())) errors.push('CSP: ' + m.text()); });
  page.on('dialog', async d => {
    dialogs.push(d.message());
    if (/Apps Script Web App link/.test(d.message())) return d.accept(API);
    const a = answers.length ? answers.shift() : null;
    if (a === false) return d.dismiss();
    return d.accept(typeof a === 'string' ? a : undefined);
  });
  await ctx.route(/script\.google\.com/, async route => {
    const req = route.request();
    if (offline) return route.abort('internetdisconnected');
    let out;
    if (req.method() === 'POST') { let body = JSON.parse(req.postData()); if (tamper) body = tamper(body) || body; out = g.post(body); }
    else out = g.get(Object.fromEntries(new URL(req.url()).searchParams));
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(out) });
  });
  await page.goto(`http://localhost:${srv.address().port}/`);
  const t = {
    g, temp, page, errors, dialogs, answers,
    setOffline: v => { offline = v; return page.evaluate(v => window.dispatchEvent(new Event(v ? 'offline' : 'online')), v); },
    setTamper: fn => { tamper = fn; },
    rows: n => g.spreadsheets[SS].getSheetByName(n).rows.filter(r => r && r.some(v => v !== '' && v != null)),
    close: async () => { await browser.close(); srv.close(); },
    async login(user, pw, newPw) {
      await page.fill('#loginUsername', user); await page.fill('#loginPassword', pw); await page.click('.login-btn');
      if (newPw) {
        await page.waitForSelector('#cpOld');
        await page.fill('#cpOld', pw); await page.fill('#cpNew', newPw); await page.fill('#cpNew2', newPw);
        await page.click('#ssdcDialog button:has-text("Save password")');
      }
      await waitUntil(page, () => document.getElementById('loginScreen').classList.contains('hidden') && !document.getElementById('ssdcDialog'));
      await waitUntil(page, () => window.API && API.lastSync > 0);
    },
    async addToCart(name, qty) {
      const id = await page.evaluate(n => (medicines.find(m => m.name === n) || {}).id, name);
      await page.selectOption('#medicineSelect', String(id)); await page.fill('#medicineQty', String(qty));
      await page.evaluate(() => addMedicineToCart());
    },
    async payCash(patient, discountPct) {
      await page.fill('#patientName', patient);
      if (discountPct !== undefined) { await page.fill('#discountPct', String(discountPct)); await page.evaluate(() => recalc()); }
      await page.evaluate(() => openPaymentModal(false));
      const total = await page.evaluate(() => parseFloat(document.getElementById('pmTotal').textContent.replace('₹', '')));
      await page.fill('#pmTendered', String(Math.ceil(total))); await page.evaluate(() => confirmPayment());
      return total;
    },
  };
  return t;
}

module.exports = { setup, waitUntil, staticServer, ROOT, SS, API, OWNER_PW, STAFF_PW };
