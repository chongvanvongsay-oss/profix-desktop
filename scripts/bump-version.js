// Bumps package.json's version before each distributable build, so every
// `npm run dist`/`npm run publish` produces a uniquely-versioned .dmg/.exe
// automatically (0.1.0 -> 1.0.0 -> 2.0.0 -> ...) instead of overwriting the
// same file. Mirrors cs-inventory-desktop's scripts/bump-version.js exactly
// (major-only bump) so both products follow the same release convention.
const fs = require("fs");
const path = require("path");

const pkgPath = path.join(__dirname, "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

const [major] = pkg.version.split(".").map(Number);
const nextVersion = `${major + 1}.0.0`;

pkg.version = nextVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log(`Version bumped: ${nextVersion}`);
