// Getting about: can you zoom to where you mean, slide the view, fail to lose
// the field, and find your way back — and is the sky part of the same space?
import { chromium, devices } from 'playwright';
import { discsOn } from './lib/blobs.mjs';
const PORT = process.argv[2];
const base = 'http://localhost:' + PORT;
const browser = await chromium.launch();
const ok = [], bad = [];
const check = (n, pass, d = '') => (pass ? ok : bad).push(n + (d ? ` (${d})` : ''));

const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
  reducedMotion: 'reduce',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2400);

const discs = () => discsOn(page, 30, 0);
const spanOf = (d) => {
  const xs = d.map((v) => v.x), ys = d.map((v) => v.y);
  return { n: d.length, x: (Math.min(...xs) + Math.max(...xs)) / 2,
           y: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs) };
};
const nearest = (d, x, y) => d.slice().sort((a, c) =>
  Math.hypot(a.x - x, a.y - y) - Math.hypot(c.x - x, c.y - y))[0];
const home = async () => { await page.keyboard.press('0'); await page.waitForTimeout(2200); };

const landing = spanOf(await discs());
check('the field arrives framed', landing.n >= 15, `${landing.n} works`);

// --- zoom goes where you point ---
let d = (await discs()).sort((a, c) => c.area - a.area);
const mark = d[3];
await page.mouse.move(mark.x, mark.y);
await page.waitForTimeout(150);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(1500);
const held = nearest(await discs(), mark.x, mark.y);
const drift = Math.hypot(held.x - mark.x, held.y - mark.y);
check('zooming keeps what you pointed at under the pointer', drift < 14, `${Math.round(drift)}px drift`);
const biggestAt = (list) => Math.max(...list.map((v) => v.area));
check('and it did zoom in',
  biggestAt(await discs()) > biggestAt(d) * 1.5,
  `largest disc ${Math.round(biggestAt(await discs()))} from ${Math.round(biggestAt(d))}`);

// --- sliding the view ---
await home();
const slideFrom = await discs();
const before = spanOf(slideFrom);
await page.keyboard.down('Shift');
await page.mouse.move(800, 500);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(800 - i * 6, 500);
await page.mouse.up();
await page.keyboard.up('Shift');
await page.waitForTimeout(1000);
const slideTo = await discs();
const slid = spanOf(slideTo);
check('shift-drag slides the view by what you dragged',
  Math.abs(slid.x - before.x + 60) < 14, `${Math.round(slid.x - before.x)}px for a 60px drag`);

await home();
const spun0raw = await discs();
await page.mouse.move(800, 500);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(800 - i * 14, 500);
await page.mouse.up();
await page.waitForTimeout(1000);
// A slide is rigid: it carries the whole arrangement across unchanged, so the
// cloud's width and the size of its biggest disc both survive it. A turn is
// not: works swap places in depth, so the shape and the sizes both move.
const shape = (list) => {
  const xs = list.map((v) => v.x), ys = list.map((v) => v.y);
  return {
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
    big: Math.max(...list.map((v) => v.area)),
  };
};
// Rigidity is judged on the arrangement's width and height only. Disc area
// is no use for it: two works that overlap are read as one blob, so the
// largest blob's size jumps about as the slide separates or merges them,
// which says nothing about whether the motion was rigid.
const s0 = shape(slideFrom), s1 = shape(slideTo);
check('and a slide carries the arrangement across unchanged',
  Math.abs(s1.w - s0.w) < 5 && Math.abs(s1.h - s0.h) < 5,
  `${Math.round(s0.w)}x${Math.round(s0.h)} → ${Math.round(s1.w)}x${Math.round(s1.h)}`);

const spun1 = await discs();
const t0 = shape(spun0raw), t1 = shape(spun1);
// Non-rigidity only needs one witness, and under a turn the works change
// depth — so the sizes move even when the outline happens not to.
check('a plain drag turns the field rather than sliding it',
  Math.abs(t1.w - t0.w) > 8 || Math.abs(t1.h - t0.h) > 8 || Math.abs(t1.big / t0.big - 1) > 0.1,
  `${Math.round(t0.w)}x${Math.round(t0.h)} → ${Math.round(t1.w)}x${Math.round(t1.h)}, largest ${Math.round(t0.big)}→${Math.round(t1.big)}`);

