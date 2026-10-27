# Database migration plan — v2 → v3 → v3.1

**Principle:** additive only. No existing row is deleted, moved or rewritten. New columns are appended to the **right** of existing tabs, new tabs are added, and a **verified backup copy** is made automatically before anything changes. If the backup can't be verified, the migration stops without changing anything (tested).

## 1. Existing structure (v2)

| Tab | Columns (A → …) |
|---|---|
| Medicines | ID, Name, Stock, Unit Price, Cost Price, Expiry, Date & Time |
| Bills | Bill ID, Patient Name, Doctor, Phone, Date, Subtotal, Discount, Total, Cost Total, Payment Mode, Date & Time |
| BillItems | Bill ID, Medicine ID, Medicine Name, Quantity, Unit Price, Cost Price, Amount, Date & Time |
| Purchases | ID, Date, Supplier, Medicine ID, Medicine Name, Quantity, Cost Price, Total Cost, Date & Time |
| TreatmentReceipts | Receipt No, Date, Patient, Doctor, Amount, Amount in Words, Treatments, Saved At |
| Prescriptions | Date, Patient Name, Age, Sex, Prescription, Saved At |
| Patients | ID, Name, Phone, Age, Sex, Doctor, Treatment, Balance, Medical Alerts, Status, Last Visit, Added On |
| Appointments | ID, Patient, Phone, Date, Time, Reason, Doctor, Status, Booked At |
| ExamForms | Date, Patient, Age, Sex, Doctor, Phone, … (22 columns) |
| Settings | Key, Value, Updated At |
| Expenses | ID, Date, Category, Amount, Vendor, Notes, Payment Mode, Added At |

## 2. Proposed structure (v3)

### New columns (appended at the right)

| Tab | New columns | Purpose |
|---|---|---|
| Medicines | Min Stock, Status | per-medicine low-stock level; `Inactive` instead of deleting |
| Bills | Status, Bill No, Created By, Payment Ref, Cash Amount, UPI Amount, Card Amount, Cancelled At, Cancelled By, Cancel Reason | cancellation instead of deletion; sequential numbers; split payments; who billed |
| BillItems | Batch Allocation | JSON `[{b: batchId, q: qty}]` — exact batches each sale came from (FEFO) |
| Purchases | Batch No, Expiry, Batch ID, Status, Created By, Cancelled At, Cancelled By, Cancel Reason, Invoice No, MRP | batch-wise stock, duplicate-invoice detection, cancellation |
| TreatmentReceipts | Payment Mode, Record ID, Created By, Status | dental revenue by mode; precise deletion |
| Prescriptions / ExamForms | Record ID, Created By, Status | delete exactly one record (was: first row with that patient name) |
| Patients / Appointments | Created By, Updated At | traceability (`Status = Deleted` hides a record) |
| Expenses | Created By, Status | traceability, soft delete |

### New tabs

| Tab | Columns | Relationship |
|---|---|---|
| Users | Username, Role, Password Hash, Salt, Active, Must Change Password, Failed Attempts, Locked Until, Created At, Last Login At, Display Name | Bills/Purchases/… `Created By` → Users.Username |
| Batches | Batch ID, Medicine ID, Batch No, Expiry, Qty Received, Qty Available, Cost Price, MRP, Supplier, Purchase ID, Received At, Status | Batches.Medicine ID → Medicines.ID; Batches.Purchase ID → Purchases.ID |
| StockMovements | Movement ID, Timestamp, Medicine ID, Medicine Name, Batch ID, Qty Change, Type, Reference, User, Reason, Stock After | every stock change; Reference → Bill ID / Purchase ID / ADJ-… |
| AuditLog | Timestamp, User, Role, Action, Target ID, Details, Result | every login, change, denial, rejection |

Relationships: `BillItems.Bill ID → Bills.Bill ID`, `BillItems.Medicine ID → Medicines.ID`, `Purchases.Medicine ID → Medicines.ID`, `Batches → Medicines/Purchases`, `StockMovements → Medicines/Batches/Bills/Purchases`. All IDs are unique; bills get a server sequence `SSDC-YY-NNNNN`, receipts `YYYY-NNNN` (server-side, continues after the highest existing number).

