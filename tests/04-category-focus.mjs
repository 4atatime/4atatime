// Category focus: does selecting one actually turn the field to face it,
// keep the rest visible, and come back when you press All?
import { chromium, devices } from 'playwright';
import { cloudBox } from './lib/blobs.mjs';
const PORT = process.argv[2];
const base = 'http://localhost:' + PORT;
const browser = await chromium.launch();
const ok = [], bad = [];
const check = (n, pass, d = '') => (pass ? ok : bad).push(n + (d ? ` (${d})` : ''));

/**
 * The field's bounds, in CSS px.
 *
 * Raw alpha bounds stopped meaning "the cloud" once the sky was drawn into
 * the same canvas: a star in the corner of the window is a lit pixel like any
 * other, so those bounds were the whole window every time. cloudBox keeps
 * only regions too big to be a star.
 *
 * `minAlpha` still selects how faint a work may be and still count, which is
 * what the filtered-out works are judged by.
 */
const frameStats = (page, minAlpha) => cloudBox(page, minAlpha);

for (const [label, opts] of [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['mobile', { ...devices['iPhone 13'], isMobile: true, hasTouch: true }],
]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);

  const all = await frameStats(page, 150);
  await page.click('[data-filter="uiux"]');
  await page.waitForTimeout(2800);
  const focused = await frameStats(page, 150);
  // Everything drawn at all, including the faded-out works.
  const withContext = await frameStats(page, 20);

  check(`${label}: focusing moves the camera`,
    all && focused && (Math.abs(focused.cx - all.cx) > 12 || Math.abs(focused.cy - all.cy) > 12 || Math.abs(focused.w - all.w) > 60),
    `centre ${all?.cx.toFixed(0)},${all?.cy.toFixed(0)} → ${focused?.cx.toFixed(0)},${focused?.cy.toFixed(0)}`);

  const faint = (withContext?.count ?? 0) - (focused?.count ?? 0);
  check(`${label}: unselected works stay visible`,
    faint > (focused?.count ?? 0) * 0.15,
    `${faint} faint px alongside ${focused?.count} strong (${((faint / (focused?.count || 1)) * 100).toFixed(0)}%)`);

  const vp = page.viewportSize();
  check(`${label}: selection is framed, not filling the screen`,
    focused && focused.w < vp.width * 0.92 && focused.w > vp.width * 0.2,
    `${focused?.w.toFixed(0)}px wide of ${vp.width}`);

  await page.click('[data-filter="all"]');
  await page.waitForTimeout(2800);
  const back = await frameStats(page, 150);
  check(`${label}: All widens the view again`,
    back && focused && back.w > focused.w * 1.15, `${focused?.w.toFixed(0)} → ${back?.w.toFixed(0)}px`);

  await ctx.close();

  // Landing must be the same every time, not a random angle. Measured under
  // reduced motion: the idle spin turns the cloud after 2.6s idle, which
  // changes its projected width and would otherwise be read as drift.
  const stillCtx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
  const runs = [];
  for (let i = 0; i < 2; i++) {
    const still = await stillCtx.newPage();
    await still.goto(base + '/', { waitUntil: 'networkidle' });
    await still.waitForTimeout(2400);
    runs.push(await frameStats(still, 150));
    await still.close();
  }
  await stillCtx.close();
  check(`${label}: landing view is deterministic`,
    runs[0] && runs[1] && Math.abs(runs[1].w - runs[0].w) < 2 && Math.abs(runs[1].cx - runs[0].cx) < 2,
    `${runs[0]?.w.toFixed(1)}px vs ${runs[1]?.w.toFixed(1)}px wide`);
}

console.log('PASS:\n  ' + ok.join('\n  '));
if (bad.length) console.log('\nFAIL:\n  ' + bad.join('\n  '));
await browser.close();
process.exit(bad.length ? 1 : 0);
