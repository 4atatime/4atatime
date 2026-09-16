// The force simulation behind the graph, kept free of the DOM so it can be
// run and checked on its own — a layout that collapses into a blob or throws
// nodes off screen is the failure mode you can't see in a code review.
//
// Standard force-directed model in three dimensions: every pair repels
// (inverse-square), every edge pulls like a spring toward a rest length set by
// how related the two works are, and a weak pull toward the origin stops
// disconnected parts from drifting away.
//
// With one addition: two works in different categories repel each other
// several times harder than two in the same one. Springs alone put *related*
// works close together but say nothing about how far an unrelated pair should
// end up, so the four categories used to interleave — a music node could
// settle inside the tattoo cluster simply because nothing pushed it out.
// GROUP_REPULSION is what opens real gaps between the groups.

export interface Body {
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
}

export interface Edge {
	source: number;
	target: number;
	weight: number;
}

// Tuned by sweeping these values against the real collection (see the comment
// on FIT_BASIS in ../scripts/graph.ts, which has to be re-swept alongside
// them). Measured on the current 20 works, at every rotation the camera can
// reach:
//
//   · a work sits ~9.7 node-radii from its nearest neighbour (was ~6.3);
//   · two works in different categories settle 1.8x further apart than two
//     in the same one;
//   · a weak edge settles 1.7x longer than a strong one (was 1.4x), which is
//     what makes "how related are these two" legible as distance;
//   · the cloud still fits, filling ~89% of the viewport's short axis on a
//     desktop and ~91% on a phone at the worst rotation.
export const REPULSION = 58500;
/** Extra repulsion between two works in different categories. */
export const GROUP_REPULSION = 3;
/** Clamps the inverse-square blow-up when two nodes nearly coincide. */
export const MIN_DISTANCE = 60;
export const SPRING = 0.045;
export const GRAVITY = 0.006;
export const DAMPING = 0.86;
/** The group separation takes longer to unwind than the springs did alone. */
export const SETTLE_TICKS = 600;

/** Deterministic PRNG, so the layout is identical on every load. */
export function mulberry32(seed: number): () => number {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Seeds bodies on a spherical shell rather than in a cube — a cube's corners
 * take a long time to unwind and the opening frames look lumpy.
 */
export function seedBodies(count: number, random: () => number): Body[] {
	const bodies: Body[] = [];
	for (let i = 0; i < count; i++) {
		const theta = random() * Math.PI * 2;
		const phi = Math.acos(2 * random() - 1);
		const r = 420 + random() * 260;
		bodies.push({
			x: r * Math.sin(phi) * Math.cos(theta),
			y: r * Math.sin(phi) * Math.sin(theta),
			z: r * Math.cos(phi),
			vx: 0,
			vy: 0,
			vz: 0,
		});
	}
	return bodies;
}

/**
 * Strongly related works settle closer together. Scaled to the weights the
 * current tag vocabulary actually produces (~3.4 for the weakest surviving
 * edge, ~14.8 for the strongest): the weakest lands near 420 units and the
 * strongest near 125, so the full range of relatedness is visible as distance
 * rather than most edges bottoming out on the floor.
 */
export function restLength(weight: number): number {
	return Math.max(110, 510 - weight * 26);
}

/**
 * One step of the simulation. `groups[i]` names the category body `i` belongs
 * to — any two values that compare unequal will do; the simulation only ever
 * asks whether a pair matches.
 */
export function tick(
	bodies: Body[],
	edges: Edge[],
	groups: readonly string[],
	alpha: number,
	random: () => number,
): void {
	for (let i = 0; i < bodies.length; i++) {
		const a = bodies[i];
		for (let j = i + 1; j < bodies.length; j++) {
			const b = bodies[j];
			let dx = b.x - a.x;
			let dy = b.y - a.y;
			let dz = b.z - a.z;
			let distance = Math.hypot(dx, dy, dz);
			if (distance < 1e-3) {
				// Coincident bodies have no direction to separate along.
				dx = random() - 0.5;
				dy = random() - 0.5;
				dz = random() - 0.5;
				distance = Math.hypot(dx, dy, dz);
			}
			const effective = Math.max(distance, MIN_DISTANCE);
			const apart = groups[i] === groups[j] ? 1 : GROUP_REPULSION;
			const force = (REPULSION * apart) / (effective * effective);
			const fx = (dx / distance) * force;
			const fy = (dy / distance) * force;
			const fz = (dz / distance) * force;
			a.vx -= fx;
			a.vy -= fy;
			a.vz -= fz;
			b.vx += fx;
			b.vy += fy;
			b.vz += fz;
		}
	}

	for (const edge of edges) {
		const a = bodies[edge.source];
		const b = bodies[edge.target];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const dz = b.z - a.z;
		const distance = Math.hypot(dx, dy, dz) || 1e-3;
		const force = (distance - restLength(edge.weight)) * SPRING;
		const fx = (dx / distance) * force;
		const fy = (dy / distance) * force;
		const fz = (dz / distance) * force;
		a.vx += fx;
		a.vy += fy;
		a.vz += fz;
		b.vx -= fx;
		b.vy -= fy;
		b.vz -= fz;
	}

	for (const body of bodies) {
		body.vx -= body.x * GRAVITY;
		body.vy -= body.y * GRAVITY;
		body.vz -= body.z * GRAVITY;
		body.vx *= DAMPING;
		body.vy *= DAMPING;
		body.vz *= DAMPING;
		body.x += body.vx * alpha;
		body.y += body.vy * alpha;
		body.z += body.vz * alpha;
	}
}

/** Runs the simulation to rest, cooling linearly, before the first paint. */
export function settle(
	bodies: Body[],
	edges: Edge[],
	groups: readonly string[],
	random: () => number,
): void {
	for (let i = 0; i < SETTLE_TICKS; i++) {
		tick(bodies, edges, groups, 1 - i / SETTLE_TICKS, random);
	}
}
