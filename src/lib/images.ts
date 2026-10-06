// How work images are published, shared by the two places that show them:
// the panel on the main site (WorkDetailContent.astro) and the low-tech
// mirror, which links each dithered picture to the panel's own colour copy.
// Both must ask Astro for identical transforms, or the mirror's link would be
// a second copy of every image in the build rather than the same file.
import type { ImageMetadata } from 'astro';

// The largest size each kind of image is ever offered at. Passed as `width`
// as well as ending `widths`, so the plain `src` fallback reuses that file.
// Left out, Astro makes the fallback a separate copy at the original's full
// resolution — which no browser that reads `srcset` ever downloads, and which
// was about a third of every deployment's size.
export const HERO_MAX = 1440;
export const PLATE_MAX = 1260;
// WebP quality for every work image. Sharp's default is 80; 75 is about 20%
// smaller across this collection and was chosen by Lexie on 2026-09-24 after
// comparing crops side by side.
export const QUALITY = 75;

// An image's pixel width, read without publishing the original. Reading any
// property of an imported image straight off it makes Astro copy the untouched
// source file into the build as well — 120 full-size PNGs and JPGs, the first
// time this was tried. `clone` is the private door Astro's own image code uses
// to avoid exactly that. Should a future Astro drop it, this falls back to the
// plain read: nothing breaks, the build just grows again.
export function widthOf(image: ImageMetadata): number {
	return quiet(image).width;
}

export function heightOf(image: ImageMetadata): number {
	return quiet(image).height;
}

function quiet(image: ImageMetadata): ImageMetadata {
	return (image as ImageMetadata & { clone?: ImageMetadata }).clone ?? image;
}

/**
 * Where the original file sits on disk. Like `clone`, Astro's image proxy
 * answers this without marking the original for publishing. Undefined if a
 * future Astro stops exposing it, in which case src/lib/dither.ts fails the
 * build and says so: only an Astro upgrade can cause that, and it should be
 * caught on `dev`, not discovered as a mirror with no pictures.
 */
export function sourcePathOf(image: ImageMetadata): string | undefined {
	return (image as ImageMetadata & { fsPath?: string }).fsPath;
}
