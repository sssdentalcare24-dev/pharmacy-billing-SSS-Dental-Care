// Copies the website (repository root) into www/ for the Android app.
// Run after any change to the website:  npm run sync
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');          // android-app/
const site = join(app, '..');          // repository root = the website
const www = join(app, 'www');

rmSync(www, { recursive: true, force: true });
mkdirSync(join(www, 'js'), { recursive: true });
if (!existsSync(join(site, 'js', 'app.min.js'))) throw new Error('js/app.min.js missing — run "npm run build" in the repository root first');
cpSync(join(site, 'js', 'app.min.js'), join(www, 'js', 'app.min.js'));
cpSync(join(site, 'assets'), join(www, 'assets'), { recursive: true });
cpSync(join(site, 'manifest.webmanifest'), join(www, 'manifest.webmanifest'));

// Native bridge (Bluetooth printer, printing, sharing files, back button) — bundled with esbuild
await build({
  entryPoints: [join(app, 'src', 'native-bridge.js')],
  bundle: true, format: 'iife', minify: true, target: ['chrome110'],
  outfile: join(www, 'js', 'native.js'), legalComments: 'none',
});

// The clinic's Apps Script link, built into the APK so phones never ask for it.
// Kept OUT of git: android-app/api-url.txt (one line) or the SSDC_API_URL environment variable.
const urlFile = join(app, 'api-url.txt');
const apiUrl = (process.env.SSDC_API_URL || (existsSync(urlFile) ? readFileSync(urlFile, 'utf8') : '')).trim();
if (apiUrl && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(apiUrl)) throw new Error('api-url.txt: not an Apps Script /exec link: ' + apiUrl);
const boot = 'window.SSDC_APP_BUILD = true;' + (apiUrl ? ' window.SSDC_API_URL = ' + JSON.stringify(apiUrl) + ';' : '');

let html = readFileSync(join(site, 'index.html'), 'utf8');
const appTag = '<script defer src="js/app.min.js"></script>';
if (!html.includes(appTag)) throw new Error('index.html: app.min.js script tag not found');
html = html
  .replace(appTag, '<script defer src="js/native.js"></script>\n    ' + appTag)          // native bridge loads first
  .replace('<head>', '<head>\n    <script>' + boot + '</script>')                            // app copy: no website service worker (+ built-in server link)
  .replace(', viewport-fit=cover', '')                                                     // keep content below the status bar
  .replace('<link rel="manifest" href="manifest.webmanifest">', '');                        // not needed inside the app
writeFileSync(join(www, 'index.html'), html);

if (!existsSync(join(www, 'index.html'))) throw new Error('build failed');
console.log('www/ ready: index.html, js/app.min.js, js/native.js, assets/' + (apiUrl ? ' · server link built in' : ' · no server link (phones will ask once)'));
