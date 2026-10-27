// Backend tests: run the real apps-script/Code.gs against simulated Google services.
//   node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas, legacyData } = require('./gas-mock');

const SS = '1rOwubjghrsuWiGXR8X1A1841_8yd-cmMQIj44QBqNaA';
const STRONG_OWNER = 'Clinic#Owner2026';
const STRONG_STAFF = 'Reception#2026';

// Fresh migrated system with both passwords already changed; returns helpers.
function setup() {
  const g = createGas();
  g.addSpreadsheet(SS, legacyData());
  g.run('migrateToV3');
  const temp = {};
  g.logs.join('\n').replace(/(owner|staff)\s*:\s*(\S+)/g, (_, u, p) => { temp[u] = p; });
  const login = (u, p) => g.post({ action: 'login', username: u, password: p });
  let o = login('owner', temp.owner); assert.equal(o.success, true, JSON.stringify(o));
  assert.equal(g.post({ action: 'changePassword', token: o.token, oldPassword: temp.owner, newPassword: STRONG_OWNER }).success, true);
  let s = login('staff', temp.staff);
  assert.equal(g.post({ action: 'changePassword', token: s.token, oldPassword: temp.staff, newPassword: STRONG_STAFF }).success, true);
  const owner = (body) => g.post(Object.assign({ token: o.token }, body));
  const staff = (body) => g.post(Object.assign({ token: s.token }, body));
  const sheet = (n) => g.spreadsheets[SS].getSheetByName(n);
  const rows = (n) => sheet(n).rows.filter(r => r && r.some(v => v !== '' && v != null));
  const all = (who) => who({ action: 'getAllData' });
  const med = (data, id) => data.medicines.find(m => String(m.id) === String(id));
  return { g, temp, login, owner, staff, sheet, rows, all, med, tokens: { owner: o.token, staff: s.token } };
}
const bill = (id, items, extra) => Object.assign({ action: 'saveBill', billId: id, patientName: 'Test Patient', doctor: 'Dr. T. Venkat Rao', phone: '9000000000',
  items: JSON.stringify(items), subtotal: items.reduce((a, i) => a + i.qty * i.price, 0).toFixed(2), discount: '0',
  total: items.reduce((a, i) => a + i.qty * i.price, 0).toFixed(2), paymentMode: 'Cash' }, extra || {});
const item = (medicineId, qty, price, name) => ({ medicineId, medicineName: name || 'x', qty, price, amount: qty * price });

// ═════════════════ MIGRATION ═════════════════
test('before migration: API refuses; GET is closed; ping works', () => {
  const g = createGas(); g.addSpreadsheet(SS, legacyData());
  assert.equal(g.post({ action: 'getAllData' }).code, 'MIGRATION_REQUIRED');
  assert.equal(g.get({ action: 'getAllData' }).code, 'USE_POST');
  assert.equal(g.get({ action: 'ping' }).success, true);
});

test('dry run changes nothing; migration keeps every old cell, backs up first, is re-runnable', () => {
  const g = createGas(); g.addSpreadsheet(SS, legacyData());
  const before = JSON.stringify(g.spreadsheets[SS].sheets.map(s => [s.name, s.rows]));
  g.run('migrateToV3DryRun');
  assert.equal(JSON.stringify(g.spreadsheets[SS].sheets.map(s => [s.name, s.rows])), before, 'dry run must not write');
  assert.match(g.logs.join('\n'), /OPENING batch for 3 medicine/);

  g.run('migrateToV3');
  const backups = Object.values(g.driveFiles).filter(f => /pre-migration/.test(f.name));
  assert.equal(backups.length, 1, 'verified backup made before changes');
  const orig = legacyData();
  for (const [name, data] of Object.entries(orig)) {
    const sh = g.spreadsheets[SS].getSheetByName(name);
    data.forEach((row, r) => row.forEach((v, c) => assert.equal(sh.rows[r][c], v, `${name}!R${r + 1}C${c + 1} changed`)));
  }
  const batches = g.spreadsheets[SS].getSheetByName('Batches').rows.slice(1);
  assert.equal(batches.length, 3);
  assert.deepEqual(batches.map(b => [b[1], b[4], b[3]]), [['1001', 100, '2027-06-30'], ['1002', 40, '2027-01-31'], ['1003', 0, '2026-12-31']]);
  assert.equal(g.mails.filter(m => /temporary passwords/.test(m.subj)).length, 1, 'temp passwords e-mailed');
  // re-run: no duplicate batches / users
  g.run('migrateToV3');
  assert.equal(g.spreadsheets[SS].getSheetByName('Batches').rows.slice(1).filter(r => r[0]).length, 3);
  assert.equal(g.spreadsheets[SS].getSheetByName('Users').rows.slice(1).filter(r => r[0]).length, 2);
});

