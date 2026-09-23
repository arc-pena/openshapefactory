// One source, two targets.
//   index.html            serves src/*.js as native ES modules (open over http)
//   dist/web-bim.html     ONE file: every module concatenated into one scope,
//                         the published Artifact
// In the single file every module shares a scope, so a duplicate top-level
// name silently wins and a missing import is invisible; served as modules the
// same mistake is a ReferenceError. The build refuses both, so neither target
// is the one that forgives it.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.dirname(url.fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, "src");
// Dependency order is the concatenation order: a module comes after everything it imports.
const MODULES = [
  "fontdata.js", "geom2d.js", "expr.js", "ocaf.js", "library.js", "walls.js", "spaces.js", "joins.js", "dxf.js",
  "bim.js", "styles.js", "ops.js", "scene.js", "props.js", "hlr.js", "pdf.js", "render.js", "sample.js", "acceptance.js",
  "ui_util.js", "panel.js", "graph.js", "canvas2d.js", "viewcube.js", "solids.js", "view3d.js", "cadbridge.js", "app.js",
];
const fail = msg => { console.error("build refused: " + msg); process.exit(1); };

const onDisk = new Set(fs.readdirSync(SRC).filter(f => f.endsWith(".js")));
const listed = new Set(MODULES);
for (const f of onDisk) if (!listed.has(f)) fail(`src/${f} is on disk but not in MODULES in build.mjs — the served build would load it and the single file would not`);
for (const f of listed) if (!onDisk.has(f)) fail(`MODULES lists ${f}, which is not in src/`);

const declared = new Map();         // name → file
const bodies = [];
const importRe = /^import\s+(?:\{([\s\S]*?)\}\s+from\s+|[\w*\s{},]+from\s+)?"([^"]+)";?[ \t]*$/gm;
for (const f of MODULES) {
  const src = fs.readFileSync(path.join(SRC, f), "utf8");
  const imported = new Set();
  let m;
  while ((m = importRe.exec(src))) {
    if (!m[2].startsWith("./")) fail(`${f} imports "${m[2]}"; only ./ modules can be bundled`);
    if (!MODULES.includes(m[2].slice(2))) fail(`${f} imports ${m[2]}, which is not a listed module`);
    if (MODULES.indexOf(m[2].slice(2)) > MODULES.indexOf(f)) fail(`${f} imports ${m[2]}, which comes after it in MODULES — reorder the list`);
    for (const n of (m[1] || "").split(",").map(s => s.trim()).filter(Boolean)) {
      if (/\sas\s/.test(n)) fail(`${f}: "import { ${n} }" — aliases make a concatenated build unreadable and a grep for a symbol lie`);
      imported.add(n);
    }
  }
  const body = src.replace(importRe, "").replace(/^export\s+\{[^}]*\};?\s*$/gm, "").replace(/^export\s+(?=(const|let|function|class|async)\b)/gm, "");
  const names = [...body.matchAll(/^(?:const|let|class|function\*?|async function)\s+([A-Za-z_$][\w$]*)/gm)].map(x => x[1]);
  for (const n of names) {
    if (declared.has(n)) fail(`top-level "${n}" is declared in both ${declared.get(n)} and ${f}; in the single file the second silently wins`);
    declared.set(n, f);
  }
  for (const n of imported) if (!declared.has(n)) fail(`${f} imports ${n}, which no earlier module declares at top level`);
  bodies.push(`// ===== ${f} =====\n${body}`);
}
// Every module's exported names must be imported where they are used: check the
// common failure — a name used in a module that neither declares nor imports it.
for (const f of MODULES) {
  const src = fs.readFileSync(path.join(SRC, f), "utf8");
  const own = new Set([...src.matchAll(/^(?:export\s+)?(?:const|let|class|function\*?|async function)\s+([A-Za-z_$][\w$]*)/gm)].map(x => x[1]));
  const imp = new Set(); let m; importRe.lastIndex = 0;
  while ((m = importRe.exec(src))) for (const n of (m[1] || "").split(",").map(s => s.trim()).filter(Boolean)) imp.add(n);
  for (const [name, file] of declared) {
    if (file === f || own.has(name) || imp.has(name)) continue;
    const re = new RegExp(`(?<![\\w$.'"\`])${name.replace(/\$/g, "\\$")}\\s*\\(`);
    // strip comments, strings and method definitions (`name(args) {`), which are not calls
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/`(?:[^`\\]|\\.)*`/g, "``").replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""')
      .replace(/^\s+(?:static\s+|get\s+|set\s+|async\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/gm, "");
    if (re.test(code) && !new RegExp(`(?:const|let|function\\*?|class)\\s+${name}\\b|[(,]\\s*${name}\\s*[,)=]`).test(code)) fail(`${f} calls ${name}() from ${file} without importing it — the served build would throw`);
  }
}

const shell = fs.readFileSync(path.join(ROOT, "shell.html"), "utf8");
const bundle = `(() => {\n"use strict";\n${bodies.join("\n")}\n})();`;
if (bundle.includes("</script")) fail("a module contains </script, which would end the inline script early");
const single = shell.replace("<!--APP-->", `<script>\n${bundle}\n</script>`);
fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "dist", "web-bim.html"), single);
const served = shell.replace("<!--APP-->", `<script type="module" src="src/app.js"></script>`);
fs.writeFileSync(path.join(ROOT, "index.html"), served);
console.log(`dist/web-bim.html ${(single.length / 1024).toFixed(0)} KB · index.html (served, ${MODULES.length} modules) · ${declared.size} top-level names, no collisions`);

// The studio page: the same page with the parametric CAD interface carried inside it,
// for the Artifact (which may not fetch). The CAD page is built by `python3 cad/build.py
// --only artifact`; it rides as inert text and becomes the switch's iframe on first use.
// Only "</script" and "<!--" need escaping for HTML script data; both are restored exactly.
const CAD = path.join(ROOT, "cad", "parametric-cad.html");
if (fs.existsSync(CAD)) {
  const page = fs.readFileSync(CAD, "utf8");
  if (/<\\\/script|<\\!--/i.test(page)) { console.error("build refused: the CAD page already contains an escape sequence the studio build uses"); process.exit(1); }
  const inert = page.replace(/<\/script/gi, m => "<\\/" + m.slice(2)).replace(/<!--/g, "<\\!--");
  const studio = single.replace("<!--CAD-->", `<script type="text/x-webbim-cad" id="cad-page">${inert}</script>`);
  fs.writeFileSync(path.join(ROOT, "dist", "web-bim-studio.html"), studio);
  const mb = (studio.length / 1048576).toFixed(1);
  if (studio.length > 16 * 1048576) { console.error(`build refused: dist/web-bim-studio.html is ${mb} MB, over the 16 MB page limit`); process.exit(1); }
  console.log(`dist/web-bim-studio.html ${mb} MB (Web BIM + parametric CAD)`);
} else console.log("cad/parametric-cad.html not built — run python3 cad/build.py --only artifact for the studio page");
