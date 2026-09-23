## What this is

A single-page portfolio for Lexie Yu: a 3D force-directed graph of her works,
drawn to a canvas, with a docked detail panel. Astro 7, deployed on Vercel,
content edited through Decap CMS at `/admin`.

If you are picking this project up cold, read `docs/coming-back.md` first —
it covers the branch workflow, what is deliberate rather than accidental, and
the traps that have caught previous sessions.

## Branches — read this before committing

- **`main` is live.** Vercel builds production from it, and **Decap CMS commits
  straight to it** every time Lexie presses Publish.
- `dev` is where code changes are made.
- Because the CMS writes to `main`, **`dev` is usually behind**. Always
  `git checkout dev && git merge main` before starting work, or you will
  resurrect old content.

### The standing rule for every update

Lexie's instruction, in force since 2026-09-14:

> after update, merge dev to main, leave update message and make sure the
> change and the previous version is retrievable, then push it so i can see it
> live on website

So, at the end of a piece of work:

1. Commit on `dev` with a message that explains *why*, not just what.
2. Tag the current `main` as `release/<date>` so the previous live version
   stays retrievable.
3. Merge `dev` into `main` with `--no-ff`, tag the new release.
4. Push both branches and the tags.
5. Sync `dev` back from `main`.

## Testing

`npm test` runs seven behaviour suites (~127 checks) in a real browser. It
starts its own dev server unless given a port: `npm test -- 4321`.

These are behaviour checks, not unit tests. Most of what this site does is
*drawn*, so the suites read the result off the canvas pixels. Nearly every
regression this project has had was invisible to the type-checker and obvious
on screen — run them before shipping anything that touches the graph.

**Never loosen a threshold to make a suite pass.** Twice the suites were right
and the code was wrong; twice the fixture's measurement was wrong and was
rewritten to measure the real thing. Work out which before changing either.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Things that look wrong but are deliberate

- `output: 'static'` with an adapter, and no `output: 'hybrid'` — Astro 5
  removed hybrid; static plus an adapter is how you get on-demand routes now.
- The panel's close is torn down by a timer, not `transitionend`: a transition
  that never runs (reduced motion, backgrounded tab) fires no event and would
  strand the panel open.
- Entry animations use a double `requestAnimationFrame`. One is not enough —
  an element going from `display:none` to its end state in the same frame has
  no start state to transition from.
- The graph's colours come from CSS custom properties read at runtime, so the
  canvas re-reads them when the theme switches.
- Depth figures in `src/scripts/graph.ts` are measured off rendered pixels,
  not computed from the constants. See the comment block there before
  changing them — the arithmetic has been misleading twice.

## Documentation

- `docs/coming-back.md` — picking the project up again, and what to watch for.
- `docs/editing-content.md` — the CMS, for Lexie. Also covers deploys and
  troubleshooting.

Astro reference: https://docs.astro.build

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
