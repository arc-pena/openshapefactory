/**
 * Drives the built page in a real browser.
 *
 *   node skills/sphere-world-carousel/scripts/drive.mjs dist/sphere-world.html scenario.mjs
 *
 * The scenario is an ES module whose default export is called with the helpers
 * below. Anything it returns is printed as JSON, and a non-empty `errors` list
 * fails the run.
 *
 *   export default async ({ state, drag, step, lines, settle, shot }) => {
 *     await drag(-600);              // travel one item and let it snap
 *     await settle();
 *     return state();
 *   };
 *
 * Needs `npm i -D playwright`. Set PW_CHROMIUM to pin a browser binary.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [pageArg, scenarioArg] = process.argv.slice(2);
if (!pageArg) {
  console.error('usage: drive.mjs <page.html> [scenario.mjs]');
  process.exit(2);
}

function findChromium() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  const dir = fs.existsSync(base)
    ? fs.readdirSync(base).find((d) => /^chromium-\d+$/.test(d))
    : null;
  const bin = dir && path.join(base, dir, 'chrome-linux', 'chrome');
  return bin && fs.existsSync(bin) ? bin : undefined; // undefined = Playwright's own
}

const browser = await chromium.launch({
  executablePath: findChromium(),
  // Headless containers have no GPU; SwiftShader still renders the scene.
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
});

await page.goto(pathToFileURL(path.resolve(pageArg)).href, { waitUntil: 'load' });
await page
  .waitForFunction(() => !document.getElementById('preloader'), null, { timeout: 90000 })
  .catch(() => errors.push('world never finished loading'));
await page.waitForTimeout(1200);

/** What the app and its caption currently say — assert on this, not on pixels. */
const state = () =>
  page.evaluate(() => {
    const app = window.__app;
    return {
      counter: document.getElementById('counter-index').textContent,
      title: document.querySelector('.ui__title-line')?.textContent,
      category: document.getElementById('item-category').textContent,
      index: app?.nav?.index,
      target: app?.nav?.target,
      position: +(app?.nav?.position ?? 0).toFixed(3),
      locked: app?.nav?.locked,
      detail: document.getElementById('detail').classList.contains('is-open'),
    };
  });

/** Title lines in the mask, and how many are sitting at rest (i.e. visible). */
const lines = () =>
  page.evaluate(() => {
    const all = [...document.querySelectorAll('.ui__title-line')];
    const atRest = all.filter(
      (l) => Math.abs(new DOMMatrix(getComputedStyle(l).transform).m42) < 6
    );
    return { nodes: all.length, visible: atRest.length, texts: atRest.map((l) => l.textContent) };
  });

/**
 * A real drag. Never probe between the moves: the round trip stretches each
 * step, the app reads a pointer velocity near zero, and the flick dies.
 */
async function drag(dx, { y = 400, steps = 14 } = {}) {
  const from = dx < 0 ? 1100 : 180;
  await page.mouse.move(from, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from + (dx * i) / steps, y);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
}

const step = async (n = 1) => {
  for (let i = 0; i < Math.abs(n); i++) {
    await page.keyboard.press(n < 0 ? 'ArrowLeft' : 'ArrowRight');
    await page.waitForTimeout(90);
  }
};

/**
 * Waits for the world to actually arrive, not for a guessed number of
 * milliseconds. Software WebGL renders slowly enough that the app's dt clamp
 * (50 ms) puts the whole animation into slow motion, so fixed waits here read
 * as "the snap didn't happen".
 */
async function settle({ timeout = 20000, quiet = 450 } = {}) {
  await page
    .waitForFunction(
      () => {
        const nav = window.__app?.nav;
        return nav && Math.abs(nav.position - nav.target) < 0.01;
      },
      null,
      { timeout }
    )
    .catch(() => errors.push('world never settled on its target'));
  await page.waitForTimeout(quiet); // let the caption swap finish too
}
const shot = (file) => page.screenshot({ path: file });

let result = null;
if (scenarioArg) {
  const scenario = await import(pathToFileURL(path.resolve(scenarioArg)).href);
  result = await scenario.default({ page, state, lines, drag, step, settle, shot });
}

console.log(JSON.stringify({ result: result ?? (await state()), errors }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
