# Releasing an update

This app checks GitHub Releases for new versions on its own (via
`electron-updater`) and can also be told to check on demand from
**Settings → ตรวจสอบอัปเดต (Check for Updates)**. This file is the steps *you*
run to actually publish a new version there — same pattern as
`cs-inventory-desktop`.

## One-time setup (ทำแล้ว ✅)

1. **สร้าง GitHub repo**: `chongvanvongsay-oss/profix-desktop` (ตั้งไว้แล้วใน
   `package.json` ภายใต้ `build.publish` และใน `src/main/updater.js` — ถ้าเปลี่ยนชื่อ
   repo หรือใช้ account อื่นในอนาคต ต้องแก้ทั้งสองที่ให้ตรงกัน)
2. **Push โปรเจกต์นี้ขึ้น repo นั้น** — `git init` + commit แรก + push ไปที่
   `https://github.com/chongvanvongsay-oss/profix-desktop.git` เสร็จแล้ว
3. **Create a GitHub Personal Access Token** (Settings → Developer settings
   → Personal access tokens → Tokens (classic) → Generate new token) with
   the `repo` scope (or `public_repo` if the repo is public). This is what
   lets `electron-builder` upload installers to your GitHub Releases.
4. **Set it as an environment variable** before publishing:
   ```bash
   # macOS/Linux
   export GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
   ```
   Do this in every new terminal session before running `npm run publish` —
   it isn't saved anywhere on disk by this project.

## Publishing a new version

```bash
npm run publish
```

This one command:
1. Bumps the version in `package.json` (major-only: `1.0.0` → `2.0.0`, see
   `scripts/bump-version.js`),
2. Packages installers for **both** Windows (`.exe` via NSIS) and Mac
   (`.dmg`, both x64 and arm64) — run it on a Mac to get the Mac installer,
   since Apple doesn't allow building signed/packaged Mac apps on
   Windows/Linux,
3. Uploads everything to a **new GitHub Release** matching the version
   (as a **draft** — electron-builder's default, so nothing goes live until
   you approve it),
4. Prunes old local build artifacts from `release/` (keeps the 2 most recent
   versions).

**You only build on one OS per run.** To ship both Windows and Mac
installers for the same version, run `npm run publish` once on a Mac and
once on Windows — GitHub Releases will end up with both sets of installers
attached to the same version tag, which is exactly what `electron-updater`
expects (it downloads whichever installer matches the OS the user is on).

### Finishing the release

1. Go to your repo's **Releases** page on GitHub.
2. You'll see a new **draft** release with the installers attached
   (`Pro Fix-2.0.0-x64.exe`, `Pro Fix-2.0.0-arm64.dmg`,
   `Pro Fix-2.0.0-x64.dmg`, plus `latest.yml` / `latest-mac.yml` — those two
   small files are what `electron-updater` reads to know a new version
   exists, don't delete them).
3. Double-check the assets look right, then click **Publish release**.
4. Done. Anyone running an older installed copy of the app will pick up the
   update automatically the next time they open it (or immediately if they
   click **Check for Updates** in Settings).

## Why the Mac side is different

The Mac build in this project is **unsigned** (`build.mac.identity: null` in
`package.json`) — there's no paid Apple Developer ID certificate attached to
it. `electron-updater`'s Mac updater needs to verify a code signature to
safely replace the running app with the downloaded update, and an unsigned
app fails that check.

In practice this means, on Mac:
- The app **can still check** whether a new version exists (that part just
  reads a small file from GitHub, no signing involved).
- It usually **cannot silently download-and-install** the update the way it
  does on Windows.
- When that happens, the app falls back to showing "This build isn't signed
  with an Apple Developer certificate, so silent auto-install isn't
  possible" with an **Open Download Page** button that sends the user to
  your GitHub Releases page to download and install the new `.dmg` by hand
  (same as installing the app the first time).

**To get real silent auto-update on Mac**, you'd need an Apple Developer
Program membership ($99/year), a Developer ID Application certificate, and
to codesign + notarize the build — then flip `hardenedRuntime: true` and set
a real `identity` in `package.json`'s `build.mac` config. Windows doesn't
have this restriction; NSIS installers there are unsigned too by default and
`electron-updater` still installs them silently without issue.

## Testing an update locally

`electron-updater` only works in a **packaged** app (`npm start` / dev mode
always shows "Update checks only work in a packaged build" in Settings, by
design — there's no installed app to update). To actually test the flow:

1. `npm run publish` once at version N (e.g. `1.0.0`) and publish the
   release on GitHub.
2. Install that build on a test machine.
3. `npm run publish` again — it bumps to N+1 (e.g. `2.0.0`) — and publish
   that release too.
4. Open the installed N (`1.0.0`) app, or click **Check for Updates** in
   Settings — it should detect `2.0.0` and go through
   checking → available → downloading (with a progress bar) → downloaded,
   with a **Restart to Install** button at the end (Windows), or the Mac
   fallback described above (Mac).
