// The website loads js/app.min.js. This fails if someone edited js/app.js and forgot `npm run build`.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
test('js/app.min.js is built from the current js/app.js', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const min = fs.readFileSync(path.join(ROOT, 'js', 'app.min.js'), 'utf8');
  const hash = crypto.createHash('sha256').update(src).digest('hex').slice(0, 16);
  assert.ok(min.startsWith('/* SSDC app — built from js/app.js (source ' + hash + ')'), 'run: npm run build');
});
test('index.html, service worker and Android build all use the minified file', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const www = fs.readFileSync(path.join(ROOT, 'android-app', 'scripts', 'build-www.mjs'), 'utf8');
  assert.match(html, /<script defer src="js\/app\.min\.js"><\/script>/);
  assert.ok(!/src="js\/app\.js"/.test(html));
  assert.match(sw, /"js\/app\.min\.js"/);
  assert.match(www, /app\.min\.js/);
});
