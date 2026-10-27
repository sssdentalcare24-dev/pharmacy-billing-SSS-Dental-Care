# Sri Sai Speciality Dental Care — Billing & Clinic Management

Pharmacy billing with part payments and dues, batch-wise medicine inventory with barcode search, purchases and suppliers, patient records and treatment plans, appointments and follow-ups, prescriptions, dental exam forms, combined dental + pharmacy bills, cash closing, finance statements and reports (Excel / PDF), WhatsApp reminders and Bluetooth thermal printing. Installable (PWA), works offline, data in Google Sheets. **No GST** — the pharmacy is not GST-registered.

> **v3.1** — website on `main` (GitHub Pages: https://sssdentalcare24-dev.github.io/pharmacy-billing-SSS-Dental-Care/). The Apps Script must be updated once: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) §A**.
> Status, what changed and the honest list of limits: **[docs/PROGRESS.md](docs/PROGRESS.md)**

## Documents

| | |
|---|---|
| [docs/PROGRESS.md](docs/PROGRESS.md) | Status against the improvement report, what changed and why, tests, limitations, next steps |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Update steps (same Apps Script), checks, rollback, Android rebuild, removing Netlify |
| [docs/MIGRATION.md](docs/MIGRATION.md) | Database changes v2 → v3 → v3.1, back-filled values, backups, rollback |
| [docs/AUDIT.md](docs/AUDIT.md) | The original audit: bugs, security, performance, architecture decision |

## Files

| Path | What it is |
|---|---|
| `index.html` | Page layout + styles + Content-Security-Policy |
| `js/app.js` | **Source** of the app, in load order — search `══ FILE:` to jump between sections (`00-boot` connection & offline queue, `00b-secure-store` encrypted device data, `00c-safe-handlers`, `01-core`, combined bill, patients/appointments, exam form, printer, WA templates, `12-admin`, `13`–`19` v3.1 modules, `99-speed`) |
| `js/app.min.js` | What the website loads — built from `js/app.js` with `npm run build` (commit both) |
| `scripts/build.mjs` | The build (esbuild: shortens code, keeps every function name the buttons use) |
| `sw.js`, `manifest.webmanifest`, `assets/` | Offline/instant loading, app install, icons |
| `apps-script/Code.gs` | Google Apps Script server (login, permissions, validation, money, stock, suppliers, clinic, reports, backups, migrations) |
| `apps-script/appsscript.json` | Apps Script settings (Asia/Kolkata, web app) |
| `android-app/` | **Android app** (Capacitor 8 + Android Studio) — see [android-app/README.md](android-app/README.md) |
| `tests/` | `npm test` — server, security, finance, handler, build and browser tests on simulated Google services |

## Security model

- Login is checked **on the server**; passwords are stored only as salted hashes in the private spreadsheet. Nothing secret is in this public repository (a test checks).
- Every request is a POST with a session token; the server checks the user's role for **every** action (tested for all 71 actions). Staff cannot cancel bills, refund, change prices or stock, see cost prices, suppliers, purchases, expenses or finance.
- Sessions end after 3 h idle / 12 h; the app logs out after 30 min without use; 5 wrong passwords lock the account for 15 min.
- Every change, login, refusal and rejection is written to the AuditLog tab.
- Patient data kept on phones/PCs for offline use is **encrypted** (AES-GCM, a per-user key from the server) and unreadable after logout.
- Strict Content-Security-Policy: scripts only from this site, **no inline JavaScript** (buttons use `data-on…` attributes run by a small safe interpreter), network only to Google Apps Script. Every name, note and number from the data is escaped before it is shown.
- Text that starts with `= + - @` is saved as plain text, so nothing typed in the app can run as a spreadsheet formula.
- The Apps Script link is entered once per device (not in the code). Hosting: GitHub Pages only.

## Daily use notes

- **Sync status** (sidebar footer): green = online; number of items waiting / failed. Tap it to open the Sync Centre. The footer also shows whether the server is on v3.1.
- Bills show **⏳ pending** until the server confirms them, and **❌ not saved** with the reason if the server refuses.
- A bill can be paid **in part or later**: what is owed shows on the bill, in **💰 Dues & Payments** and on the patient; collect it there. Receipts print *Paid now* and *Balance due*.
- Bills and purchases are never deleted — the owner **cancels** them with a reason (stock is restored), or records a **return / refund**.
- Stock changes only through purchases, sales, returns and **📦 Stock → Record a stock change** (reason required).
- End of day: **🧮 Cash closing** (count the drawer; the difference is recorded).

## Development

```bash
npm install                 # esbuild (+ Playwright: npx playwright install chromium)
npm run build               # after editing js/app.js
npm test                    # everything (server + browser)
npm run test:backend        # server, security, finance, handlers, build only (fast)
```