test('migration aborts (no changes) if the backup fails', () => {
  const g = createGas(); g.addSpreadsheet(SS, legacyData());
  g.failNextCopy();
  assert.throws(() => g.run('migrateToV3'), /quota/);
  assert.equal(g.spreadsheets[SS].getSheetByName('Users'), null);
  assert.equal(g.props.SCHEMA_VERSION, undefined);
});

// ═════════════════ AUTHENTICATION ═════════════════
test('login: wrong password, lockout after 5, must-change-password gate, weak password rejected', () => {
  const g = createGas(); g.addSpreadsheet(SS, legacyData()); g.run('migrateToV3');
  const temp = {}; g.logs.join('\n').replace(/(owner|staff)\s*:\s*(\S+)/g, (_, u, p) => { temp[u] = p; });
  assert.equal(g.post({ action: 'login', username: 'owner', password: '123.456' }).code, 'LOGIN_FAILED', 'old public password no longer works');
  for (let i = 0; i < 3; i++) assert.equal(g.post({ action: 'login', username: 'staff', password: 'nope' }).code, 'LOGIN_FAILED');
  assert.equal(g.post({ action: 'login', username: 'staff', password: 'nope' }).code, 'LOGIN_FAILED');
  assert.equal(g.post({ action: 'login', username: 'staff', password: 'nope' }).code, 'LOCKED', '5th failure locks');
  assert.equal(g.post({ action: 'login', username: 'staff', password: temp.staff }).code, 'LOCKED', 'correct password refused while locked');

  const o = g.post({ action: 'login', username: 'OWNER', password: temp.owner });
  assert.equal(o.success, true); assert.equal(o.user.role, 'OWNER'); assert.equal(o.user.mustChangePassword, true);
  assert.equal(g.post({ action: 'getAllData', token: o.token }).code, 'MUST_CHANGE_PASSWORD');
  assert.equal(g.post({ action: 'changePassword', token: o.token, oldPassword: temp.owner, newPassword: '12345678' }).code, 'VALIDATION');
  assert.equal(g.post({ action: 'changePassword', token: o.token, oldPassword: 'wrong', newPassword: STRONG_OWNER }).code, 'VALIDATION');
  assert.equal(g.post({ action: 'changePassword', token: o.token, oldPassword: temp.owner, newPassword: STRONG_OWNER }).success, true);
  assert.equal(g.post({ action: 'getAllData', token: o.token }).success, true, 'same device stays logged in after change');
  const audit = g.spreadsheets[SS].getSheetByName('AuditLog').rows.slice(1).map(r => r[3] + ':' + r[6]);
  assert.ok(audit.includes('login:FAILED') && audit.includes('login:OK') && audit.includes('changePassword:OK'));
  const users = g.spreadsheets[SS].getSheetByName('Users').rows.slice(1);
  users.forEach(u => { assert.ok(!String(u[2]).includes(temp.owner) && String(u[2]).length === 64, 'stored as hash'); });
});

test('session: missing/forged/expired tokens rejected; logout ends session', () => {
  const t = setup();
  assert.equal(t.g.post({ action: 'getAllData' }).code, 'AUTH_REQUIRED');
  assert.equal(t.g.post({ action: 'getAllData', token: 'x'.repeat(64) }).code, 'AUTH_REQUIRED');
  const key = 'S_' + t.tokens.staff, s = JSON.parse(t.g.cache[key].v);
  s.last = Date.now() - 4 * 3600 * 1000; t.g.cache[key].v = JSON.stringify(s);
  assert.equal(t.staff({ action: 'getAllData' }).code, 'AUTH_REQUIRED', 'idle > 3h');
  assert.equal(t.owner({ action: 'logout' }).success, true);
  assert.equal(t.owner({ action: 'getAllData' }).code, 'AUTH_REQUIRED');
});

