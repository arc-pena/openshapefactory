#!/bin/bash
# Publishes the built compositor to the gh-pages branch (the GitHub Pages site), as one new commit
# on top of the current gh-pages. Only the site files go: not src/, build/ or notes.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; WEB="$(dirname "$HERE")"; cd "$WEB"
MSG="${1:-Diagram Compositor site}"
git fetch -q origin gh-pages
IDX="$(mktemp)"; rm -f "$IDX"; trap 'rm -f "$IDX"' EXIT
for f in index.html nukestyle_diagram_editor.html modeller.html kernel/kernel-worker.js.gz kernel/replicad_single.wasm.gz MODELLER_VERSION; do
  GIT_INDEX_FILE="$IDX" git update-index --add --cacheinfo 100644,"$(git hash-object -w "$f")","$f"
done
GIT_INDEX_FILE="$IDX" git update-index --add --cacheinfo 100644,"$(git hash-object -w /dev/null)",.nojekyll
TREE="$(GIT_INDEX_FILE="$IDX" git write-tree)"
C="$(printf '%s\n\nBuilt from web/nukestyle_diagram_editor at %s (Feature Modeller %s).\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_0167mX3JXhgJ8iRcP2MqQDce\n' "$MSG" "$(git rev-parse --short HEAD)" "$(cat MODELLER_VERSION)" | git commit-tree "$TREE" -p origin/gh-pages)"
git push origin "$C:refs/heads/gh-pages"
