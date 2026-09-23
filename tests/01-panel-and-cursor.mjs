// Behavioural checks for the things a screenshot can't show.
import { chromium } from 'playwright';
const PORT = process.argv[2] ?? '4390';
const base = 'http://localhost:' + PORT;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const missing = new Set();
page.on('response', r => { if (r.status() === 404) missing.add(new URL(r.url()).pathname); });

const ok = [], bad = [];
const check = (name, pass, detail = '') => (pass ? ok : bad).push(name + (detail ? ` (${detail})` : ''));

await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);

// 1. Panel opens from a hash and closes on a click outside.
await page.evaluate(() => { location.hash = '#work/musr'; });
await page.waitForTimeout(500);
check('panel opens', !(await page.locator('#detail-window').isHidden()));
await page.mouse.click(200, 760);
await page.waitForTimeout(500);
check('click-away closes panel', await page.locator('#detail-window').isHidden());
check('click-away clears the hash', await page.evaluate(() => location.hash) === '', await page.evaluate(() => location.hash));

// 2. Close button.
await page.evaluate(() => { location.hash = '#work/sifted'; });
await page.waitForTimeout(500);
await page.click('#detail-close');
await page.waitForTimeout(400);
check('close button closes panel', await page.locator('#detail-window').isHidden());

// 3. Escape.
await page.evaluate(() => { location.hash = '#about'; });
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('escape closes panel', await page.locator('#detail-window').isHidden());

// 4. Filter buttons drive the URL, and back steps through them.
await page.click('[data-filter="ink"]');
await page.waitForTimeout(300);
check('filter writes the query string', page.url().includes('in=ink'), page.url());
check('filter button marked pressed', await page.getAttribute('[data-filter="ink"]', 'aria-pressed') === 'true');
await page.goBack();
await page.waitForTimeout(400);
check('back undoes the filter', !page.url().includes('in='), page.url());
check('legend follows the back button', await page.getAttribute('[data-filter="all"]', 'aria-pressed') === 'true');

// 5. "collected under" inside a panel filters the graph and closes the panel.
await page.evaluate(() => { location.hash = '#work/touch-of-zen'; });
await page.waitForTimeout(500);
await page.click('[data-panel-filter]');
await page.waitForTimeout(600);
check('panel category filters the graph', page.url().includes('in=ink'), page.url());
check('panel category closes the panel', await page.locator('#detail-window').isHidden());

// 6. Resizing publishes a size step the content keys off.
await page.evaluate(() => { location.hash = '#work/shapes-traces'; });
await page.waitForTimeout(500);
const before = await page.getAttribute('#detail-window', 'data-size');
const r = await page.locator('#detail-resizer').boundingBox();
await page.mouse.move(r.x + 5, r.y + r.height / 2);
await page.mouse.down();
await page.mouse.move(150, r.y + r.height / 2, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(400);
const after = await page.getAttribute('#detail-window', 'data-size');
check('dragging the edge changes the layout step', before !== after, `${before} -> ${after}`);
const cols = await page.locator('.plates ol').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
check('wide panel lays plates out in three columns', cols === 3, `${cols} columns`);

// 7. Resizing must not be mistaken for a click outside.
check('resizing did not close the panel', !(await page.locator('#detail-window').isHidden()));

// 8. The cursor: reticle over the graph, real cursor in the panel.
const panelBox = await page.locator('#detail-window').boundingBox();
// Left of the panel's edge is the graph — the panel was just dragged wide.
await page.mouse.move(Math.max(40, panelBox.x - 60), 400);
await page.waitForTimeout(250);
check('reticle shows over the graph', await page.locator('#cursor.visible').count() === 1);
await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + 300);
await page.waitForTimeout(250);
check('reticle hides inside the panel', await page.locator('#cursor.visible').count() === 0);
check('panel restores a real cursor',
  await page.locator('#detail-window').evaluate(el => getComputedStyle(el).cursor) === 'auto');

console.log('PASS:\n  ' + ok.join('\n  '));
if (bad.length) console.log('\nFAIL:\n  ' + bad.join('\n  '));
console.log(missing.size ? '\n404s: ' + [...missing].join(', ') : '\nno 404s');
await browser.close();
process.exit(bad.length ? 1 : 0);
