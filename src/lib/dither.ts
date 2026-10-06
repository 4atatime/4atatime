// The low-tech mirror's pictures: every cover and plate, cut down to four
// shades of grey and dithered, the way Low←Tech Magazine's solar site does it
// (solar.lowtechmagazine.com/2018/09/how-to-build-a-low-tech-website/). The
// page tints them by category in the browser, so one grey file serves any
// colour.
//
// Measured across this collection on 2026-10-06: 44 KB a picture on average
// at 600px, about 6.5 MB for all 151 — against 29 KB at 480px, and 30 KB at
// 600px in pure black and white, which lost too much of the ink work. The
// low-tech column is 600px, so the pictures are drawn one to one.
import type { ImageMetadata } from 'astro';
import sharp from 'sharp';
import { heightOf, sourcePathOf, widthOf } from './images';

export const DITHER_WIDTH = 600;
const LEVELS = 4;

/** The size a dithered copy comes out at — the page needs it before the file exists. */
export function ditheredSize(image: ImageMetadata): { width: number; height: number } {
	const width = Math.min(widthOf(image), DITHER_WIDTH);
	return { width, height: Math.max(1, Math.round((heightOf(image) * width) / widthOf(image))) };
}

/** A four-grey, Floyd–Steinberg-dithered PNG of `image`. */
export async function dither(image: ImageMetadata): Promise<Buffer> {
	const path = sourcePathOf(image);
	if (!path) {
		throw new Error(
			'The low-tech mirror could not find the original image files. Astro no ' +
				'longer exposes `fsPath` on imported images (see src/lib/images.ts).',
		);
	}
	const { width, height } = ditheredSize(image);
	const { data } = await sharp(path, { animated: false })
		.resize({ width, height, fit: 'fill' })
		// Transparent areas would otherwise come out black.
		.flatten({ background: '#ffffff' })
		.greyscale()
		.toColourspace('b-w')
		.raw()
		.toBuffer({ resolveWithObject: true });

	const step = 255 / (LEVELS - 1);
	const field = Float32Array.from(data);
	const out = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			const level = Math.max(0, Math.min(LEVELS - 1, Math.round(field[i] / step)));
			out[i] = Math.round(level * step);
			const error = field[i] - out[i];
			if (x + 1 < width) field[i + 1] += (error * 7) / 16;
			if (y + 1 < height) {
				if (x > 0) field[i + width - 1] += (error * 3) / 16;
				field[i + width] += (error * 5) / 16;
				if (x + 1 < width) field[i + width + 1] += error / 16;
			}
		}
	}

	return sharp(Buffer.from(out), { raw: { width, height, channels: 1 } })
		.png({ palette: true, colours: LEVELS, bitdepth: 2, dither: 0, compressionLevel: 9, effort: 10 })
		.toBuffer();
}
