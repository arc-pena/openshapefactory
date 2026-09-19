/**
 * Folds `dist/` into a single self-contained HTML file.
 *
 * Claude Artifacts wrap the published file in their own document skeleton and
 * only allow external scripts from a short CDN allowlist, so the page ships as
 * body markup plus inlined CSS and JS — three included. That also means the
 * result opens straight from the filesystem with no server.
 *
 *   npm run build && node scripts/build-artifact.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const out = process.argv[2] ?? path.join(dist, 'sphere-world.html');

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

const read = (href) => fs.readFileSync(path.join(dist, href.replace(/^\.?\//, '')), 'utf8');

const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)]
  .map((m) => read(m[1]))
  .join('\n');

const js = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g)]
  .map((m) => read(m[1]))
  .join('\n');

// Everything between <body> and </body>, minus the script tags we just inlined.
const body = html
  .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script type="module"[^>]*><\/script>/g, '')
  .trim();

// The host skeleton supplies doctype/head/body and an off-white ground, so the
// page repaints its own background and keeps clear of the phone's system bars.
const overrides = `
html, body { height: 100%; background: var(--bg); overflow: hidden; }
.ui {
  padding-top: calc(var(--pad) + env(safe-area-inset-top, 0px));
  padding-bottom: calc(var(--pad) + env(safe-area-inset-bottom, 0px));
}
.detail { padding-bottom: calc(var(--pad) + env(safe-area-inset-bottom, 0px)); }
.ui__hint { bottom: calc(var(--pad) + env(safe-area-inset-bottom, 0px)); }
#stage:focus-visible { outline: 1px solid var(--accent); outline-offset: -3px; }
`;

const page = `<title>Sphere World</title>
<style>
${css}
${overrides}</style>

${body}

<script type="module">
${js.replace(/<\/script/g, '<\\/script')}
</script>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`${out} — ${(page.length / 1024).toFixed(0)} KB`);
