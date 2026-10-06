// The low-tech mirror (/low-tech/) and the doors between it and the main
// site. Does every way in lead to what you were looking at, does the mirror
// hold everything the main site does — every work, every plate, the same
// words — and does it stay what it claims to be: no scripts, nothing fetched
// from elsewhere, pictures that really are four-grey dithers?
import { chromium } from 'playwright';
import sharp from 'sharp';
const PORT = process.argv[2];
const base = 'http://localhost:' + PORT;
const browser = await chromium.launch();
const ok = [], bad = [];
const check = (n, pass, d = '') => (pass ? ok : bad).push(n + (d ? ` (${d})` : ''));

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// --- the doors on the main site ---
const doors = () => page.$$eval('a[data-low-tech]', (as) => as.map((a) => a.getAttribute('href')));
const shut = await doors();
check('three doors into the mirror: logo, switch, text link',
  shut.length === 3 && (await page.$('.station a[data-low-tech] img.mark')) && (await page.$('#low-tech-toggle')) && (await page.$('.cta a.low-tech')),
  `${shut.length} found`);
check('with nothing open they lead to the mirror\'s front page', shut.every((h) => h === '/low-tech/'), shut.join(', '));

// The logo lights up in the accent, measured off the screen rather than the CSS.
const accent = await page.evaluate(() => {
  const probe = document.createElement('i');
  probe.style.color = 'var(--accent)';
  document.body.append(probe);
  const rgb = getComputedStyle(probe).color.match(/\d+/g).map(Number);
  probe.remove();
  return rgb;
});
const accentPixels = async () => {
  const box = await page.locator('.mark-door').boundingBox();
  const { data, info } = await sharp(await page.screenshot({ clip: box })).raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += info.channels)
    if (Math.abs(data[i] - accent[0]) + Math.abs(data[i + 1] - accent[1]) + Math.abs(data[i + 2] - accent[2]) < 60) n++;
  return n;
};
await page.mouse.move(900, 600);
await page.waitForTimeout(300);
const grey = await accentPixels();
await page.hover('.mark-door');
await page.waitForTimeout(450);
const lit = await accentPixels();
check('the logo is grey at rest and lights in the accent when pointed at',
  grey < 10 && lit > 200, `${grey} -> ${lit} accent pixels`);
await page.mouse.move(900, 600);

// Doors follow what's open.
const works = await page.$$eval('template[data-panel^="work/"]', (ts) => ts.map((t) => t.dataset.panel.slice(5)));
const sample = works.includes('musr') ? 'musr' : works[0];
await page.evaluate((id) => (location.hash = `#work/${id}`), sample);
await page.waitForTimeout(600);
const open = await doors();
check('with a work open, every door leads to that work\'s low-tech page',
  open.every((h) => h === `/low-tech/${sample}/`), open.join(', '));
await page.evaluate(() => (location.hash = '#about'));
await page.waitForTimeout(600);
const about = await doors();
check('with About open, they lead to About in the mirror',
  about.every((h) => h === '/low-tech/#about'), about.join(', '));
// With a work open, the panel covers the switches (it always has); the text
// link under About is the door still in reach, and it keeps your place.
await page.evaluate((id) => (location.hash = `#work/${id}`), sample);
await page.waitForTimeout(600);
await Promise.all([page.waitForURL(`**/low-tech/${sample}/`), page.click('.cta a.low-tech')]);
check('with a work open, the text link lands on the same work in the mirror', page.url().endsWith(`/low-tech/${sample}/`), page.url());
await page.goBack();
await page.waitForTimeout(800);
await page.evaluate(() => history.replaceState(null, '', '/'));
await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
await page.waitForTimeout(800);

// The switch is thrown before the page changes.
const knobAt = () => page.$eval('#low-tech-toggle .knob', (k) => k.getBoundingClientRect().left);
const knobOff = await knobAt();
const navigated = page.waitForURL('**/low-tech/');
await page.click('#low-tech-toggle');
await page.waitForTimeout(120);
const knobMid = await knobAt();
await navigated;
check('the switch slides on before the page changes', knobMid > knobOff + 4, `knob ${Math.round(knobOff)} -> ${Math.round(knobMid)}px`);
check('and lands on the mirror', new URL(page.url()).pathname === '/low-tech/', page.url());

await page.goBack();
await page.waitForTimeout(800);
const knobBack = await knobAt();
check('coming back, the switch is off again', Math.abs(knobBack - knobOff) < 2, `knob at ${Math.round(knobBack)}px`);

// What the main site holds, to compare the mirror against.
const truth = await page.$$eval('template[data-panel^="work/"]', (ts) => ts.map((t) => {
  const c = t.content;
  return {
    id: t.dataset.panel.slice(5),
    title: c.querySelector('h1')?.textContent.trim(),
    intro: c.querySelector('.intro')?.textContent.trim(),
    pictures: c.querySelectorAll('.plate-open').length,
  };
}));

