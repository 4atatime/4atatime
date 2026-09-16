// The four main categories a work can be collected under. Everything that
// needs to name, order or abbreviate a category reads it from here: the
// homepage filter, the "collected under" line on a detail page, and the
// hover preview all have to agree, and a category is also part of the URL
// (#filter/<slug>), so the slugs must stay stable.
//
// `code` is the two-letter tag used in the map-legend styling — short enough
// to sit in a survey-marker box without wrapping.

export interface Category {
	/** Exactly the `section` value in a work's frontmatter. */
	name: string;
	/** URL- and attribute-safe form of `name`. */
	slug: string;
	code: string;
}

export const CATEGORIES: Category[] = [
	{ name: 'UI/UX', slug: 'uiux', code: 'UX' },
	{ name: 'Grafix', slug: 'grafix', code: 'GX' },
	{ name: 'Ink!', slug: 'ink', code: 'IK' },
	{ name: 'mμsic', slug: 'music', code: 'MU' },
];

export const ALL_CATEGORIES = { name: 'All', slug: 'all', code: 'ALL' };

const BY_NAME = new Map(CATEGORIES.map((c) => [c.name, c]));

export function categoryOf(name: string): Category | undefined {
	return BY_NAME.get(name);
}

export function categorySlug(name: string): string {
	return BY_NAME.get(name)?.slug ?? ALL_CATEGORIES.slug;
}
