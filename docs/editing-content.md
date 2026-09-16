# Editing the site without touching code

Everything on this site — every work, its photos, its captions, its links, and
the About & Contact page — lives in plain text files. You never have to open
them. This guide sets up a point-and-click editor at `yoursite.com/admin` and
shows you what each field does.

Setup is a one-off, about ten minutes, and it costs nothing. After that, adding
a work is: open a page, fill in a form, press Publish.

---

## What's already been built

The code side is done and in the repository:

- `/admin` — the editor itself (Decap CMS, open source, no account, no fee)
- `/oauth` and `/oauth/callback` — the two routes that log you in with GitHub
- `src/cms/config.yml` — the form definition
- `src/content/pages/about.md` — the About & Contact copy, now editable

What's left needs your GitHub and Vercel accounts, so it has to be you.

---

## Part 1 — Make a GitHub OAuth App (once)

This is what lets the editor sign you in. It's free and lives in your own
GitHub settings.

1. Go to **github.com → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. **Application name:** anything — "4atatime CMS".
3. **Homepage URL:** your live site, e.g. `https://4atatime.vercel.app`
   (or your custom domain once you have one).
4. **Authorization callback URL:** the same address with `/oauth/callback` on
   the end, e.g. `https://4atatime.vercel.app/oauth/callback`.
   This must match **exactly** — same protocol, no trailing slash.
5. **Register application**.
6. Copy the **Client ID**.
7. **Generate a new client secret** and copy it straight away — GitHub shows
   it once and never again.

## Part 2 — Give the secrets to Vercel (once)

1. Vercel dashboard → your project → **Settings → Environment Variables**.
2. Add `OAUTH_GITHUB_CLIENT_ID` — paste the Client ID.
3. Add `OAUTH_GITHUB_CLIENT_SECRET` — paste the secret.
4. Make sure both are enabled for **Production** (and Preview, if you want the
   editor to work on preview deploys too). Save.

> The site itself builds and runs fine without these — they only affect
> logging in. If they're missing, `/admin` still loads but the login popup
> says so in plain words rather than showing an error page.

## Part 3 — Check which branch Vercel publishes

Open `src/cms/config.yml` and look at `branch:` near the top. It currently says
`main`. It has to match the branch Vercel builds your **production**
deployment from (Vercel → Settings → Git → Production Branch). If those two
disagree, you'll save changes into a branch nobody is looking at.

## Part 4 — Deploy and log in

1. Commit and push. That both saves the config and triggers a Vercel build
   with the new environment variables active.
2. Wait for the deploy to finish (Vercel dashboard).
3. Go to `yoursite.com/admin`.
4. **Login with GitHub**, authorise once.
5. You're in.

**Log in on the deployed site, not on localhost.** The OAuth callback URL you
registered points at your live address, so `localhost:4321/admin` can't
complete a login. (If you ever want to edit offline, see "Editing offline" at
the bottom.)

---

## Your day-to-day, from now on

**Log in → open an entry → fill the form → Publish.** No terminal, no VS Code.
Those only come back if you want to change the *structure* of the site — new
kinds of field, new page templates — not for adding or editing work.

### Add a new work

1. **Work** → **New Work**.
2. Fill in at least: **Title**, **Collected under**, **Intro**,
   **When**, **Sort date**, and at least one **Tag**.
3. **Publish**.

It appears as a new bubble on the homepage graph, linked to whatever it shares
tags with.

### Add pictures to a work

1. Open the work, scroll to **Plates**, click **Add plate**.
2. Click the image box → **Upload** → choose the file.
3. Add **Title** and **Caption** if it needs them, and **Link** if the picture
   should open somewhere (an Instagram post, a shop, an article).
4. Drag plates by the handle to reorder. **Publish**.

Upload the best quality you have. The site shrinks and converts every image
when it builds and serves a size that suits each screen, so a big file costs
your visitors nothing. Pictures for a work are filed in that work's own folder
automatically.

### Edit the About & Contact page

**Pages → About & Contact.** The bio, the email address, the link list and the
sign-off are all fields there.

---

## What every field means

| Field | What it's for |
|---|---|
| **Title** | The name of the work. Shown on the bubble, the preview and the page. |
| **Collected under** | One of the four categories. Sets the "collected under" stamp above the title, which filter the work appears under, and — because works in different categories are pushed apart — roughly where it lands in the graph. |
| **Intro** | One or two sentences under the title. Also what search engines quote. |
| **When (as displayed)** | Free text, exactly as you want it to read: `06/2025`, `2024 – ongoing`, `coming-soon`. |
| **Sort date** | A real date, used only to put works in order. Never shown. If the date is fuzzy, pick the 1st of the month. |
| **Tags** | Pick 5–10 from the dropdown. See the note below — these do more than label. |
| **What (role)** | What you did — "Junior Product Designer", "Guitar". |
| **Where (location)** | Where it happened. |
| **How (method / tools)** | What it was made with. |
| **Update Log** | A one-line update — "Design system in use.", "Waiting to be printed." |
| **Source link** | The one main outbound link. Appears first under "Elsewhere". |
| **Cover image** | The picture at the top of the page. |
| **Elsewhere** | Extra links, each with a label you choose. |
| **Plates** | The picture gallery. Each plate: image, title, caption, link. |
| **Long text** | The write-up below the cover. Leave empty for short works. |

