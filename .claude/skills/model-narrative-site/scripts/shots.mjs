// Screenshot a scroll narrative at chosen chapter positions, once the kernel
// says it is ready, and optionally a clean "poster" frame for a thumbnail.
//
//   node shots.mjs <page-url> <out-prefix> [chapters=0,1,2,...] [--poster] [--mobile]
//
// Sandbox notes, all learned the hard way:
//  - cdnjs is blocked by the egress proxy, so three.js r128 is served from an
//    npm tarball: `npm pack three@0.128.0 && tar xzf three-0.128.0.tgz package/build/three.min.js`
//    in the directory you run this from. Google Fonts are aborted (fallback faces).
//  - WebGL is SwiftShader (CPU). A 250k-triangle frame can take seconds, so the
//    viewport is kept small and timeouts are long. A timeout here is not a bug
//    in the page.
//  - Chapter positions are the centres of `.chapter` sections; fractions
//    (3.5) land between chapters.
//  - The page must expose readiness as `#status.ready` (or `.failed`).
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const [url, prefix, list, ...flags] = process.argv.slice(2);
if (!url || !prefix) { console.log("usage: node shots.mjs <url> <out-prefix> [0,1,2.5] [--poster] [--mobile]"); process.exit(1); }
const mobile = flags.includes("--mobile");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 690 } });
await ctx.route(/cdnjs.*three(\.min)?\.js/, r => r.fulfill({ path: "package/build/three.min.js", contentType: "text/javascript" }));
await ctx.route(/fonts\.g/, r => r.abort());
const page = await ctx.newPage();
page.setDefaultTimeout(240000);
page.on("pageerror", e => console.log("PAGEERR", e.message));
page.on("console", m => { if (m.type() === "error" && !/ERR_FAILED|fonts/.test(m.text())) console.log("console", m.text().slice(0, 300)); });
await page.goto(url);
await page.waitForFunction(() => { const s = document.querySelector("#status"); return !s || /ready|failed/.test(s.className); }, null, { timeout: 900000 });
const status = await page.$("#status");
if (status) console.log("status:", (await status.textContent()).trim());
await page.waitForTimeout(1500);
const centres = await page.$$eval(".chapter", s => s.map(x => x.offsetTop + x.offsetHeight / 2));
const vh = mobile ? 422 : 345;
const wanted = (list || centres.map((_, i) => i).join(",")).split(",").map(Number);
for (const y of wanted) {
  const a = Math.floor(y), f = y - a;
  const mid = f && centres[a + 1] ? centres[a] + (centres[a + 1] - centres[a]) * f : centres[a];
  await page.evaluate(v => scrollTo(0, v), mid - vh);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${prefix}-${String(y).replace(".", "_")}.png` });
}
if (flags.includes("--poster")) {
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(2500);
  // Hide every overlay so only the model is left; adjust selectors to the page.
  await page.addStyleTag({ content: "main,#tree,#staff,#readout,.back,.grain,.veil{display:none!important} #stage::after{display:none!important}" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${prefix}-poster.png` });
}
await browser.close();
