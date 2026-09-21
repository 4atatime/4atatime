// The single pop-up window used by every piece of content on the site: a work
// detail, About, or Find. Content is pre-rendered into <template> elements at
// build time and cloned in on demand, so opening a window costs no network.
//
// The URL hash is the one source of truth for what's open (#about, #find,
// #work/<id>). That keeps the back button, the close button, a click on the
// graph behind the panel and a pasted link all going through the same path,
// and makes any individual work shareable even though the whole site is one
// page.
//
// The panel can be resized by dragging its edge, and the width it ends up at
// is published back to the panel as a `data-size` step (narrow/mid/wide) so
// the content inside can re-lay itself out — a gallery that is one column in a
// 340px dock and three at 900px.

/**
 * Closes whatever the panel is showing, from anywhere.
 *
 * Lives out here because the graph needs it too: clicking the empty field is
 * one of the ways out of a panel, and the canvas decides for itself which of
 * its presses count (a drag past the panel is not a dismissal, and a press on
 * another work is a change of subject rather than an exit). Both callers go
 * through the hash so the back button keeps working.
 */
export function dismissPanel() {
	if (!location.hash) return;
	history.pushState(null, '', location.pathname + location.search);
	window.dispatchEvent(new HashChangeEvent('hashchange'));
}

const DESKTOP_QUERY = '(min-width: 721px)';
const SIZE_KEY = 'window-size';
const MIN_WIDTH = 320;
const MIN_HEIGHT = 220;
/** Matches the slide transition in DetailWindow.astro. */
const CLOSE_MS = 300;

/**
 * Breakpoints for the panel itself rather than the viewport. Container
 * queries would express this natively, but the panel's own width is set from
 * JS during a drag and the content is cloned in from a <template>, so
 * publishing a step as an attribute is both simpler to follow and something
 * the scoped styles in WorkDetailContent.astro can key off directly.
 */
const SIZE_STEPS: [number, string][] = [
	[820, 'wide'],
	[560, 'mid'],
	[0, 'narrow'],
];

function sizeStep(width: number): string {
	return SIZE_STEPS.find(([min]) => width >= min)?.[1] ?? 'narrow';
}

function isDesktop() {
	return window.matchMedia(DESKTOP_QUERY).matches;
}

function loadSize(): { width?: number; height?: number } {
	try {
		return JSON.parse(localStorage.getItem(SIZE_KEY) ?? '{}');
	} catch {
		return {};
	}
}

function saveSize(size: { width?: number; height?: number }) {
	try {
		localStorage.setItem(SIZE_KEY, JSON.stringify({ ...loadSize(), ...size }));
	} catch {
		// private mode — the window just reverts to its default size next time
	}
}

