// Getting back out of a category: does clicking empty space really return you
// to All, and do the things that aren't clicks (drags, pinches, taps that land
// on something) leave the filter alone?
import { chromium, devices } from 'playwright';
import { discsOn, emptySpot } from './lib/blobs.mjs';
const PORT = process.argv[2];
const base = 'http://localhost:' + PORT;
const browser = await chromium.launch();
const ok = [], bad = [];
const check = (n, pass, d = '') => (pass ? ok : bad).push(n + (d ? ` (${d})` : ''));

/** Which category chip is currently pressed. */
const current = (page) => page.evaluate(() =>
  document.querySelector('[data-filter][aria-pressed="true"]')?.dataset.filter ?? null);

/**
 * A work that the shown category is highlighting.
 *
 * Was "the most opaque pixel on the canvas", which stopped meaning a circle
 * once the depth cue was deepened: a link at the front of the cloud now
 * reaches full alpha too, so the brightest pixel could be a line. Eroding the
 * mask keeps only things thick enough to be discs, and the preview says
 * whether the one we picked is in the category or merely visible.
 */
const litNode = async (page) => (await discsOn(page))[0] ?? null;

/** The most opaque pixel on the canvas — always inside a circle. */
const nodePoint = (page) => page.evaluate(() => {
  const c = document.getElementById('graph-canvas');
  const { data, width, height } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  const dpr = window.devicePixelRatio || 1;
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    const a = data[(y * width + x) * 4 + 3];
    if (a > best) { best = a; bx = x; by = y; }
  }
  return { x: bx / dpr, y: by / dpr, alpha: best };
});

/** A spot with nothing drawn near it, clear of the header, chips and footer. */
/**
 * Somewhere a press lands on nothing.
 *
 * Was "a patch of canvas with no pixels painted in it", which no longer
 * exists now the sky is drawn there — and never needed to. Only the works
 * are click targets, so clear of those is what empty means.
 */
const emptyPoint = (page) => emptySpot(page);

const tap = (page, x, y) => page.touchscreen.tap(x, y);

