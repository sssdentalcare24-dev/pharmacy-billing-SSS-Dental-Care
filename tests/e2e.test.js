// End-to-end tests: the real app in Chromium; every request to Google is answered
// by the real apps-script/Code.gs running on simulated Google services.
//   node --test tests/e2e.test.js        (needs: npm i -g playwright)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setup, waitUntil, ROOT, OWNER_PW, STAFF_PW } = require('./e2e-helpers');

const statusText = p => p.evaluate(() => (document.getElementById('bsSyncStatus') || {}).textContent || '');


test('owner: first login forces a new password; data loads; old public password refused', async () => {
  const t = await setup();
  try {
    await t.page.fill('#loginUsername', 'owner'); await t.page.fill('#loginPassword', '123.456'); await t.page.click('.login-btn');
    await waitUntil(t.page, () => /Incorrect/.test(document.getElementById('loginError').textContent));
    await t.login('owner', t.temp.owner, OWNER_PW);
    assert.equal(await t.page.evaluate(() => bills.length), 2);
    assert.equal(await t.page.evaluate(() => medicines.length), 3);
    assert.equal(await t.page.evaluate(() => currentRole), 'owner');
    const src = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    assert.ok(!/123\.456|e4a5873d|AKfycbxLl7/.test(src), 'no passwords, hashes or live URL in public code');
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('owner billing: FEFO stock, bill number, saved status; cancel restores stock and keeps the record', async () => {
  const t = await setup();
  try {
    await t.login('owner', t.temp.owner, OWNER_PW);
    await t.page.evaluate(() => showPage('newbill'));
    await t.addToCart('Paracetamol 500mg', 3);
    await t.addToCart('Amoxicillin 500mg', 41);                  // more than stock → refused
    assert.equal(await t.page.evaluate(() => cart.length), 1);
    await t.page.fill('#medicineQty', '0'); await t.page.evaluate(() => addMedicineToCart());
    assert.equal(await t.page.evaluate(() => cart[0].qty), 3);
    const total = await t.payCash('Asha Devi');
    assert.equal(total, 30);
    await waitUntil(t.page, () => /Saved on server/.test((document.getElementById('bsSyncStatus') || {}).textContent || ''));
    assert.match(await statusText(t.page), /SSDC-\d\d-00001/);
    const srvBill = t.rows('Bills').find(r => r[1] === 'Asha Devi');
    assert.equal(srvBill[7], 30); assert.equal(srvBill[8], 12, 'cost from batch');
    await t.page.evaluate(() => { closeBillSuccess && closeBillSuccess(); showPage('allbills'); });
    const billId = srvBill[0];
    t.answers.push('Patient changed mind', true);                 // reason, restore stock
    await t.page.evaluate(id => cancelBillUI(id), billId);
    await waitUntil(t.page, id => !bills.some(b => b.billId === id) && cancelledBills.some(b => b.billId === id), billId);
    assert.equal(await t.page.evaluate(() => medicines.find(m => m.name === 'Paracetamol 500mg').stock), 100);
    assert.ok(t.rows('Bills').some(r => r[0] === billId), 'row kept');
    await waitUntil(t.page, () => /Patient changed mind/.test((document.getElementById('cancelledBillsWrap') || {}).textContent || ''));
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('purchase with batch + expiry, FEFO batch view, stock adjustment with reason, admin panels', async () => {
  const t = await setup();
  try {
    await t.login('owner', t.temp.owner, OWNER_PW);
    await t.page.evaluate(() => { showPage('purchases'); openAddPurchaseModal(); });
    const pid = await t.page.evaluate(() => medicines.find(m => m.name === 'Paracetamol 500mg').id);
    await t.page.fill('#purchaseSupplier', 'Sai Pharma'); await t.page.selectOption('#purchaseMedicine', String(pid));
    await t.page.fill('#purchaseQty', '20'); await t.page.fill('#purchaseCostPrice', '3'); await t.page.fill('#purchaseBatchNo', 'PCM-77');
    await t.page.fill('#purchaseExpiry', '2027-02-28'); await t.page.fill('#purchaseInvoiceNo', 'INV-9'); await t.page.fill('#purchaseFreeQty', '2');
    await t.page.evaluate(() => savePurchase());
    await waitUntil(t.page, () => (medicines.find(m => m.name === 'Paracetamol 500mg').batches || []).length === 2);
    assert.equal(await t.page.evaluate(() => medicines.find(m => m.name === 'Paracetamol 500mg').stock), 122);
    await t.page.evaluate(id => { showPage('inventory'); openStockDialog(id); }, pid);
    const dlg = await t.page.textContent('#ssdcDialog');
    assert.match(dlg, /PCM-77/); assert.ok(dlg.indexOf('PCM-77') < dlg.indexOf('OPENING'), 'earliest expiry listed first');
    await t.page.selectOption('#adjType', 'DAMAGED'); await t.page.fill('#adjQty', '2'); await t.page.fill('#adjReason', 'Strip torn');
    await t.page.click('#ssdcDialog button:has-text("Save stock change")');
    await waitUntil(t.page, () => medicines.find(m => m.name === 'Paracetamol 500mg').stock === 120);
    // Settings → owner panels
    await t.page.evaluate(() => showPage('settings'));
    await waitUntil(t.page, () => /staff/.test((document.getElementById('admUsers') || {}).textContent || ''));
    await waitUntil(t.page, () => /adjustStock/.test((document.getElementById('admAudit') || {}).textContent || ''));
    await t.page.click('#adminPanels summary:has-text("Add a staff")');
    await t.page.fill('#nuName', 'reception2'); await t.page.fill('#nuPass', 'Welcome#2026'); await t.page.click('#adminPanels button:has-text("Create login")');
    await waitUntil(t.page, () => /reception2/.test(document.getElementById('admUsers').textContent));
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('staff: owner pages hidden, discount capped, server rejects owner-only calls', async () => {
  const t = await setup({ width: 400, height: 860 });
  try {
    await t.login('staff', t.temp.staff, STAFF_PW);
    assert.equal(await t.page.evaluate(() => currentRole), 'staff');
    assert.equal(await t.page.evaluate(() => document.getElementById('newbill').classList.contains('active')), true);
    assert.equal(await t.page.evaluate(() => document.getElementById('nav-settings').classList.contains('hidden')), true);
    assert.equal(await t.page.evaluate(() => medicines.every(m => m.costPrice === 0)), true, 'no cost prices sent to staff');
    await t.addToCart('Paracetamol 500mg', 10);
    const total = await t.payCash('Staff Patient', 30);            // 30 % asked → capped to 10 %
    assert.equal(total, 90);
    await waitUntil(t.page, () => /Saved on server/.test((document.getElementById('bsSyncStatus') || {}).textContent || ''));
    const res = await t.page.evaluate(() => API.call('cancelBill', { billId: bills[0].billId, reason: 'hack' }, { noQueue: true }));
    assert.equal(res.code, 'FORBIDDEN');
    assert.ok(t.rows('AuditLog').some(r => r[1] === 'staff' && r[6] === 'DENIED'));
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('offline: bill kept as pending, synced once when back online — never duplicated', async () => {
  const t = await setup();
  try {
    await t.login('staff', t.temp.staff, STAFF_PW);
    await t.setOffline(true);
    await t.addToCart('Amoxicillin 500mg', 2);
    await t.payCash('Offline Patient');
    await waitUntil(t.page, () => /this device/.test((document.getElementById('bsSyncStatus') || {}).textContent || ''));
    assert.equal(await t.page.evaluate(() => API.queue.counts().pending), 1);
    assert.match(await t.page.textContent('#syncQueueBadge'), /1 waiting/);
    assert.equal(t.rows('Bills').filter(r => r[1] === 'Offline Patient').length, 0);
    await t.setOffline(false);
    await t.page.evaluate(() => API.queue.flush());
    await t.page.evaluate(() => API.queue.flush());               // second flush must not resend
    await waitUntil(t.page, () => API.queue.counts().pending === 0);
    assert.equal(t.rows('Bills').filter(r => r[1] === 'Offline Patient').length, 1, 'exactly one bill on the server');
    assert.equal(t.rows('StockMovements').filter(r => r[6] === 'SALE' && r[2] === '1002').length, 1);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('server rejection is shown loudly and undone on screen (never silently "saved")', async () => {
  const t = await setup();
  try {
    await t.login('owner', t.temp.owner, OWNER_PW);
    await t.page.evaluate(() => showPage('newbill'));
    t.setTamper(b => { if (b.action === 'saveBill') b.total = '1.00'; return b; });   // simulate a corrupted request
    await t.addToCart('Paracetamol 500mg', 2);
    await t.payCash('Reject Me');
    await waitUntil(t.page, () => /NOT saved/.test((document.getElementById('bsSyncStatus') || {}).textContent || ''));
    assert.ok(t.rows('AuditLog').some(r => r[3] === 'saveBill' && r[6] === 'REJECTED'), 'rejections are audited');
    assert.ok(t.dialogs.some(d => /NOT saved/.test(d)));
    assert.equal(await t.page.evaluate(() => bills.some(b => b.patientName === 'Reject Me')), false);
    assert.equal(await t.page.evaluate(() => medicines.find(m => m.name === 'Paracetamol 500mg').stock), 100, 'stock restored on screen');
    assert.equal(t.rows('Bills').filter(r => r[1] === 'Reject Me').length, 0);
  } finally { await t.close(); }
});

test('session expiry returns to login; reopening the tab resumes a live session', async () => {
  const t = await setup();
  try {
    await t.login('owner', t.temp.owner, OWNER_PW);
    await t.page.reload();
    await waitUntil(t.page, () => document.getElementById('loginScreen').classList.contains('hidden') && API.lastSync > 0);
    Object.keys(t.g.cache).filter(k => k.startsWith('S_')).forEach(k => delete t.g.cache[k]);   // server forgets session
    await t.page.evaluate(() => loadData());
    await waitUntil(t.page, () => !document.getElementById('loginScreen').classList.contains('hidden'));
    assert.match(await t.page.textContent('#loginError'), /session/i);
  } finally { await t.close(); }
});

test('dental revenue: treatment + combined bill counted once each; no invented chart data', async () => {
  const t = await setup();
  try {
    await t.login('owner', t.temp.owner, OWNER_PW);
    await t.page.evaluate(() => showPage('reports'));
    await t.page.evaluate(() => { document.getElementById('rpt_period').value = 'today'; renderReports(); });
    assert.match(await t.page.textContent('#rpt_treatment_chart'), /No treatment receipts/);
    // combined bill: medicine ₹50 + treatment ₹1500
    await t.page.evaluate(() => showPage('combinedbill'));
    const mid = await t.page.evaluate(() => medicines.find(m => m.name === 'Amoxicillin 500mg').id);
    await t.page.fill('#cb_patient', 'Combo Patient'); await t.page.fill('#cb_tr_amount', '1500'); await t.page.fill('#cb_tr_desc', 'Root Canal Therapy');
    await t.page.selectOption('#cb_medSelect', String(mid)); await t.page.fill('#cb_medQty', '2');
    await t.page.evaluate(() => addCbMedicine()); await t.page.waitForTimeout(100);
    await t.page.evaluate(() => { _cbMode = 'UPI'; confirmCbPayment(); });
    await waitUntil(t.page, () => bills.some(b => b.patientName === 'Combo Patient' && b.syncStatus === 'saved'));
    const bill = t.rows('Bills').find(r => r[1] === 'Combo Patient');
    assert.equal(bill[7], 50, 'Bills holds only the pharmacy part'); assert.equal(bill[8], 24, 'real cost, not ₹0');
    assert.equal(t.rows('TreatmentReceipts').filter(r => r[2] === 'Combo Patient')[0][4], 1500);
    await t.page.evaluate(() => loadData()); await t.page.waitForTimeout(300);
    await t.page.evaluate(() => { showPage('reports'); document.getElementById('rpt_period').value = 'today'; renderReports(); });
    const kpis = await t.page.textContent('#rpt_kpis');
    assert.match(kpis, /Total Revenue\s*₹1,550/); assert.match(kpis, /Dental Treatments\s*₹1,500/); assert.match(kpis, /Pharmacy Sales\s*₹50\b/);
    assert.doesNotMatch(await t.page.textContent('#rpt_treatment_chart'), /No treatment receipts/);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('clinic modules save through the secure API: patient, appointment, prescription, exam, treatment, expense, WA template', async () => {
  const t = await setup();
  try {
    await t.login('owner', t.temp.owner, OWNER_PW);
    const p = t.page;
    // patient
    await p.evaluate(() => { showPage('patients'); openAddPatientModal(); });
    await p.fill('#pt_name', 'Smoke Patient'); await p.fill('#pt_phone', '9000011111');
    await p.evaluate(() => savePatient());
    // appointment (different doctor than the existing 10:30 slot → allowed)
    await p.evaluate(() => { showPage('appointments'); openAddApptModal(); });
    await p.fill('#appt_patient', 'Smoke Patient'); await p.fill('#appt_bookDate', '2026-11-03');
    await p.evaluate(() => { const s = document.getElementById('appt_time'); s.value = s.options[1].value; });
    await p.evaluate(() => saveAppointment());
    // prescription
    await p.evaluate(() => showPage('prescription'));
    await p.fill('#rx_name', 'Smoke Patient'); await p.fill('#rx_content', 'Tab Amoxicillin 500mg TDS x 5 days');
    await p.evaluate(() => printPrescription());
    // exam form
    await p.evaluate(() => showPage('examform'));
    await p.fill('#ef_patient', 'Smoke Patient');
    await p.evaluate(() => printExamForm());
    // treatment receipt via its payment flow
    await p.evaluate(() => showPage('treatmentreceipt'));
    await p.fill('#tr_patient', 'Smoke Patient'); await p.fill('#tr_amount', '800');
    await p.evaluate(async () => { await autoFillNo('tr_no'); _trMode = 'Cash'; printTreatmentReceipt(); });
    // expense
    await p.evaluate(() => showPage('expenses'));
    await p.fill('#exp_amount', '450'); await p.evaluate(() => { document.getElementById('exp_category').selectedIndex = 1; });
    await p.evaluate(() => addExpense());
    // WA template (allowed for staff and owner)
    await p.evaluate(() => { _setCustomTmpl('reminder24', 'Hi {name}'); _syncTmplsToSheets(); });
    await new Promise(r => setTimeout(r, 1500));
    const y = String(new Date().getFullYear());
    assert.ok(t.rows('Patients').some(r => r[1] === 'Smoke Patient'), 'patient');
    assert.ok(t.rows('Appointments').some(r => r[1] === 'Smoke Patient'), 'appointment');
    const rx = t.rows('Prescriptions').find(r => r[1] === 'Smoke Patient'); assert.ok(rx && /^RX-/.test(rx[6]), 'prescription with record ID');
    const ef = t.rows('ExamForms').find(r => r[1] === 'Smoke Patient'); assert.ok(ef && /^EF-/.test(ef[22]), 'exam form with record ID');
    const tr = t.rows('TreatmentReceipts').find(r => r[2] === 'Smoke Patient');
    assert.ok(tr && tr[0] === y + '-0008', 'server receipt number continues after 2026-0007: ' + (tr && tr[0]));
    assert.ok(t.rows('Expenses').some(r => r[3] === 450), 'expense');
    assert.ok(t.rows('Settings').some(r => r[0] === 'wa_templates' && /Hi \{name\}/.test(r[1])), 'wa template');
    // deleting a prescription now removes exactly that record (soft)
    t.answers.push(true);
    await p.evaluate(() => { showPage('prescription'); deleteRxRecord(getRxHistory().length - 1); });
    await new Promise(r => setTimeout(r, 800));
    assert.equal(t.rows('Prescriptions').find(r => r[1] === 'Smoke Patient')[8], 'Deleted');
    assert.equal(t.rows('Prescriptions').find(r => r[1] === 'Ravi Kumar')[1], 'Ravi Kumar', 'other patient untouched');
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('unsent items from the previous app version are carried over and synced', async () => {
  const t = await setup();
  try {
    await t.page.evaluate(() => localStorage.setItem('ssdc_sync_queue', JSON.stringify([{ k: 'saveBill|BILL-OLD1',
      url: 'https://script.google.com/macros/s/X/exec?action=saveBill&billId=BILL-1790000000001&patientName=Old%20Queue&subtotal=10.00&discount=0.00&total=10.00&paymentMode=Cash&items=' +
        encodeURIComponent(JSON.stringify([{ medicineId: 1001, medicineName: 'Paracetamol 500mg', qty: 1, price: 10, amount: 10 }])), at: Date.now() }])));
    await t.page.reload();
    await t.login('staff', t.temp.staff, STAFF_PW);
    await t.page.evaluate(() => API.queue.flush());
    await waitUntil(t.page, () => API.queue.counts().pending === 0);
    assert.equal(t.rows('Bills').filter(r => r[1] === 'Old Queue').length, 1);
  } finally { await t.close(); }
});

test('new app against the OLD Apps Script shows a clear "update the server" message', async () => {
  const t = await setup();
  try {
    // old v2 server: POST was answered like getAllData, no login at all
    t.setTamper(() => null);
    await t.page.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, medicines: [], bills: [] }) }));
    await t.page.fill('#loginUsername', 'owner'); await t.page.fill('#loginPassword', 'whatever1'); await t.page.click('.login-btn');
    await waitUntil(t.page, () => /not been updated/.test((document.getElementById('ssdcBanner') || {}).textContent || ''));
    assert.equal(await t.page.evaluate(() => document.getElementById('loginScreen').classList.contains('hidden')), false);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('Android build: a server link built into the app is used — phones are not asked for it', async () => {
  const t = await setup();
  try {
    const API_URL = 'https://script.google.com/macros/s/AKfycbTESTDEPLOYMENT/exec';
    await t.page.addInitScript(u => { window.SSDC_API_URL = u; }, API_URL);
    await t.page.reload();
    await t.login('owner', t.temp.owner, OWNER_PW);
    assert.ok(!t.dialogs.some(d => /Apps Script Web App link/.test(d)), 'no question about the server link: ' + t.dialogs.join(' | '));
    assert.equal(await t.page.evaluate(() => JSON.parse(localStorage.getItem('medistock_config') || '{}').apiUrl), API_URL);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});


test('Android app: reopening within 30 minutes goes straight in (no login); after 30 idle minutes it asks again', async () => {
  const t = await setup();
  try {
    await t.page.addInitScript(() => { window.SSDC_APP_BUILD = true; });
    await t.page.reload();
    await t.login('owner', t.temp.owner, OWNER_PW);
    await waitUntil(t.page, () => API.lastSync > 0);
    // Android closed the app (WhatsApp, camera…) and it is opened again
    await t.page.reload();
    await waitUntil(t.page, () => document.getElementById('loginScreen').classList.contains('hidden') && API.lastSync > 0);
    assert.equal(await t.page.evaluate(() => API.user().username), 'owner');
    // 31 minutes without use → login screen
    await t.page.evaluate(() => localStorage.setItem('ssdc_last_active', String(Date.now() - 31 * 60000)));
    await t.page.reload();
    await waitUntil(t.page, () => !document.getElementById('loginScreen').classList.contains('hidden'));
    assert.equal(await t.page.evaluate(() => localStorage.getItem('ssdc_session')), null);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('website (not the app): the login stays only in this browser tab', async () => {
  const t = await setup();
  try {
    await t.login('owner', t.temp.owner, OWNER_PW);
    await waitUntil(t.page, () => API.lastSync > 0);
    assert.equal(await t.page.evaluate(() => localStorage.getItem('ssdc_session')), null);
    assert.ok(await t.page.evaluate(() => sessionStorage.getItem('ssdc_session')));
  } finally { await t.close(); }
});
