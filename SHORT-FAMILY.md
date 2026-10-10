# SHORT-FAMILY.md — Game Maker (GDevelop fork)

Short Family's self-hosted fork of [GDevelop](https://github.com/4ian/GDevelop) (MIT).
Phase 0 spike, 2026-10-10 (dispatch `dispatch-1791671136-game-maker-p0`).
No stripping, no rebrand, no AI layer yet — just a reproducible, reboot-safe deploy.

| | |
|---|---|
| Fork | `Lead2Legacy/GDevelop` (default branch `master` tracks upstream untouched) |
| Working branch | `short-family` |
| Upstream | `4ian/GDevelop` (`upstream` remote) |
| Base commit | `8301cdcaa4` (upstream master, 2026-10-09, editor v5.6.283) |
| Local checkout | `~/projects/game-maker` |
| Port | **3800** (127.0.0.1 only) — never 3000 (Mission Control) |
| Tailscale | `https://phils-mac-mini-1.tailcb6401.ts.net:8449` → `http://localhost:3800`, tailnet-only (`tailscale serve`, never funnel) |
| LaunchAgent | `com.game-maker` (`~/Library/LaunchAgents/com.game-maker.plist`, copy in `deploy/`) |
| Log | `~/Library/Logs/game-maker.log` |

## What we changed vs upstream

Additive only (5 files):

