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

## The confirmed write contract — v2 feature versioning (the primary path for project 54209)

**Project 54209's environments use v2 feature versioning.** Proven live on 26 Nov 2026, in the API's own words: with a spec-correct v1 body, the legacy featurestates PUT still answered **400** `{"detail":"This environment uses v2 feature versioning. Use the environment feature version endpoint instead."}` — while reads on the same route passed. On a versioned environment the legacy write routes below are rejected outright, no matter the body. The adapter therefore writes through the feature version endpoints (live swagger, 26 Nov 2026; the version-flow tests in `tests/adapter-versions.test.js` assert this flow):

**Detection.** The environments list carries `use_v2_feature_versioning` (present on the environment serializers), and `listEnvironments` records it per environment, like the api_key. When the flag is absent, the first legacy PUT's versioning 400 latches the environment to v2 for the rest of the session and the same change is retried through the version flow.

**The flow** (paths relative to the API base; note this family addresses the environment by its **numeric pk** — the opposite of the featurestates routes, which use the api_key):

1. `GET /environments/{envPk}/features/{featurePk}/versions/` → `PaginatedEnvironmentFeatureVersionList` of `EnvironmentFeatureVersion` (`uuid`, `published`, `is_live`, `live_from`, `description`; everything else read-only). Reuse the feature's unpublished draft (`published: false`) if one exists.
2. Otherwise `POST` the same path with an `EnvironmentFeatureVersionCreate` body — every field is optional (`live_from`, `description`, and the write-only `feature_states_to_create` / `feature_states_to_update` / `segment_ids_to_delete_overrides` / `publish_immediately`). The adapter sends only a `description`. → 201, the new version with its `uuid`.
3. `GET .../versions/{uuid}/featurestates/` → the version's states (`CustomEnvironmentFeatureVersionFeatureState`). Take the plain environment state (no `feature_segment`, no `identity`) and `PUT .../versions/{uuid}/featurestates/{id}/` with the change applied. (If a fresh draft somehow has no plain state, it is created with `POST` on the same collection, already carrying the change.) Body rules: `feature_state_value` is **required** — always the nested object `{type: int | unicode | bool, string_value, integer_value, boolean_value}`, carried through from the fetched state unless the change sets the value. Writable: `enabled`, `feature_state_value`, `feature_segment`, `multivariate_feature_state_values` (same A2 weights as below). Read-only, never sent: `id`, `feature`, `environment`, `identity`, `change_request`, `uuid`, `live_from`, `created_at`, `updated_at`, `deleted_at`. There is still no `percentage` field — rollout 0/100 map to `enabled` off/on exactly as in A1, and a partial rollout on a standard flag is refused plainly before any call.
4. `POST .../versions/{uuid}/publish/` with an `EnvironmentFeatureVersionPublish` body (`live_from` optional; the adapter sends `{}` to publish now). Only after publish does the live featurestates list — and so FlagAgent's read-back — show the change.

## The legacy write contract (non-versioned environments only, field-by-field, live swagger 26 Nov 2026)

For environments **without** v2 feature versioning, writes use the v1 routes below. Read off `api.flagsmith.com/api/v1/swagger.json` and diffed against every key `RealAdapter._projectedBody` can emit. The write tests (`tests/adapter-write.test.js`) assert this contract.