test('owner resets / disables staff → staff sessions end immediately', () => {
  const t = setup();
  assert.equal(t.staff({ action: 'whoami' }).success, true);
  assert.equal(t.owner({ action: 'resetUserPassword', username: 'staff', newPassword: 'Temp#Pass99' }).success, true);
  assert.equal(t.staff({ action: 'whoami' }).code, 'AUTH_REQUIRED');
  const s2 = t.login('staff', 'Temp#Pass99'); assert.equal(s2.user.mustChangePassword, true);
  assert.equal(t.owner({ action: 'setUserActive', username: 'staff', active: false }).success, true);
  assert.equal(t.login('staff', 'Temp#Pass99').code, 'LOGIN_FAILED');
  assert.equal(t.owner({ action: 'setUserActive', username: 'owner', active: false }).code, 'VALIDATION', 'cannot disable yourself');
  assert.equal(t.owner({ action: 'createUser', username: 'Reception 2', password: 'Abcdefgh#1' }).code, 'VALIDATION');
  assert.equal(t.owner({ action: 'createUser', username: 'reception2', password: 'Abcdefgh#1', role: 'STAFF' }).success, true);
  assert.equal(t.owner({ action: 'listUsers' }).users.length, 3);
});

// ═════════════════ PERMISSIONS ═════════════════
test('staff: server refuses owner-only actions and hides financial data', () => {
  const t = setup();
  for (const a of [{ action: 'cancelBill', billId: 'BILL-1700000000001', reason: 'test' }, { action: 'deleteBill', billId: 'BILL-1700000000001' },
    { action: 'addPurchase', medicineId: '1001', qty: 1, costPrice: 1 }, { action: 'deletePatient', id: 'PT-1' }, { action: 'adjustStock', medicineId: '1001', qty: 5, reason: 'x' },
    { action: 'updateMedicine', id: 1001, price: 1 }, { action: 'saveExpense', id: 'E9', amount: 5 }, { action: 'listUsers' }, { action: 'getAuditLog' },
    { action: 'saveSettings', settingKey: 'staff_max_discount_pct', settingValue: '100' }, { action: 'backupNow' }]) {
    assert.equal(t.staff(a).code, 'FORBIDDEN', a.action);
  }
  assert.equal(t.staff({ action: 'saveSettings', settingKey: 'wa_templates', settingValue: '{"a":1}' }).success, true);
  const d = t.all(t.staff);
  assert.equal(d.role, 'STAFF');
  assert.ok(d.medicines.every(m => m.costPrice === undefined && m.batches === undefined));
  assert.equal(d.purchases.length, 0); assert.equal(d.expenses.length, 0);
  assert.ok(d.bills.every(b => b.costTotal === undefined && b.items.every(i => i.costPrice === undefined)));
  const audit = t.rows('AuditLog').map(r => r[6]);
  assert.ok(audit.filter(x => x === 'DENIED').length >= 10);
});

// ═════════════════ BILLING ═════════════════
test('bill: server totals, FEFO batch, COGS from batch cost, bill number, movement, stock', () => {
  const t = setup();
  const r = t.staff(bill('BILL-2000000000001', [item(1001, 3, 10, 'Paracetamol 500mg')]));
  assert.equal(r.success, true, JSON.stringify(r)); assert.equal(r.billNo, 'SSDC-' + new Date().getFullYear().toString().slice(2) + '-00001');
  assert.equal(r.total, 30); assert.equal(r.costTotal, 12);
  assert.equal(t.med(t.all(t.owner), 1001).stock, 97);
  const mv = t.rows('StockMovements').filter(m => m[7] === 'BILL-2000000000001');
  assert.equal(mv.length, 1); assert.equal(mv[0][5], -3); assert.equal(mv[0][6], 'SALE');
  const r2 = t.staff(bill('BILL-2000000000002', [item(1002, 1, 25)]));
  assert.ok(r2.billNo.endsWith('00002'));
});

