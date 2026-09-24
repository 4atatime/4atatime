// The panel and the field at the same time: jumping between works without
// closing anything, turning the graph while reading, reaching a work the
// current category has dimmed, and where the camera puts what you opened.
import { chromium } from 'playwright';
import { discsOn, nameAt, emptySpot } from './lib/blobs.mjs';
const PORT = process.argv[2];
const base = 'http://localhost:' + PORT;
const browser = await chromium.launch();
const ok = [], bad = [];
const check = (n, pass, d = '') => (pass ? ok : bad).push(n + (d ? ` (${d})` : ''));

const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: 'reduce',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2400);

const hash = () => page.evaluate(() => location.hash);
const panelOpen = () => page.evaluate(() => {
  const p = document.getElementById('detail-window');
  return !!p && !p.hidden && !p.classList.contains('closing');
});
const panelBox = () => page.evaluate(() => {
  const p = document.getElementById('detail-window');
  return p && !p.hidden ? p.getBoundingClientRect().left : null;
});
const click = async (x, y) => {
  await page.mouse.move(x, y);
  await page.waitForTimeout(180);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
};

// ---------------------------------------------- jumping between works
let discs = await discsOn(page);
check('read the works off the canvas', discs.length >= 8, `${discs.length} discs`);
const A = discs[0];
await click(A.x, A.y);
await page.waitForTimeout(900);
const first = await hash();
check('clicking a work opens it', (await panelOpen()) && first.startsWith('#work/'), first || '(none)');

// The camera has moved onto it; re-read, and pick one clear of the panel.
const edge = await panelBox();
const gutter = await page.evaluate(() =>
  document.querySelector('.station').getBoundingClientRect().right + 14);
discs = (await discsOn(page)).filter((d) => d.x < edge - 30);
check('other works are reachable beside the panel', discs.length >= 2, `${discs.length} beside panel`);

// The work that was opened should be sitting in the middle of what the panel
// has left, not behind it: that is the whole point of the camera move.
const wanted = gutter + (edge - gutter) / 2;
const middle = discs.slice().sort((a, b) => Math.abs(a.x - wanted) - Math.abs(b.x - wanted))[0];
const midName = await nameAt(page, middle.x, middle.y);
const shown = await page.evaluate(() =>
  document.querySelector('#detail-window h1')?.textContent?.trim() ?? '');
check('the opened work is centred in the room left beside the panel',
  !!midName && midName.title.trim() === shown.trim() && Math.abs(middle.x - wanted) < 30,
  `"${midName?.title}" vs panel "${shown}", ${Math.round(middle.x)} vs ${Math.round(wanted)}`);

// Something else — explicitly not the work already open.
let target = null;
for (const d of discs) {
  if (Math.hypot(d.x - middle.x, d.y - middle.y) < 20) continue;
  const got = await nameAt(page, d.x, d.y);
  if (got?.title && got.title.trim() !== shown.trim()) { target = { ...d, title: got.title.trim() }; break; }
}
check('a different work can be pointed at with the panel up', !!target, target?.title ?? 'none');

await click(target.x, target.y);
await page.waitForTimeout(900);
const second = await hash();
check('clicking another work jumps straight to it, no close first',
  (await panelOpen()) && second.startsWith('#work/') && second !== first,
  `${first} -> ${second}`);
check('and the panel shows the work that was clicked',
  (await page.evaluate(() => document.querySelector('#detail-window h1')?.textContent?.trim())) === target.title.trim(),
  `${await page.evaluate(() => document.querySelector('#detail-window h1')?.textContent?.trim())} vs ${target.title}`);