// --- you cannot lose it ---
await home();
await page.mouse.move(1290, 220);
for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(80); }
for (let k = 0; k < 3; k++) {
  await page.mouse.move(300, 500);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) await page.mouse.move(300 + i * 40, 500 + i * 10);
  await page.mouse.up();
  await page.waitForTimeout(500);
}
await page.waitForTimeout(800);
const lost = await discs();
check('the field cannot be driven off screen', lost.length >= 3, `${lost.length} works still in frame`);
check('and the way back is offered once most of it has gone',
  await page.evaluate(() => {
    const el = document.getElementById('graph-recentre');
    return !!el && !el.hidden;
  }));

await page.evaluate(() => document.getElementById('graph-recentre').click());
await page.waitForTimeout(2400);
const back = spanOf(await discs());
check('recentre restores the framing it started with',
  Math.abs(back.x - landing.x) < 3 && Math.abs(back.w - landing.w) < 6,
  `${Math.round(back.x)},${Math.round(back.w)} vs ${Math.round(landing.x)},${Math.round(landing.w)}`);
check('and the offer goes away again',
  await page.evaluate(() => {
    const el = document.getElementById('graph-recentre');
    return !!el && !el.classList.contains('showing');
  }));

// --- the sky is in the same space ---
/** Faint isolated specks: the stars, and nothing else painted is like them. */
const specks = () => page.evaluate(() => {
  const c = document.getElementById('graph-canvas');
  const { data, width, height } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  const A = (x, y) => data[((y * width + x) << 2) + 3];
  const dpr = window.devicePixelRatio || 1;
  const seen = new Uint8Array(width * height);
  const out = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (seen[i] || A(x, y) < 30) continue;
    let sx = 0, sy = 0, n = 0;
    const st = [i];
    seen[i] = 1;
    while (st.length && n < 900) {
      const j = st.pop(); const jx = j % width, jy = (j - jx) / width;
      sx += jx; sy += jy; n++;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = jx + dx, ny = jy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const k = ny * width + nx;
        if (!seen[k] && A(nx, ny) >= 30) { seen[k] = 1; st.push(k); }
      }
    }
    // Star-sized and star-shaped: a few pixels, round, isolated. A link is
    // long and a work is large, so neither lands in this band.
    if (n < 2 || n > 26 * dpr * dpr) continue;
    const cx = sx / n, cy = sy / n;
    const reach = Math.sqrt(n / Math.PI) + 5 * dpr;
    let alone = true;
    for (let k = 0; k < 12 && alone; k++) {
      const a2 = (k / 12) * Math.PI * 2;
      const rx = Math.round(cx + Math.cos(a2) * reach);
      const ry = Math.round(cy + Math.sin(a2) * reach);
      if (rx < 0 || ry < 0 || rx >= width || ry >= height) continue;
      if (A(rx, ry) > 14) alone = false;
    }
    if (alone) out.push(`${Math.round(cx / 4) * 4},${Math.round(cy / 4) * 4}`);
  }
  return out;
});
const sky1 = await specks();
check('there is a sky drawn into the canvas', sky1.length >= 20, `${sky1.length} star-sized marks`);
check('and the sky is a scatter rather than a dense field',
  sky1.length <= 600, `${sky1.length} star-sized marks`);

// Turn the field: a wallpaper would not move.
await page.mouse.move(700, 450);
await page.mouse.down();
for (let i = 1; i <= 12; i++) await page.mouse.move(700 + i * 22, 450);
await page.mouse.up();
await page.waitForTimeout(1400);
const sky2 = await specks();
const kept = sky2.filter((p) => sky1.includes(p)).length;
check('the sky turns with the camera rather than sitting still',
  sky2.length > 0 && kept / Math.max(sky1.length, sky2.length) < 0.5,
  `${kept} of ${sky1.length} stars in the same place`);

check('no console errors', errors.length === 0, errors[0] ?? '');
await browser.close();
console.log('PASS:'); for (const n of ok) console.log('  ' + n);
if (bad.length) { console.log('\nFAIL:'); for (const n of bad) console.log('  ' + n); }
console.log(`\n${ok.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
