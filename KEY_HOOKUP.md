# FlagAgent — Key Hookup (when the Flagsmith Org API key lands)

The key comes from the user through the Secure Vault. It is **never** pasted in chat, committed, logged, or screenshotted. FlagAgent holds it in page memory only.

## What you need
1. **Organisation API key** — Flagsmith → Organisation settings → API keys. (Auth header format: `Authorization: Api-Key <key>`.)
2. **Project ID** — the numeric id of the Flagsmith project (in the project URL/settings).
3. Optional: an **Environment key** is *not* needed by FlagAgent itself (that is for app SDKs, e.g. the demo target page if one is added later).

## Route A — settings panel (recommended, nothing to commit)
1. Open the live FlagAgent page → **Connect Flagsmith** (top right).
2. Paste the Organisation API key, type the Project ID and a label.
3. Click **Connect**. FlagAgent reads the project's environments, segments and flags. On success the header chip flips to **LIVE — &lt;label&gt;** and the key field clears itself (the key now lives only in the adapter's memory).
4. If the read fails, the page says why and stays on MOCK. Nothing was written anywhere.

## Route B — config snippet (for a self-hosted copy)
Create `js/config.js` (already in `.gitignore`) with:

```js
window.FLAGAGENT_CONFIG = {
  mode: 'LIVE',
  apiKey: '<from the vault>',
  projectId: '<numeric id>',
  projectName: '<label>',
  apiBase: 'https://api.flagsmith.com/api/v1'
};
```

and add `<script src="js/config.js"></script>` immediately **before** the `js/app.js` script tag in `index.html`. The shipped page deliberately has no config script tag, so the public demo can never leak a key and loads with zero console errors.

## How MOCK → LIVE switching works
`createAdapter()` returns the real adapter only when `mode: 'LIVE'` **and** both `apiKey` and `projectId` are present; otherwise it returns the mock. The planner, executor, diffs, guards and receipt are the same code in both modes — only the adapter changes.

## The 5-minute verification script (run before the first live apply)
1. **Read check (1 min):** Connect (Route A). The board must list the real project's flags with plausible states. If the board is empty or wrong, stop — do not apply anything.
2. **Raw response check (2 min):** In a terminal, fetch one feature-state list and eyeball the field names against `RealAdapter._normaliseState`:
   `curl -s -H "Authorization: Api-Key <key>" https://api.flagsmith.com/api/v1/environments/<envApiKey>/featurestates/ | head -c 2000`
   Note the segment is the environment's **api_key** (the `api_key` field in the environments list), *not* its numeric id — the API has no numeric-id featurestates route and answers 403 to one (confirmed live, 25 Nov 2026; the adapter was patched to match).
   Confirm or fix the two marked assumptions:
   - **A1 — rollout percentage:** the normaliser reads `fs.percentage`; if the real field differs, patch `_normaliseState` and the `set_rollout` body in `applyChange` together.
   - **A2 — multivariate weights:** read from `multivariate_feature_state_values[].percentage_allocation`. Variant *writes* are not wired in the live adapter yet (it returns a clear "not wired" refusal, never a fake success) — plan variant changes in the demo project, or wire the write here after seeing a real response.
   Also confirm whether the account's environments use v1 or v2 feature versioning (prep pack R4) — v2 environments may need the versioned endpoints for state writes; if the PUT in step 3 fails with a versioning error, that is the cause.
3. **One safe write (1 min):** In the console, plan `Enable <a harmless test flag> in Development` (create one in Flagsmith first if none exists). Approve, apply, and confirm the receipt reads back ON — then check the same flag in the Flagsmith dashboard.
4. **Guard check (1 min):** Plan the demo rollout sentence with a guard naming a real flag. Break the guard by hand in Flagsmith, re-plan, and confirm FlagAgent shows the guard violated and refuses the apply.
5. Only after 1–4 pass: run the recorded demo flow (prep pack §6 beats) against the live project.

## If something fails
- **401/403:** the key is wrong, revoked, or not an *Organisation* key (project/environment keys will not work for the Management API).
- **CORS error in the browser console:** the Management API may refuse browser-origin calls from the Pages domain. Fallback: run the same page from `localhost` (any static server) — the adapter and flow are unchanged — or front the API with the Flagsmith MCP server (`https://mcp.flagsmith.com`, same Api-Key auth) in a later iteration.
- **Board reads fine, writes fail:** almost always A1/A2 or v2 versioning above. The receipt will show the API's error text; nothing is ever reported as applied unless the read-back matches.
