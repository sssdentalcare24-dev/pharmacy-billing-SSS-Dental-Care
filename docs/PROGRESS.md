# Upgrade progress (read this first when continuing)

**Current release: v3.1** (app 3.1.0 · server 3.1.0 · database schema 4) — 27 Oct 2026.
Hosting: GitHub Pages only (no Netlify). Server: the **same** Apps Script project and spreadsheet, upgraded in place. The pharmacy is **not GST-registered** → no GST on bills or purchases.

**Owner action needed once:** `docs/DEPLOYMENT.md` §A — paste the new `Code.gs`, run `migrateToV31DryRun` then `migrateToV31`, deploy a new version, run the health check + restore drill from Settings. Until then the new website keeps working exactly like v3.0 and the new screens stay hidden.

## Status against the consolidated improvement report

| Area (report Part 2) | Item | Status | Where |
|---|---|---|---|
| **1 Billing** | Partial payment / pay later | ✅ | New bill, dental receipt, bill summary: "pay part now" box; staff pay-later can be switched off by the owner |
| | Patient outstanding balance | ✅ | 💰 Dues & Payments → Dues; patient profile; dashboard tile; badge on every bill |
| | Refund management | ✅ | Bill detail → ↩ Return / refund (items back to their batch, or allowance); refunds tab |
| | Complete payment history | ✅ | Dues & Payments → History; per bill; per patient (Records) |
| | Cancellation workflow | ✅ verified | Cancel needs a reason, restores stock to the same batches, blocked while collections/refunds exist (cancel those first, owner only, with reason) |
| | Payment reconciliation | ✅ | 🧮 Cash closing: expected cash from every bill, receipt, collection, refund, expense and supplier payment; counted cash + denominations; UPI / card ticks; difference recorded |
| **2 Inventory** | Barcode scanning | ✅ | 📷 next to the medicine search (camera, or type/USB scanner); barcode field on medicines |
| | Advanced medicine search | ✅ | Type name, generic name, barcode or batch on New bill, Bill summary and Inventory |
| | Batch history | ✅ | 📜 on each medicine: every batch with purchases, sales, returns, adjustments |
| | Expiry loss / dead stock / valuation / movements | ✅ | Inventory → 📊 Stock reports (valuation at cost and MRP, expiring, expiry & damage loss, dead, slow, reorder, movements) — Excel / PDF |
| **3 Suppliers** | Master, ledger, outstanding, payments | ✅ | 🏭 Suppliers (owner): opening balance, ledger, pay supplier, we-owe totals |
| | Purchase returns | ✅ | Supplier ledger → ↩ Return goods (stock out of the batch, credit on the ledger) |
| | Invoice attachment | ✅ | Purchase invoice → photo / PDF saved in Drive folder "SSDC Purchase Invoices", linked on the invoice |
| | Supplier-wise analysis | ✅ | Finance → Reports → Purchase analysis (by supplier / by medicine), Supplier outstanding |
| **4 Dental** | Medical & dental history, allergies | ✅ | Patient profile (blood group, medicines, history, emergency contact); allergy warning when billing / prescribing |
| | Treatment master + pricing | ✅ | Settings → Treatment price list (18 common treatments seeded at ₹0 — owner sets prices); price chips on the receipt |
| | Treatment history | ✅ | Patient → Records → Treatments (planned / in progress / done, tooth, doctor); bill planned treatments |
| | Prescription & exam history sync | ✅ | History lists now load from the server (all devices see the same) |
| | Follow-ups | ✅ | 🔔 Follow-ups page (overdue / today / upcoming, WhatsApp, done); follow-up date on prescriptions |
| **5 Financial** | Cash closing, receivables, payables | ✅ | Cash closing; Dues; Suppliers |
| | Pharmacy gross profit, dental analysis, operating profit | ✅ | 💹 Finance dashboard (any period: today, month, FY, custom) |
| | Monthly / annual statements | ✅ | Finance → Statement (month by month, FY April–March) |
| | Refund reports, inventory valuation | ✅ | Finance → Reports; Stock reports |
| **6 Reports** | Daily/monthly sales, pharmacy profit, dental revenue, doctor-wise, medicine-wise, expiry loss, slow-moving, supplier & patient outstanding, expenses, purchases, refunds | ✅ 16 reports | Finance → Reports; every report exports **Excel (.xlsx)** and **PDF** (print → Save as PDF); "everything in one Excel" |
| **7 UI/UX** | Dashboard, sidebar, tables, mobile, receipts | ✅ | Grouped sidebar, quick actions, clearer KPI labels, card tables on phones, sticky table headers, keyboard access; thermal receipt shows Paid now / Balance due and the UPI QR asks for the balance |
| **8 Technical** | v3 migration verification | ✅ | Settings → 🩺 System health → Run health check (schema, tabs, columns, triggers, backups, data check); footer shows "server v3.1 ✓" |
| | Server-side pagination / optimised loading | ✅ | Loads the last 365 days (owner can change); older bills/records on demand; unchanged data is not re-sent |
| | JS minification | ✅ | `npm run build` → `js/app.min.js` (−31 %); a test fails if it is out of date |
| | Encrypted local patient data | ✅ | AES-GCM with a per-user key from the server; unreadable after logout |
| | Improved CSP / XSS | ✅ | No inline JavaScript at all (`script-src 'self'` + one hash); every data value escaped; spreadsheet-formula injection blocked |
| | Security testing | ✅ | Automated: permission matrix for every action, forged/expired sessions, lockout, CSP, XSS, formula injection, secrets scan |
| | Android testing | ✅ (simulated) | 4 bridge tests in Chromium; the APK must still be rebuilt and tried on a phone (`DEPLOYMENT.md` §D) |
| | Backup / restore testing | ✅ | Restore drill (makes a backup, reads it back, compares every tab) — button in Settings and `restoreDrill()` in the editor |
| | Production deployment verification | ⏳ owner | `DEPLOYMENT.md` §B checklist after the Apps Script update |

