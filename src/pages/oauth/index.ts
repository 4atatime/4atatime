// Step one of logging the CMS in: hand the browser off to GitHub.
//
// Decap opens this in a popup (it finds it via `base_url` + `auth_endpoint` in
// the CMS config). GitHub asks the user to authorise, then sends them back to
// ./callback with a short-lived code.
//
// The `state` parameter is the CSRF guard: a random value that goes out in the
// URL and simultaneously into an HttpOnly cookie. The callback only accepts a
// code whose state matches the cookie, so a link someone else crafted can't
// walk a logged-in user through an authorisation they didn't start.
import type { APIRoute } from 'astro';
import { OAUTH_GITHUB_CLIENT_ID } from 'astro:env/server';
import { NOT_CONFIGURED, STATE_COOKIE, stateCookieOptions } from './_state';

export const prerender = false;

export const GET: APIRoute = ({ redirect, cookies, url }) => {
	if (!OAUTH_GITHUB_CLIENT_ID) return NOT_CONFIGURED.clone();

	const state = crypto.randomUUID();
	cookies.set(STATE_COOKIE, state, stateCookieOptions(url));

	const params = new URLSearchParams({
		client_id: OAUTH_GITHUB_CLIENT_ID,
		// `repo` to read and write the content files; `user` so Decap can show
		// who is signed in. Nothing wider than that.
		scope: 'repo,user',
		state,
	});

	return redirect(`https://github.com/login/oauth/authorize?${params}`);
};