1. `newIDE/app/src/GameEngineFinder/BrowserS3GDJSFinder.js` — when the build is made with
   `REACT_APP_SELF_HOSTED_GDJS=true`, the editor loads the GDJS game engine from
   `<origin>/GDJS` instead of `https://resources.gdevelop-app.com/GDJS-<version>`. Without
   this, previews and HTML5 export in a production build depend on GDevelop's CDN
   having our exact version hash (it won't — we build from master).
2. `scripts/game-maker-build.sh` — production build with that flag + copies the GDJS
   runtime into `newIDE/app/build/GDJS` (reuses upstream `copy-GDJS-Runtime-to-build.js`).
3. `scripts/serve.js` — dependency-free static SPA server (SPA fallback, `application/wasm`,
   brotli/gzip with in-memory cache, ETag/304, Range). Also usable for any folder
   (`--dir`, `--port`, `--no-spa`).
4. `scripts/export-html5.js` — headless HTML5 export via the same `gd.Exporter` path as the
   editor, Node `fs` backend, no UI, no cloud. Proof for the Phase 3 "Publish to Lab" path.
5. `deploy/com.game-maker.plist` — the LaunchAgent.

## Build + serve

Node: **v26.7.0** (npm 11.19.0, Homebrew system node; upstream CI uses 20.14 on macOS /
24.13 on Linux — 26.7 worked without changes). No `.nvmrc` needed; no version manager.

```bash
cd ~/projects/game-maker/newIDE/app
npm install                       # postinstall: patch-package, GDJS deps, libGD.js (WASM) download
cd ../.. && ./scripts/game-maker-build.sh    # -> newIDE/app/build
# service reads the build in place; rebuilding needs no restart (static files)
launchctl kickstart -k gui/$(id -u)/com.game-maker   # only if serve.js itself changed
curl -sI http://localhost:3800/   # 200
```

One-off foreground run: `node scripts/serve.js --port 3800`.
First install of the agent: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.game-maker.plist`.

Headless export: `node scripts/export-html5.js <project.json> <outDir>` then
`node scripts/serve.js --dir <outDir> --port 3801 --no-spa`.

Note: the repo's husky pre-commit hook runs lint-staged (prettier 1.15.3 + eslint) on staged
`newIDE/app/src/**/*.js`. Don't `--no-verify`.

## Rebase on upstream

```bash
git fetch upstream
git rebase upstream/master          # on branch short-family; conflicts only if upstream touches BrowserS3GDJSFinder.js
git push --force-with-lease origin short-family   # (needs explicit go-ahead; it's a history rewrite)
cd newIDE/app && npm install && cd ../.. && ./scripts/game-maker-build.sh
```

## Footprint + timings (Mac mini, 2026-10-10)

| | |
|---|---|
| Full-history clone | 2.1 GB, **40 min** (network-bound, ~0.7 MB/s) |
| `npm install` (incl. postinstall) | **56 s**, `newIDE/app/node_modules` 1.7 GB, `GDJS/node_modules` 149 MB |
| `npm run build` | **1 m 53 s** (first), **1 m 19 s** (`game-maker-build.sh`, warm) |
| Build output | 394 MB (`newIDE/app/build`; libGD.wasm 3.3 MB / 646 KB brotli) |
| Whole checkout | **4.3 GB** (`.git` 1.8 GB) — well under the 15 GB budget |
| npm cache | `~/.npm` 2.8 GB (shared, not all ours) |
| Boot disk free | 45 GB → 33 GB after the spike (includes unrelated churn) |

## Cloud / account dependencies observed (Phase 1 input)

Observed on the production build served from `http://localhost:3800` with no login:

- **Ad/analytics trackers fire on first load**: `resources.gdevelop.io/a/gea.js` loader →
  PostHog (`us.i.posthog.com`), TikTok pixel, Facebook pixel (`connect.facebook.net`),
  LinkedIn Insight (`snap.licdn.com`, `px.ads.linkedin.com`). **Strip before Connor uses it.**
- **`api.gdevelop.io/*` calls all returned status 0 / failed** from our origin: asset store,
  example store, tutorials, courses, announcements, promotions, achievements, recommendations,
  shop. Home tab shows "An error occurred when downloading the tutorials". The asset
  store / examples tabs will be empty until proxied or replaced with local content.
- **Example projects themselves load fine** from the public CDN
  (`resources.gdevelop-app.com/examples/<name>/<name>.json` + assets, all 200) via the
  editor's `?project=<url>` argument.
- **Log in / Sign up** buttons, **Ask AI** (GDevelop's cloud AI, login + credits), **Share →
  gd.games** online publish, and cloud desktop/mobile builds are all account/cloud features
  (statically confirmed in `ExportAndShare/ShareDialog/PublishHome.js`; not click-tested —
  see below).
- **Preview** uses `BrowserSWPreviewLauncher` (service worker, same-origin; needs a secure
  context: localhost or the HTTPS tailnet URL) when the browser supports it, else
  `BrowserS3PreviewLauncher` (uploads to GDevelop's cloud). Not click-tested.
- **Browser HTML5 export** (`BrowserHTML5Export.js`, zip download) is local and uses the
  self-hosted GDJS root — no account needed.
- Exported games show the **"Made with GDevelop"** splash on load (project setting).

## Verification (2026-10-10)

- `curl -sI http://localhost:3800/` → 200; `/libGD.wasm` → `application/wasm`; SPA fallback OK;
  `/GDJS/Runtime/index.html` → 200.
- `launchctl print gui/$UID/com.game-maker` → running, listener PPID 1 (launchd);
  `kill <pid>` → restarted by KeepAlive within 1 s (`runs = 2`).
- `tailscale serve status` diff: only `:8449 → :3800` added, nothing else changed;
  `curl -sI https://phils-mac-mini-1.tailcb6401.ts.net:8449/` → HTTP/2 200; no funnel.
- Headless browser (read-only commands only): editor shell `/tmp/game-maker-p0-editor.png`;
  platformer example open in the scene editor `/tmp/game-maker-p0-scene.png`;
  exported game rendering on canvas `/tmp/game-maker-p0-export.png`.
- **Not verified:** clicking Preview / Share / Export inside the editor UI (the Forge
  browser allowance is read-only/no clicks). HTML5 export was proven through the editor's
  own `gd.Exporter` via `scripts/export-html5.js` on a local test game
  (`GDJS/tests/games/Sprite flipping and resizing.json`), not on the platformer example.
- **Not done (Human step):** open the tailnet URL on Connor's iPad in Safari.
