#!/usr/bin/env bash
# Stage a served site folder for a multi-file Artifact publish.
#
#   stage_artifact.sh <site-dir> <main-page.html> <stage-dir>
#
# Copies the folder, and writes <stage-dir>/<name>.html: the main page with
# its own <!doctype>/<html>/<head>/<body> lines removed, because the Artifact
# service wraps the main page in its own skeleton. Secondary pages stay whole.
# Then publish <stage-dir>/<name>.html with `files` mapping every other file to
# the same relative path. Two host rules:
#   - .gz is not a served type. Publish the gzip bytes under their .gz path
#     with contentType "application/wasm"; kernel.js checks the gzip magic
#     bytes, not the name.
#   - Binary files are capped at 15 MB each, so the kernel stays gzipped.
#   - The published main page IS "index.html" (the service refuses a files
#     entry with that path), so secondary pages link back with
#     "../index.html" and it resolves. Don't list the main page in `files`.
set -euo pipefail
site="${1:?site dir}"; main="${2:?main page}"; stage="${3:?stage dir}"
mkdir -p "$stage"
cp -r "$site"/. "$stage"/
name="$(basename "$main" .html)"
[ "$name" = "index" ] && name="$(basename "$(cd "$site" && pwd)")"
sed -e '/^<!doctype html>$/Id' -e '/^<html[^>]*>$/d' -e '/^<head>$/d' -e '/^<\/head>$/d' \
    -e '/^<body>$/d' -e '/^<\/body>$/d' -e '/^<\/html>$/d' "$site/$main" > "$stage/$name.html"
echo "main page: $stage/$name.html"
find "$stage" -type f ! -name "$name.html" ! -path "$stage/$main" ! -name '*.md' | sed "s#^$stage/##" | sort