test('bill: multiple batches FEFO, expired batch never sold, shortfall recorded not hidden', () => {
  const t = setup();
  // Paracetamol: OPENING 100 (exp 2027-06), add batch A exp 2027-01 (sold first) and an EXPIRED batch
  assert.equal(t.owner({ action: 'addPurchase', id: 'P-A', medicineId: '1001', qty: 10, costPrice: 3, batchNo: 'A', expiry: '2027-01-15', supplier: 'S' }).success, true);
  assert.equal(t.owner({ action: 'addPurchase', id: 'P-X', medicineId: '1001', qty: 50, costPrice: 1, batchNo: 'X', expiry: '2020-01-01', supplier: 'S' }).success, true);
  let d = t.all(t.owner), m = t.med(d, 1001);
  assert.equal(m.stock, 110, 'sellable excludes expired'); assert.equal(m.expiredStock, 50);
  assert.equal(m.batches[0].batchNo, 'X', 'expired listed first for removal');
  const r = t.owner(bill('BILL-2000000000010', [item(1001, 15, 10)]));
  assert.equal(r.costTotal, 10 * 3 + 5 * 4, 'batch A (cost 3) first, then OPENING (cost 4)');
  const sale = t.rows('StockMovements').filter(x => x[7] === 'BILL-2000000000010');
  assert.deepEqual(sale.map(x => x[5]), [-10, -5]);
  d = t.all(t.owner); m = t.med(d, 1001);
  assert.equal(m.stock, 95); assert.equal(m.expiredStock, 50, 'expired untouched');
  // shortfall: Chlorhexidine has 0 stock
  const s = t.staff(bill('BILL-2000000000011', [item(1003, 2, 120)]));
  assert.equal(s.success, true); assert.ok(s.warnings.some(w => /shortfall/.test(w)));
  assert.ok(t.rows('StockMovements').some(x => x[7] === 'BILL-2000000000011' && x[6] === 'SALE_UNALLOCATED'));
  assert.ok(t.rows('AuditLog').some(x => x[3] === 'saveBill' && x[6] === 'WARN'));
});

test('bill validation: bad qty/price/totals/discount/unknown medicine are rejected', () => {
  const t = setup();
  const bad = [
    bill('BILL-3000000000001', [item(1001, 0, 10)]),
    bill('BILL-3000000000002', [item(1001, -2, 10)]),
    bill('BILL-3000000000003', [item(1001, 1.5, 10)]),
    bill('BILL-3000000000004', [item(1001, 2, -10)]),
    bill('BILL-3000000000005', [item(999999, 1, 10)]),
    bill('BILL-3000000000006', [item(1001, 2, 10)], { total: '5.00' }),
    bill('BILL-3000000000007', [item(1001, 2, 10)], { subtotal: '30.00' }),
    bill('BILL-3000000000008', [item(1001, 10, 10)], { discount: '20', total: '80.00' }),        // 20 % > staff 10 %
    bill('BILL-3000000000009', [item(1001, 1, 10)], { discount: '15', total: '-5.00' }),
    bill('BILL-3000000000010', []),
    bill('BILL-3000000000011', [Object.assign(item(1001, 2, 10), { amount: 25 })]),
    bill('BILL-3000000000012', [item(1001, 2, 10)], { paymentMode: 'Bitcoin' }),
    bill('BILL-3000000000013', [item(1001, 2, 10)], { paymentMode: 'Split', cashAmount: 5, upiAmount: 5 }),
    Object.assign(bill('BILL-3000000000014', [item(1001, 1, 10)]), { patientName: '  ' }),
  ];
  bad.forEach((b, i) => { const r = t.staff(b); assert.equal(r.code, 'VALIDATION', `case ${i + 1}: ${JSON.stringify(r)}`); });
  assert.equal(t.rows('Bills').length, 3, 'nothing written');
  assert.equal(t.med(t.all(t.owner), 1001).stock, 100, 'no stock moved');
  // allowed: staff 10 % exactly, owner 50 %
  assert.equal(t.staff(bill('BILL-3000000000020', [item(1001, 10, 10)], { discount: '10.00', total: '90.00' })).success, true);
  assert.equal(t.owner(bill('BILL-3000000000021', [item(1001, 10, 10)], { discount: '50.00', total: '50.00' })).success, true);
  // owner can raise the staff limit
  assert.equal(t.owner({ action: 'saveSettings', settingKey: 'staff_max_discount_pct', settingValue: '25' }).success, true);
  assert.equal(t.staff(bill('BILL-3000000000022', [item(1001, 10, 10)], { discount: '20.00', total: '80.00' })).success, true);
});

