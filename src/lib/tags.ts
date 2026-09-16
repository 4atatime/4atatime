// The tag vocabulary. Every work picks from this list and nothing else, which
// is what makes tags worth having: a controlled set can be offered as a
// dropdown in the CMS, and two works that share a tag genuinely share
// something rather than having independently invented "Illustration" and
// "illustrations".
//
// Tags are load-bearing twice over. They are shown on a work's page, and they
// are the main input to the homepage graph — src/lib/graph.ts pulls two works
// together for every tag they have in common, so the clusters you see are a
// picture of this list. Adding a vague tag that lands on half the collection
// (say "Design") would smear those clusters into one blob; prefer a tag that
// splits the collection into a recognisable group.
//
// To add a tag: add it here AND to the `tags` options in `.pages.yml`, which
// is what the CMS reads. The schema rejects anything not on this list, so a
// typo fails the build rather than quietly becoming a cluster of one.

export const TAGS = [
	// --- What it physically is -------------------------------------------
	'Illustration',
	'Collage',
	'Calligraphy',
	'Tattoo',
	'Poster',
	'Print',
	'Editorial',
	'Book Design',
	'Album Cover',
	'Wallpaper',
	'Merch',
	'Photography',
	'Video',
	'Web',
	'Mobile App',
	'Design System',
	'Branding',

	// --- Sound -------------------------------------------------------------
	'Music',
	'Ambient',
	'Band',
	'Improvisation',

	// --- How it was made ---------------------------------------------------
	'Hand-drawn',
	'Mixed Media',
	'Geometric',
	'Typography',
	'Generative',
	'Experimental',
	'Research',
	'Archival',

	// --- How it came about -------------------------------------------------
	'Personal Project',
	'Commission',
	'Client Work',
	'Collab',
	'Collective',
	'Start-up',
	'Record Label',
	'Social Work',
	'Ongoing',
	'Published',

	// --- What it's about ---------------------------------------------------
	'Chinese',
	'Ritual',
	'Philosophy',
	'Architecture',
	'Community',
	'Nature',

	// --- Tools worth naming ------------------------------------------------
	'Figma',
	'Code',
	'TouchDesigner',
	'AI',
] as const;

export type Tag = (typeof TAGS)[number];