**PUT /environments/{environment_api_key}/featurestates/{id}/ — FeatureStateSerializerBasic.** Required: `feature` (integer).
- Writable: `feature` (integer), `enabled` (boolean), `environment` (integer|null), `identity` (integer|null), `feature_segment` (integer|null), `change_request` (integer|null), `environment_feature_version` (uuid string|null), `live_from` (date-time string|null), `identifier` (string), `multivariate_feature_state_values` (items: `multivariate_feature_option` integer + `percentage_allocation` number, both required; the item `id` is marked read-only in the shared schema — DRF ignores read-only input, and Flagsmith's nested update matches existing values by it, so fetched ids are carried through).
- Read-only, never sent: `id`, `uuid`, `version`, `created_at`, `updated_at`, `deleted_at`, `feature_state_value` (a read-only scalar on this route).

**PUT /features/featurestates/{id}/ — WritableNestedFeatureState.** Required: `environment` + `feature`. The same writable/read-only split as above, except `feature_state_value` is writable here as the nested object `{type: int | unicode | bool, string_value, integer_value, boolean_value}`.

**The read shape is not the write shape.** The featurestates LIST answers with FeatureStateSerializerWithIdentity: the same key names, but `identity` arrives as a nested object `{id, identifier}`, not the integer the write serializers want. The projection therefore coerces every integer-typed field (`feature`, `environment`, `identity`, `feature_segment`, `change_request`) to a real integer — an identity object contributes its `id` — and drops anything it cannot coerce, instead of sending a wrong-typed value. Any other key a list item carries beyond the serializer's fields is likewise never copied. Audit outcome: every key the projection emitted was already inside the writable set and no read-only key leaked; the one wrong-type risk was `identity`, closed by the coercion.

**Errors carry the API's words.** A non-OK response's body (whitespace-collapsed, trimmed to 300 chars) is appended to the error the receipt shows, so a failed write names the field Flagsmith rejected instead of a bare status. And `index.html` loads the adapter with a `?v=` cache-bust query, so a fixed adapter is never masked by a browser-cached old one.

## The 5-minute verification script (run before the first live apply)
1. **Read check (1 min):** Connect (Route A). The board must list the real project's flags with plausible states. If the board is empty or wrong, stop — do not apply anything.
2. **Raw response check (2 min):** In a terminal, fetch one feature-state list and eyeball the field names against `RealAdapter._normaliseState`:
   `curl -s -H "Authorization: Api-Key <key>" https://api.flagsmith.com/api/v1/environments/<envApiKey>/featurestates/ | head -c 2000`
   Note the segment is the environment's **api_key** (the `api_key` field in the environments list), *not* its numeric id — the API has no numeric-id featurestates route and answers 403 to one (confirmed live, 25 Nov 2026; the adapter was patched to match).
   The two marked assumptions were settled against the live swagger on 26 Nov 2026:
   - **A1 — rollout percentage: there is no such field.** No feature-state schema in the swagger has `percentage`; rollout % exists only as `percentage_allocation` on multivariate values. The normaliser derives rollout from `enabled` (on → 100, off → 0). `set_rollout` writes 0 and 100 as enabled off/on; a partial rollout on a standard flag cannot be written through the v1 API at all, and the adapter refuses it plainly instead of sending a field the API does not have.
   - **A2 — multivariate weights: confirmed.** `multivariate_feature_state_values[].percentage_allocation`, keyed by `multivariate_feature_option` (both required on write). Write bodies carry the fetched weights through unchanged. Changing the weights themselves (set_variants) is still not wired in the live adapter — it returns a clear "not wired" refusal, never a fake success.
   - **Write shape (found the hard way, 25 Nov 2026):** the featurestates PUT *requires* `feature` in the body. The first live run sent `{enabled}` alone and every write came back **400** while reads passed. Bodies are now built from the fetched feature state, projected onto the serializer's writable fields. Value writes go through `PUT /features/featurestates/{id}/` with a nested `feature_state_value` object (`{type: int / unicode / bool, string_value, integer_value, boolean_value}`) — on the environment route that field is read-only.
   Versioning (settled live, 26 Nov 2026): project 54209's environments use **v2 feature versioning**. Reads answer on the v1 route above, but state writes on it are rejected with the versioning 400 quoted in the contract section — writes go through the feature version endpoints there. (This corrects the earlier prep-pack R4 note, which had the project on the v1 route throughout.)
3. **One safe write (1 min):** In the console, plan `Enable <a harmless test flag> in Development` (create one in Flagsmith first if none exists). Approve, apply, and confirm the receipt reads back ON — then check the same flag in the Flagsmith dashboard.
4. **Guard check (1 min):** Plan the demo rollout sentence with a guard naming a real flag. Break the guard by hand in Flagsmith, re-plan, and confirm FlagAgent shows the guard violated and refuses the apply.
5. Only after 1–4 pass: run the recorded demo flow (prep pack §6 beats) against the live project.

## If something fails
- **401/403:** the key is wrong, revoked, or not an *Organisation* key (project/environment keys will not work for the Management API).
- **CORS error in the browser console:** the Management API may refuse browser-origin calls from the Pages domain. Fallback: run the same page from `localhost` (any static server) — the adapter and flow are unchanged — or front the API with the Flagsmith MCP server (`https://mcp.flagsmith.com`, same Api-Key auth) in a later iteration.
- **Board reads fine, writes fail with 400:** read the API's own words in the receipt first (since round 3 the body text is shown on the page). If it says "This environment uses v2 feature versioning", the environment is versioned — the adapter handles that through the version endpoints above, so a repeat of that exact failure means the page is running an old cached adapter (hard-refresh; the script tag carries a `?v=` cache-bust). On a non-versioned environment, the write body is missing something the serializer requires — `feature` first of all (that was the 25 Nov 2026 failure); after that, check the legacy contract above (the `identity` type trap especially) and A1/A2. Nothing is ever reported as applied unless the read-back matches.
