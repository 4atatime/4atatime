// Three things added on 2026-09-26, each measured off the page:
//
//   · on a phone, the field follows the finger rather than trailing it, and a
//     dragged work stays under the finger that holds it;
//   · the phone legend has no background of its own;
//   · a work's plates open full size, step left and right, and close again —
//     with everything behind them drained to grey.
import { chromium, devices } from 'playwright';
import { discsOn } from './lib/blobs.mjs';
const PORT = process.argv[2];
const base = 'http://localhost:' + PORT;
const browser = await chromium.launch();
const ok = [], bad = [];
const check = (n, pass, d = '') => (pass ? ok : bad).push(n + (d ? ` (${d})` : ''));
const errors = [];
const watch = (page) => {
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push(m.text()); });
  // The click one-shots are optional and were never supplied (see the note
  // in Controls.astro), so every button press asks for one and gets a 404.
  page.on('response', r => { if (r.status() >= 400 && !/\/audio\/click-\d\.mp3$/.test(r.url())) errors.push(r.status() + ' ' + r.url()); });
};

/** How far the works moved between two readings: median nearest-disc distance. */
function shift(a, b) {
  const d = a.map(p => Math.min(...b.map(q => Math.hypot(p.x - q.x, p.y - q.y)))).sort((x, y) => x - y);
  return d.length ? d[Math.floor(d.length / 2)] : Infinity;
}

// ─── Phone ──────────────────────────────────────────────────────────────────
// Reduced motion, so the idle drift and spin are off and anything that moves
// was moved by the finger.
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'], isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);

  // The legend: nothing painted behind it.
  const legendBg = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.station'));
    return s.backgroundImage + ' ' + s.backgroundColor;
  });
  check('phone legend has no background of its own', legendBg === 'none rgba(0, 0, 0, 0)', legendBg);

  const box = await page.locator('#graph-canvas').boundingBox();
  const client = await page.context().newCDPSession(page);
  const touch = (type, x, y) => client.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 0 }],
  });

  // --- Turning: the field stops when the finger stops ---------------------
  // Drag across empty space, then hold still. If the camera trails the
  // finger it is still catching up after the last move; if it follows, the
  // works are already where they will stay.
  // Start well clear of every work, or the press picks one up and this
  // becomes a drag rather than a turn.
  const resting = await discsOn(page);
  let x0 = box.x + 40, y0 = box.y + box.height * 0.6;
  search: for (let y = box.height * 0.4; y < box.height * 0.8; y += 10) {
    for (let x = 30; x < box.width - 180; x += 10) {
      if (resting.every(d => Math.hypot(d.x - x, d.y - y) > 50)) { x0 = box.x + x; y0 = box.y + y; break search; }
    }
  }
  await touch('touchStart', x0, y0);
  for (let i = 1; i <= 10; i++) {
    await touch('touchMove', x0 + i * 14, y0);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(40);
  const held1 = await discsOn(page);
  await page.waitForTimeout(160);
  const held2 = await discsOn(page);
  await touch('touchEnd');
  const trail = shift(held1, held2);
  check('a held finger holds the field still (no trailing)', trail < 1.5, `works moved ${trail.toFixed(1)}px after the finger stopped`);

  // --- A flick glides on and settles --------------------------------------
  await page.waitForTimeout(800);
  const beforeFlick = await discsOn(page);
  await touch('touchStart', x0, y0);
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', x0 + i * 22, y0);
    await page.waitForTimeout(16);
  }
  await touch('touchEnd');
  const atRelease = await discsOn(page);
  await page.waitForTimeout(90);
  const gliding = await discsOn(page);
  await page.waitForTimeout(1200);
  const settled1 = await discsOn(page);
  await page.waitForTimeout(150);
  const settled2 = await discsOn(page);
  check('a flick carries on briefly after the finger lifts', shift(atRelease, gliding) > 2,
    `${shift(atRelease, gliding).toFixed(1)}px in the 90ms after release`);
  check('and then comes to rest', shift(settled1, settled2) < 1,
    `${shift(settled1, settled2).toFixed(1)}px once settled`);
  check('the flick turned the field at all', shift(beforeFlick, settled1) > 5);

  // --- Dragging a work: it stays under the finger ---------------------------
  await page.waitForTimeout(600);
  const discs = (await discsOn(page)).filter(d =>
    d.y > box.y + box.height * 0.35 && d.y < box.y + box.height * 0.7 &&
    d.x > box.x + 70 && d.x < box.x + box.width - 110);
  const grab = discs[0];
  if (!grab) {
    check('found a work to drag', false);
  } else {
    const to = { x: grab.x + 70, y: grab.y - 60 };
    await touch('touchStart', grab.x, grab.y);
    for (let i = 1; i <= 12; i++) {
      await touch('touchMove', grab.x + (70 * i) / 12, grab.y - (60 * i) / 12);
      await page.waitForTimeout(16);
    }
    // Let the simulation run with the finger still down: it re-heats while a
    // work is dragged, and it used to shove the held work about.
    await page.waitForTimeout(500);
    const under = await discsOn(page);
    await touch('touchEnd');
    const off = Math.min(...under.map(d => Math.hypot(d.x - to.x, d.y - to.y)));
    check('a dragged work stays under the finger', off < 4, `${off.toFixed(1)}px from the fingertip`);
  }
  await client.detach();

  // --- Plates on the phone: swipe to step ----------------------------------
  const id = await page.evaluate(() =>
    [...document.querySelectorAll('template[data-panel^="work/"]')]
      .find(t => t.content.querySelectorAll('[data-plate]').length >= 3)?.dataset.panel);
  await page.goto(base + '/#' + id, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.locator('#detail-body [data-plate]').first().tap();
  await page.waitForTimeout(500);
  const count = () => page.locator('#plate-viewer-count').textContent();
  const first = await count();
  const c2 = await page.context().newCDPSession(page);
  const vp = page.viewportSize();
  await c2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: vp.width * 0.8, y: vp.height / 2, id: 0 }] });
  for (let i = 1; i <= 6; i++) {
    await c2.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: vp.width * 0.8 - i * 30, y: vp.height / 2, id: 0 }] });
    await page.waitForTimeout(16);
  }
  await c2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await c2.detach();
  await page.waitForTimeout(200);
  check('phone: swiping left shows the next plate', first.startsWith('01') && (await count()).startsWith('02'), `${first} -> ${await count()}`);
  const arrows = await page.locator('#plate-viewer .nav').evaluateAll(els => els.map(e => {
    const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth;
  }));
  check('phone: both arrows are on screen', arrows.length === 2 && arrows.every(Boolean));
  await page.locator('#plate-viewer [data-plate-close]').tap();
  await page.waitForTimeout(400);
  check('phone: the cross closes the plate, and the work stays open',
    await page.evaluate(() => document.getElementById('plate-viewer').hidden && !document.getElementById('detail-window').hidden));
  await ctx.close();
}

