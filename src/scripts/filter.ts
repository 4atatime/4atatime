// The category filter is shared state between three places that can't see each
// other: the station box in the top-left corner (the buttons), the graph
// canvas (which fades non-matching works out), and the "collected under" line
// inside an open detail panel (which doubles as a filter button). Rather than
// have them reach into each other, they all talk to this module.
//
// The filter lives in the URL's query string, not just in memory, so a
// filtered view is a link someone can send — and so the back button walks
// back through filter changes the same way it walks back through open panels.

import { ALL_CATEGORIES, CATEGORIES } from '../lib/categories';

const PARAM = 'in';
const EVENT = 'graph:filter';

const VALID = new Set([ALL_CATEGORIES.slug, ...CATEGORIES.map((c) => c.slug)]);

export function currentFilter(): string {
	const value = new URLSearchParams(location.search).get(PARAM) ?? '';
	return VALID.has(value) ? value : ALL_CATEGORIES.slug;
}

/**
 * Writes the filter into the URL and tells everyone. `all` drops the
 * parameter entirely rather than spelling out the default.
 */
export function setFilter(slug: string) {
	const next = VALID.has(slug) ? slug : ALL_CATEGORIES.slug;
	if (next === currentFilter()) return;

	const url = new URL(location.href);
	if (next === ALL_CATEGORIES.slug) url.searchParams.delete(PARAM);
	else url.searchParams.set(PARAM, next);
	history.pushState(null, '', url);

	announce();
}

/** Re-broadcasts whatever the URL currently says — for popstate. */
export function announce() {
	document.dispatchEvent(new CustomEvent(EVENT, { detail: { slug: currentFilter() } }));
}

export function onFilterChange(handler: (slug: string) => void) {
	document.addEventListener(EVENT, (event) => {
		handler((event as CustomEvent<{ slug: string }>).detail.slug);
	});
}
