// Wipes electron-builder's intermediate "unpacked app" folders in release/
// (e.g. mac-arm64/, win-unpacked/) before each build. These aren't the
// installers users download (those are the versioned .dmg/.exe files,
// handled by prune-releases.js) — they're working directories
// electron-builder packs into the DMG/EXE, and they go stale when build
// targets/archs change. Clearing them first means every build leaves only
// the current run's folders, never a pile of old ones.
const fs = require("fs");
const path = require("path");

const releaseDir = path.join(__dirname, "..", "release");

if (!fs.existsSync(releaseDir)) {
    process.exit(0);
}

const removed = [];
for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
    // Only touch plain (non-hidden) directories — installer files live
    // alongside these as files, and electron-builder's own icon-conversion
    // caches (.icon-icns, .icon-ico) are dotfolders we leave untouched.
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
        fs.rmSync(path.join(releaseDir, entry.name), { recursive: true, force: true });
        removed.push(entry.name);
    }
}

console.log(
    removed.length
        ? `Unpacked-folder cleanup: removed ${removed.join(", ")}.`
        : "Unpacked-folder cleanup: nothing to remove."
);
