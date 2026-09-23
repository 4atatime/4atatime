// Mobile interaction: the gestures and the two-sheet flow.
import { chromium, devices } from 'playwright';
import { cloudBox } from './lib/blobs.mjs';
const PORT = process.argv[2];
const base = 'http://localhost:' + PORT;
const browser = await chromium.launch();
const ok = [], bad = [];
const check = (n, pass, d = '') => (pass ? ok : bad).push(n + (d ? ` (${d})` : ''));

const ctx = await browser.newContext({ ...devices['iPhone 13'], isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);

// No debug hook in the shipped code: measure how big the cloud is actually
// drawn instead. Zooming changes that, which is the thing we care about.
// Measured from the works themselves, not from every lit pixel: the sky is
// drawn into this canvas too, and its extent is always the whole window.
const spread = async () => {
  const box = await cloudBox(page, 60);
  return box ? Math.max(box.w, box.h) : null;
};

// --- Two-finger pinch -----------------------------------------------------
const before = await spread();
const box = await page.locator('#graph-canvas').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

// Playwright has no pinch helper; drive two touch points directly.
async function pinch(fromGap, toGap, steps = 12) {
  const client = await page.context().newCDPSession(page);
  const pt = (dx) => [{ x: cx - dx, y: cy }, { x: cx + dx, y: cy }];
  const send = (type, pts) => client.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })),
  });
  await send('touchStart', pt(fromGap / 2));
  for (let i = 1; i <= steps; i++) {
    const gap = fromGap + ((toGap - fromGap) * i) / steps;
    await send('touchMove', pt(gap / 2));
    await page.waitForTimeout(16);
  }
  await send('touchEnd', []);
  await client.detach();
}

await pinch(80, 240);
await page.waitForTimeout(700);
const afterOut = await spread();
check('two fingers spreading zooms in', afterOut !== null && afterOut > before * 1.25,
  `cloud ${before?.toFixed(0)}px -> ${afterOut?.toFixed(0)}px`);

await pinch(240, 90);
await page.waitForTimeout(700);
const afterIn = await spread();
check('two fingers pinching zooms out', afterIn !== null && afterIn < afterOut * 0.85,
  `cloud ${afterOut?.toFixed(0)}px -> ${afterIn?.toFixed(0)}px`);

// --- One finger still turns the field -------------------------------------
await page.waitForTimeout(300);
const spreadBeforeDrag = await spread();
// A one-finger drag across empty space must orbit, not zoom.
const client = await page.context().newCDPSession(page);
await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 30, y: cy, id: 0 }] });
for (let i = 1; i <= 10; i++) {
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 30 + i * 12, y: cy, id: 0 }] });
  await page.waitForTimeout(16);
}
await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await client.detach();
await page.waitForTimeout(600);
const spreadAfterDrag = await spread();
// Orbiting changes which way the cloud faces, so its drawn extent moves a
// little; zooming would change it by a lot. 15% is comfortably between.
check('one finger drag turns the field without zooming',
  spreadAfterDrag !== null && Math.abs(spreadAfterDrag - spreadBeforeDrag) / spreadBeforeDrag < 0.15,
  `cloud ${spreadBeforeDrag?.toFixed(0)}px -> ${spreadAfterDrag?.toFixed(0)}px`);

// --- Preview sheet --------------------------------------------------------
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1600);
await page.focus('[data-graph-focus="sifted"]');
await page.waitForTimeout(600);

const hud = await page.locator('#graph-hud').boundingBox();
const vp = page.viewportSize();
check('preview sits at the bottom edge', hud && Math.abs(hud.y + hud.height - vp.height) < 2,
  hud ? `bottom at ${(hud.y + hud.height).toFixed(0)} of ${vp.height}` : 'no box');
check('preview spans the full width', hud && hud.width >= vp.width - 1,
  hud ? `${hud.width.toFixed(0)}px of ${vp.width}` : 'no box');

const barTop = (await page.locator('.bottom-bar').boundingBox()).y;
check('preview covers the footer', hud && hud.y < barTop, `sheet top ${hud?.y.toFixed(0)} vs bar ${barTop.toFixed(0)}`);

const stack = await page.evaluate(() => ({
  hud: +getComputedStyle(document.getElementById('graph-hud')).zIndex,
  bar: +getComputedStyle(document.querySelector('.bottom-bar')).zIndex,
  win: +getComputedStyle(document.getElementById('detail-window')).zIndex,
}));
check('stacking: footer < preview < detail', stack.bar < stack.hud && stack.hud < stack.win,
  `${stack.bar} < ${stack.hud} < ${stack.win}`);

// --- Detail sheet ---------------------------------------------------------
await page.evaluate(() => { location.hash = '#work/sifted'; });
await page.waitForTimeout(700);
const win = await page.locator('#detail-window').boundingBox();
check('detail covers nearly the whole screen', win && win.height > vp.height * 0.9,
  win ? `${win.height.toFixed(0)} of ${vp.height}` : 'none');
check('detail leaves a sliver to tap above', win && win.y > 4 && win.y < 40, `top at ${win?.y.toFixed(0)}`);
check('preview cleared when the detail opened', await page.locator('#graph-hud').isHidden());

// --- Slide out ------------------------------------------------------------
await page.evaluate(() => {
  history.pushState(null, '', location.pathname + location.search);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
});
await page.waitForTimeout(80);
const mid = await page.evaluate(() => {
  const el = document.getElementById('detail-window');
  return { closing: el.classList.contains('closing'), hidden: el.hidden };
});
check('detail animates out rather than vanishing', mid.closing && !mid.hidden,
  `closing=${mid.closing} hidden=${mid.hidden}`);
await page.waitForTimeout(500);
check('detail is gone once the slide finishes', await page.locator('#detail-window').isHidden());

console.log('PASS:\n  ' + ok.join('\n  '));
if (bad.length) console.log('\nFAIL:\n  ' + bad.join('\n  '));
console.log(errors.length ? '\nCONSOLE:\n  ' + errors.slice(0, 4).join('\n  ') : '\nno console errors');
await browser.close();
process.exit(bad.length ? 1 : 0);
