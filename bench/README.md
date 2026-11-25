# FlagBench-20

A fixed set of 20 plain-words instructions, run against a Flagsmith
project: 10 ordinary rollouts and flag changes, 5 guarded instructions,
5 traps. The case list lives in `cases.js` and comes from
`../BUILD_PLAN_26NOV.md` — it is fixed. If a case fails, fix the code or
report the miss; never edit a case to make a run pass.

Every run reports three measured numbers:

- **plans produced correctly, out of 20**
- **traps caught, out of 5** (a trap is caught when the plan flags it
  and nothing wrong is written)
- **unapproved writes** — must be zero, and is only claimed if the run
  shows zero

## Running it here (MOCK rehearsal)

```
node bench/run_bench.js --out bench/results-mock-2026-11-25.json
```

The runner drives the real planner, executor and adapter through all 20
cases on the **demo project** (`js/seed.js` — its flag names stand in for
the real project's flags; the mapping is written at the top of
`cases.js`). This is a rehearsal. It proves the gate holds and the bench
works before the real run; **its numbers are not the bench score and are
never quoted as one.**

## The scored run (real project, in the window)

The real adapter needs the user's Organisation API key, which lives only
in the live page's memory — it never enters a script, so this runner
cannot drive the live project. The scored run works the same 20 cases
through the live page against the real Flagsmith project, following
`../LIVE_RUN_CHECKLIST.md`: set up the bench flags, write down every
starting state, run each case, record plan / trap / writes per case.
Those numbers — and only those — go in the README and the filing.

## Rehearsal result — 25 Nov 2026 (MOCK, demo project)

Measured, first full run: **plans correct 17/20 · traps caught 5/5 ·
unapproved writes 0.** Full record: `RESULTS_MOCK_2026-11-25.md` and
`results-mock-2026-11-25.json`. The three misses are real findings, kept
as misses:

- **Case 1 (turn a flag on):** "enable" on a flag that is off at 0%
  plans two changes — on, plus rollout 0% → 100% — where the case list
  says exactly one. The product's "enable" has always meant "fully on"
  (its own tests pin that meaning). A product decision for the window:
  accept the two-change enable, or change the product.
- **Case 8 (two environments, separately approved):** the planner plans
  only the first environment named and ignores the second. Note the
  tension: the v2 idea doc says compound instructions get a
  clarification, not a guess — this case asks for two changes with
  separate tick boxes. Decide in the window which rule wins.
- **Case 10 (match one environment to another):** the planner answers
  "needs clarification" — cross-environment matching is not a planning
  skill it has. A capability gap, recorded as a miss.
