// Shared between the two halves of the OAuth handshake. Underscore-prefixed so
// Astro treats it as a helper rather than as a route of its own.
import type { AstroCookieSetOptions } from 'astro';

export const STATE_COOKIE = 'decap-oauth-state';

export function stateCookieOptions(url: URL): AstroCookieSetOptions {
	return {
		httpOnly: true,
		// Lax rather than Strict: the user comes back to us via a redirect from
		// github.com, and Strict would withhold the cookie on that navigation.
		sameSite: 'lax',
		// Allows plain http on localhost while still requiring https anywhere real.
		secure: url.protocol === 'https:',
		path: '/',
		maxAge: 10 * 60,
	};
}

/** A dead end the reader can act on, rather than a stack trace. */
export function oauthErrorPage(heading: string, detail: string, status = 400) {
	return new Response(
		`<!doctype html><meta charset="utf-8"><title>${heading}</title>
		<div style="font:14px/1.5 system-ui;padding:2rem;max-width:34rem;color:#14171f">
			<h1 style="font-size:1rem;margin:0 0 .6rem">${heading}</h1>
			<p style="margin:0 0 .6rem">${detail}</p>
			<p style="margin:0;color:#5c6a85">Close this window and try again. See
			docs/editing-content.md if it keeps happening.</p>
		</div>`,
		{ status, headers: { 'content-type': 'text/html; charset=utf-8' } },
	);
}

/** The message for the one misconfiguration a non-developer will actually hit. */
export const NOT_CONFIGURED = oauthErrorPage(
	'The CMS login isn\'t set up yet',
	'This site has no GitHub OAuth credentials. Add OAUTH_GITHUB_CLIENT_ID and ' +
		'OAUTH_GITHUB_CLIENT_SECRET in the Vercel project settings, then redeploy.',
	503,
);
