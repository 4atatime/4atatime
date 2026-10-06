// The doors from the main site into the low-tech mirror (/low-tech/): the
// logo, the third switch under lights and sound, and the ">> low-tech
// version" line under About & Contact. Each is a plain link that works with
// no script at all; this only makes them smarter.
//
//   · They lead to whatever is open: with a work open, its own low-tech page;
//     with About & Contact open, that section of the mirror's front page. The
//     mirror's way back does the same in reverse (/#work/<id>).
//   · The switch slides on before the page changes, so it reads as a switch
//     being thrown rather than a link that happens to look like one.
const LOW_TECH = '/low-tech/';
const SLIDE_MS = 220;

function target(hash: string): string {
	const work = /^#work\/([^/?#]+)$/.exec(hash);
	if (work) return `${LOW_TECH}${work[1]}/`;
	if (hash === '#about' || hash === '#find') return `${LOW_TECH}#about`;
	return LOW_TECH;
}

const doors = [...document.querySelectorAll<HTMLAnchorElement>('a[data-low-tech]')];

function point() {
	const href = target(location.hash);
	for (const door of doors) door.setAttribute('href', href);
}

window.addEventListener('hashchange', point);
point();

const toggle = document.getElementById('low-tech-toggle');
toggle?.addEventListener('click', (event) => {
	// A new tab, a new window, a download: let the browser have those.
	if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
	event.preventDefault();
	toggle.classList.add('on');
	const go = () => location.assign(toggle.getAttribute('href') ?? LOW_TECH);
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) go();
	else setTimeout(go, SLIDE_MS);
});

// Coming back with the back button can restore this page exactly as it was
// left — switch thrown. It should be off again: this is the high-tech page.
window.addEventListener('pageshow', () => toggle?.classList.remove('on'));