Report Part 3 (immediate issues): **Netlify v1.0** → delete the Netlify site (`DEPLOYMENT.md` §E); **backend migration** → health check; **patient data** → encrypted on devices, owner-only screens checked on the server; **financial accuracy** → randomised books-balance tests (below); **backups** → restore drill.

## Financial accuracy — how it is checked

- Money model (server and app use the same rule): for every bill or dental receipt, **Balance due = (Total − Returned value) − (Paid − Refunded)**. A return first reduces what is still owed; only money paid beyond the new total is refunded. Over-collection is refused.
- `tests/finance-invariants.test.js` runs three randomised days (bills paid in full / in part / later, collections, cancelled collections, returns with and without restock, allowances, dental receipts, cancelled bills). An independent calculation in the test must match the server **to the paisa**: every balance, total patients owe, stock of every medicine, and the day's cash summary (cash/UPI in and out). The server's own data check must find nothing.
- Dashboard labels say exactly what each number is ("Gross profit today — medicine margin + dental, before expenses"). The full picture (returns, expenses, expiry loss) is on the Finance page. No calculation was changed silently; where v3.1 adds new figures they are separate and labelled.

## What changed in v3.1 and why

### `apps-script/Code.gs`
- New tabs: Payments, CashClosings, Suppliers, SupplierLedger, PurchaseInvoices, PurchaseReturns, TreatmentMaster, PatientTreatments, FollowUps. New columns appended on the right of Medicines, Bills, TreatmentReceipts, Purchases, Prescriptions, Patients, Appointments, ExamForms (see `MIGRATION.md` §10).
- New actions for payments, refunds, cash closing, suppliers, invoices, attachments, treatments, follow-ups, patient history, paging, reports, health check, restore drill — all behind the same login + permission gatekeeper; v3.1 actions answer "run migrateToV31" until the update is done.
- `migrateToV31DryRun` / `migrateToV31`: verified backup first, additive only, re-runnable; old bills and receipts are marked **paid in full** (that is what they were); suppliers are created from purchase history; 18 common treatments are added at ₹0.
- Security hardening: text starting with `= + - @` is stored as plain text (a typed formula can never run in the sheet or leak data); action / permission / lookup tables only accept their own names (`constructor`, `toString` … are unknown actions); a device data key per user for encrypting cached patient data.

### `js/app.js` (source) → `js/app.min.js` (what the site loads)
- `00b-secure-store` encrypted device storage · `00c-safe-handlers` safe `data-on…` handlers (no eval) · `13-v31-core` shared helpers · `14-money` · `15-suppliers` · `16-stock` · `17-clinic` · `18-finance` (Excel writer, charts, statements, reports) · `19-system` (settings, health check, restore drill, older bills, dashboard tiles).
- Older screens: every data value now passes through `esc()`; CSV exports quote cells and neutralise formulas; the thermal receipt reads the real bill data (never sample medicines) and prints Paid now / Balance due.

### `index.html`
- Strict Content-Security-Policy (no `'unsafe-inline'` scripts), grouped sidebar, new pages, v3.1 styles, mobile table cards.

### Android (`android-app/`)
- Builds from `js/app.min.js`; camera permission for barcodes / invoice photos (optional hardware); version 3.1.0 (code 4).

## Tests (all passing)

| File | What | Count |
|---|---|---|
| `tests/backend.test.js` | v3 server: login, sessions, permissions, billing, FEFO, cancellations, purchases, backups, migration | 23 |
| `tests/backend-v31.test.js` | v3.1 server: migration, part payments, collections, returns/refunds, cash closing, suppliers, invoices, attachments, clinic, paging, reports, health check, restore drill, formula guard | 21 |
| `tests/security.test.js` | permission matrix for **every** action (no session / forged / staff), unknown actions, no secrets in responses or the repository, duplicate functions | 7 |
| `tests/finance-invariants.test.js` | randomised books-balance check (3 seeds) | 3 |
| `tests/safe-handlers.test.js`, `tests/build.test.js` | every handler parses, the interpreter refuses unsafe code, CSP hash, minified file up to date | 6 |
| `tests/e2e.test.js` | browser: v3 flows, offline queue, old server compatibility | 11 |
| `tests/e2e-v31.test.js` | browser: every v3.1 screen, encrypted storage, Excel export, barcode, XSS, CSP, thermal receipt | 11 |
| `android-app/tests/bridge.test.js` | Android build + native bridge (simulated) | 4 |

## Remaining limitations (honest list)

- The Android app is tested with simulated plugins; it still needs a real-phone check after rebuilding (Bluetooth printer, camera, printing).
- Barcode scanning by camera needs a browser with the Barcode Detector (Chrome / Android); elsewhere type the code or use a USB scanner.
- Apps Script cannot see IP addresses, so login protection is per username (5 tries → 15 min lock), not per device.
- PDF export uses the browser's "Save as PDF" (no separate PDF file generator).
- Combined bill has no discount (unchanged from v3.0).
- Phones still disable pinch-zoom (`user-scalable=no`) to stop iPad input zoom.

## Next session — start here
1. Confirm the owner finished `DEPLOYMENT.md` §A–§B (Settings → Health check shows schema 4 and a verified backup; the sidebar footer shows "server v3.1 ✓").
2. Rebuild the APK on the clinic PC (`DEPLOYMENT.md` §D) and try printer, camera and printing on a phone.
3. Delete the old Netlify site if it still exists (`DEPLOYMENT.md` §E).
4. Ideas not yet requested: SMS / WhatsApp Business API for automatic reminders; per-doctor commission report.
