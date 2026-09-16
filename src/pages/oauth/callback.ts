// Step two: GitHub sends the user back here with a code. Swap it for a token
// and hand that token to the CMS window that opened this popup.
//
// The handshake Decap expects is a two-beat conversation, not a single
// message: the popup announces "authorizing:github", the opener answers, and
// only then does the popup send the token — addressed to the origin the
// opener replied from. Sending the token unprompted would race the listener
// being attached.
import type { APIRoute } from 'astro';
import { OAUTH_GITHUB_CLIENT_ID, OAUTH_GITHUB_CLIENT_SECRET } from 'astro:env/server';
import { NOT_CONFIGURED, STATE_COOKIE, oauthErrorPage, stateCookieOptions } from './_state';

export const prerender = false;

/** Safe to drop inside a <script>: JSON, with the sequences that could end it neutralised. */
function toScriptLiteral(value: unknown) {
	return JSON.stringify(value)
		.replace(/</g, '\\u003c')
		.replace(/>/g, '\\u003e')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
}

function page(body: string, status = 200) {
	return new Response(`<!doctype html><meta charset="utf-8">${body}`, {
		status,
		headers: { 'content-type': 'text/html; charset=utf-8' },
	});
}

const failure = (message: string) => oauthErrorPage("Couldn't sign in to the CMS", message);

export const GET: APIRoute = async ({ url, cookies }) => {
	if (!OAUTH_GITHUB_CLIENT_ID || !OAUTH_GITHUB_CLIENT_SECRET) return NOT_CONFIGURED.clone();

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const expected = cookies.get(STATE_COOKIE)?.value;

	// One-shot: whether it matched or not, this state is spent.
	cookies.delete(STATE_COOKIE, stateCookieOptions(url));

	if (!code) return failure('GitHub did not send an authorisation code.');
	if (!expected || state !== expected) {
		return failure('The sign-in request could not be verified. Start again from the CMS.');
	}

	let token: string;
	try {
		const response = await fetch('https://github.com/login/oauth/access_token', {
			method: 'POST',
			headers: { accept: 'application/json', 'content-type': 'application/json' },
			body: JSON.stringify({
				code,
				client_id: OAUTH_GITHUB_CLIENT_ID,
				client_secret: OAUTH_GITHUB_CLIENT_SECRET,
			}),
		});
		if (!response.ok) throw new Error(`GitHub replied ${response.status}`);

		const body = await response.json();
		// GitHub answers 200 with an `error` field rather than a failure status.
		if (body.error) throw new Error(body.error_description ?? body.error);
		if (!body.access_token) throw new Error('no access token in the reply');
		token = body.access_token;
	} catch (error) {
		console.error('GitHub OAuth exchange failed:', error);
		return failure('GitHub refused the sign-in. The client secret may be wrong or expired.');
	}

	const payload = toScriptLiteral(
		`authorization:github:success:${JSON.stringify({ token, provider: 'github' })}`,
	);
	const origin = toScriptLiteral(url.origin);

	return page(
		`<title>Signing in…</title>
		<script>
			(function () {
				var opener = window.opener;
				if (!opener) {
					document.body.textContent = 'This page has to be opened from the CMS.';
					return;
				}
				// Wait for the CMS to answer our announcement, then reply to it
				// directly rather than broadcasting the token.
				function onReply(event) {
					if (event.origin !== ${origin}) return;
					window.removeEventListener('message', onReply, false);
					opener.postMessage(${payload}, ${origin});
					window.close();
				}
				window.addEventListener('message', onReply, false);
				opener.postMessage('authorizing:github', ${origin});
			})();
		</script>`,
	);
};
