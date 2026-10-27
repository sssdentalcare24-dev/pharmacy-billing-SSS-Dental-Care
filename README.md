# Sri Sai Speciality Dental Care — Billing & Clinic Management

Pharmacy billing, batch-wise medicine inventory, purchases, expenses, reports, patients, appointments, prescriptions, dental exam forms, combined dental + pharmacy bills, WhatsApp reminders and Bluetooth thermal printing. Installable (PWA), works offline, data in Google Sheets.

> **v3 secure upgrade is live on `main`** (GitHub Pages). The Apps Script must be updated once — see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.
> Progress and next steps: **[docs/PROGRESS.md](docs/PROGRESS.md)** · Easy-to-read report: [docs/upgrade-report.html](docs/upgrade-report.html)

## Documents

| | |
|---|---|
| [docs/AUDIT.md](docs/AUDIT.md) | Complete audit: bugs, security, performance, architecture decision |
| [docs/MIGRATION.md](docs/MIGRATION.md) | Database migration v2 → v3, field mapping, backups, rollback |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Switch-over steps (same Apps Script), checks, rollback, passwords, tests |
| [docs/PROGRESS.md](docs/PROGRESS.md) | What's done, what changed and why, limitations, measurements, next steps |

## Files

| Path | What it is |
|---|---|
| `index.html` | Page layout + styles (one request draws the first screen) |
| `js/app.js` | All app code in load order — search `══ FILE:` to jump between sections (`00-boot` secure connection & offline queue, `01-core`, combined bill, patients/appointments, exam form, printer, WA templates, `12-admin` owner screens, `99-speed`) |
| `sw.js`, `manifest.webmanifest`, `assets/` | Offline/instant loading, app install, icons |
| `apps-script/Code.gs` | Google Apps Script server (login, permissions, validation, stock, backups, migration) |
| `apps-script/appsscript.json` | Apps Script settings (Asia/Kolkata, web app) |
| `tests/` | `npm test` — 23 server tests + 11 browser tests on simulated Google services |

## Security model (v3)

- Login is checked **on the server**; passwords are stored only as salted hashes in the private spreadsheet. Nothing secret is in this public repository.
- Every request is a POST with a session token; the server checks the user's role for **every** action (staff cannot cancel bills, change prices or stock, see cost prices, purchases or expenses).
- Sessions end after 3 h idle / 12 h; the app logs out after 30 min without use; 5 wrong passwords lock the account for 15 min.
- Every change, login, refusal and rejection is written to the AuditLog tab.
- The Apps Script link is entered once per device (not in the code).
- A Content-Security-Policy in `index.html` only allows scripts from this site and network calls to Google Apps Script.
- Hosting: GitHub Pages only. The pharmacy is **not GST-registered** — bills carry no GST.

## Daily use notes

- **Sync status** (sidebar): green = online, number of items waiting / failed. Tap it to open the Sync Centre.
- Bills show **⏳ pending** until the server confirms them, and **❌ not saved** with the reason if the server refuses.
- Bills and purchases are never deleted — the owner **cancels** them with a reason (stock is restored).
- Stock changes only through purchases, sales and **📦 Stock → Record a stock change** (reason required).

## Tests

```bash
npm install && npx playwright install chromium
npm test
```
