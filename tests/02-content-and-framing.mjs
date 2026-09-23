import { chromium } from 'playwright';
import { cloudBox } from './lib/blobs.mjs';
const PORT = process.argv[2] ?? '4390';
const base = 'http://localhost:' + PORT;
const browser = await chromium.launch();
const ok = [], bad = [];
const check = (n, pass, d = '') => (pass ? ok : bad).push(n + (d ? ` (${d})` : ''));

// The graph idles-spins, which turns the cloud away from the angle it was
// framed at and so shrinks its projected extent. Reduced motion holds it
// still, which is the only way to measure the framing itself.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// --- Page identity -------------------------------------------------------
check('tab title is 4atatime', await page.title() === '4atatime', await page.title());
const meta = n => page.getAttribute(`meta[${n}]`, 'content');
check('description is the tagline',
  (await meta('name="description"')).includes('reasonable amount of trouble'), await meta('name="description"'));
check('share image is the logo', (await meta('property="og:image"')).endsWith('/og-image.png'));
check('og title matches', await meta('property="og:title"') === '4atatime');
for (const [sel, file] of [['link[rel="icon"][sizes="32x32"]','/favicon-32.png'], ['link[rel="apple-touch-icon"]','/favicon-180.png']]) {
  const href = await page.getAttribute(sel, 'href');
  const res = await page.request.get(base + href);
  check(`favicon ${file} served`, href === file && res.ok(), `${href} → ${res.status()}`);
}
check('greeting is still the hello, not the tagline',
  (await page.textContent('.greeting')).includes('web garden'));

// --- Auto-fit ------------------------------------------------------------
// Measured from the works themselves — eroded blobs — rather than from every
// lit pixel. The sky shares this canvas now, and a star in the corner of the
// window is a lit pixel like any other: the raw bounds were reporting the
// extent of the sky, which is always the whole window.
const extent = async () => {
  const box = await cloudBox(page);
  if (!box) return null;
  const vw = await page.evaluate(() => window.innerWidth);
  const vh = await page.evaluate(() => window.innerHeight);
  return { w: box.w / vw, h: box.h / vh };
};
// The cloud is roughly spherical, so it can only fill the axis that binds
// first — on a portrait window that's the width. And the graph deliberately
// keeps clear of the legend, so "available width" is less than the viewport.
// Check the binding axis, measured against the space the graph actually has.
// Mirrors viewFrame() in src/scripts/graph.ts: the graph is fitted to the
// space left over after the chrome, so that is what "filled" has to mean.
// The legend's gutter is measured from the legend itself now, not taken as a
// fraction of the window, so this has to measure it too — a second hardcoded
// copy of the rule is exactly what went stale the first time.
const gutter = () => page.evaluate(() => {
  const el = document.querySelector('.station');
  return el ? el.getBoundingClientRect().right + 14 : 0;
});
const usable = (w, h, legend) => {
  const desktop = w >= 721;
  const left = desktop ? Math.min(w * 0.3, legend) : 0;
  const top = desktop ? 0 : Math.min(h * 0.3, 300);
  const bottom = desktop ? 0 : 90;
  return { w: (w - left) / w, h: (h - top - bottom) / h };
};
const filled = (e, w, h, legend) => {
  const u = usable(w, h, legend);
  return Math.max(e.w / u.w, e.h / u.h);
};
const e1 = await extent();
const g1 = await gutter();
check('cloud fills the frame at the opening view',
  e1 && filled(e1, 1440, 900, g1) > 0.85 && filled(e1, 1440, 900, g1) <= 1.02,
  e1 && `${(e1.w*100).toFixed(0)}% wide, ${(e1.h*100).toFixed(0)}% tall → ${(filled(e1,1440,900,g1)*100).toFixed(0)}% of the frame`);

// It should reframe itself when the window changes shape.
for (const [w, h] of [[900, 1200], [2200, 800], [390, 780]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(1400);
  const e = await extent();
  const g = await gutter();
  check(`reframes at ${w}x${h}`,
    e && filled(e, w, h, g) > 0.85 && filled(e, w, h, g) <= 1.02,
    e && `${(e.w*100).toFixed(0)}% wide, ${(e.h*100).toFixed(0)}% tall → ${(filled(e,w,h,g)*100).toFixed(0)}% of the frame`);
}
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(1200);

// --- Old links still land somewhere -------------------------------------
await page.evaluate(() => { location.hash = '#find'; });
await page.waitForTimeout(500);
check('#find lands on the merged page', (await page.textContent('#detail-body')).includes('About & Contact'));
await page.evaluate(() => { location.hash = '#about'; });
await page.waitForTimeout(400);
const about = await page.textContent('#detail-body');
check('one email, the proton one', about.includes('4atatime@proton.me') && !about.includes('lexieyu42yce'));
check('framer-style link labels kept', about.includes('< Soundcloud >') && about.includes('< Letterboxd >'));

// --- Tags ----------------------------------------------------------------
await page.evaluate(() => { location.hash = '#work/touch-of-zen'; });
await page.waitForTimeout(600);
const tags = (await page.textContent('.tags')).trim();
check('tags render as a comma list, not chips', tags.includes(', ') && await page.locator('.tags li').count() === 0, tags.slice(0, 40) + '…');
check('tag count is 5-10', tags.split(',').length >= 5 && tags.split(',').length <= 10, `${tags.split(',').length} tags`);
const labels = await page.$$eval('.reading dt', els => els.map(e => e.textContent));
check('metadata uses the new words', JSON.stringify(labels) === JSON.stringify(['When','What','Where','How']), labels.join('/'));

// --- Organic frames ------------------------------------------------------
const radii = await page.$$eval('.plates img, .hero img, .collected-name, [data-filter] .code',
  els => els.map(e => getComputedStyle(e).borderRadius));
const uneven = radii.filter(r => new Set(r.replace('/', ' ').split(/\s+/).filter(Boolean)).size > 1);
check('frames have uneven corners', uneven.length === radii.length, `${uneven.length}/${radii.length} uneven`);
check('frames differ from each other', new Set(radii).size >= 4, `${new Set(radii).size} distinct shapes`);

// --- Dark accent ---------------------------------------------------------
await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
await page.waitForTimeout(300);
const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
check('dark accent is the green one', accent.toLowerCase() === '#76bfa3', accent);

console.log('PASS:\n  ' + ok.join('\n  '));
if (bad.length) console.log('\nFAIL:\n  ' + bad.join('\n  '));
await browser.close();
process.exit(bad.length ? 1 : 0);
