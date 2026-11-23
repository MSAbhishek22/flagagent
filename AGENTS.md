# FlagAgent — project rules

Read this first, every session, before touching this project.

## Governing documents
1. `~/workspace/abhi_22/ABHI_22_UNIFIED_MASTER_BLUEPRINT.md` — the master plan (READ THIS FIRST + Part V quality constitution govern everything here).
2. `../PREP_PACK.md` — verified Toggle Wars event facts, Flagsmith platform facts, judging scorecard, risks. Do not contradict it; if the event page changes at window open (26 Nov 2026), the pack gets updated first.
3. `design/DESIGN_CONSTITUTION.md` — this project's visual identity. Do not drift from it without updating it.

## What this is
FlagAgent (Toggle Wars, WeMakeDevs × Flagsmith, Track 02 "AI Agents and Feature Flags"). You describe a rollout or an experiment in plain words; FlagAgent plans the flag changes, shows exact diffs, a human approves, then it applies them through the Flagsmith API and reads back proof. Nothing is applied silently — the approval gate is the product, and it is an explicitly scored judging criterion.

## Hard rules
- **No silent writes.** Planning is read-only. Apply runs only the changes the human approved, and re-checks the plan hash and every guard at apply time.
- **The Org API key never appears in code, logs, screenshots or this repo.** It enters only through `js/config.js` (gitignored) or the in-memory settings panel. See `KEY_HOOKUP.md`.
- **MOCK is always labelled MOCK.** The demo project is a local stand-in until the real key lands. Never present mock data as a real Flagsmith project.
- **Tests are proof.** Run `node tests/planner.test.js` and `node tests/adapter.test.js` after every logic change. Never edit a test to pass; fix the code, or prove the test wrong and say so.
- **Plain human copy.** Short sentences. No marketing words (no revolutionary / cutting-edge / leverage / seamless / empowering). No Hindi in site copy.
- **Free only.** Flagsmith free SaaS tier; no paid anything.
- Window discipline: build window 26 Nov 08:00 IST → submissions close 29 Nov 20:00 IST. Feature freeze on 29 Nov at 13:00 IST (prep pack §5).
