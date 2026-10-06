// Publishes the low-tech mirror's dithered pictures, one per cover and plate,
// at /low-tech/img/<work>/<cover|plate-NN>.png. Built from the same originals
// the CMS uploads, every build — see ../../../lib/dither.ts.
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { dither } from '../../../lib/dither';
import { picturesOf, type Picture } from '../../../lib/low-tech';

export const getStaticPaths = (async () => {
	const works = await getCollection('work');
	return works.flatMap((work) => {
		const { cover, plates } = picturesOf(work);
		return [...(cover ? [cover] : []), ...plates].map((picture) => ({
			params: { file: picture.file },
			props: { picture },
		}));
	});
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
	const { picture } = props as { picture: Picture };
	return new Response(new Uint8Array(await dither(picture.image)), {
		headers: { 'content-type': 'image/png' },
	});
};