// ---------------------------------------------------------------- desktop
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);

  const hint = () => page.evaluate(() => {
    const li = document.querySelector('.key .escape.on-pointer');
    return li ? getComputedStyle(li).display !== 'none' : false;
  });
  check('desktop: no way-out hint before a category is picked', (await hint()) === false);

  await page.click('[data-filter="uiux"]');
  await page.waitForTimeout(2600);
  check('desktop: the chip took', (await current(page)) === 'uiux');
  check('desktop: the way-out hint appears with the category', (await hint()) === true);

  // A drag is not a click.
  let empty = await emptyPoint(page);
  check('desktop: found blank canvas to test against', !!empty, empty ? `${Math.round(empty.x)},${Math.round(empty.y)}` : 'none');
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(empty.x - i * 14, empty.y + i * 4);
  await page.mouse.up();
  await page.waitForTimeout(400);
  check('desktop: dragging the field keeps the category', (await current(page)) === 'uiux');

  // Nor is a wheel zoom.
  await page.mouse.wheel(0, -320);
  await page.waitForTimeout(500);
  check('desktop: zooming keeps the category', (await current(page)) === 'uiux');

  // Clicking a work opens it and leaves the filter alone.
  const node = await litNode(page);
  await page.mouse.move(node.x, node.y);
  await page.waitForTimeout(150);
  await page.mouse.click(node.x, node.y);
  await page.waitForTimeout(700);
  const opened = await page.evaluate(() => {
    const p = document.getElementById('detail-window');
    return !!p && !p.hidden && !p.classList.contains('closing');
  });
  check('desktop: clicking a work opens it', opened);
  check('desktop: opening a work keeps the category', (await current(page)) === 'uiux');

  // First click outside puts the panel away — one thing at a time.
  empty = await emptyPoint(page);
  await page.mouse.click(empty.x, empty.y);
  await page.waitForTimeout(600);
  check('desktop: that click closed the panel',
    await page.evaluate(() => document.getElementById('detail-window')?.hidden !== false));
  check('desktop: closing the panel does not also clear the category', (await current(page)) === 'uiux');

  // Second click, with nothing else to dismiss, goes back to All.
  empty = await emptyPoint(page);
  await page.mouse.click(empty.x, empty.y);
  await page.waitForTimeout(1200);
  check('desktop: clicking blank space returns to All', (await current(page)) === 'all');
  check('desktop: the hint goes away with the category', (await hint()) === false);

  // A different chip means that category, not All.
  await page.click('[data-filter="uiux"]');
  await page.waitForTimeout(2200);
  await page.click('[data-filter="grafix"]');
  await page.waitForTimeout(2200);
  check('desktop: another chip switches category rather than clearing',
    (await current(page)) === 'grafix', await current(page));

  // About & Contact sits over the graph; clicking into it must not clear.
  await page.click('a[href="#about"]');
  await page.waitForTimeout(800);
  const aboutOpen = await page.evaluate(() => {
    const p = document.getElementById('detail-window');
    return !!p && !p.hidden;
  });
  if (aboutOpen) {
    const box = await page.evaluate(() => {
      const r = document.getElementById('detail-window').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(500);
    check('desktop: clicking inside About keeps the category', (await current(page)) === 'grafix', await current(page));
  } else {
    check('desktop: About panel opened for the click test', false, 'did not open');
  }

  check('desktop: no console errors', errors.length === 0, errors[0] ?? '');
  await ctx.close();
}

// ----------------------------------------------------------------- mobile
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'], isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);

  const hint = () => page.evaluate(() => {
    const li = document.querySelector('.key .escape.on-touch');
    return li ? getComputedStyle(li).display !== 'none' : false;
  });

  await page.tap('[data-filter="uiux"]');
  await page.waitForTimeout(2600);
  check('mobile: the chip took', (await current(page)) === 'uiux');
  check('mobile: the way-out hint is phrased for touch', (await hint()) === true);

  // A pinch must not read as a tap.
  await page.evaluate(() => {
    const c = document.getElementById('graph-canvas');
    const send = (type, touches) => c.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches, targetTouches: touches, changedTouches: touches,
    }));
    const t = (id, x, y) => new Touch({ identifier: id, target: c, clientX: x, clientY: y });
    send('touchstart', [t(1, 150, 400), t(2, 240, 400)]);
    for (let i = 1; i <= 6; i++) send('touchmove', [t(1, 150 - i * 8, 400), t(2, 240 + i * 8, 400)]);
    send('touchend', []);
  });
  await page.waitForTimeout(500);
  check('mobile: pinching keeps the category', (await current(page)) === 'uiux');

  // One-finger drag is not a tap either.
  let empty = await emptyPoint(page);
  check('mobile: found blank canvas to test against', !!empty, empty ? `${Math.round(empty.x)},${Math.round(empty.y)}` : 'none');
  await page.mouse.move(empty.x, empty.y);
  await page.evaluate(({ x, y }) => {
    const c = document.getElementById('graph-canvas');
    const ev = (type, cx, cy) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true,
      clientX: cx, clientY: cy,
    }));
    ev('pointerdown', x, y);
    for (let i = 1; i <= 8; i++) ev('pointermove', x - i * 12, y + i * 3);
    ev('pointerup', x - 96, y + 24);
  }, empty);
  await page.waitForTimeout(500);
  check('mobile: dragging the field keeps the category', (await current(page)) === 'uiux');

  // Tap a work: that raises the preview, and keeps the category.
  const node = await litNode(page);
  await tap(page, node.x, node.y);
  await page.waitForTimeout(600);
  const previewUp = await page.evaluate(() => {
    const h = document.getElementById('graph-hud');
    return !!h && !h.hidden;
  });
  check('mobile: tapping a work raises its preview', previewUp);
  check('mobile: the preview keeps the category', (await current(page)) === 'uiux');

  // Tapping past it puts the preview away — and only that.
  empty = await emptyPoint(page);
  await tap(page, empty.x, empty.y);
  await page.waitForTimeout(600);
  check('mobile: that tap dismissed the preview',
    await page.evaluate(() => document.getElementById('graph-hud')?.hidden !== false));
  check('mobile: dismissing the preview does not also clear the category', (await current(page)) === 'uiux');

  // The next tap on nothing goes back to All.
  empty = await emptyPoint(page);
  await tap(page, empty.x, empty.y);
  await page.waitForTimeout(1200);
  check('mobile: tapping blank space returns to All', (await current(page)) === 'all', await current(page));
  check('mobile: the hint goes away with the category', (await hint()) === false);

  check('mobile: no console errors', errors.length === 0, errors[0] ?? '');
  await ctx.close();
}

await browser.close();
console.log('PASS:'); for (const n of ok) console.log('  ' + n);
if (bad.length) { console.log('\nFAIL:'); for (const n of bad) console.log('  ' + n); }
console.log(`\n${ok.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
