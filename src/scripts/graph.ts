// 3D force-directed graph of the work collection, drawn to a 2D canvas with a
// hand-rolled perspective projection. Deliberately not a library: the whole
// thing is ~20 nodes, and owning the render loop is what lets the node colours
// come straight from the CSS theme tokens and re-read themselves when the
// theme switches.
//
// Interaction model follows Obsidian's graph view — drag empty space to orbit,
// wheel to zoom, drag a node to reposition it (which re-heats the simulation),
// hover to highlight a node and its neighbours, click to open it.
//
// Nothing here snaps. The camera eases toward a target rather than tracking
// the pointer directly, highlights fade in and out, every node drifts on its
// own slow sine so a settled graph still breathes, and a node under the
// pointer (or open in the side panel) sends out slow ripples the way a survey
// marker pulses on a map.
//
// The physics itself lives in ../lib/layout.ts, DOM-free so it can be checked
// on its own; this file is projection, drawing and input.
import type { Body } from '../lib/layout';
import { mulberry32, seedBodies, settle, tick } from '../lib/layout';
import { ALL_CATEGORIES } from '../lib/categories';
import { currentFilter, onFilterChange, setFilter } from './filter';

interface RawNode {
	id: string;
	title: string;
	section: string;
	sectionSlug: string;
	tags: string[];
	date: string;
	location?: string;
	role?: string;
	degree: number;
}

interface RawLink {
	source: number;
	target: number;
	weight: number;
}

interface SimNode extends RawNode, Body {
	/** Projected screen position + radius, refreshed every frame for hit testing. */
	sx: number;
	sy: number;
	sr: number;
	/** Raw perspective scale. */
	depth: number;
	/** Depth normalised across the cloud this frame: 0 = farthest, 1 = nearest. */
	near: number;
	/** Phase offset for the idle drift, so nodes don't move in lockstep. */
	phase: number;
	/** Eased highlight, 0 → 1. Lerped rather than set, so hover fades. */
	glow: number;
	/** Eased filter membership, 1 = in the current category, 0 = filtered out. */
	shown: number;
}

// --- Camera ---------------------------------------------------------------
// A short camera distance relative to the cloud radius (~600) is what gives
// the perspective its bite: near nodes project ~2.6x larger than far ones,
// which is most of what makes the thing read as 3D rather than as a flat web.
const CAMERA_DISTANCE = 900;
/**
 * Base scale: how many world units map onto the viewport's short axis before
 * zoom. A fixed number can't fill both a 21:9 desktop and a tall phone, so
 * this only sets the ballpark — fitToView() below measures the cloud as it
 * actually projects and picks the zoom that frames it.
 */
const FIT_BASIS = 2000;
/** How much of the viewport the cloud should span when first framed. */
const FIT_TARGET = 0.92;
/** Breathing room around a label before it counts as colliding. */
const LABEL_PADDING = 5;
/**
 * Room kept clear for the chrome, so works aren't drawn underneath it. On a
 * desktop the legend is a column down the left; on a phone it's a block across
 * the top and the nav button sits along the bottom, so the graph's frame is
 * inset from a different side depending on which layout is in play.
 *
 * The phone insets are measured off the real elements rather than guessed as a
 * fraction of the viewport — the legend's height depends on how many lines the
 * greeting wraps to and how many categories there are, neither of which a
 * magic percentage can know about.
 */
const DESKTOP_FROM = 721;
const LEGEND_GUTTER = 0.2;
const LEGEND_GUTTER_MAX = 240;
/** Breathing room between the chrome and the nearest work. */
const CHROME_CLEARANCE = 14;
/** Used only until the real elements have been measured. */
const MOBILE_TOP_FALLBACK = 200;
const MOBILE_BOTTOM_FALLBACK = 90;
const IDLE_SPIN = 0.0004; // radians/frame; stops the moment you touch it
const IDLE_RESUME_MS = 2600;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3;
/** How much of the remaining distance the camera closes each frame. */
const CAMERA_EASE = 0.09;

/**
 * Floor on the node-size multiplier. Without it a phone drew desktop-sized
 * nodes into a third of the space, which is what made the graph look packed
 * there however far apart the physics actually put things; letting the size
 * fall with the viewport keeps the gap-to-node ratio roughly honest.
 */
const RADIUS_FLOOR = 0.55;
/** Extra pixels around a node that still count as pointing at it. */
const HIT_SLOP = 18;

// --- Idle drift -----------------------------------------------------------
// Scaled with the layout spread, so the drift stays the same fraction of the
// gap between two works as it was before the field was opened out.
const DRIFT_AMPLITUDE = 10;
const DRIFT_SPEED = 0.00035;

