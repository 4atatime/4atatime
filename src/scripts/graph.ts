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
import { dismissPanel } from './window';

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
	/** Distance from the camera in world units — the actual one, not a ranking. */
	dist: number;
	/** How present this distance should look: 1 at the front, →0 at the back. */
	near: number;
	/** Phase offset for the idle drift, so nodes don't move in lockstep. */
	phase: number;
	/** Eased highlight, 0 → 1. Lerped rather than set, so hover fades. */
	glow: number;
	/** Eased filter membership, 1 = in the current category, 0 = filtered out. */
	shown: number;
	/** Projected position for the title, which damps the idle drift. */
	lx: number;
	ly: number;
	/** Eased 0 → 1 as the title wins or loses its space, so it never blinks. */
	labelFade: number;
}

// --- Camera ---------------------------------------------------------------
// A short camera distance relative to the cloud radius (~600) is what gives
// the perspective its bite: near nodes project ~2.6x larger than far ones,
// which is most of what makes the thing read as 3D rather than as a flat web.
const CAMERA_DISTANCE = 900;
/**
 * Base scale: how many world units map onto the viewport's short axis before
 * zoom. A fixed number can't fill both a 21:9 desktop and a tall phone, so
 * this only sets the ballpark — frameNodes() below measures the works as they
 * actually project and picks the zoom that frames them.
 */
const FIT_BASIS = 2000;
/** How much of the viewport the whole cloud should span when first framed. */
const FIT_TARGET = 0.92;
/**
 * The same, for a single category. Deliberately looser: a category of three
 * filled 92% of the frame and read as "zoomed into three dots" rather than as
 * a selection made within a larger field. Leaving room around it keeps the
 * rest of the garden in shot, which is what makes the filter legible.
 */
const FOCUS_TARGET = 0.58;
/**
 * How many other works to keep in shot when one is opened, and how much of
 * the room left beside the panel they should fill.
 *
 * The point of the move is context: a work on its own in an empty frame says
 * nothing about where it sits, and the whole field re-centred says nothing
 * about the work. Six neighbours is enough to show which cluster you are in
 * while still arriving somewhere specific.
 */
const COMPANY = 6;
const WORK_FOCUS_TARGET = 0.8;
/** How much closer a linked work counts than an unrelated one at the same
 * distance, when choosing what to keep in shot. */
const RELATED_BIAS = 0.6;
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
/** Most of the window the legend's gutter may ever claim. */
const LEGEND_GUTTER_MAX_SHARE = 0.3;
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
/** The three-quarter view everything falls back to. */
const DEFAULT_YAW = 0.4;
const DEFAULT_PITCH = -0.25;

/**
 * Floor on the node-size multiplier. Without it a phone drew desktop-sized
 * nodes into a third of the space, which is what made the graph look packed
 * there however far apart the physics actually put things; letting the size
 * fall with the viewport keeps the gap-to-node ratio roughly honest.
 */
const RADIUS_FLOOR = 0.55;
/** Extra pixels around a node that still count as pointing at it. */
const HIT_SLOP = 18;
/** How far a press may travel and still be a click rather than a drag. */
const MOUSE_SLOP = 4;
const TOUCH_SLOP = 10;

// --- Idle drift -----------------------------------------------------------
// Scaled with the layout spread, so the drift stays the same fraction of the
// gap between two works as it was before the field was opened out.
const DRIFT_AMPLITUDE = 10;
const DRIFT_SPEED = 0.00035;

