# Deployment — GitHub Pages + the same Apps Script (v3.1)

```
GitHub repo (main) ──► GitHub Pages  https://sssdentalcare24-dev.github.io/pharmacy-billing-SSS-Dental-Care/
Apps Script (the existing project, same /exec link) ──► the existing spreadsheet
```

No Netlify, no second Apps Script, no second spreadsheet. Safety comes from the **automatic verified backup** each migration makes before it changes anything, and from the fact that migrations only **add** tabs and columns.

**Order does not matter for safety.** The v3.1 website works with a v3.0 server (the new screens stay hidden and the sidebar footer says *"server needs update"*). Once the server is updated, the new screens appear by themselves after the next login.

---

## A. Update the Apps Script to v3.1 (≈10 minutes, when the clinic is quiet)

**Already on v3.0** (you ran `migrateToV3` before — the app has owner/staff logins):

1. **Apps Script editor** → open the existing project → `Code.gs` → select all → paste the new **`apps-script/Code.gs`** from GitHub → **Save**.
2. Function menu → **`migrateToV31DryRun`** → **Run** → read the log (it only lists what will be added; nothing changes).
3. Function menu → **`migrateToV31`** → **Run** → allow any new permission Google asks for (Drive, for invoice attachments).
   - The log shows **"Backup OK"** with a link, then **"✅ v3.1 update complete"**.
   - Old bills and dental receipts are marked **paid in full** (that is what they were). Suppliers are created from your purchase history. A treatment price list with 18 common treatments is added at **₹0** — set your prices in the app.
4. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.** The `/exec` link stays the same.
5. Open the app → log in as owner → sidebar footer shows **"App v3.1 · server v3.1 ✓"**.
6. **Settings → 🩺 System health → Run health check** → everything ✅ (if "temporary password" or "triggers" are ❌, follow the hint shown).
7. In the same box → **🧪 Run restore drill** → *"Restore drill passed — N cells identical"*. This proves today's backup can really be restored.
8. **Settings → 🦷 Treatment price list → ✏️ Edit prices** → enter your prices. Optional: **Settings → 💰 Payments & history** → whether staff may let a patient pay part now / later, and how many days of bills to keep on phones/PCs (default 1 year; older ones load when needed).

**Still on v2** (no logins yet): run `migrateToV3DryRun` → `migrateToV3` (note the temporary passwords in the log/e-mail) → `migrateToV31` → `installTriggers` → deploy a new version (step 4) → everyone logs in and sets a password.

If a phone or computer still shows the old screens: close the app/tab and open it again (it updates itself in the background).

## B. Quick check after the update (10 minutes)

- [ ] Owner and staff can log in; staff does not see Suppliers, Finance, Inventory, Purchases, Expenses, Reports, Settings
- [ ] New bill → tick **Pay part now** → pay half → "Saved on server", the bill shows **Due ₹…**, it appears in **💰 Dues & Payments**
- [ ] Dues → **Collect** the rest → the bill shows Paid; **History** shows the collection
- [ ] Thermal / A4 print of a part-paid bill shows **Paid now** and **Balance due**
- [ ] Owner: bill → **↩ Return / refund** one medicine → stock goes back up, refund shown
- [ ] **🧮 Cash closing** → expected cash matches the drawer (enter the count; the difference is saved)
- [ ] **🏭 Suppliers** → open a supplier → ledger; record a purchase invoice with a photo
- [ ] **👥 Patients** → open a patient → profile (allergies) → Records
- [ ] **💹 Finance** → This month → numbers look right; **Reports → ⬇ Excel** downloads
- [ ] Inventory → 📷 scan a medicine barcode (phone) or type the code
- [ ] Settings → System health all ✅; restore drill passed
- [ ] Old bills from before the update still show and reprint

## C. If something is wrong — rollback

1. Apps Script → **Deploy → Manage deployments → ✏️ Edit → Version:** choose the **previous version** → Deploy. (The v3.1 tabs/columns stay in the sheet; the v3.0 server ignores them.)
2. Website: GitHub → *Commits* on `main` → revert the v3.1 merge, or ask Claude. The v3.0 website works with both servers.
3. Data: nothing was removed. Drive → *SSDC Backups* → `SSDC Backup pre-migration …` is the copy taken just before the update; `restoreFromBackup("<file id>")` switches to it (see `MIGRATION.md` §8).

## D. Android app (after the website is updated)

On the clinic PC, in the repository folder:

```bat
git pull
cd android-app
npm install
npm run sync             (copies the website into the app: www/ → Android assets)
```

Then build the signed APK the same way as last time — Android Studio → **Build → Generate Signed App Bundle / APK… → APK** (details in `android-app/README.md`), or `android\gradlew.bat assembleRelease` with JDK 21.

- Version is **3.1.1 (code 5)**; the app is called **Sri Sai Speciality Dental Care** on the phone. If `android-app/android/keystore.properties` contains a `versionCode` line, set it to **5** or higher — Android refuses to install an update with the same code.
- Install the new APK over the old one (same signing key → data and login are kept).
- On the phone, try: Bluetooth thermal print, A4 print / Save as PDF, 📷 barcode scan (Android asks for the camera once), invoice photo, WhatsApp link.

## E. Remove the old Netlify copy (report issue "Netlify shows v1.0")

The old Netlify site still runs the **v1.0** app with the old, unsafe login. Nobody should use it for billing.

1. Log in at **app.netlify.com** → open the site → **Site configuration → Delete this site** (bottom of the page).
2. Remove any Netlify bookmark / home-screen icon on clinic phones and computers; add the GitHub Pages link instead.
3. GitHub Pages (`main`) is the **only** production website. Old Apps Script deployments: Apps Script → *Deploy → Manage deployments* → archive every deployment except the one whose `/exec` link the app uses.

## F. Forgotten passwords

- **Staff:** owner → Settings → Users → *Reset password* (temporary password, staff changes it at next login).
- **Owner:** Apps Script editor → run **`emergencyResetOwnerPassword`** → a temporary password is e-mailed to the clinic Google account.

## G. Release checklist (developers)

- [ ] `npm run build` after any change to `js/app.js` (a test fails if `js/app.min.js` is stale)
- [ ] `npm test` → all passing (server, security, finance, handlers, browser)
- [ ] `cd android-app && npm run build:www && npm test` → 4 passing; `npx cap copy android`
- [ ] Merge `develop` → `main` (GitHub Pages publishes `main`)
- [ ] Owner: §A, then §B on the live site

```bash
npm install            # esbuild; Playwright browsers: npx playwright install chromium
npm run build
npm test
```

## H. Security on GitHub Pages

GitHub Pages cannot send security headers, so `index.html` carries a **Content-Security-Policy `<meta>` tag**: scripts only from this site (no inline JavaScript at all — buttons use `data-on…` attributes run by a small safe interpreter), network only to Google Apps Script, no plugins, no framing of other sites. The repository is public but contains **no secrets**: no passwords, no hashes, no Apps Script link (entered once per device), no signing keys; the server requires a login for every request and checks the role for every action. A test scans the repository for keys and passwords on every run.