// --- Depth cueing ---------------------------------------------------------
// Far things recede; they must not disappear. The first version faded both
// colour and alpha hard enough that a standby link at the back of the cloud
// composited to 1.04:1 against the page — no contrast at all. These are the
// floors that keep the whole field legible while still reading as 3D.
//
// Measured against the shipped palette, standby, worst depth to best:
//   node  2.4:1 → 7.7:1 (light)   3.2:1 → 9.8:1 (dark)
//   link  1.6:1 → 2.3:1 (light)   1.9:1 → 3.2:1 (dark)
//
// The dimmed figures — what everything *else* drops to while one node is
// hovered — are deliberately left near 1.1:1. That collapse is what makes the
// highlight read, and raising the standby floors without keeping it would
// have traded one legibility problem for another.
/** How far a node's colour is washed toward the page at the far end. */
const NODE_DEPTH_FADE = 0.25;
/** Alpha at the far end, and how much more the near end gets. */
const NODE_ALPHA_FLOOR = 0.68;
const NODE_ALPHA_RANGE = 0.32;
/** What a node drops to when something else is hovered. */
const NODE_DIMMED = 0.34;
/** The same pair for edges. */
const LINK_DEPTH_FADE = 0.22;
const LINK_ALPHA = 0.95;
/** Edges keep most of their weight at the far end, or the web comes apart. */
const LINK_NEAR_FLOOR = 0.78;
/** Edge alpha while something is hovered: the quiet state, and the lit one. */
const LINK_ALPHA_DIMMED = 0.18;
const LINK_ALPHA_LIT = 0.7;
/** Titles are text and need more than a shape does: 2.1:1 at the far end. */
const LABEL_DEPTH_FADE = 0.28;
const LABEL_ALPHA_FLOOR = 0.62;
const LABEL_ALPHA_RANGE = 0.38;

/** How much of the gap a node's highlight closes each frame. */
const GLOW_EASE = 0.16;
/** Same easing for the filter fade — slower, because it's a bigger change. */
const FILTER_EASE = 0.09;
/** A filtered-out work stays faintly visible rather than vanishing, so the
 * shape of the whole garden is never lost. */
const FILTERED_ALPHA = 0.12;
/** Grace period before an un-hovered node lets go, so the HUD is reachable. */
const HOVER_HOLD_MS = 140;
/** Clearance between the preview box and its node, and from the window edge. */
const HUD_GAP = 14;
const HUD_MARGIN = 10;

// --- Ripples --------------------------------------------------------------
// Two rings per pulsing node, offset half a period apart so there is always
// one mid-flight; each expands from the node's edge and fades as it goes.
const RIPPLE_PERIOD_MS = 2600;
const RIPPLE_REACH = 3.4;

type Rgb = [number, number, number];

/**
 * Custom properties come back from getComputedStyle as their literal token, so
 * this has to cope with whatever the stylesheet happens to use.
 */
function parseColor(value: string): Rgb {
	const text = value.trim();
	if (text.startsWith('#')) {
		const hex = text.slice(1);
		const full =
			hex.length === 3
				? hex
						.split('')
						.map((c) => c + c)
						.join('')
				: hex;
		return [
			parseInt(full.slice(0, 2), 16),
			parseInt(full.slice(2, 4), 16),
			parseInt(full.slice(4, 6), 16),
		];
	}
	const numbers = text.match(/[\d.]+/g);
	if (numbers && numbers.length >= 3) {
		return [Number(numbers[0]), Number(numbers[1]), Number(numbers[2])];
	}
	return [128, 128, 128];
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
	return [
		a[0] + (b[0] - a[0]) * amount,
		a[1] + (b[1] - a[1]) * amount,
		a[2] + (b[2] - a[2]) * amount,
	];
}