// --- Depth cueing ---------------------------------------------------------
// How far away a thing is, expressed as how present it looks. Distance is the
// only cue a flat canvas has besides size, so this is most of what makes the
// field read as a volume you are looking into rather than a web with a
// gradient over it.
//
// Two things decide it. The first is that the cue is taken from the node's
// real camera-space distance, not — as it was — from where it ranked among
// the others that frame. Ranking was cheap and always used the full range,
// but it showed: whatever happened to be furthest back was drawn as fully
// distant even when the cloud was turned edge-on and everything sat at much
// the same depth, and two works genuinely side by side could be shaded a long
// way apart. Distance has neither problem, and it stays honest while the
// field turns.
//
// The second is that extinction is exponential, the way haze actually works:
// a fixed fraction of what is left is lost per unit travelled, so most of the
// fading happens across the first half and the back of the cloud settles onto
// a floor rather than racing to nothing. FOG_DENSITY is how many e-foldings
// that comes to from the front of the cloud to the back — a shape, not a
// distance — so it keeps its look as the CMS adds works and the field grows.
//
// Far things recede; they must not disappear. An early version faded colour
// and alpha hard enough that a standby link at the back composited to 1.04:1
// against the page — no contrast at all. The floors below are what stop that
// while still letting the back of the cloud go quiet.
//
// Measured against the shipped palette, standby, back of the cloud to front:
//   node  2.0:1 → 7.7:1 (light)   2.6:1 → 9.8:1 (dark)
//   link  1.4:1 → 2.9:1 (light)   1.4:1 → 3.2:1 (dark)
//
// That is a front-to-back spread of about 3.9x, against 2.7x when the depth
// cue was a ranking — the works at the back are now clearly behind something
// rather than merely slightly greyer than it.
//
// The dimmed figures — what everything *else* drops to while one node is
// hovered — are deliberately left near 1.1:1. That collapse is what makes the
// highlight read, and raising the standby floors without keeping it would
// have traded one legibility problem for another.
/** E-foldings of extinction from the front of the cloud to the back. */
const FOG_DENSITY = 1.5;
/** How far a node's colour is washed toward the page at the far end. */
const NODE_DEPTH_FADE = 0.4;
/** Alpha at the back of the cloud, and how much more the front gets. */
const NODE_ALPHA_FLOOR = 0.5;
const NODE_ALPHA_RANGE = 0.5;
/** What a node drops to when something else is hovered. */
const NODE_DIMMED = 0.34;
/** The same pair for edges, which stay deliberately quieter than the discs:
 * roughly a third of a node's contrast at any given depth. Visible as
 * structure, never competing with the works they join. */
const LINK_DEPTH_FADE = 0.38;
const LINK_ALPHA = 1;
/** Edges keep this much of their weight at the back, or the web comes apart. */
const LINK_NEAR_FLOOR = 0.42;
/** Edge alpha while something is hovered: the quiet state, and the lit one. */
const LINK_ALPHA_DIMMED = 0.18;
const LINK_ALPHA_LIT = 0.7;
/**
 * Titles are text and need more than a shape does. They also sit deeper in
 * the new cue than they did in the old one — an exponential spends most of
 * its range early — so the floor is held higher here than for the discs on
 * purpose: a receding circle is still a circle, but grey-on-grey text is just
 * hard to read. Worst case is about 2.4:1, and only the front of the cloud is
 * named at all (see LABEL_MIN_RADIUS).
 */
const LABEL_DEPTH_FADE = 0.22;
const LABEL_ALPHA_FLOOR = 0.68;
const LABEL_ALPHA_RANGE = 0.32;

// --- Titles ---------------------------------------------------------------
// Which works are named is decided per node, by how big that node is actually
// drawn — not by one global "is the whole graph zoomed in enough" test. That
// test was a desktop measurement in disguise: the same default framing scores
// 0.72 on a laptop and 0.19 on a phone, so a phone showed no titles at all
// until you had zoomed most of the way in, and the field arrived looking like
// abstract dots rather than an index of work.
//
// Tied to radius instead, the rule reads the way you'd expect it to: the
// circles nearest the front are named, zooming in names more, zooming out
// names fewer. At the default framing that's every work on a desktop and the
// closest dozen on a phone, which collision-culling then thins further.
/** A circle has to be drawn at least this wide to be worth naming. */
const LABEL_MIN_RADIUS = 6;
/** Titles stop growing here. Past it they collide faster than they inform. */
const LABEL_MAX_SIZE = 17;
const LABEL_MIN_SIZE = 10;
/**
 * How much of a node's idle drift its title copies. The circles should float;
 * the titles going with them at full amplitude read as trembling rather than
 * as motion — text shows up sub-pixel movement that a soft-edged circle hides.
 */
const LABEL_DRIFT_DAMPING = 0.3;
/** How fast a title fades in or out when it wins or loses its space. */
const LABEL_FADE_EASE = 0.12;

/** How much of the gap a node's highlight closes each frame. */
const GLOW_EASE = 0.16;
/** Same easing for the filter fade — slower, because it's a bigger change. */
const FILTER_EASE = 0.09;
/** A filtered-out work stays visible rather than vanishing, so the shape of
 * the whole garden is never lost — and so the selection reads as *these,
 * among all of those*, which needs the others to still be there. */
