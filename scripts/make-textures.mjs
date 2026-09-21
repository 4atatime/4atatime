// Generates the star-dust tiles used by the page background.
//
// Committed as files rather than built at request time: they never change
// between deploys, and a deterministic seed means re-running this produces
// byte-identical output, so a regenerated tile doesn't show up as a diff
// unless the numbers below actually changed.
//
// Two files, not one recoloured by a filter: the dust has to be light on the
// dark theme and dark on the light one, and a CSS filter over a fixed,
// full-viewport layer is a real cost for something a second 4KB file solves.
//
//   node scripts/make-textures.mjs
import { writeFileSync } from 'node:fs';

/** Same small PRNG the graph layout uses, so the output is reproducible. */
function mulberry32(seed) {
	return function () {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const TILE = 900;
const STARS = 140;

function dust(fill, seed, scale) {
	const random = mulberry32(seed);
	const circles = [];
	for (let i = 0; i < STARS; i++) {
		const x = random() * TILE;
		const y = random() * TILE;
		// Mostly specks, a few that carry. Cubing the roll keeps the big ones
		// rare, which is what stops a tile from reading as a pattern.
		const roll = random();
		const r = 0.3 + roll * roll * roll * 1.5;
		// Scaled per theme: the same scatter has to be firmer against a
		// near-black page than against a near-white one to read at all.
		const o = (0.18 + random() * 0.55) * scale;
		circles.push(
			`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" opacity="${o.toFixed(2)}"/>`,
		);
	}
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" ` +
		`viewBox="0 0 ${TILE} ${TILE}" fill="${fill}">` +
		circles.join('') +
		'</svg>\n'
	);
}

writeFileSync('public/textures/stardust-dark.svg', dust('#dbe5f5', 0x5745, 0.9));
writeFileSync('public/textures/stardust-light.svg', dust('#4a5a76', 0x5745, 0.5));
console.log(`wrote 2 tiles, ${STARS} stars each`);
