# FlagAgent — Deploy

Status on 23 Nov 2026: **built and verified locally; not yet deployed.** The GitHub connector cannot create repositories (403, a known fleet limit), so step 1 is the one browser step. Everything after it is mechanical.

## Step 1 — create the repo (user's signed-in browser, ~1 minute)
Create a **public** repo named exactly **`flagagent`** at https://github.com/new — no README, no .gitignore, no license (completely empty).

## Step 2 — push this folder
From this directory, push via the GitHub connector snapshot flow (the same route used for GeoRaksha and Verity): tracked + unignored files only, commit message
`FlagAgent — plan, approve, apply for Flagsmith (Track 02) — planner/executor 29 checks, browser QA 20/20`.
Or, on a machine with git credentials: `git push -u origin main` (this folder is already a git repo on branch `main`).

## Step 3 — turn on GitHub Pages
Repo → Settings → Pages → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)` → Save.
Live URL: **https://msabhishek22.github.io/flagagent/**

## Step 4 — verify as a stranger (signed out)
1. Open the live URL. Header chip must say **MOCK — demo project**.
2. Click the **Guarded rollout** example chip → **Plan it** → the plan shows the guard holding and two diffs.
3. **Apply approved changes** → receipt reads "2 of 2 … applied and read back"; the board shows `new_checkout` ON at 10%.
4. Flip the hero board's `search_v2` switch → the board row changes to OFF.
5. Zero console errors. If all five hold, the deployment is verified — record the commit SHA + URL in the submission pack.

## Alternative deploy (no repo yet)
`flagagent-deploy.zip` (in `../`) contains exactly the site payload (`index.html`, `css/`, `js/`). It can be dropped onto Netlify Drop or any static host for an immediate URL; the GitHub route above stays the source of truth for the submission.
