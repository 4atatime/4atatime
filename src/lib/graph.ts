// Builds the homepage graph: every work is a node, and edges connect works
// that are "near" each other in subject matter. Computed at build time so the
// client only ships coordinates-free data plus the force simulation.
//
// Clustering logic, in order of pull strength:
//   1. an exact shared tag ("Chinese" on both Touch of Zen and the Fú Lù
//      wallpapers) — the strongest signal, and the one that draws edges
//      across sections;
//   2. a shared word between two different tags ("Design System" /
//      "Design & Dev"), which catches near-synonyms the exact match misses;
//   3. belonging to the same section, which is what keeps the four obvious
//      clusters recognisable;
//   4. being made around the same time, used mostly as a tie-breaker so
//      same-section edges don't get picked arbitrarily.
//
// Then each node keeps only its k strongest edges (union of both directions,
// so an edge survives if *either* end rates it highly). Without that cut an
// 8-item section becomes a 28-edge hairball; with it the layout reads the way
// an Obsidian graph does — visible clumps joined by a few long bridges.
import type { CollectionEntry } from 'astro:content';
import { categorySlug } from './categories';

export interface GraphNode {
	id: string;
	title: string;
	section: string;
	/** `section` in the URL-safe form the homepage filter uses. */
	sectionSlug: string;
	tags: string[];
	date: string;
	/** Shown in the hover preview, on its own row. */
	location?: string;
	role?: string;
	/** Number of surviving edges — drives node radius, as in Obsidian. */
	degree: number;
}

export interface GraphLink {
	/** Index into `nodes`, not an id: the simulation resolves these hot. */
	source: number;
	target: number;
	weight: number;
}

export interface GraphData {
	nodes: GraphNode[];
	links: GraphLink[];
}

const EXACT_TAG = 2.4;
const SHARED_WORD = 0.8;
const SAME_SECTION = 1;
const CONTEMPORARY = 0.6;
/** Edges kept per node before the union. */
const K = 3;

// Words too generic to imply two works are related.
const STOPWORDS = new Set(['and', 'the', 'for', 'with', 'work', 'previous']);

function words(tags: string[]): Set<string> {
	const out = new Set<string>();
	for (const tag of tags) {
		for (const word of tag.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
			if (word.length > 2 && !STOPWORDS.has(word)) out.add(word);
		}
	}
	return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
	let n = 0;
	for (const value of a) if (b.has(value)) n++;
	return n;
}

export function buildGraph(items: CollectionEntry<'work'>[]): GraphData {
	const sorted = [...items].sort((a, b) => b.data.sortDate.getTime() - a.data.sortDate.getTime());

	const prepared = sorted.map((item) => ({
		item,
		tags: new Set(item.data.tags.map((t) => t.toLowerCase())),
		words: words(item.data.tags),
		year: item.data.sortDate.getTime() / (365.25 * 24 * 60 * 60 * 1000),
	}));

	const score = (a: (typeof prepared)[number], b: (typeof prepared)[number]) => {
		const exact = overlap(a.tags, b.tags);
		// Shared words that aren't already explained by an exact tag match.
		const shared = Math.max(0, overlap(a.words, b.words) - exact);
		const section = a.item.data.section === b.item.data.section ? 1 : 0;
		const closeness = Math.max(0, 1 - Math.abs(a.year - b.year) / 3);
		return (
			exact * EXACT_TAG + shared * SHARED_WORD + section * SAME_SECTION + closeness * CONTEMPORARY
		);
	};

	// Full similarity matrix — 20 works, so the O(n²) pass is free.
	const scores: number[][] = prepared.map(() => []);
	for (let i = 0; i < prepared.length; i++) {
		for (let j = i + 1; j < prepared.length; j++) {
			const value = score(prepared[i], prepared[j]);
			scores[i][j] = value;
			scores[j][i] = value;
		}
	}

	const kept = new Map<string, GraphLink>();
	for (let i = 0; i < prepared.length; i++) {
		const best = prepared
			.map((_, j) => ({ j, weight: scores[i][j] ?? 0 }))
			.filter(({ j, weight }) => j !== i && weight > 0)
			.sort((a, b) => b.weight - a.weight)
			.slice(0, K);
		for (const { j, weight } of best) {
			const key = i < j ? `${i}-${j}` : `${j}-${i}`;
			if (!kept.has(key)) {
				kept.set(key, { source: Math.min(i, j), target: Math.max(i, j), weight });
			}
		}
	}

	const links = [...kept.values()];
	const degrees = new Array(prepared.length).fill(0);
	for (const link of links) {
		degrees[link.source]++;
		degrees[link.target]++;
	}

	const nodes: GraphNode[] = sorted.map((item, i) => ({
		id: item.id,
		title: item.data.title,
		section: item.data.section,
		sectionSlug: categorySlug(item.data.section),
		tags: item.data.tags,
		date: item.data.date,
		location: item.data.location,
		role: item.data.role,
		degree: degrees[i],
	}));

	return { nodes, links };
}
