# Sri Sai Speciality Dental Care — Android app (Capacitor 8)

The clinic website, packaged as an Android app. Same features, same login, same Google Sheets (same Apps Script). The app's files live on the phone, so it opens instantly and works offline (bills sync when the internet is back).

| | |
|---|---|
| App name | Sri Sai Speciality Dental Care |
| App ID | `in.srisaidentalcare.billing` |
| Version | 3.1.1 (code 5) |
| Android | 7.0 and newer (minSdk 24, targetSdk 36) |

## What is different inside the app

Android's in-app browser lacks a few things Chrome has, so the app adds native replacements (`src/native-bridge.js`, `src/web-shims.js`, `android/.../HtmlPrinterPlugin.java`):

| Feature | In the app |
|---|---|
| Bluetooth thermal printer | Native Bluetooth plugin. Same printers as before. Android asks for "Nearby devices" permission once; no location permission needed |
| A4 printing (bills, prescriptions, receipts, exam forms) | Android print screen → any printer, or **Save as PDF** |
| CSV and Excel exports (reports, expenses, finance) | Android share sheet → WhatsApp, Drive, email, Files (Excel files are kept byte-for-byte) |
| Barcode scanning, invoice photos | Camera (Android asks once; phones without a camera can still type the code) |
| WhatsApp, UPI, maps links | Open the WhatsApp / UPI / Maps app |
| Back button | Closes popup → form → menu → goes to the home page → leaves the app |
| Offline | Built in (no service worker needed) |

---

## Build it on Windows (first time ≈ 30–45 minutes, mostly downloads)

1. **Install once:**
   - **Node.js LTS** — https://nodejs.org (accept the defaults)
   - **Android Studio** — https://developer.android.com/studio (accept the defaults; it installs the Android SDK)
2. **Get the code:** on GitHub → **Code → Download ZIP** → extract it (or `git clone` the repository).
3. Open the extracted folder → open **android-app** → click the address bar, type `cmd`, press Enter. In the black window type:
   ```
   npm install
   ```
4. **Open in Android Studio:** *File → Open* → choose the folder **android-app\android** → OK.
   The first time, Android Studio downloads Gradle and SDK parts (can take 10–20 minutes). Wait until the bottom bar says the sync is finished.
5. **Run on a phone:**
   - Phone → *Settings → About phone* → tap **Build number** 7 times → back → *Developer options* → turn on **USB debugging**.
   - Connect the phone by USB, allow the prompt on the phone.
   - In Android Studio pick the phone at the top, click the green **▶ Run**.
6. **First start on each phone:** paste the Apps Script link (the `/exec` link) → log in.

## Make an APK to install on the clinic phones

1. Android Studio → **Build → Generate Signed App Bundle / APK… → APK → Next**.
2. **Create new…** key store → save it somewhere safe (e.g. `C:\SSDC\ssdc-release.jks`), choose a password. **Back up this file and password** — every future update must be signed with the same key.
3. Choose **release** → **Create**. The APK appears in `android-app\android\app\release\app-release.apk`.
4. Send the APK to each phone (WhatsApp/Drive/USB) → open it → allow "Install unknown apps" for that one time → Install.

(For the Google Play Store instead: *Generate Signed App Bundle* → upload the `.aab` in the Play Console; needs a Google Play developer account.)

## After the website changes

The app carries its own copy of the website (`index.html` + the built `js/app.min.js`). When the website changes:

```
npm run build          (in the repository root, if js/app.js was edited)
cd android-app
npm run sync
```

**Server link inside the app:** create `android-app/api-url.txt` containing the clinic's Apps Script link (`https://script.google.com/macros/s/…/exec`) before `npm run sync`. The app then never asks for it on a new phone. This file is in `.gitignore` — keep it off GitHub.

Then in Android Studio: increase `versionCode` (and `versionName`) in `android/app/build.gradle`, build the APK again and install it over the old one. Data is not lost — it lives in Google Sheets; only unsent offline items are kept on the phone (they are kept across updates).

## Files

| Path | What |
|---|---|
| `capacitor.config.json` | App name/ID, status-bar colour, Bluetooth dialog texts |
| `scripts/build-www.mjs` | Copies the website from the repository root into `www/`, bundles the native bridge |
| `src/native-bridge.js` | Connects the website to Android (Bluetooth, print, share, links, back button) |
| `src/web-shims.js` | The small adapters used by the bridge (tested in `tests/`) |
| `www/` | The website copy inside the app (generated — don't edit, edit the website instead) |
| `android/` | The Android Studio project |
| `android/app/src/main/java/in/srisaidentalcare/billing/HtmlPrinterPlugin.java` | Native printing (Android print service / PDF) |
| `android/app/src/main/res/mipmap-*`, `drawable*/splash.png` | App icon and splash screen (clinic logo) |
| `tests/bridge.test.js` | 4 tests: app build loads; thermal printer through the native Bluetooth bridge; A4 printing; CSV sharing + back button |

Run the tests: `npm test` (needs `npx playwright install chromium` once).
