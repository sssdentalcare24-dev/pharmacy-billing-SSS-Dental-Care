// Production build: js/app.js (the source you edit) → js/app.min.js (what the website loads).
//   npm run build        — run after every change to js/app.js, then commit both files.
// Only whitespace, syntax and LOCAL variable names are shortened. Top-level function and
// variable names stay exactly as they are, because buttons call them by name
// (data-onclick="saveBill()") and other code reaches them through window.
import { transform } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'js', 'app.js'), 'utf8');
const srcHash = createHash('sha256').update(src).digest('hex').slice(0, 16);

const out = await transform(src, {
  loader: 'js',
  minify: true,            // no "format": the file stays a classic script, so top-level names are kept
  target: 'esnext',        // keep the syntax the source already uses (no down-levelling)
  legalComments: 'none',
  charset: 'utf8',
});
if (out.warnings.length) console.warn(out.warnings);
const code = '/* SSDC app — built from js/app.js (source ' + srcHash + '). Do not edit; run npm run build. */\n' + out.code;
writeFileSync(join(root, 'js', 'app.min.js'), code);
console.log('js/app.min.js: ' + (src.length / 1024).toFixed(0) + ' KB → ' + (code.length / 1024).toFixed(0) + ' KB (source ' + srcHash + ')');
