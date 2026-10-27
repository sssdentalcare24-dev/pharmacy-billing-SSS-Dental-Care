// ════════════════════════════════════════════════════════════════════
// Native bridge for the Android app (Capacitor). Bundled into www/js/native.js
// by scripts/build-www.mjs and loaded BEFORE js/app.js. On the website
// (not inside the app) it does nothing.
//
// Android's in-app browser (WebView) lacks a few things a desktop/Chrome
// browser has. This file fills those gaps without changing how the app works:
//   1. Web Bluetooth (thermal printer)  → @capacitor-community/bluetooth-le
//   2. Printing (A4 bills, Rx, receipts) → our HtmlPrinter plugin (Android Print / Save as PDF)
//   3. CSV downloads (reports, expenses) → saved to cache + Android share sheet
//   4. WhatsApp / UPI / web links        → opened in the right Android app
//   5. Android Back button               → closes popups/menu first, then goes to the home page
// ════════════════════════════════════════════════════════════════════
import { Capacitor, registerPlugin } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { App } from '@capacitor/app';
import { AppLauncher } from '@capacitor/app-launcher';
import { Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const HtmlPrinter = registerPlugin('HtmlPrinter');

import { makeWebBluetooth, makeBlobReader, makeDownloadHandler, handleBack } from './web-shims.js';

// ── install (only inside the Android app) ────────────────────────────
function install() {
  const win = window;
  win.SSDC_NATIVE = true;

  // 1. Bluetooth
  try { Object.defineProperty(navigator, 'bluetooth', { value: makeWebBluetooth(BleClient), configurable: true }); }
  catch (e) { console.error('BLE bridge', e); }

  // 2. Printing — js/app.js calls window.ssdcNativePrint(fullHtml) when it exists
  win.ssdcNativePrint = (fullHtml, title) =>
    HtmlPrinter.print({ html: fullHtml, name: title || 'Sri Sai Speciality Dental Care' })
      .catch((e) => win.showToast && win.showToast('Printing failed: ' + (e.message || e), 'error'));
  // the fallback print overlay's "Print / Save PDF" button calls window.print()
  win.print = () => {
    const m = document.getElementById('__printModal');
    const html = m ? m.innerHTML.replace(/<div class="no-print"[\s\S]*?<\/div>/, '') : document.documentElement.outerHTML;
    return win.ssdcNativePrint('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' + html + '</body></html>');
  };

  // 3. Downloads
  const shareDownload = makeDownloadHandler(Filesystem, Share, makeBlobReader(win));
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const href = this.href || '';
    if (this.hasAttribute('download') && (href.startsWith('blob:') || href.startsWith('data:'))) {
      shareDownload(href, this.getAttribute('download')).catch((e) => win.showToast && win.showToast('Could not share file: ' + (e.message || e), 'error'));
      return;
    }
    return origClick.call(this);
  };

  // 4. Links: wa.me, maps, upi://, tel:, http(s) → the matching Android app / browser
  const openExternal = (url) => AppLauncher.openUrl({ url: String(url) }).catch(() => {});
  win.open = (url) => { if (url) openExternal(url); return null; };
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download')) return;
    const href = a.getAttribute('href') || '';
    if (/^(https?:|upi:|tel:|mailto:|whatsapp:|geo:)/i.test(href) && !href.startsWith(location.origin)) {
      e.preventDefault(); openExternal(a.href);
    }
  }, true);

  // 5. Back button
  App.addListener('backButton', () => {
    if (handleBack(document, win) === 'exit') App.minimizeApp();
  });

  // The app resumes from the background → pick up anything saved offline
  App.addListener('resume', () => { if (win.API && win.API.queue) win.API.queue.flush(); });
}

if (Capacitor.isNativePlatform()) install();