// --- the mirror ---
const lt = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
const mirror = await lt.newPage();
const elsewhere = [], scripts = [];
mirror.on('request', (r) => {
  const url = new URL(r.url());
  if (url.origin !== base) elsewhere.push(r.url());
  // `astro dev` injects its own client; the built page has none (see below).
  if (r.resourceType() === 'script' && !/\/@vite\/|\/@id\/|dev-toolbar|\/node_modules\//.test(url.pathname)) scripts.push(url.pathname);
  if (r.resourceType() === 'font') elsewhere.push('font: ' + r.url());
});
await mirror.goto(base + '/low-tech/', { waitUntil: 'networkidle' });
const listed = await mirror.$$eval('a[href^="/low-tech/"]', (as) =>
  [...new Set(as.map((a) => a.getAttribute('href')).filter((h) => /^\/low-tech\/[^/#]+\/$/.test(h)))]);
check('the mirror lists every work the main site has',
  truth.every((w) => listed.includes(`/low-tech/${w.id}/`)) && listed.length === truth.length,
  `${listed.length} listed, ${truth.length} on the main site`);
check('and About & Contact', (await mirror.$('#about')) !== null);
check('its door back leads to the main site\'s front page',
  (await mirror.$eval('.door a', (a) => a.getAttribute('href'))) === '/');

let missing = [], wrong = [], notDithered = [], noColour = [], badPictures = [];
for (const w of truth) {
  await mirror.goto(base + `/low-tech/${w.id}/`, { waitUntil: 'load' });
  const got = await mirror.evaluate(() => ({
    title: document.querySelector('h1')?.textContent.trim(),
    intro: document.querySelector('h1 + p')?.textContent.trim(),
    pictures: [...document.querySelectorAll('a.tint img')].map((img) => ({
      src: img.getAttribute('src'), colour: img.closest('a').getAttribute('href'),
      w: +img.getAttribute('width'), h: +img.getAttribute('height'),
    })),
    door: document.querySelector('.door a')?.getAttribute('href'),
  }));
  if (got.title !== w.title || got.intro !== w.intro) wrong.push(w.id);
  if (got.pictures.length !== w.pictures) missing.push(`${w.id} ${got.pictures.length}/${w.pictures}`);
  if (got.door !== `/#work/${w.id}`) wrong.push(`${w.id} door ${got.door}`);
  for (const p of got.pictures) {
    const res = await mirror.request.get(base + p.src);
    if (!res.ok()) { badPictures.push(p.src); continue; }
    const { data, info } = await sharp(await res.body()).greyscale().raw().toBuffer({ resolveWithObject: true });
    const shades = new Set(data).size;
    if (shades > 4 || info.width !== p.w || info.height !== p.h) notDithered.push(`${p.src} ${shades} shades ${info.width}x${info.height}`);
    if (!(await mirror.request.head(base + p.colour)).ok()) noColour.push(p.colour);
  }
}
check('every work\'s page has the main site\'s title and intro', wrong.length === 0, wrong.slice(0, 3).join('; '));
check('every cover and plate is there', missing.length === 0, missing.slice(0, 3).join('; '));
check('every picture is published', badPictures.length === 0, badPictures.slice(0, 3).join('; '));
check('every picture is a dither of at most four greys, at the size the page says',
  notDithered.length === 0, notDithered.slice(0, 2).join('; '));
check('every picture links to a colour copy that exists', noColour.length === 0, noColour.slice(0, 2).join('; '));
check('nothing is fetched from anywhere else, fonts included', elsewhere.length === 0, elsewhere[0] ?? '');
check('no scripts of its own', scripts.length === 0, scripts[0] ?? '');

// The way back opens the same work in the field.
await mirror.goto(base + `/low-tech/${sample}/`, { waitUntil: 'load' });
await Promise.all([mirror.waitForURL(`**/#work/${sample}`), mirror.click('.door a')]);
await mirror.waitForTimeout(1500);
const panelOpen = await mirror.evaluate(() => !document.getElementById('detail-window')?.hidden);
check('the way back opens the same work on the main site', panelOpen, mirror.url());

// A phone: the column is the screen, and nothing runs off the side.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p = await phone.newPage();
let overflow = [];
for (const path of ['/low-tech/', `/low-tech/${sample}/`]) {
  await p.goto(base + path, { waitUntil: 'load' });
  const wide = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (wide > 0) overflow.push(`${path} ${wide}px`);
}
check('on a phone, no page scrolls sideways', overflow.length === 0, overflow.join('; '));

check('no console errors', errors.length === 0, errors[0] ?? '');
await browser.close();
console.log('PASS:'); for (const n of ok) console.log('  ' + n);
if (bad.length) { console.log('\nFAIL:'); for (const n of bad) console.log('  ' + n); }
console.log(`\n${ok.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
