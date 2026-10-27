# Upgrade progress (read this first when continuing)

Branch: **`develop`** · Production (`main`) untouched until approval · Last update: 27 Oct 2026

| Stage | Status |
|---|---|
| 1 Audit | ✅ `docs/AUDIT.md` |
| 2 Architecture & security | ✅ done (server-side auth, RBAC, POST, audit log, sessions, lockout, rate limit) |
| 3 Database & business logic | ✅ core done (validation, idempotency, cancellations, stock register, batches/FEFO, backups, migration) |
| 4 Pharmacy & clinic features | ⏳ partly (purchase batches/expiry/free qty/invoice; medicine edit; stock adjustments). Next: partial payments & outstanding, refunds UI, GST/MRP/HSN on bills, supplier master & ledger, purchase returns UI, patient medical/dental history, treatment master, barcode scan |
| 5 Financial reporting | ⏳ started (dental revenue in reports/dashboard, COGS from batches). Next: financial dashboard (receivables/payables, net profit), full report set, Excel/PDF |
| 6 Performance & PWA | ✅ measured (Lighthouse 99, no regression); next: paginated loading, medicine search box, minified build |
| 7 UI/UX refresh | ⏳ not started |
| 8 Testing | ✅ 33 automated tests (23 server, 10 browser) passing |
| 9 Deployment | ⏳ waiting: staging setup + owner acceptance (`docs/DEPLOYMENT.md`) |

## What changed and why

### `apps-script/Code.gs` (v3, rewritten around the old functions)
- **Login/session** (`login_`, `getSession_`, `changePassword_`, users): salted SHA-256 ×500 hashes in a Users tab; random 64-char session tokens in CacheService; 3 h idle / 12 h absolute expiry; 5 wrong passwords → 15 min lock; password rules; owner can create/reset/disable logins; disabling or resetting ends that user's sessions; `emergencyResetOwnerPassword` for recovery. *Why: S-01…S-03, S-06.*
- **`handle_` gatekeeper**: every request must be POST with a valid session; per-action role table (`PERMS`); staff never receive cost prices, purchases or expenses; writes run under a lock and are de-duplicated by request ID; denials and rejections audited. *Why: S-02, S-04, S-05.*
- **`saveBill_`**: re-validates every line, totals, discount limit, payment split; FEFO batch allocation; cost of goods from the actual batches; sequential bill number; shortfalls recorded instead of hidden. *Why: B-05…B-07, B-18, B-19.*
- **`cancelBill_` / `cancelPurchase_`** replace deletion; stock restored to the exact batches; reason required. *Why: B-09.*
- **Batches + StockMovements**: `addPurchase_` creates batches (batch no, expiry, free qty, MRP, invoice no, duplicate-invoice check); `adjustStock_` (damaged, expired, returns, count corrections — reason required); `updateMedicine_` cannot change stock silently; `deleteMedicine_` → Inactive.
- **Clinic records**: server receipt numbers (`reserveReceiptNo_`); record IDs for prescriptions/exams/receipts; soft deletes; same-doctor appointment clash check. *Why: B-10, B-11, B-15, B-16.*
- **Backups**: `backupNow_` (verified), `scheduledBackup` (daily/weekly/monthly + pruning + failure e-mail), `restoreFromBackup`, `installTriggers`.
- **Migration**: `migrateToV3DryRun`, `migrateToV3` (backup first, additive, re-runnable), `validateData_`.
- Daily stock e-mail now batch-aware (expired vs expiring ≤90 days).

### `js/app.js`
- **00-boot**: new secure connection layer (`API.login`, `API.call`, POST + token + request ID), automatic conversion of all older calls, offline queue with per-item status, Sync Centre data, status line, 30-min auto-logout, `esc()`, `todayLocal()`, local QR.
- **01-core**: server login, forced password change, session resume, `onSessionLost`; `loadData` never swaps in demo data (B-01), replaces lists even when empty (B-17), loads dental receipts and cancelled bills; cart/discount validation (B-06, B-07); bill save shows *Saving / Saved · Bill No / Pending / NOT saved* (and undoes a rejected bill on screen); cancel bill with reason; cancelled-bills section; dashboard counts dental income and per-medicine minimum stock; reports split Pharmacy / Dental / Total and the treatment chart shows real data only (B-02, B-12); local dates (B-14); escaping in lists (S-07); local QR (S-09).
- **03-receipt-numbers**: server-issued numbers; offline numbers tagged per device.
- **04-combined-bill**: works with the real data (B-03), stock check fixed (B-04), pharmacy and dental parts saved separately with real cost.
- **05/06**: patient `addedOn` sent; appointment clash per doctor; exam/prescription record IDs.
- **12-admin (new)**: change password, Sync Centre, owner Settings (users, billing rules, backups, data check, audit log), medicine edit, batches/FEFO view, stock adjustments, stock history.

### Other files
- `index.html`: username field (any login), sync status line, change-password button, purchase form (batch no, expiry, free qty, MRP, invoice no), accessibility labels.
- `sw.js`: cache version bump. `netlify.toml`: security headers. `apps-script/appsscript.json`: Asia/Kolkata time zone, web-app settings. `package.json`: `npm test`.
- `tests/`: `gas-mock.js` (simulated Google services), `backend.test.js` (23), `e2e.test.js` (10).
- `docs/`: `AUDIT.md`, `MIGRATION.md`, `DEPLOYMENT.md`, this file.

## Completed features (tested)
Server-side login · forced password change · lockout · session expiry · idle logout · user management · owner/staff permissions on the server · audit log · POST-only API · bill validation · discount limit · sequential bill numbers · duplicate-proof bills/purchases/records · split payments stored · bill & purchase cancellation with stock restore · batch-wise stock · FEFO · expired stock never sold · stock movement register · stock adjustments with reasons · cost of goods from batches · dental revenue in reports · offline queue with visible status · verified backups (manual + scheduled) · restore · migration with backup · data check.

## Remaining limitations / known gaps
- Partial payments, outstanding balances, refunds (money back) and GST are **not** on bills yet (Stage 4).
- Prescription, exam-form and treatment-receipt **history lists** are still kept per device (the records themselves are in Sheets). Loading them from the server is Stage 4.
- All data still loads at login (paginated loading is Stage 6) — fine for now, will slow down after many thousands of bills.
- Login is protected against guessing per username; Apps Script cannot see IP addresses, so there is no per-device rate limit.
- Patient data cached on the device (for offline use) is not encrypted; use a screen lock on clinic phones.
- 137 inline `onclick` handlers mean the CSP must allow inline script; XSS escaping was added to the main lists but not every older screen.
- Zoom is still disabled on phones (`user-scalable=no`) to avoid iPad input zoom; review in Stage 7.
- Combined bill does not support a discount (unchanged).

## Performance (measured, Lighthouse 13.5, real throttling: slow 4G + 4× CPU, median of 4 runs)

| | Original single file | `main` (speed update) | `develop` (v3) |
|---|---|---|---|
| Performance score | 80 | 99 | 99 |
| First screen visible | 1.06 s | 0.88 s | 0.90 s |
| Data downloaded | 237 KB | 142 KB | 154 KB |
| Repeat visit (service worker) | 1.68 s | 0.21 s | ~0.2 s |

## Next session — start here
1. Owner sets up staging (`DEPLOYMENT.md` A) and runs the acceptance list (B).
2. Stage 4: partial payments + outstanding balances on bills and combined bills (needs owner answers: is the pharmacy GST-registered? GST % per medicine?).
3. Stage 4: supplier master + ledger, purchase returns screen.
