# FlagBench-20 — MOCK rehearsal results, round 2

**Run:** 25 Nov 2026, `node bench/run_bench.js` against the demo project
(MockAdapter + `js/seed.js`), after fixing the three R1 misses. This is a
rehearsal on a local stand-in — **not** the scored run, and none of these
numbers may be quoted as a FlagBench score. The scored run happens on the
real Flagsmith project in the build window (see `../LIVE_RUN_CHECKLIST.md`).
Round 1 record: `RESULTS_MOCK_2026-11-25.md` (kept unchanged).

## Measured

- Plans produced correctly: **20 / 20**
- Cases fully passing: **20 / 20**
- Traps caught: **5 / 5**
- Unapproved writes: **0**
- Unit tests, same day, unedited: planner **20 / 20**, adapter **9 / 9**

Machine-readable record: `results-mock-r2-2026-11-25.json`.

## How each R1 miss was settled

### Case 1 — Turn a flag on: the CASE was corrected, the planner was right

R1: the plan had 2 changes, the case expected 1.

The product's meaning of "enable" is documented and pinned in several
places, and they all say the same thing — enable means **fully on**:
enabled, with rollout at 100%.

- The planner's own tests pin it: "enable in staging raises a half-on
  flag to full with one rollout change" — `Enable search_v2 in staging`
  (already enabled at 50%) plans a rollout change 50% → 100%. If enable
  only flipped the enabled bit, that instruction would plan nothing.
- The verified live demo flow showed one instruction planning
  "new_checkout OFF to ON, rollout 0% to 100%".
- The v2 idea doc's demo approves enabled and rollout as two separate
  tickable changes ("approve both changes") — the split is the design,
  not an accident.

The build plan's case 1 wording ("plan exactly one change — off → on")
holds for a flag whose rollout already sits at 100%, which is the normal
off state, and the real-project bench setup writes every starting state
down before the run. Against this seed project, `new_checkout` in
Production starts off at **0%** — deliberately, because the demo sentence
needs a 0% rollout to release from. On that starting state, a fully-on
enable is two changes; an enable that left rollout at 0% would switch
the flag on for nobody.

So the case was corrected, with the reason recorded at the case itself
in `cases.js`: it now expects the two changes (`set_enabled` → on,
`set_rollout` → 100%) and a final state of enabled at 100% rollout.
The planner was not touched for this case. Nothing was silenced — R1's
record of the miss stands above, and this section is the decision.

### Case 8 — Two changes, separately approved: the PLANNER was fixed

R1: the plan had 1 change, the case expects 2 — "Turn off legacy_search
in production and staging" planned only Production; Staging was silently
ignored.

The documented clarification rule (README: "One flag per instruction, on
purpose. Compound instructions get a clarification, not a guess"; the v2
doc describes v1 the same way) is about **several flags or operations**
in one sentence. Case 8 names **one flag and one operation** across two
environments, and the build plan — the bench's source document — demands
exactly this shape: "list two changes, each with its own tick box", with
one ticked and one rejected in the pass condition. The case does not
conflict with the rule; the planner conflicted with both, and its actual
behaviour was worse than either option — it neither planned both
environments nor asked a clarification. It just dropped one.

Fix (`js/planner.js`): a plain on/off instruction that explicitly names
several environments now plans the change in each named environment, in
the order named, one tickable change per environment. Instructions
naming one environment — or none — behave exactly as before. Rollout,
segment, variant and value instructions still plan against a single
environment; multi-environment planning covers plain on/off, which is
what the bench's case and the build plan ask for.

R2 behaviour: 2 changes planned (Production, Staging); only the approved
Production change applied and read back; Staging untouched, as the case
requires.

### Case 10 — Match one environment to another: the PLANNER was fixed

R1: plan status was `needs_clarification` — cross-environment matching
was not a planning skill the planner had. The build plan asks for it by
name: "read both environments, show the diff as the plan… after apply,
read-back shows both states equal."

Fix (`js/planner.js`): "Make \<env\> match \<env\> for \<flag\>" now
plans the diff between the two environments' states for that flag — one
tickable change per differing field (`set_enabled`, `set_rollout`,
`set_value`, `set_variants`), each change carrying the target
environment, so approving a subset applies only that subset. Guards are
still parsed from the instruction, re-evaluated against the target
environment on the plan, and re-checked by the executor at apply time,
as with every other plan. Segment overrides are not copied (the plan
says so in an assumption when a flag has them); matching one flag at a
time keeps the documented one-flag-per-instruction rule. If the states
already match, the plan says so and plans nothing.

R2 behaviour on the seed: Staging `search_v2` is on at 50%, Production
on at 25%, so the whole diff is one change — rollout 25% → 50% —
applied and read back; both states equal afterwards.

## What did not change

- No existing test was edited. Planner 20/20 and adapter 9/9 pass as
  they stood; where a fix touched shared code, the code was made to
  satisfy the tests, not the other way round.
- The one case correction (case 1) is recorded at the case and above,
  with the documents it rests on. The other 19 cases are byte-identical
  to R1.
- Everything is still MOCK-labelled. The live run still waits on the
  user's key paste, which is not part of this round.
