#!/bin/bash
# Builds the Diagram Compositor from src/ and the LATEST Feature Modeller.
#
#   build/build.sh [path/to/feature-modeller.html]
#
# The editor and the parametric modeller grow together: every build takes the modeller page,
# re-extracts its kernel into kernel/, and re-inserts it as modeller.html with the bridge and fixes.
# Before building, read the Feature Modeller artifact (claude.ai/artifact/6RwchubErKSRTXve59pDHL)
# so its newest version is saved; with no argument the newest saved snapshot is used.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; WEB="$(dirname "$HERE")"; SRC="$WEB/src"
MODELLER="${1:-$(ls -t /root/.claude/projects/*/*/tool-results/artifact-2bf933ac-*.html /root/.claude/projects/*/tool-results/artifact-2bf933ac-*.html 2>/dev/null | head -1)}"
[ -f "$MODELLER" ] || { echo "No Feature Modeller snapshot found. Read the artifact first, or pass its saved .html." >&2; exit 1; }
VERSION="$(basename "$MODELLER" .html | sed 's/^artifact-2bf933ac-//')"
echo "Feature Modeller: $MODELLER (version $VERSION)"
JS="02_core.js 03_img.js 04_model.js 04b_ocaf.js 04c_samples.js 05_gl.js 06b_curves.js 07c_trace.js 06_nodes.js 07_engine.js 07b_nano.js 08_ui.js 09_props.js 10_boot.js"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
( cd "$SRC"; echo "const MODELLER_VERSION = '$VERSION';" > "$TMP/00_version.js"; cat "$TMP/00_version.js" $JS > "$TMP/all.js" )
node --check "$TMP/all.js" && echo SYNTAX_OK
{ cat "$SRC/01_head.html"; echo '<script>'; cat "$TMP/all.js"; echo '</script>'; } > "$WEB/nukestyle_diagram_editor.html"
# The same page as a complete document, for GitHub Pages (index.html is the site's front door).
{ echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}</style></head><body>'; cat "$WEB/nukestyle_diagram_editor.html"; echo '</body></html>'; } > "$WEB/index.html"
mkdir -p "$WEB/kernel"
python3 "$HERE/extract_payloads.py" "$MODELLER" "$WEB/kernel"
python3 "$HERE/inject_bridge.py" "$MODELLER" "$WEB/modeller.html"
echo "$VERSION" > "$WEB/MODELLER_VERSION"
ls -la "$WEB" "$WEB/kernel" | awk '{print $5, $9}'