// ------------------------------- the preview's own button, with a panel up
// Hovering a third work and pressing "Open the file" used to throw you out of
// the panel instead of taking you to it: the press closed the panel, and the
// reopen that followed swapped the content in without putting the panel back
// on screen, so it sat parked off-screen holding the right work.
{
  const open2 = await hash();
  let third = null;
  // A lower threshold than the default: works at the back of the cloud are
  // now faint enough to fall under it, and any of them will do here.
  const wide = (await discsOn(page, 55)).filter((d) => d.x < edge - 30);
  for (const d of wide) {
    if (Math.hypot(d.x - middle.x, d.y - middle.y) < 20) continue;
    const got = await nameAt(page, d.x, d.y);
    if (got?.title && got.title.trim() !== target.title.trim()) {
      third = { ...d, title: got.title.trim() };
      break;
    }
  }
  check('a third work can be previewed while the panel is up', !!third, third?.title ?? 'none');
  if (third) {
    await page.mouse.move(third.x, third.y);
    await page.waitForTimeout(250);
    const cta = await page.evaluate(() => {
      const b = document.querySelector('#graph-hud [data-hud-open]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    check('the preview offers its open button', !!cta);
    if (cta) {
      await page.mouse.move(cta.x, cta.y);
      await page.waitForTimeout(120);
      await page.mouse.down();
      await page.waitForTimeout(60);
      await page.mouse.up();
      await page.waitForTimeout(900);
      check('"Open the file" opens that work rather than closing the panel',
        (await panelOpen()) && (await hash()).startsWith('#work/') && (await hash()) !== open2,
        `${open2} -> ${await hash()}`);
      check('and the panel is actually on screen, not parked off it',
        await page.evaluate(() => {
          const p = document.getElementById('detail-window');
          return p.classList.contains('open') && p.getBoundingClientRect().left < window.innerWidth - 40;
        }));
      check('and it shows the work whose preview was used',
        (await page.evaluate(() => document.querySelector('#detail-window h1')?.textContent?.trim())) === third.title.trim(),
        `${await page.evaluate(() => document.querySelector('#detail-window h1')?.textContent?.trim())} vs ${third.title}`);
    }
  }
}

// ---------------------------------------------- reading while turning
const before = await hash();
await page.mouse.move(340, 500);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(340 + i * 14, 500 + i * 4);
await page.mouse.up();
await page.waitForTimeout(400);
check('dragging the field leaves the panel open', (await panelOpen()) && (await hash()) === before);

await page.mouse.move(400, 500);
await page.mouse.wheel(0, -300);
await page.waitForTimeout(400);
check('zooming leaves the panel open', (await panelOpen()) && (await hash()) === before);

// ---------------------------------------------- clicking off closes it
const empty = await emptySpot(page, { maxX: 0.46, minX: 0.19 });
check('found blank canvas beside the panel', !!empty);
if (empty) {
  await click(empty.x, empty.y);
  await page.waitForTimeout(700);
  check('clicking the empty field closes the panel', !(await panelOpen()), await hash() || '(none)');
}

// ---------------------------------------------- a dimmed work is still live
await page.click('[data-filter="ink"]');
await page.waitForTimeout(2800);
const lit = await page.evaluate(() =>
  document.querySelector('[data-filter][aria-pressed="true"]')?.dataset.filter);
check('a small category is showing', lit === 'ink');

// Find a work that isn't in it: its preview comes up bare. Dimmed works are
// drawn at a third of the alpha, so the threshold has to come down to see
// them at all — which is rather the point of the check.
const all = await discsOn(page, 28);
let dim = null;
for (const d of all.slice(0, 20)) {
  const got = await nameAt(page, d.x, d.y);
  if (got?.bare) { dim = { ...d, title: got.title }; break; }
}
check('a work outside the category still answers the pointer', !!dim, dim?.title ?? 'none');
if (dim) {
  check('and shows its name only, not a full slip', dim.title.length > 0,
    `"${dim.title}"`);
  const rows = await page.evaluate(() =>
    document.querySelectorAll('#graph-hud .hud-row').length);
  check('the bare preview carries no metadata rows', rows === 0, `${rows} rows`);

  await click(dim.x, dim.y);
  await page.waitForTimeout(1400);
  const now = await page.evaluate(() =>
    document.querySelector('[data-filter][aria-pressed="true"]')?.dataset.filter);
  check('clicking it switches to its own collection', now !== 'ink' && !!now, `ink -> ${now}`);
  check('and opens it', (await panelOpen()) && (await hash()).startsWith('#work/'), await hash());
}

// ---------------------------------------------- what the camera framed
await page.waitForTimeout(1400);
const edge2 = await panelBox();
const beside = (await discsOn(page, 28)).filter((d) => d.x < edge2 - 20 && d.x > 40);
check('the opened work is framed with company beside the panel',
  beside.length >= 3 && beside.length <= 12, `${beside.length} works in the clear`);

// ------------------------------------------ depth, measured off the canvas
// The guard that two rounds of this work went without. Both changed the
// constants, both computed a large front-to-back spread from them, and
// neither changed what was on screen: the arithmetic describes a work at the
// very front and one at the very back, and there is no such work. The only
// honest measurement is of the discs actually painted.
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2600);
const depth = await page.evaluate(() => {
  const c = document.getElementById('graph-canvas');
  const { data, width, height } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  const dpr = window.devicePixelRatio || 1;
  const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number);
  const A = (x, y) => data[((y * width + x) << 2) + 3];
  const T = 40, r = Math.max(2, Math.round(3 * dpr));
  const core = new Uint8Array(width * height);
  for (let y = r; y < height - r; y++) for (let x = r; x < width - r; x++)
    if (A(x,y) > T && A(x-r,y) > T && A(x+r,y) > T && A(x,y-r) > T && A(x,y+r) > T) core[y*width+x] = 1;
  const seen = new Uint8Array(width * height), out = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!core[i] || seen[i]) continue;
    let sx = 0, sy = 0, n = 0; const st = [i]; seen[i] = 1;
    while (st.length) {
      const j = st.pop(); const jx = j % width, jy = (j - jx) / width;
      sx += jx; sy += jy; n++;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = jx + dx, ny = jy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const k = ny * width + nx;
        if (core[k] && !seen[k]) { seen[k] = 1; st.push(k); }
      }
    }
    if (n < 6) continue;
    const cx = Math.round(sx / n), cy = Math.round(sy / n), o = (cy * width + cx) << 2;
    const a = data[o + 3] / 255;
    out.push([0,1,2].map((k) => a * data[o + k] + (1 - a) * bg[k]));
  }
  const lum = (c2) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4; };
    return 0.2126*f(c2[0]) + 0.7152*f(c2[1]) + 0.0722*f(c2[2]); };
  const ratio = (c2) => { const [h, l] = lum(c2) > lum(bg) ? [lum(c2), lum(bg)] : [lum(bg), lum(c2)];
    return (h + 0.05) / (l + 0.05); };
  const rs = out.map(ratio).sort((a2, b2) => b2 - a2);
  return { count: rs.length, near: rs[0], far: rs[rs.length - 1] };
});
check('enough works found to judge depth by', depth.count >= 12, `${depth.count} discs`);
check('the near works are far stronger than the far ones',
  depth.near / depth.far >= 4.5,
  `${depth.near.toFixed(2)}:1 nearest vs ${depth.far.toFixed(2)}:1 farthest = ${(depth.near/depth.far).toFixed(2)}x`);
check('and the far ones have not vanished doing it',
  depth.far >= 1.25, `farthest ${depth.far.toFixed(2)}:1`);

// ------------------------------------------------- the sky is actually there
// Same problem, same guard: a background nobody can see isn't doing its job.
check('the page has a sky rather than one flat fill',
  await page.evaluate(() => {
    const before = getComputedStyle(document.body, '::before');
    return before.backgroundImage !== 'none' && before.backgroundImage.includes('gradient');
  }));
// The film grain that used to sit over everything was removed on 2026-09-24,
// Lexie's decision: blended over a canvas that redraws every frame, it cost
// about a third of the page's measured GPU work. This keeps it from quietly
// coming back — no full-screen layer blended over the graph.
check('and no full-screen blended layer over the graph',
  await page.evaluate(() => {
    const after = getComputedStyle(document.body, '::after');
    return after.content === 'none' || after.mixBlendMode === 'normal';
  }));

check('no console errors', errors.length === 0, errors[0] ?? '');
await browser.close();
console.log('PASS:'); for (const n of ok) console.log('  ' + n);
if (bad.length) { console.log('\nFAIL:'); for (const n of bad) console.log('  ' + n); }
console.log(`\n${ok.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