test('duplicate prevention: same bill ID or same request ID never bills/deducts twice', () => {
  const t = setup();
  const b = bill('BILL-4000000000001', [item(1001, 5, 10)], { reqId: 'req-abc' });
  const first = t.staff(b), again = t.staff(b), sameBillOtherReq = t.staff(Object.assign({}, b, { reqId: 'req-zzz' }));
  assert.equal(first.success, true); assert.deepEqual(again, first);
  assert.equal(sameBillOtherReq.duplicate, true); assert.equal(sameBillOtherReq.billNo, first.billNo);
  assert.equal(t.rows('Bills').filter(r => r[0] === 'BILL-4000000000001').length, 1);
  assert.equal(t.rows('BillItems').filter(r => r[0] === 'BILL-4000000000001').length, 1);
  assert.equal(t.med(t.all(t.owner), 1001).stock, 95);
});

test('split payment stored with amounts; Split read back as Split (was Cash)', () => {
  const t = setup();
  const r = t.staff(bill('BILL-5000000000001', [item(1002, 2, 25)], { paymentMode: 'Split', cashAmount: 20, upiAmount: 30, paymentRef: 'UPI123' }));
  assert.equal(r.success, true);
  const b = t.all(t.owner).bills.find(x => x.billId === 'BILL-5000000000001');
  assert.equal(b.paymentMode, 'Split'); assert.equal(b.cashAmount, 20); assert.equal(b.upiAmount, 30); assert.equal(b.paymentRef, 'UPI123');
});

test('cancel bill: owner only, reason required, stock back to same batches, idempotent, excluded from revenue', () => {
  const t = setup();
  t.staff(bill('BILL-6000000000001', [item(1001, 7, 10)]));
  assert.equal(t.owner({ action: 'cancelBill', billId: 'BILL-6000000000001', reason: '' }).code, 'VALIDATION');
  assert.equal(t.owner({ action: 'cancelBill', billId: 'BILL-6000000000001', reason: 'Wrong patient' }).success, true);
  assert.equal(t.owner({ action: 'cancelBill', billId: 'BILL-6000000000001', reason: 'Wrong patient' }).alreadyCancelled, true);
  const d = t.all(t.owner);
  assert.equal(t.med(d, 1001).stock, 100);
  assert.ok(!d.bills.some(b => b.billId === 'BILL-6000000000001'));
  assert.equal(d.cancelledBills.find(b => b.billId === 'BILL-6000000000001').cancelReason, 'Wrong patient');
  assert.equal(t.rows('Bills').filter(r => r[0] === 'BILL-6000000000001').length, 1, 'row kept, not deleted');
  // legacy pre-v3 bill (no allocation) via old deleteBill action
  assert.equal(t.owner({ action: 'deleteBill', billId: 'BILL-1700000000002' }).success, true);
  assert.equal(t.med(t.all(t.owner), 1002).stock, 44);
});

// ═════════════════ INVENTORY ═════════════════
test('purchase: batch + expiry + free qty; duplicate invoice line blocked; cancel only if unsold', () => {
  const t = setup();
  const p = t.owner({ action: 'addPurchase', id: 'PUR-77', medicineId: '1003', qty: 10, freeQty: 2, costPrice: 60, batchNo: 'CHX-9', expiry: '2027-09-30', invoiceNo: 'INV-55', supplier: 'Sai Pharma', mrp: 150 });
  assert.equal(p.success, true, JSON.stringify(p));
  assert.equal(t.owner({ action: 'addPurchase', id: 'PUR-77', medicineId: '1003', qty: 10, costPrice: 60 }).duplicate, true);
  assert.equal(t.owner({ action: 'addPurchase', id: 'PUR-78', medicineId: '1003', qty: 10, costPrice: 60, batchNo: 'CHX-9', invoiceNo: 'INV-55' }).code, 'DUPLICATE');
  let m = t.med(t.all(t.owner), 1003);
  assert.equal(m.stock, 12); assert.equal(m.expiry, '2027-09-30');
  assert.equal(m.batches.find(b => b.batchNo === 'CHX-9').cost, 50, 'effective cost includes free qty (600/12)');
  t.staff(bill('BILL-7000000000001', [item(1003, 1, 120)]));
  assert.equal(t.owner({ action: 'cancelPurchase', id: 'PUR-77', reason: 'Entered twice' }).code, 'VALIDATION', 'part sold');
  t.owner({ action: 'cancelBill', billId: 'BILL-7000000000001', reason: 'test' });
  assert.equal(t.owner({ action: 'cancelPurchase', id: 'PUR-77', reason: 'Entered twice' }).success, true);
  m = t.med(t.all(t.owner), 1003);
  assert.equal(m.stock, 0);
  assert.equal(t.all(t.owner).purchases.filter(x => x.id === 'PUR-77').length, 0);
});

