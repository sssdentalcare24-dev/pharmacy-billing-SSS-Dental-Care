// Pure helpers used by native-bridge.js (no Capacitor imports, so they can be tested in a browser).
// ── 1. Web Bluetooth API on top of the native BLE plugin ─────────────
// Implements exactly the subset js/app.js uses: requestDevice → gatt.connect →
// getPrimaryService(s) → getCharacteristic(s) → writeValue(WithoutResponse),
// plus the 'gattserverdisconnected' event.
export function makeWebBluetooth(ble) {
  let ready = null;
  const init = () => (ready = ready || ble.initialize({ androidNeverForLocation: true }));
  const norm = (u) => String(u).toLowerCase();
  const toDataView = (v) => (v instanceof DataView ? v : ArrayBuffer.isView(v) ? new DataView(v.buffer, v.byteOffset, v.byteLength) : new DataView(v));

  return {
    async requestDevice(options = {}) {
      await init();
      const d = await ble.requestDevice({ optionalServices: (options.optionalServices || []).map(norm) });
      const listeners = {};
      const fire = (type) => (listeners[type] || []).forEach((fn) => { try { fn({ type, target: device }); } catch (e) { /* ignore */ } });
      const device = {
        id: d.deviceId,
        name: d.name || 'BT Printer',
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
        gatt: {
          connected: false,
          async connect() {
            await ble.connect(d.deviceId, () => { device.gatt.connected = false; fire('gattserverdisconnected'); });
            device.gatt.connected = true;
            const services = await ble.getServices(d.deviceId);
            const mkChar = (svcUuid, c) => ({
              uuid: c.uuid,
              properties: c.properties || {},
              writeValue: (v) => ble.write(d.deviceId, svcUuid, c.uuid, toDataView(v)),
              writeValueWithResponse: (v) => ble.write(d.deviceId, svcUuid, c.uuid, toDataView(v)),
              writeValueWithoutResponse: (v) => ble.writeWithoutResponse(d.deviceId, svcUuid, c.uuid, toDataView(v)),
            });
            const mkSvc = (s) => ({
              uuid: s.uuid,
              async getCharacteristic(u) {
                const c = (s.characteristics || []).find((x) => norm(x.uuid) === norm(u));
                if (!c) throw new Error('Characteristic not found: ' + u);
                return mkChar(s.uuid, c);
              },
              async getCharacteristics() { return (s.characteristics || []).map((c) => mkChar(s.uuid, c)); },
            });
            return {
              device, connected: true,
              async getPrimaryService(u) {
                const s = services.find((x) => norm(x.uuid) === norm(u));
                if (!s) throw new Error('Service not found: ' + u);
                return mkSvc(s);
              },
              async getPrimaryServices() { return services.map(mkSvc); },
            };
          },
          disconnect() {
            device.gatt.connected = false;
            ble.disconnect(d.deviceId).catch(() => {});
          },
        },
      };
      return device;
    },
  };
}

// ── 3. CSV/text downloads → share sheet ──────────────────────────────
// Remembers every Blob turned into a blob: URL, so the export can be read back
// without fetch() (the page's Content-Security-Policy doesn't allow fetching blob: URLs).
export function makeBlobReader(win) {
  const blobs = new Map();
  const origCreate = win.URL.createObjectURL.bind(win.URL);
  win.URL.createObjectURL = (obj) => { const u = origCreate(obj); if (obj instanceof win.Blob) blobs.set(u, obj); return u; };
  return async function read(href) {
    if (blobs.has(href)) { const b = blobs.get(href); blobs.delete(href); return b.text(); }
    const m = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(href || '');
    if (m) return m[2] ? decodeURIComponent(escape(win.atob(m[3]))) : decodeURIComponent(m[3]);
    throw new Error('File is no longer available — try the export again');
  };
}
export function makeDownloadHandler(fs, share, readFn) {
  return async function shareDownload(href, filename) {
    const text = await readFn(href);
    const safe = String(filename || 'export.csv').replace(/[^\w.\-]+/g, '_');
    const res = await fs.writeFile({ path: safe, data: text, directory: 'CACHE', encoding: 'utf8' });
    await share.share({ title: safe, files: [res.uri], dialogTitle: 'Save or send ' + safe });
  };
}

// ── 5. Back button: close the top-most thing first ───────────────────
export function handleBack(doc, win) {
  const visible = (el) => el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
  const dlg = doc.getElementById('ssdcDialog');
  if (dlg) { if (!doc.getElementById('cpOld')) win.closeSsdcDialog && win.closeSsdcDialog(); return 'dialog'; }   // never close the forced password dialog
  const printModal = doc.getElementById('__printModal');
  if (printModal) { win.closePrintModal ? win.closePrintModal() : printModal.remove(); return 'print'; }
  const modal = doc.querySelector('.modal.active');
  if (modal) { modal.classList.remove('active'); return 'modal'; }
  const success = doc.getElementById('billSuccessModal');
  if (visible(success) || (success && success.classList.contains('active'))) { win.closeBillSuccess ? win.closeBillSuccess() : success.classList.remove('active'); return 'success'; }
  const sidebar = doc.querySelector('.sidebar.open');
  if (sidebar) { win.closeSidebar && win.closeSidebar(); return 'sidebar'; }
  const login = doc.getElementById('loginScreen');
  if (login && !login.classList.contains('hidden')) return 'exit';
  const home = win.currentRole === 'staff' ? 'newbill' : 'dashboard';
  const active = doc.querySelector('.page.active');
  if (active && active.id !== home && win.showPage) { win.showPage(home); return 'home'; }
  return 'exit';
}