function rgba([r, g, b]: Rgb, alpha: number): string {
	return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

function readTheme(root: HTMLElement) {
	const styles = getComputedStyle(root);
	const token = (name: string) => styles.getPropertyValue(name).trim();
	return {
		fg: parseColor(token('--fg')),
		muted: parseColor(token('--muted')),
		border: parseColor(token('--border')),
		accent: parseColor(token('--accent')),
		// The graph's own two colours. Separate from --muted/--border because
		// those are tuned for text and UI edges; see the note in tokens.css.
		node: parseColor(token('--graph-node')),
		link: parseColor(token('--graph-link')),
		// Far nodes are blended toward the page colour — atmospheric perspective,
		// the same trick that makes distant hills go pale.
		bg: parseColor(token('--bg')),
		// Canvas's font property is not CSS and cannot resolve var(), so the
		// stack has to be resolved here and passed through literally.
		family: getComputedStyle(document.body).fontFamily || 'sans-serif',
	};
}

function escapeHtml(value: string) {
	return value.replace(
		/[&<>"]/g,
		(char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] as string,
	);
}

/** The id of the work the side panel currently has open, or null. */
function openWorkId(): string | null {
	const match = location.hash.match(/^#work\/(.+)$/);
	return match ? decodeURIComponent(match[1]) : null;
}

export function initGraph() {
	const canvasEl = document.getElementById('graph-canvas');
	const dataEl = document.getElementById('graph-data');
	const hudEl = document.getElementById('graph-hud');
	if (!(canvasEl instanceof HTMLCanvasElement) || !dataEl || !hudEl) return;
	const context = canvasEl.getContext('2d');
	if (!context) return;

	// Re-bound with explicit types: TypeScript discards narrowing inside
	// hoisted function declarations, and the render loop below is nothing but
	// those. Annotating once here beats a non-null assertion on every use.
	const canvas: HTMLCanvasElement = canvasEl;
	const hud: HTMLElement = hudEl;
	const ctx: CanvasRenderingContext2D = context;

	const data = JSON.parse(dataEl.textContent ?? '{}') as { nodes: RawNode[]; links: RawLink[] };
	if (!data.nodes?.length) return;

	const random = mulberry32(0x4a7a);
	const bodies = seedBodies(data.nodes.length, random);
	const nodes: SimNode[] = data.nodes.map((node, i) => ({
		...node,
		...bodies[i],
		sx: 0,
		sy: 0,
		sr: 0,
		depth: 1,
		near: 0.5,
		phase: random() * Math.PI * 2,
		glow: 0,
		shown: 1,
	}));
	const links = data.links;

	// Adjacency, for the "related works" highlight.
	const neighbours: Set<number>[] = nodes.map(() => new Set<number>());
	for (const link of links) {
		neighbours[link.source].add(link.target);
		neighbours[link.target].add(link.source);
	}

	const maxDegree = Math.max(...nodes.map((n) => n.degree), 1);
	const radiusOf = (node: SimNode) => 5 + (node.degree / maxDegree) * 7;

	// --- Physics ----------------------------------------------------------
	// Category per node, so the simulation can push unrelated groups apart.
	const groups = nodes.map((node) => node.sectionSlug);

	// Settle before the first paint, so the graph never appears mid-explosion.
	settle(nodes, links, groups, random);
	// alpha is the simulation's temperature: 0 at rest, bumped back up when a
	// node is dragged so its neighbours re-arrange around it.
	let alpha = 0;

	// --- Camera state -----------------------------------------------------
	// Each of these has a target the camera eases toward; dragging moves the
	// target, never the camera, which is what takes the rigidity out.
	let yaw = 0.4;
	let yawTarget = yaw;
	let pitch = -0.25;
	let pitchTarget = pitch;
	let zoom = 1;
	let zoomTarget = zoom;
	/** Cleared the moment someone zooms themselves — then the frame is theirs. */
	let autoFit = true;
	/** The cloud's own centre, in unzoomed screen units. */
	let panX = 0;
	let panY = 0;
	let clock = 0;
	let lastInteraction = 0;
	let width = 0;
	let height = 0;

	/** How much of the top and bottom edges the chrome is covering, in px. */
	let chromeTop = MOBILE_TOP_FALLBACK;
	let chromeBottom = MOBILE_BOTTOM_FALLBACK;

	/**
	 * Measures the legend and the bottom bar so the graph can be framed in
	 * what's actually left. Called from resize() only — these are layout reads
	 * and have no business in the render loop.
	 */
	function measureChrome() {
		const legend = document.querySelector('.station');
		const bar = document.querySelector('.bottom-bar');
		chromeTop = legend
			? legend.getBoundingClientRect().bottom + CHROME_CLEARANCE
			: MOBILE_TOP_FALLBACK;
		chromeBottom = bar
			? Math.max(0, height - bar.getBoundingClientRect().top) + CHROME_CLEARANCE
			: MOBILE_BOTTOM_FALLBACK;
	}

	function resize() {
		const rect = canvas.getBoundingClientRect();
		const ratio = window.devicePixelRatio || 1;
		width = rect.width;
		height = rect.height;
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		measureChrome();
	}

	function fitScale() {
		return Math.min(width, height) / FIT_BASIS;
	}

	/**
	 * The rectangle the graph gets to itself — the viewport minus whatever the
	 * chrome is covering. Everything that positions or scales the cloud reads
	 * this, so the graph is centred in the space it actually has rather than in
	 * the window, which is what left a third of a phone screen empty below it.
	 */
	function viewFrame() {
		const desktop = width >= DESKTOP_FROM;
		const left = desktop ? Math.min(width * LEGEND_GUTTER, LEGEND_GUTTER_MAX) : 0;
		const top = desktop ? 0 : chromeTop;
		const bottom = desktop ? 0 : chromeBottom;
		return {
			cx: left + (width - left) / 2,
			cy: top + (height - top - bottom) / 2,
			halfW: (width - left) / 2,
			halfH: (height - top - bottom) / 2,
		};
	}

	/**
	 * Frames the cloud in whatever viewport it finds itself in. A single fixed
	 * scale has to be chosen for the worst rotation and so leaves the opening
	 * view — the one everybody sees — floating in a third of the screen. This
	 * measures the cloud as it actually projects right now and picks the zoom
	 * that fills the frame, which also means it adapts to a phone, an ultrawide
	 * and a window being dragged about.
	 */
	function fitToView() {
		if (!width || !height) return;
		const view = viewFrame();

		// Measure the cloud's projected bounding box in unzoomed units. Undo
		// the current zoom and pan so the measurement describes the cloud
		// rather than the view we happen to be looking at it through.
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (const node of nodes) {
			project(node);
			const ux = (node.sx - view.cx) / zoom + panX;
			const uy = (node.sy - view.cy) / zoom + panY;
			const r = node.sr / zoom;
			minX = Math.min(minX, ux - r);
			maxX = Math.max(maxX, ux + r);
			minY = Math.min(minY, uy - r);
			maxY = Math.max(maxY, uy + r);
		}
		const halfX = (maxX - minX) / 2;
		const halfY = (maxY - minY) / 2;
		if (!(halfX > 0) || !(halfY > 0)) return;

		// Centre on the cloud's own middle. The simulation settles wherever it
		// settles — the world origin is nowhere in particular — so framing
		// about the origin left a third of the frame empty on one side.
		panX = (minX + maxX) / 2;
		panY = (minY + maxY) / 2;

		const next = Math.min(
			(view.halfW * FIT_TARGET) / halfX,
			(view.halfH * FIT_TARGET) / halfY,
		);
		zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
		zoomTarget = zoom;
	}

	function project(node: SimNode) {
		const cosYaw = Math.cos(yaw);
		const sinYaw = Math.sin(yaw);
		const cosPitch = Math.cos(pitch);
		const sinPitch = Math.sin(pitch);
		// A slow, tiny orbit of each node around its settled position. Too small
		// to read as movement, big enough that the graph never looks frozen.
		const drift = Math.sin(clock * DRIFT_SPEED + node.phase) * DRIFT_AMPLITUDE;
		const driftB = Math.cos(clock * DRIFT_SPEED * 0.8 + node.phase) * DRIFT_AMPLITUDE;
		const x = node.x + drift;
		const y = node.y + driftB;
		const z = node.z + drift * 0.6;

		const x1 = x * cosYaw + z * sinYaw;
		const z1 = -x * sinYaw + z * cosYaw;
		const y2 = y * cosPitch - z1 * sinPitch;
		const z2 = y * sinPitch + z1 * cosPitch;
		// Keep the divisor away from zero so a node swinging behind the camera
		// can't produce an infinite scale.
		const depth = CAMERA_DISTANCE / Math.max(200, CAMERA_DISTANCE - z2);
		const fit = fitScale();
		node.depth = depth;
		// panX/panY are in unzoomed cloud units and hold the cloud's own centre,
		// which is not the origin: the simulation settles wherever it settles.
		const view = viewFrame();
		node.sx = view.cx + (x1 * depth * fit - panX) * zoom;
		node.sy = view.cy + (y2 * depth * fit - panY) * zoom;
		node.sr = radiusOf(node) * depth * zoom * Math.max(RADIUS_FLOOR, fit * 1.5);
	}

	// --- Interaction state ------------------------------------------------
	// The graph turns by itself when left alone; that's a continuous animation,
	// so it's off for anyone who asked for less motion. The ripples are the
	// same kind of thing and are suppressed by the same check.
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	let hovered: number | null = null;
	let dragNode: number | null = null;
	let orbiting = false;
	let pointerMoved = false;
	let pointerStart = { x: 0, y: 0 };
	let pointerId: number | null = null;
	/** True while the pointer is inside the HUD, which keeps it open and still. */
	let hudPinned = false;
	/**
	 * Every finger currently down on the canvas. A phone has no wheel, so two
	 * fingers pinching is the only way to zoom; tracking them all here is what
	 * lets one finger keep meaning "turn the field" without the two gestures
	 * fighting each other.
	 */
	const touches = new Map<number, { x: number; y: number }>();
	/** Set when a second finger lands: the span and zoom to scale from. */
	let pinchStartSpan = 0;
	let pinchStartZoom = 1;
	// Measured once per content change rather than per frame: the box only
	// changes size when a different work goes into it, and reading offsetWidth
	// inside the render loop would force a layout every frame.
	let hudSize = { width: 0, height: 0 };
	let releaseTimer: number | undefined;
	/** The work open in the side panel — drawn as a held-down marker. */
	let active: number | null = null;
	let filter = ALL_CATEGORIES.slug;

	const byId = new Map(nodes.map((node, i) => [node.id, i]));

	const theme = readTheme(document.documentElement);
	new MutationObserver(() => Object.assign(theme, readTheme(document.documentElement))).observe(
		document.documentElement,
		{ attributes: true, attributeFilter: ['data-theme'] },
	);

	/** A work is reachable only while its category is the one being shown. */
	function inFilter(node: SimNode) {
		return filter === ALL_CATEGORIES.slug || node.sectionSlug === filter;
	}

	function nodeAt(clientX: number, clientY: number): number | null {
		const rect = canvas.getBoundingClientRect();
		const x = clientX - rect.left;
		const y = clientY - rect.top;
		let best: number | null = null;
		let bestDistance = Infinity;
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			if (!inFilter(node)) continue;
			const distance = Math.hypot(node.sx - x, node.sy - y);
			// Generous hit slop: these are small targets, the crosshair cursor
			// makes precise aiming harder than a normal pointer, and on a phone
			// the nodes are smaller still.
			if (distance < node.sr + HIT_SLOP && distance < bestDistance) {
				bestDistance = distance;
				best = i;
			}
		}
		return best;
	}

	function open(index: number) {
		// On a phone the preview is a sheet at the bottom of the screen and the
		// detail panel slides up over it. Leaving the sheet behind means
		// closing the panel drops you back onto a preview of the thing you just
		// closed; dropping it here returns you to the field instead.
		if (width < DESKTOP_FROM) {
			hovered = null;
			hudPinned = false;
			updateHud();
		}
		location.hash = `#work/${nodes[index].id}`;
	}

	/** Distance between the first two fingers down, in screen pixels. */
	function touchSpan(): number {
		const [a, b] = [...touches.values()];
		return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
	}

	/** True while two or more fingers are down — a pinch, not a drag. */
	function pinching(): boolean {
		return touches.size >= 2;
	}

	// --- HUD --------------------------------------------------------------
	/** Rebuilds the HUD's contents. Only call this when the hovered node changes. */
	function updateHud() {
		if (hovered === null) {
			hud.hidden = true;
			hudPinned = false;
			return;
		}
		const node = nodes[hovered];
		hud.hidden = false;

		// One row per field, each labelled the way a survey slip is — the
		// preview used to run these together and became unreadable at a glance.
		const row = (key: string, value: string) =>
			`<span class="hud-row"><span class="hud-key">${key}</span><span class="hud-value">${escapeHtml(value)}</span></span>`;
		// Same words as the survey slip on the work's own page, so the preview
		// reads as a shortened version of it rather than a different form.
		const rows: string[] = [row('when', node.date)];
		if (node.role) rows.push(row('what', node.role));
		if (node.location) rows.push(row('where', node.location));
		if (node.tags.length) rows.push(row('tags', node.tags.join(', ')));

		hud.innerHTML =
			`<button type="button" class="hud-collection" data-hud-filter="${escapeHtml(node.sectionSlug)}">` +
			`collected under <span class="hud-collection-name">${escapeHtml(node.section)}</span></button>` +
			`<span class="hud-title">${escapeHtml(node.title)}</span>` +
			`<span class="hud-rows">${rows.join('')}</span>` +
			`<button type="button" class="hud-cta" data-hud-open>Open the file →</button>`;
		if (width < DESKTOP_FROM) {
			// Drop any anchor the desktop layout left behind, so the sheet's own
			// left/right/bottom rules are what position it.
			hud.style.removeProperty('left');
			hud.style.removeProperty('top');
			hud.classList.remove('below');
		}
		hudSize = { width: hud.offsetWidth, height: hud.offsetHeight };
		positionHud();
	}

	/** Cheap per-frame follow, so the HUD tracks its node as the graph turns. */
	function positionHud() {
		// On a phone the preview is a sheet pinned to the bottom edge by CSS —
		// following the node is exactly what used to bury it under the legend.
		if (width < DESKTOP_FROM) return;
		// Frozen while the pointer is inside it: a box that drifts out from under
		// the cursor is impossible to click.
		if (hovered === null || hudPinned) return;
		const node = nodes[hovered];

		// Above the node by preference, below it when there isn't room — a work
		// near the top of the field would otherwise have its preview cut off by
		// the top of the window, which is where the title and the category line
		// live.
		const below = node.sy - node.sr - HUD_GAP - hudSize.height < HUD_MARGIN;
		hud.classList.toggle('below', below);
		hud.style.top = `${below ? node.sy + node.sr + HUD_GAP : node.sy - node.sr - HUD_GAP}px`;

		// Centred on the node, but never past either edge of the window.
		const half = hudSize.width / 2;
		hud.style.left = `${Math.max(half + HUD_MARGIN, Math.min(width - half - HUD_MARGIN, node.sx))}px`;
	}

	function holdHover() {
		window.clearTimeout(releaseTimer);
		releaseTimer = undefined;
	}

	/**
	 * Lets go of the hovered node after a beat instead of immediately, so the
	 * pointer can cross the gap from node to HUD without it vanishing.
	 */
	function releaseHover() {
		window.clearTimeout(releaseTimer);
		releaseTimer = window.setTimeout(() => {
			if (hudPinned) return;
			hovered = null;
			canvas.classList.remove('over-node');
			updateHud();
		}, HOVER_HOLD_MS);
	}

	hud.addEventListener('pointerenter', () => {
		hudPinned = true;
		holdHover();
	});
	hud.addEventListener('pointerleave', () => {
		hudPinned = false;
		releaseHover();
	});
	hud.addEventListener('click', (event) => {
		const target = event.target as Element;
		const filterButton = target.closest<HTMLElement>('[data-hud-filter]');
		if (filterButton) {
			setFilter(filterButton.dataset.hudFilter ?? ALL_CATEGORIES.slug);
			return;
		}
		if (!target.closest('[data-hud-open]')) return;
		if (hovered !== null) open(hovered);
	});

	// --- Render -----------------------------------------------------------
	/**
	 * Expanding rings around a node, drawn under it. `strength` is how hard
	 * they pulse (0 = none), and the two rings are half a period apart so the
	 * marker never goes quiet between beats.
	 */
	function drawRipples(node: SimNode, strength: number, color: Rgb) {
		if (strength < 0.02 || reducedMotion.matches) return;
		for (let ring = 0; ring < 2; ring++) {
			const phase = ((clock / RIPPLE_PERIOD_MS + node.phase / 7 + ring * 0.5) % 1 + 1) % 1;
			const radius = node.sr * (1 + phase * RIPPLE_REACH);
			// Fade in over the first tenth so a ring never appears mid-air.
			const fade = Math.min(1, phase * 10) * (1 - phase);
			ctx.beginPath();
			ctx.arc(node.sx, node.sy, radius, 0, Math.PI * 2);
			ctx.strokeStyle = rgba(color, 0.4 * fade * strength);
			ctx.lineWidth = 1;
			ctx.stroke();
		}
	}

	function draw() {
		ctx.clearRect(0, 0, width, height);
		for (const node of nodes) project(node);

		// Normalise depth across whatever the cloud looks like this frame, so the
		// near/far contrast stays strong at every zoom and rotation.
		let minDepth = Infinity;
		let maxDepth = -Infinity;
		for (const node of nodes) {
			if (node.depth < minDepth) minDepth = node.depth;
			if (node.depth > maxDepth) maxDepth = node.depth;
		}
		const span = maxDepth - minDepth || 1;
		for (const node of nodes) node.near = (node.depth - minDepth) / span;

		const labelsVisible = zoom * fitScale() > 0.4;
		const anyHighlight = nodes.some((node) => node.glow > 0.02);
		/** 1 while a single category is being shown, 0 while showing everything. */
		const filtering = filter === ALL_CATEGORIES.slug ? 0 : 1;

		// Links behind nodes, back to front, so the depth cue reads correctly.
		const ordered = [...links].sort(
			(a, b) =>
				(nodes[a.source].depth + nodes[a.target].depth) / 2 -
				(nodes[b.source].depth + nodes[b.target].depth) / 2,
		);
		for (const link of ordered) {
			const a = nodes[link.source];
			const b = nodes[link.target];
			const lit = Math.max(a.glow, b.glow) * (hovered !== null ? 1 : 0);
			const near = (a.near + b.near) / 2;
			const base = mix(theme.link, theme.bg, (1 - near) * LINK_DEPTH_FADE);
			const color = mix(base, theme.accent, lit);
			// An edge is only as present as its dimmer end — a line running off
			// to a filtered-out work shouldn't stay at full strength.
			const shown = Math.min(a.shown, b.shown);
			const visible = FILTERED_ALPHA + (1 - FILTERED_ALPHA) * shown;
			ctx.beginPath();
			ctx.moveTo(a.sx, a.sy);
			ctx.lineTo(b.sx, b.sy);
			ctx.strokeStyle = rgba(
				color,
				(anyHighlight ? LINK_ALPHA_DIMMED + LINK_ALPHA_LIT * lit : LINK_ALPHA) *
					(LINK_NEAR_FLOOR + (1 - LINK_NEAR_FLOOR) * near) *
					visible,
			);
			ctx.lineWidth = (0.6 + 0.9 * near) * (1 + lit * 0.6);
			ctx.stroke();
		}

		const order = nodes.map((_, i) => i).sort((a, b) => nodes[a].depth - nodes[b].depth);

		// --- Which labels get drawn ---------------------------------------
		// A projection of a 3D cloud will always throw some titles on top of
		// each other at some angle. Claim boxes nearest-first so the node in
		// front keeps its label and the one behind quietly drops it — which
		// reads as depth rather than as a collision. This has to be its own
		// pass because the nodes themselves are drawn back-to-front.
		type Box = { x0: number; y0: number; x1: number; y1: number };
		const hits = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

		const labelled = new Set<number>();
		const taken: Box[] = [];
		// The bubbles themselves are obstacles: a title printed across another
		// work's node was the ugliest case, and the one the label-versus-label
		// test alone never caught.
		const nodeBoxes: Box[] = nodes.map((n) => ({
			x0: n.sx - n.sr - 2,
			y0: n.sy - n.sr - 2,
			x1: n.sx + n.sr + 2,
			y1: n.sy + n.sr + 2,
		}));
		const labelSize = (node: SimNode) =>
			Math.max(10, Math.round((10 + 3 * node.near) * zoom * Math.max(0.82, fitScale() * 1.9)));

		for (const i of [...order].reverse()) {
			const node = nodes[i];
			if (i === hovered) continue; // its label lives in the preview box
			const lit = node.glow > 0.02 || i === active;
			if (!labelsVisible && !lit) continue;

			const size = labelSize(node);
			ctx.font = `${size}px ${theme.family}`;
			const top = node.sy + node.sr + 7;
			const half = ctx.measureText(node.title).width / 2;
			const box = {
				x0: node.sx - half - LABEL_PADDING,
				y0: top - LABEL_PADDING,
				x1: node.sx + half + LABEL_PADDING,
				y1: top + size + LABEL_PADDING,
			};
			const clear =
				!taken.some((o) => hits(box, o)) &&
				!nodeBoxes.some((o, j) => j !== i && hits(box, o));
			// A lit node always gets its label — being told what you're
			// pointing at matters more than a tidy frame.
			if (lit || clear) {
				labelled.add(i);
				taken.push(box);
			}
		}

		for (const i of order) {
			const node = nodes[i];
			// Far nodes shrink toward the background; near ones come forward in
			// full contrast. Size is already handled by the perspective scale.
			const base = mix(theme.node, theme.bg, (1 - node.near) * NODE_DEPTH_FADE);
			// While a category is being shown, its works are tinted toward the
			// accent as well as left at full strength — fading the others down
			// on its own was too quiet a signal to read as a selection.
			const picked = filtering * node.shown;
			const color = mix(mix(base, theme.accent, picked * 0.45), theme.accent, node.glow);
			const dimmed = anyHighlight ? NODE_DIMMED + (1 - NODE_DIMMED) * node.glow : 1;
			const visible = FILTERED_ALPHA + (1 - FILTERED_ALPHA) * node.shown;
			const alpha = Math.min(
				1,
				(NODE_ALPHA_FLOOR + NODE_ALPHA_RANGE * node.near + picked * 0.35) * dimmed * visible,
			);

			// Ripples: constant under the pointer, and constant (a touch
			// stronger) for whichever work the side panel has open.
			const pulse = Math.max(node.glow * (i === hovered ? 1 : 0), i === active ? 1 : 0);
			drawRipples(node, pulse * node.shown, theme.accent);

			ctx.beginPath();
			ctx.arc(node.sx, node.sy, node.sr * (1 + node.glow * 0.3), 0, Math.PI * 2);
			ctx.fillStyle = rgba(color, alpha);
			ctx.fill();

			// The open work keeps a hard ring around it whether or not it is
			// under the pointer — that ring is the whole point: it's how you see
			// which bubble the panel beside you belongs to.
			if (i === active) {
				ctx.beginPath();
				ctx.arc(node.sx, node.sy, node.sr * 2.1, 0, Math.PI * 2);
				ctx.strokeStyle = rgba(theme.accent, 0.9 * visible);
				ctx.lineWidth = 1.5;
				ctx.stroke();
			} else if (node.glow > 0.02) {
				ctx.beginPath();
				ctx.arc(node.sx, node.sy, node.sr * (1.8 + node.glow * 0.8), 0, Math.PI * 2);
				ctx.strokeStyle = rgba(theme.accent, 0.55 * node.glow * visible);
				ctx.lineWidth = 1;
				ctx.stroke();
			}

			// The hovered node's own label lives in the HUD element instead. The
			// rest are dropped once the graph is drawn small enough that titles
			// would overlap each other — which is the default on a phone, where
			// the HUD takes over via tap-to-preview.
			if (labelled.has(i)) {
				// Titles take the node colour, not --muted: they name the bubble
				// they sit under, and at the far end the old pairing composited
				// to 1.2:1, which is a shape where a word should be.
				const labelColor = mix(
					mix(mix(theme.node, theme.bg, (1 - node.near) * LABEL_DEPTH_FADE), theme.accent, picked * 0.45),
					theme.accent,
					Math.max(node.glow, i === active ? 1 : 0),
				);
				ctx.fillStyle = rgba(
					labelColor,
					Math.min(
						1,
						(LABEL_ALPHA_FLOOR + LABEL_ALPHA_RANGE * node.near + picked * 0.35) *
							dimmed *
							visible,
					),
				);
				ctx.font = `${labelSize(node)}px ${theme.family}`;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'top';
				ctx.fillText(node.title, node.sx, node.sy + node.sr + 7);
			}
		}
	}

	function frame(time: number) {
		clock = time;

		if (alpha > 0.0005) {
			alpha *= 0.94;
			tick(nodes, links, groups, alpha, random);
		}

		if (
			!reducedMotion.matches &&
			!orbiting &&
			dragNode === null &&
			hovered === null &&
			time - lastInteraction > IDLE_RESUME_MS
		) {
			yawTarget += IDLE_SPIN;
		}

		// Ease the camera toward wherever the input put the target.
		yaw += (yawTarget - yaw) * CAMERA_EASE;
		pitch += (pitchTarget - pitch) * CAMERA_EASE;
		zoom += (zoomTarget - zoom) * CAMERA_EASE;

		// Highlights and the filter fade instead of snapping.
		const related = hovered === null ? null : neighbours[hovered];
		for (let i = 0; i < nodes.length; i++) {
			const target = i === hovered ? 1 : related?.has(i) ? 0.5 : 0;
			nodes[i].glow += (target - nodes[i].glow) * GLOW_EASE;
			nodes[i].shown += ((inFilter(nodes[i]) ? 1 : 0) - nodes[i].shown) * FILTER_EASE;
		}

		draw();
		positionHud();
		requestAnimationFrame(frame);
	}

	// --- Pointer ----------------------------------------------------------
	canvas.addEventListener('pointerdown', (event) => {
		if (event.button !== 0) return;
		touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
		lastInteraction = performance.now();

		// A second finger turns whatever was happening into a pinch. Whatever
		// the first finger had grabbed is let go, so the graph doesn't orbit
		// wildly while the two fingers spread.
		if (pinching()) {
			pinchStartSpan = touchSpan();
			pinchStartZoom = zoomTarget;
			autoFit = false;
			orbiting = false;
			dragNode = null;
			pointerId = null;
			return;
		}

		pointerId = event.pointerId;
		pointerMoved = false;
		pointerStart = { x: event.clientX, y: event.clientY };
		const hit = nodeAt(event.clientX, event.clientY);
		if (hit !== null) {
			dragNode = hit;
		} else {
			orbiting = true;
		}
		canvas.setPointerCapture(event.pointerId);
	});

	canvas.addEventListener('pointermove', (event) => {
		lastInteraction = performance.now();

		if (touches.has(event.pointerId)) {
			touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
		}

		// Two fingers: zoom around the span between them, and nothing else.
		if (pinching()) {
			const span = touchSpan();
			if (pinchStartSpan > 0 && span > 0) {
				zoomTarget = Math.max(
					MIN_ZOOM,
					Math.min(MAX_ZOOM, (pinchStartZoom * span) / pinchStartSpan),
				);
			}
			return;
		}

		if (pointerId === event.pointerId && (orbiting || dragNode !== null)) {
			const dx = event.clientX - pointerStart.x;
			const dy = event.clientY - pointerStart.y;
			if (!pointerMoved && Math.hypot(dx, dy) > 4) pointerMoved = true;
			pointerStart = { x: event.clientX, y: event.clientY };

			if (orbiting) {
				yawTarget += dx * 0.005;
				pitchTarget = Math.max(-1.3, Math.min(1.3, pitchTarget + dy * 0.005));
			} else if (dragNode !== null) {
				// Move the node in the camera plane: undo the view rotation so a
				// rightward drag is rightward on screen whatever the orbit angle.
				const node = nodes[dragNode];
				const scale = 1 / (node.depth * zoom * Math.max(0.0001, fitScale()));
				const wx = dx * scale;
				const wy = dy * scale;
				node.x += wx * Math.cos(yaw);
				node.z += wx * Math.sin(yaw);
				node.y += wy * Math.cos(pitch);
				node.z -= wy * Math.sin(pitch);
				node.vx = 0;
				node.vy = 0;
				node.vz = 0;
				alpha = Math.max(alpha, 0.6);
			}
			return;
		}

		const hit = nodeAt(event.clientX, event.clientY);
		if (hit === hovered) return;
		if (hit === null) {
			// Don't drop it straight away — the pointer may be on its way to the
			// HUD, which is what makes the open button clickable at all.
			if (!hudPinned) releaseHover();
			return;
		}
		holdHover();
		hovered = hit;
		canvas.classList.add('over-node');
		updateHud();
	});

	function endPointer(event: PointerEvent) {
		const wasPinching = pinching();
		touches.delete(event.pointerId);

		// Lifting one finger out of a pinch shouldn't be read as a tap, and
		// shouldn't hand the remaining finger a half-finished orbit either.
		if (wasPinching) {
			pinchStartSpan = touchSpan();
			pinchStartZoom = zoomTarget;
			pointerMoved = true;
			return;
		}

		if (pointerId !== event.pointerId) return;
		const wasDragNode = dragNode;
		orbiting = false;
		dragNode = null;
		pointerId = null;
		lastInteraction = performance.now();
		if (!pointerMoved) {
			const hit = wasDragNode ?? nodeAt(event.clientX, event.clientY);
			if (event.pointerType !== 'mouse') {
				// No hover on touch, so a tap has to do both jobs: the first one
				// on a node previews it, a second on the same node opens it.
				if (hit !== hovered) {
					holdHover();
					hovered = hit;
					updateHud();
					return;
				}
			}
			if (hit !== null) open(hit);
		}
	}

	canvas.addEventListener('pointerup', endPointer);
	canvas.addEventListener('pointercancel', endPointer);
	canvas.addEventListener('pointerleave', (event) => {
		// Touch fires pointerleave immediately after pointerup, which would undo
		// the tap-to-preview selection made a moment earlier.
		if (event.pointerType !== 'mouse') return;
		if (hovered !== null && !hudPinned) releaseHover();
	});

	canvas.addEventListener(
		'wheel',
		(event) => {
			event.preventDefault();
			lastInteraction = performance.now();
			autoFit = false;
			zoomTarget = Math.max(
				MIN_ZOOM,
				Math.min(MAX_ZOOM, zoomTarget * Math.exp(-event.deltaY * 0.0015)),
			);
		},
		{ passive: false },
	);

	// --- Outside state ----------------------------------------------------
	/** Mirrors the open panel onto the graph, so one bubble is always marked. */
	function syncActive() {
		const id = openWorkId();
		const next = id === null ? null : (byId.get(id) ?? null);
		if (next === active) return;
		active = next;
		// Opening a work from a filtered-out category (a pasted link, say) would
		// otherwise mark a bubble nobody can see.
		if (active !== null && !inFilter(nodes[active])) setFilter(ALL_CATEGORIES.slug);
	}
	window.addEventListener('hashchange', syncActive);
	window.addEventListener('popstate', syncActive);
	syncActive();

	onFilterChange((slug) => {
		filter = slug;
		// Whatever was under the pointer may have just been filtered away.
		if (hovered !== null && !inFilter(nodes[hovered])) {
			hovered = null;
			canvas.classList.remove('over-node');
			updateHud();
		}
	});
	filter = currentFilter();

	// Keyboard users reach the works through the visually-hidden list beside
	// the canvas; focusing an entry highlights the matching node so the two
	// views stay in sync.
	document.querySelectorAll<HTMLAnchorElement>('[data-graph-focus]').forEach((link) => {
		const i = byId.get(link.dataset.graphFocus ?? '');
		if (i === undefined) return;
		link.addEventListener('focus', () => {
			holdHover();
			hovered = i;
			updateHud();
		});
		link.addEventListener('blur', () => {
			hovered = null;
			updateHud();
		});
	});

	const observer = new ResizeObserver(() => {
		resize();
		if (autoFit) fitToView();
	});
	observer.observe(canvas);
	resize();
	fitToView();
	requestAnimationFrame(frame);
}
