// Prints each low-tech page's weight into its own footer, the way Low←Tech
// Magazine's solar site does: the HTML plus every picture, icon and
// stylesheet it asks for, measured off the files the build actually wrote.
//
// It runs after the build because nothing earlier knows the answer — the
// dithered pictures are written by their own route, and the HTML's size
// depends on the number being written into it (so the number is measured
// with itself in place, and settles on the second pass).
//
// In `astro dev` nothing is built, so the footer says the weight is measured
// when the site is built, and that is true.
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARK = /<!--weight-->[\s\S]*?<!--\/weight-->/;
const FOLDER = 'low-tech';

/** `511.20 KiB`, as on solar.lowtechmagazine.com. */
function format(bytes) {
	return bytes < 1024 * 1024
		? `${(bytes / 1024).toFixed(2)} KiB`
		: `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

async function* htmlFiles(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* htmlFiles(path);
		else if (entry.name.endsWith('.html')) yield path;
	}
}

/** Everything the page loads by itself: pictures, icons, stylesheets. Not what it merely links to. */
function requests(html) {
	const urls = new Set();
	for (const [, url] of html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/g)) urls.add(url);
	for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
		if (!/\srel="(?:icon|stylesheet)"/.test(tag)) continue;
		const href = /\shref="([^"]+)"/.exec(tag);
		if (href) urls.add(href[1]);
	}
	return [...urls].filter((url) => url.startsWith('/') && !url.startsWith('//'));
}

export default function pageWeight() {
	/** Where pre-rendered pages land: `build.client` once an adapter is in play, else `outDir`. */
	let roots = [];
	return {
		name: 'page-weight',
		hooks: {
			'astro:config:done': ({ config }) => {
				roots = [config.build.client, config.outDir].map((url) => fileURLToPath(url));
			},
			'astro:build:done': async ({ dir, logger }) => {
				const candidates = [...roots, fileURLToPath(dir)];
				let root;
				for (const candidate of candidates) {
					if (await stat(join(candidate, FOLDER)).catch(() => null)) {
						root = candidate;
						break;
					}
				}
				if (!root) {
					logger.warn(`no ${FOLDER}/ folder found in ${candidates.join(' or ')}; weights not written`);
					return;
				}

				let pages = 0;
				for await (const file of htmlFiles(join(root, FOLDER))) {
					let html = await readFile(file, 'utf8');
					if (!MARK.test(html)) continue;

					let extra = 0;
					for (const url of requests(html)) {
						const path = join(root, decodeURIComponent(url.split(/[?#]/)[0]));
						const size = (await stat(path).catch(() => null))?.size;
						if (size === undefined) logger.warn(`${file}: ${url} is not in the build`);
						extra += size ?? 0;
					}

					for (let pass = 0; pass < 3; pass++) {
						const total = Buffer.byteLength(html) + extra;
						const next = html.replace(MARK, `<!--weight-->${format(total)}<!--/weight-->`);
						if (next === html) break;
						html = next;
					}
					await writeFile(file, html);
					pages++;
				}
				logger.info(`wrote the weight into ${pages} low-tech pages`);
			},
		},
	};
}
