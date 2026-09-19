# Syncing this project between two machines

Same pattern as `cs-official-site` and `cs-inventory-desktop` — one private
GitHub repo, edited from both a Windows machine and a MacBook.

## Every time you sit down to work

```bash
git pull
npm install   # only if package.json changed since your last pull
```

## Every time you finish a change

```bash
git add -A
git status        # sanity check before committing
git commit -m "..."
git push
```

## First time on a new machine

1. `git clone https://github.com/chongvanvongsay-oss/profix-desktop.git`
2. Install [Node.js LTS](https://nodejs.org) if it isn't already.
3. `npm install`
4. `npm start` — runs the app locally (Electron) to confirm it works.

## Publishing a new release (installers to GitHub Releases)

Not part of the day-to-day pull/push loop — see **[RELEASING.md](RELEASING.md)**
for the full steps (`npm run publish`, the `GH_TOKEN` it needs, and why Mac
installers can only be built on a Mac).
