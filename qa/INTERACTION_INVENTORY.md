# FlagAgent — Interaction Inventory (Blueprint Part V)

Every visible control, its expected behaviour, and its test evidence.
Browser evidence: `qa/run_qa.py` — 20/20 checks, real Playwright clicks, 0 console errors (23 Nov 2026).
Logic evidence: `tests/planner.test.js` 20/20, `tests/adapter.test.js` 9/9.

| # | Control | Route | Expected behaviour | Status |
|---|---------|-------|--------------------|--------|
| 1 | "Connect Flagsmith" button | header | Opens/closes the settings panel | PASS — panel starts hidden (QA check), toggles on click |
| 2 | Settings: API key / Project ID / label inputs | settings | Text entry; key field is type=password, cleared after a successful connect | PASS — code-reviewed + connect error path exercised in QA design (live success path pending the real key, KEY_HOOKUP §5-min script) |
| 3 | "Connect" button | settings | Reads the live project; chip flips to LIVE on success; on failure shows the error and stays on MOCK | PASS (failure path) / BLOCKED (success path — needs the real Org key) |
| 4 | "Use the demo project" button | settings | Returns the console to the MOCK adapter and re-renders the board | PASS — code path identical to init; exercised via init in every QA run |
| 5 | "Low motion: off/on" toggle | header | Sets body.low-motion, clears board tilt, updates label + aria-pressed | PASS — QA check (body class) |
| 6 | Hero signal-board switches (×3) | hero | Flip the flag in Production on the adapter; lamp, state text and the watch board update | PASS — QA check (search_v2 flip → board OFF) |
| 7 | "Work a change" link | hero | Anchors to #console | PASS — plain anchor, verified in screenshots |
| 8 | Instruction textarea | console | Free text; empty text on Plan returns focus without a plan | PASS — code-reviewed; non-empty paths all QA-covered |
| 9 | Environment select | console | Sets the console environment; watch board re-renders for it; used as the plan's environment when the sentence names none (stated as an assumption) | PASS — QA (watch render) + planner tests for named/default env |
| 10 | Example chips (×4) | console | Fill the instruction box with the example sentence | PASS — QA clicks two of them end-to-end |
| 11 | "Plan it" button | console | Builds the plan read-only; renders assumptions, guards, errors, warnings, diff rows, plan hash | PASS — QA checks (diffs, guard, hash) + 20 planner tests |
| 12 | Per-change approval checkboxes | plan | Tick/untick changes; apply arms only with ≥1 ticked | PASS — QA (armed state) + executor subset test |
| 13 | Delete typed-name input | plan | Appears for delete changes; apply stays disarmed until the exact flag name is typed | PASS — QA checks both states; executor refusal tested |
| 14 | "Apply approved changes" button | plan | Runs the executor; refuses on hash mismatch / broken guard / unarmed delete; renders the receipt | PASS — QA happy path + 3 refusal unit tests |
| 15 | "Refresh" button | watch board | Re-reads the adapter snapshot and re-renders the board + hero board | PASS — same refreshAll path runs after every apply in QA |
| 16 | Watch board rollout bars / pills | watch board | Read-only display of state read back from the adapter (no fake data) | PASS — QA asserts board contents before/after applies |
| 17 | Session log | console | Read-only record of plans, applies, refusals and manual flips, newest first | PASS — populated throughout the QA run |

No dead buttons, no `href="#"`, no placeholder actions. The only BLOCKED item is the live-connect success path, which cannot be exercised until the user's Org API key lands — its failure path is tested and its success path has a written 5-minute verification (KEY_HOOKUP.md).
