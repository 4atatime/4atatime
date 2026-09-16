import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { TAGS } from './lib/tags';

const work = defineCollection({
	loader: glob({ base: './src/content/work', pattern: '**/*.md' }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			// The main category a work is collected under — the only field the
			// homepage filter and the "collected under" line read.
			section: z.enum(['UI/UX', 'Grafix', 'Ink!', 'mμsic']),
			// Restricted to the shared vocabulary in src/lib/tags.ts: a typo
			// should fail the build rather than quietly become a cluster of one.
			tags: z.array(z.enum(TAGS)).min(1),
			// Display string as it appears on the source site (e.g. "2024 - ongoing") —
			// not always a real parseable date, so kept separate from sortDate.
			date: z.string(),
			sortDate: z.coerce.date(),
			// Survey-slip metadata: what the job was, where it happened, what it
			// was made with. All optional — a music release has no location.
			role: z.string().optional(),
			location: z.string().optional(),
			tools: z.array(z.string()).default([]),
			status: z.string().optional(),
			link: z.string().optional(),
			intro: z.string(),
			heroImage: z.optional(image()),
			/** Further reading: the source site's own outbound links. */
			links: z
				.array(z.object({ label: z.string(), href: z.string() }))
				.default([]),
			/** Plates, in the order they appeared on the source site. */
			gallery: z
				.array(
					z.object({
						src: image(),
						title: z.string().optional(),
						caption: z.string().optional(),
						href: z.string().optional(),
					}),
				)
				.default([]),
		}),
});

// Single-entry pages whose copy should be editable without touching a
// component. Only About & Contact for now; the glob keeps it open to more.
const pages = defineCollection({
	loader: glob({ base: './src/content/pages', pattern: '**/*.md' }),
	schema: z.object({
		tagline: z.string(),
		title: z.string(),
		emailLabel: z.string(),
		email: z.string(),
		linksLabel: z.string(),
		links: z.array(z.object({ label: z.string(), href: z.string() })).default([]),
		signoff: z.string(),
	}),
});

export const collections = { work, pages };
