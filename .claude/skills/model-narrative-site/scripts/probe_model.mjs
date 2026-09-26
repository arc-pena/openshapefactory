// Build a model headless with the kernel and print what the kernel returns:
// build time, failures, per-feature triangles/edges, bounding box, and a
// warning when coordinates are too large for float32.
//
//   node probe_model.mjs <site-root-url> <path-to-model-from-probe> [kernelBase]
//   e.g. node probe_model.mjs http://localhost:8765/kernel/ ../towerc/tower.model.json
//
// Serve the site with `python3 -m http.server 8765` from the web root and copy
// probe.html next to kernel.js first. Uses the sandbox's pre-installed Chromium.
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const [root, model, base = ""] = process.argv.slice(2);
if (!root || !model) { console.log("usage: node probe_model.mjs <url-of-folder-with-probe.html> <model-path> [kernelBase]"); process.exit(1); }
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("console", m => console.log(m.text().slice(0, 1500)));
page.on("pageerror", e => console.log("PAGEERR", e.message));
await page.goto(root.replace(/\/?$/, "/") + "probe.html" + (base ? "?base=" + encodeURIComponent(base) : "") + "#" + encodeURIComponent(model));
await page.waitForEvent("console", { predicate: m => /^(DONE|ERR)/.test(m.text()), timeout: 900000 });
await browser.close();
