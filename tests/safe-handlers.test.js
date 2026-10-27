// Safe handlers (data-on*): every handler in the app parses, and the interpreter refuses anything
// outside its narrow shape. The browser test (e2e-v31) checks the same rules in a real Chromium
// with the real Content-Security-Policy.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function loadModule() {
  const start = app.indexOf(';/* ══ FILE: 00c-safe-handlers.js');
  const end = app.indexOf(';/* ══ FILE: 01-core.js');
  assert.ok(start > 0 && end > start, 'safe handler section present');
  const listeners = {};
  function Element() {}
  function CSSStyleDeclaration() {}
  const win = {
    console, setTimeout: (f) => { try { f(); } catch (e) { win.__lastError = e; } },
    Element, CSSStyleDeclaration,
    document: { addEventListener: (t, f) => { listeners[t] = f; }, getElementById: null },
    calls: [],
  };
  win.window = win;
  win.document.defaultView = win;
  // app functions (user-defined → allowed)
  win.saveBill = function (a, b) { win.calls.push(['saveBill', a, b]); return 'ok'; };
  win.API = { queue: { flush(x) { win.calls.push(['flush', x]); return { then(f) { f(); } }; } } };
  win.openSyncCentre = function () { win.calls.push(['sync']); };
  win.nativeThing = Math.max;     // a browser (native) function that is NOT allow-listed
  vm.createContext(win);
  vm.runInContext(app.slice(start, end), win);
  return { win, listeners, SH: win.SafeHandlers };
}

const { handlersFromHtml, handlersFromApp } = require('./handlers-extract');

test('every data-on* handler in index.html and app.js parses', () => {
  const { SH } = loadModule();
  const all = handlersFromHtml().concat(handlersFromApp());
  assert.ok(all.length > 250, 'found ' + all.length + ' handlers');
  const bad = [];
  for (const code of all) { try { SH.parse(code); } catch (e) { bad.push(code + '  →  ' + e.message); } }
  assert.deepStrictEqual(bad, []);
});

test('no inline handlers, javascript: URLs or unsafe-inline scripts are left', () => {
  assert.ok(!/\son(click|input|change|keydown|focus|blur|toggle|touchend|load|error)\s*=\s*["']/.test(html), 'index.html');
  assert.ok(!/\son(click|input|change|keydown|focus|blur|toggle|touchend|load|error)=\\?["']/.test(app), 'app.js');
  assert.ok(!/javascript:/i.test(html) && !/href=\\?["']javascript:/i.test(app));
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  const scriptSrc = csp.split(';').map(s => s.trim()).find(s => s.startsWith('script-src'));
  assert.ok(!/unsafe-inline|unsafe-eval/.test(scriptSrc), scriptSrc);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  // the one inline script matches its hash
  const crypto = require('node:crypto');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.strictEqual(inline.length, 1);
  const h = crypto.createHash('sha256').update(inline[0], 'utf8').digest('base64');
  assert.ok(scriptSrc.includes("'sha256-" + h + "'"), 'hash of the inline script is in script-src');
});

test('interpreter runs the allowed shapes', () => {
  const { win, SH } = loadModule();
  const el = new win.Element(); el.value = '42'; el.parentNode = { open: false };
  SH.exec("saveBill('a', this.value)", el, {});
  SH.exec('if(!this.parentNode.open)saveBill(1, true)', el, {});
  SH.exec("if(1===2){saveBill('no')}else saveBill('yes')", el, {});
  SH.exec('API.queue.flush(true).then(openSyncCentre)', el, {});
  SH.exec("saveBill(event.key==='Enter' ? 'go' : 'stop', -5)", el, { key: 'Enter' });
  assert.deepStrictEqual(win.calls, [['saveBill', 'a', '42'], ['saveBill', 1, true], ['saveBill', 'yes', undefined],
    ['flush', true], ['sync'], ['saveBill', 'go', -5]]);
});

test('interpreter refuses code outside its shape', () => {
  const { win, SH } = loadModule();
  const el = new win.Element(); el.value = 'x';
  const refused = [
    "eval('saveBill(1)')", "Function('x')()", "setTimeout('saveBill(1)')", "fetch('https://evil.example')",
    'saveBill.constructor("x")()', 'this.__proto__.x', "location.href='https://evil.example'",
    "this.innerHTML='<img>'", "document.cookie", 'function(){}', 'new saveBill()', 'nativeThing(1)',
    "saveBill(nativeThing)", "this.onclick=saveBill", "this.href='x'", "window.location='x'",
    "a = 1", "saveBill(1) saveBill(2)", "saveBill(`x`)", "saveBill(1+1)", "x[0]",
  ];
  for (const code of refused) {
    win.calls.length = 0; win.__lastError = null;
    let parsed = true;
    try { SH.parse(code); } catch (e) { parsed = false; }
    if (parsed) {
      SH.exec(code, el, {});
      assert.ok(win.__lastError, 'should be refused at run time: ' + code);
    }
    assert.strictEqual(win.calls.length, 0, 'nothing ran for: ' + code);
  }
});
