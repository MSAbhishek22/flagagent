# FlagAgent

**FlagAgent — change a production flag in one sentence. Nothing applies until you say yes.**

FlagAgent works a Flagsmith project from plain words. You describe a change — *"Release the new checkout to 10% of users in production, only if the payments kill switch stays off"* — and FlagAgent:

1. **Plans it, read-only.** Your sentence becomes a list of exact changes: flag, environment, before → after. Guards ("only if … stays off") are pulled out and checked against live state.
2. **Shows you the diff.** Every change is its own line with its own tick box. Assumptions are stated, traps are flagged — variant weights that do not add to 100, a flag name already taken, a live production flag about to go dark.
3. **Applies only what you approved.** A delete needs the flag's name typed out. The plan carries a hash: edit the plan after approval and the apply refuses. Guards are re-checked at the moment of applying — if one broke while you were reading, nothing runs.
4. **Reads everything back.** Each applied change is fetched again and compared with the plan before the receipt calls it done.

Built for **Toggle Wars** (WeMakeDevs × Flagsmith), **Track 02 — AI Agents and Feature Flags**, where the scorecard asks for exactly this: Flagsmith API/CLI use, real time saved, *"a human approves changes"*, clear output.

## Try it

Open `index.html` (or the live URL) — it runs on a **labelled demo project (MOCK)** until a real Flagsmith key is connected, so the full loop works with no account: plan → approve → apply → read-back → board. The hero's signal board is live too: its switches work the same demo project.

## Going live

See **KEY_HOOKUP.md** — where the Organisation API key goes (the in-page settings panel, memory only, or a gitignored config), which fields to set, how the header chip flips from MOCK to LIVE, and a 5-minute verification script to run before trusting a live apply.

## How it is built

```
instruction ─► planner.js ─► plan (changes + guards + hash)
                              │  human ticks / types / rejects
                              ▼
              executor.js ─► adapter.applyChange (per approved change)
                              │  read-back after every change
                              ▼
              receipt + watch board
adapter.js ─ MockAdapter (seeded demo project, seed.js)
             RealAdapter (Flagsmith Management REST API, Api-Key auth)
```

- `js/planner.js` — deterministic parser + validator + diff generator. No model call: every plan is reproducible and unit-tested (the prep pack's R6 fallback, kept as the design).
- `js/executor.js` — applies approved changes in order; refuses on hash mismatch, broken guards, or a missing typed confirmation; verifies each write by reading it back.
- `js/adapter.js` — one interface, two implementations. Everything above the adapter is identical for MOCK and LIVE.
- `js/app.js`, `index.html`, `css/styles.css` — the console: landing (hero → problem → solution → the app → outcome) plus the working signal board.

## Tests

```
node tests/planner.test.js   # 20 checks — parsing, diffs, validation, executor refusals
node tests/adapter.test.js   #  9 checks — mock apply + read-back, field separation
python3 qa/run_qa.py         # 20 checks — real browser clicks, full loop, 0 console errors
```

All 49 checks pass. Nothing was edited to make a test pass; one real bug the QA screenshots caught (a settings panel visible on load) was fixed in the CSS and covered by a new check.

## Honest limits

- The demo project is a local stand-in, labelled MOCK everywhere. It is not a Flagsmith account.
- The live adapter is written against the documented Flagsmith Management API. Two field mappings the docs do not pin down (rollout percentage on a feature state, multivariate weight writes) are marked `ASSUMPTION` in the code and listed in KEY_HOOKUP.md — they must be confirmed against one raw API response in the 5-minute verification before the live demo.
- FlagAgent stages everything up to starting a Flagsmith experiment; starting one stays a deliberate human step in Flagsmith itself (Flagsmith's own guide notes its MCP server cannot start experiments). The plan says so when relevant.
- One flag per instruction, on purpose. Compound instructions get a clarification, not a guess.

## FlagBench-20 — live run

Scored run on the real Flagsmith project, 26 Nov 2026 — worked case by case through the live page against "My first project" (project 54209). Measured: **plans correct 16/20 · cases fully passing 11/20 · traps caught 5/5 · unapproved writes 0.** Full per-case record: `bench/RESULTS_LIVE.md`.

The shortfall against the mock rehearsal (20/20) is the live API, not the gate: a boolean feature state has no percentage field, so partial rollouts (10% / 25% / 40% / 50%) cannot be written, and segment overrides and flag deletion are not wired for the live API yet. Every refusal left the project unchanged — unapproved writes stayed zero.
