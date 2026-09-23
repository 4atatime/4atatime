/**
 * Node positions read off the canvas rather than out of the script: the discs
 * are the only thing drawn that survives an erosion, so eroding the alpha mask
 * and taking connected components finds the works without the page having to
 * export anything for the test's benefit.
 */
export const discsOn = (page, threshold = 110, margin = 36) =>
  page.evaluate(([T, M]) => {
  const c = document.getElementById('graph-canvas');
  const { data, width, height } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  const dpr = window.devicePixelRatio || 1;
  const A = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : data[(y * width + x) * 4 + 3]);
  // Erosion radius, in device pixels, chosen to fall between the two things
  // on this canvas: a star is at most 1.85 CSS px across the radius, a work
  // is at least about 3. At 2.5 the sky is rejected and the smallest works
  // still survive, which they did not at 3 — there, a zoomed-out field lost
  // most of its discs and the measured extent jumped about as different ones
  // dropped in and out.
  const r = Math.max(2, Math.round(2.5 * dpr));
  const core = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (A(x, y) > T && A(x - r, y) > T && A(x + r, y) > T && A(x, y - r) > T && A(x, y + r) > T) {
      core[y * width + x] = 1;
    }
  }
  const seen = new Uint8Array(width * height);
  const out = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!core[i] || seen[i]) continue;
    let sx = 0, sy = 0, n = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      const jx = j % width, jy = (j - jx) / width;
      sx += jx; sy += jy; n++;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = jx + dx, ny = jy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const k = ny * width + nx;
        if (core[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
    const cx = sx / n / dpr, cy = sy / n / dpr;
    // A disc clipped by the edge of the window has a centroid that isn't its
    // centre, so pointing at it misses. Drop those rather than aim at them.
    if (cx < M || cy < M || cx > width / dpr - M || cy > height / dpr - M) continue;
    if (n >= 4) out.push({ x: cx, y: cy, area: n / (dpr * dpr) });
  }
  return out.sort((a, b) => b.area - a.area);
}, [threshold, margin]);

/** The title the preview shows for whatever is under this point, if anything. */
export async function nameAt(page, x, y) {
  await page.mouse.move(5, 5);
  await page.waitForTimeout(260);
  await page.mouse.move(x, y);
  await page.waitForTimeout(220);
  return page.evaluate(() => {
    const h = document.getElementById('graph-hud');
    if (!h || h.hidden) return null;
    return {
      title: h.querySelector('.hud-title')?.textContent ?? '',
      bare: h.classList.contains('bare'),
    };
  });
}

/**
 * The works' own bounding box, in CSS pixels.
 *
 * Every work is joined to another by a link, so the whole field is a single
 * connected region of lit pixels; the stars are separate specks. Measuring
 * connected components and discarding the speck-sized ones therefore gives
 * the cloud and nothing else, and does it without eroding — which matters
 * when the field is zoomed out far enough that the works are only a few
 * pixels across and an erosion would throw most of them away.
 *
 * `minArea` is in device pixels and sits above the largest star (about 100)
 * and below the smallest work-plus-link region.
 */
export const cloudBox = (page, threshold = 60, minArea = 140) =>
  page.evaluate(([T, MIN]) => {
    const c = document.getElementById('graph-canvas');
    const { data, width, height } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const dpr = window.devicePixelRatio || 1;
    const A = (x, y) => data[((y * width + x) << 2) + 3];
    const seen = new Uint8Array(width * height);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, total = 0, parts = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (seen[i] || A(x, y) < T) continue;
      let n = 0, lo = x, hi = x, top = y, bot = y;
      const st = [i];
      seen[i] = 1;
      while (st.length) {
        const j = st.pop(); const jx = j % width, jy = (j - jx) / width;
        n++;
        if (jx < lo) lo = jx; if (jx > hi) hi = jx;
        if (jy < top) top = jy; if (jy > bot) bot = jy;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = jx + dx, ny = jy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const k = ny * width + nx;
          if (!seen[k] && A(nx, ny) >= T) { seen[k] = 1; st.push(k); }
        }
      }
      if (n < MIN) continue;
      parts++;
      total += n;
      if (lo < minX) minX = lo; if (hi > maxX) maxX = hi;
      if (top < minY) minY = top; if (bot > maxY) maxY = bot;
    }
    if (!parts) return null;
    return {
      n: parts,
      w: (maxX - minX) / dpr,
      h: (maxY - minY) / dpr,
      cx: ((minX + maxX) / 2) / dpr,
      cy: ((minY + maxY) / 2) / dpr,
      count: total / (dpr * dpr),
    };
  }, [threshold, minArea]);

/**
 * Somewhere on the canvas that is empty for the purposes of clicking: far
 * enough from every work that a press lands on nothing.
 *
 * Not "a patch with no pixels painted in it" — with a sky there is no such
 * patch, and there does not need to be. Only the works are click targets.
 */
export const emptySpot = async (page, { minX = 0.2, maxX = 0.95, minY = 0.35, maxY = 0.82, clear = 70 } = {}) => {
  const d = await discsOn(page, 25, 0);
  return page.evaluate(([discs, box, clearPx]) => {
    const c = document.getElementById('graph-canvas');
    const w = window.innerWidth, h = window.innerHeight;
    for (let y = Math.round(h * box.maxY); y > Math.round(h * box.minY); y -= 8) {
      for (let x = Math.round(w * box.maxX); x > Math.round(w * box.minX); x -= 8) {
        if (discs.some((p) => Math.hypot(p.x - x, p.y - y) < clearPx)) continue;
        if (document.elementFromPoint(x, y) !== c) continue;
        return { x, y };
      }
    }
    return null;
  }, [d, { minX, maxX, minY, maxY }, clear]);
};
