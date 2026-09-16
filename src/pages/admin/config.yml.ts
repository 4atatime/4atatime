// Serves the CMS configuration.
//
// It's a route rather than a static file for two reasons. Decap needs to be
// told the address of the OAuth endpoints (`base_url`), and that address is
// different on localhost, on a Vercel preview and in production — hard-coding
// it means the CMS only works in one of the three. And the tag vocabulary
// belongs to src/lib/tags.ts; substituting it here rather than transcribing it
// into YAML keeps one list rather than two that can drift apart.
import type { APIRoute } from 'astro';
import rawConfig from '../../cms/config.yml?raw';
import { TAGS } from '../../lib/tags';

export const prerender = false;

/** Expands `options: __TAGS__` into a YAML list, matching the surrounding indent. */
function expandTags(yaml: string): string {
	return yaml.replace(/^([ \t]*)options: __TAGS__$/m, (_match, indent: string) => {
		const items = TAGS.map((tag) => `${indent}  - ${JSON.stringify(tag)}`).join('\n');
		return `${indent}options:\n${items}`;
	});
}

export const GET: APIRoute = ({ url }) => {
	const body = expandTags(rawConfig).replaceAll('__SITE_ORIGIN__', url.origin);

	return new Response(body, {
		headers: {
			'content-type': 'text/yaml; charset=utf-8',
			// The config describes the current deployment, so it must not be
			// served from a cache belonging to a different one.
			'cache-control': 'no-store',
		},
	});
};