export function initWindow() {
	const rootEl = document.getElementById('detail-window');
	const bodyEl = document.getElementById('detail-body');
	const closeEl = document.getElementById('detail-close');
	const resizerEl = document.getElementById('detail-resizer');
	if (!rootEl || !bodyEl || !closeEl || !resizerEl) return;

	// Explicitly typed rebinds — TypeScript drops the null-narrowing inside the
	// hoisted function declarations below.
	const root: HTMLElement = rootEl;
	const body: HTMLElement = bodyEl;
	const closeBtn: HTMLElement = closeEl;
	const resizer: HTMLElement = resizerEl;

	// Re-apply whichever dimension this viewport actually uses. Width is
	// meaningless for the mobile bottom sheet and height for the desktop dock,
	// so each is stored and restored independently.
	const stored = loadSize();
	if (stored.width) root.style.setProperty('--window-width', `${stored.width}px`);
	if (stored.height) root.style.setProperty('--window-height', `${stored.height}px`);

	let lastFocused: Element | null = null;
	// Declared up here because the click-away handler below has to be able to
	// ignore the pointerdown that begins a resize drag.
	let resizing = false;

	// About and Find used to be two panels; they're one now. Links to the old
	// #find still exist in the wild (and in anyone's history), so they land on
	// the merged page rather than on nothing.
	const ALIASES: Record<string, string> = { find: 'about', contact: 'about' };

	function contentFor(hash: string): DocumentFragment | null {
		const raw = hash.replace(/^#/, '');
		if (!raw) return null;
		const key = ALIASES[raw] ?? raw;
		const template = document.querySelector<HTMLTemplateElement>(
			`template[data-panel="${CSS.escape(key)}"]`,
		);
		return template ? template.content.cloneNode(true) as DocumentFragment : null;
	}

	/** Keeps the content's layout in step with however wide the panel is now. */
	function publishSize() {
		root.dataset.size = sizeStep(root.getBoundingClientRect().width);
	}

	/** Pending teardown after a close animation, so a fast reopen can cancel it. */
	let closingTimer: number | undefined;

	function open(fragment: DocumentFragment) {
		// A close may still be sliding out; cancel it rather than let it strip
		// the content we're about to show.
		window.clearTimeout(closingTimer);
		closingTimer = undefined;
		root.classList.remove('closing');

		body.replaceChildren(fragment);
		body.scrollTop = 0;
		if (root.hidden) {
			lastFocused = document.activeElement;
			root.hidden = false;
			// Two frames, not one. `hidden` is display:none, and an element
			// going from display:none straight to its end state in the same
			// frame has no start state to transition *from* — which is why the
			// panel used to appear rather than slide. The first frame lets it
			// lay out off-screen; the second starts the move.
			requestAnimationFrame(() => {
				requestAnimationFrame(() => root.classList.add('open'));
			});
		}
		publishSize();
		closeBtn.focus();
	}

	function close() {
		if (root.hidden || closingTimer !== undefined) return;

		// Let it slide back out before it's taken away. The class drives the
		// transform; the timer is what actually removes the element, and it's
		// deliberately a timer rather than a transitionend listener — a
		// transition that never runs (reduced motion, a backgrounded tab)
		// fires no event and would strand the panel open forever.
		root.classList.remove('open');
		root.classList.add('closing');

		if (lastFocused instanceof HTMLElement) lastFocused.focus();
		lastFocused = null;

		closingTimer = window.setTimeout(() => {
			closingTimer = undefined;
			root.classList.remove('closing');
			root.hidden = true;
			body.replaceChildren();
		}, CLOSE_MS);
	}

	function sync() {
		const fragment = contentFor(location.hash);
		if (fragment) open(fragment);
		else close();
	}

	/**
	 * The one way out, whatever triggered it — the close button, Escape, or a
	 * click on the graph behind. pushState deliberately fires no event, so
	 * anything else keyed to what's open (the graph marks the bubble whose work
	 * is showing) has to be told by hand.
	 */
	const dismiss = dismissPanel;

	closeBtn.addEventListener('click', dismiss);

	// Clicking off the panel closes it too — the close button is a target you
	// have to aim at, and everything outside the panel is the graph, which is
	// where you were heading anyway. Bound on pointerdown so it can't be
	// confused with the end of a drag that started inside the panel, and
	// ignored while a resize is in flight for the same reason.
	document.addEventListener('pointerdown', (event) => {
		if (root.hidden || resizing) return;
		const target = event.target as Element | null;
		if (target && root.contains(target)) return;
		// A link that opens another panel (About, Find, a work) is already a
		// change of what's open; letting this close it first would push a
		// pointless extra history entry between the two.
		if (target?.closest?.('a[href^="#"]')) return;
		// The graph answers for its own canvas. Closing on pointer*down* here
		// was what made the field unusable with a panel up: it fired on the
		// first frame of a drag, so you could not turn or zoom the graph while
		// reading, and it fired before the release that would have opened the
		// next work, so jumping straight from one work to another dropped you
		// out instead. The canvas decides at pointer*up*, where it can tell a
		// click from a drag and a work from empty space.
		if (target?.closest?.('#graph-canvas')) return;
		dismiss();
	});

	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && !root.hidden) dismiss();
	});

	window.addEventListener('hashchange', sync);
	window.addEventListener('popstate', sync);

	// --- Resize -----------------------------------------------------------
	// One handle, two meanings: the left edge on desktop (drag to widen the
	// dock) and the top edge on mobile (drag to raise the sheet).
	let startX = 0;
	let startY = 0;
	let startWidth = 0;
	let startHeight = 0;

	resizer.addEventListener('pointerdown', (event) => {
		resizing = true;
		startX = event.clientX;
		startY = event.clientY;
		const rect = root.getBoundingClientRect();
		startWidth = rect.width;
		startHeight = rect.height;
		resizer.setPointerCapture(event.pointerId);
		root.classList.add('resizing');
		event.preventDefault();
	});

	resizer.addEventListener('pointermove', (event) => {
		if (!resizing) return;
		if (isDesktop()) {
			const width = Math.max(
				MIN_WIDTH,
				Math.min(window.innerWidth - 48, startWidth - (event.clientX - startX)),
			);
			root.style.setProperty('--window-width', `${width}px`);
			// Re-flow the content as the edge moves, not once it's dropped.
			root.dataset.size = sizeStep(width);
		} else {
			const height = Math.max(
				MIN_HEIGHT,
				Math.min(window.innerHeight - 24, startHeight - (event.clientY - startY)),
			);
			root.style.setProperty('--window-height', `${height}px`);
		}
	});

	function endResize(event: PointerEvent) {
		if (!resizing) return;
		resizing = false;
		root.classList.remove('resizing');
		resizer.releasePointerCapture(event.pointerId);
		const rect = root.getBoundingClientRect();
		saveSize(isDesktop() ? { width: rect.width } : { height: rect.height });
	}

	resizer.addEventListener('pointerup', endResize);
	resizer.addEventListener('pointercancel', endResize);

	// Double-click/tap the handle to go back to the default half-screen size.
	resizer.addEventListener('dblclick', () => {
		root.style.removeProperty('--window-width');
		root.style.removeProperty('--window-height');
		saveSize({ width: undefined, height: undefined });
		publishSize();
	});

	// Rotating a phone or dragging a desktop window changes the panel's width
	// without anyone touching the handle.
	window.addEventListener('resize', () => {
		if (!root.hidden) publishSize();
	});

	sync();
}