`Medicines.Stock` is kept up to date as the **sum of available batches** (so the old app and the Sheet still show a correct number); `Medicines.Expiry` = earliest available batch.

## 3. Field mapping

| Old data | Becomes |
|---|---|
| Medicines row (Stock = N, Expiry = E, Cost = C) | One batch `OPENING`, qty N, expiry E, cost C + movement `OPENING +N` |
| Bills row, empty status | `Status = Active` |
| Bills `Payment Mode = Split` | Read back as **Split** (v2 showed Cash) |
| Old bills/purchases without allocation | On cancellation, stock returns to the earliest-expiring batch (or a `RETURN` batch) |
| Hard-coded login (owner/staff) | Users `owner`, `staff` with **random temporary passwords** (logged + e-mailed), must be changed at first login |

## 4. Migration scripts (in `apps-script/Code.gs`)

| Function | What it does |
|---|---|
| `migrateToV3DryRun` | Prints the plan (tabs/columns to add, how many opening batches, units) — **changes nothing** |
| `migrateToV3` | 1) verified backup → 2) tabs + columns → 3) users → 4) bill statuses → 5) opening batches + movements → 6) `SCHEMA_VERSION = 3`. Safe to run again (skips what exists). |
| `validateData` (owner, Settings → Data check) | Duplicate bill IDs, duplicate medicine names, Sheet stock ≠ batch total, bills pointing to unknown medicines, selling below cost |

Until the migration has run, the new server refuses every request with *"Server update not finished"* — the app never writes into a half-migrated sheet.

## 5. Duplicate detection

- Bills: same `Bill ID` → stored once (retries, double taps, offline re-sends).
- Every write carries a request ID; the server replays the original answer for 6 h.
- Purchases: same ID → once; same *invoice no + medicine + batch* → refused.
- Medicines: same name (case-insensitive) → existing one returned.
- Treatment receipts / prescriptions / exam forms: same Record ID → once.
- Appointments: same doctor + date + time → refused (unless explicitly allowed).

## 6. Data validation

Server-side on every write: positive whole quantities, prices ≥ 0, line = qty × price, subtotal = Σ lines, discount ≤ subtotal and ≤ staff limit, total = subtotal − discount, split amounts = total, known medicine, known payment mode, required names/dates, password strength.

## 7. Backup procedure

1. **Automatic** (`installTriggers`): daily ~2 AM; Sundays also *weekly*; 1st of month also *monthly*. Kept: 14 daily, 8 weekly, 12 monthly, 30 manual. Older copies go to Drive trash (recoverable 30 days).
2. **Manual**: Settings → Backups → *Back up now*, or run `backupNowFromEditor`.
3. **Verification**: every copy is reopened and each tab's row count compared with the original. Mismatch = failure.
4. **Alerts**: a failed automatic backup e-mails the clinic Google account and is written to the AuditLog.

## 8. Rollback procedure

| Situation | Steps |
|---|---|
| Undo the whole upgrade | Apps Script → *Deploy → Manage deployments* → ✏️ edit → choose the **previous version** → Deploy (same link). Open the `SSDC Backup pre-migration …` copy in Drive if the data must also go back; run `restoreFromBackup("<file id>")`. Re-deploy the previous website: commit `9a392c4` (the current `main`). |
| Bad data after a mistake | Drive → *SSDC Backups* → open the latest good copy → check it → in Apps Script run `restoreFromBackup("<file id>")`. The app now reads the backup; the current file is backed up first and left untouched. To undo: `restoreFromBackup("<previous id>")` (logged). |
| One wrong record | Owner: cancel the bill / purchase (stock is restored), or record a stock adjustment with a reason. Nothing needs deleting. |

## 9. Future option: Firebase / Firestore

Not needed now (see `AUDIT.md` §12). If request speed or data size ever becomes the limit, the v3 structure maps 1:1 to Firestore collections (`medicines`, `batches`, `bills/{id}/items`, `stockMovements`, `auditLog`, …) with Firebase Auth replacing the Users tab. The same tests (`tests/backend.test.js`) define the behaviour to keep.

## 10. v3.0 → v3.1 (`migrateToV31`, schema 3 → 4)

