// Fails the build early, and legibly, when a content file points at an image
// that isn't there.
//
// Astro already refuses to build on a missing image, but it reports the first
// one it hits as a Vite plugin stack trace — which tells you the path and
// nothing else: not which work, not which field, not what it might have meant.
// Since the CMS writes these paths (and can leave a stale one behind when an
// image is re-uploaded under a new name), that trace is the thing someone
// non-technical has to interpret at the exact moment their site stopped
// deploying.
//
// This runs first, finds *every* broken reference rather than just the first,
// and names the nearest file on disk — which in practice is almost always the
// one that was meant.

import fs from 'node:fs';
import path from 'node:path';

const CONTENT = 'src/content';
const ASSET_PREFIX = '/src/assets/';

/** Every `src:` / `heroImage:` in the content tree, quoted or not. */
function collectReferences() {
	const refs = [];
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
				const lines = fs.readFileSync(full, 'utf8').split('\n');
				lines.forEach((line, i) => {
					const m = line.match(/(?:^|\s)(?:src|heroImage):\s*["']?(\/src\/assets\/[^"'\s]+)/);
					if (m) refs.push({ file: full, line: i + 1, ref: m[1] });
				});
			}
		}
	};
	walk(CONTENT);
	return refs;
}

/** Cheap edit distance, capped — only used to rank candidate filenames. */
function distance(a, b) {
	const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let last = prev[0];
		prev[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const tmp = prev[j];
			prev[j] = Math.min(
				prev[j] + 1,
				prev[j - 1] + 1,
				last + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
			last = tmp;
		}
	}
	return prev[b.length];
}

/**
 * The likeliest intended file: an unreferenced one in the same folder, closest
 * by name. Unreferenced first because a re-upload leaves exactly that — the
 * new file orphaned, the old name still in the frontmatter.
 */
function suggest(ref, used) {
	const dir = path.dirname(ref).replace(/^\//, '');
	if (!fs.existsSync(dir)) return null;
	const wanted = path.basename(ref);
	const candidates = fs
		.readdirSync(dir)
		.filter((f) => !f.startsWith('.'))
		.map((f) => ({
			name: f,
			orphan: !used.has(path.posix.join('/', dir, f)),
			d: distance(wanted.toLowerCase(), f.toLowerCase()),
		}))
		.sort((a, b) => Number(b.orphan) - Number(a.orphan) || a.d - b.d);
	return candidates[0] ?? null;
}

const refs = collectReferences();
const used = new Set(refs.map((r) => r.ref));
const broken = refs.filter((r) => !fs.existsSync(r.ref.replace(/^\//, '')));

if (broken.length === 0) {
	console.log(`✓ ${refs.length} image references, all present`);
	process.exit(0);
}

const plural = broken.length > 1;
console.error(
	`\n✗ ${broken.length} image reference${plural ? 's' : ''} ${plural ? 'point' : 'points'} at a file that isn't in the repository.\n`,
);
for (const { file, line, ref } of broken) {
	const guess = suggest(ref, used);
	console.error(`  ${file}  (line ${line})`);
	console.error(`    missing:  ${ref}`);
	if (guess) {
		console.error(`    on disk:  ${path.posix.join(path.dirname(ref), guess.name)}${guess.orphan ? '   ← unused, probably the one you meant' : ''}`);
	}
	console.error('');
}
console.error(
	'This usually means an image was re-uploaded under a different name: the new\n' +
		'file was committed but the old path is still in the entry. Open that work in\n' +
		'the CMS, remove the broken plate and re-add the image, then publish again.\n',
);
process.exit(1);