### About tags

Tags are the one field that changes the homepage. Two works that share tags are
pulled together in the graph; two that share none drift apart. The clusters you
see are a picture of how you've tagged things — so tagging well is worth a
minute, and tagging everything "Illustration" would flatten the map into one
clump.

You can only pick from the dropdown. That's deliberate: a free-text field
collects "Illustration", "illustration" and "Illustrations" within a month, and
to the graph those are three unrelated things.

**To add a new tag**, it has to go in two places — `src/lib/tags.ts` and
nowhere else, because the editor's dropdown is generated from that file at
request time. That's still a code change, so either ask whoever maintains the
site or edit that one file on GitHub directly.

---

## Seeing your change

Pressing Publish makes a commit on GitHub, which triggers a Vercel build. The
change is live in a minute or two. If you still see the old version, hard
reload (`Cmd-Shift-R`).

Nothing is ever lost: every save is a commit, so any change can be undone from
the repository's history on GitHub.

---

## If something breaks

| What you see | Most likely cause | Fix |
|---|---|---|
| `/admin` is a blank page | The Decap script didn't load, or the config is invalid | Open `yoursite.com/admin/config.yml` directly — it should show YAML. If it errors, the config has a syntax problem. |
| "Login with GitHub" does nothing | The callback URL doesn't match your site exactly | Recheck Part 1 step 4: same protocol, same host, no trailing-slash mismatch. |
| Popup says the sign-in couldn't be verified | The login was started somewhere other than this site, or took longer than 10 minutes | Close the popup and press Login again. |
| Popup says the CMS login isn't set up yet | The two environment variables aren't reaching this deployment | Add them in Vercel (Part 2), make sure they're enabled for the environment you're on, and redeploy. |
| Popup says GitHub refused the sign-in | `OAUTH_GITHUB_CLIENT_SECRET` is wrong, or was regenerated | Generate a fresh secret in the OAuth App and update it in Vercel, then redeploy. |
| Logged in, but "not authorised" | The repo in the config doesn't match, or that account can't write to it | Check `repo:` in `src/cms/config.yml` reads `4atatime/4atatime`. |
| Published, but the site doesn't change | The build failed, or you published to the wrong branch | Check Vercel's deployment log, then Part 3. |
| Build fails after a save | A required field is empty, a bad date, or an unknown tag | The build message names the field and the work. Open it and check. |

---

## Editing offline (optional)

The editor normally talks to GitHub, which needs the live site. To run it
against the files on your own machine instead:

1. Add `local_backend: true` at the top level of `src/cms/config.yml`.
2. In one terminal: `npx decap-server`
3. In another: `npm run dev`
4. Open `http://localhost:4321/admin` — no login, and saves write straight to
   your local files.

Take the `local_backend` line back out before pushing, or the live editor will
try to reach a server that isn't there.

---

## For the developer

- The CMS is four small routes in this repo, not a dependency:
  `src/pages/admin/index.astro` loads Decap, `src/pages/admin/config.yml.ts`
  serves the config, and `src/pages/oauth/{index,callback}.ts` are the GitHub
  handshake. `astro-decap-cms-oauth` does the same job but declares
  `astro: ^5 || ^6`, and this project is on Astro 7.
- `config.yml` is a route rather than a static file so `base_url` can be the
  request's own origin (localhost, preview and production all differ) and so
  the tag dropdown can be generated from `src/lib/tags.ts` rather than
  transcribed into YAML where it would drift.
- The OAuth login uses a `state` parameter checked against an HttpOnly,
  single-use cookie. The reference implementation omits this.
- Only those three routes are server-rendered (`export const prerender = false`).
  Every page of the actual site is still static. Note there is no
  `output: 'hybrid'` — Astro 5 removed it, and `static` plus an adapter is the
  current way to have on-demand routes.
- Fields in `src/cms/config.yml` must stay in step with the Zod schema in
  `src/content.config.ts`. Required there means required here, or the CMS will
  commit a file that fails the next build.
- Images are committed under `src/assets/work/<slug>/` and referenced as
  `/src/assets/work/...`; the `work` collection sets per-work
  `media_folder`/`public_folder` so uploads land in the right place.
- The favicons and share card are generated from the logo by the snippet in the
  README; re-run it if the mark changes.
