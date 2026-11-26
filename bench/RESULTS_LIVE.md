# FlagBench-20 — LIVE results, 26 Nov 2026

**Run:** 26 Nov 2026, worked case by case through the live page (https://msabhishek22.github.io/flagagent/) against the real Flagsmith project "My first project" (project 54209, org "M S abhishek's Org"), Organisation API key `flagagent-live-6`, environments Development / Staging / Production. Each case started from the live seed state, restored by hand in Flagsmith before the case. This is the scored run. The mock rehearsals (`RESULTS_MOCK_2026-11-25.md`, `RESULTS_MOCK_R2_2026-11-25.md`) are not this score.

## Measured

- Plans produced correctly: **16 / 20**
- Cases fully passing: **11 / 20**
- Traps caught: **5 / 5**
- Unapproved writes: **0**

## Per-case record

| Case | Plan | Outcome | What happened |
| --- | --- | --- | --- |
| 1 Enable new_checkout in production | correct | PASS | 2 changes (OFF → ON, rollout 0% → 100%), applied and read back. Production new_checkout ON 100%, restored to OFF after. |
| 2 Roll out search_v2 to 10% in production | wrong | FAIL | Planner added an enable change (2 changes, expected 1). The 10% rollout was refused at apply time: a boolean feature state has no percentage field, so the enable landed and Production search_v2 ended ON 100%. |
| 3 Roll out search_v2 to 25% in production | wrong | FAIL | The 10% starting state the case needs cannot exist live. Plan read beforeRollout 100% against an expected 10%. The rollout was refused; Production stayed ON 100%. |
| 4 Turn off search_v2 in staging | correct | FAIL | Staging OFF applied and read back. The case's final check also needs Production search_v2 at rollout 25, which cannot exist live (ON 100%). |
| 5 Create a flag called holiday_banner | correct | PASS | Created OFF in every environment; the flag was deleted in Flagsmith afterwards to restore the seed. |
| 6 Enable new_checkout for beta users in staging | correct | FAIL | Segment overrides are not wired for the live API yet (see KEY_HOOKUP.md). Apply refused, 0 of 1 applied, nothing written. |
| 7 Roll out search_v2 to 50% in production | wrong | FAIL | The 25% starting state cannot exist live. Plan read beforeRollout 100% against an expected 25%. The rollout was refused; Production stayed ON 100%. |
| 8 Turn off legacy_search in production and staging (approve Production only) | correct | PASS | Production applied and read back; Staging skipped as not approved and still ON. Production restored to ON after. |
| 9 Roll out search_v2 to 0% in production | correct | PASS | Applied and read back; Production OFF 0%. Restored to ON after. |
| 10 Make Production match Staging for search_v2 | wrong | FAIL | Live, both environments are already at 100% (Staging 50% cannot exist live). Plan blocked with 0 changes; Production stayed 100%. |
| 11 Guarded: release the new checkout to 10% in production, only if the payments kill switch stays off | correct | FAIL | Guard holding at plan and apply time. Enable applied; the 10% rollout was refused (no percentage field). Production ended ON 100%; restored to OFF after. |
| 12 Guarded: roll out search_v2 to 40% in production, only if legacy_search stays on | correct | FAIL | Guard holding. The rollout was refused; Production stayed ON 100%. |
| 13 Guarded demo sentence, guard broken between plan and apply | correct | PASS | Kill switch turned ON in Production after planning; apply refused at apply time, zero writes. Production new_checkout stayed OFF. Kill switch restored to OFF after. |
| 14 Guarded: enable new_checkout in production, only if new_checkout is currently off in production | correct | PASS | Guard holding. 2 of 2 changes applied and read back; Production ON. Restored to OFF after. |
| 15 Guarded: delete legacy_search, only if legacy_search stays off in every environment | correct | FAIL | Guard holding (Production). delete_feature is not wired for the live API yet; apply refused, 0 of 1 applied, nothing written. Run note: the Staging OFF toggle in the setup did not stick, so the guard was in fact evaluated on Production only — the planner's guard checks the plan environment. |
| 16 Trap: headline test 60/30 | correct | PASS (trap caught) | Plan blocked: variant weights add up to 90%, not 100%. Apply disabled; nothing written. |
| 17 Trap: create a flag called new_checkout | correct | PASS (trap caught) | Plan blocked: a flag named new_checkout already exists. Nothing written. |
| 18 Trap: delete legacy_search without typing the name | correct | PASS (trap caught) | Plan ready with 1 delete change. Apply stayed disabled without the typed name; legacy_search still exists in Production. |
| 19 Trap: guarded demo sentence, guard already broken at plan time | correct | PASS (trap caught) | Plan ready, guard violated ("The guard is already broken"). Apply refused at apply time; zero writes. Production new_checkout stayed OFF. Kill switch restored to OFF after. |
| 20 Trap: enable express_pay in production | correct | PASS (trap caught) | Plan needs clarification: no flag matches express_pay. Nothing written. |

## Why the live score differs from the mock

- Rollouts on a boolean flag (cases 2, 3, 7, 10, 11, 12): the live Flagsmith API has no percentage field on a v1 feature state — rollout is derived from `enabled` (KEY_HOOKUP.md A1, settled from the live swagger). The mock seed's 10% / 25% / 50% states cannot exist on the real project, so those cases cannot pass as written live. The planner still offers the rollout change and the executor refuses it, with the reason on the receipt — nothing wrong is written.
- Segment overrides (case 6) and flag deletion (case 15) are not wired for the live API yet (KEY_HOOKUP.md). Both are refused at apply time; nothing is written.
- Case 4's final check needs Production search_v2 at rollout 25, which cannot exist live.

## What was left as found

- Seed restored after the run: new_checkout Development ON / Staging ON / Production OFF; search_v2 ON in all environments; legacy_search ON in all environments; payments_kill_switch OFF in all environments; headline_test ON with variants 50/50 in all environments; flagagent_test_flag Development ON / Staging ON / Production OFF; show_demo_button ON in Development (the safe write from the checklist verification step), OFF elsewhere. No holiday_banner; no segment overrides.
- Organisation API key `flagagent-live-6` was created for this run. Its value was never written down anywhere.
- Unit tests were not re-run during this live session (no terminal in the live-run browser). Planner 20/20 and adapter 9/9 stand from the mock R2 record of 25 Nov 2026, unedited since.
