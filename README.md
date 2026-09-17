# Astro Starter Kit: Blog

```sh
npm create astro@latest -- --template blog
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

Features:

- ✅ Minimal styling (make it your own!)
- ✅ 100/100 Lighthouse performance
- ✅ SEO-friendly with canonical URLs and Open Graph data
- ✅ Sitemap support
- ✅ RSS Feed support
- ✅ Markdown & MDX support

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   ├── content/
│   ├── layouts/
│   └── pages/
├── astro.config.mjs
├── README.md
├── package.json
└── tsconfig.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

The `src/content/` directory contains "collections" of related Markdown and MDX documents. Use `getCollection()` to retrieve posts from `src/content/blog/`, and type-check your frontmatter using an optional schema. See [Astro's Content Collections docs](https://docs.astro.build/en/guides/content-collections/) to learn more.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Check out [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).

## Credit

This theme is based off of the lovely [Bear Blog](https://github.com/HermanMartinus/bearblog/).

## Regenerating the favicons and share card

Both are derived from `src/assets/4atatime_logo_coloured.png` — the teal version
of the mark, not the dark one the page header uses. Re-run this if the mark
changes rather than editing the PNGs in `public/` by hand:

```bash
node -e '
const sharp = require("sharp");
(async () => {
  const src = "src/assets/4atatime_logo_coloured.png";
  const { width, height } = await sharp(src).metadata();
  const side = Math.max(width, height) + Math.round(width * 0.1) * 2;
  // The mark is already the accent teal, so it holds against both a light and
  // a dark browser chrome with no background tile and no recolouring.
  // Compose onto the square first, then resize: within one sharp pipeline the
  // resize runs before the composite and would shrink the canvas out from
  // under the mark.
  const squared = await sharp({
    create: { width: side, height: side, channels: 4, background: { r:0,g:0,b:0,alpha:0 } },
  }).composite([{ input: await sharp(src).toBuffer(), gravity: "center" }]).png().toBuffer();
  for (const size of [32, 180, 512]) {
    await sharp(squared).resize(size, size).png().toFile(`public/favicon-${size}.png`);
  }
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: "#ffffff" } })
    .composite([{ input: await sharp(src).resize({ width: 620 }).toBuffer(), gravity: "center" }])
    .png().toFile("public/og-image.png");
})();
'
```

`sharp` is already a dependency. The `<link rel="icon">` tags that point at the
results live in `src/components/BaseHead.astro`.

There is also a `coloured_logo.svg`, but it's a 1.4 MB traced brush drawing —
far too heavy to ship as a favicon, which is why these are rasters.