// ─── Desktop ────────────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  const id = await page.evaluate(() =>
    [...document.querySelectorAll('template[data-panel^="work/"]')]
      .find(t => t.content.querySelectorAll('[data-plate]').length >= 3)?.dataset.panel);
  const total = await page.evaluate((key) =>
    document.querySelector(`template[data-panel="${key}"]`).content.querySelectorAll('[data-plate]').length, id);
  await page.goto(base + '/#' + id, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  // Mean saturation of the selected category chip in the legend: filled
  // with the accent green, and beside the panel rather than under it, so
  // it's a coloured thing that is always on screen to read greyscale off.
  // (A work's own plates won't do — plenty of them are black and white.)
  const saturation = async () => {
    const r = await page.locator('.station .filter[aria-pressed="true"] .code').boundingBox();
    const shot = await page.screenshot({ clip: r });
    return page.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      let t = 0; for (let i = 0; i < d.length; i += 4) t += Math.max(d[i], d[i+1], d[i+2]) - Math.min(d[i], d[i+1], d[i+2]);
      return t / (d.length / 4);
    }, shot.toString('base64'));
  };
  // Bring the plates on screen first, as the click below would, so the
  // before-and-after readings are of the same view.
  await page.locator('#detail-body [data-plate]').first().scrollIntoViewIfNeeded();
  // In dev the images are made on first request, which can take a while.
  await page.waitForFunction(() => [...document.querySelectorAll('#detail-body [data-plate] img')]
    .filter(i => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })
    .every(i => i.complete && i.naturalWidth > 0), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(300);
  const colourBefore = await saturation();

  const viewer = () => page.evaluate(() => {
    const v = document.getElementById('plate-viewer');
    const img = document.getElementById('plate-viewer-img');
    const r = img.getBoundingClientRect();
    return {
      open: !v.hidden && v.classList.contains('open'),
      loaded: img.complete && img.naturalWidth > 0,
      share: Math.max(r.width / innerWidth, r.height / innerHeight),
      src: img.currentSrc,
      count: document.getElementById('plate-viewer-count').textContent,
      panelOpen: !document.getElementById('detail-window').hidden,
    };
  });

  await page.locator('#detail-body [data-plate]').first().click();
  await page.waitForTimeout(700);
  let v = await viewer();
  check('clicking a plate opens it full size', v.open && v.loaded);
  check('the plate takes 70% of the screen', v.share > 0.69 && v.share < 0.705, `${(v.share * 100).toFixed(1)}%`);
  check('it starts at the plate that was clicked', v.count === `01 / ${String(total).padStart(2, '0')}`, v.count);
  const colourAfter = await saturation();
  check('the rest of the screen goes grey', colourBefore > 40 && colourAfter < 4,
    `legend's green chip, saturation ${colourBefore.toFixed(0)} -> ${colourAfter.toFixed(0)}`);

  const firstSrc = v.src;
  await page.locator('#plate-viewer .next').click();
  await page.waitForTimeout(300);
  v = await viewer();
  check('the right arrow shows the next plate', v.count.startsWith('02') && v.src !== firstSrc, v.count);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(200);
  v = await viewer();
  check('stepping back past the first wraps to the last', v.count.startsWith(String(total).padStart(2, '0')), v.count);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  v = await viewer();
  check('Escape closes the plate but leaves the work open', !v.open && v.panelOpen);

  await page.locator('#detail-body [data-plate]').nth(1).click();
  await page.waitForTimeout(500);
  v = await viewer();
  check('the second plate opens at 02', v.open && v.count.startsWith('02'), v.count);
  await page.mouse.click(30, 450);
  await page.waitForTimeout(400);
  v = await viewer();
  check('a click on the grey around it closes it, work still open', !v.open && v.panelOpen);

  await page.locator('#detail-body [data-plate]').first().click();
  await page.waitForTimeout(500);
  await page.locator('#plate-viewer [data-plate-close]').click();
  await page.waitForTimeout(400);
  v = await viewer();
  check('the cross closes it', !v.open && v.panelOpen);
  check('and colour comes back', (await saturation()) > colourBefore * 0.8);
  await ctx.close();
}

await browser.close();
console.log('PASS:\n  ' + ok.join('\n  '));
if (bad.length) console.log('\nFAIL:\n  ' + bad.join('\n  '));
console.log(errors.length ? '\nerrors:\n  ' + errors.join('\n  ') : '\nno console errors');
console.log(`\n${ok.length} passed, ${bad.length} failed`);
process.exit(bad.length || errors.length ? 1 : 0);
