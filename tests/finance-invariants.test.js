// Financial accuracy under a long, mixed day of work: bills paid in full / in part / later, collections,
// cancelled collections, returns with and without restocking, allowances, dental receipts, cancelled bills.
// An independent "oracle" in this file keeps its own books; at the end the server must agree with it to
// the paisa, stock must match, and the server's own consistency check must find nothing.
//   node --test tests/finance-invariants.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas, legacyData } = require('./gas-mock');

const SS = '1rOwubjghrsuWiGXR8X1A1841_8yd-cmMQIj44QBqNaA';
const r2 = x => Math.round((+x || 0) * 100) / 100;

function rng(seed) {             // small deterministic generator, so a failure can be replayed
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function setup() {
  const g = createGas(); g.addSpreadsheet(SS, legacyData());
  g.run('migrateToV3'); g.run('migrateToV31');
  const temp = {}; g.logs.join('\n').replace(/(owner|staff)\s*:\s*(\S+)/g, (_, u, p) => { temp[u] = p; });
  const tok = {};
  for (const u of ['owner', 'staff']) {
    const l = g.post({ action: 'login', username: u, password: temp[u] });
    g.post({ action: 'changePassword', token: l.token, oldPassword: temp[u], newPassword: u === 'owner' ? 'Clinic#Owner2026' : 'Reception#2026' });
    tok[u] = l.token;
  }
  const as = who => body => g.post(Object.assign({ token: tok[who] }, body));
  return { g, owner: as('owner'), staff: as('staff') };
}

for (const seed of [7, 2026, 90210]) {
  test('books balance after a random day of billing, collections, returns and cancellations (seed ' + seed + ')', () => {
    const t = setup(), rnd = rng(seed), pick = a => a[Math.floor(rnd() * a.length)], int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const PRICE = { 1001: 10, 1002: 25, 1003: 120 };
    // stock in: one purchase invoice
    const inv = t.owner({ action: 'addPurchaseInvoice', id: 'PINV-1', supplierName: 'Test Pharma', invoiceNo: 'TP-1',
      lines: JSON.stringify([{ medicineId: '1002', qty: 200, costPrice: 11, batchNo: 'A1', expiry: '2028-01-31' }, { medicineId: '1003', qty: 60, costPrice: 70, batchNo: 'C1', expiry: '2028-01-31' }]), paidAmount: 0 });
    assert.equal(inv.success, true, inv.error);
    const startStock = Object.fromEntries(t.owner({ action: 'getAllData' }).medicines.map(m => [m.id, m.stock]));
    const stock = Object.assign({}, startStock);
    const book = {};            // oracle: id → { type, T, P, R, F, sold: {med: qty}, returned: {med: qty}, cancelled, payments: [] }
    const collections = [];     // oracle list of live collections
    const refunds = [];         // money paid back
    const done = { bill: 0, receipt: 0, collect: 0, cancelCollection: 0, return: 0, allowance: 0, cancelBill: 0 };
    let n = 0;

    for (let step = 0; step < 70; step++) {
      const ids = Object.keys(book).filter(id => !book[id].cancelled);
      const op = step < 6 ? 'bill' : pick(['bill', 'bill', 'bill', 'receipt', 'collect', 'collect', 'return', 'allowance', 'cancelCollection', 'cancelBill']);
      if (op === 'bill') {
        const id = 'BILL-77' + String(++n).padStart(11, '0');
        const items = [], sold = {};
        for (const med of [1001, 1002, 1003]) if (rnd() < 0.6) { const q = int(1, 3); if (stock[med] >= q) { items.push({ medicineId: String(med), medicineName: 'x', qty: q, price: PRICE[med], amount: q * PRICE[med] }); sold[med] = q; } }
        if (!items.length) continue;
        const sub = items.reduce((a, i) => a + i.amount, 0), disc = rnd() < 0.3 ? r2(sub * 0.05) : 0, T = r2(sub - disc);
        const kind = pick(['full', 'part', 'later']), P = kind === 'full' ? T : kind === 'later' ? 0 : r2(Math.max(1, Math.floor(T / 2)));
        const mode = kind === 'later' ? 'Credit' : pick(['Cash', 'UPI']);
        const res = t.staff({ action: 'saveBill', billId: id, patientName: 'P' + n, phone: '90000000' + String(n).padStart(2, '0'), doctor: 'Dr. T. Venkat Rao',
          items: JSON.stringify(items), subtotal: sub.toFixed(2), discount: disc.toFixed(2), total: T.toFixed(2),
          paymentMode: mode, paidAmount: kind === 'full' ? undefined : P });
        assert.equal(res.success, true, 'bill ' + id + ': ' + res.error);
        book[id] = { type: 'BILL', T, P, R: 0, F: 0, sub, sold, returned: {}, cancelled: false, P0: P, mode };
        for (const m in sold) stock[m] -= sold[m];
        done.bill++;
      } else if (op === 'receipt') {
        const id = 'TR-77' + String(++n).padStart(6, '0'), T = int(3, 40) * 100, P = pick([T, 0, T / 2]);
        const res = t.staff({ action: 'saveTreatmentReceipt', recordId: id, receiptNo: 'R' + n, patient: 'P' + n, doctor: 'Dr. T. Sai Vakula', amount: String(T),
          paymentMode: P === 0 ? 'Credit' : 'Cash', paidAmount: P === T ? undefined : P });
        assert.equal(res.success, true, res.error);
        book[id] = { type: 'RECEIPT', T, P, R: 0, F: 0, sold: {}, returned: {}, cancelled: false, P0: P, mode: 'Cash' };
        done.receipt++;
      } else if (op === 'collect') {
        const due = ids.filter(id => bal(book[id]) > 0.009); if (!due.length) continue;
        const id = pick(due), b = book[id], amt = rnd() < 0.5 ? bal(b) : r2(Math.max(1, Math.floor(bal(b) / 2)));
        const cmode = pick(['Cash', 'UPI']);
        const res = t.staff({ action: 'recordPayment', againstType: b.type, againstId: id, amount: amt, mode: cmode });
        assert.equal(res.success, true, res.error);
        b.P = r2(b.P + amt); collections.push({ id: res.paymentId, inv: id, amt, mode: cmode });
        // over-collection is always refused
        const over = t.staff({ action: 'recordPayment', againstType: b.type, againstId: id, amount: r2(bal(b) + 5), mode: 'Cash' });
        assert.equal(over.success, false);
        done.collect++;
      } else if (op === 'cancelCollection') {
        const c = collections.filter(x => !book[x.inv].cancelled && !book[x.inv].R).pop(); if (!c) continue;
        const res = t.owner({ action: 'cancelPayment', paymentId: c.id, reason: 'typed by mistake' });
        assert.equal(res.success, true, res.error);
        book[c.inv].P = r2(book[c.inv].P - c.amt); collections.splice(collections.indexOf(c), 1);
        done.cancelCollection++;
      } else if (op === 'return') {
        const cand = ids.filter(id => book[id].type === 'BILL' && Object.keys(book[id].sold).some(m => book[id].sold[m] > (book[id].returned[m] || 0))); if (!cand.length) continue;
        const id = pick(cand), b = book[id], med = pick(Object.keys(b.sold).filter(m => b.sold[m] > (b.returned[m] || 0)));
        const q = int(1, b.sold[med] - (b.returned[med] || 0)), restock = rnd() < 0.7;
        const res = t.owner({ action: 'returnRefund', againstType: 'BILL', againstId: id, items: JSON.stringify([{ medicineId: med, qty: q }]), restock, reason: 'patient returned', mode: 'Cash' });
        const value = r2(q * PRICE[med] * (b.T / b.sub));
        if (value > r2(b.T - b.R) + 0.01) { assert.equal(res.success, false, 'a return worth more than what is left on the bill is refused'); continue; }
        assert.equal(res.success, true, res.error);
        assert.ok(Math.abs(res.creditValue - value) <= 0.01, 'credit value ' + res.creditValue + ' vs ' + value);
        applyReturn(b, res.creditValue, res.refundAmount); refunds.push({ amt: res.refundAmount, mode: 'Cash' });
        b.returned[med] = (b.returned[med] || 0) + q; if (restock) stock[med] += q;
        done.return++;
      } else if (op === 'allowance') {
        const cand = ids.filter(id => (book[id].T - book[id].R) > 50); if (!cand.length) continue;
        const id = pick(cand), b = book[id], x = int(1, 4) * 10;
        const res = t.owner({ action: 'returnRefund', againstType: b.type, againstId: id, allowance: x, reason: 'goodwill', mode: 'UPI' });
        assert.equal(res.success, true, res.error);
        assert.equal(res.creditValue, x);
        applyReturn(b, x, res.refundAmount); refunds.push({ amt: res.refundAmount, mode: 'UPI' });
        done.allowance++;
      } else if (op === 'cancelBill') {
        const cand = ids.filter(id => book[id].type === 'BILL' && !book[id].R && !collections.some(c => c.inv === id)); if (!cand.length) continue;
        const id = pick(cand), b = book[id];
        const res = t.owner({ action: 'cancelBill', billId: id, reason: 'entered twice', restoreStock: true });
        assert.equal(res.success, true, res.error);
        b.cancelled = true; for (const m in b.sold) stock[m] += b.sold[m];
        done.cancelBill++;
      }
    }

    function bal(b) { return r2((b.T - b.R) - (b.P - b.F)); }
    function applyReturn(b, credit, refundSaid) {
      b.R = r2(b.R + credit);
      const refund = r2(Math.max(0, (b.P - b.F) - (b.T - b.R)));
      assert.ok(Math.abs(refund - refundSaid) <= 0.01, 'refund ' + refundSaid + ' vs expected ' + refund);
      b.F = r2(b.F + refund);
    }

    // a real mix happened (not mostly skipped steps)
    assert.ok(done.bill >= 12 && done.collect >= 4 && done.return + done.allowance >= 4 && done.receipt >= 2, JSON.stringify(done));

    // ── the server agrees with the oracle ──
    const all = t.owner({ action: 'getAllData' });
    const live = Object.keys(book).filter(id => !book[id].cancelled);
    for (const id of live) {
      const b = book[id];
      const s = b.type === 'BILL' ? all.bills.find(x => x.billId === id) : all.treatmentReceipts.find(x => x.recordId === id);
      assert.ok(s, id + ' on the server');
      assert.ok(Math.abs((s.balanceDue || 0) - bal(b)) <= 0.01, id + ' balance ' + s.balanceDue + ' vs ' + bal(b));
      assert.ok(bal(b) >= -0.001, id + ' never negative');
    }
    for (const id of Object.keys(book).filter(id => book[id].cancelled)) assert.ok(!all.bills.some(x => x.billId === id), id + ' cancelled → not in sales');
    const owed = r2(live.reduce((a, id) => a + Math.max(0, bal(book[id])), 0));
    const serverOwed = r2((all.receivables || []).reduce((a, r) => a + r.balance, 0));
    assert.ok(Math.abs(owed - serverOwed) <= 0.01, 'patients owe ' + serverOwed + ' vs ' + owed);
    for (const m of ['1001', '1002', '1003']) assert.equal(all.medicines.find(x => String(x.id) === m).stock, stock[m], 'stock of ' + m);
    const v = t.owner({ action: 'validateData' });
    assert.equal(v.count, 0, JSON.stringify(v.issues));
    // the day's cash summary counts every rupee in and out exactly once (cancelled bills and collections excluded)
    const cs = t.staff({ action: 'getCashSummary' });
    assert.equal(cs.success, true, cs.error);
    const sum = (list, mode) => r2(list.filter(x => x.mode === mode).reduce((a, x) => a + x.amt, 0));
    const initial = Object.keys(book).filter(id => !book[id].cancelled).map(id => ({ amt: book[id].P0, mode: book[id].mode, type: book[id].type }));
    const S = cs.summary;
    assert.equal(S.bills.cash, sum(initial.filter(x => x.type === 'BILL'), 'Cash'), 'bills cash');
    assert.equal(S.bills.upi, sum(initial.filter(x => x.type === 'BILL'), 'UPI'), 'bills UPI');
    assert.equal(S.receipts.cash, sum(initial.filter(x => x.type === 'RECEIPT'), 'Cash'), 'receipts cash');
    assert.equal(S.collections.cash, sum(collections, 'Cash'), 'collections cash');
    assert.equal(S.collections.upi, sum(collections, 'UPI'), 'collections UPI');
    assert.equal(S.refunds.cash, sum(refunds, 'Cash'), 'refunds cash');
    assert.equal(S.refunds.upi, sum(refunds, 'UPI'), 'refunds UPI');
    assert.equal(S.cashIn, r2(S.bills.cash + S.receipts.cash + S.collections.cash));
    assert.equal(S.cashOut, r2(S.refunds.cash + S.expenses.cash + S.suppliers.cash));
    const pays = t.g.spreadsheets[SS].getSheetByName('Payments').rows.slice(1).filter(r => r && r[0]);
    assert.ok(pays.length >= 3, 'payments recorded');
  });
}
