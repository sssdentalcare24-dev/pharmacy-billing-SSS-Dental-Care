# Sri Sai Speciality Dental Care — Billing App

Fast, installable billing & clinic app. Data lives in Google Sheets (via Google Apps Script).

## What's in this folder

| Path | What it is |
|---|---|
| `index.html` | Page layout only (≈160 KB, was 810 KB) |
| `css/app.css` | All styles |
| `js/00-boot.js` | Speed helpers: data prefetch, offline save queue, lazy lists, password hashing |
| `js/01-core.js` … `js/11-wa-templates.js` | Your app code, split by feature (same code, same order) |
| `js/99-speed.js` | Lazy page rendering, first-time setup, service worker registration |
| `js/vendor/qrcode.min.js` | QR library (self-hosted, no CDN wait) |
| `sw.js` | Service worker — app opens instantly and works offline |
| `manifest.webmanifest`, `assets/` | Logo (7 KB WebP, was 2 × 92 KB inline) and app icons |
| `apps-script/Code.gs` | Updated Google Apps Script — paste into script.google.com (not used by the website) |

## 1. Upload to GitHub

1. github.com → **New repository** → name `sri-sai-dental-billing` → Create.
2. **Add file → Upload files** → drag **everything inside this folder** (keep the `css`, `js`, `assets` folders) → **Commit changes**.
3. **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main` / `(root)` → Save.
4. After ~1 minute the app is live at `https://<your-username>.github.io/sri-sai-dental-billing/`.

## 2. Update the Apps Script (important for speed)

1. Open your Apps Script project → replace all of `Code.gs` with `apps-script/Code.gs` → Save.
2. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.**
   This keeps the **same /exec link**, so nothing else changes.

## 3. First time on each phone / computer

After login the app asks once for the **Apps Script link** (`https://script.google.com/macros/s/…/exec`).
It's saved in that browser only — it is **not** in the code on GitHub, so strangers who see the repo can't read patient data.
Devices that already used the old app have it saved and won't be asked. Owner can change it anytime in **Settings**.

Tip: on Android Chrome use **⋮ → Add to Home screen** to install it like an app.

## Change passwords

Passwords are stored only as SHA-256 hashes in `js/01-core.js` (`CREDENTIALS`).
Open the app → press **F12** → Console → run:

```js
__sha256('ssdc|owner|YOUR_NEW_PASSWORD')   // for owner
__sha256('ssdc|staff|YOUR_NEW_PASSWORD')   // for staff
```

Paste the result into the matching `hash: '...'` in `js/01-core.js` and upload that file again.

## Updating the app later

Edit files and upload them to GitHub again. Phones pick up the new version on the next open
(the service worker shows the saved copy instantly and downloads the update in the background).
For a big update, change `VERSION` in `sw.js` (e.g. `ssdc-v2`) so every device clears the old copy.

## What makes it fast

- **Before login:** the page is split into small cached files; scripts load in parallel with `defer`; logo is a 7 KB WebP; Sheets data starts downloading while you type the password.
- **Repeat visits:** service worker serves everything from the phone instantly, even offline.
- **Big lists:** All Bills and Patients show 50 at a time and load more as you scroll; off-screen cards aren't painted. Search still searches everything.
- **Only the visible page redraws** after data loads; the other pages update in the background.
- **Server:** `getAllData` is cached in Apps Script, so reloads return in a fraction of a second; every save/delete clears the cache so all devices see fresh data.
- **Saves never get lost:** if the internet drops while saving, it's kept on the device (orange "⏳ waiting to sync" badge) and sent automatically when you're back online. The server ignores duplicates.
