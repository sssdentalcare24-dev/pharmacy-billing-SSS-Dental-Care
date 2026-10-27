# Deployment — GitHub Pages + the same Apps Script

```
GitHub repo (main) ──► GitHub Pages  https://sssdentalcare24-dev.github.io/pharmacy-billing-SSS-Dental-Care/
Apps Script (the existing project, same /exec link) ──► the existing spreadsheet
```

No Netlify, no second Apps Script, no second spreadsheet. Safety comes from the **automatic verified backup** that `migrateToV3` makes before it changes anything, and from the fact that the upgrade only **adds** tabs and columns.

The website and the Apps Script must be on the same version: the v3 app talks only to the v3 server. Until the server is updated, the new app shows a red banner: *"The Apps Script server has not been updated yet…"* — nothing is saved in the meantime.

---

## A. Switch-over (≈15 minutes, do it when the clinic is quiet)

1. **Apps Script editor** → open your existing project.
2. *Project settings* → set **Time zone = (GMT+05:30) India Standard Time** (optional: tick *Show "appsscript.json"* and paste `apps-script/appsscript.json`).
3. Open `Code.gs` → select all → paste the new **`apps-script/Code.gs`** from GitHub → **Save**.
4. Function menu → **`migrateToV3DryRun`** → **Run** → read the log (it only lists what will be added).
5. Function menu → **`migrateToV3`** → **Run** → allow the permissions Google asks for (Drive for the backup, Gmail for e-mails).
   - The log shows **"Backup OK"** with a link, then **"✅ Migration complete"**.
   - It also shows the **temporary passwords** for `owner` and `staff` (also e-mailed to the clinic Google account).
6. Function menu → **`installTriggers`** → **Run** (daily backup ~2 AM + daily stock e-mail ~8 AM).
7. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.** The `/exec` link stays the same.
8. Open the app on each device → log in with the temporary password → choose a personal password (at least 8 characters).
9. Owner: **Settings** → set the **staff discount limit**, check **Backups** shows a verified backup, glance at the **Audit log**.

If the browser still shows the old app: close and reopen it (the app updates itself in the background).

## B. Quick check after switching (5 minutes)

- [ ] Owner and staff can log in; staff sees only the staff pages
- [ ] Make a small bill → "✅ Saved on server · Bill No SSDC-…"; stock goes down
- [ ] Owner → All Bills → ✖ cancel that test bill with reason "test" → stock comes back
- [ ] Inventory → 📦 Stock on one medicine shows its batch (OPENING)
- [ ] Settings → Backups → ✅ verified · Audit log shows the logins and the test bill
- [ ] Thermal printer still prints

## C. If something is wrong — rollback

1. Apps Script → **Deploy → Manage deployments → ✏️ Edit → Version:** choose the **previous version** → Deploy.
2. GitHub → the repository → *Commits* → revert to commit `9a392c4` (the version before v3), or ask Claude to do it.
3. Data: nothing was removed. If needed, open Drive → *SSDC Backups* → `SSDC Backup pre-migration …` and run `restoreFromBackup("<file id>")` (see `MIGRATION.md` §8).

## D. Forgotten passwords

- **Staff:** owner → Settings → Users → *Reset password* (temporary password, staff changes it at next login).
- **Owner:** Apps Script editor → run **`emergencyResetOwnerPassword`** → a temporary password is e-mailed to the clinic Google account.

## E. Production checklist

- [ ] `npm test` → 34 passing (done before every release)
- [ ] `migrateToV3DryRun` reviewed
- [ ] `migrateToV3` finished with "✅ Migration complete" and a backup link
- [ ] Triggers installed (Apps Script → ⏰ Triggers shows `scheduledBackup` and `sendDailyStockReport`)
- [ ] New version deployed on the **same** deployment (link unchanged)
- [ ] Every user changed the temporary password
- [ ] Staff discount limit set
- [ ] Next morning: a `SSDC Backup daily …` file exists in Drive → *SSDC Backups*

## F. Running the tests (for developers)

```bash
npm install && npx playwright install chromium
npm test        # 23 server tests + 11 browser tests, all on simulated Google services
```

## G. Security on GitHub Pages

GitHub Pages cannot send security headers, so `index.html` carries a **Content-Security-Policy `<meta>` tag** (scripts only from this site, network only to Google Apps Script, no plugins) and `no-referrer`. The repository is public but contains **no secrets**: no passwords, no hashes, no Apps Script link (entered once per device), and the server requires a login for every request.
