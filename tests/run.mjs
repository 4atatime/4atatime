// Runs every behaviour suite against a dev server, and says what failed.
//
// These are behaviour checks, not unit tests: each one drives a real browser
// and reads the result off the rendered page — often off the canvas pixels,
// because most of what this site does is drawn rather than marked up. They
// exist because nearly every regression this project has had was invisible to
// a type-checker and obvious on screen.
//
//   npm test              against a dev server this starts and stops
//   npm test -- 4321      against one already running on that port
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const given = process.argv[2];
const PORT = given ?? '4319';

/** Waits for the dev server to answer, or gives up. */
async function waitForServer(url, tries = 60) {
	for (let i = 0; i < tries; i++) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
			if (res.ok) return true;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 1000));
	}
	return false;
}

const run = (cmd, args, opts = {}) =>
	new Promise((resolve) => {
		const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
		child.on('exit', (code) => resolve(code ?? 1));
	});

let server;
if (!given) {
	console.log(`starting a dev server on :${PORT}`);
	server = spawn('npx', ['astro', 'dev', '--port', PORT], {
		cwd: join(here, '..'),
		stdio: 'ignore',
	});
	if (!(await waitForServer(`http://localhost:${PORT}/`))) {
		console.error('the dev server never came up');
		server.kill();
		process.exit(1);
	}
}

// A fresh clone has the Playwright package but not the browser it drives, and
// the failure that causes names neither. Check once, and say what to run.
try {
	const { chromium } = await import('playwright');
	const probe = await chromium.launch();
	await probe.close();
} catch (error) {
	server?.kill();
	console.error(
		'\nCould not start a browser. On a fresh clone the browser has to be\n' +
			'downloaded once, separately from npm install:\n\n' +
			'    npx playwright install chromium\n',
	);
	console.error(String(error).split('\n')[0]);
	process.exit(1);
}

const files = (await readdir(here))
	.filter((f) => /^\d\d-.*\.mjs$/.test(f))
	.sort();

let failed = 0;
for (const file of files) {
	console.log(`\n── ${file} ──`);
	const code = await run(process.execPath, [join(here, file), PORT]);
	if (code !== 0) failed++;
}

server?.kill();
console.log(
	failed
		? `\n${failed} of ${files.length} suites failed`
		: `\nall ${files.length} suites passed`,
);
process.exit(failed ? 1 : 0);
