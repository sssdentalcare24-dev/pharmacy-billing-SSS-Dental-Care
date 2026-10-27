// Finds every data-on* handler in index.html and in the HTML that js/app.js builds,
// with the concatenated/templated parts replaced by sample values.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

function handlersFromHtml(html) {
  html = html || fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/\sdata-on([a-z]+)="([^"]*)"/g)].map(m => m[2]);
}
function handlersFromApp(app) {
  app = app || fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const out = [];
  for (const m of app.matchAll(/\sdata-on[a-z]+=(\\?["'])/g)) {
    const q = m[1];
    const rest = app.slice(m.index + m[0].length);
    const stop = q === '\\"' ? rest.indexOf('\\"') : rest.indexOf(q);
    let code = rest.slice(0, stop);
    if (q === '"') {
      code = code.replace(/\\''\s*\+[^+]+?\+\s*'\\'/g, "'X'")      // \'' + id + '\'  → 'X'
                 .replace(/'\s*\+[^+]+?\+\s*'/g, '1')               // ' + idx + '     → 1
                 .replace(/\\'/g, "'");
    }
    code = code.replace(/\$\{esc\([^}]*\)\}/g, 'X').replace(/\$\{printFn\}|\$\{waFn\}/g, "reprrintBill('X')").replace(/\$\{[^}]*\}/g, '1');
    out.push(code);
  }
  return out;
}
module.exports = { handlersFromHtml, handlersFromApp };
