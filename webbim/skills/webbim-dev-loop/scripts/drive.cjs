// Drive the built single-file app in headless Chromium and assert on the document.
// Usage: node drive.cjs <repo>/webbim/dist/web-bim.html <three.min.js> [scenario.cjs]
// A scenario module exports async (t) => {...} and gets the helpers below as `t`.
// Without one, it opens Studio House, opens the first elevation and prints its hit list.
const { chromium } = require(process.env.PLAYWRIGHT || "/opt/node22/lib/node_modules/playwright");
const fs = require("fs"), path = require("path");
const [HTML, THREE, SCEN] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });   // WebGL without a GPU
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", e => console.log("PAGEERROR:", e.message));
  // the page loads three.js from cdnjs; serve a local copy so the run needs no network
  if (THREE) await page.route("https://cdnjs.cloudflare.com/**", r => r.fulfill({ body: fs.readFileSync(THREE), contentType: "text/javascript" }));
  // expose the app object for assertions (the bundle keeps it in its own scope)
  const html = fs.readFileSync(HTML, "utf8").replace("async function boot() {", "window.__app = app; async function boot() {");
  await page.setContent("<!doctype html><html><head><meta charset=utf-8></head><body>" + html + "</body></html>", { waitUntil: "load" });
  await page.waitForTimeout(3000);
  const ev = (f, a) => page.evaluate(f, a);
  const t = {
    page, ev,
    wait: ms => page.waitForTimeout(ms),
    async sample(name = "Studio House Sample") {
      await page.getByText("File", { exact: true }).first().click(); await page.waitForTimeout(300);
      await page.getByText(name, { exact: true }).first().click(); await page.waitForTimeout(2500);
    },
    async openFirst(type) { const id = await ev(ty => __app.doc.idOf(__app.doc.elements().find(f => __app.doc.typeOf(f) === ty)), type); await ev(i => __app.openView(i), id); await page.waitForTimeout(1200); return id; },
    // model point (view coordinates) → page pixels, for page.mouse
    screen: (viewId, p) => ev(([id, p]) => { const v = __app.views.get(id), r = v.canvas.getBoundingClientRect(), q = v.toScreen(p); return [r.left + q[0], r.top + q[1]]; }, [viewId, p]),
    count: type => ev(ty => __app.doc.elements().filter(f => __app.doc.typeOf(f) === ty).length, type),
    msg: () => ev(() => document.getElementById("msg").textContent),
    arg: (id, key) => ev(([i, k]) => __app.doc.argValue(__app.doc.element(i), k), [id, key]),
    // what a click at model point p would hit, frontmost first - check this BEFORE blaming the code
    hitsAt: (viewId, p) => ev(([id, p]) => { const v = __app.views.get(id), q = v.toScreen(p); return v.hitsAt(q[0], q[1]).map(h => [h.id, __app.doc.typeOf(__app.doc.element(h.id)), h.depth | 0]); }, [viewId, p]),
    // every hit region in a view with its model bbox and depth
    hitBoxes: viewId => ev(id => __app.views.get(id).scene().hits.map(h => { const xs = h.pts.map(p => p[0]), ys = h.pts.map(p => p[1]); const f = __app.doc.element(h.id); return [h.id, f && __app.doc.typeOf(f), h.kind, h.depth | 0, [Math.min(...xs) | 0, Math.min(...ys) | 0, Math.max(...xs) | 0, Math.max(...ys) | 0]]; }), viewId),
    shot: file => page.screenshot({ path: file }),
  };
  if (SCEN) await require(path.resolve(SCEN))(t);
  else { await t.sample(); const v = await t.openFirst("ElevationView"); for (const r of await t.hitBoxes(v)) console.log(JSON.stringify(r)); }
  await browser.close();
})();
