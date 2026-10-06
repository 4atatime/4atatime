// What the low-tech mirror shows, and in which order. It reads the same
// `work` collection as the main site — the files the CMS writes — so a
// publish updates both versions in the same build, with nothing to copy.
import type { ImageMetadata } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { CATEGORIES } from './categories';

export type Work = CollectionEntry<'work'>;

/** Root of the mirror. Every link into it goes through here. */
export const LOW_TECH = '/low-tech/';

export const workPath = (id: string) => `${LOW_TECH}${id}/`;

/**
 * Works grouped the way the main site's legend groups them — by collection,
 * in the legend's order — and newest first within each. The flat list in the
 * same order is what "previous" and "next" walk through.
 */
export async function worksByCollection() {
	const works = await getCollection('work');
	const groups = CATEGORIES.map((category) => ({
		category,
		works: works
			.filter((work) => work.data.section === category.name)
			.sort((a, b) => b.data.sortDate.getTime() - a.data.sortDate.getTime() || a.data.title.localeCompare(b.data.title)),
	}));
	return { groups, ordered: groups.flatMap((group) => group.works) };
}

export interface Picture {
	/** Path of the dithered copy under /low-tech/img/, e.g. `musr/plate-03.png`. */
	file: string;
	image: ImageMetadata;
}

/** A work's cover and plates, each with the name its dithered copy is published under. */
export function picturesOf(work: Work): { cover?: Picture; plates: Picture[] } {
	const { heroImage, gallery } = work.data;
	return {
		cover: heroImage ? { file: `${work.id}/cover.png`, image: heroImage } : undefined,
		plates: gallery.map((plate, i) => ({
			file: `${work.id}/plate-${String(i + 1).padStart(2, '0')}.png`,
			image: plate.src,
		})),
	};
}

export const pictureUrl = (picture: Picture) => `${LOW_TECH}img/${picture.file}`;
