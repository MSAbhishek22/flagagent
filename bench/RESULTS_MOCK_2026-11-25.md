# FlagBench-20 — MOCK rehearsal results

**Run:** 25 Nov 2026, `node bench/run_bench.js` against the demo project
(MockAdapter + `js/seed.js`). This is a rehearsal on a local stand-in —
**not** the scored run, and none of these numbers may be quoted as a
FlagBench score. The scored run happens on the real Flagsmith project in
the build window (see `../LIVE_RUN_CHECKLIST.md`).

## Measured

- Plans produced correctly: **17 / 20**
- Cases fully passing: **17 / 20**
- Traps caught: **5 / 5**
- Unapproved writes: **0**

## The three misses (kept as misses — the case list was not edited)

1. **Case 1 — Turn a flag on.** Plan had 2 changes, the case expects 1.
   "Enable new_checkout in production" on a flag that is off at 0%
   rollout plans `set_enabled` (off → on) **and** `set_rollout`
   (0% → 100%). Safe, gated and read back — but not the one change the
   case list asks for. Product decision needed (see bench/README.md).
2. **Case 8 — Two changes, separately approved.** Plan had 1 change,
   the case expects 2. "Turn off legacy_search in production and
   staging" planned only Production; Staging was ignored.
3. **Case 10 — Match one environment to another.** Plan status was
   `needs_clarification`, the case expects a ready plan. The planner
   replied: "That instruction does not match anything FlagAgent can
   plan." Cross-environment matching is not supported today.

## What passed, in short

Rollouts (fresh, raised with the before-value read live, bigger, back to
zero with the flag kept), one-environment-only changes, flag creation,
segment-only enable, the demo sentence with its guard, a guard re-checked
at apply time, a guard broken between plan and apply (refused, zero
writes), a state-based guard, a guarded delete with the typed name, and
all five traps: bad variant weights, a taken name, a delete without the
typed name, a guard already broken, and a flag that does not exist.

Machine-readable record: `results-mock-2026-11-25.json` (per-case plan,
apply result, final state, and failure reasons).
