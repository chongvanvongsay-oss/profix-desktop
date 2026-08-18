// Keeps only the N most recent versioned build artifacts in release/ and
// deletes the rest (installer files + their .blockmap companions). Runs
// automatically at the end of `npm run dist`/`npm run publish` so every
// build leaves at most the last KEEP_VERSIONS versions on disk, instead of
// accumulating forever.
const fs = require("fs");
const path = require("path");

const KEEP_VERSIONS = 2;
const releaseDir = path.join(__dirname, "..", "release");

if (!fs.existsSync(releaseDir)) {
    process.exit(0);
}

// Matches e.g. "Pro Fix-1.0.0-arm64.dmg" or "Pro Fix Setup 1.0.0.exe" —
// artifactName in package.json is "${productName} Setup ${version}.${ext}"
// for nsis and "${productName}-${version}-${arch}.${ext}" for dmg, so we
// match on the version number itself rather than a fixed prefix shape.
const VERSION_RE = /(\d+\.\d+\.\d+)/;

const files = fs.readdirSync(releaseDir).filter((f) => VERSION_RE.test(f) && !fs.statSync(path.join(releaseDir, f)).isDirectory());

const versions = [...new Set(files.map((f) => f.match(VERSION_RE)[1]))].sort(
    (a, b) => {
        const pa = a.split(".").map(Number);
        const pb = b.split(".").map(Number);
        for (let i = 0; i < 3; i++) {
            if (pa[i] !== pb[i]) return pb[i] - pa[i]; // descending
        }
        return 0;
    }
);

const keep = new Set(versions.slice(0, KEEP_VERSIONS));
const toDelete = files.filter((f) => !keep.has(f.match(VERSION_RE)[1]));

if (toDelete.length === 0) {
    console.log(`Release cleanup: nothing to prune (kept versions: ${[...keep].join(", ") || "none"}).`);
    process.exit(0);
}

let freed = 0;
for (const f of toDelete) {
    const p = path.join(releaseDir, f);
    freed += fs.statSync(p).size;
    fs.unlinkSync(p);
}

console.log(
    `Release cleanup: removed ${toDelete.length} file(s) from old version(s) ` +
    `${versions.slice(KEEP_VERSIONS).join(", ")} (freed ${(freed / 1024 / 1024).toFixed(0)} MB). ` +
    `Kept: ${[...keep].join(", ")}.`
);