const FILTERED_ALPHA = 0.3;
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
		dist: CAMERA_DISTANCE,
		near: 0.5,
		phase: random() * Math.PI * 2,
		glow: 0,
		shown: 1,
		lx: 0,
		ly: 0,
		labelFade: 0,
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

	/**
	 * How deep the cloud is, measured rather than assumed. The fog is defined
	 * across the cloud's own front-to-back extent, so adding works in the CMS
	 * grows the field without washing the whole thing out or flattening it.
	 * Isotropic enough that one radius serves every view angle.
	 */
	const cloudRadius = Math.max(
		200,
		Math.max(...nodes.map((n) => Math.hypot(n.x, n.y, n.z))),
	);
	const fogNear = CAMERA_DISTANCE - cloudRadius;
	const fogSpan = 2 * cloudRadius;

	/** How present something at this distance should look: 1 near, →0 far. */
	function depthCue(dist: number) {
		const t = Math.min(1, Math.max(0, (dist - fogNear) / fogSpan));
		return Math.exp(-FOG_DENSITY * t);
	}
	// alpha is the simulation's temperature: 0 at rest, bumped back up when a
	// node is dragged so its neighbours re-arrange around it.
	let alpha = 0;

	// --- Camera state -----------------------------------------------------
	// Each of these has a target the camera eases toward; dragging moves the
	// target, never the camera, which is what takes the rigidity out.
	let yaw = DEFAULT_YAW;
	let yawTarget = yaw;
	let pitch = DEFAULT_PITCH;
	let pitchTarget = pitch;
	let zoom = 1;
	let zoomTarget = zoom;
	/** Cleared the moment someone zooms themselves — then the frame is theirs. */
	let autoFit = true;
	/** The point the camera is centred on, in unzoomed screen units. */
	let panX = 0;
	let panY = 0;
	/** Where it's heading. Eased, so selecting a category flies rather than cuts. */
	let panXTarget = 0;
	let panYTarget = 0;
	let clock = 0;
	let lastInteraction = 0;
	let width = 0;
	let height = 0;

	/** How much of the top and bottom edges the chrome is covering, in px. */
	let chromeTop = MOBILE_TOP_FALLBACK;
	let chromeBottom = MOBILE_BOTTOM_FALLBACK;
	let chromeLeft = LEGEND_GUTTER_MAX;

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
		// Measured, like the other two, rather than taken as a fraction of the
		// window. A fifth of the viewport happened to clear the legend on a
		// laptop and was never really a measurement — it left titles printing
		// over the category counts as soon as the camera moved left, which
		// opening a work now does.
		chromeLeft =
			legend && width >= DESKTOP_FROM
				? // Capped against the window, not against a fixed number: the
					// old cap of 240px was narrower than the legend itself, so
					// it quietly threw the measurement away.
					Math.min(width * LEGEND_GUTTER_MAX_SHARE, legend.getBoundingClientRect().right + CHROME_CLEARANCE)
				: Math.min(width * LEGEND_GUTTER, LEGEND_GUTTER_MAX);
	}

	/** Where the interface is sitting on top of the canvas, in canvas space. */
	function chromeBoxes() {
		const rect = canvas.getBoundingClientRect();
		const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
		for (const el of document.querySelectorAll('.station, .cta, .bottom-bar')) {
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			boxes.push({
				x0: r.left - rect.left,
				y0: r.top - rect.top,
				x1: r.right - rect.left,
				y1: r.bottom - rect.top,
			});
		}
		return boxes;
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
	/**
	 * How much of the canvas the detail panel is sitting on top of.
	 *
	 * The panel is fixed over the right-hand side rather than laid out beside
	 * the canvas, so opening it resizes nothing and the graph would happily go
	 * on centring itself underneath. Anything that wants to put something
	 * where it can actually be seen has to measure this.
	 */
	function panelCover() {
		const panel = document.getElementById('detail-window');
		if (!panel || panel.hidden || panel.classList.contains('closing')) return 0;
		return Math.min(width * 0.8, panel.getBoundingClientRect().width);
	}

	/**
	 * The part of the canvas worth drawing into. `besidePanel` excludes the
	 * room an open panel has taken, for the one case that needs it — framing
	 * the work you just opened next to the panel showing it.
	 */
	function viewFrame(besidePanel = false) {
		const desktop = width >= DESKTOP_FROM;
		const left = desktop ? chromeLeft : 0;
		const top = desktop ? 0 : chromeTop;
		const bottom = desktop ? 0 : chromeBottom;
		const right = besidePanel && desktop ? panelCover() : 0;
		const usable = Math.max(160, width - left - right);
		return {
			cx: left + usable / 2,
			cy: top + (height - top - bottom) / 2,
			halfW: usable / 2,
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
	/**
	 * Where a node lands at an arbitrary angle, before zoom and pan. Used to
	 * try out camera angles without disturbing the one on screen.
	 */
	function projectAt(node: SimNode, atYaw: number, atPitch: number) {
		const cy = Math.cos(atYaw);
		const sy = Math.sin(atYaw);
		const cp = Math.cos(atPitch);
		const sp = Math.sin(atPitch);
		const x1 = node.x * cy + node.z * sy;
		const z1 = -node.x * sy + node.z * cy;
		const y2 = node.y * cp - z1 * sp;
		const z2 = node.y * sp + z1 * cp;
		const depth = CAMERA_DISTANCE / Math.max(200, CAMERA_DISTANCE - z2);
		const fit = fitScale();
		return { x: x1 * depth * fit, y: y2 * depth * fit, depth };
	}

	/**
	 * The angle that shows a set of works most clearly: the one where they
	 * spread furthest apart relative to the room they take up, so nothing sits
	 * behind anything else and every title has somewhere to go.
	 *
	 * Derived rather than hand-picked per category. The layout is deterministic
	 * — same seed, same positions every load — so each category resolves to its
	 * own stable angle that behaves like an authored viewpoint, except it stays
	 * correct when a work is added or removed in the CMS, which a hard-coded
	 * pair of numbers would not.
	 */
	function bestAngleFor(members: SimNode[]) {
		// One work has no spread to optimise; give it the default three-quarter
		// view rather than an arbitrary winner.
		if (members.length < 2) return { yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH };

		let best = { yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH, score: -Infinity };
		for (let y = 0; y < Math.PI * 2; y += Math.PI / 12) {
			for (let p = -0.9; p <= 0.9; p += 0.3) {
				const pts = members.map((n) => projectAt(n, y, p));
				let minX = Infinity;
				let maxX = -Infinity;
				let minY = Infinity;
				let maxY = -Infinity;
				for (const pt of pts) {
					minX = Math.min(minX, pt.x);
					maxX = Math.max(maxX, pt.x);
					minY = Math.min(minY, pt.y);
					maxY = Math.max(maxY, pt.y);
				}
				// Normalise by the box they occupy, so the score rewards even
				// spacing rather than simply being far from the camera.
				const span = Math.max(maxX - minX, maxY - minY) || 1;
				let tightest = Infinity;
				for (let i = 0; i < pts.length; i++) {
					for (let j = i + 1; j < pts.length; j++) {
						tightest = Math.min(tightest, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
					}
				}
				const score = tightest / span;
				if (score > best.score) best = { yaw: y, pitch: p, score };
			}
		}
		return { yaw: best.yaw, pitch: best.pitch };
	}

	/**
	 * Frames a set of works: centres the camera on them and picks the zoom that
	 * fills whatever room the chrome has left. Angle is decided separately by
	 * the caller, because the angle is what gives a category its identity and
	 * shouldn't change just because the window was resized.
	 */
	function frameNodes(members: SimNode[], atYaw: number, atPitch: number) {
		if (!width || !height || members.length === 0) return;
		const view = viewFrame();
		const target = members.length === nodes.length ? FIT_TARGET : FOCUS_TARGET;

		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (const node of members) {
			const pt = projectAt(node, atYaw, atPitch);
			// The drawn radius at zoom 1, so the framing accounts for the discs
			// themselves rather than just their centres.
			const r = radiusOf(node) * pt.depth * Math.max(RADIUS_FLOOR, fitScale() * 1.5);
			minX = Math.min(minX, pt.x - r);
			maxX = Math.max(maxX, pt.x + r);
			minY = Math.min(minY, pt.y - r);
			maxY = Math.max(maxY, pt.y + r);
		}

		const halfX = (maxX - minX) / 2;
		const halfY = (maxY - minY) / 2;
		if (!(halfX > 0) || !(halfY > 0)) return;

		// Centre on what's being framed, not on the world origin — the
		// simulation settles wherever it settles.
		panXTarget = (minX + maxX) / 2;
		panYTarget = (minY + maxY) / 2;
		zoomTarget = Math.max(
			MIN_ZOOM,
			Math.min(MAX_ZOOM, Math.min((view.halfW * target) / halfX, (view.halfH * target) / halfY)),
		);
	}

	/** Every node, or just the ones in a category. */
	function membersOf(slug: string) {
		return slug === ALL_CATEGORIES.slug ? nodes : nodes.filter((n) => n.sectionSlug === slug);
	}

	/**
	 * Turn the field to face a category and frame it.
	 *
	 * Selecting a category used to only fade the other works down, which left
	 * the selection wherever it happened to be sitting — often edge-on, or
	 * behind the works it had just dimmed. Flying to an angle that faces the
	 * set is what makes the filter legible as "here is that collection" rather
	 * than "some dots went quiet".
	 */
	function focusOn(slug: string, snap = false) {
		const members = membersOf(slug);
		if (members.length === 0) return;
		const angle = bestAngleFor(members);
		yawTarget = nearestTurn(yaw, angle.yaw);
		pitchTarget = angle.pitch;
		frameNodes(members, angle.yaw, angle.pitch);
		if (snap) {
			// First paint: be there already rather than flying in from a
			// viewpoint nobody chose.
			yaw = yawTarget;
			pitch = pitchTarget;
			zoom = zoomTarget;
			panX = panXTarget;
			panY = panYTarget;
		}
	}

	/**
	 * Move the camera onto the work that just opened, into the room the panel
	 * has left.
	 *
	 * Opening a work used to leave the field exactly where it was, which
	 * often meant the work you were reading about was somewhere behind the
	 * panel. The point of having the graph and the text on screen together is
	 * that the graph answers the question the text raises — what is this near?
	 * — so the work is put in the middle of what you can still see, with
	 * enough of its company around it to show which part of the field you are
	 * in.
	 *
	 * The angle is deliberately left alone. Turning the field as well would
	 * make opening a work a bigger movement than closing one, and the reader
	 * did not ask to go anywhere — they asked to read something.
	 */
	function focusWork(index: number) {
		// On a phone the panel is the whole screen; there is no beside it.
		if (!width || !height || width < DESKTOP_FROM) return;
		const node = nodes[index];

		const free = viewFrame(true);
		const whole = viewFrame();
		const here = projectAt(node, yawTarget, pitchTarget);

		// Its company: whatever is nearest *on screen*, which is the only
		// sense of "near" the reader can see. Ranking by distance through the
		// layout instead put works behind the camera in the running and framed
		// half the field to reach them — the view came out looking like the
		// whole graph nudged sideways rather than like somewhere.
		//
		// Works it is actually linked to count as closer than they are, so a
		// related work just outside the frame is preferred to an unrelated one
		// just inside it, without letting one distant link open the frame up.
		const away = (i: number) => {
			const pt = projectAt(nodes[i], yawTarget, pitchTarget);
			const d = Math.hypot(pt.x - here.x, pt.y - here.y);
			return neighbours[index].has(i) ? d * RELATED_BIAS : d;
		};
		const company = nodes
			.map((_, i) => i)
			.filter((i) => i !== index)
			.sort((a, b) => away(a) - away(b))
			.slice(0, COMPANY);

		let halfX = 0;
		let halfY = 0;
		for (const i of company) {
			const pt = projectAt(nodes[i], yawTarget, pitchTarget);
			halfX = Math.max(halfX, Math.abs(pt.x - here.x));
			halfY = Math.max(halfY, Math.abs(pt.y - here.y));
		}
		// Half-extents are measured from the work outwards, so the fit uses the
		// whole half-frame; a lone work with no spread keeps the zoom it had.
		if (halfX > 0 && halfY > 0) {
			zoomTarget = Math.max(
				MIN_ZOOM,
				Math.min(
					MAX_ZOOM,
					Math.min(
						(free.halfW * WORK_FOCUS_TARGET) / halfX,
						(free.halfH * WORK_FOCUS_TARGET) / halfY,
					),
				),
			);
		}
		// The work itself is the centre, not the middle of the group: it is the
		// thing being read about, and a group centre would let it drift to the
		// edge whenever its company happened to sit to one side.
		//
		// Offset, because the pan is applied against the frame the canvas is
		// actually drawn in — the whole one — while the place we want the work
		// to appear is the middle of what the panel has left. Without this the
		// work is centred in the viewport and so lands underneath the panel
		// showing it, which is the exact problem this is here to fix.
		panXTarget = here.x - (free.cx - whole.cx) / zoomTarget;
		panYTarget = here.y - (free.cy - whole.cy) / zoomTarget;
		// The reader put the camera here; a later resize shouldn't refit the
		// whole category over the top of it.
		autoFit = false;
	}

	/**
	 * The same bearing expressed as the shortest way round from where we are,
	 * so the field never takes the long way to an angle a few degrees away.
	 */
	function nearestTurn(from: number, to: number) {
		const twoPi = Math.PI * 2;
		let delta = (((to - from) % twoPi) + twoPi) % twoPi;
		if (delta > Math.PI) delta -= twoPi;
		return from + delta;
	}

	/** Re-frames whatever is currently selected, at the angle already chosen. */
	function refit() {
		frameNodes(membersOf(filter), yawTarget, pitchTarget);
	}

	/**
	 * Where a node is drawn this frame, plus where its title goes. Both carry
	 * the idle drift, but the title only takes a damped share of it — see
	 * LABEL_DRIFT_DAMPING.
	 */
	function project(node: SimNode) {
		const cosYaw = Math.cos(yaw);
		const sinYaw = Math.sin(yaw);
		const cosPitch = Math.cos(pitch);
		const sinPitch = Math.sin(pitch);
		// A slow, tiny orbit of each node around its settled position. Too small
		// to read as movement, big enough that the graph never looks frozen —
		// and off entirely for anyone who asked for less motion, which the
		// idle spin and the ripples already honoured but this didn't.
		const amplitude = reducedMotion.matches ? 0 : DRIFT_AMPLITUDE;
		const drift = Math.sin(clock * DRIFT_SPEED + node.phase) * amplitude;
		const driftB = Math.cos(clock * DRIFT_SPEED * 0.8 + node.phase) * amplitude;
		const view = viewFrame();
		const fit = fitScale();

		const place = (dx: number, dy: number, dz: number) => {
			const x = node.x + dx;
			const y = node.y + dy;
			const z = node.z + dz;
			const x1 = x * cosYaw + z * sinYaw;
			const z1 = -x * sinYaw + z * cosYaw;
			const y2 = y * cosPitch - z1 * sinPitch;
			const z2 = y * sinPitch + z1 * cosPitch;
			// Keep the divisor away from zero so a node swinging behind the
			// camera can't produce an infinite scale.
			const dist = Math.max(200, CAMERA_DISTANCE - z2);
			const depth = CAMERA_DISTANCE / dist;
			return {
				// panX/panY are in unzoomed cloud units and hold the point the
				// camera is centred on.
				sx: view.cx + (x1 * depth * fit - panX) * zoom,
				sy: view.cy + (y2 * depth * fit - panY) * zoom,
				depth,
				dist,
			};
		};

		const circle = place(drift, driftB, drift * 0.6);
		node.depth = circle.depth;
		node.dist = circle.dist;
		node.sx = circle.sx;
		node.sy = circle.sy;
		node.sr = radiusOf(node) * circle.depth * zoom * Math.max(RADIUS_FLOOR, fit * 1.5);

		// The title rides a damped copy of the same drift. Projected rather
		// than lerped toward the circle: a lerp would lag visibly while the
		// field is being turned, where this tracks an orbit exactly and only
		// takes the tremble out of the idle float.
		const label = place(
			drift * LABEL_DRIFT_DAMPING,
			driftB * LABEL_DRIFT_DAMPING,
			drift * 0.6 * LABEL_DRIFT_DAMPING,
		);
		node.lx = label.sx;
		node.ly = label.sy;
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
	/**
	 * True while a work, or About & Contact, is showing over the graph.
	 *
	 * Read at pointer-up rather than snapshotted at pointer-down: the panel
	 * no longer closes itself the moment the canvas is pressed, so by the time
	 * a press ends this still says what it said when the press began.
	 */
	function isPanelOpen() {
		const panel = document.getElementById('detail-window');
		return !!panel && !panel.hidden && !panel.classList.contains('closing');
	}
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
		let spare: number | null = null;
		let spareDistance = Infinity;
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			const distance = Math.hypot(node.sx - x, node.sy - y);
			// Generous hit slop: these are small targets, the crosshair cursor
			// makes precise aiming harder than a normal pointer, and on a phone
			// the nodes are smaller still.
			if (distance >= node.sr + HIT_SLOP) continue;
			// Works outside the shown category are still reachable — they are
			// dimmed, not disabled, and a dot you can see but not point at is a
			// worse lie than one that isn't drawn. They're kept in a separate
			// bucket so they can never win a contest against a work that *is*
			// being shown: dimming something must not make its neighbour harder
			// to hit.
			if (inFilter(node)) {
				if (distance < bestDistance) {
					bestDistance = distance;
					best = i;
				}
			} else if (distance < spareDistance) {
				spareDistance = distance;
				spare = i;
			}
		}
		return best ?? spare;
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

	/**
	 * What clicking a work does.
	 *
	 * A work outside the category being shown is dimmed, not disabled, so a
	 * click on one is a request for it rather than a mis-click: its collection
	 * is selected — which is also the answer to "how do I get to that one?" —
	 * and then it opens. The selection lands first so the field is already
	 * showing the right collection by the time the panel arrives; focusWork
	 * then has the last word on where the camera ends up, because the work
	 * you asked for is more specific than the category it belongs to.
	 */
	function activate(index: number) {
		if (!inFilter(nodes[index])) setFilter(nodes[index].sectionSlug);
		open(index);
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

		// A work outside the category being shown gets its name and nothing
		// else. It is not what the reader is looking at, so a full slip for it
		// would be an interruption — but an unlabelled dot they can't identify
		// is why they'd feel stuck in a category in the first place. The name
		// is enough to answer "what is that one?" and to make it obvious the
		// dot is still live.
		hud.classList.toggle('bare', !inFilter(node));
		if (!inFilter(node)) {
			hud.innerHTML = `<span class="hud-title">${escapeHtml(node.title)}</span>`;
			hudSize = { width: hud.offsetWidth, height: hud.offsetHeight };
			positionHud();
			return;
		}

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
		if (hovered !== null) activate(hovered);
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

		// Read off each node's actual distance, so two works side by side are
		// shaded alike and turning the field doesn't re-rank everything.
		for (const node of nodes) node.near = depthCue(node.dist);

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
		// The chrome is claimed before any title is: the legend, the About
		// button and (on a phone) the bottom bar are opaque boxes sitting over
		// the canvas, and a title printed under one is just lost text. The
		// framing keeps the *bubbles* out of the gutter, but a title is drawn
		// from its node's centre outwards and so can still reach into it —
		// which is what moving the camera onto an opened work made visible.
		const taken: Box[] = chromeBoxes();
		// The bubbles themselves are obstacles: a title printed across another
		// work's node was the ugliest case, and the one the label-versus-label
		// test alone never caught.
		const nodeBoxes: Box[] = nodes.map((n) => ({
			x0: n.sx - n.sr - 2,
			y0: n.sy - n.sr - 2,
			x1: n.sx + n.sr + 2,
			y1: n.sy + n.sr + 2,
		}));
		// Not rounded: at these sizes the computed value sits near an integer
		// boundary often enough that rounding made titles flick a whole pixel
		// bigger and smaller as the field breathed, which was most of what
		// read as trembling. Canvas is happy with fractional sizes.
		const labelSize = (node: SimNode) =>
			Math.min(
				LABEL_MAX_SIZE,
				Math.max(LABEL_MIN_SIZE, (10 + 3 * node.near) * zoom * Math.max(0.82, fitScale() * 1.9)),
			);

		// Nearest first, except that a selected category jumps the queue: the
		// point of focusing one is to read its works, so they get first claim
		// on the space before anything behind them does.
		const planOrder = [...order].reverse();
		if (filter !== ALL_CATEGORIES.slug) {
			planOrder.sort((a, b) => Number(inFilter(nodes[b])) - Number(inFilter(nodes[a])));
		}

		for (const i of planOrder) {
			const node = nodes[i];
			if (i === hovered) continue; // its label lives in the preview box
			const selected = filtering > 0 && inFilter(node);
			const lit = node.glow > 0.02 || i === active || selected;
			// While a category is showing, only its works are named. The others
			// stay on screen as context — naming them too just crowds the set
			// the reader asked to look at.
			if (filtering > 0 && !selected && node.glow <= 0.02 && i !== active) continue;
			// Big enough to be worth naming — measured on this circle, not on
			// the graph as a whole.
			if (node.sr < LABEL_MIN_RADIUS && !lit) continue;

			const size = labelSize(node);
			ctx.font = `${size}px ${theme.family}`;
			const top = node.ly + node.sr + 7;
			const half = ctx.measureText(node.title).width / 2;
			const box = {
				x0: node.lx - half - LABEL_PADDING,
				y0: top - LABEL_PADDING,
				x1: node.lx + half + LABEL_PADDING,
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

		// Ease every title toward whether it won a place, so one crossing in
		// front of another dissolves instead of blinking. A title on its way
		// out has already given its box back, so the one replacing it doesn't
		// have to wait — they cross-fade, which is what the eye expects.
		for (let i = 0; i < nodes.length; i++) {
			const target = labelled.has(i) ? 1 : 0;
			nodes[i].labelFade += (target - nodes[i].labelFade) * LABEL_FADE_EASE;
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
			if (node.labelFade > 0.01) {
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
					) * node.labelFade,
				);
				ctx.font = `${labelSize(node)}px ${theme.family}`;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'top';
				ctx.fillText(node.title, node.lx, node.ly + node.sr + 7);
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
		panX += (panXTarget - panX) * CAMERA_EASE;
		panY += (panYTarget - panY) * CAMERA_EASE;

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
		// Throws if the pointer is already gone by the time we get here,
		// which costs us nothing: without capture the move still tracks,
		// it just stops early if the finger leaves the canvas.
		try {
			canvas.setPointerCapture(event.pointerId);
		} catch {}
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
			// A finger never lands as still as a mouse, and treating a 5px
			// wobble as a drag is what makes taps feel unreliable.
			const slop = event.pointerType === 'mouse' ? MOUSE_SLOP : TOUCH_SLOP;
			if (!pointerMoved && Math.hypot(dx, dy) > slop) pointerMoved = true;
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
				// With a panel already up there is nothing to preview — the tap
				// is a change of subject, so it goes straight through.
				if (hit !== hovered && !isPanelOpen()) {
					const hadPreview = hovered !== null;
					holdHover();
					hovered = hit;
					updateHud();
					// Tapping past a work while its preview is up just puts the
					// preview away. Clearing the category as well would be two
					// things at once; that's the next tap's job.
					if (hit === null && !hadPreview) clearFilterIfAny();
					return;
				}
			}
			if (hit !== null) activate(hit);
			else dismissOrClear();
		}
	}

	/**
	 * A click on the empty field, with nothing under it: undo one thing.
	 *
	 * The panel goes first because it is the larger claim on the screen, and
	 * only then the category. One layer per click is what keeps this feeling
	 * like an escape key rather than a trapdoor — and a drag or a pinch never
	 * gets here at all, so turning the field while reading leaves both alone.
	 */
	function dismissOrClear() {
		if (isPanelOpen()) {
			dismissPanel();
			return;
		}
		clearFilterIfAny();
	}

	/**
	 * Clicking the empty field is the way out of a category.
	 *
	 * Without it the only route back is the "All" chip, which is easy to miss
	 * once the legend has scrolled out of mind — and being unable to undo a
	 * filter is the kind of dead end people quietly leave over. Dismissing a
	 * selection by clicking away from it is the same gesture as closing the
	 * panel, so it needs no explaining.
	 *
	 * One layer at a time: a press that closed a panel doesn't also clear the
	 * category, and a drag or a pinch isn't a click at all — both are already
	 * ruled out before this runs.
	 */
	function clearFilterIfAny() {
		if (isPanelOpen()) return;
		if (filter === ALL_CATEGORIES.slug) return;
		setFilter(ALL_CATEGORIES.slug);
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
		if (active === null) return;
		// A frame late on purpose: the panel is opened by its own listener on
		// this same event, and how much room it takes can't be measured until
		// it's there. Which listener runs first depends on component order,
		// which is not something this should depend on.
		const target = active;
		requestAnimationFrame(() => {
			if (active === target) focusWork(target);
		});
	}
	window.addEventListener('hashchange', syncActive);
	window.addEventListener('popstate', syncActive);
	syncActive();

	onFilterChange((slug) => {
		const changed = slug !== filter;
		filter = slug;
		// Whatever is under the pointer may have just moved in or out of the
		// shown category, which changes its preview from a full slip to a bare
		// name or back. Re-render rather than drop it: the dot is still there
		// and still under the pointer.
		if (hovered !== null) updateHud();
		// Turn to face the selection. Re-enables auto-fitting: the reader asked
		// for this framing, so a later resize should preserve it.
		if (changed) {
			autoFit = true;
			focusOn(slug);
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
		if (autoFit) refit();
	});
	observer.observe(canvas);
	resize();
	// Land on the "All" viewpoint rather than an arbitrary angle, and be there
	// on the first frame rather than flying in from nowhere.
	focusOn(filter, true);
	requestAnimationFrame(frame);
}