Same principle: **additive only**, verified backup first (`SSDC Backup pre-migration …`), stops without changes if the backup can't be verified, safe to run again. `migrateToV31DryRun` prints the plan and changes nothing. Requires schema 3 (`migrateToV3` done).

### New tabs

| Tab | Columns |
|---|---|
| Payments | Payment ID, Payment No, Date, Type (COLLECTION / REFUND), Against Type, Against ID, Against No, Patient ID, Patient Name, Phone, Amount, Mode, Cash/UPI/Card Amount, Reference, Notes, Credit Value, Items, Cost Reversed, Created By/At, Status, Cancelled At/By, Cancel Reason |
| CashClosings | Closing ID, Date, Opening Cash, Cash In, Cash Out, Expected Cash, Counted Cash, Difference, Deposited, UPI Total, Card Total, UPI/Card Verified, Notes, Closed By/At, Status, Details |
| Suppliers | Supplier ID, Name, Phone, Contact Person, Address, Notes, Opening Balance, Status, Created At/By, Updated At |
| SupplierLedger | Entry ID, Date, Supplier ID, Supplier Name, Type (OPENING / PURCHASE / PAYMENT / RETURN), Reference, Debit, Credit, Mode, Notes, Created By/At, Status, Cancelled At/By, Cancel Reason |
| PurchaseInvoices | Invoice ID, Date, Supplier ID/Name, Invoice No, Lines, Items Total, Adjustment, Total, Paid Amount, Payment Mode/Ref, Notes, Attachment URL/ID, Status, Created By/At, Cancelled At/By, Cancel Reason |
| PurchaseReturns | Return ID, Date, Supplier ID/Name, Medicine ID/Name, Batch ID/No, Qty, Rate, Amount, Reason, Created By/At, Status |
| TreatmentMaster | Treatment ID, Name, Category, Price, Duration (min), Notes, Status, Updated At/By |
| PatientTreatments | Record ID, Date, Patient ID/Name, Phone, Doctor, Treatment ID, Treatment, Tooth, Price, Status, Notes, Receipt No, Created By/At, Updated At, Completed On |
| FollowUps | Follow-up ID, Patient ID/Name, Phone, Due Date, Reason, Doctor, Source, Status, Notes, Created By/At, Done At/By |

### New columns (appended on the right of existing tabs)

| Tab | Added columns |
|---|---|
| Medicines | Barcode, Generic Name, Category, Manufacturer |
| Bills | Paid Amount, Balance Due, Payment Status, Patient ID, Returned Value, Refunded Amount |
| TreatmentReceipts | Paid Amount, Balance Due, Payment Status, Patient ID, Returned Value, Refunded Amount, Cash/UPI/Card Amount, Discount, Payment Ref, Items |
| Purchases | Supplier ID, Invoice ID, Free Qty |
| Prescriptions | Patient ID, Doctor, Follow-up Date |
| Patients | Medical History, Dental History, Allergies, Medications, Blood Group, Address, Emergency Contact, Date of Birth |
| Appointments, ExamForms | Patient ID |

### Back-filled values (the only cells the migration writes into existing rows)

- **Bills / TreatmentReceipts:** for rows where *Paid Amount* is empty → Paid Amount = Total (Amount), Balance Due = 0, Payment Status = Paid, Returned Value = 0, Refunded Amount = 0. Before v3.1 every bill was paid in full, so this records what happened; no total, item or date is touched. A row whose Paid Amount is already filled is left alone (re-running changes nothing).
- **Purchases:** *Supplier ID* is filled where the supplier name matches a supplier created from the purchase history (one supplier per distinct name; capital letters and spaces at the ends ignored). Old purchases count as **paid** (no ledger debt is invented).
- **TreatmentMaster:** 18 common treatments at price ₹0 (owner enters prices).
- Script property `LOCAL_KEY_SECRET` (random) — derives each user's device-encryption key; never sent to the app or stored in the repository. `SCHEMA_VERSION` → 4.

### Rollback

Deploy the previous Apps Script version (the v3.0 server ignores the new tabs and columns), or restore the `pre-migration` backup with `restoreFromBackup("<file id>")` (§8). Data entered after the update (collections, refunds, supplier payments) exists only in the new tabs — export it first if you restore the backup.
