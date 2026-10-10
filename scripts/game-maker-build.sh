#!/bin/bash
# Short Family fork: self-contained production build of the GDevelop web editor.
# Same as `npm run build` in newIDE/app, but with the GDJS game engine bundled into
# the build folder (build/GDJS) and the editor pointed at it, so previews and
# HTML5 export do not depend on GDevelop's CDN. See SHORT-FAMILY.md.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/newIDE/app"

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
export REACT_APP_SELF_HOSTED_GDJS=true

npm run build
node scripts/copy-GDJS-Runtime-to-build.js

echo "Build ready: $REPO_ROOT/newIDE/app/build (serve with: node scripts/serve.js)"
