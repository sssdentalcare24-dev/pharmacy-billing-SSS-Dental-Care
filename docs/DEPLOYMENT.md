# Deployment, staging and production checklist

```
GitHub repo ── main ─────► Netlify PRODUCTION  (allbilling-srisaispecialitydentalcare.netlify.app)
           │             └► GitHub Pages        (secondary)
           └─ develop ──► Netlify branch deploy = STAGING (develop--allbilling-srisaispecialitydentalcare.netlify.app)

Apps Script "SSDC Billing"          → live spreadsheet        (production)
Apps Script "SSDC Billing STAGING"  → copy of the spreadsheet (staging)
```

The website and the server must be updated **together**: the v3 app talks only to the v3 server (POST + login), and the v3 server refuses the old app. That's why everything is tried on staging first.

---

## A. One-time: create the staging copy (≈10 minutes)

1. Google Drive → your billing spreadsheet → **File → Make a copy** → name it `SSDC Billing STAGING`. Copy its ID from the address bar (`/d/<ID>/edit`).
2. Go to **script.google.com → New project** → name it `SSDC Billing STAGING`.
3. Paste `apps-script/Code.gs` into `Code.gs`. (Optional: *Project settings → Show "appsscript.json"* and paste `apps-script/appsscript.json`.)
4. **Project settings → Script properties → Add**: `SS_ID` = the copy's ID. (This is what keeps staging away from your real data.)
5. Run `migrateToV3DryRun` → read the log. Run `migrateToV3` → allow the permissions → the log shows the temporary **owner** and **staff** passwords (also e-mailed).
6. **Deploy → New deployment → Web app** · Execute as: *Me* · Who has access: *Anyone* → copy the `/exec` link.
7. Netlify → Site → *Site configuration → Build & deploy*. If the site was created by drag-and-drop, first **Link repository** → this GitHub repo, production branch `main`. Then under *Branches* enable **branch deploys** for `develop`. Open `https://develop--<site>.netlify.app`, paste the **staging** `/exec` link when asked.

## B. Acceptance testing on staging (owner + one staff member)

Tick each item:

- [ ] Owner logs in with the temporary password → must set a new one → dashboard shows the copied data
- [ ] Staff logs in → only New Bill, receipts, prescription, exam, patients, appointments, WA visible
- [ ] Bill with 2 medicines, Cash → "✅ Saved on server · Bill No SSDC-…"; stock drops
- [ ] Staff tries 25 % discount → capped at 10 %
- [ ] UPI and Split payment bills → All Bills shows the right mode
- [ ] Phone in airplane mode → make a bill → "⏳ waiting" badge → airplane off → synced once (check the Sheet: one row)
- [ ] Owner cancels a bill with a reason → shows under "Cancelled bills", stock returns, Sheet row still there
- [ ] Purchase with batch no + expiry → Inventory → 📦 Stock shows the batch; earliest expiry sold first
- [ ] Record a "Damaged" stock change with a reason → Stock history shows it
- [ ] Treatment receipt + combined bill → Reports shows Pharmacy / Dental / Total correctly
- [ ] Prescription, exam form, appointment, patient, expense save (check the Sheet)
- [ ] Thermal printer prints a bill (58 / 80 mm)
- [ ] Settings → Users: create a staff login, reset a password, disable/enable
- [ ] Settings → Backups → Back up now → ✅ verified
- [ ] Settings → Data check → no unexpected issues
- [ ] Settings → Audit log shows all of the above
- [ ] Leave the app untouched 30 min → logged out

## C. Going to production (after approval)

1. **Back up**: in the *production* Apps Script editor run `backupNowFromEditor` (or Drive → make a copy).
2. Paste the v3 `Code.gs` into the **production** Apps Script project → Save.
3. Run `migrateToV3DryRun` → check the plan → run `migrateToV3` → note the temporary passwords.
4. Run `installTriggers` (daily backup + daily stock e-mail).
5. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy** (keeps the same `/exec` link).
6. Merge `develop` → `main` on GitHub (pull request). Netlify and GitHub Pages publish automatically in ~1 minute.
7. On each clinic device: open the app → log in with the temporary password → set a personal password.
8. Watch Settings → Audit log for the first day.

**Rollback** (if anything is wrong): Apps Script → Manage deployments → edit → pick the previous version → Deploy; in GitHub revert the merge (the previous website is commit `9a392c4`). Data: see `MIGRATION.md` §8.

## D. Production deployment checklist

- [ ] All automated tests pass (`npm test` → 33 passing)
- [ ] Staging acceptance list (section B) signed off by the owner
- [ ] Production backup made and opened once to confirm
- [ ] `migrateToV3DryRun` output reviewed
- [ ] `migrateToV3` finished with "✅ Migration complete"
- [ ] Triggers installed (Apps Script → Triggers shows `scheduledBackup`, `sendDailyStockReport`)
- [ ] New version deployed on the **same** deployment (link unchanged)
- [ ] `develop` merged to `main`; Netlify deploy green
- [ ] Owner + every staff member changed their temporary password
- [ ] Staff discount limit set (Settings → Billing rules)
- [ ] First automatic backup visible next morning in Drive → *SSDC Backups*
- [ ] Old public Apps Script link: if the old HTML (with the link inside) was ever public, it is harmless now — the v3 server requires a login for every request

## E. Running the tests

```bash
npm install                      # installs Playwright (once)
npx playwright install chromium  # browser for the end-to-end tests (once)
npm test                         # 23 server tests + 10 browser tests
```

`tests/gas-mock.js` runs the real `Code.gs` against simulated Google Sheets/Drive/Cache, so tests never touch real data.

## F. Netlify settings

`netlify.toml` (in the repo) sets the security headers (CSP, no framing, no sniffing, HSTS, camera/Bluetooth only for this site), no-cache for the app files (the service worker handles speed and offline), and hides `/tests` and `/apps-script`. Netlify: *Production branch* = `main`, *Branch deploys* = `develop`.
