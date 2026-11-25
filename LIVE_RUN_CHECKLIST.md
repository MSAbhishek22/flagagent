# FlagAgent — Live Run Checklist (paste moment onwards)

Everything here is ready to run the minute the key is pasted. Work down
the list in order; do not skip ahead. The order is the build plan's:
hookup + verification first, FlagBench-20 second, demo video third,
filing last.

## Ground already checked (25 Nov 2026)

- **Event page re-read** (wemakedevs.org/hackathons/flagsmith, 25 Nov
  2026): no rule or form changes since the prep pack. The FAQ's only
  window wording: "Hacking starts at 8 AM IST on November 26, and
  submissions close at 8 PM IST on November 29." No fresh-code rule.
- **Live page confirmed**: https://msabhishek22.github.io/flagagent/ —
  the **Connect Flagsmith** button sits top right, the panel takes the
  Organisation API key + numeric Project ID, and the header chip
  honestly reads "MOCK — demo project" until a key connects.
- **Bench rehearsed on the demo project**: plans 17/20, traps 5/5,
  unapproved writes 0 (`bench/RESULTS_MOCK_2026-11-25.md`). Three known
  misses (cases 1, 8, 10) are written down there — expect them on the
  real run too unless the window's fix slot changes the product.

## Step 1 — the paste (the user only; ~2 minutes)

1. Flagsmith → Organisation settings → API keys → the key named
   **"flagagent"** → **Copy**. (If the masked key can no longer be
   copied, create a fresh Org key the same way — also a user step.)
2. Note the **numeric Project ID** from the project URL or settings.
3. Open https://msabhishek22.github.io/flagagent/ → **Connect
   Flagsmith** (top right) → paste the key, type the Project ID and a
   short label → **Connect**.
4. Success: the chip flips to **LIVE — \<label\>** and the key field
   clears itself. The key lives in the page's memory only. If the read
   fails, the page says why and stays on MOCK; nothing was written.

The key never goes in chat, a screenshot, the repo, or a vault card.

## Step 2 — the 5-minute verification (before any live apply)

From KEY_HOOKUP.md. All four must pass; record what you actually saw.

- [ ] **Read check.** The board lists the real project's real flags
      with plausible states. Empty or wrong board → stop.
      Record: number of flags seen ___ · first flag name ___
- [ ] **Raw response check.** Fetch one feature-state list and compare
      field names with `RealAdapter._normaliseState`:
      `curl -s -H "Authorization: Api-Key <key>" https://api.flagsmith.com/api/v1/environments/<envId>/featurestates/ | head -c 2000`
      Record: **A1** rollout field name seen ___ · **A2** multivariate
      weights field seen ___ · environment versioning **v1 / v2** ___
      If a field differs, patch the normaliser and the `set_rollout`
      write body together, then re-run this check before any apply.
- [ ] **One safe write.** Plan "Enable \<a harmless test flag\> in
      Development" (create the test flag in Flagsmith first if none
      exists). Approve, apply, receipt reads back ON, same flag checked
      in the Flagsmith dashboard.
      Record: flag ___ · read-back matched **yes / no** · dashboard
      matched **yes / no**
- [ ] **Guard check.** Plan the demo rollout sentence with a guard
      naming a real flag. Break the guard by hand in Flagsmith,
      re-plan: FlagAgent must show the guard violated and refuse.
      Record: refusal shown **yes / no**

If the browser blocks the API (CORS error in the console): run the same
page from `localhost` — adapter and flow unchanged — for the live run
and the video. If writes fail while reads work: suspect A1/A2 or v2
versioning (step 2, second box) before anything else.

## Step 3 — set up the real project for the bench (~30 minutes)

Create the flags FlagBench-20 needs (names from `bench/cases.js`, using
the real project's own names where they exist): a checkout flag (off in
Production), a rollout flag, an old flag due for deletion, a guard/kill
switch flag (off), a multivariate headline flag, plus the segment the
segment case uses. Write the starting state of every flag the bench
will touch here before running a single case:

| Flag | Environment | Starting state (enabled / rollout) |
| --- | --- | --- |
|  |  |  |
|  |  |  |
|  |  |  |

## Step 4 — FlagBench-20, the scored run

Work the 20 cases in `bench/cases.js` through the live page, in order.
Per case record: plan correct or not · trap caught or not · writes
made. Known going in: cases 1, 8 and 10 failed the MOCK rehearsal for
written-down reasons — if they fail here the same way, that is the
result; the fix slot comes after the run, and a re-run of the failed
cases (then one clean full run) follows any fix. Never edit a case.

Final numbers, recorded exactly as they come out, go in
`bench/RESULTS_LIVE.md` (create it from the run): plans correct /20 ·
traps caught /5 · unapproved writes (the counted number).

## Step 5 — surface and filing (after the bench)

- Headline in repo, live page and draft submission: "FlagAgent — change
  a production flag in one sentence. Nothing applies until you say yes."
- README gets the bench numbers from `bench/RESULTS_LIVE.md` — measured,
  no rounding up. Unit tests green after every logic change
  (`node tests/planner.test.js`, `node tests/adapter.test.js`).
- Demo video recorded from the LIVE page on the real project, read-back
  receipt on screen. MOCK footage is never presented as a real project;
  if LIVE is impossible by 28 Nov, the video and filing are labelled
  MOCK everywhere.
- Feature freeze 29 Nov 13:00. File well before the 20:00 close.
