// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import { defineConfig, envField, fontProviders } from 'astro/config';

// The canonical URL, the sitemap and the absolute og:image all hang off
// `site`, so it has to be the real address rather than a placeholder. Vercel
// sets VERCEL_PROJECT_PRODUCTION_URL on every build, which means production
// and preview deploys get this right without anyone editing a file; SITE_URL
// overrides it once there's a custom domain.
const site =
	process.env.SITE_URL ??
	(process.env.VERCEL_PROJECT_PRODUCTION_URL
		? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
		: 'http://localhost:4321');

// https://astro.build/config
export default defineConfig({
	site,
	// Every page of the site stays static and pre-rendered. Only the two OAuth
	// routes that log the CMS in opt out (`export const prerender = false`),
	// and the adapter is what lets those run on demand. NB: `output: 'hybrid'`
	// no longer exists — Astro 5 removed it and folded its behaviour into the
	// default 'static', which is why there's no `output` line here at all.
	adapter: vercel(),
	// Declared so they're typed and documented in one place. Marked optional
	// on purpose: if they were required, Astro would throw a raw
	// EnvInvalidVariables 500 out of the login route, and the person seeing it
	// is the one least able to read it. The routes check for themselves and
	// say what's missing in a sentence instead.
	env: {
		schema: {
			OAUTH_GITHUB_CLIENT_ID: envField.string({
				context: 'server',
				access: 'secret',
				optional: true,
			}),
			OAUTH_GITHUB_CLIENT_SECRET: envField.string({
				context: 'server',
				access: 'secret',
				optional: true,
			}),
		},
	},
	integrations: [
		mdx(),
		// The CMS and its login routes are not part of the site. /admin already
		// says noindex; listing it in the sitemap as well would be telling
		// crawlers both things at once.
		sitemap({ filter: (page) => !/\/(admin|oauth)(\/|$)/.test(new URL(page).pathname) }),
	],
	fonts: [
		// Body/supporting text. Real weights used: 300 (thin) + 400 (regular),
		// both normal and italic.
		{
			provider: fontProviders.google(),
			name: 'Roboto Serif',
			cssVariable: '--font-body-name',
			fallbacks: ['serif'],
			weights: [300, 400],
			styles: ['normal', 'italic'],
		},
		// Titles/headlines. PLACEHOLDER — "Scoutie Sans" isn't on Google Fonts
		// and isn't in this repo; swap this entry for a local fontProviders.local()
		// block once the real font files are supplied (see feedback log).
		{
			provider: fontProviders.google(),
			name: 'Archivo Black',
			cssVariable: '--font-headline-name',
			fallbacks: ['sans-serif'],
		},
		// CJK fallback — sits after --font-body in the font-family stack so
		// Chinese glyphs render in this even inside otherwise-English text.
		{
			provider: fontProviders.google(),
			name: 'Noto Serif TC',
			cssVariable: '--font-zh-name',
			fallbacks: ['serif'],
			weights: [400, 700],
		},
		// Arabic fallback, same stacking approach as --font-zh.
		{
			provider: fontProviders.google(),
			name: 'Amiri',
			cssVariable: '--font-ar-name',
			fallbacks: ['serif'],
			weights: [400, 700],
		},
	],
});
