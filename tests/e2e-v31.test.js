// v3.1 browser tests: the real app in Chromium against the real Code.gs (v3.1 tables).
//   node --test --test-concurrency=1 tests/e2e-v31.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { setup, waitUntil, OWNER_PW, STAFF_PW } = require('./e2e-helpers');
const { legacyData } = require('./gas-mock');

const v31 = (viewport) => setup(viewport, { v31: true });
const col = (t, sheet, name) => t.g.spreadsheets['1rOwubjghrsuWiGXR8X1A1841_8yd-cmMQIj44QBqNaA'].getSheetByName(sheet).rows[0].indexOf(name);
const row = (t, sheet, pred) => t.rows(sheet).find(pred);
const val = (t, sheet, r, name) => r[col(t, sheet, name)];
async function bill(t, name, qty) {
  const id = await t.page.evaluate(n => (medicines.find(m => m.name === n) || {}).id, name);
  await t.page.selectOption('#medicineSelect', String(id)); await t.page.fill('#medicineQty', String(qty));
  await t.page.evaluate(() => addMedicineToCart());
}

test('v3.1 menus by role; patient data on the device is encrypted and unreadable after logout', async () => {
  const t = await v31();
  try {
    await t.login('owner', t.temp.owner, OWNER_PW);
    await waitUntil(t.page, () => document.body.classList.contains('v31'));
    const vis = id => t.page.evaluate(i => { const e = document.getElementById(i); return !!e && !e.hidden && !e.classList.contains('hidden'); }, id);
    for (const id of ['nav-payments', 'nav-suppliers', 'nav-followups', 'nav-cashclose', 'nav-finance']) assert.equal(await vis(id), true, id);
    await waitUntil(t.page, () => (localStorage.getItem('pt_records') || '').length > 5);    // the app still reads it (decrypted in memory)
    await t.page.evaluate(() => SecureStore.flush());
    // what is really stored on the device (property access bypasses the decrypting layer)
    const raw = await t.page.evaluate(() => ['pt_records', 'medistock_cache', 'ssdc_v31_cache'].map(k => localStorage[k]));
    raw.forEach((v, i) => assert.match(String(v), /^enc1:/, 'stored encrypted: ' + i));
    const dump = await t.page.evaluate(() => Object.keys(localStorage).map(k => k + '=' + localStorage[k]).join('\n'));
    assert.ok(!/Ravi Kumar|9876543210|Paracetamol/.test(dump), 'no readable patient names / phones / medicines on the device');
    // another tab without the session key cannot read it
    const p2 = await t.page.context().newPage();
    await p2.goto(t.page.url());
    assert.deepEqual(await p2.evaluate(() => ['pt_records', 'medistock_cache'].map(k => localStorage.getItem(k))), [null, null]);
    await p2.close();
    // staff: no suppliers / finance
    await t.page.evaluate(() => doLogout());
    await t.login('staff', t.temp.staff, STAFF_PW);
    await waitUntil(t.page, () => document.body.classList.contains('v31'));
    assert.equal(await vis('nav-payments'), true); assert.equal(await vis('nav-cashclose'), true); assert.equal(await vis('nav-followups'), true);
    assert.equal(await vis('nav-suppliers'), false); assert.equal(await vis('nav-finance'), false);
    await t.page.evaluate(() => showPage('finance'));
    assert.equal(await t.page.evaluate(() => document.getElementById('finance').classList.contains('active')), false, 'staff cannot open finance');
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('part payment on a pharmacy bill → due on the bill, in Dues, collected later by staff', async () => {
  const t = await v31();
  try {
    await t.login('staff', t.temp.staff, STAFF_PW);
    await waitUntil(t.page, () => document.body.classList.contains('v31'));
    await t.page.evaluate(() => showPage('newbill'));
    await bill(t, 'Paracetamol 500mg', 5);
    await t.page.fill('#patientName', 'Ravi Kumar'); await t.page.fill('#patientPhone', '9876543210');
    await t.page.evaluate(() => openPaymentModal(false));
    await t.page.check('#pp_pm input[type=checkbox]');
    await t.page.fill('#pp_now_pm', '30');
    assert.match(await t.page.textContent('#pp_due_pm'), /₹20\.00/);
    await t.page.fill('#pmTendered', '30');
    await t.page.evaluate(() => confirmPayment());
    await waitUntil(t.page, () => /Saved on server/.test((document.getElementById('bsSyncStatus') || {}).textContent || ''));
    assert.match(await t.page.textContent('#bsDueBox'), /Balance due₹20\.00/);
    const b = row(t, 'Bills', r => r[1] === 'Ravi Kumar' && r[7] === 50 && r[0] !== 'BILL-1700000000001');
    assert.equal(val(t, 'Bills', b, 'Paid Amount'), 30); assert.equal(val(t, 'Bills', b, 'Balance Due'), 20); assert.equal(val(t, 'Bills', b, 'Patient ID'), 'PT-1');
    await t.page.evaluate(() => { closeBillSuccess(); showPage('payments'); });
    await waitUntil(t.page, () => /Ravi Kumar/.test(document.getElementById('payments').textContent) && /₹20/.test(document.getElementById('payments').textContent));
    await t.page.click('#payments button[data-act="collect"]');
    await waitUntil(t.page, () => !!document.getElementById('colAmt'));
    assert.equal(await t.page.inputValue('#colAmt'), '20');
    await t.page.click('#ssdcDialog button.v-mode[data-mode="UPI"]');
    await t.page.click('#ssdcDialog button[data-act="colSave"]');
    await waitUntil(t.page, () => /received from/.test((document.getElementById('ssdcDialog') || {}).textContent || ''));
    const b2 = row(t, 'Bills', r => r[0] === b[0]);
    assert.equal(val(t, 'Bills', b2, 'Balance Due'), 0); assert.equal(val(t, 'Bills', b2, 'Payment Status'), 'Paid');
    const pay = row(t, 'Payments', r => r[5] === b[0]);
    assert.equal(pay[11], 'UPI'); assert.equal(pay[10], 20);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('combined bill: pay part now with split cash/UPI — medicines paid first, the rest goes to the treatment', async () => {
  const t = await v31();
  try {
    await t.login('owner', t.temp.owner, OWNER_PW);
    await waitUntil(t.page, () => document.body.classList.contains('v31'));
    await t.page.evaluate(() => showPage('combinedbill'));
    await t.page.fill('#cb_patient', 'Ravi Kumar'); await t.page.fill('#cb_phone', '9876543210');
    await t.page.fill('#cb_tr_amount', '1000'); await t.page.fill('#cb_tr_desc', 'Root Canal Treatment');
    const id = await t.page.evaluate(() => medicines.find(m => m.name === 'Paracetamol 500mg').id);
    await t.page.selectOption('#cb_medSelect', String(id)); await t.page.fill('#cb_medQty', '5'); await t.page.evaluate(() => addCbMedicine());
    await t.page.evaluate(() => openCbPayment());
    await t.page.check('#pp_cb input[type=checkbox]'); await t.page.fill('#pp_now_cb', '500');
    await t.page.evaluate(() => selectCbMode('Split'));
    await t.page.fill('#cbPmSplitCash', '200'); await t.page.fill('#cbPmSplitUpi', '300');
    await t.page.evaluate(() => confirmCbPayment());
    await waitUntil(t.page, () => true);
    for (let i = 0; i < 50 && !(row(t, 'Bills', r => r[1] === 'Ravi Kumar' && String(r[0]).startsWith('CB-')) && row(t, 'TreatmentReceipts', r => r[2] === 'Ravi Kumar' && r[4] === 1000)); i++) await new Promise(r => setTimeout(r, 100));
    const pb = row(t, 'Bills', r => r[1] === 'Ravi Kumar' && String(r[0]).startsWith('CB-'));
    assert.ok(pb, 'pharmacy part saved');
    assert.equal(val(t, 'Bills', pb, 'Paid Amount'), 50); assert.equal(val(t, 'Bills', pb, 'Cash Amount'), 50); assert.equal(val(t, 'Bills', pb, 'Balance Due'), 0);
    const tr = row(t, 'TreatmentReceipts', r => r[2] === 'Ravi Kumar' && r[4] === 1000);
    assert.equal(val(t, 'TreatmentReceipts', tr, 'Paid Amount'), 450); assert.equal(val(t, 'TreatmentReceipts', tr, 'Cash Amount'), 150);
    assert.equal(val(t, 'TreatmentReceipts', tr, 'UPI Amount'), 300); assert.equal(val(t, 'TreatmentReceipts', tr, 'Balance Due'), 550);
    assert.equal(val(t, 'TreatmentReceipts', tr, 'Patient ID'), 'PT-1'); assert.equal(val(t, 'Bills', pb, 'Patient ID'), 'PT-1');
    assert.equal(t.g.post({ action: 'validateData', token: await t.page.evaluate(() => API.token()) }).count, 0);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('dental receipt: price list chips fill the amount; pay all later → full balance due', async () => {
  const t = await v31();
  try {
    await t.login('owner', t.temp.owner, OWNER_PW);
    await waitUntil(t.page, () => document.body.classList.contains('v31'));
    const tok = await t.page.evaluate(() => API.token());
    const rct = t.g.post({ action: 'getAllData', token: tok }).treatmentMaster.find(x => x.name === 'Root Canal Treatment');
    t.g.post({ action: 'saveTreatment', token: tok, id: rct.id, name: rct.name, category: rct.category, price: 4500 });
    await t.page.evaluate(() => loadData());
    await t.page.evaluate(() => showPage('treatmentreceipt'));
    await waitUntil(t.page, () => !!document.querySelector('#v31TrPick button[data-act="trChip"]') && /4,500/.test(document.getElementById('v31TrPick').textContent));
    await t.page.fill('#tr_patient', 'Ravi');
    await waitUntil(t.page, () => !!document.querySelector('.v-pick-item'));
    await t.page.dispatchEvent('.v-pick-item', 'mousedown');
    await waitUntil(t.page, () => /Penicillin|Due|Alert|⚠️/.test(document.body.textContent) || true);
    await t.page.click('#v31TrPick button:has-text("Root Canal Treatment")');
    assert.equal(await t.page.inputValue('#tr_amount'), '4500');
    assert.match(await t.page.inputValue('#tr_words'), /Four Thousand Five Hundred Only/);
    await t.page.evaluate(() => openTreatmentPayment());
    await t.page.check('#pp_tr input[type=checkbox]');
    await t.page.click('#pp_tr button:has-text("Pay all later")');
    t.answers.push(true);
    await t.page.evaluate(() => confirmTrPayment());
    for (let i = 0; i < 50 && !row(t, 'TreatmentReceipts', r => r[2] === 'Ravi Kumar' && r[4] === 4500); i++) await new Promise(r => setTimeout(r, 100));
    const tr = row(t, 'TreatmentReceipts', r => r[2] === 'Ravi Kumar' && r[4] === 4500);
    assert.ok(tr, 'receipt saved');
    assert.equal(val(t, 'TreatmentReceipts', tr, 'Paid Amount'), 0); assert.equal(val(t, 'TreatmentReceipts', tr, 'Balance Due'), 4500);
    assert.equal(val(t, 'TreatmentReceipts', tr, 'Payment Mode'), 'Credit'); assert.equal(val(t, 'TreatmentReceipts', tr, 'Patient ID'), 'PT-1');
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('owner returns a medicine from a bill: stock back, money back, shown on the bill', async () => {
  const t = await v31();
  try {
    await t.login('owner', t.temp.owner, OWNER_PW);
    await waitUntil(t.page, () => document.body.classList.contains('v31'));
    await t.page.evaluate(() => showPage('newbill'));
    await bill(t, 'Paracetamol 500mg', 4);
    await t.payCash('Return Test');
    await waitUntil(t.page, () => /Saved on server/.test((document.getElementById('bsSyncStatus') || {}).textContent || ''));
    const id = await t.page.evaluate(() => bills.find(b => b.patientName === 'Return Test').billId);
    await t.page.evaluate(() => { closeBillSuccess(); showPage('allbills'); });
    await t.page.evaluate(i => V31.money.openDetail('BILL', i), id);
    await waitUntil(t.page, () => /Paid with bill/.test((document.getElementById('detPays') || {}).textContent || ''));
    await t.page.click('#ssdcDialog button[data-act="openRefund"]');
    await t.page.fill('#rfQ0', '1'); await t.page.dispatchEvent('#rfQ0', 'input');
    assert.match(await t.page.textContent('#rfPreview'), /Give back now₹10\.00/);
    await t.page.fill('#rfReason', 'Not needed');
    t.answers.push(true);
    await t.page.click('#ssdcDialog button[data-act="rfSave"]');
    await waitUntil(t.page, () => /RF-\d\d-00001/.test((document.getElementById('detPays') || {}).textContent || ''));
    assert.equal(await t.page.evaluate(() => medicines.find(m => m.name === 'Paracetamol 500mg').stock), 97);
    await waitUntil(t.page, i => /↩/.test(document.getElementById('billsBody').innerHTML) && bills.find(b => b.billId === i).returnedValue === 10, id);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('purchase invoice with a new supplier, credit, then pay the supplier; ledger shows it', async () => {
  const t = await v31();
  try {
    await t.login('owner', t.temp.owner, OWNER_PW);
    await waitUntil(t.page, () => document.body.classList.contains('v31'));
    await t.page.evaluate(() => showPage('purchases'));
    await waitUntil(t.page, () => !!document.querySelector('#v31InvBox button[data-act="newInvoice"]'));
    await t.page.click('#v31InvBox button[data-act="newInvoice"]');
    await t.page.fill('#invSup', 'Venkata Pharma'); await t.page.fill('#invNo', 'VP/77');
    await t.page.fill('#il_med_0', 'Amoxicillin 500mg'); await t.page.dispatchEvent('#il_med_0', 'change');
    await t.page.fill('[data-i="0"][data-f="batchNo"]', 'AMX-9'); await t.page.dispatchEvent('[data-i="0"][data-f="batchNo"]', 'input');
    await t.page.fill('[data-i="0"][data-f="expMonth"]', '2028-06'); await t.page.dispatchEvent('[data-i="0"][data-f="expMonth"]', 'change');
    await t.page.fill('[data-i="0"][data-f="qty"]', '30'); await t.page.dispatchEvent('[data-i="0"][data-f="qty"]', 'input');
    await t.page.fill('[data-i="0"][data-f="freeQty"]', '3'); await t.page.dispatchEvent('[data-i="0"][data-f="freeQty"]', 'input');
    await t.page.fill('[data-i="0"][data-f="costPrice"]', '11'); await t.page.dispatchEvent('[data-i="0"][data-f="costPrice"]', 'input');
    assert.match(await t.page.textContent('#invTotals'), /Invoice total₹330\.00/);
    t.answers.push(true);                       // create the new supplier
    await t.page.click('button[data-act="invSave"]');
    await waitUntil(t.page, () => !document.getElementById('v31Sheet') && medicines.find(m => m.name === 'Amoxicillin 500mg').stock === 73);
    const b = row(t, 'Batches', r => r[2] === 'AMX-9'); assert.equal(b[3], '2028-06-30'); assert.equal(b[4], 33);
    await t.page.evaluate(() => showPage('suppliers'));
    await waitUntil(t.page, () => /Venkata Pharma/.test(document.getElementById('suppliers').textContent) && /₹330\.00/.test(document.getElementById('suppliers').textContent));
    const sid = await t.page.evaluate(() => V31.data.suppliers.find(s => s.name === 'Venkata Pharma').id);
    await t.page.click(`#suppliers button[data-act="supPay"][data-id="${sid}"]`);
    await t.page.fill('#sPayAmt', '300'); await t.page.click('#ssdcDialog button[data-act="supPaySave"]');
    await waitUntil(t.page, s => V31.data.suppliers.find(x => x.id === s).balance === 30, sid);
    await t.page.click(`#suppliers button[data-act="supLedger"][data-id="${sid}"]`);
    await waitUntil(t.page, () => /Purchase/.test((document.getElementById('v31SheetBody') || {}).textContent || '') && /₹30\.00/.test(document.getElementById('v31SheetBody').textContent));
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('patient profile with allergy → warning when billing; records view; follow-up from prescription', async () => {
  const t = await v31();
  try {
    await t.login('staff', t.temp.staff, STAFF_PW);
    await waitUntil(t.page, () => document.body.classList.contains('v31'));
    await t.page.evaluate(() => { showPage('patients'); openAddPatientModal(); });
    await t.page.fill('#ppName', 'Meena Rao'); await t.page.fill('#ppPhone', '9000012345'); await t.page.fill('#ppAllergies', 'Penicillin');
    await t.page.fill('#ppMed', 'Hypertension'); await t.page.click('#ssdcDialog button[data-act="ppSave"]');
    for (let i = 0; i < 40 && !row(t, 'Patients', r => r[1] === 'Meena Rao'); i++) await new Promise(r => setTimeout(r, 100));
    const p = row(t, 'Patients', r => r[1] === 'Meena Rao');
    assert.equal(val(t, 'Patients', p, 'Allergies'), 'Penicillin'); assert.equal(val(t, 'Patients', p, 'Medical History'), 'Hypertension');
    // billing: picker links the patient and shows the allergy
    await t.page.evaluate(() => showPage('prescription'));
    await t.page.fill('#rx_name', 'Meena');
    await waitUntil(t.page, () => !!document.querySelector('.v-pick-item'));
    await t.page.dispatchEvent('.v-pick-item', 'mousedown');
    await waitUntil(t.page, () => /Allergy: Penicillin/.test(document.getElementById('prescription').textContent));
    await t.page.fill('#rx_content', 'Tab Azithromycin 500 OD x 3 days');
    await t.page.selectOption('#rxFuDays', '7');
    await t.page.evaluate(() => printPrescription());
    await t.page.evaluate(() => __closePrintChoice());
    for (let i = 0; i < 40 && !(row(t, 'FollowUps', r => r[2] === 'Meena Rao') && row(t, 'Prescriptions', r => r[1] === 'Meena Rao')); i++) await new Promise(r => setTimeout(r, 100));
    const fu = row(t, 'FollowUps', r => r[2] === 'Meena Rao'); assert.ok(fu, 'follow-up created');
    const rx = row(t, 'Prescriptions', r => r[1] === 'Meena Rao');
    assert.equal(val(t, 'Prescriptions', rx, 'Patient ID'), p[0]); assert.ok(val(t, 'Prescriptions', rx, 'Follow-up Date'));
    // records sheet
    await t.page.evaluate(id => { showPage('patients'); V31.clinic.openRecords(id); }, p[0]);
    await waitUntil(t.page, () => /Hypertension/.test((document.getElementById('v31SheetBody') || {}).textContent || ''));
    await t.page.click('#v31SheetBody button[data-tab="rx"]');
    await waitUntil(t.page, () => /Azithromycin/.test(document.getElementById('v31SheetBody').textContent));
    await t.page.evaluate(() => V31.closeSheet());
    await t.page.evaluate(() => loadData());
    await t.page.evaluate(() => showPage('followups'));
    await waitUntil(t.page, () => /Meena Rao/.test(document.getElementById('followups').textContent));
    await t.page.click('#followups button[data-act="fuDone"]');
    for (let i = 0; i < 40 && row(t, 'FollowUps', r => r[2] === 'Meena Rao')[8] !== 'Done'; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(row(t, 'FollowUps', r => r[2] === 'Meena Rao')[8], 'Done');
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('cash closing by staff; finance dashboard + Excel export (a real .xlsx); stock reports', async () => {
  const t = await v31();
  try {
    await t.login('owner', t.temp.owner, OWNER_PW);
    await waitUntil(t.page, () => document.body.classList.contains('v31'));
    await t.page.evaluate(() => showPage('newbill'));
    await bill(t, 'Paracetamol 500mg', 10);
    await t.payCash('Cash Day');
    await waitUntil(t.page, () => /Saved on server/.test((document.getElementById('bsSyncStatus') || {}).textContent || ''));
    await t.page.evaluate(() => { closeBillSuccess(); showPage('cashclose'); });
    await waitUntil(t.page, () => !!document.getElementById('ccOpen'));
    await t.page.fill('#ccOpen', '500'); await t.page.fill('#ccN100', '6'); await t.page.dispatchEvent('#ccN100', 'input');
    assert.equal(await t.page.inputValue('#ccCounted'), '600');
    assert.match(await t.page.textContent('#ccCheck'), /Matches ✅/);
    await t.page.click('button[data-act="ccSave"]');
    await waitUntil(t.page, () => /Closed by owner/.test(document.getElementById('cashclose').textContent));
    // finance
    await t.page.evaluate(() => showPage('finance'));
    await waitUntil(t.page, () => /Operating profit/.test(document.getElementById('finance').textContent) && !!document.querySelector('#finRev svg'));
    assert.match(await t.page.textContent('.v-hero-v'), /₹/);
    await t.page.click('#finance button[data-tab="reports"]');
    await waitUntil(t.page, () => !!document.querySelector('#finance button[data-k="meds"]'));
    await t.page.click('#finance button[data-k="meds"]');
    await waitUntil(t.page, () => /Paracetamol 500mg/.test(document.getElementById('finRepOut').textContent));
    const [dl] = await Promise.all([t.page.waitForEvent('download'), t.page.click('#finance button[data-act="finAllX"]')]);
    const file = await dl.path(); const buf = fs.readFileSync(file);
    assert.equal(buf.slice(0, 2).toString(), 'PK', 'zip file'); assert.ok(buf.includes(Buffer.from('[Content_Types].xml')) && buf.includes(Buffer.from('xl/worksheets/sheet1.xml')));
    assert.ok(buf.includes(Buffer.from('Paracetamol 500mg')));
    // stock reports
    await t.page.evaluate(() => showPage('inventory'));
    await waitUntil(t.page, () => !!document.querySelector('#v31InvTools button[data-act="stockReports"]'));
    await t.page.click('#v31InvTools button[data-act="stockReports"]');
    await waitUntil(t.page, () => /Stock value at cost/.test((document.getElementById('v31SheetBody') || {}).textContent || ''));
    await t.page.click('#v31SheetBody button[data-tab="reorder"]');
    await waitUntil(t.page, () => /Chlorhexidine/.test(document.getElementById('v31SheetBody').textContent));
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('medicine search: type to find, barcode scanner adds straight to the cart', async () => {
  const t = await v31();
  try {
    await t.login('owner', t.temp.owner, OWNER_PW);
    await waitUntil(t.page, () => document.body.classList.contains('v31'));
    const tok = await t.page.evaluate(() => API.token());
    assert.equal(t.g.post({ action: 'updateMedicine', token: tok, id: '1001', barcode: '8901234567890', genericName: 'Acetaminophen' }).success, true);
    await t.page.evaluate(() => loadData());
    await t.page.evaluate(() => showPage('newbill'));
    const s = '#newbill .v-med-search input';
    await t.page.fill(s, 'acetamin');
    await waitUntil(t.page, () => /Paracetamol 500mg/.test(document.querySelector('#newbill .v-med-search .v-pick').textContent));
    await t.page.press(s, 'Enter');
    assert.equal(await t.page.evaluate(() => medicines.find(m => m.id == document.getElementById('medicineSelect').value).name), 'Paracetamol 500mg');
    await t.page.fill(s, '8901234567890'); await t.page.press(s, 'Enter');           // what a USB scanner types
    await t.page.fill(s, '8901234567890'); await t.page.press(s, 'Enter');
    assert.equal(await t.page.evaluate(() => cart.length === 1 && cart[0].qty), 2);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('XSS: names with HTML from the server never run as code on the new screens', async () => {
  const evil = '<img src=x onerror="window.__xss=1">';
  const data = () => { const d = legacyData(); d.Patients.push(['PT-X', evil, '9000000001', '30', 'M', '', '', 250, evil, 'Active', '2026-10-01', '2026-10-01']); return d; };
  const t = await setup(undefined, { v31: true, data });
  try {
    await t.login('owner', t.temp.owner, OWNER_PW);
    await waitUntil(t.page, () => document.body.classList.contains('v31'));
    const tok = await t.page.evaluate(() => API.token());
    t.g.post({ action: 'saveBill', token: tok, billId: 'BILL-XSS0000001', patientName: evil, phone: '9000000001', items: JSON.stringify([{ medicineId: '1001', medicineName: 'x', qty: 1, price: 10, amount: 10 }]), subtotal: '10', discount: '0', total: '10', paymentMode: 'Credit' });
    t.g.post({ action: 'saveFollowUp', token: tok, id: 'FU-X', patientName: evil, dueDate: '2026-10-01', reason: evil });
    t.g.post({ action: 'saveSupplier', token: tok, name: evil });
    await t.page.evaluate(() => loadData());
    for (const pg of ['payments', 'followups', 'suppliers', 'patients', 'allbills', 'dashboard', 'finance']) {
      await t.page.evaluate(p => showPage(p), pg);
      await new Promise(r => setTimeout(r, 300));
    }
    await t.page.evaluate(() => V31.clinic.openRecords('PT-X'));
    await new Promise(r => setTimeout(r, 400));
    await t.page.evaluate(() => V31.money.openDetail('BILL', 'BILL-XSS0000001'));
    await new Promise(r => setTimeout(r, 400));
    assert.equal(await t.page.evaluate(() => window.__xss), undefined);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
