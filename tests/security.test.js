// Security checks of the server (Code.gs) — the permission matrix for EVERY action, not just samples.
//   node --test tests/security.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGas, legacyData } = require('./gas-mock');

const SS = '1rOwubjghrsuWiGXR8X1A1841_8yd-cmMQIj44QBqNaA';
const OWNER_PW = 'Clinic#Owner2026', STAFF_PW = 'Reception#2026';

function setup() {
  const g = createGas(); g.addSpreadsheet(SS, legacyData());
  g.run('migrateToV3'); g.run('migrateToV31');
  const temp = {}; g.logs.join('\n').replace(/(owner|staff)\s*:\s*(\S+)/g, (_, u, p) => { temp[u] = p; });
  const login = (u, p) => g.post({ action: 'login', username: u, password: p });
  const o = login('owner', temp.owner);
  g.post({ action: 'changePassword', token: o.token, oldPassword: temp.owner, newPassword: OWNER_PW });
  const s = login('staff', temp.staff);
  g.post({ action: 'changePassword', token: s.token, oldPassword: temp.staff, newPassword: STAFF_PW });
  const snapshot = () => JSON.stringify(Object.fromEntries(g.spreadsheets[SS].sheets
    .filter(sh => sh.name !== 'AuditLog').map(sh => [sh.name, sh.rows])));
  return { g, owner: o.token, staff: s.token, snapshot };
}

test('every action has an explicit permission, and every permission has an action', () => {
  const { g } = setup();
  const perms = Object.keys(g.sandbox.PERMS), actions = Object.keys(g.sandbox.ACTIONS);
  assert.deepEqual(actions.filter(a => !perms.includes(a)), [], 'actions without a permission rule');
  assert.deepEqual(perms.filter(a => !actions.includes(a)), [], 'permission rules without an action');
  assert.ok(actions.length >= 70, actions.length + ' actions');
});

test('no session: every action is refused and nothing changes', () => {
  const t = setup();
  const before = t.snapshot();
  for (const action of Object.keys(t.g.sandbox.ACTIONS)) {
    for (const token of [undefined, '', 'x'.repeat(64), t.owner.slice(0, -1) + (t.owner.endsWith('0') ? '1' : '0')]) {
      const r = t.g.post({ action, token, id: 'X', billId: 'X', name: 'X', amount: 1 });
      assert.equal(r.success, false, action);
      assert.equal(r.code, 'AUTH_REQUIRED', action + ' → ' + r.code);
    }
  }
  assert.equal(t.snapshot(), before);
});

test('staff: every owner-only action is refused on the server, logged, and changes nothing', () => {
  const t = setup();
  const P = t.g.sandbox.PERMS, OWNER = t.g.sandbox.OWNER;
  const ownerOnly = Object.keys(P).filter(a => P[a] === OWNER);
  assert.ok(ownerOnly.length >= 40, ownerOnly.length + ' owner-only actions');
  const before = t.snapshot();
  for (const action of ownerOnly) {
    const r = t.g.post({ action, token: t.staff, id: 'X', billId: 'X', medicineId: '1001', name: 'X', amount: 1, qty: 1, reason: 'test' });
    assert.equal(r.code, 'FORBIDDEN', action + ' → ' + JSON.stringify(r).slice(0, 120));
  }
  // settings: staff may only change the few keys meant for reception
  assert.equal(t.g.post({ action: 'saveSettings', token: t.staff, settingKey: 'staff_max_discount_pct', settingValue: '100' }).code, 'FORBIDDEN');
  assert.equal(t.g.post({ action: 'saveSettings', token: t.staff, settingKey: 'staff_credit_allowed', settingValue: 'true' }).code, 'FORBIDDEN');
  assert.equal(t.snapshot(), before, 'no data changed');
  const denied = t.g.spreadsheets[SS].getSheetByName('AuditLog').rows.filter(r => r && r[6] === 'DENIED');
  assert.ok(denied.length >= ownerOnly.length, 'denied attempts are in the audit log');
});

test('unknown actions, and GET requests, never reach the data', () => {
  const t = setup();
  assert.equal(t.g.post({ action: 'eval', token: t.owner }).code, 'UNKNOWN_ACTION');
  assert.equal(t.g.post({ action: '__proto__', token: t.owner }).code, 'UNKNOWN_ACTION');
  for (const a of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__defineGetter__'])
    assert.equal(t.g.post({ action: a, token: t.owner }).code, 'UNKNOWN_ACTION', a);
  const r = t.g.get({ action: 'getAllData', token: t.owner });
  assert.notEqual(r.success, true);
  assert.ok(!('bills' in r) && !('patients' in r));
});

test('passwords and secrets are never sent to the app', () => {
  const t = setup();
  const users = t.g.post({ action: 'listUsers', token: t.owner });
  assert.equal(users.success, true);
  const text = JSON.stringify(users) + JSON.stringify(t.g.post({ action: 'getAllData', token: t.owner }))
    + JSON.stringify(t.g.post({ action: 'whoami', token: t.owner }));
  assert.ok(!/hash|salt|LOCAL_KEY_SECRET/i.test(text), 'no hash/salt/secret fields');
  const props = t.g.props;
  for (const v of Object.values(props)) if (String(v).length >= 16) assert.ok(!text.includes(String(v)) || /^\d+$/.test(String(v)), 'a stored secret appeared in a response');
});

test('the repository holds no secrets: no keystore, passwords, tokens or deployment keys', () => {
  const root = path.join(__dirname, '..');
  const { execSync } = require('node:child_process');
  let files;
  try { files = execSync('git ls-files', { cwd: root }).toString().split('\n').filter(Boolean); } catch (e) { return; }
  assert.ok(!files.some(f => /\.(jks|keystore|p12|pem|key)$/i.test(f) || /keystore\.properties$|\.env$/i.test(f)), 'key or env file committed');
  const bad = [];
  for (const f of files) {
    if (/node_modules|\.(png|webp|jpg|ico|jar|gradle|min\.js)$/i.test(f) || f.startsWith('tests/')) continue;
    let s; try { s = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { continue; }
    if (/-----BEGIN (RSA |EC )?PRIVATE KEY-----/.test(s)) bad.push(f + ': private key');
    if (/AKIA[0-9A-Z]{16}/.test(s)) bad.push(f + ': cloud key');
    if (/(storePassword|keyPassword)\s*=\s*\S+/.test(s) && !/example|template/i.test(f)) bad.push(f + ': keystore password');
    if (/ghp_[A-Za-z0-9]{30,}/.test(s)) bad.push(f + ': GitHub token');
  }
  assert.deepEqual(bad, []);
});

test('Code.gs has no two functions with the same name (the second would silently replace the first)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const names = [...src.matchAll(/^function (\w+)\s*\(/gm)].map(m => m[1]);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(dup, []);
});
