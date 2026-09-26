# Coming back to this project

Written for you, months from now, having forgotten all of it. Nothing here
assumes you remember anything.

The short version: **the site is finished and live, everything is saved in
GitHub, and nothing you do in the CMS can lose the code.** To change content,
use `/admin` and never open a terminal. To change the site itself, follow
[Part 3](#part-3--changing-the-site-again).

---

## Part 1 — Where everything lives

| Thing | Where | What it's for |
|---|---|---|
| The code | `github.com/4atatime/4atatime` | Everything. The only thing that must not be lost. |
| The live site | `4atatime.vercel.app` | Rebuilt automatically whenever `main` changes. |
| The editor | `4atatime.vercel.app/admin` | Adding and editing works. No terminal. |
| This folder | `~/4atatime` on your Mac | A working copy. Safe to delete — see Part 3. |

Two branches:

- **`main` is what's live.** Vercel builds it. The CMS writes to it.
- **`dev`** is where code changes are made before they go live.

Every release is tagged `release/<date>`, so any previous version of the site
can be brought back exactly. `git tag -l 'release/*'` lists them; the newest
is at the bottom. Examples below use `release/2026-09-23d`; swap in whichever
one you want.

There is also a full offline backup, taken before the 2026-09-24 slimming, in
`~/4atatime-backups/`. `HOW-TO-RESTORE.txt` in there explains it.

---

## Part 2 — Wrapping up today

Everything below has already been done and checked. It's written down so you
can confirm it yourself if you ever want to.

```bash
cd ~/4atatime
git status          # → "nothing to commit, working tree clean"
git log --oneline -1
```

`git status` printing **nothing** under the branch name means every change is
saved. If it lists files, something is unsaved — see "If `git status` isn't
clean" in Part 5.

To confirm GitHub has everything:

```bash
git log origin/main..main --oneline    # → prints nothing = GitHub is up to date
git log origin/dev..dev --oneline      # → prints nothing
```

To confirm the live site matches, open `4atatime.vercel.app` and hard-reload
(`Cmd-Shift-R`). Or from the Vercel dashboard: the top deployment should be
green, on `main`, and its commit should match what `git log -1` printed.

**You can now close VS Code and this folder can sit untouched indefinitely.**
Nothing expires. The site keeps running and the CMS keeps working whether or
not this folder exists.

---

## Part 3 — Changing the site again

### 3.1 Open the project

1. Open **VS Code**.
2. **File → Open Folder…** → choose `~/4atatime` → **Open**.
3. **Terminal → New Terminal** (or `` Ctrl-` ``). It opens in the project
   folder already.

If the folder is gone — new laptop, tidied it away, anything — get it back
with:

```bash
cd ~
git clone https://github.com/4atatime/4atatime.git
cd 4atatime
npm install
npx playwright install chromium   # only needed if you want to run npm test
```

That is a complete restoration. Nothing is stored only on your machine.

(The last line downloads the browser the tests drive. It's a separate step
because `npm install` doesn't fetch browsers. Skip it if you're not testing —
`npm test` will remind you if you need it.)

### 3.2 Catch up with the CMS

Every time you press Publish in the CMS, that's a commit on `main`. The code
branch `dev` doesn't move, so it falls behind by however many edits you've
published since anyone last touched the code.

**This is handled automatically.** A GitHub Action
(`.github/workflows/sync-dev.yml`) brings `dev` up to `main` within a minute
of every publish. You should never have to think about it.

So in practice, all you need is:

```bash
git checkout dev
git pull
```

If `git pull` answers *"There is no tracking information for the current
branch"*, it doesn't know which remote branch this one follows. Tell it once,
and it will remember:

```bash
git branch --set-upstream-to=origin/dev dev
```

Run `git merge main` too if you like — it's a harmless no-op when the Action
has already done its job, and it covers the case where the Action was off or
had nothing it could do.

**To confirm the Action is doing its job**, the next time you publish a work
in the CMS: go to the repository on GitHub, open the **Actions** tab, and you
should see "Keep dev in step with main" run and go green within a minute. Or
check the branches page — `dev` and `main` should show the same latest commit.
If it ever stops working, nothing breaks; you're back to running
`git merge main` yourself, which is why that line is still here.

**Nothing rots while `dev` is behind.** This was overstated in an earlier
version of this guide, so, precisely: merging a stale `dev` into `main` does
**not** revert your content. Git merges the two sides; it doesn't overwrite
one with the other. Published works stay published. The only real costs of a
stale `dev` are that you'd be writing and testing code against a version of
the site that isn't the one online, and that you could hit a merge conflict —
but only if the code work edited *the same file* the CMS did, which means a
content file, which code work almost never touches.

If you do see the word `CONFLICT`, don't fix it by hand — hand it to Claude
(next step). It fails loudly rather than silently, so nothing is lost while
you decide.

### 3.3 Start Claude Code

In the VS Code terminal:

```bash
claude
```

If that isn't found, install it once with `npm install -g @anthropic-ai/claude-code`.

### 3.4 Tell it where it is

**Claude will not remember any of this work.** Every session starts from
nothing. It does read `CLAUDE.md` in the project automatically, which explains
the branch rules, the tests, and the deliberate oddities — so it won't be
starting blind, but it still needs to be told what you want.

A good opening message, which you can copy as-is:

> This is my portfolio site — a 3D graph of my works, Astro, deployed on
> Vercel, content edited through Decap CMS. Read CLAUDE.md and
> docs/coming-back.md before doing anything. Then run `npm test` so we both
> know the current state. After that, here's what I want to change: …

Then describe the change in your own words. You do not need technical
language — describing what feels wrong is more useful than guessing at a
cause.

### 3.5 Let it finish the job

The project has a standing rule, written into `CLAUDE.md`, that Claude should
follow without being asked: commit to `dev`, tag the old version, merge to
`main`, push, so the change goes live and the previous version stays
recoverable.

If a session ends without that, the work is still safe on your machine but
**not live**. Ask: *"please finish and ship this the usual way"*.

---

## Part 4 — Checking the site still works

```bash
npm test
```

This drives a real browser through the site — about 147 checks across eight
areas: the panel, the mobile layout, the category focus, the navigation, the
sky. It takes a few minutes and starts its own server. At the end it prints
either `all 8 suites passed` or which ones failed.

Run it before shipping any change to the graph. It has caught things that
looked perfectly fine in the code.

Other useful commands:

| Command | What it does |
|---|---|
| `npm run dev` | Local preview at `localhost:4321`. `Ctrl-C` stops it. |
| `npm run build` | Checks the site builds — the same thing Vercel does. |
| `npm test` | The behaviour suites, above. |
| `git log --oneline -10` | The last ten changes, newest first. |

---

## Part 5 — When something goes wrong

### The live site broke after a CMS edit

Almost always a missing or malformed field. Vercel emails you and the
deployment goes red; **the old version stays up**, so the public site is fine
in the meantime.

1. Vercel dashboard → the failed deployment → **Build Logs**.
2. The error names the file and usually the field.
3. Fix it in `/admin` and press Publish again.

If the message is opaque, copy it into Claude — the build check is written to
name the work and the line.

### The site looks wrong but nothing is broken

Get the previous version back immediately, then investigate:

**Vercel dashboard → Deployments → the last good one → ⋯ → Promote to
Production.** That's instant and needs no terminal.

To see what changed between then and now:

```bash
git log --oneline release/2026-09-23d..main
```

### You want a whole previous version back

Every release is tagged. To look at one:

```bash
git checkout release/2026-09-23d
```

Look around, then `git checkout dev` to come back. This changes nothing and
can't do harm — you're only looking.

### If `git status` isn't clean

It's listing work that isn't saved. Either it's wanted:

```bash
git add -A && git commit -m "describe what changed"
```

…or it isn't, and this throws it away permanently:

```bash
git restore .
```

If you're not sure which, don't guess — commit it. A commit can be undone; a
discarded change cannot.

### Something has gone badly wrong and you want to start clean

```bash
cd ~
mv 4atatime 4atatime-broken
git clone https://github.com/4atatime/4atatime.git
cd 4atatime && npm install && npx playwright install chromium
```

You now have exactly what's on GitHub, and the old folder is still there if it
turns out to have contained something.

---

## Part 6 — Things worth knowing before changing them

Written down because they've each cost a session already.

**The graph's contrast figures are measured, not calculated.** Twice, changes
to how distance fades the works were computed from the constants, looked
correct arithmetically, and changed nothing visible — the sums described a
work at the very front and one at the very back, and no such work existed. The
comment block in `src/scripts/graph.ts` records real measurements taken off
rendered pixels. Trust those over any calculation.

**The tests read pixels, not markup.** The graph is drawn, so there's nothing
in the HTML to assert against. This makes the suites unusually good at
catching things that "should" work, and unusually sensitive to changes in how
the canvas is drawn — when a suite starts failing after a visual change, work
out whether the code broke or the *measurement* did. Both have happened.

**The CMS and the code have to agree.** Fields in `src/cms/config.yml` must
match the schema in `src/content.config.ts`. If they drift, the CMS will
happily save something that fails the next build. Changing one means changing
the other.

**Tags come from one file.** `src/lib/tags.ts` generates both the CMS dropdown
and the validation. Adding a tag is a code change, not a CMS change — see
`docs/editing-content.md`.

**Never put a `pattern:` on an `image` or `file` widget.** Tried on 2026-09-23
to stop a pasted Instagram URL reaching the `src` field, and it locked the CMS
completely: every entry showed a validation error, nothing could be saved or
published, and the picker refused replacements. The reason is that Decap does
not test the stored value. `getValidateValue()` on the file/image control runs
the path through a basename helper first, so `pattern` is matched against
`hero.png`, never against `/src/assets/work/…/hero.png`. A path-shaped pattern
therefore matches nothing — it was checked against all 168 image values in
`src/content/`, and rejected 168 of them.

If this is attempted again, it must be verified in a real browser against an
*existing* entry before shipping. Checking the regex against the stored path in
the markdown, or against the parsed YAML, passes while the CMS is broken —
that's exactly the mistake that shipped. Note that validating the extracted
Decap helpers offline is enough to *diagnose* this, but not to clear a
replacement: a harness that can't reproduce the known failure proves nothing.

**Don't push directly to `main`.** It's what's live. Work on `dev` and merge.

**Vercel's free plan has 10 GB of Deployment Storage, and every deployment
counts.** A deployment is a full copy of the built site, about 46 MB since
2026-09-24 (it was 91 MB). Each CMS publish makes one. Vercel keeps the recent
ones and deletes older ones when the limit is reached, so the site stays up.
The warning in September came from a month of heavy building, when every push
to `main` *and* every push to `dev` made a deployment. Three things keep it low
now, and each is worth keeping:

- `vercel.json` stops `dev` deploying. Those builds were exact copies of the
  live site.
- Work images publish at their three `srcset` sizes only, not a fourth
  full-resolution copy. The comment in `WorkDetailContent.astro` explains why
  the width is read through `clone`. Reading `.width` directly makes Astro
  publish the original files too, and doubles the build.
- The music is 128 kbps AAC, not 320 kbps MP3.
- The full-size plate viewer (added 2026-09-26) makes no files of its own.
  It shows the largest copy each plate already has (1260px wide) by
  reusing the plate's `srcset`. Publishing true originals for it would put
  back the full-resolution copies the 2026-09-24 slimming removed.

Check the size of a build with `npm run build && du -sh .vercel/output/static`.
If it jumps, something started publishing originals again.

---

## Part 7 — The one-page version

Coming back to change something:

```bash
cd ~/4atatime
git checkout dev && git pull    # the Action has usually synced it already
claude                          # then describe the change
```

Coming back to check something:

```bash
cd ~/4atatime && npm run dev                      # localhost:4321
```

Something is live that shouldn't be:

> Vercel → Deployments → last good one → Promote to Production

Editing content: `4atatime.vercel.app/admin`. Nothing else required.
