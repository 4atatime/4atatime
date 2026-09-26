// The full-size plate viewer (markup in ../components/PlateViewer.astro).
//
// Plates are cloned into the panel from <template>s whenever a work opens, so
// nothing here binds to a plate directly: one delegated click listener finds
// whichever plate was pressed, and the set to step through is read off that
// plate's own gallery at the moment it opens.
//
// The viewer has no hash of its own. It is a closer look at something already
// open, not a place — so Back leaves the work, as it always has, and takes the
// viewer with it.

/** Matches the opacity transition in PlateViewer.astro. */
const CLOSE_MS = 220;
/** A horizontal drag past this many pixels is a swipe to the next plate. */
const SWIPE_PX = 40;
/** A press that moved less than this is a tap, not the end of a swipe. */
const TAP_PX = 10;

export function initPlates() {
	const viewerEl = document.getElementById('plate-viewer');
	const imgEl = document.getElementById('plate-viewer-img');
	const countEl = document.getElementById('plate-viewer-count');
	const titleEl = document.getElementById('plate-viewer-title');
	if (!viewerEl || !(imgEl instanceof HTMLImageElement) || !countEl || !titleEl) return;

	// Rebinds so the null-narrowing survives into the functions below.
	const viewer: HTMLElement = viewerEl;
	const img: HTMLImageElement = imgEl;
	const count: HTMLElement = countEl;
	const title: HTMLElement = titleEl;
	const shut = viewer.querySelector<HTMLButtonElement>('[data-plate-close]');

	let plates: HTMLImageElement[] = [];
	let index = 0;
	let lastFocused: Element | null = null;
	let closingTimer: number | undefined;

	function show(i: number) {
		index = (i + plates.length) % plates.length;
		const source = plates[index];
		// The plate's own srcset, offered at the size it's now shown at, so the
		// browser picks the largest published copy — no extra files built.
		img.removeAttribute('src');
		img.sizes = '70vw';
		img.srcset = source.srcset;
		img.src = source.currentSrc || source.src;
		img.alt = source.alt;
		count.textContent = `${String(index + 1).padStart(2, '0')} / ${String(plates.length).padStart(2, '0')}`;
		title.textContent = source.alt;
	}

	function open(list: HTMLImageElement[], start: number) {
		window.clearTimeout(closingTimer);
		closingTimer = undefined;
		plates = list;
		viewer.classList.toggle('single', list.length < 2);
		show(start);
		if (viewer.hidden) {
			lastFocused = document.activeElement;
			viewer.hidden = false;
			// Two frames: from display:none, one frame has no start state to
			// fade from. Same reason as the panel's slide in window.ts.
			requestAnimationFrame(() => requestAnimationFrame(() => viewer.classList.add('open')));
		}
		shut?.focus();
	}

	function close() {
		if (viewer.hidden || closingTimer !== undefined) return;
		viewer.classList.remove('open');
		if (lastFocused instanceof HTMLElement) lastFocused.focus();
		lastFocused = null;
		// A timer, not transitionend: with reduced motion there is no
		// transition, and no event would ever come.
		closingTimer = window.setTimeout(() => {
			closingTimer = undefined;
			viewer.hidden = true;
			img.removeAttribute('srcset');
			img.removeAttribute('src');
		}, CLOSE_MS);
	}

	// Any plate, in any work, whenever it was cloned in.
	document.addEventListener('click', (event) => {
		const trigger = (event.target as Element | null)?.closest?.('[data-plate]');
		if (!trigger) return;
		const gallery = trigger.closest('.plates');
		const list = [...(gallery?.querySelectorAll<HTMLImageElement>('[data-plate] img') ?? [])];
		const start = list.indexOf(trigger.querySelector('img') as HTMLImageElement);
		if (start < 0) return;
		open(list, start);
	});

	viewer.addEventListener('click', (event) => {
		const button = (event.target as Element | null)?.closest?.('button');
		if (!button) return;
		if (button.hasAttribute('data-plate-close')) close();
		else show(index + Number(button.getAttribute('data-plate-step') ?? 0));
	});

	// Swipe between plates on a phone; tap the dimmed screen to leave.
	let press: { x: number; y: number } | null = null;
	viewer.addEventListener('pointerdown', (event) => {
		press = { x: event.clientX, y: event.clientY };
	});
	viewer.addEventListener('pointerup', (event) => {
		if (!press) return;
		const dx = event.clientX - press.x;
		const dy = event.clientY - press.y;
		press = null;
		if (plates.length > 1 && Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
			show(index + (dx < 0 ? 1 : -1));
			return;
		}
		const target = event.target as Element | null;
		if (Math.hypot(dx, dy) < TAP_PX && !target?.closest?.('img, button, figcaption')) close();
	});
	viewer.addEventListener('pointercancel', () => {
		press = null;
	});

	// Capture phase on window, so Escape closes the viewer and stops there —
	// the panel's own Escape listener (on document) would otherwise close the
	// work underneath in the same keypress.
	window.addEventListener(
		'keydown',
		(event) => {
			if (viewer.hidden || closingTimer !== undefined) return;
			if (event.key === 'Escape') close();
			else if (event.key === 'ArrowLeft' && plates.length > 1) show(index - 1);
			else if (event.key === 'ArrowRight' && plates.length > 1) show(index + 1);
			else if (event.key === 'Tab') {
				// Keep focus on the viewer's own buttons while it's up.
				const buttons = [...viewer.querySelectorAll<HTMLButtonElement>('button')].filter(
					(b) => b.offsetParent !== null,
				);
				const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
				const next = (at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
				buttons[next]?.focus();
			} else return;
			event.preventDefault();
			event.stopPropagation();
		},
		{ capture: true },
	);

	// Leaving the work (Back, a link, the panel closing) takes the viewer too.
	window.addEventListener('hashchange', close);
	window.addEventListener('popstate', close);
}
