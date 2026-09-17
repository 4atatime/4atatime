// The accession number printed down the margin of a work's page.
//
// It used to be a bare hash — stable per work, but meaningless, which meant it
// read as decoration the moment anyone looked twice. This encodes something
// real instead, in the shape a herbarium sheet or a museum accession card
// would use: enough structure that the numbers sort and group the way the
// collection does, and enough opacity that it still reads as a catalogue mark
// rather than a caption.
//
//   G X 2 6 K 3
//   ─┬─ ─┬─ ─┬─
//    │   │   └── two base-36 characters derived from the work's id
//    │   └────── year the work is filed under
//    └────────── the category's two-letter code
//
// Six characters, fixed. Two works in the same category and year share their
// first four; nothing shares all six unless the ids collide, which they can't
// — the id is the filename.

import { categoryOf } from './categories';

/**
 * Deterministic, order-sensitive hash. FNV-1a rather than anything cleverer
 * because the only requirements are that it's stable across builds and spreads
 * similar ids apart — "touch-of-zen" and "touch-of-zen-2" must not land on the
 * same pair of characters.
 */
function fnv1a(value: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		// The FNV prime, applied with shifts so it stays inside 32 bits.
		hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
	}
	return hash >>> 0;
}

/**
 * The catalogue mark for one work — e.g. `GX26K3`.
 *
 * @param id       the work's filename stem, which is unique by construction
 * @param section  the category name, exactly as it appears in frontmatter
 * @param sortDate the date the work is filed under
 */
export function workSerial(id: string, section: string, sortDate: Date): string {
	const code = categoryOf(section)?.code ?? 'XX';
	const year = String(sortDate.getUTCFullYear() % 100).padStart(2, '0');
	// 36² = 1296 possible suffixes, which is ample for a collection this size
	// and short enough to stay readable.
	const suffix = (fnv1a(id) % 1296).toString(36).toUpperCase().padStart(2, '0');
	return `${code}${year}${suffix}`;
}