test('stock adjustments need a reason, are recorded, and cover expired/damaged/returns', () => {
  const t = setup();
  assert.equal(t.owner({ action: 'adjustStock', medicineId: '1001', qty: -5, type: 'DAMAGED', reason: '' }).code, 'VALIDATION');
  assert.equal(t.owner({ action: 'adjustStock', medicineId: '1001', qty: -5, type: 'DAMAGED', reason: 'Strip torn' }).stock, 95);
  assert.equal(t.owner({ action: 'adjustStock', medicineId: '1001', qty: 2, type: 'CUSTOMER_RETURN', reason: 'Returned unopened' }).stock, 97);
  assert.equal(t.owner({ action: 'adjustStock', medicineId: '1001', qty: -500, type: 'ADJUSTMENT', reason: 'count' }).code, 'VALIDATION');
  assert.equal(t.owner({ action: 'updateMedicine', id: 1001, stock: 5 }).code, 'VALIDATION', 'no silent stock edits');
  assert.equal(t.owner({ action: 'updateMedicine', id: 1001, price: 12, minStock: 20 }).success, true);
  const m = t.med(t.all(t.owner), 1001); assert.equal(m.price, 12); assert.equal(m.minStock, 20);
  const mv = t.owner({ action: 'getStockMovements', medicineId: '1001' }).movements.map(x => x.type);
  assert.deepEqual(mv.slice(0, 3), ['CUSTOMER_RETURN', 'DAMAGED', 'OPENING']);
  assert.equal(t.owner({ action: 'deleteMedicine', id: 1003 }).success, true);
  assert.equal(t.med(t.all(t.owner), 1003), undefined, 'inactive hidden');
  assert.equal(t.rows('Medicines').length, 4, 'row kept');
  assert.equal(t.owner({ action: 'addMedicine', name: 'paracetamol 500MG', price: 10, costPrice: 4 }).duplicate, true);
});

// ═════════════════ CLINIC RECORDS ═════════════════
test('receipt numbers come from the server and continue after the highest existing one', () => {
  const t = setup(), y = new Date().getFullYear();
  t.sheet('TreatmentReceipts').rows.push([y + '-0041', '2026-10-06', 'A', '', 100, '', '', '']);
  const a = t.staff({ action: 'reserveReceiptNo' }).receiptNo, b = t.owner({ action: 'reserveReceiptNo' }).receiptNo;
  assert.equal(a, y + '-0042'); assert.equal(b, y + '-0043');
});

test('treatment receipts / prescriptions / exam forms: duplicate-safe, soft delete by record ID only', () => {
  const t = setup();
  const tr = { action: 'saveTreatmentReceipt', recordId: 'TR-1', receiptNo: '2026-0100', patient: 'Asha', amount: 1500, treatments: 'Scaling', paymentMode: 'UPI' };
  assert.equal(t.staff(tr).success, true); assert.equal(t.staff(tr).duplicate, true);
  assert.equal(t.all(t.owner).treatmentReceipts.find(x => x.recordId === 'TR-1').paymentMode, 'UPI');
  assert.equal(t.owner({ action: 'deleteTreatmentReceipt', recordId: 'TR-1' }).success, true);
  assert.equal(t.all(t.owner).treatmentReceipts.find(x => x.recordId === 'TR-1'), undefined);
  assert.equal(t.rows('TreatmentReceipts').filter(r => r[0] === '2026-0100').length, 1, 'kept in sheet');
  assert.equal(t.owner({ action: 'deletePrescription', patientName: 'Ravi Kumar' }).code, 'VALIDATION', 'no more delete-by-name');
  assert.equal(t.rows('Prescriptions').length, 2);
  assert.equal(t.staff({ action: 'savePrescription', recordId: 'RX-1', patientName: 'Asha', prescription: 'Rx' }).success, true);
  assert.equal(t.owner({ action: 'deletePrescription', recordId: 'RX-1' }).success, true);
  assert.equal(t.staff({ action: 'saveExamForm', recordId: 'EF-1', patient: 'Asha', final_diag: 'Caries 36' }).success, true);
  assert.equal(t.staff({ action: 'saveExamForm', recordId: 'EF-1', patient: 'Asha' }).duplicate, true);
});

test('appointments: same doctor + slot blocked, other doctor allowed; patients soft-deleted', () => {
  const t = setup();
  const a = { action: 'saveAppointment', id: 'A2', patient: 'Asha', date: '2026-11-02', time: '10:30 AM', doctor: 'Dr. T. Venkat Rao' };
  assert.equal(t.staff(a).code, 'DUPLICATE');
  assert.equal(t.staff(Object.assign({}, a, { doctor: 'Dr. T. Sai Vakula' })).success, true);
  assert.equal(t.staff({ action: 'updateAppointmentStatus', id: 'A2', status: 'Completed' }).success, true);
  assert.equal(t.staff({ action: 'deleteAppointment', id: 'A2' }).code, 'FORBIDDEN');
  assert.equal(t.owner({ action: 'deletePatient', id: 'PT-1' }).success, true);
  assert.equal(t.all(t.owner).patients.length, 0); assert.equal(t.rows('Patients').length, 2);
  assert.equal(t.staff({ action: 'savePatient', id: 'PT-2', name: 'New', addedOn: '' }).success, true);
  assert.equal(t.all(t.owner).patients[0].addedOn, t.all(t.owner).today);
});

// ═════════════════ BACKUPS, VALIDATION, CACHE ═════════════════
test('backups: manual verified, scheduled daily + pruning, failure e-mails the owner', () => {
  const t = setup();
  const r = t.owner({ action: 'backupNow' }); assert.equal(r.success, true); assert.equal(r.backup.verified, true);
  for (let i = 0; i < 16; i++) t.g.run('scheduledBackup');
  const daily = Object.values(t.g.driveFiles).filter(f => / daily /.test(f.name) && !f.trashed);
  assert.equal(daily.length, 14, 'keeps 14 daily');
  t.g.failNextCopy(); t.g.run('scheduledBackup');
  assert.ok(t.g.mails.some(m => /backup FAILED/.test(m.subj)));
  const l = t.owner({ action: 'listBackups' }); assert.ok(l.backups.length >= 15);
  t.g.run('installTriggers'); assert.deepEqual(t.g.triggers.sort(), ['scheduledBackup', 'sendDailyStockReport']);
});

test('restoreFromBackup switches to the copy without touching the original', () => {
  const t = setup();
  const b = t.owner({ action: 'backupNow' }).backup;
  t.staff(bill('BILL-8000000000001', [item(1001, 1, 10)]));
  t.g.run('restoreFromBackup', b.fileId);
  assert.equal(t.g.props.SS_ID, b.fileId); assert.equal(t.g.props.PREVIOUS_SS_ID, SS);
  assert.equal(t.rows('Bills').filter(r => r[0] === 'BILL-8000000000001').length, 1, 'original untouched');
});

test('validateData reports stock mismatches and broken references', () => {
  const t = setup();
  t.sheet('Medicines').rows[1][2] = 999;   // someone typed in the sheet
  t.sheet('BillItems').rows.push(['BILL-X', 4242, 'Ghost', 1, 1, 1, 1, '']);
  const r = t.owner({ action: 'validateData' });
  assert.ok(r.issues.some(i => /Stock mismatch Paracetamol/.test(i)));
  assert.ok(r.issues.some(i => /unknown medicine ID 4242/.test(i)));
});

test('getAllData is cached per role and refreshed right after any change', () => {
  const t = setup();
  t.all(t.owner); const before = t.g.stats.reads; t.all(t.owner);
  assert.equal(t.g.stats.reads, before, 'served from cache');
  t.staff(bill('BILL-9000000000001', [item(1001, 1, 10)]));
  assert.ok(t.all(t.owner).bills.some(b => b.billId === 'BILL-9000000000001'), 'fresh after write');
});

test('daily stock e-mail lists expired batches separately and is batch-aware', () => {
  const t = setup();
  t.owner({ action: 'addPurchase', id: 'P-OLD', medicineId: '1002', qty: 5, costPrice: 10, batchNo: 'OLD', expiry: '2021-01-01' });
  t.g.run('sendDailyStockReport');
  const mail = t.g.mails[t.g.mails.length - 1];
  assert.match(mail.html, /Expired — not sellable/); assert.match(mail.html, /OLD/);
});
